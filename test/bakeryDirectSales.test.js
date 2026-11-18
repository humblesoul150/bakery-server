const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const Sale = require("../models/sale");
const FinishedStockLot = require("../models/finishedStockLot");
const FinishedStockLotMovement = require("../models/finishedStockLotMovement");
const { validateSaleInput } = require("../controllers/salesController");
const { getSalesCatalogMode } = require("../lib/bakeryDirectSales");
const { dispatchBakerySaleLots } = require("../lib/finishedStockLotSales");
const { reconcilePlan } = require("../scripts/purgeLegacySales");

const productId = "507f1f77bcf86cd799439013";
const variantId = "507f1f77bcf86cd799439014";
const userId = "507f1f77bcf86cd799439011";

function saleInput(line) {
  return {
    customerId: "C-100",
    lines: [line],
    paymentTerms: "Credit",
    dueDate: "2026-11-20",
    idempotencyKey: "bakery-sale-1",
  };
}

test("bakery direct sales have no staged legacy catalog mode", () => {
  assert.equal(getSalesCatalogMode(), "bakery");
});

test("direct bakery sale validation accepts only variant lines and keeps packs as sale-unit quantity", () => {
  const bakery = validateSaleInput(saleInput({ variantId, packs: 3 }));
  assert.equal(bakery.error, undefined);
  assert.deepEqual(bakery.value.lines[0], { variantId, packs: 3 });
  assert.match(validateSaleInput(saleInput({ productId, packs: 3 })).error, /bakery variant/);
  assert.match(validateSaleInput(saleInput({ variantId, packs: 1.5 })).error, /positive whole number/);
});

test("new sale schema rejects ambiguous line identifiers and accepts a bakery snapshot", async () => {
  const common = {
    receiptNumber: "SAL-2026-000001",
    receiptYear: 2026,
    receiptSequence: 1,
    customer: { name: "Customer" },
    company: {},
    date: "2026-11-17",
    total: 3000,
    paymentTerms: "Credit",
    dueDate: "2026-11-20",
    actor: userId,
    idempotencyKey: "schema-test",
    requestHash: "a".repeat(64),
  };
  const bakerySale = new Sale({
    ...common,
    lines: [{
      variantId,
      productCode: "BREAD-01",
      sku: "BREAD-01",
      productName: "Bread",
      saleUnit: "loaf",
      unitsPerSaleUnit: 1,
      packs: 1,
      quantityPieces: 1,
      catalogPricePerPack: 3000,
      pricePerPack: 3000,
      lineTotal: 3000,
    }],
  });
  await bakerySale.validate();
  assert.ok(Sale.schema.path("lines").schema.path("variantId"));
  assert.ok(FinishedStockLotMovement.schema.path("sourceType").enumValues.includes("sale"));
});

