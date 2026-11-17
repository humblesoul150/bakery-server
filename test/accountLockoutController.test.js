const assert = require("node:assert/strict");
const { test } = require("node:test");
const mongoose = require("mongoose");
const User = require("../models/user");
const audit = require("../lib/audit");
const { unlockUserAccount } = require("../controllers/userController");

function createResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function lockedTarget() {
  return {
    _id: "507f1f77bcf86cd799439010",
    name: "Staff Member",
    email: "staff@example.com",
    roles: ["Sales Manager"],
    status: "Suspended",
    mustChangePassword: false,
    manualUnlockRequiredAt: new Date("2026-01-01T10:00:00.000Z"),
    failedLoginHistory: [new Date()],
    lockoutHistory: [new Date()],
    save: async () => {},
  };
}

test("manual unlock requires a reason before opening a database transaction", async () => {
  const originalStartSession = mongoose.startSession;
  mongoose.startSession = async () => {
    throw new Error("A transaction must not start for invalid input.");
  };
  try {
    const response = createResponse();
    await unlockUserAccount(
      { params: { id: "507f1f77bcf86cd799439010" }, body: {} },
      response,
    );
    assert.equal(response.statusCode, 400);
    assert.match(response.body.error, /reason is required/);
  } finally {
    mongoose.startSession = originalStartSession;
  }
});

test("authorized manual unlock is audited and does not change account status", async (t) => {
  const originals = {
    startSession: mongoose.startSession,
    findById: User.findById,
    find: User.find,
    recordAudit: audit.recordAudit,
  };
  const transaction = {
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  };
  const target = lockedTarget();
  const hr = {
    _id: "507f1f77bcf86cd799439011",
    roles: ["Human Resource"],
    status: "Active",
  };
  let auditEvent;
  mongoose.startSession = async () => transaction;
  User.findById = () => ({ session: async () => target });
  User.find = () => ({
    select() { return this; },
    session() { return this; },
    lean: async () => [hr],
  });
  audit.recordAudit = async (event) => {
    auditEvent = event;
  };
  t.after(() => {
    mongoose.startSession = originals.startSession;
    User.findById = originals.findById;
    User.find = originals.find;
    audit.recordAudit = originals.recordAudit;
  });

  const response = createResponse();
  await unlockUserAccount({
    params: { id: target._id },
    body: { reason: "Identity verified with the account holder" },
    authUser: hr,
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(target.status, "Suspended");
  assert.equal(target.manualUnlockRequiredAt, undefined);
  assert.deepEqual(target.failedLoginHistory, []);
  assert.deepEqual(target.lockoutHistory, []);
  assert.equal(response.body.user.lockout.state, "none");
  assert.equal(auditEvent.eventType, "account.lockout_unlocked");
  assert.equal(auditEvent.reason, "manager_unlock");
  assert.equal(auditEvent.details.unlockReason, "Identity verified with the account holder");
  assert.equal(auditEvent.details.managerRole, "Human Resource");
  assert.equal(auditEvent.transaction, transaction);
});

test("a higher manager cannot bypass an active responsible manager tier", async (t) => {
  const originals = {
    startSession: mongoose.startSession,
    findById: User.findById,
    find: User.find,
  };
  const transaction = {
    withTransaction: async (callback) => callback(),
    endSession: async () => {},
  };
  const target = lockedTarget();
  const hr = {
    _id: "507f1f77bcf86cd799439011",
    roles: ["Human Resource"],
    status: "Active",
  };
  const gm = {
    _id: "507f1f77bcf86cd799439012",
    roles: ["General Manager"],
    status: "Active",
  };
  mongoose.startSession = async () => transaction;
  User.findById = () => ({ session: async () => target });
  User.find = () => ({
    select() { return this; },
    session() { return this; },
    lean: async () => [hr, gm],
  });
  t.after(() => {
    mongoose.startSession = originals.startSession;
    User.findById = originals.findById;
    User.find = originals.find;
  });

  const response = createResponse();
  await unlockUserAccount({
    params: { id: target._id },
    body: { reason: "Override attempt" },
    authUser: gm,
  }, response);

  assert.equal(response.statusCode, 403);
  assert.match(response.body.error, /responsible manager/);
});
