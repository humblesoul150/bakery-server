function toPublicUser(user) {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    roles: [...user.roles],
    status: user.status,
    createdAt: user.createdAt?.toISOString(),
    updatedAt: user.updatedAt?.toISOString(),
    lastActive: user.lastActive?.toISOString(),
    suspensionReason: user.suspensionReason || undefined,
    mustChangePassword: Boolean(user.mustChangePassword),
  };
}

function toAccountManagementUser(user, canUnlock = false, now = new Date()) {
  let state = "none";
  if (user.manualUnlockRequiredAt) {
    state = "manual_unlock_required";
  } else if (user.lockedUntil && new Date(user.lockedUntil) > now) {
    state = "temporarily_locked";
  }
  return {
    ...toPublicUser(user),
    lockout: {
      state,
      ...(state === "temporarily_locked"
        ? { lockedUntil: new Date(user.lockedUntil).toISOString() }
        : {}),
      ...(state === "manual_unlock_required"
        ? { manualUnlockRequiredAt: new Date(user.manualUnlockRequiredAt).toISOString() }
        : {}),
      canUnlock: state === "manual_unlock_required" && canUnlock,
    },
  };
}

module.exports = { toAccountManagementUser, toPublicUser };
