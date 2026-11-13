const mongoose = require("mongoose");
const FinishedStockExpiryAlert = require("../models/finishedStockExpiryAlert");
const FinishedStockLot = require("../models/finishedStockLot");
const { enqueueNotificationEvent } = require("./notificationEvents");

const FALLBACK_ROLES = ["Production Manager", "Inventory Manager", "Admin", "Super Admin"];

function companyDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function dayDifference(left, right) {
  return Math.round((Date.parse(`${right}T00:00:00.000Z`) - Date.parse(`${left}T00:00:00.000Z`)) / 86400000);
}

function addCalendarDays(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function expiryStage(daysUntilExpiry) {
  if (daysUntilExpiry < 0) return "expired";
  if (daysUntilExpiry === 0) return "expiry_day";
  if (daysUntilExpiry === 1) return "one_day";
  if (daysUntilExpiry === 2) return "two_days";
  return null;
}

function notificationFor(lot, stage, now) {
  const descriptions = {
    two_days: { title: "Bakery stock expires in two days", severity: "info", timing: "in two days" },
    one_day: { title: "Bakery stock expires tomorrow", severity: "action_required", timing: "tomorrow" },
    expiry_day: { title: "Bakery stock reaches its date label today", severity: "action_required", timing: "today" },
    expired: { title: "Bakery stock is past its date label", severity: "urgent", timing: "already" },
  };
  const notice = descriptions[stage];
  return {
    eventKey: `finished-stock-expiry:${lot._id}:${stage}`,
    type: "inventory.finished_stock_expiring",
    category: "inventory",
    severity: notice.severity,
    title: notice.title,
    message: `${lot.productName} (${lot.reference}) has ${lot.remainingQuantity} ${lot.saleUnit} remaining and expires ${notice.timing} (${lot.expiryDate}).`,
    resource: { type: "finished_stock_lot", id: String(lot._id), reference: lot.reference },
    recipientIds: lot.responsibleUserId ? [String(lot.responsibleUserId)] : [],
    recipientRoles: lot.responsibleUserId ? [] : FALLBACK_ROLES,
    occurredAt: now,
  };
}

async function createStageAlert(lot, stage, now) {
  const session = await mongoose.startSession();
  let created = false;
  try {
    await session.withTransaction(async () => {
      const existing = await FinishedStockExpiryAlert.findOne({ lotId: lot._id, stage }).session(session);
      if (existing) return;
      const event = notificationFor(lot, stage, now);
      await FinishedStockExpiryAlert.create([{
        lotId: lot._id,
        stage,
        status: "active",
        eventKey: event.eventKey,
        triggeredAt: now,
      }], { session });
      await enqueueNotificationEvent(event, session);
      created = true;
    });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    return false;
  } finally {
    await session.endSession();
  }
  return created;
}

async function resolveFinishedStockExpiryAlerts(lotId, now = new Date(), session) {
  const options = session ? { session } : {};
  const result = await FinishedStockExpiryAlert.updateMany(
    { lotId, status: "active" },
    { $set: { status: "resolved", resolvedAt: now } },
    options,
  );
  return result.modifiedCount;
}

async function resolveInactiveLotAlerts(now = new Date()) {
  const activeAlerts = await FinishedStockExpiryAlert.find({ status: "active" }).select("lotId").lean();
  if (!activeAlerts.length) return 0;
  const lotIds = [...new Set(activeAlerts.map((alert) => String(alert.lotId)))];
  const activeLots = await FinishedStockLot.find({
    _id: { $in: lotIds },
    status: "active",
    remainingQuantity: { $gt: 0 },
  }).select("_id").lean();
  const activeIds = new Set(activeLots.map((lot) => String(lot._id)));
  const resolvedLotIds = lotIds.filter((lotId) => !activeIds.has(lotId));
  if (!resolvedLotIds.length) return 0;
  const result = await FinishedStockExpiryAlert.updateMany(
    { lotId: { $in: resolvedLotIds }, status: "active" },
    { $set: { status: "resolved", resolvedAt: now } },
  );
  return result.modifiedCount;
}

async function generateFinishedStockExpiryAlerts(now = new Date()) {
  const today = companyDate(now);
  const latestExpiryDate = addCalendarDays(today, 2);
  const lots = await FinishedStockLot.find({
    status: "active",
    remainingQuantity: { $gt: 0 },
    expiryDate: { $lte: latestExpiryDate },
  }).lean();
  let created = 0;
  for (const lot of lots) {
    const stage = expiryStage(dayDifference(today, lot.expiryDate));
    if (stage && await createStageAlert(lot, stage, now)) created += 1;
  }
  const resolved = await resolveInactiveLotAlerts(now);
  return { evaluated: lots.length, created, resolved };
}

module.exports = {
  addCalendarDays,
  companyDate,
  dayDifference,
  expiryStage,
  generateFinishedStockExpiryAlerts,
  notificationFor,
  resolveFinishedStockExpiryAlerts,
};
