const mongoose = require("mongoose");
const { createHash } = require("node:crypto");
const Customer = require("../models/customer");
const BakeryProductFamily = require("../models/bakeryProductFamily");
const BakeryProductVariant = require("../models/bakeryProductVariant");
const FinishedStockLot = require("../models/finishedStockLot");
const FinishedStockLotAllocation = require("../models/finishedStockLotAllocation");
const ProfileSettings = require("../models/profileSettings");
const Sale = require("../models/sale");
const SalePayment = require("../models/salePayment");
const Order = require("../models/order");
const OrderPayment = require("../models/orderPayment");
const OrderSequence = require("../models/orderSequence");
const ReceiptSequence = require("../models/receiptSequence");
const {
  allocateCreditPaymentReceiptNumber,
} = require("../lib/creditPaymentReceipt");
const audit = require("../lib/audit");
const {
  consumeBakeryOrderReservations,
  orderFullyReserved,
  releaseBakeryOrderReservations,
  reserveBakeryStockOrder,
} = require("../lib/finishedStockLotOrders");
const { enqueueOrderNotification } = require("../lib/orderNotifications");
const {
  decodeKeysetCursor,
  encodeKeysetCursor,
} = require("../lib/keysetCursor");

const ORDER_ROLES = ["Sales Manager", "General Manager", "Super Admin"];
const MAX_PAGE_SIZE = 200;
const ORDER_FIELDS = [
  "customerId",
  "items",
  "requestedDate",
  "fulfillmentMode",
  "fulfilmentMethod",
  "destination",
  "paymentTerms",
  "dueDate",
  "priority",
  "priorityReason",
  "notes",
  "idempotencyKey",
];

const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
};
const objectId = (value) =>
  typeof value === "string" && mongoose.isValidObjectId(value);
const actorId = (request) => request.authUser._id;
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const invalid = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });
const serialize = (document) => {
  if (!document) return document;
  const result = document.toJSON ? document.toJSON() : { ...document };
  const id = result.id ?? result._id ?? document._id;
  if (id !== undefined && id !== null) result.id = String(id);
  delete result._id;
  delete result._id;
  delete result.__v;
  return result;
};

function validateOrderFields(body, partial = false) {
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !ORDER_FIELDS.includes(key))
  ) {
    return { error: "Provide order fields in the supported request shape." };
  }
  const required = [
    "customerId",
    "items",
    "requestedDate",
    "fulfilmentMethod",
    "paymentTerms",
  ];
  if (!partial && required.some((key) => body[key] === undefined)) {
    return {
      error:
        "Customer, items, requested date, fulfilment method, and payment terms are required.",
    };
  }
  if (
    body.customerId !== undefined &&
    (typeof body.customerId !== "string" ||
      !body.customerId.trim() ||
      body.customerId.length > 80)
  ) {
    return { error: "Choose an active saved customer." };
  }
  if (
    body.items !== undefined &&
    (!Array.isArray(body.items) ||
      body.items.length < 1 ||
      body.items.length > 100)
  ) {
    return { error: "An order must contain between 1 and 100 product lines." };
  }
  const items = [];
  for (const item of body.items ?? []) {
    if (
      !item ||
      typeof item !== "object" ||
      Array.isArray(item) ||
      Object.keys(item).some(
        (key) =>
          !["variantId", "packs", "pricePerPack", "overrideReason"].includes(key),
      )
    ) {
      return {
        error:
          "Each order line must contain a bakery SKU, a whole-unit quantity, and optional price override.",
      };
    }
    if (
      !objectId(item.variantId)
    ) {
      return { error: "Choose a valid bakery SKU for every line." };
    }
    const packs = Number(item.packs);
    if (!Number.isInteger(packs) || packs < 1)
      return { error: "Pack quantity must be a positive whole number." };
    const line = {
      variantId: String(new mongoose.Types.ObjectId(item.variantId)),
      packs,
    };
    if (item.pricePerPack !== undefined) {
      const pricePerPack = Number(item.pricePerPack);
      if (!Number.isInteger(pricePerPack) || pricePerPack < 1)
        return {
          error: "Price overrides must be positive whole UGX per pack.",
        };
      if (
        typeof item.overrideReason !== "string" ||
        !item.overrideReason.trim() ||
        item.overrideReason.length > 500
      ) {
        return {
          error:
            "A reason of 500 characters or fewer is required for each price override.",
        };
      }
      line.pricePerPack = pricePerPack;
      line.overrideReason = item.overrideReason.trim();
    } else if (item.overrideReason !== undefined) {
      return { error: "A price override reason requires an overridden price." };
    }
    items.push(line);
  }
  if (body.items !== undefined) {
  }
  if (
    body.fulfillmentMode !== undefined &&
    !["bakery_stock", "preorder"].includes(body.fulfillmentMode)
  ) {
    return { error: "Choose bakery stock or preorder fulfillment." };
  }
  if (body.requestedDate !== undefined && !validDate(body.requestedDate))
    return { error: "Requested date must be a valid YYYY-MM-DD date." };
  if (body.requestedDate !== undefined && body.requestedDate < today())
    return { error: "Requested date cannot be in the past." };
  if (
    body.fulfilmentMethod !== undefined &&
    !["Delivery", "Pickup"].includes(body.fulfilmentMethod)
  )
    return { error: "Choose Delivery or Pickup." };
  if (
    body.paymentTerms !== undefined &&
    !["Paid now", "Same-day", "Credit"].includes(body.paymentTerms)
  )
    return { error: "Choose valid payment terms." };
  if (body.paymentTerms === "Credit" && !validDate(body.dueDate))
    return { error: "Credit orders require a valid due date." };
  if (
    body.paymentTerms &&
    body.paymentTerms !== "Credit" &&
    body.dueDate !== undefined
  )
    return { error: "A due date is only valid for credit terms." };
  if (
    body.priority !== undefined &&
    !["Normal", "High"].includes(body.priority)
  )
    return { error: "Choose Normal or High priority." };
  if (
    body.priority === "High" &&
    (typeof body.priorityReason !== "string" || !body.priorityReason.trim())
  )
    return { error: "A reason is required for high-priority orders." };
  for (const [field, max] of [
    ["destination", 500],
    ["priorityReason", 500],
    ["notes", 2000],
  ]) {
    if (
      body[field] !== undefined &&
      (typeof body[field] !== "string" || body[field].length > max)
    ) {
      return { error: `${field} must be text of ${max} characters or fewer.` };
    }
  }
  if (
    body.idempotencyKey !== undefined &&
    (typeof body.idempotencyKey !== "string" ||
      !body.idempotencyKey.trim() ||
      body.idempotencyKey.length > 120)
  ) {
    return { error: "A valid idempotencyKey is required." };
  }
  return {
    value: { ...body, ...(body.items === undefined ? {} : { items }) },
  };
}

