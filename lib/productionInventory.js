const RawMaterial = require("../models/rawMaterial");
const RawMaterialBalance = require("../models/rawMaterialBalance");
const RawMaterialMovement = require("../models/rawMaterialMovement");
const RawMaterialAlert = require("../models/rawMaterialAlert");
const { applyRawMaterialLotMovement } = require("./rawMaterialLotInventory");
const { enqueueNotificationEvent } = require("./notificationEvents");

async function ensureRawBalance(materialId, location, userId, session) {
  await RawMaterialBalance.findOneAndUpdate(
    { materialId, location },
    { $setOnInsert: { quantity: 0, reorderThreshold: 0, updatedBy: userId } },
    { upsert: true, new: true, session, setDefaultsOnInsert: true },
  );
}

async function refreshRawMaterialAlert(materialId, location, session) {
  const [balance, material] = await Promise.all([
    RawMaterialBalance.findOne({ materialId, location }).session(session).lean(),
    RawMaterial.findById(materialId).session(session).lean(),
  ]);
  if (!balance || !material) return;
  const belowThreshold = balance.quantity <= balance.reorderThreshold;
  const existing = await RawMaterialAlert.findOne({ materialId, location }).session(session);
  const wasActive = existing?.status === "active";
  const now = new Date();
  const update = {
    recipientUserId: balance.responsibleUserId ?? null,
    reorderThreshold: balance.reorderThreshold,
    currentQuantity: balance.quantity,
    status: belowThreshold ? "active" : "resolved",
    lastTriggeredAt: belowThreshold && !wasActive ? now : existing?.lastTriggeredAt ?? null,
    resolvedAt: belowThreshold ? null : wasActive ? now : existing?.resolvedAt ?? null,
  };
  let alert;
  if (existing) {
    Object.assign(existing, update);
    alert = await existing.save({ session });
  } else {
    [alert] = await RawMaterialAlert.create([{
      materialId,
      location,
      ...update,
      updatedBy: balance.updatedBy,
    }], { session });
  }
  if (belowThreshold !== wasActive) {
    await enqueueNotificationEvent({
      eventKey: `inventory:${materialId}:${location}:${belowThreshold ? "low" : "resolved"}:${now.getTime()}`,
      type: belowThreshold ? "inventory.low_stock" : "inventory.stock_recovered",
      category: "inventory",
      severity: belowThreshold && balance.quantity === 0 ? "urgent" : belowThreshold ? "action_required" : "info",
      title: belowThreshold ? (balance.quantity === 0 ? "Raw material out of stock" : "Raw material below reorder level") : "Raw material stock recovered",
      message: belowThreshold
        ? `${material.name} at ${location} has ${balance.quantity} ${material.unit} remaining.`
        : `${material.name} at ${location} is above its reorder level.`,
      resource: { type: "raw_material_alert", id: String(alert._id), reference: material.code },
      actorId: balance.updatedBy,
      recipientIds: balance.responsibleUserId ? [String(balance.responsibleUserId)] : [],
      recipientRoles: ["Inventory Manager", "Production Manager", "Admin", "Super Admin"],
      excludeRecipientIds: balance.updatedBy ? [String(balance.updatedBy)] : [],
      occurredAt: now,
    }, session);
  }
}

async function applyRawMaterialStockDelta(materialId, delta, userId, session, location = "Main Warehouse") {
  await ensureRawBalance(materialId, location, userId, session);
  const filter = { materialId, location };
  if (delta < 0) filter.quantity = { $gte: -delta };
  const result = await RawMaterialBalance.updateOne(
    filter,
    { $inc: { quantity: delta }, $set: { updatedBy: userId } },
    { session },
  );
  if (!result.modifiedCount && delta !== 0) {
    const error = new Error("Insufficient raw-material stock.");
    error.statusCode = 409;
    throw error;
  }
  await refreshRawMaterialAlert(materialId, location, session);
}

async function recordRawMaterialMovement(input, session) {
  const material = await RawMaterial.findById(input.materialId).session(session).lean();
  let lotAllocations = input.lotAllocations || [];
  if (material?.lotTrackingRequired) {
    lotAllocations = await applyRawMaterialLotMovement(input, session);
  }
  if (input.direction === "transfer") {
    if (!input.fromLocation || !input.toLocation || input.fromLocation === input.toLocation) {
      const error = new Error("A transfer requires different source and destination locations.");
      error.statusCode = 400;
      throw error;
    }
    await applyRawMaterialStockDelta(input.materialId, -input.quantity, input.actor, session, input.fromLocation);
    await applyRawMaterialStockDelta(input.materialId, input.quantity, input.actor, session, input.toLocation);
  } else {
    const location = input.direction === "in"
      ? input.toLocation || input.location || "Main Warehouse"
      : input.fromLocation || input.location || "Main Warehouse";
    await applyRawMaterialStockDelta(
      input.materialId,
      input.direction === "in" ? input.quantity : -input.quantity,
      input.actor,
      session,
      location,
    );
  }
  const { lotData, lotId, bestBeforeReviewReason, ...movementInput } = input;
  const [movement] = await RawMaterialMovement.create([{ ...movementInput, lotAllocations }], { session });
  return movement;
}

module.exports = {
  applyRawMaterialStockDelta,
  recordRawMaterialMovement,
  refreshRawMaterialAlert,
};
