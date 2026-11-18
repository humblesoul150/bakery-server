const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const Sale = require("../models/sale");
const SalePayment = require("../models/salePayment");
const ReceiptSequence = require("../models/receiptSequence");
const salesRouter = require("../routes/sales");
const salesController = require("../controllers/salesController");
const audit = require("../lib/audit");
const {
  validatePaymentInput,
  validateSaleInput,
  validateSaleTotals,
} = require("../controllers/salesController");

const variantId = "507f1f77bcf86cd799439013";
const userId = "507f1f77bcf86cd799439011";

function saleInput(overrides = {}) {
  return {
    customerId: "C-100",
    lines: [{ variantId, packs: 2 }],
    paymentTerms: "Credit",
    dueDate: "2026-11-01",
    idempotencyKey: "sale-1",
    ...overrides,
  };
}

test("sales validation accepts catalog-priced pack lines and rejects invalid input", () => {
  const valid = validateSaleInput(saleInput());
  assert.equal(valid.error, undefined);
  assert.equal(valid.value.lines[0].packs, 2);
  assert.equal(validateSaleInput(saleInput({
    lines: [{ variantId, packs: 1, pricePerPack: 23000, overrideReason: "Approved wholesale rate" }],
  })).error, undefined);
  assert.match(validateSaleInput(saleInput({ lines: [{ variantId, packs: 1.5 }] })).error, /positive whole number/);
  assert.match(validateSaleInput(saleInput({ lines: [{ variantId, packs: 1, pricePerPack: 0, overrideReason: "Discount" }] })).error, /positive whole number/);
  assert.match(validateSaleInput(saleInput({ lines: [{ variantId, packs: 1, pricePerPack: 23000 }] })).error, /reason is required/);
  assert.match(validateSaleInput(saleInput({ lines: [{ variantId, packs: 1, overrideReason: "No override" }] })).error, /only be supplied/);
  assert.match(validateSaleInput(saleInput({ lines: [{ variantId, packs: 1, extra: "rejected" }] })).error, /Each sale line/);
});

test("guest sales require full payment and cannot use credit terms", () => {
  const guest = { name: "Walk-in" };
  const paidNow = validateSaleInput(saleInput({
    customerId: undefined,
    guest,
    paymentTerms: "Paid now",
    dueDate: undefined,
    initialPaymentAmount: 100,
    initialPaymentMethod: "Cash",
  }));
  assert.equal(paidNow.error, undefined);
  assert.match(validateSaleTotals(paidNow.value, 200), /Paid-now sales must record full payment/);
  assert.equal(validateSaleTotals(paidNow.value, 100), "");
  assert.match(validateSaleInput(saleInput({
    customerId: undefined,
    guest,
    paymentTerms: "Same-day",
    dueDate: undefined,
  })).error, /One-time customer sales must be paid/);
  assert.match(validateSaleInput(saleInput({
    customerId: undefined,
    guest,
    paymentTerms: "Credit",
  })).error, /Credit sales require a saved customer/);
  assert.match(validateSaleInput(saleInput({
    customerId: undefined,
    guest,
    paymentTerms: "Paid now",
    dueDate: undefined,
    initialPaymentAmount: 100,
    initialPaymentMethod: "Cash",
    guest: { name: "Guest", unknown: true },
  })).error, /valid one-time customer details/);
});

test("initial payment and later payment validation require positive whole-UGX entries", () => {
  assert.equal(validateSaleInput(saleInput({
    initialPaymentAmount: 1000,
    initialPaymentMethod: "Mobile Money",
  })).error, undefined);
  assert.match(validateSaleInput(saleInput({
    initialPaymentAmount: 1.5,
    initialPaymentMethod: "Cash",
  })).error, /non-negative whole number/);
  assert.equal(validateSaleInput(saleInput({
    paymentTerms: "Paid now",
    initialPaymentAmount: 0,
    dueDate: undefined,
  })).error, undefined);
  assert.equal(validatePaymentInput({
    amount: 250,
    date: "2026-10-23",
    method: "Cash",
    idempotencyKey: "payment-1",
  }).error, undefined);
  assert.match(validatePaymentInput({
    amount: 250.5,
    date: "2026-10-23",
    method: "Cash",
    idempotencyKey: "payment-1",
  }).error, /positive whole number/);
  assert.match(validatePaymentInput({
    amount: 250,
    date: "2026-02-30",
    method: "Cash",
    idempotencyKey: "payment-1",
  }).error, /valid YYYY-MM-DD/);
});