async function resolveOrderData(input, request, session) {
  const customer = await Customer.findOne({
    id: input.customerId,
    status: "Active",
    archivedAt: null,
  })
    .session(session)
    .lean();
  if (!customer)
    throw invalid(
      "The selected customer is missing, inactive, or archived.",
      409,
    );
  if (input.paymentTerms === "Credit" && !input.dueDate)
    throw invalid("Credit orders require a due date.");
  const fulfillmentMode = input.fulfillmentMode || "bakery_stock";
  const variantMap = new Map();
  for (const item of input.items) {
    if (!variantMap.has(item.variantId)) {
      const variant = await BakeryProductVariant.findOne({
          _id: item.variantId,
          active: true,
        })
          .session(session)
          .lean();
        const family = variant
          ? await BakeryProductFamily.findOne({ _id: variant.familyId, active: true })
              .session(session)
              .lean()
          : null;
        if (!variant || !family) {
          throw invalid("A selected bakery SKU or product family is missing or inactive.", 409);
        }
        if (
          !Number.isInteger(variant.unitsPerSaleUnit) ||
          variant.unitsPerSaleUnit < 1 ||
          !Number.isInteger(variant.price) ||
          variant.price < 1
        ) {
          throw invalid(`${variant.name} needs valid sale-unit details and a catalog price before it can be ordered.`, 409);
        }
      variantMap.set(item.variantId, variant);
    }
    if (
      item.pricePerPack !== undefined &&
      !ORDER_ROLES.some((role) => request.authUser.roles?.includes(role))
    ) {
      throw invalid(
        "You do not have permission to override catalog prices.",
        403,
      );
    }
  }
  const lines = input.items.map((item) => {
    const product = variantMap.get(item.variantId);
    const pricePerPack = item.pricePerPack ?? product.price;
    const unitsPerSaleUnit = product.unitsPerSaleUnit;
    const quantityPieces = item.packs * unitsPerSaleUnit;
    const lineTotal = item.packs * pricePerPack;
    if (
      !Number.isSafeInteger(quantityPieces) ||
      !Number.isSafeInteger(lineTotal) ||
      lineTotal < 1
    ) {
      throw invalid("Order quantities or totals exceed supported values.");
    }
    return {
      lineId: new mongoose.Types.ObjectId(),
      variantId: product._id,
      productCode: product.sku,
      sku: product.sku,
      productName: product.name,
      saleUnit: product.saleUnit,
      unitsPerSaleUnit: product.unitsPerSaleUnit,
      packs: item.packs,
      quantityPieces,
      catalogPricePerPack: product.price,
      pricePerPack,
      overrideReason: item.overrideReason ?? "",
      lineTotal,
    };
  });
  const total = lines.reduce((sum, line) => sum + line.lineTotal, 0);
  if (!Number.isSafeInteger(total) || total < 1)
    throw invalid("Order total exceeds supported values.");
  return {
    customer: {
      name: customer.name,
      contact: customer.contact || "",
      phone: customer.phone || "",
      email: customer.email || "",
      address: [customer.district, customer.region, customer.country]
        .filter(Boolean)
        .join(", "),
      tin: customer.tin || "",
    },
    lines,
    total,
    fulfillmentMode,
  };
}

