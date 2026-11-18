require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const Sale = require("../models/sale");
const SalePayment = require("../models/salePayment");
const Order = require("../models/order");
const OrderPayment = require("../models/orderPayment");
const ReceiptManagementState = require("../models/receiptManagementState");
const Notification = require("../models/notification");

function argumentValue(args, name) {
  const prefix = `${name}=`;
  const inline = args.find((argument) => argument.startsWith(prefix));
  return inline ? inline.slice(prefix.length) : undefined;
}

function databaseName(dbUrl) {
  try {
    const parsed = new URL(dbUrl);
    return decodeURIComponent(parsed.pathname.replace(/^\/+/, "").split("?")[0]);
  } catch {
    return "";
  }
}

async function buildPurgePlan() {
  const sales = await Sale.find({
    $or: [
    ],
  }).lean();
  const saleIds = sales.map((sale) => sale._id);
  const [payments, linkedOrders, receiptStates, notifications] = await Promise.all([
    SalePayment.find({ saleId: { $in: saleIds } }).lean(),
    Order.find({ saleId: { $in: saleIds } }).lean(),
    ReceiptManagementState.find({ sourceType: "sale", sourceId: { $in: saleIds } }).lean(),
    Notification.find({
      "resource.type": "sale",
      "resource.id": { $in: sales.map((sale) => String(sale._id)) },
    }).lean(),
  ]);
  const orderPayments = payments.length
    ? await OrderPayment.find({ salePaymentId: { $in: payments.map((payment) => payment._id) } }).lean()
    : [];
  return { sales, payments, linkedOrders, receiptStates, notifications, orderPayments };
}

function reconcilePlan(plan) {
  const blockers = [];
  if (!plan.sales.length) return blockers;
  const unpaid = plan.sales.filter((sale) =>
    Number(sale.paidAmount || 0) < Number(sale.total || 0)
  );
  if (unpaid.length) blockers.push({
    scope: "credit",
    count: unpaid.length,
    reason: "Affected sales include unpaid or partially paid balances.",
  });
  if (plan.linkedOrders.length) blockers.push({
    scope: "orders",
    count: plan.linkedOrders.length,
    reason: "Affected sales are linked from orders; resolve or retire those order links first.",
  });
  if (plan.orderPayments.length) blockers.push({
    scope: "order-payments",
    count: plan.orderPayments.length,
    reason: "Affected sale payments are linked from order payments.",
  });
  return blockers;
}

async function applyPurge(plan, actorId) {
  if (!mongoose.isValidObjectId(actorId)) throw new Error("A valid Super Admin actor ID is required.");
  const blockers = reconcilePlan(plan);
  if (blockers.length) throw new Error(`Purge blockers remain: ${JSON.stringify(blockers)}`);
  if (!plan.sales.length) return { deletedSales: 0, deletedPayments: 0, deletedReceiptStates: 0, deletedNotifications: 0 };

  const User = require("../models/user");
  const actor = await User.findOne({ _id: actorId, status: "Active", roles: "Super Admin" }).lean();
  if (!actor) throw new Error("The purge actor must be an active Super Admin.");
  const audit = require("../lib/audit");
  const saleIds = plan.sales.map((sale) => sale._id);
  const paymentIds = plan.payments.map((payment) => payment._id);
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      await SalePayment.deleteMany({ _id: { $in: paymentIds } }, { session });
      await ReceiptManagementState.deleteMany({
        sourceType: "sale",
        sourceId: { $in: saleIds },
      }, { session });
      await Notification.deleteMany({
        "resource.type": "sale",
        "resource.id": { $in: plan.sales.map((sale) => String(sale._id)) },
      }, { session });
      await Sale.deleteMany({ _id: { $in: saleIds } }, { session });
      await audit.recordAudit({
        eventType: "sale.legacy_purged",
        outcome: "success",
        actor,
        details: {
          saleCount: plan.sales.length,
          paymentCount: plan.payments.length,
          receiptStateCount: plan.receiptStates.length,
          notificationCount: plan.notifications.length,
          reason: "Approved legacy beverage sales cutover purge",
        },
        transaction: session,
      });
      result = {
        deletedSales: plan.sales.length,
        deletedPayments: plan.payments.length,
        deletedReceiptStates: plan.receiptStates.length,
        deletedNotifications: plan.notifications.length,
      };
    });
  } finally {
    await session.endSession();
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  if (!process.env.DB_URL) throw new Error("DB_URL is required.");
  const target = databaseName(process.env.DB_URL);
  if (!target || argumentValue(args, "--confirm-database") !== target) {
    throw new Error("Pass --confirm-database with the exact database name from DB_URL.");
  }
  await mongoose.connect(process.env.DB_URL);
  try {
    const plan = await buildPurgePlan();
    const blockers = reconcilePlan(plan);
    const report = {
      mode: args.includes("--apply") ? "apply-preview" : "dry-run",
      database: target,
      sales: plan.sales.length,
      payments: plan.payments.length,
      linkedOrders: plan.linkedOrders.length,
      receiptStates: plan.receiptStates.length,
      notifications: plan.notifications.length,
      orderPayments: plan.orderPayments.length,
      outstandingSaleCount: plan.sales.filter((sale) =>
        Number(sale.paidAmount || 0) < Number(sale.total || 0)
      ).length,
      blockers,
    };
    console.log(JSON.stringify(report, null, 2));
    if (!args.includes("--apply")) return;
    if (blockers.length) {
      process.exitCode = 2;
      return;
    }
    if (argumentValue(args, "--confirm-purge") !== "DELETE_LEGACY_BEVERAGE_SALES") {
      throw new Error("Applying requires --confirm-purge=DELETE_LEGACY_BEVERAGE_SALES.");
    }
    const backupFile = argumentValue(args, "--backup-file");
    if (!backupFile) throw new Error("Applying requires --backup-file=<absolute-path>.");
    const resolvedBackup = path.resolve(backupFile);
    fs.mkdirSync(path.dirname(resolvedBackup), { recursive: true });
    fs.writeFileSync(resolvedBackup, JSON.stringify({
      createdAt: new Date().toISOString(),
      database: target,
      sales: plan.sales,
      payments: plan.payments,
      receiptStates: plan.receiptStates,
      notifications: plan.notifications,
    }, null, 2));
    const result = await applyPurge(plan, argumentValue(args, "--actor-id"));
    console.log(JSON.stringify({ ...result, backupFile: resolvedBackup }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { buildPurgePlan, reconcilePlan };
