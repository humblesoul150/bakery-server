const mongoose = require("mongoose");
const { createHash } = require("node:crypto");
const Sale = require("../models/sale");
const SalePayment = require("../models/salePayment");
const ReceiptSequence = require("../models/receiptSequence");
const { allocateCreditPaymentReceiptNumber } = require("../lib/creditPaymentReceipt");
const Customer = require("../models/customer");
const User = require("../models/user");
const ProfileSettings = require("../models/profileSettings");
const audit = require("../lib/audit");
const BakeryProductVariant = require("../models/bakeryProductVariant");
const BakeryProductFamily = require("../models/bakeryProductFamily");
const { dispatchBakerySaleLots } = require("../lib/finishedStockLotSales");

const PAYMENT_TERMS = ["Paid now", "Same-day", "Credit"];
const SALE_ROLES = ["Sales Manager", "General Manager", "Super Admin"];
const MAX_PAGE_SIZE = 200;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validObjectId(value) {
  return typeof value === "string" && mongoose.isValidObjectId(value);
}

function invalid(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateSaleInput(body) {
  const allowed = [
    "customerId",
    "guest",
    "lines",
    "paymentTerms",
    "dueDate",
    "initialPaymentAmount",
    "initialPaymentMethod",
    "initialPaymentTxnID",
    "idempotencyKey",
  ];
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))) {
    return { error: "Provide sale fields in the supported request shape." };
  }
  if (body.customerId !== undefined && body.customerId !== null &&
    (typeof body.customerId !== "string" || !body.customerId.trim() || body.customerId.length > 80)) {
    return { error: "customerId must identify an existing customer or be omitted for a guest sale." };
  }
  if (body.customerId && body.guest !== undefined) return { error: "Choose a saved customer or guest details, not both." };
  if (!Array.isArray(body.lines) || body.lines.length < 1 || body.lines.length > 100) {
    return { error: "A sale must contain between 1 and 100 product lines." };
  }
  const lines = [];
  for (const line of body.lines) {
    if (!line || typeof line !== "object" || Array.isArray(line) ||
      Object.keys(line).some((key) => !["variantId", "packs", "pricePerPack", "overrideReason"].includes(key))) {
      return { error: "Each sale line must contain a bakery variant, packs, and an optional authorized price override." };
    }
    if (!validObjectId(line.variantId)) return { error: "Choose a valid bakery variant for every sale line." };
    const packs = Number(line.packs);
    if (!Number.isInteger(packs) || packs < 1) return { error: "packs must be a positive whole number of sale units." };
    const item = {
      variantId: String(new mongoose.Types.ObjectId(line.variantId)),
      packs,
    };
    if (own(line, "pricePerPack")) {
      const pricePerPack = Number(line.pricePerPack);
      if (!Number.isInteger(pricePerPack) || pricePerPack < 1) return { error: "An overridden price must be a positive whole number of UGX per pack." };
      item.pricePerPack = pricePerPack;
    }
    if (line.overrideReason !== undefined) {
      if (typeof line.overrideReason !== "string" || line.overrideReason.trim().length > 500) {
        return { error: "Price override reason must be 500 characters or fewer." };
      }
      item.overrideReason = line.overrideReason.trim();
    }
    if (item.pricePerPack !== undefined && !item.overrideReason) {
      return { error: "A reason is required for every price override." };
    }
    if (item.pricePerPack === undefined && item.overrideReason) {
      return { error: "A price override reason can only be supplied with an overridden price." };
    }
    lines.push(item);
  }
  if (!PAYMENT_TERMS.includes(body.paymentTerms)) return { error: "Choose valid payment terms." };
  if (body.paymentTerms === "Credit" && !validDate(body.dueDate)) return { error: "Credit sales require a valid due date." };
  if (body.paymentTerms !== "Credit" && body.dueDate !== undefined) return { error: "A due date is only valid for credit sales." };
  const initialPaymentAmount = body.initialPaymentAmount === undefined ? 0 : Number(body.initialPaymentAmount);
  if (!Number.isInteger(initialPaymentAmount) || initialPaymentAmount < 0) return { error: "Initial payment must be a non-negative whole number of UGX." };
  if (initialPaymentAmount > 0 && !SalePayment.METHODS.includes(body.initialPaymentMethod)) return { error: "Choose a valid method for the initial payment." };
  if (initialPaymentAmount === 0 && body.initialPaymentMethod !== undefined && body.initialPaymentMethod !== "") return { error: "Payment method must be omitted when no initial payment is recorded." };
  if (body.initialPaymentTxnID !== undefined &&
    (typeof body.initialPaymentTxnID !== "string" || body.initialPaymentTxnID.trim().length > 120)) {
    return { error: "Payment transaction ID must be 120 characters or fewer." };
  }
  if (body.guest !== undefined) {
    if (!body.guest || typeof body.guest !== "object" || Array.isArray(body.guest) ||
      Object.keys(body.guest).some((key) => !["name", "contact", "phone", "email", "address", "tin"].includes(key))) {
      return { error: "Provide valid one-time customer details." };
    }
    const limits = { name: 180, contact: 120, phone: 40, email: 254, address: 500, tin: 80 };
    for (const [field, limit] of Object.entries(limits)) {
      const value = body.guest[field];
      if (value !== undefined && (typeof value !== "string" || value.trim().length > limit)) {
        return { error: `Guest ${field} must be ${limit} characters or fewer.` };
      }
    }
    if (body.guest.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.guest.email.trim())) {
      return { error: "Enter a valid guest email address." };
    }
  }
  if (!body.customerId && body.paymentTerms === "Credit") return { error: "Credit sales require a saved customer account." };
  if (!body.customerId && body.paymentTerms !== "Paid now") return { error: "One-time customer sales must be paid at the time of sale." };
  if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim() || body.idempotencyKey.length > 120) {
    return { error: "A valid idempotencyKey is required." };
  }
  const linesByProduct = new Map();
  for (const line of lines) {
    const key = line.variantId;
    const existing = linesByProduct.get(key);
    if (!existing) {
      linesByProduct.set(key, { ...line });
      continue;
    }
    if (existing.pricePerPack !== line.pricePerPack ||
      existing.overrideReason !== line.overrideReason) {
      return { error: "Duplicate product lines must use the same authorized price override." };
    }
    existing.packs += line.packs;
  }
  const mergedLines = [...linesByProduct.values()];
  return {
    value: {
      customerId: body.customerId || null,
      guest: body.guest,
      lines: mergedLines,
      paymentTerms: body.paymentTerms,
      dueDate: body.dueDate,
      initialPaymentAmount,
      initialPaymentMethod: body.initialPaymentMethod,
      initialPaymentTxnID: body.initialPaymentTxnID?.trim() || "",
      idempotencyKey: body.idempotencyKey.trim(),
    },
  };
}