async function listOrders(request, response) {
  if (request.query.cursor && request.query.page !== undefined) {
    return response
      .status(400)
      .json({ error: "Use either cursor or page pagination, not both." });
  }
  const limit = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Number.parseInt(request.query.limit, 10) || 50),
  );
  const legacyPage = request.query.cursor
    ? null
    : Number.parseInt(request.query.page, 10) || null;
  if (legacyPage !== null && (legacyPage < 1 || legacyPage > 1000)) {
    return response
      .status(400)
      .json({
        error: "Legacy page offset is too large; use cursor pagination.",
      });
  }
  const filter = {};
  if (request.query.status) filter.status = request.query.status;
  if (request.query.customerId) filter.customerId = request.query.customerId;
  if (request.query.archived === "true") filter.archivedAt = { $ne: null };
  else if (request.query.archived === "false") filter.archivedAt = null;
  const cursor = request.query.cursor
    ? decodeKeysetCursor(request.query.cursor)
    : null;
  if (request.query.cursor && !cursor)
    return response.status(400).json({ error: "Order cursor is invalid." });
  if (cursor) {
    filter.$or = [
      { createdAt: { $lt: cursor.createdAt } },
      { createdAt: cursor.createdAt, _id: { $lt: cursor.id } },
    ];
  }
  let query = Order.find(filter).sort({ createdAt: -1, _id: -1 });
  if (legacyPage !== null) query = query.skip((legacyPage - 1) * limit);
  const records = await query.limit(limit + 1).lean();
  const hasMore = records.length > limit;
  const orders = records.slice(0, limit);
  if (legacyPage !== null) {
    const total = await Order.countDocuments(filter);
    return response.json({
      orders: orders.map(serialize),
      page: legacyPage,
      limit,
      total,
    });
  }
  return response.json({
    orders: orders.map(serialize),
    limit,
    nextCursor: hasMore ? encodeKeysetCursor(orders[orders.length - 1]) : null,
  });
}

async function listPreorderDemand(_request, response) {
  const orders = await Order.find({
    fulfillmentMode: "preorder",
    status: { $in: ["Confirmed", "In progress"] },
    archivedAt: null,
  })
    .sort({ promisedDate: 1, createdAt: 1, _id: 1 })
    .limit(500)
    .lean();
  if (!orders.length) return response.json({ demands: [] });
  const allocations = await FinishedStockLotAllocation.find({
    orderId: { $in: orders.map((order) => order._id) },
    status: "reserved",
  })
    .lean();
  const quantityByLine = new Map();
  for (const allocation of allocations) {
    const key = `${String(allocation.orderId)}:${String(allocation.orderLineId)}`;
    quantityByLine.set(key, (quantityByLine.get(key) || 0) + allocation.quantity);
  }
  const demands = orders
    .map((order) => {
      const items = order.items
        .map((item) => {
          const reservedQuantity =
            quantityByLine.get(`${String(order._id)}:${String(item.lineId)}`) || 0;
          return {
            ...item,
            reservedQuantity,
            outstandingQuantity: Math.max(0, item.packs - reservedQuantity),
          };
        })
        .filter((item) => item.outstandingQuantity > 0);
      return items.length ? { ...serialize(order), items } : null;
    })
    .filter(Boolean);
  return response.json({ demands });
}