test("bakery sale lot dispatch consumes FEFO quantities with guarded sale movements", async () => {
  const firstLotId = new mongoose.Types.ObjectId();
  const secondLotId = new mongoose.Types.ObjectId();
  const saleId = new mongoose.Types.ObjectId();
  const actor = new mongoose.Types.ObjectId();
  const lots = [
    { _id: firstLotId, remainingQuantity: 2, reservedQuantity: 0 },
    { _id: secondLotId, remainingQuantity: 5, reservedQuantity: 1 },
  ];
  const movements = [];
  const guards = [];
  const originalFind = FinishedStockLot.find;
  const originalFindOneAndUpdate = FinishedStockLot.findOneAndUpdate;
  const originalMovementCreate = FinishedStockLotMovement.create;
  let sort;
  let lotIndex = 0;

  FinishedStockLot.find = (query) => {
    assert.equal(String(query.variantId), variantId);
    assert.equal(query.status, "active");
    assert.deepEqual(query.expiryDate, { $gte: "2026-11-17" });
    return {
      sort(value) { sort = value; return this; },
      session() { return this; },
      then(resolve, reject) { return Promise.resolve(lots).then(resolve, reject); },
    };
  };
  FinishedStockLot.findOneAndUpdate = async (filter, update) => {
    guards.push({ filter, update });
    const lot = lots[lotIndex++];
    assert.equal(String(filter._id), String(lot._id));
    const quantity = -update.$inc.remainingQuantity;
    assert.deepEqual(filter.$expr, { $gte: [{ $subtract: ["$remainingQuantity", "$reservedQuantity"] }, quantity] });
    return { _id: lot._id };
  };
  FinishedStockLotMovement.create = async (documents) => {
    movements.push(documents[0]);
    return [{ _id: new mongoose.Types.ObjectId() }];
  };

  try {
    const allocations = await dispatchBakerySaleLots({
      variantId,
      quantity: 5,
      date: "2026-11-17",
      reference: "SAL-2026-000001",
      saleId,
      idempotencyKey: "bakery-sale-1",
      lineIndex: 0,
      reason: "Sale of 5 loaves",
      actorId: actor,
      session: {},
    });
    assert.deepEqual(sort, { expiryDate: 1, productionDate: 1, createdAt: 1, _id: 1 });
    assert.deepEqual(allocations.map(({ quantity }) => quantity), [2, 3]);
    assert.deepEqual(guards.map(({ update }) => update.$inc.remainingQuantity), [-2, -3]);
    assert.equal(guards[0].update.$set.status, "depleted");
    assert.equal(guards[1].update.$set, undefined);
    assert.equal(movements.length, 2);
    for (const movement of movements) {
      assert.equal(movement.type, "Sales dispatch");
      assert.equal(movement.direction, "out");
      assert.equal(movement.sourceType, "sale");
      assert.equal(String(movement.sourceId), String(saleId));
      assert.equal(movement.reference, "SAL-2026-000001");
      assert.match(movement.idempotencyKey, /^bakery-sale:[a-f0-9]{64}$/);
    }
  } finally {
    FinishedStockLot.find = originalFind;
    FinishedStockLot.findOneAndUpdate = originalFindOneAndUpdate;
    FinishedStockLotMovement.create = originalMovementCreate;
  }
});

test("bakery sale lot dispatch fails atomically when eligible stock is insufficient", async () => {
  const originalFind = FinishedStockLot.find;
  const originalFindOneAndUpdate = FinishedStockLot.findOneAndUpdate;
  const originalMovementCreate = FinishedStockLotMovement.create;
  FinishedStockLot.find = () => ({
    sort() { return this; },
    session() { return this; },
    then(resolve, reject) { return Promise.resolve([]).then(resolve, reject); },
  });
  FinishedStockLot.findOneAndUpdate = originalFindOneAndUpdate;
  FinishedStockLotMovement.create = originalMovementCreate;
  try {
    await assert.rejects(dispatchBakerySaleLots({
      variantId,
      quantity: 1,
      date: "2026-11-17",
      reference: "SAL-2026-000002",
      saleId: new mongoose.Types.ObjectId(),
      idempotencyKey: "bakery-sale-2",
      lineIndex: 0,
      reason: "Sale of 1 loaf",
      actorId: new mongoose.Types.ObjectId(),
      session: {},
    }), (error) => error.statusCode === 409);
  } finally {
    FinishedStockLot.find = originalFind;
    FinishedStockLot.findOneAndUpdate = originalFindOneAndUpdate;
    FinishedStockLotMovement.create = originalMovementCreate;
  }
});

test("legacy sales purge plan blocks unpaid, order-linked, and order-payment-linked records", () => {
  const plan = {
    sales: [{ _id: "sale-1", total: 5000, paidAmount: 2000 }],
    payments: [{ _id: "payment-1", saleId: "sale-1" }],
    linkedOrders: [{ _id: "order-1", saleId: "sale-1" }],
    receiptStates: [],
    notifications: [],
    orderPayments: [{ _id: "order-payment-1", salePaymentId: "payment-1" }],
  };
  const blockers = reconcilePlan(plan);
  assert.equal(blockers.length, 3);
  assert.ok(blockers.some((blocker) => blocker.scope === "credit"));
  assert.ok(blockers.some((blocker) => blocker.scope === "orders"));
  assert.ok(blockers.some((blocker) => blocker.scope === "order-payments"));
  assert.deepEqual(reconcilePlan({
    sales: [],
    payments: [],
    linkedOrders: [],
    receiptStates: [],
    notifications: [],
    orderPayments: [],
  }), []);
});
