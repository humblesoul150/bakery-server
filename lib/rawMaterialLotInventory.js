const RawMaterialLot = require("../models/rawMaterialLot");
const RawMaterialLotBalance = require("../models/rawMaterialLotBalance");

function inventoryConflict(message) {
  const error = new Error(message);
  error.statusCode = 409;
  return error;
}

function lotAllocationSnapshot(lot, quantity, bestBeforeReviewReason = "") {
  return {
    lotId: lot._id,
    internalLotCode: lot.internalLotCode,
    supplierLotReference: lot.supplierLotReference || "",
    expiryDate: lot.expiryDate,
    dateLabelType: lot.dateLabelType,
    quantity,
    bestBeforeReviewReason,
  };
}

function planFefoAllocation(lots, requiredQuantity, movementDate, bestBeforeReviewReason = "", enforceExpiry = true) {
  let remaining = requiredQuantity;
  const allocations = [];
  let expiredUseBySkipped = false;
  let expiredBestBeforeSkipped = false;
  let quarantinedSkipped = false;
  const ordered = [...lots].sort((left, right) => {
    const leftExpiry = left.expiryDate || "9999-12-31";
    const rightExpiry = right.expiryDate || "9999-12-31";
    return leftExpiry.localeCompare(rightExpiry)
      || (left.receiptDate || "9999-12-31").localeCompare(right.receiptDate || "9999-12-31")
      || left.internalLotCode.localeCompare(right.internalLotCode);
  });

  for (const candidate of ordered) {
    if (candidate.status !== "available" || candidate.quantity <= 0) {
      if (candidate.status === "quarantined") quarantinedSkipped = true;
      continue;
    }
    if (enforceExpiry && candidate.expiryDate && movementDate > candidate.expiryDate) {
      if (candidate.dateLabelType === "use_by") {
        expiredUseBySkipped = true;
        continue;
      }
      if (candidate.dateLabelType === "best_before" && !bestBeforeReviewReason) {
        expiredBestBeforeSkipped = true;
        continue;
      }
    }
    const quantity = Math.min(candidate.quantity, remaining);
    allocations.push({
      lot: candidate,
      quantity,
      bestBeforeReviewReason: candidate.expiryDate && movementDate > candidate.expiryDate
        && candidate.dateLabelType === "best_before"
        ? bestBeforeReviewReason
        : "",
    });
    remaining -= quantity;
    if (remaining <= 1e-9) break;
  }

  if (remaining > 1e-9) {
    if (expiredUseBySkipped && !expiredBestBeforeSkipped && !quarantinedSkipped) {
      throw inventoryConflict("Expired use-by lots cannot be used; eligible lot stock is insufficient.");
    }
    if (expiredBestBeforeSkipped && !expiredUseBySkipped && !quarantinedSkipped) {
      throw inventoryConflict("Supervisor review is required to use best-before lots past their date.");
    }
    if (quarantinedSkipped && !expiredUseBySkipped && !expiredBestBeforeSkipped) {
      throw inventoryConflict("Quarantined raw-material lots cannot be used; eligible lot stock is insufficient.");
    }
    throw inventoryConflict("Eligible raw-material lots do not have enough stock for this movement.");
  }
  return allocations;
}

function validateLotUse(lot, movementDate, bestBeforeReviewReason, enforceExpiry) {
  if (lot.status !== "available" && enforceExpiry) {
    throw inventoryConflict(`Raw-material lot ${lot.internalLotCode} is not available for use.`);
  }
  if (!enforceExpiry) return "";
  if (!lot.expiryDate || movementDate <= lot.expiryDate) return "";
  if (lot.dateLabelType === "use_by") {
    throw inventoryConflict(`Raw-material lot ${lot.internalLotCode} is past its use-by date.`);
  }
  if (lot.dateLabelType === "best_before") {
    if (!bestBeforeReviewReason) {
      throw inventoryConflict(`Supervisor review is required to use best-before lot ${lot.internalLotCode} past its date.`);
    }
    return bestBeforeReviewReason;
  }
  return "";
}

async function createLotForReceipt(input, session) {
  const data = input.lotData;
  if (!data || !data.internalLotCode || !data.receiptDate || !data.source) {
    throw inventoryConflict("Lot-tracked stock increases require explicit lot and receipt details.");
  }
  const [lot] = await RawMaterialLot.create([{
    materialId: input.materialId,
    ...data,
    receivedQuantity: input.quantity,
    unitCost: input.unitCost,
    createdBy: input.actor,
  }], { session });
  await RawMaterialLotBalance.create([{
    lotId: lot._id,
    materialId: input.materialId,
    location: input.toLocation || input.location || "Main Warehouse",
    quantity: input.quantity,
    updatedBy: input.actor,
  }], { session });
  return [lotAllocationSnapshot(lot, input.quantity)];
}

