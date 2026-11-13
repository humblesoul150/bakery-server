const assert = require("node:assert/strict");
const { test } = require("node:test");
const FinishedStockExpiryAlert = require("../models/finishedStockExpiryAlert");
const {
  companyDate,
  expiryStage,
  notificationFor,
  resolveFinishedStockExpiryAlerts,
} = require("../lib/finishedStockExpiryAlerts");

const lot = {
  _id: "507f1f77bcf86cd799439011",
  reference: "BATCH-20260610-ABC12345-BREAD-LOAF",
  productName: "Sourdough loaf",
  saleUnit: "loaf",
  remainingQuantity: 12,
  expiryDate: "2026-06-12",
  responsibleUserId: "507f1f77bcf86cd799439012",
};

test("finished-stock expiry stages follow Kampala calendar days", () => {
  assert.equal(companyDate(new Date("2026-06-10T21:30:00.000Z")), "2026-06-11");
  assert.equal(expiryStage(-1), "expired");
  assert.equal(expiryStage(0), "expiry_day");
  assert.equal(expiryStage(1), "one_day");
  assert.equal(expiryStage(2), "two_days");
  assert.equal(expiryStage(3), null);
});

test("expiry notification targets the assigned person or fallback responsible roles", () => {
  const notification = notificationFor(lot, "one_day", new Date("2026-06-11T12:00:00.000Z"));
  assert.equal(notification.eventKey, `finished-stock-expiry:${lot._id}:one_day`);
  assert.equal(notification.resource.type, "finished_stock_lot");
  assert.deepEqual(notification.recipientIds, [lot.responsibleUserId]);
  assert.deepEqual(notification.recipientRoles, []);
  assert.match(notification.message, /12 loaf remaining/);

  const unassigned = notificationFor({ ...lot, responsibleUserId: null }, "expired", new Date());
  assert.deepEqual(unassigned.recipientIds, []);
  assert.ok(unassigned.recipientRoles.includes("Production Manager"));
  assert.equal(unassigned.severity, "urgent");
});

test("depleted lots resolve all active expiry stages", async () => {
  const originalUpdateMany = FinishedStockExpiryAlert.updateMany;
  const update = { modifiedCount: 2 };
  let captured;
  FinishedStockExpiryAlert.updateMany = async (...args) => {
    captured = args;
    return update;
  };
  try {
    const now = new Date("2026-06-12T12:00:00.000Z");
    const resolved = await resolveFinishedStockExpiryAlerts(lot._id, now);
    assert.equal(resolved, 2);
    assert.deepEqual(captured[0], { lotId: lot._id, status: "active" });
    assert.deepEqual(captured[1], { $set: { status: "resolved", resolvedAt: now } });
  } finally {
    FinishedStockExpiryAlert.updateMany = originalUpdateMany;
  }
});

