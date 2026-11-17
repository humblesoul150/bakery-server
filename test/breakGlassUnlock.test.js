const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const User = require("../models/user");
const audit = require("../lib/audit");
const { breakGlassUnlockAccount } = require("../scripts/breakGlassUnlockAccount");

function lockedSuperAdmin() {
  return {
    _id: "507f1f77bcf86cd799439010",
    email: "admin@example.com",
    roles: ["Super Admin"],
    status: "Active",
    manualUnlockRequiredAt: new Date("2026-01-01T10:00:00.000Z"),
    failedLoginHistory: [new Date()],
    lockoutHistory: [new Date()],
    save: async () => {},
  };
}

test("break-glass unlock is audited and limited to a sole manually locked Super Admin", async (t) => {
  const originals = {
    startSession: mongoose.startSession,
    findById: User.findById,
    exists: User.exists,
    recordAudit: audit.recordAudit,
  };
  const transaction = {
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  };
  const target = lockedSuperAdmin();
  let auditEvent;
  mongoose.startSession = async () => transaction;
  User.findById = () => ({ session: async () => target });
  User.exists = () => ({ session: async () => null });
  audit.recordAudit = async (event) => {
    auditEvent = event;
  };
  t.after(() => {
    mongoose.startSession = originals.startSession;
    User.findById = originals.findById;
    User.exists = originals.exists;
    audit.recordAudit = originals.recordAudit;
  });

  const result = await breakGlassUnlockAccount({
    userId: target._id,
    operator: "On-call database administrator",
    reason: "Emergency recovery approved under incident INC-42",
  });

  assert.deepEqual(result, { id: target._id, email: target.email });
  assert.equal(target.manualUnlockRequiredAt, undefined);
  assert.deepEqual(target.failedLoginHistory, []);
  assert.deepEqual(target.lockoutHistory, []);
  assert.equal(auditEvent.eventType, "account.lockout_unlocked");
  assert.equal(auditEvent.reason, "break_glass_recovery");
  assert.equal(auditEvent.details.breakGlassOperator, "On-call database administrator");
  assert.equal(auditEvent.details.unlockReason, "Emergency recovery approved under incident INC-42");
  assert.equal(auditEvent.transaction, transaction);
});

test("break-glass recovery refuses to bypass an active peer Super Admin", async (t) => {
  const originals = {
    startSession: mongoose.startSession,
    findById: User.findById,
    exists: User.exists,
  };
  const transaction = {
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  };
  const target = lockedSuperAdmin();
  mongoose.startSession = async () => transaction;
  User.findById = () => ({ session: async () => target });
  User.exists = () => ({ session: async () => ({ _id: "peer" }) });
  t.after(() => {
    mongoose.startSession = originals.startSession;
    User.findById = originals.findById;
    User.exists = originals.exists;
  });

  await assert.rejects(
    breakGlassUnlockAccount({
      userId: target._id,
      operator: "On-call database administrator",
      reason: "Emergency recovery approved",
    }),
    /active peer Super Admin exists/,
  );
  assert.ok(target.manualUnlockRequiredAt);
});
