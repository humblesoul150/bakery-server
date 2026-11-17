const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  activeManagerRole,
  canUnlockAccount,
  lockoutManagerRoleTiers,
  registerFailedSignIn,
} = require("../lib/accountLockout");

const policy = {
  lockoutEnabled: true,
  maxAttempts: 3,
  attemptWindow: 15,
  lockDuration: 15,
  maxLockoutsBeforeManual: 2,
  escalationWindowHours: 24,
  notifyLockouts: true,
};

function manager(id, role) {
  return { _id: id, roles: [role], status: "Active" };
}

test("repeated failures temporarily lock an account, then require manual unlock", () => {
  const firstLockAt = new Date("2026-01-01T10:00:00.000Z");
  const user = {
    _id: "staff",
    failedLoginHistory: [],
    lockoutHistory: [],
  };

  assert.equal(registerFailedSignIn(user, policy, new Date(firstLockAt.getTime() - 2)).state, "none");
  assert.equal(registerFailedSignIn(user, policy, new Date(firstLockAt.getTime() - 1)).state, "none");
  assert.equal(registerFailedSignIn(user, policy, firstLockAt).state, "temporarily_locked");
  assert.equal(user.lockedUntil.toISOString(), "2026-01-01T10:15:00.000Z");
  assert.equal(user.lockoutHistory.length, 1);
  assert.equal(user.failedLoginHistory.length, 0);

  const secondLockAt = new Date("2026-01-01T10:16:00.000Z");
  assert.equal(registerFailedSignIn(user, policy, new Date(secondLockAt.getTime() - 2)).state, "none");
  assert.equal(registerFailedSignIn(user, policy, new Date(secondLockAt.getTime() - 1)).state, "none");
  assert.equal(registerFailedSignIn(user, policy, secondLockAt).state, "manual_unlock_required");
  assert.equal(user.manualUnlockRequiredAt.toISOString(), secondLockAt.toISOString());
  assert.equal(user.lockedUntil, undefined);
});

test("failed attempts outside the configured window start a fresh counter", () => {
  const user = {
    failedLoginHistory: [
      new Date("2026-01-01T09:00:00.000Z"),
      new Date("2026-01-01T09:01:00.000Z"),
    ],
  };
  const now = new Date("2026-01-01T09:16:00.000Z");

  assert.deepEqual(registerFailedSignIn(user, policy, now), { state: "none", attempts: 1 });
  assert.deepEqual(user.failedLoginHistory.map((date) => date.toISOString()), [
    "2026-01-01T09:16:00.000Z",
  ]);
});

test("lockout escalation counts only temporary lockouts in the rolling escalation window", () => {
  const user = {
    failedLoginHistory: [],
    lockoutHistory: [new Date("2026-01-01T08:29:00.000Z")],
  };
  const secondLockoutAt = new Date("2026-01-02T08:30:00.000Z");

  registerFailedSignIn(user, policy, new Date(secondLockoutAt.getTime() - 2));
  registerFailedSignIn(user, policy, new Date(secondLockoutAt.getTime() - 1));
  assert.equal(registerFailedSignIn(user, policy, secondLockoutAt).state, "temporarily_locked");
  assert.deepEqual(user.lockoutHistory.map((date) => date.toISOString()), [
    "2026-01-02T08:30:00.000Z",
  ]);
});

test("manual unlock authorization follows the manager chain and allows audited fallback only when needed", () => {
  const target = {
    _id: "staff",
    roles: ["Sales Manager"],
    manualUnlockRequiredAt: new Date(),
  };
  const hr = manager("hr", "Human Resource");
  const gm = manager("gm", "General Manager");
  const superAdmin = manager("sa", "Super Admin");

  assert.deepEqual(lockoutManagerRoleTiers(target), [
    ["Human Resource"],
    ["General Manager"],
    ["Super Admin"],
  ]);
  assert.deepEqual(canUnlockAccount(hr, target, [hr, gm, superAdmin]), {
    allowed: true,
    role: "Human Resource",
    override: false,
  });
  assert.equal(canUnlockAccount(gm, target, [hr, gm, superAdmin]).allowed, false);
  assert.deepEqual(canUnlockAccount(gm, target, [gm, superAdmin]), {
    allowed: true,
    role: "General Manager",
    override: true,
  });
  assert.equal(canUnlockAccount(superAdmin, target, [hr, superAdmin]).allowed, false);
  assert.equal(activeManagerRole(target, [hr, gm, superAdmin]), "Human Resource");
  assert.equal(activeManagerRole(target, [gm, superAdmin]), "General Manager");
});

test("Super Admin lockouts require an active peer and never allow self-unlock", () => {
  const target = {
    _id: "sa-target",
    roles: ["Super Admin"],
    manualUnlockRequiredAt: new Date(),
  };
  const peer = manager("sa-peer", "Super Admin");

  assert.deepEqual(canUnlockAccount(peer, target, [target, peer]), {
    allowed: true,
    role: "Super Admin",
    override: false,
  });
  assert.equal(canUnlockAccount(target, target, [target]).allowed, false);
  assert.equal(canUnlockAccount(peer, target, [target]).allowed, false);
});
