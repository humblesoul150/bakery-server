const Session = require("../models/session");
const User = require("../models/user");
const { getSecuritySettings } = require("../lib/securitySettings");
const { idleTimeoutMs } = require("../lib/sessionPolicy");
const { hashSessionToken } = require("../lib/sessionTokens");
const { getSessionToken } = require("./authentication");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const ALLOWED_MUTATIONS = new Set([
  "/auth/login",
  "/auth/logout",
  "/auth/change-password",
  "/sessions/activity",
  "/receipts/bulk-export",
]);
const ALLOWED_MUTATION_PREFIXES = [
  "/storefront/messages/",
  "/storefront/newsletter/",
  "/website-communications/",
  "/webhooks/resend",
];

function adminReadOnly(request, response, next) {
  if (
    SAFE_METHODS.has(request.method) ||
    ALLOWED_MUTATIONS.has(request.path) ||
    ALLOWED_MUTATION_PREFIXES.some((prefix) => request.path.startsWith(prefix))
  ) {
    return next();
  }

  const token = getSessionToken(request);
  if (!token) return next();

  return Session.findOne({ tokenHash: hashSessionToken(token) })
    .then(async (session) => {
      const now = new Date();
      if (
        !session ||
        session.revokedAt ||
        session.absoluteExpiresAt <= now
      ) {
        return next();
      }

      const user = await User.findById(session.userId);
      if (
        !user ||
        user.status !== "Active" ||
        session.sessionVersion !== user.sessionVersion
      ) {
        return next();
      }

      const settings = await getSecuritySettings();
      if (
        now.getTime() - session.lastActivityAt.getTime() >=
        idleTimeoutMs(user, settings)
      ) {
        return next();
      }

      if (
        user.roles.includes("Admin") &&
        !user.roles.includes("Super Admin")
      ) {
        return response.status(403).json({
          error: "Admin accounts can view and export data but cannot change resources.",
        });
      }
      return next();
    })
    .catch(next);
}

module.exports = { adminReadOnly };