test("sales schemas enforce unique receipt, annual sequence, payment and idempotency keys", async () => {
  const indexes = Sale.schema.indexes();
  assert.ok(indexes.some(([keys, options]) => keys.receiptNumber === 1 && options.unique));
  assert.ok(indexes.some(([keys, options]) =>
    keys.receiptYear === 1 && keys.receiptSequence === 1 && options.unique,
  ));
  assert.ok(indexes.some(([keys, options]) => keys.idempotencyKey === 1 && options.unique));
  assert.ok(SalePayment.schema.indexes().some(([keys, options]) => keys.idempotencyKey === 1 && options.unique));
  assert.equal(ReceiptSequence.schema.path("_id").instance, "Number");

  const sale = new Sale({
    receiptNumber: "SAL-2026-000001",
    receiptYear: 2026,
    receiptSequence: 1,
    customer: { name: "Guest" },
    company: {},
    date: "2026-10-23",
    lines: [{
      variantId,
      productCode: "SD-LOAF",
      sku: "SD-LOAF",
      productName: "Sourdough loaf",
      saleUnit: "loaf",
      unitsPerSaleUnit: 1,
      packs: 2,
      quantityPieces: 2,
      catalogPricePerPack: 12000,
      pricePerPack: 12000,
      lineTotal: 24000,
    }],
    total: 24000,
    paidAmount: 0,
    paymentTerms: "Credit",
    dueDate: "2026-11-01",
    actor: userId,
  });
  assert.equal(sale.createdByName, "");

  await sale.validate();
  assert.equal(mongoose.isValidObjectId(sale.lines[0].variantId), true);
});

test("sales route grants read/write middleware only to configured sales roles", async () => {
  for (const role of ["Sales Manager", "General Manager", "Super Admin"]) {
    let reached = false;
    await salesRouter.requireSalesRole(
      { authUser: { _id: userId, roles: [role] } },
      {},
      () => { reached = true; },
    );
    assert.equal(reached, true, `${role} should be allowed`);
  }
});

test("recording credit repayments persists the payment and returns updated history", async () => {
  const originals = {
    transaction: mongoose.connection.transaction,
    saleFindOne: Sale.findOne,
    saleUpdateOne: Sale.updateOne,
    paymentFindOne: SalePayment.findOne,
    paymentFind: SalePayment.find,
    paymentCreate: SalePayment.create,
    recordAudit: audit.recordAudit,
  };
  const persistedPayments = [];
  const sale = { _id: new mongoose.Types.ObjectId(), receiptNumber: "SAL-2026-000050", total: 1000, paidAmount: 0 };
  mongoose.connection.transaction = async (callback) => callback({ id: "transaction" });
  Sale.findOne = () => ({ session: async () => sale });
  Sale.updateOne = async (_filter, update) => {
    sale.paidAmount += update.$inc.paidAmount;
    return { modifiedCount: 1 };
  };
  SalePayment.findOne = () => ({ session: async () => null });
  SalePayment.create = async ([value]) => {
    const payment = { ...value, _id: new mongoose.Types.ObjectId() };
    persistedPayments.push(payment);
    return [payment];
  };
  SalePayment.find = () => ({
    sort() { return this; },
    session() { return this; },
    lean: async () => persistedPayments,
  });
  audit.recordAudit = async () => {};
  try {
    for (const amount of [250, 750]) {
      let statusCode;
      let body;
      const response = {
        status(code) { statusCode = code; return this; },
        json(value) { body = value; return this; },
      };
      await salesController.recordPayment({
        params: { id: String(sale._id) },
        authUser: { _id: new mongoose.Types.ObjectId() },
        body: {
          amount,
          date: "2026-10-23",
          method: "Cash",
          idempotencyKey: `credit-payment-${amount}`,
        },
      }, response);
      assert.equal(statusCode, 201);
      assert.equal(body.payment.amount, amount);
      assert.equal(body.payments.length, persistedPayments.length);
    }
    assert.equal(sale.paidAmount, 1000);
  } finally {
    mongoose.connection.transaction = originals.transaction;
    Sale.findOne = originals.saleFindOne;
    Sale.updateOne = originals.saleUpdateOne;
    SalePayment.findOne = originals.paymentFindOne;
    SalePayment.find = originals.paymentFind;
    SalePayment.create = originals.paymentCreate;
    audit.recordAudit = originals.recordAudit;
  }
});