async function listBakeryOrderCatalog(_request, response) {
  const families = await BakeryProductFamily.find({ active: true })
    .select("_id name")
    .lean();
  if (!families.length) return response.json({ products: [] });
  const familyById = new Map(families.map((family) => [String(family._id), family]));
  const variants = await BakeryProductVariant.find({
    familyId: { $in: families.map((family) => family._id) },
    active: true,
  })
    .sort({ sku: 1, _id: 1 })
    .lean();
  if (!variants.length) return response.json({ products: [] });
  const availability = await FinishedStockLot.aggregate([
    {
      $match: {
        variantId: { $in: variants.map((variant) => variant._id) },
        status: "active",
        expiryDate: { $gte: today() },
      },
    },
    {
      $project: {
        variantId: 1,
        available: { $subtract: ["$remainingQuantity", "$reservedQuantity"] },
      },
    },
    { $group: { _id: "$variantId", availableQuantity: { $sum: "$available" } } },
  ]);
  const quantityByVariant = new Map(
    availability.map((record) => [String(record._id), record.availableQuantity]),
  );
  return response.json({
    products: variants.map((variant) => ({
      id: String(variant._id),
      familyId: String(variant.familyId),
      familyName: familyById.get(String(variant.familyId))?.name || "",
      sku: variant.sku,
      name: variant.name,
      saleUnit: variant.saleUnit,
      unitsPerSaleUnit: variant.unitsPerSaleUnit,
      price: variant.price,
      availableQuantity: Math.max(0, quantityByVariant.get(String(variant._id)) || 0),
    })),
  });
}

async function getOrder(request, response) {
  if (!objectId(request.params.id))
    return response.status(400).json({ error: "Order ID is invalid." });
  const order = await Order.findById(request.params.id).lean();
  if (!order) return response.status(404).json({ error: "Order not found." });
  const payments = await OrderPayment.find({ orderId: order._id })
    .sort({ date: 1, _id: 1 })
    .lean();
  return response.json({
    order: serialize(order),
    payments: payments.map(serialize),
  });
}

async function createOrder(request, response) {
  const { value, error } = validateOrderFields(request.body);
  if (error) return response.status(400).json({ error });
  if (!value.idempotencyKey)
    return response
      .status(400)
      .json({ error: "A valid idempotencyKey is required." });
  try {
    const result = await mongoose.connection.transaction(async (session) => {
      const requestHash = createHash("sha256")
        .update(JSON.stringify(value))
        .digest("hex");
      const replay = await Order.findOne({
        idempotencyKey: value.idempotencyKey,
      }).session(session);
      if (replay) {
        if (replay.requestHash !== requestHash)
          throw invalid(
            "This retry key was already used with different order details.",
            409,
          );
        return { order: serialize(replay), replayed: true };
      }
      const resolved = await resolveOrderData(value, request, session);
      const date = today();
      const year = Number(date.slice(0, 4));
      const counter = await OrderSequence.findOneAndUpdate(
        { _id: year },
        { $inc: { sequence: 1 }, $setOnInsert: { _id: year } },
        { new: true, upsert: true, session, setDefaultsOnInsert: true },
      );
      const orderNumber = `ORD-${year}-${String(counter.sequence).padStart(6, "0")}`;
      const [order] = await Order.create(
        [
          {
            orderNumber,
            orderYear: year,
            orderSequence: counter.sequence,
            customerId: value.customerId,
            customer: resolved.customer,
            items: resolved.lines,
            total: resolved.total,
            fulfillmentMode: resolved.fulfillmentMode,
            date,
            requestedDate: value.requestedDate,
            fulfilmentMethod: value.fulfilmentMethod,
            destination: value.destination?.trim() || "",
            paymentTerms: value.paymentTerms,
            dueDate: value.dueDate,
            priority: value.priority || "Normal",
            priorityReason: value.priorityReason?.trim() || "",
            notes: value.notes?.trim() || "",
            statusHistory: [
              {
                type: "created",
                toStatus: "Pending",
                at: new Date(),
                actor: actorId(request),
              },
            ],
            actor: actorId(request),
            updatedBy: actorId(request),
            idempotencyKey: value.idempotencyKey,
            requestHash,
          },
        ],
        { session },
      );
      await audit.recordAudit({
        request,
        eventType: "order.created",
        outcome: "success",
        details: {
          orderId: String(order._id),
          orderNumber,
          customerId: order.customerId,
          total: order.total,
          fulfillmentMode: order.fulfillmentMode,
        },
        transaction: session,
      });
      if (order.fulfillmentMode === "preorder") {
        await enqueueOrderNotification({
          event: "preorder_review",
          order,
          actorId: actorId(request),
          session,
        });
      }
      return { order: serialize(order), replayed: false };
    });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return nextError(error, response);
  }
}

