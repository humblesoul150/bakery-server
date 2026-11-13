const FinishedStockLot = require("../models/finishedStockLot");
const FinishedStockLotAllocation = require("../models/finishedStockLotAllocation");
const FinishedStockLotMovement = require("../models/finishedStockLotMovement");
const Order = require("../models/order");
const audit = require("./audit");
const { enqueueOrderNotification } = require("./orderNotifications");

const conflict = (message) => Object.assign(new Error(message), { statusCode: 409 });

function fulfillmentDate(order) {
  return order.promisedDate || order.requestedDate;
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function reserveQuantity({ lot, order, line, quantity, allocationType, actorId, session }) {
  if (quantity < 1) return 0;
  const updatedLot = await FinishedStockLot.findOneAndUpdate(
    {
      _id: lot._id,
      status: "active",
      expiryDate: { $gte: fulfillmentDate(order) },
      $expr: {
        $gte: [
          { $subtract: ["$remainingQuantity", "$reservedQuantity"] },
          quantity,
        ],
      },
    },
    { $inc: { reservedQuantity: quantity } },
    { new: true, session },
  );
  if (!updatedLot) return 0;
  await FinishedStockLotAllocation.create(
    [
      {
        lotId: lot._id,
        variantId: line.variantId,
        orderId: order._id,
        orderLineId: line.lineId,
        allocationType,
        quantity,
        status: "reserved",
        idempotencyKey: `${allocationType}:${String(lot._id)}:${String(order._id)}:${String(line.lineId)}`,
        actor: actorId,
      },
    ],
    { session },
  );
  lot.reservedQuantity = updatedLot.reservedQuantity;
  return quantity;
}

async function reservedQuantityForLine(orderId, lineId, session) {
  const allocations = await FinishedStockLotAllocation.find({
    orderId,
    orderLineId: lineId,
    status: "reserved",
  })
    .session(session)
    .lean();
  return allocations.reduce((total, allocation) => total + allocation.quantity, 0);
}

async function orderFullyReserved(order, session) {
  const allocations = await FinishedStockLotAllocation.find({
    orderId: order._id,
    status: "reserved",
  })
    .session(session)
    .lean();
  const minimumExpiryDate = [fulfillmentDate(order), today()].sort().pop();
  for (const line of order.items) {
    if (!line.variantId || !line.lineId) return false;
    const lineAllocations = allocations.filter(
      (allocation) => String(allocation.orderLineId) === String(line.lineId),
    );
    if (
      lineAllocations.reduce((total, allocation) => total + allocation.quantity, 0) !==
      line.packs
    ) {
      return false;
    }
    for (const allocation of lineAllocations) {
      const lot = await FinishedStockLot.findById(allocation.lotId)
        .session(session)
        .lean();
      if (
        !lot ||
        lot.status !== "active" ||
        lot.expiryDate < minimumExpiryDate ||
        lot.remainingQuantity < allocation.quantity ||
        lot.reservedQuantity < allocation.quantity
      ) {
        return false;
      }
    }
  }
  return allocations.every((allocation) =>
    order.items.some(
      (line) => String(line.lineId) === String(allocation.orderLineId),
    ),
  );
}

async function reserveBakeryStockOrder(order, actorId, session) {
  if (!order.items.length || order.items.some((line) => !line.variantId || !line.lineId)) {
    throw conflict("Only complete bakery SKU orders can reserve bakery finished stock.");
  }
  const date = fulfillmentDate(order);
  for (const line of order.items) {
    const lots = await FinishedStockLot.find({
      variantId: line.variantId,
      status: "active",
      expiryDate: { $gte: date },
      $expr: { $gt: ["$remainingQuantity", "$reservedQuantity"] },
    })
      .sort({ expiryDate: 1, productionDate: 1, createdAt: 1, _id: 1 })
      .session(session);
    let remaining = line.packs;
    for (const lot of lots) {
      const available = lot.remainingQuantity - lot.reservedQuantity;
      const quantity = Math.min(available, remaining);
      remaining -= await reserveQuantity({
        lot,
        order,
        line,
        quantity,
        allocationType: "stock_reservation",
        actorId,
        session,
      });
      if (!remaining) break;
    }
    if (remaining > 0) {
      throw conflict(
        "There is not enough eligible, unreserved bakery stock to confirm this order.",
      );
    }
  }
}

async function releaseBakeryOrderReservations(order, actorId, session) {
  const allocations = await FinishedStockLotAllocation.find({
    orderId: order._id,
    status: "reserved",
  }).session(session);
  for (const allocation of allocations) {
    const lotUpdate = await FinishedStockLot.updateOne(
      {
        _id: allocation.lotId,
        reservedQuantity: { $gte: allocation.quantity },
      },
      { $inc: { reservedQuantity: -allocation.quantity } },
      { session },
    );
    if (!lotUpdate.modifiedCount) {
      throw conflict("The bakery lot reservation is inconsistent; contact an administrator.");
    }
    allocation.status = "released";
    allocation.releasedBy = actorId;
    allocation.releasedAt = new Date();
    await allocation.save({ session });
  }
  order.reserved = false;
}

async function consumeBakeryOrderReservations(order, actorId, date, receiptNumber, session) {
  const allocations = await FinishedStockLotAllocation.find({
    orderId: order._id,
    status: "reserved",
  }).session(session);
  if (!(await orderFullyReserved(order, session))) {
    throw conflict("The order is not fully allocated to finished-stock lots.");
  }
  const totalByLine = new Map();
  for (const allocation of allocations) {
    const lot = await FinishedStockLot.findById(allocation.lotId).session(session);
    if (
      !lot ||
      lot.status !== "active" ||
      lot.expiryDate < date ||
      lot.remainingQuantity < allocation.quantity ||
      lot.reservedQuantity < allocation.quantity
    ) {
      throw conflict("A reserved bakery lot is no longer eligible for fulfillment.");
    }
    lot.remainingQuantity -= allocation.quantity;
    lot.reservedQuantity -= allocation.quantity;
    if (lot.remainingQuantity === 0) lot.status = "depleted";
    await lot.save({ session });
    await FinishedStockLotMovement.create(
      [
        {
          lotId: lot._id,
          type: "Sales dispatch",
          direction: "out",
          quantity: allocation.quantity,
          date,
          reference: receiptNumber,
          sourceType: "order",
          sourceId: order._id,
          idempotencyKey: `order-sale:${String(order._id)}:${String(allocation._id)}`,
          reason: `Fulfilled order ${order.orderNumber}`,
          actor: actorId,
        },
      ],
      { session },
    );
    allocation.status = "consumed";
    allocation.consumedBy = actorId;
    allocation.consumedAt = new Date();
    await allocation.save({ session });
    const key = String(allocation.orderLineId);
    totalByLine.set(key, (totalByLine.get(key) || 0) + allocation.quantity);
  }
  for (const line of order.items) {
    if ((totalByLine.get(String(line.lineId)) || 0) !== line.packs) {
      throw conflict("The order's reserved lot quantities do not match its line quantities.");
    }
  }
  return allocations;
}

async function allocatePreorderOutput({ lot, actorId, request, session }) {
  if (lot.expiryDate < today()) return [];
  const orders = await Order.find({
    fulfillmentMode: "preorder",
    status: { $in: ["Confirmed", "In progress"] },
    archivedAt: null,
    promisedDate: { $gte: lot.productionDate, $lte: lot.expiryDate },
    "items.variantId": lot.variantId,
  })
    .sort({ promisedDate: 1, createdAt: 1, _id: 1 })
    .session(session);
  const affected = [];
  for (const order of orders) {
    let allocated = 0;
    for (const line of order.items) {
      if (String(line.variantId) !== String(lot.variantId)) continue;
      const alreadyReserved = await reservedQuantityForLine(
        order._id,
        line.lineId,
        session,
      );
      const outstanding = Math.max(0, line.packs - alreadyReserved);
      const available = Math.max(0, lot.remainingQuantity - lot.reservedQuantity);
      const quantity = Math.min(outstanding, available);
      if (!quantity) continue;
      allocated += await reserveQuantity({
        lot,
        order,
        line,
        quantity,
        allocationType: "preorder_output",
        actorId,
        session,
      });
      if (lot.remainingQuantity === lot.reservedQuantity) break;
    }
    if (!allocated) continue;
    const previousStatus = order.status;
    const fullyReserved = await orderFullyReserved(order, session);
    order.reserved = fullyReserved;
    if (fullyReserved) order.status = "Ready";
    order.updatedBy = actorId;
    order.statusHistory.push({
      type: "production_allocated",
      fromStatus: previousStatus,
      toStatus: order.status,
      at: new Date(),
      actor: actorId,
      details: {
        lotId: String(lot._id),
        allocatedQuantity: allocated,
        fullyReserved,
      },
    });
    await order.save({ session });
    await audit.recordAudit({
      request,
      eventType: "order.production_allocated",
      outcome: "success",
      resource: {
        type: "order",
        id: String(order._id),
        reference: order.orderNumber,
      },
      details: {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        lotId: String(lot._id),
        allocatedQuantity: allocated,
        fullyReserved,
      },
      transaction: session,
    });
    if (fullyReserved) {
      await audit.recordAudit({
        request,
        eventType: "order.status_changed",
        outcome: "success",
        resource: {
          type: "order",
          id: String(order._id),
          reference: order.orderNumber,
        },
        details: {
          orderId: String(order._id),
          orderNumber: order.orderNumber,
          fromStatus: previousStatus,
          toStatus: "Ready",
        },
        transaction: session,
      });
      await enqueueOrderNotification({
        event: "preorder_ready",
        order,
        actorId,
        session,
      });
    }
    affected.push({
      orderId: String(order._id),
      orderNumber: order.orderNumber,
      allocatedQuantity: allocated,
      fullyReserved,
    });
  }
  return affected;
}

module.exports = {
  allocatePreorderOutput,
  consumeBakeryOrderReservations,
  orderFullyReserved,
  releaseBakeryOrderReservations,
  reserveBakeryStockOrder,
};