function validatePaymentInput(body) {
  const allowed = ["amount", "date", "method", "txnID", "note", "idempotencyKey"];
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).some((key) => !allowed.includes(key))) {
    return { error: "Provide payment fields in the supported request shape." };
  }

  const amount = Number(body.amount);
  if (!Number.isInteger(amount) || amount <= 0) return { error: "Payment amount must be a positive whole number of UGX." };
  if (!validDate(body.date)) return { error: "Payment date must be a valid YYYY-MM-DD date." };
  if (!SalePayment.METHODS.includes(body.method)) return { error: "Choose a valid payment method." };
  for (const field of ["txnID", "note", "idempotencyKey"]) {
    if (body[field] !== undefined && (typeof body[field] !== "string" || body[field].length > (field === "idempotencyKey" ? 120 : 500))) {
      return { error: `${field} is too long or is not text.` };
    }
  }
  if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim()) return { error: "A valid idempotencyKey is required." };
  return {
    value: {
      amount,
      date: body.date,
      method: body.method,
      txnID: body.txnID?.trim() || "",
      note: body.note?.trim() || "",
      idempotencyKey: body.idempotencyKey.trim(),
    },
  };
}

function validateSaleTotals(value, total) {
  if (value.initialPaymentAmount > total) return "Initial payment cannot exceed the sale total.";
  if (value.paymentTerms === "Paid now" && value.initialPaymentAmount !== total) {
    return "Paid-now sales must record full payment at the time of sale.";
  }
  if (!value.customerId && value.initialPaymentAmount !== total) {
    return "One-time customer sales must be paid in full at the time of sale.";
  }
  return "";
}

