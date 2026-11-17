const mongoose = require("mongoose");
const User = require("../models/user");
const audit = require("../lib/audit");

async function breakGlassUnlockAccount({ userId, operator, reason }) {
  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error("Provide a valid target Super Admin user ID.");
  }
  const operatorName = typeof operator === "string" ? operator.trim() : "";
  const unlockReason = typeof reason === "string" ? reason.trim() : "";
  if (!operatorName || operatorName.length > 120) {
    throw new Error("Provide the break-glass operator name (1 to 120 characters).");
  }
  if (!unlockReason || unlockReason.length > 500) {
    throw new Error("Provide an unlock reason (1 to 500 characters).");
  }

  const transaction = await mongoose.startSession();
  let result;
  try {
    await transaction.withTransaction(async () => {
      const target = await User.findById(userId).session(transaction);
      if (!target) throw new Error("Target account was not found.");
      if (
        target.status !== "Active"
        || !target.roles.includes("Super Admin")
        || !target.manualUnlockRequiredAt
      ) {
        throw new Error("Break-glass recovery applies only to a manually locked active Super Admin.");
      }

      const activePeer = await User.exists({
        _id: { $ne: target._id },
        roles: "Super Admin",
        status: "Active",
      }).session(transaction);
      if (activePeer) {
        throw new Error("An active peer Super Admin exists; use the audited account-unlock action.");
      }

      target.failedLoginHistory = [];
      target.lockoutHistory = [];
      target.lockedUntil = undefined;
      target.manualUnlockRequiredAt = undefined;
      await target.save({ session: transaction });
      await audit.recordAudit({
        eventType: "account.lockout_unlocked",
        outcome: "success",
        target,
        reason: "break_glass_recovery",
        details: {
          breakGlassOperator: operatorName,
          unlockReason,
          managerOverride: true,
        },
        transaction,
      });
      result = { id: String(target._id), email: target.email };
    });
  } finally {
    await transaction.endSession();
  }
  return result;
}

async function ask(question, readline) {
  return new Promise((resolve) => readline.question(question, resolve));
}

async function runBreakGlass() {
  const { createInterface } = require("node:readline/promises");
  const { stdin, stdout } = require("node:process");
  const readline = createInterface({ input: stdin, output: stdout });
  let input;
  try {
    input = {
      userId: await ask("Locked Super Admin user ID: ", readline),
      operator: await ask("Break-glass operator name: ", readline),
      reason: await ask("Reason for emergency unlock: ", readline),
    };
  } finally {
    readline.close();
  }

  require("dotenv").config();
  const databaseUrl = String(process.env.DB_URL || "").trim();
  if (!databaseUrl) throw new Error("Set DB_URL in the server environment.");
  await mongoose.connect(databaseUrl);
  try {
    const result = await breakGlassUnlockAccount(input);
    console.log(`Unlocked ${result.email} (${result.id}); audit event account.lockout_unlocked recorded.`);
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  runBreakGlass().catch((error) => {
    console.error("Break-glass unlock failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { breakGlassUnlockAccount };