test("credit repayment retries are idempotent and overpayments are rejected", async () => {
  const originals = {
    transaction: mongoose.connection.transaction,
    saleFindOne: Sale.findOne,
    saleUpdateOne: Sale.updateOne,
    paymentFindOne: SalePayment.findOne,
    paymentFind: SalePayment.find,
    paymentCreate: SalePayment.create,
    recordAudit: audit.recordAudit,
  };
  const saleId = new mongoose.Types.ObjectId();
  const replay = { _id: new mongoose.Types.ObjectId(), saleId, amount: 250, date: "2026-10-23", method: "Cash" };
  let updateCalls = 0;
  let createCalls = 0;
  mongoose.connection.transaction = async (callback) => callback({ id: "transaction" });
  Sale.findOne = () => ({ session: async () => ({ _id: saleId, receiptNumber: "SAL-2026-000051", total: 1000, paidAmount: 900 }) });
  Sale.updateOne = async () => { updateCalls += 1; return { modifiedCount: 1 }; };
  SalePayment.findOne = (filter) => ({
    session: async () => filter.idempotencyKey === "payment-replay" ? replay : null,
  });
  SalePayment.create = async () => { createCalls += 1; return []; };
  SalePayment.find = () => ({
    sort() { return this; },
    session() { return this; },
    lean: async () => [replay],
  });
  audit.recordAudit = async () => {};
  try {
    let replayStatus;
    let replayBody;
    await salesController.recordPayment({
      params: { id: String(saleId) },
      authUser: { _id: new mongoose.Types.ObjectId() },
      body: { amount: 250, date: "2026-10-23", method: "Cash", idempotencyKey: "payment-replay" },
    }, {
      status(code) { replayStatus = code; return this; },
      json(value) { replayBody = value; return this; },
    });
    assert.equal(replayStatus, 200);
    assert.equal(replayBody.replayed, true);
    assert.equal(updateCalls, 0);
    assert.equal(createCalls, 0);

    let overpaymentStatus;
    let overpaymentBody;
    await salesController.recordPayment({
      params: { id: String(saleId) },
      authUser: { _id: new mongoose.Types.ObjectId() },
      body: { amount: 101, date: "2026-10-23", method: "Cash", idempotencyKey: "overpayment" },
    }, {
      status(code) { overpaymentStatus = code; return this; },
      json(value) { overpaymentBody = value; return this; },
    });
    assert.equal(overpaymentStatus, 409);
    assert.match(overpaymentBody.error, /cannot exceed the remaining sale balance/i);
    assert.equal(updateCalls, 0);
  } finally {
    mongoose.connection.transaction = originals.transaction;
    Sale.findOne = originals.saleFindOne;
    Sale.updateOne = originals.saleUpdateOne;
    SalePayment.findOne = originals.paymentFindOne;
    SalePayment.find = originals.paymentFind;
    SalePayment.create = originals.paymentCreate;
    audit.recordAudit = originals.recordAudit;
  }
});