function serialize(document) {
  if (!document) return document;
  if (document.toJSON) return document.toJSON();
  const result = { ...document };
  if (result._id !== undefined) {
    result.id = String(result._id);
    delete result._id;
  }
  if (result.saleId !== undefined) result.saleId = String(result.saleId);
  delete result.__v;
  return result;
}

function actorId(request) {
  return request.authUser._id;
}

function companySnapshot(profile) {
  const address = [
    profile?.addressLine1,
    profile?.addressLine2,
    profile?.city,
    profile?.region,
    profile?.postalCode,
    profile?.country,
  ].filter(Boolean).join(", ");
  return {
    name: profile?.tradingName || profile?.legalName || "",
    email: profile?.email || "",
    phone: profile?.phone || "",
    address,
    logoUrl: profile?.logo?.url || "",
  };
}

function customerSnapshot(customer) {
  const address = [customer.district, customer.region, customer.country].filter(Boolean).join(", ");
  return {
    name: customer.name,
    contact: customer.contact || "",
    phone: customer.phone || "",
    email: customer.email || "",
    address,
    tin: customer.tin || "",
  };
}

function guestSnapshot(guest = {}) {
  return {
    name: guest.name?.trim() || "Walk-in customer",
    contact: guest.contact?.trim() || "",
    phone: guest.phone?.trim() || "",
    email: guest.email?.trim().toLowerCase() || "",
    address: guest.address?.trim() || "",
    tin: guest.tin?.trim() || "",
  };
}

function getSequenceYear(date) {
  return Number(date.slice(0, 4));
}

function companyWorkDate() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function listSales(request, response) {
  const limitValue = Number(request.query.limit || 100);
  const limit = Number.isInteger(limitValue) ? Math.min(MAX_PAGE_SIZE, Math.max(1, limitValue)) : 100;
  const filter = {};
  if (request.query.paymentTerms) {
    if (!PAYMENT_TERMS.includes(request.query.paymentTerms)) {
      return response.status(400).json({ error: "Payment terms filter is invalid." });
    }
    filter.paymentTerms = request.query.paymentTerms;
  }
  if (request.query.customerId) {
    filter.customerId = String(request.query.customerId);
  }
  if (request.query.from || request.query.to) {
    if ((request.query.from && !validDate(request.query.from)) ||
      (request.query.to && !validDate(request.query.to))) {
      return response.status(400).json({ error: "Sale date filters must be valid YYYY-MM-DD dates." });
    }
    filter.date = {};
    if (request.query.from) filter.date.$gte = request.query.from;
    if (request.query.to) filter.date.$lte = request.query.to;
  }
  if (request.query.search) {
    const search = String(request.query.search).trim().slice(0, 100);
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { receiptNumber: { $regex: escaped, $options: "i" } },
      { "customer.name": { $regex: escaped, $options: "i" } },
      { "lines.productName": { $regex: escaped, $options: "i" } },
    ];
  }
  if (request.query.cursor) {
    if (!validObjectId(String(request.query.cursor))) return response.status(400).json({ error: "Sale cursor is invalid." });
    filter._id = { $lt: request.query.cursor };
  }
  if (request.query.includeVoided !== "true") filter.voidedAt = null;
  const rows = await Sale.find(filter).sort({ _id: -1 }).limit(limit + 1).lean();
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const creatorIds = [...new Set(page
    .filter((sale) => !sale.createdByName && sale.actor)
    .map((sale) => String(sale.actor)))];
  const creators = creatorIds.length
    ? await User.find({ _id: { $in: creatorIds } }).select("_id name").lean()
    : [];
  const creatorNames = new Map(creators.map((user) => [String(user._id), user.name]));
  const ids = page.map((sale) => sale._id);
  const payments = ids.length ? await SalePayment.find({ saleId: { $in: ids } }).sort({ date: 1, _id: 1 }).lean() : [];
  const paymentsBySale = new Map();
  for (const payment of payments) {
    const key = String(payment.saleId);
    if (!paymentsBySale.has(key)) paymentsBySale.set(key, []);
    paymentsBySale.get(key).push(serialize(payment));
  }
  return response.json({
    sales: page.map((sale) => ({
      ...serialize(sale),
      reference: sale.receiptNumber,
      createdByName: sale.createdByName || creatorNames.get(String(sale.actor)) || "",
      payments: paymentsBySale.get(String(sale._id)) || [],
    })),
    nextCursor: hasMore ? String(page[page.length - 1]._id) : null,
  });
}