async function updateOrder(request, response) {
  if (!objectId(request.params.id))
    return response.status(400).json({ error: "Order ID is invalid." });
  const { value, error } = validateOrderFields(request.body, true);
  if (error) return response.status(400).json({ error });
  try {
    const result = await mongoose.connection.transaction(async (session) => {
      const order = await Order.findById(request.params.id).session(session);
      if (!order) throw invalid("Order not found.", 404);
      if (order.status !== "Pending" || order.reserved)
        throw invalid("Only pending, unreserved orders can be edited.", 409);
      const merged = { ...order.toObject(), ...value };
      const resolved = await resolveOrderData(merged, request, session);
      if (order.paidAmount > resolved.total)
        throw invalid(
          "The updated order total cannot be lower than payments already recorded.",
          409,
        );
      const previousStatus = order.status;
      Object.assign(order, {
        customerId: merged.customerId,
        customer: resolved.customer,
        items: resolved.lines,
        total: resolved.total,
        fulfillmentMode: resolved.fulfillmentMode,
        requestedDate: merged.requestedDate,
        fulfilmentMethod: merged.fulfilmentMethod,
        destination: merged.destination?.trim() || "",
        paymentTerms: merged.paymentTerms,
        dueDate: merged.paymentTerms === "Credit" ? merged.dueDate : undefined,
        priority: merged.priority || "Normal",
        priorityReason: merged.priorityReason?.trim() || "",
        notes: merged.notes?.trim() || "",
        updatedBy: actorId(request),
      });
      order.statusHistory.push({
        type: "updated",
        fromStatus: previousStatus,
        toStatus: previousStatus,
        at: new Date(),
        actor: actorId(request),
      });
      await order.save({ session });
      await audit.recordAudit({
        request,
        eventType: "order.updated",
        outcome: "success",
        details: { orderId: String(order._id), orderNumber: order.orderNumber },
        transaction: session,
      });
      return serialize(order);
    });
    return response.json({ order: result });
  } catch (error) {
    return nextError(error, response);
  }
}

async function confirmOrder(request, response) {
  if (!objectId(request.params.id))
    return response.status(400).json({ error: "Order ID is invalid." });
  const body = request.body ?? {};
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !["promisedDate", "capacityReviewNote"].includes(key)) ||
    (body.promisedDate !== undefined &&
      (!validDate(body.promisedDate) || body.promisedDate < today())) ||
    (body.capacityReviewNote !== undefined &&
      (typeof body.capacityReviewNote !== "string" || body.capacityReviewNote.length > 500))
  ) {
    return response.status(400).json({
      error: "Provide a valid promisedDate and capacity review note.",
    });
  }
  try {
    const order = await mongoose.connection.transaction(async (session) => {
      const current = await Order.findById(request.params.id).session(session);
      if (!current) throw invalid("Order not found.", 404);
      if (current.status !== "Pending")
        throw invalid("Only a new pending order can be confirmed.", 409);
      if (current.fulfillmentMode === "preorder") {
        if (!body.promisedDate) {
          throw invalid("A preorder requires a staff-approved promised date.");
        }
        if (!body.capacityReviewNote?.trim()) {
          throw invalid("Record how the production plan was reviewed before confirming this preorder.");
        }
        current.promisedDate = body.promisedDate;
      } else {
        current.promisedDate = body.promisedDate || current.requestedDate;
        await reserveBakeryStockOrder(current, actorId(request), session);
        current.reserved = true;
      }
      current.status = "Confirmed";
      current.updatedBy = actorId(request);
      current.statusHistory.push({
        type: "confirmed",
        fromStatus: "Pending",
        toStatus: "Confirmed",
        at: new Date(),
        actor: actorId(request),
        reason: body.capacityReviewNote?.trim() || "",
      });
      await current.save({ session });
      await audit.recordAudit({
        request,
        eventType: "order.confirmed",
        outcome: "success",
        details: {
          orderId: String(current._id),
          orderNumber: current.orderNumber,
          fulfillmentMode: current.fulfillmentMode,
          promisedDate: current.promisedDate,
          reservationCreated: current.reserved,
        },
        transaction: session,
      });
      if (current.fulfillmentMode === "preorder") {
        await audit.recordAudit({
          request,
          eventType: "order.preorder_promised",
          outcome: "success",
          details: {
            orderId: String(current._id),
            orderNumber: current.orderNumber,
            requestedDate: current.requestedDate,
            promisedDate: current.promisedDate,
            capacityReviewNote: body.capacityReviewNote.trim(),
          },
          transaction: session,
        });
        await enqueueOrderNotification({
          event: "preorder_confirmed",
          order: current,
          actorId: actorId(request),
          session,
        });
      }
      return serialize(current);
    });
    return response.json({ order });
  } catch (error) {
    return nextError(error, response);
  }
}

