const assert = require("node:assert/strict");
const { test } = require("node:test");
const BakeryProductFamily = require("../models/bakeryProductFamily");
const BakeryProductVariant = require("../models/bakeryProductVariant");
const BakeryStockAlert = require("../models/bakeryStockAlert");
const FinishedStockLot = require("../models/finishedStockLot");
const NotificationOutbox = require("../models/notificationOutbox");
const {
  RECIPIENT_ROLES,
  evaluateVariantStock,
  notificationFor,
  stockStateFor,
} = require("../lib/bakeryStockAlerts");

test("bakery sellable stock states honor inclusive thresholds and zero stock", () => {
  assert.equal(stockStateFor(11, 10), "stocked");
  assert.equal(stockStateFor(10, 10), "low_stock");
  assert.equal(stockStateFor(1, 10), "low_stock");
  assert.equal(stockStateFor(0, 10), "out_of_stock");
  assert.equal(stockStateFor(1, 0), "stocked");
});

test("bakery stock evaluation excludes expired/inactive lots and subtracts reservations", async (t) => {
  const originals = {
    variantFindById: BakeryProductVariant.findById,
    familyFindOne: BakeryProductFamily.findOne,
    lotAggregate: FinishedStockLot.aggregate,
  };
  let pipeline;
  BakeryProductVariant.findById = () => ({
    lean: async () => ({
      _id: "507f1f77bcf86cd799439011",
      familyId: "507f1f77bcf86cd799439012",
      sku: "BREAD-LOAF",
      name: "Bakery loaf",
      saleUnit: "loaf",
      lowStockThreshold: 10,
      active: true,
    }),
  });
  BakeryProductFamily.findOne = () => ({
    select() {
      return this;
    },
    lean: async () => ({ _id: "507f1f77bcf86cd799439012" }),
  });
  FinishedStockLot.aggregate = (value) => {
    pipeline = value;
    return { exec: async () => [{ currentQuantity: 8 }] };
  };
  t.after(() => {
    BakeryProductVariant.findById = originals.variantFindById;
    BakeryProductFamily.findOne = originals.familyFindOne;
    FinishedStockLot.aggregate = originals.lotAggregate;
  });

  const result = await evaluateVariantStock(
    "507f1f77bcf86cd799439011",
    new Date("2026-11-19T12:00:00.000Z"),
  );
  assert.equal(result.currentQuantity, 8);
  assert.equal(result.lowStockThreshold, 10);
  assert.equal(result.state, "low_stock");
  assert.equal(pipeline[0].$match.status, "active");
  assert.deepEqual(pipeline[0].$match.expiryDate, { $gte: "2026-11-19" });
  assert.deepEqual(pipeline[1].$project.available.$max[1], {
    $subtract: ["$remainingQuantity", "$reservedQuantity"],
  });
});

test("bakery stock notifications target the confirmed roles and identify the SKU", () => {
  const alert = {
    variantId: "507f1f77bcf86cd799439011",
    sku: "BREAD-LOAF",
    productName: "Bakery loaf",
    saleUnit: "loaf",
    lowStockThreshold: 10,
    currentQuantity: 0,
    state: "out_of_stock",
  };
  const event = notificationFor(
    alert,
    "low_stock",
    new Date("2026-11-19T12:00:00.000Z"),
    "507f1f77bcf86cd799439013",
  );
  assert.equal(event.type, "inventory.bakery_stock_out");
  assert.equal(event.severity, "urgent");
  assert.equal(event.resource.reference, "BREAD-LOAF");
  assert.deepEqual(event.recipientRoles, [
    "Sales Manager",
    "Inventory Manager",
    "Production Manager",
    "General Manager",
    "Super Admin",
  ]);
  assert.deepEqual(event.recipientRoles, RECIPIENT_ROLES);
});

test("bakery stock alert transitions enqueue once and recover when stock or threshold changes", async (t) => {
  const originals = {
    variantFindById: BakeryProductVariant.findById,
    familyFindOne: BakeryProductFamily.findOne,
    lotAggregate: FinishedStockLot.aggregate,
    alertFindOne: BakeryStockAlert.findOne,
    alertCreate: BakeryStockAlert.create,
    outboxCreate: NotificationOutbox.create,
  };
  const variant = {
    _id: "507f1f77bcf86cd799439011",
    familyId: "507f1f77bcf86cd799439012",
    sku: "BREAD-LOAF",
    name: "Bakery loaf",
    saleUnit: "loaf",
    lowStockThreshold: 10,
    active: true,
  };
  let currentQuantity = 5;
  let currentAlert = null;
  const queuedEvents = [];
  const sessionQuery = (value) => ({
    session() {
      return this;
    },
    select() {
      return this;
    },
    lean() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(value).then(resolve, reject);
    },
  });

  BakeryProductVariant.findById = () => sessionQuery(variant);
  BakeryProductFamily.findOne = () => sessionQuery({ _id: variant.familyId });
  FinishedStockLot.aggregate = () => ({
    session() {
      return this;
    },
    exec: async () => [{ currentQuantity }],
  });
  BakeryStockAlert.findOne = () => ({
    session() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(currentAlert).then(resolve, reject);
    },
  });
  BakeryStockAlert.create = async ([values]) => {
    currentAlert = {
      ...values,
      save: async function save() { return this; },
    };
    return [currentAlert];
  };
  NotificationOutbox.create = async ([event]) => {
    queuedEvents.push(event);
    return [event];
  };
  t.after(() => {
    BakeryProductVariant.findById = originals.variantFindById;
    BakeryProductFamily.findOne = originals.familyFindOne;
    FinishedStockLot.aggregate = originals.lotAggregate;
    BakeryStockAlert.findOne = originals.alertFindOne;
    BakeryStockAlert.create = originals.alertCreate;
    NotificationOutbox.create = originals.outboxCreate;
  });

  const session = {};
  const refresh = (id = variant._id) => require("../lib/bakeryStockAlerts")
    .refreshBakeryStockAlert(id, "507f1f77bcf86cd799439013", { session });
  const eventTypes = () => queuedEvents.map((event) => event.type);

  await refresh();
  await refresh();
  assert.deepEqual(eventTypes(), ["inventory.bakery_stock_low"]);

  currentQuantity = 0;
  await refresh();
  await refresh();
  assert.deepEqual(eventTypes(), [
    "inventory.bakery_stock_low",
    "inventory.bakery_stock_out",
  ]);

  currentQuantity = 11;
  await refresh();
  assert.deepEqual(eventTypes(), [
    "inventory.bakery_stock_low",
    "inventory.bakery_stock_out",
    "inventory.bakery_stock_recovered",
  ]);

  currentQuantity = 6;
  await refresh();
  variant.lowStockThreshold = 5;
  await refresh();
  assert.deepEqual(eventTypes(), [
    "inventory.bakery_stock_low",
    "inventory.bakery_stock_out",
    "inventory.bakery_stock_recovered",
    "inventory.bakery_stock_low",
    "inventory.bakery_stock_recovered",
  ]);

  variant.active = false;
  await refresh();
  assert.equal(currentAlert.state, "inactive");
  assert.equal(currentAlert.status, "resolved");
  assert.equal(queuedEvents.length, 5);
});