async function getSale(request, response) {
  if (!validObjectId(request.params.id)) return response.status(400).json({ error: "Sale ID is invalid." });
  const sale = await Sale.findOne({ _id: request.params.id, voidedAt: null }).lean();
  if (!sale) return response.status(404).json({ error: "Sale not found." });
  const creator = !sale.createdByName && sale.actor
    ? await User.findById(sale.actor).select("_id name").lean()
    : null;
  const payments = await SalePayment.find({ saleId: sale._id }).sort({ date: 1, _id: 1 }).lean();
  return response.json({
    sale: { ...serialize(sale), reference: sale.receiptNumber, createdByName: sale.createdByName || creator?.name || "" },
    payments: payments.map(serialize),
  });
}

async function getCreditStatement(request, response) {
  const customerId = String(request.params.customerId || "").trim();
  if (!customerId || customerId.length > 80) return response.status(400).json({ error: "Customer ID is invalid." });
  const customer = await Customer.findOne({ id: customerId }).lean();
  if (!customer) return response.status(404).json({ error: "Customer not found." });
  const sales = await Sale.find({
    customerId,
    paymentTerms: "Credit",
    voidedAt: null,
  }).sort({ date: -1, _id: -1 }).lean();
  const ids = sales.map((sale) => sale._id);
  const payments = ids.length
    ? await SalePayment.find({ saleId: { $in: ids } }).sort({ date: 1, _id: 1 }).lean()
    : [];
  const paymentsBySale = new Map();
  for (const payment of payments) {
    const key = String(payment.saleId);
    if (!paymentsBySale.has(key)) paymentsBySale.set(key, []);
    paymentsBySale.get(key).push(serialize(payment));
  }
  const today = companyWorkDate();
  const entries = sales.map((sale) => ({
    ...serialize(sale),
    reference: sale.receiptNumber,
    payments: paymentsBySale.get(String(sale._id)) || [],
    balance: Math.max(0, sale.total - sale.paidAmount),
  }));
  return response.json({
    customer: { id: customer.id, name: customer.name, phone: customer.phone, email: customer.email },
    sales: entries,
    summary: {
      totalCredit: entries.reduce((total, sale) => total + sale.total, 0),
      totalPaid: entries.reduce((total, sale) => total + sale.paidAmount, 0),
      outstanding: entries.reduce((total, sale) => total + sale.balance, 0),
      overdue: entries.filter((sale) => sale.balance > 0 && sale.dueDate && sale.dueDate < today)
        .reduce((total, sale) => total + sale.balance, 0),
    },
  });
}

async function listSalesOwners(_request, response) {
  const users = await User.find({ status: "Active", roles: { $in: SALE_ROLES } })
    .select("_id name email roles")
    .sort({ name: 1 })
    .lean();
  return response.json({
    users: users.map((user) => ({
      id: String(user._id),
      name: user.name,
      email: user.email,
      roles: user.roles,
    })),
  });
}