async function changeOrderStatus(request, response) {
  if (!objectId(request.params.id))
    return response.status(400).json({ error: "Order ID is invalid." });
  const { status, reason = "" } = request.body ?? {};
  if (
    !["In progress", "Ready", "Cancelled"].includes(status) ||
    typeof reason !== "string" ||
    reason.length > 500
  ) {
    return response
      .status(400)
      .json({
        error:
          "Provide a supported status and a reason of 500 characters or fewer.",
      });
  }
  try {
    const order = await mongoose.connection.transaction(async (session) => {
      const current = await Order.findById(request.params.id).session(session);
      if (!current) throw invalid("Order not found.", 404);
      const allowed =
        (current.status === "Confirmed" && status === "In progress") ||
        (current.status === "In progress" && status === "Ready") ||
        (["Pending", "Confirmed", "In progress", "Ready"].includes(
          current.status,
        ) &&
          status === "Cancelled");
      if (
        !allowed ||
        (current.status === "Ready" && status === "Cancelled" && !reason.trim())
      ) {
        throw invalid(
          "This order cannot transition to the requested status.",
          409,
        );
      }
      if (status === "Ready") {
        if (!(await orderFullyReserved(current, session))) {
          throw invalid(
            "The order cannot be marked Ready until every line is allocated to eligible bakery lots.",
            409,
          );
        }
        current.reserved = true;
      }
      if (status === "Cancelled") {
        await releaseBakeryOrderReservations(current, actorId(request), session);
      }
      const previous = current.status;
      current.status = status;
      current.updatedBy = actorId(request);
      current.statusHistory.push({
        type: status === "Cancelled" ? "cancelled" : "status_changed",
        fromStatus: previous,
        toStatus: status,
        at: new Date(),
        actor: actorId(request),
        reason: reason.trim(),
      });
      await current.save({ session });
      const eventType =
        status === "Cancelled" ? "order.cancelled" : "order.status_changed";
      await audit.recordAudit({
        request,
        eventType,
        outcome: "success",
        details: {
          orderId: String(current._id),
          orderNumber: current.orderNumber,
          fromStatus: previous,
          toStatus: status,
          reservationReleased: status === "Cancelled",
        },
        transaction: session,
      });
      if (status === "Cancelled" && current.fulfillmentMode === "preorder") {
        await enqueueOrderNotification({
          event: "preorder_cancelled",
          order: current,
          actorId: actorId(request),
          session,
        });
      }
      return serialize(current);
    });
    return response.json({ order });
  } catch (error) {
    return nextError(error, response);
  }
}

async function recordOrderPayment(request, response) {
  if (!objectId(request.params.id))
    return response.status(400).json({ error: "Order ID is invalid." });
  const body = request.body;
  const allowed = [
    "amount",
    "date",
    "method",
    "txnID",
    "note",
    "idempotencyKey",
  ];
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key)) ||
    !Number.isSafeInteger(Number(body.amount)) ||
    Number(body.amount) <= 0 ||
    !validDate(body.date) ||
    !SalePayment.METHODS.includes(body.method) ||
    typeof body.idempotencyKey !== "string" ||
    !body.idempotencyKey.trim() ||
    body.idempotencyKey.length > 120 ||
    (body.txnID !== undefined &&
      (typeof body.txnID !== "string" || body.txnID.length > 120)) ||
    (body.note !== undefined &&
      (typeof body.note !== "string" || body.note.length > 500))
  ) {
    return response
      .status(400)
      .json({
        error:
          "Provide a valid positive whole-UGX payment, date, method, and idempotency key.",
      });
  }
  try {
    const result = await mongoose.connection.transaction(async (session) => {
      const replay = await OrderPayment.findOne({
        idempotencyKey: body.idempotencyKey.trim(),
      }).session(session);
      if (replay) {
        if (String(replay.orderId) !== request.params.id)
          throw invalid("This idempotency key belongs to another order.", 409);
        const payments = await OrderPayment.find({ orderId: replay.orderId })
          .sort({ date: 1, _id: 1 })
          .session(session)
          .lean();
        return {
          payment: serialize(replay),
          payments: payments.map(serialize),
          replayed: true,
        };
      }
      const order = await Order.findById(request.params.id).session(session);
      if (!order) throw invalid("Order not found.", 404);
      if (["Cancelled", "Completed"].includes(order.status))
        throw invalid(
          "Payments cannot be added to cancelled or fulfilled orders.",
          409,
        );
      if (Number(body.amount) > order.total - order.paidAmount)
        throw invalid(
          "Payment cannot exceed the remaining order balance.",
          409,
        );
      order.paidAmount += Number(body.amount);
      order.updatedBy = actorId(request);
      order.statusHistory.push({
        type: "payment_recorded",
        fromStatus: order.status,
        toStatus: order.status,
        at: new Date(),
        actor: actorId(request),
        details: { amount: Number(body.amount) },
      });
      const [payment] = await OrderPayment.create(
        [
          {
            orderId: order._id,
            amount: Number(body.amount),
            date: body.date,
            method: body.method,
            txnID: body.txnID?.trim() || "",
            note: body.note?.trim() || "",
            idempotencyKey: body.idempotencyKey.trim(),
            actor: actorId(request),
          },
        ],
        { session },
      );
      await order.save({ session });
      await audit.recordAudit({
        request,
        eventType: "order.payment_recorded",
        outcome: "success",
        details: {
          orderId: String(order._id),
          orderNumber: order.orderNumber,
          paymentId: String(payment._id),
          amount: payment.amount,
        },
        transaction: session,
      });
      const payments = await OrderPayment.find({ orderId: order._id })
        .sort({ date: 1, _id: 1 })
        .session(session)
        .lean();
      return {
        payment: serialize(payment),
        payments: payments.map(serialize),
        replayed: false,
      };
    });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return nextError(error, response);
  }
}

