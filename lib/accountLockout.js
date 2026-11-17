const mongoose = require("mongoose");
const User = require("../models/user");
const audit = require("./audit");
const { enqueueNotificationEvent } = require("./notificationEvents");

const LOCKOUT_MANAGER_ROLES = [
  "Super Admin",
  "General Manager",
  "Human Resource",
];

function lockoutManagerRoleTiers(target) {
  const roles = target?.roles || [];
  if (roles.includes("Super Admin")) return [["Super Admin"]];
  if (roles.includes("Admin") || roles.includes("General Manager")) {
    return [["Super Admin"]];
  }
  if (roles.includes("Human Resource")) {
    return [["General Manager"], ["Super Admin"]];
  }
  return [["Human Resource"], ["General Manager"], ["Super Admin"]];
}

function activeManagerRole(target, activeManagers) {
  const targetId = String(target._id || target.id);
  for (const [role] of lockoutManagerRoleTiers(target)) {
    const hasManager = activeManagers.some((manager) =>
      String(manager._id || manager.id) !== targetId
      && manager.status === "Active"
      && manager.roles?.includes(role),
    );
    if (hasManager) return role;
  }
  return null;
}

function canUnlockAccount(actor, target, activeManagers) {
  if (
    !actor
    || !target
    || !target.manualUnlockRequiredAt
    || String(actor._id || actor.id) === String(target._id || target.id)
  ) return { allowed: false, role: null, override: false };

  const actorId = String(actor._id || actor.id);
  for (const [role] of lockoutManagerRoleTiers(target)) {
    const managers = activeManagers.filter((manager) =>
      String(manager._id || manager.id) !== String(target._id || target.id)
      && manager.status === "Active"
      && manager.roles?.includes(role),
    );
    if (!managers.length) continue;
    const allowed = actor.roles?.includes(role)
      && managers.some((manager) => String(manager._id || manager.id) === actorId);
    return { allowed: Boolean(allowed), role, override: role !== lockoutManagerRoleTiers(target)[0][0] };
  }
  return { allowed: false, role: null, override: false };
}

function registerFailedSignIn(user, settings, occurredAt) {
  const attemptWindowStart = occurredAt.getTime() - settings.attemptWindow * 60 * 1000;
  const attempts = (user.failedLoginHistory || [])
    .map((attemptAt) => new Date(attemptAt))
    .filter((attemptAt) => attemptAt.getTime() > attemptWindowStart);
  attempts.push(occurredAt);
  user.failedLoginHistory = attempts;

  if (attempts.length < settings.maxAttempts) {
    return { state: "none", attempts: attempts.length };
  }

  const escalationWindowStart = occurredAt.getTime()
    - settings.escalationWindowHours * 60 * 60 * 1000;
  const recentLockouts = (user.lockoutHistory || [])
    .map((lockoutAt) => new Date(lockoutAt))
    .filter((lockoutAt) => lockoutAt.getTime() > escalationWindowStart);
  recentLockouts.push(occurredAt);
  user.lockoutHistory = recentLockouts;
  user.failedLoginHistory = [];

  if (recentLockouts.length >= settings.maxLockoutsBeforeManual) {
    user.manualUnlockRequiredAt = occurredAt;
    user.lockedUntil = undefined;
    return { state: "manual_unlock_required", attempts: attempts.length };
  }

  user.lockedUntil = new Date(
    occurredAt.getTime() + settings.lockDuration * 60 * 1000,
  );
  return { state: "temporarily_locked", attempts };
}

async function findActiveLockoutManagers(session) {
  return User.find({
    status: "Active",
    roles: { $in: LOCKOUT_MANAGER_ROLES },
  }).select("_id roles status").session(session).lean();
}

async function enqueueLockoutNotification({ target, state, policy, occurredAt, session }) {
  if (!policy.notifyLockouts) return;
  const activeManagers = await findActiveLockoutManagers(session);
  const recipientRole = activeManagerRole(target, activeManagers);
  if (!recipientRole) return;

  const manual = state === "manual_unlock_required";
  const cycle = target.lockoutHistory?.length || 0;
  await enqueueNotificationEvent({
    eventKey: `account-lockout:${target._id}:${state}:${cycle}:${occurredAt.getTime()}`,
    type: manual ? "account.lockout.manual_unlock_required" : "account.lockout.temporary",
    category: "security",
    severity: manual ? "urgent" : "action_required",
    title: manual ? "Account requires manual unlock" : "Account temporarily locked",
    message: manual
      ? `${target.name}'s account requires a manager to unlock it after repeated temporary lockouts.`
      : `${target.name}'s account is temporarily locked until ${target.lockedUntil.toISOString()}.`,
    resource: {
      type: "user",
      id: String(target._id),
      reference: target.name.slice(0, 100),
    },
    recipientRoles: [recipientRole],
    excludeRecipientIds: [String(target._id)],
    occurredAt,
  }, session);
}

async function recordFailedSignIn({ request, userId, settings }) {
  const occurredAt = new Date();
  const transaction = await mongoose.startSession();
  let lockoutState = "none";
  try {
    await transaction.withTransaction(async () => {
      lockoutState = "none";
      const user = await User.findById(userId).session(transaction);
      if (!user) {
        await audit.recordAudit({
          request,
          eventType: "auth.login.failed",
          outcome: "failure",
          reason: "invalid_credentials",
          target: { _id: userId },
          transaction,
        });
        return;
      }

      const manuallyLocked = Boolean(user.manualUnlockRequiredAt);
      const temporarilyLocked = user.lockedUntil && user.lockedUntil > occurredAt;
      if (!settings.lockoutEnabled || user.status !== "Active" || manuallyLocked || temporarilyLocked) {
        await audit.recordAudit({
          request,
          eventType: "auth.login.failed",
          outcome: "failure",
          reason: "invalid_credentials",
          target: user,
          transaction,
        });
        return;
      }

      await audit.recordAudit({
        request,
        eventType: "auth.login.failed",
        outcome: "failure",
        reason: "invalid_credentials",
        target: user,
        transaction,
      });

      const transition = registerFailedSignIn(user, settings, occurredAt);
      if (transition.state === "none") {
        await user.save({ session: transaction });
        return;
      }

      const requiresManualUnlock = transition.state === "manual_unlock_required";
      lockoutState = transition.state;
      await user.save({ session: transaction });

      await audit.recordAudit({
        request,
        eventType: requiresManualUnlock
          ? "auth.login.manual_unlock_required"
          : "auth.login.locked_out",
        outcome: "denied",
        reason: requiresManualUnlock ? "repeated_lockouts" : "failed_attempt_limit",
        target: user,
        details: {
          maxAttempts: settings.maxAttempts,
          attemptWindow: settings.attemptWindow,
          lockDuration: settings.lockDuration,
          lockoutCycleCount: user.lockoutHistory.length,
          maxLockoutsBeforeManual: settings.maxLockoutsBeforeManual,
          escalationWindowHours: settings.escalationWindowHours,
        },
        transaction,
      });
      await enqueueLockoutNotification({
        target: user,
        state: lockoutState,
        policy: settings,
        occurredAt,
        session: transaction,
      });
    });
  } finally {
    await transaction.endSession();
  }
  return { lockoutState };
}

module.exports = {
  activeManagerRole,
  canUnlockAccount,
  findActiveLockoutManagers,
  lockoutManagerRoleTiers,
  registerFailedSignIn,
  recordFailedSignIn,
};