async function updateCreditSale(request, response) {
  if (!validObjectId(request.params.id)) return response.status(400).json({ error: "Sale ID is invalid." });
  const body = request.body;
  const allowed = ["dueDate", "assignedTo", "customerId"];
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length === 0 || Object.keys(body).some((key) => !allowed.includes(key))) {
    return response.status(400).json({ error: "Provide a saved customer, due date, and/or assigned sales owner." });
  }
  if (body.dueDate !== undefined && !validDate(body.dueDate)) {
    return response.status(400).json({ error: "Credit due date must be a valid YYYY-MM-DD date." });
  }
  if (body.assignedTo !== undefined && body.assignedTo !== null && !validObjectId(body.assignedTo)) {
    return response.status(400).json({ error: "Assigned sales owner is invalid." });
  }
  if (body.customerId !== undefined && (typeof body.customerId !== "string" || !body.customerId.trim() || body.customerId.length > 80)) {
    return response.status(400).json({ error: "Choose a valid saved customer." });
  }
  const sale = await Sale.findOne({ _id: request.params.id, paymentTerms: "Credit", voidedAt: null });
  if (!sale) return response.status(404).json({ error: "Credit sale not found." });
  let customer;
  if (body.customerId !== undefined) {
    customer = await Customer.findOne({ id: body.customerId, status: "Active", archivedAt: null }).lean();
    if (!customer) return response.status(400).json({ error: "Choose an active saved customer." });
  }
  if (body.assignedTo) {
    const user = await User.findOne({
      _id: body.assignedTo,
      status: "Active",
      roles: { $in: SALE_ROLES },
    }).select("_id");
    if (!user) return response.status(400).json({ error: "Choose an active user with a Sales Manager role." });
  }
  const previous = {
    customerId: sale.customerId || null,
    dueDate: sale.dueDate || null,
    assignedTo: sale.assignedTo ? String(sale.assignedTo) : null,
  };
  if (customer) {
    sale.customerId = customer.id;
    sale.customer = customerSnapshot(customer);
  }
  if (body.dueDate !== undefined) sale.dueDate = body.dueDate;
  if (body.assignedTo !== undefined) sale.assignedTo = body.assignedTo;
  await sale.save();
  await audit.recordAudit({
    request,
    eventType: "credit.sale_updated",
    outcome: "success",
    details: {
      saleId: String(sale._id),
      receiptNumber: sale.receiptNumber,
      previous,
      customerId: sale.customerId || null,
      dueDate: sale.dueDate || null,
      assignedTo: sale.assignedTo ? String(sale.assignedTo) : null,
    },
  });
  return response.json({ sale: serialize(sale) });
}

