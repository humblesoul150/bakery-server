const assert = require("node:assert/strict");
const { test } = require("node:test");
const { planFefoAllocation } = require("../lib/rawMaterialLotInventory");
const { notificationFor } = require("../lib/rawMaterialLotExpiryAlerts");
const { buildLotMigrationPlan } = require("../scripts/migrateRawMaterialLots");

const materialId = "507f1f77bcf86cd799439011";

test("FEFO allocations split quantities by expiry then receipt date", () => {
  const allocations = planFefoAllocation([
    { _id: "late", internalLotCode: "LATE", expiryDate: "2026-12-01", receiptDate: "2026-01-01", quantity: 8, status: "available" },
    { _id: "early-new", internalLotCode: "EARLY-B", expiryDate: "2026-06-01", receiptDate: "2026-03-01", quantity: 3, status: "available" },
    { _id: "early-old", internalLotCode: "EARLY-A", expiryDate: "2026-06-01", receiptDate: "2026-02-01", quantity: 4, status: "available" },
  ], 6, "2026-05-01");

  assert.deepEqual(allocations.map(({ lot, quantity }) => [lot._id, quantity]), [
    ["early-old", 4],
    ["early-new", 2],
  ]);
});

test("FEFO blocks expired use-by lots and requires review for expired best-before lots", () => {
  const expiredUseBy = {
    _id: "use-by",
    internalLotCode: "USE-BY",
    expiryDate: "2026-05-01",
    dateLabelType: "use_by",
    receiptDate: "2026-01-01",
    quantity: 5,
    status: "available",
  };
  const expiredBestBefore = {
    _id: "best-before",
    internalLotCode: "BEST-BEFORE",
    expiryDate: "2026-05-02",
    dateLabelType: "best_before",
    receiptDate: "2026-01-01",
    quantity: 5,
    status: "available",
  };

  assert.throws(
    () => planFefoAllocation([expiredUseBy], 1, "2026-05-03"),
    /Expired use-by lots cannot be used/,
  );
  assert.equal(planFefoAllocation([expiredUseBy, {
    _id: "current",
    internalLotCode: "CURRENT",
    expiryDate: "2026-06-01",
    dateLabelType: "use_by",
    receiptDate: "2026-01-02",
    quantity: 5,
    status: "available",
  }], 1, "2026-05-03")[0].lot._id, "current");
  assert.throws(
    () => planFefoAllocation([expiredBestBefore], 1, "2026-05-03"),
    /Supervisor review is required/,
  );
  const reviewed = planFefoAllocation([expiredUseBy, expiredBestBefore], 1, "2026-05-03", "Quality supervisor approved");
  assert.equal(reviewed[0].lot._id, "best-before");
  assert.equal(reviewed[0].bestBeforeReviewReason, "Quality supervisor approved");
});

test("opening-lot migration reconciles aggregate balances and blocks orphaned lots", () => {
  const materials = [{ _id: materialId, code: "FLOUR", name: "Flour", category: "Ingredients", unit: "kg" }];
  const report = buildLotMigrationPlan({
    materials,
    balances: [
      { materialId, location: "Main Warehouse", quantity: 10 },
      { materialId, location: "Bakery", quantity: 3 },
    ],
    lotBalances: [{ materialId, location: "Main Warehouse", quantity: 4 }],
  });
  assert.equal(report.mode, "dry-run");
  assert.equal(report.openingLotCount, 2);
  assert.equal(report.openingQuantity, 9);
  assert.deepEqual(report.plans.map((plan) => [plan.location, plan.openingQuantity]), [
    ["Main Warehouse", 6],
    ["Bakery", 3],
  ]);

  const blocked = buildLotMigrationPlan({
    materials,
    balances: [],
    lotBalances: [{ materialId, lotId: "507f1f77bcf86cd799439012", location: "Unmapped", quantity: 2 }],
  });
  assert.equal(blocked.plans.length, 0);
  assert.match(blocked.blockers[0].reason, /no matching aggregate balance/);

  const overAllocated = buildLotMigrationPlan({
    materials,
    balances: [{ materialId, location: "Main Warehouse", quantity: 2 }],
    lotBalances: [{ materialId, location: "Main Warehouse", quantity: 3 }],
  });
  assert.match(overAllocated.blockers[0].reason, /exceeds the aggregate balance/);
});

test("raw-material expiry notifications identify the lot and date policy", () => {
  const lot = {
    _id: "507f1f77bcf86cd799439012",
    internalLotCode: "RMLOT-123",
    supplierLotReference: "SUP-77",
    expiryDate: "2026-05-01",
    dateLabelType: "use_by",
  };
  const material = { name: "Flour", unit: "kg" };
  const notification = notificationFor(lot, material, "expired", 4, ["Main Warehouse"], new Date("2026-05-02T00:00:00Z"));

  assert.equal(notification.resource.type, "raw_material_lot");
  assert.equal(notification.resource.id, lot._id);
  assert.equal(notification.severity, "urgent");
  assert.match(notification.message, /SUP-77/);
  assert.ok(notification.recipientRoles.includes("Inventory Manager"));
});