function companySnapshot(profile) {
  return {
    name: profile?.tradingName || profile?.legalName || "",
    email: profile?.email || "",
    phone: profile?.phone || "",
    address: [
      profile?.addressLine1,
      profile?.addressLine2,
      profile?.city,
      profile?.region,
      profile?.postalCode,
      profile?.country,
    ]
      .filter(Boolean)
      .join(", "),
    logoUrl: profile?.logo?.url || "",
  };
}

async function fulfillOrder(request, response) {
  if (!objectId(request.params.id))
    return response.status(400).json({ error: "Order ID is invalid." });
  try {
    const result = await mongoose.connection.transaction(async (session) => {
      const order = await Order.findById(request.params.id).session(session);
      if (!order) throw invalid("Order not found.", 404);
      if (order.saleId) {
        const sale = await Sale.findById(order.saleId).session(session);
        return {
          order: serialize(order),
          sale: serialize(sale),
          replayed: true,
        };
      }
      if (order.status !== "Ready" || !order.reserved) {
        throw invalid(
          "Only a confirmed, reserved order marked Ready can be fulfilled.",
          409,
        );
      }
      const payments = await OrderPayment.find({ orderId: order._id })
        .sort({ date: 1, _id: 1 })
        .session(session)
        .lean();
      const paidAmount = payments.reduce(
        (sum, payment) => sum + payment.amount,
        0,
      );
      if (paidAmount !== order.paidAmount || paidAmount > order.total)
        throw invalid(
          "Order payment history does not match its recorded balance.",
          409,
        );
      if (order.paymentTerms === "Paid now" && paidAmount !== order.total)
        throw invalid(
          "Paid-now orders must be fully paid before fulfillment.",
          409,
        );
      if (!(await orderFullyReserved(order, session))) {
        throw invalid("The order is not fully allocated to eligible bakery lots.", 409);
      }

      const date = today();
      const year = Number(date.slice(0, 4));
      const counter = await ReceiptSequence.findOneAndUpdate(
        { _id: year },
        { $inc: { sequence: 1 }, $setOnInsert: { _id: year } },
        { new: true, upsert: true, session, setDefaultsOnInsert: true },
      );
      const receiptNumber = `SAL-${year}-${String(counter.sequence).padStart(6, "0")}`;
      const profile = await ProfileSettings.findById("global")
        .session(session)
        .lean();
      const saleLines = order.items.map((item) => ({
        variantId: item.variantId,
        productCode: item.productCode,
        sku: item.sku || "",
        productName: item.productName,
        saleUnit: item.saleUnit || "",
        unitsPerSaleUnit: item.unitsPerSaleUnit || undefined,
        packs: item.packs,
        bonusPacks: 0,
        totalStockPacks: item.packs,
        quantityPieces: item.quantityPieces,
        catalogPricePerPack: item.catalogPricePerPack,
        pricePerPack: item.pricePerPack,
        overrideReason: item.overrideReason,
        lineTotal: item.lineTotal,
      }));
      const [sale] = await Sale.create(
        [
          {
            receiptNumber,
            receiptYear: year,
            receiptSequence: counter.sequence,
            orderId: order._id,
            customerId: order.customerId,
            customer: order.customer,
            company: companySnapshot(profile),
            date,
            lines: saleLines,
            total: order.total,
            paidAmount,
            paymentTerms: order.paymentTerms,
            dueDate: order.dueDate,
            actor: actorId(request),
          },
        ],
        { session },
      );
      await consumeBakeryOrderReservations(
        order,
        actorId(request),
        date,
        receiptNumber,
        session,
      );
      for (const payment of payments) {
        const [salePayment] = await SalePayment.create(
          [
            {
              saleId: sale._id,
              orderPaymentId: payment._id,
              paymentReceiptNumber:
                sale.paymentTerms === "Credit"
                  ? await allocateCreditPaymentReceiptNumber(
                      payment.date,
                      session,
                    )
                  : undefined,
              amount: payment.amount,
              date: payment.date,
              method: payment.method,
              txnID: payment.txnID,
              note:
                payment.note || `Transferred from order ${order.orderNumber}.`,
              idempotencyKey: `order-payment-${payment._id}`,
              actor: payment.actor,
            },
          ],
          { session },
        );
        payment.salePaymentId = salePayment._id;
        await OrderPayment.updateOne(
          { _id: payment._id },
          { $set: { salePaymentId: salePayment._id } },
          { session },
        );
      }
      order.reserved = false;
      order.status = "Completed";
      order.completedAt = new Date();
      order.saleId = sale._id;
      order.updatedBy = actorId(request);
      order.statusHistory.push({
        type: "fulfilled",
        fromStatus: "Ready",
        toStatus: "Completed",
        at: new Date(),
        actor: actorId(request),
        details: { saleId: String(sale._id), receiptNumber },
      });
      await order.save({ session });
      await audit.recordAudit({
        request,
        eventType: "sale.created",
        outcome: "success",
        details: {
          saleId: String(sale._id),
          receiptNumber,
          orderId: String(order._id),
          orderNumber: order.orderNumber,
          total: order.total,
          stockDispatchPosted: true,
        },
        transaction: session,
      });
      await audit.recordAudit({
        request,
        eventType: "order.fulfilled",
        outcome: "success",
        details: {
          orderId: String(order._id),
          orderNumber: order.orderNumber,
          saleId: String(sale._id),
          receiptNumber,
        },
        transaction: session,
      });
      return {
        order: serialize(order),
        sale: serialize(sale),
        replayed: false,
      };
    });
    const payments = result.sale
      ? (
          await SalePayment.find({ saleId: result.sale.id })
            .sort({ date: 1, _id: 1 })
            .lean()
        ).map(serialize)
      : [];
    return response
      .status(result.replayed ? 200 : 201)
      .json({ ...result, payments });
  } catch (error) {
    return nextError(error, response);
  }
}