async function createSale(request, response) {
  const { value, error } = validateSaleInput(request.body);
  if (error) return response.status(400).json({ error });
  try {
    const result = await mongoose.connection.transaction(async (session) => {
      const requestHash = createHash("sha256")
        .update(JSON.stringify({
          customerId: value.customerId,
          guest: value.guest,
          lines: value.lines,
          paymentTerms: value.paymentTerms,
          dueDate: value.dueDate,
          initialPaymentAmount: value.initialPaymentAmount,
          initialPaymentMethod: value.initialPaymentMethod,
          initialPaymentTxnID: value.initialPaymentTxnID,
        }))
        .digest("hex");
      const existing = await Sale.findOne({ idempotencyKey: value.idempotencyKey }).session(session);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw invalid("This retry key was already used with different sale details. Start a new sale to submit changed details.", 409);
        }
        const payments = await SalePayment.find({ saleId: existing._id }).session(session).lean();
        return { sale: serialize(existing), payments: payments.map(serialize), replayed: true };
      }
      if (value.initialPaymentAmount > 0 &&
        await SalePayment.exists({ idempotencyKey: value.idempotencyKey }).session(session)) {
        throw invalid("This idempotency key was already used for a different payment.", 409);
      }
      const variantsById = new Map();
      for (const line of value.lines) {
        const id = line.variantId;
        if (!variantsById.has(id)) {
          const variant = await BakeryProductVariant.findOne({ _id: id, active: true }).session(session);
          if (!variant) throw invalid("A selected bakery variant is missing or inactive.", 409);
          const family = await BakeryProductFamily.findOne({ _id: variant.familyId, active: true }).session(session).lean();
          if (!family) throw invalid("A selected bakery variant belongs to a missing or inactive product family.", 409);
          if (!variant.sku || !variant.name || !variant.saleUnit ||
            !Number.isInteger(variant.unitsPerSaleUnit) || variant.unitsPerSaleUnit < 1) {
            throw invalid(`${variant.name || variant.sku || "The selected bakery variant"} must have valid sale-unit details before it can be sold.`, 409);
          }
          if (!Number.isInteger(variant.price) || variant.price < 1) {
            throw invalid(`${variant.name} does not have a valid catalog price. Update the variant before selling it.`, 409);
          }
          variantsById.set(id, variant);
        }
        if (line.pricePerPack !== undefined && !SALE_ROLES.some((role) => request.authUser.roles?.includes(role))) {
          throw invalid("You do not have permission to override catalog prices.", 403);
        }
      }
      let customer;
      if (value.customerId) {
        customer = await Customer.findOne({
          id: value.customerId,
          status: "Active",
          archivedAt: null,
        }).session(session).lean();
        if (!customer) throw invalid("The selected customer is missing, inactive, suspended, or archived.", 409);
      }
      if (value.paymentTerms === "Credit" && !customer) throw invalid("Credit sales require a saved customer account.");

      const saleLines = value.lines.map((line) => {
        const product = variantsById.get(line.variantId);
        const pricePerPack = line.pricePerPack ?? product.price;
        const unitsPerPack = product.unitsPerSaleUnit;
        const quantityPieces = line.packs * unitsPerPack;
        const lineTotal = line.packs * pricePerPack;
        if (!Number.isSafeInteger(quantityPieces) || !Number.isSafeInteger(lineTotal) || lineTotal < 1) {
          throw invalid("Sale quantities and totals exceed supported values.");
        }
        return {
          variantId: product._id,
          productCode: product.sku,
          sku: product.sku,
          productName: product.name,
          saleUnit: product.saleUnit,
          unitsPerSaleUnit: product.unitsPerSaleUnit,
          packs: line.packs,
          quantityPieces,
          catalogPricePerPack: product.price,
          pricePerPack,
          overrideReason: line.pricePerPack !== undefined ? line.overrideReason : "",
          lineTotal,
        };
      });
      const total = saleLines.reduce((sum, line) => sum + line.lineTotal, 0);
      if (!Number.isSafeInteger(total) || total < 1) throw invalid("Sale total exceeds supported values.");
      const totalError = validateSaleTotals({ ...value, customerId: customer?.id ?? null }, total);
      if (totalError) throw invalid(totalError);
      const date = companyWorkDate();
      const year = getSequenceYear(date);
      const counter = await ReceiptSequence.findOneAndUpdate(
        { _id: year },
        { $inc: { sequence: 1 }, $setOnInsert: { _id: year } },
        { new: true, upsert: true, session, setDefaultsOnInsert: true },
      );
      const receiptNumber = `SAL-${year}-${String(counter.sequence).padStart(6, "0")}`;
      const profile = await ProfileSettings.findById("global").session(session).lean();
      const [sale] = await Sale.create([{
        receiptNumber,
        receiptYear: year,
        receiptSequence: counter.sequence,
        customerId: customer?.id ?? null,
        assignedTo: customer && value.paymentTerms === "Credit" ? actorId(request) : null,
        customer: customer ? customerSnapshot(customer) : guestSnapshot(value.guest),
        company: companySnapshot(profile),
        date,
        lines: saleLines,
        total,
        paidAmount: value.initialPaymentAmount,
        paymentTerms: value.paymentTerms,
        dueDate: value.dueDate,
        actor: actorId(request),
        createdByName: request.authUser.name || "",
        idempotencyKey: value.idempotencyKey,
        requestHash,
      }], { session });
      for (const [index, line] of saleLines.entries()) {
        await dispatchBakerySaleLots({
          variantId: line.variantId,
          quantity: line.packs,
          date,
          reference: receiptNumber,
          sourceType: "sale",
          saleId: sale._id,
          idempotencyKey: value.idempotencyKey,
          lineIndex: index,
          reason: `Sale of ${line.packs} ${line.saleUnit}${line.packs === 1 ? "" : "s"}`,
          actorId: actorId(request),
          session,
        });
      }
      const payments = [];
      if (value.initialPaymentAmount > 0) {
        const [payment] = await SalePayment.create([{
          saleId: sale._id,
          paymentReceiptNumber: sale.paymentTerms === "Credit"
            ? await allocateCreditPaymentReceiptNumber(date, session)
            : undefined,
          amount: value.initialPaymentAmount,
          date,
          method: value.initialPaymentMethod,
          txnID: value.initialPaymentTxnID,
          note: "Initial payment recorded with sale.",
          idempotencyKey: value.idempotencyKey,
          actor: actorId(request),
        }], { session });
        payments.push(serialize(payment));
        await audit.recordAudit({
          request,
          eventType: "sale.payment_recorded",
          outcome: "success",
          details: { saleId: String(sale._id), receiptNumber, paymentId: String(payment._id), amount: payment.amount },
          transaction: session,
        });
      }
      await audit.recordAudit({
        request,
        eventType: "sale.created",
        outcome: "success",
        details: {
          saleId: String(sale._id),
          receiptNumber,
          customerId: customer?.id ?? null,
          lineCount: saleLines.length,
          total,
          stockDispatchPosted: true,
          stockDispatchSource: "finished-stock-lots",
        },
        transaction: session,
      });
      return { sale: { ...serialize(sale), reference: receiptNumber }, payments, replayed: false };
    });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return nextError(error, response);
  }
}

