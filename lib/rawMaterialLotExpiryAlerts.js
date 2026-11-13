const mongoose = require("mongoose");
const RawMaterial = require("../models/rawMaterial");
const RawMaterialBalance = require("../models/rawMaterialBalance");
const RawMaterialLot = require("../models/rawMaterialLot");
const RawMaterialLotBalance = require("../models/rawMaterialLotBalance");
const RawMaterialLotExpiryAlert = require("../models/rawMaterialLotExpiryAlert");
const { enqueueNotificationEvent } = require("./notificationEvents");
const { addCalendarDays, companyDate, dayDifference, expiryStage } = require("./finishedStockExpiryAlerts");

const FALLBACK_ROLES = ["Production Manager", "Inventory Manager", "Admin", "Super Admin"];

function notificationFor(lot, material, stage, quantity, locations, now) {
  const pastUseBy = lot.dateLabelType === "use_by";
  const descriptions = {
    two_days: { title: "Raw material expires in two days", severity: "info", timing: "in two days" },
    one_day: { title: "Raw material expires tomorrow", severity: "action_required", timing: "tomorrow" },
    expiry_day: { title: "Raw material reaches its date label today", severity: "action_required", timing: "today" },
    expired: pastUseBy
      ? { title: "Raw material lot is past its use-by date", severity: "urgent", timing: "already" }
      : { title: "Raw material lot is past its best-before date", severity: "action_required", timing: "already; supervisor review is required" },
  };
  const notice = descriptions[stage];
  return {
    eventKey: `raw-material-expiry:${lot._id}:${stage}`,
    type: "inventory.raw_material_lot_expiring",
    category: "inventory",
    severity: notice.severity,
    title: notice.title,
    message: `${material.name} lot ${lot.internalLotCode} (${lot.supplierLotReference || "supplier lot unknown"}) has ${quantity} ${material.unit} remaining and is ${notice.timing} (${lot.expiryDate}) at ${locations.join(", ")}.`,
    resource: { type: "raw_material_lot", id: String(lot._id), reference: lot.internalLotCode },
    recipientIds: [],
    recipientRoles: FALLBACK_ROLES,
    occurredAt: now,
  };
}

async function createStageAlert(lot, material, stage, now) {
  const session = await mongoose.startSession();
  let created = false;
  try {
    await session.withTransaction(async () => {
      const existing = await RawMaterialLotExpiryAlert.findOne({ lotId: lot._id, stage }).session(session);
      if (existing) return;
      const lotBalances = await RawMaterialLotBalance.find({
        lotId: lot._id,
        quantity: { $gt: 0 },
      }).session(session).lean();
      const locations = lotBalances.map((balance) => balance.location);
      const aggregateBalances = await RawMaterialBalance.find({
        materialId: material._id,
        location: { $in: locations },
      }).session(session).lean();
      const recipients = [...new Set(aggregateBalances
        .map((balance) => balance.responsibleUserId ? String(balance.responsibleUserId) : "")
        .filter(Boolean))];
      const event = notificationFor(
        lot,
        material,
        stage,
        lotBalances.reduce((total, balance) => total + balance.quantity, 0),
        locations,
        now,
      );
      if (recipients.length) {
        event.recipientIds = recipients;
        event.recipientRoles = FALLBACK_ROLES;
      }
      await RawMaterialLotExpiryAlert.create([{
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

async function resolveInactiveLotAlerts(now = new Date()) {
  const alerts = await RawMaterialLotExpiryAlert.find({ status: "active" }).select("lotId").lean();
  if (!alerts.length) return 0;
  const lotIds = [...new Set(alerts.map((alert) => String(alert.lotId)))];
  const activeBalances = await RawMaterialLotBalance.find({
    lotId: { $in: lotIds },
    quantity: { $gt: 0 },
  }).distinct("lotId");
  const activeSet = new Set(activeBalances.map(String));
  const inactive = lotIds.filter((lotId) => !activeSet.has(lotId));
  if (!inactive.length) return 0;
  const result = await RawMaterialLotExpiryAlert.updateMany(
    { lotId: { $in: inactive }, status: "active" },
    { $set: { status: "resolved", resolvedAt: now } },
  );
  return result.modifiedCount;
}

async function generateRawMaterialLotExpiryAlerts(now = new Date()) {
  const today = companyDate(now);
  const latestDate = addCalendarDays(today, 2);
  const lots = await RawMaterialLot.find({
    status: { $in: ["available", "quarantined"] },
    expiryDate: { $lte: latestDate },
  }).lean();
  let evaluated = 0;
  let created = 0;
  for (const lot of lots) {
    const balance = await RawMaterialLotBalance.find({
      lotId: lot._id,
      quantity: { $gt: 0 },
    }).lean();
    if (!balance.length) continue;
    evaluated += 1;
    const stage = expiryStage(dayDifference(today, lot.expiryDate));
    if (!stage) continue;
    const material = await RawMaterial.findById(lot.materialId).lean();
    if (!material) continue;
    if (await createStageAlert(lot, material, stage, now)) created += 1;
  }
  const resolved = await resolveInactiveLotAlerts(now);
  return { evaluated, created, resolved };
}

module.exports = {
  generateRawMaterialLotExpiryAlerts,
  notificationFor,
  resolveInactiveLotAlerts,
};