async function archiveOrder(request, response) {
  return setArchived(request, response, true);
}
async function restoreOrder(request, response) {
  return setArchived(request, response, false);
}
async function setArchived(request, response, archived) {
  if (!objectId(request.params.id))
    return response.status(400).json({ error: "Order ID is invalid." });
  try {
    const order = await mongoose.connection.transaction(async (session) => {
      const current = await Order.findById(request.params.id).session(session);
      if (!current) throw invalid("Order not found.", 404);
      if (archived && !["Completed", "Cancelled"].includes(current.status))
        throw invalid(
          "Only completed or cancelled orders can be archived.",
          409,
        );
      current.archivedAt = archived ? new Date() : null;
      current.updatedBy = actorId(request);
      current.statusHistory.push({
        type: archived ? "archived" : "restored",
        fromStatus: current.status,
        toStatus: current.status,
        at: new Date(),
        actor: actorId(request),
      });
      await current.save({ session });
      await audit.recordAudit({
        request,
        eventType: archived ? "order.archived" : "order.restored",
        outcome: "success",
        details: {
          orderId: String(current._id),
          orderNumber: current.orderNumber,
        },
        transaction: session,
      });
      return serialize(current);
    });
    return response.json({ order });
  } catch (error) {
    return nextError(error, response);
  }
}

function nextError(error, response) {
  if (error?.statusCode)
    return response.status(error.statusCode).json({ error: error.message });
  if (error?.code === 11000)
    return response
      .status(409)
      .json({
        error:
          "An order reference, receipt, or request key already exists. Retry using the same idempotency key.",
      });
  if (error?.name === "ValidationError" || error?.name === "CastError")
    return response.status(400).json({ error: error.message });
  throw error;
}

module.exports = {
  archiveOrder,
  changeOrderStatus,
  confirmOrder,
  createOrder,
  fulfillOrder,
  getOrder,
  listOrders,
  listPreorderDemand,
  listBakeryOrderCatalog,
  recordOrderPayment,
  restoreOrder,
  serialize,
  updateOrder,
  validateOrderFields,
};