async function recordPayment(request, response) {
  if (!validObjectId(request.params.id)) return response.status(400).json({ error: "Sale ID is invalid." });
  const { value, error } = validatePaymentInput(request.body);
  if (error) return response.status(400).json({ error });
  try {
    const result = await mongoose.connection.transaction(async (session) => {
      const replay = await SalePayment.findOne({ idempotencyKey: value.idempotencyKey }).session(session);
      if (replay) {
        if (String(replay.saleId) !== request.params.id) throw invalid("This idempotency key belongs to another sale.", 409);
        const payments = await SalePayment.find({ saleId: request.params.id }).sort({ date: 1, _id: 1 }).session(session).lean();
        return { payment: serialize(replay), payments: payments.map(serialize), replayed: true };
      }
      const sale = await Sale.findOne({ _id: request.params.id, voidedAt: null }).session(session);
      if (!sale) throw invalid("Sale not found.", 404);
      const balance = sale.total - sale.paidAmount;
      if (value.amount > balance) throw invalid("Payment cannot exceed the remaining sale balance.", 409);
      const updated = await Sale.updateOne(
        { _id: sale._id, paidAmount: { $lte: sale.total - value.amount } },
        { $inc: { paidAmount: value.amount } },
        { session },
      );
      if (!updated.modifiedCount) throw invalid("Payment exceeds the remaining sale balance.", 409);
      const [payment] = await SalePayment.create([{
        saleId: sale._id,
        paymentReceiptNumber: sale.paymentTerms === "Credit"
          ? await allocateCreditPaymentReceiptNumber(value.date, session)
          : undefined,
        ...value,
        actor: actorId(request),
      }], { session });
      await audit.recordAudit({
        request,
        eventType: "sale.payment_recorded",
        outcome: "success",
        details: { saleId: String(sale._id), receiptNumber: sale.receiptNumber, paymentId: String(payment._id), amount: payment.amount },
        transaction: session,
      });
      const payments = await SalePayment.find({ saleId: sale._id }).sort({ date: 1, _id: 1 }).session(session).lean();
      return { payment: serialize(payment), payments: payments.map(serialize), replayed: false };
    });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return nextError(error, response);
  }
}

function nextError(error, response) {
  if (error?.statusCode) return response.status(error.statusCode).json({ error: error.message });
  if (error?.code === 11000) return response.status(409).json({ error: "A sale, receipt number, or request key already exists. Retry using the same idempotency key." });
  if (error?.name === "ValidationError" || error?.name === "CastError") return response.status(400).json({ error: error.message });
  throw error;
}

module.exports = {
  createSale,
  getSale,
  getCreditStatement,
  listSales,
  listSalesOwners,
  recordPayment,
  updateCreditSale,
  validatePaymentInput,
  validateSaleTotals,
  validateSaleInput,
};