async function loadAvailableLots(materialId, location, session) {
  const balances = await RawMaterialLotBalance.find({
    materialId,
    location,
    quantity: { $gt: 0 },
  }).session(session).lean();
  if (!balances.length) return [];
  const lots = await RawMaterialLot.find({
    _id: { $in: balances.map((balance) => balance.lotId) },
  }).session(session).lean();
  const balanceMap = new Map(balances.map((balance) => [String(balance.lotId), balance.quantity]));
  return lots.map((lot) => ({ ...lot, quantity: balanceMap.get(String(lot._id)) || 0 }));
}

async function applyLotAllocation(allocation, materialId, location, actorId, session, direction) {
  const lot = allocation.lot || await RawMaterialLot.findById(allocation.lotId).session(session);
  if (!lot || String(lot.materialId) !== String(materialId)) {
    throw inventoryConflict("A selected raw-material lot does not belong to this material.");
  }
  const bestBeforeReviewReason = validateLotUse(
    lot,
    allocation.movementDate,
    allocation.bestBeforeReviewReason || "",
    allocation.enforceExpiry,
  );
  const quantity = Number(allocation.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw inventoryConflict("Lot allocation quantities must be positive.");
  }
  if (direction === "out") {
    const result = await RawMaterialLotBalance.updateOne(
      { lotId: lot._id, materialId, location, quantity: { $gte: quantity } },
      { $inc: { quantity: -quantity }, $set: { updatedBy: actorId } },
      { session },
    );
    if (!result.modifiedCount) {
      throw inventoryConflict(`Insufficient stock in raw-material lot ${lot.internalLotCode} at ${location}.`);
    }
  } else if (direction === "in") {
    await RawMaterialLotBalance.findOneAndUpdate(
      { lotId: lot._id, materialId, location },
      { $inc: { quantity }, $set: { updatedBy: actorId } },
      { upsert: true, new: true, session, setDefaultsOnInsert: true },
    );
    if (lot.status === "depleted") {
      lot.status = "available";
      await lot.save({ session });
    }
  }
  return lotAllocationSnapshot(lot, quantity, bestBeforeReviewReason);
}

async function applyRawMaterialLotMovement(input, session) {
  const explicitReviewReason = String(input.bestBeforeReviewReason || "").trim();
  if (input.direction === "in") {
    if (input.lotId) {
      return [await applyLotAllocation({
        lotId: input.lotId,
        quantity: input.quantity,
        movementDate: input.date,
        bestBeforeReviewReason: explicitReviewReason,
      }, input.materialId, input.toLocation || input.location || "Main Warehouse", input.actor, session, "in")];
    }
    if (input.lotData) return createLotForReceipt(input, session);
    throw inventoryConflict("Lot-tracked stock increases require an identified lot or an explicitly recorded unknown-provenance lot.");
  }

  const fromLocation = input.fromLocation || input.location || "Main Warehouse";
  const toLocation = input.direction === "transfer" ? input.toLocation : null;
  const enforceExpiry = input.sourceType === "production-usage";
  let allocationPlans;
  if (Array.isArray(input.lotAllocations) && input.lotAllocations.length) {
    allocationPlans = input.lotAllocations.map((allocation) => ({
      lot: null,
      lotId: allocation.lotId,
      quantity: Number(allocation.quantity),
      bestBeforeReviewReason: String(allocation.bestBeforeReviewReason || explicitReviewReason).trim(),
      movementDate: input.date,
      enforceExpiry,
    }));
    const total = allocationPlans.reduce((sum, allocation) => sum + allocation.quantity, 0);
    if (Math.abs(total - input.quantity) > 1e-8) {
      throw inventoryConflict("Lot allocations must add up to the movement quantity.");
    }
  } else {
    const lots = await loadAvailableLots(input.materialId, fromLocation, session);
    allocationPlans = planFefoAllocation(lots, input.quantity, input.date, explicitReviewReason, enforceExpiry)
      .map((allocation) => ({
        ...allocation,
        movementDate: input.date,
        enforceExpiry,
      }));
  }

  const snapshots = [];
  for (const allocation of allocationPlans) {
    const snapshot = await applyLotAllocation(
      allocation,
      input.materialId,
      fromLocation,
      input.actor,
      session,
      "out",
    );
    if (toLocation) {
      await applyLotAllocation({
        lotId: snapshot.lotId,
        quantity: snapshot.quantity,
        movementDate: input.date,
        enforceExpiry: false,
      }, input.materialId, toLocation, input.actor, session, "in");
    }
    snapshots.push(snapshot);
  }
  await refreshDepletedLotStatuses(input.materialId, fromLocation, session);
  return snapshots;
}

async function refreshDepletedLotStatuses(materialId, location, session) {
  const balances = await RawMaterialLotBalance.find({ materialId, quantity: { $gt: 0 } })
    .distinct("lotId")
    .session(session);
  if (balances.length) {
    await RawMaterialLot.updateMany(
      { materialId, _id: { $in: balances }, status: "depleted" },
      { $set: { status: "available" } },
      { session },
    );
  }
  await RawMaterialLot.updateMany(
    { materialId, _id: { $nin: balances }, status: "available" },
    { $set: { status: "depleted" } },
    { session },
  );
}

module.exports = {
  applyRawMaterialLotMovement,
  planFefoAllocation,
  refreshDepletedLotStatuses,
};
