const mongoose = require("mongoose");
const RawMaterial = require("../models/rawMaterial");
const RawMaterialLot = require("../models/rawMaterialLot");
const RawMaterialBalance = require("../models/rawMaterialBalance");
const RawMaterialMovement = require("../models/rawMaterialMovement");
const RawMaterialCount = require("../models/rawMaterialCount");
const { recordRawMaterialMovement, applyRawMaterialStockDelta } = require("../lib/productionInventory");

const serialize = (document) => {
  if (!document) return document;
  const value = document.toJSON ? document.toJSON() : { ...document };
  if (value._id !== undefined) {
    value.id = String(value._id);
    delete value._id;
  }
  delete value.__v;
  return value;
};

async function listMaterials(_request, response) {
  const materials = await RawMaterial.find().sort({ name: 1 }).lean();
  const balances = await RawMaterialBalance.find().lean();
  const balanceByMaterial = new Map();
  for (const balance of balances) {
    const key = String(balance.materialId);
    const current = balanceByMaterial.get(key) || 0;
    balanceByMaterial.set(key, current + Number(balance.quantity || 0));
  }
  return response.json({
    materials: materials.map((material) => ({
      ...serialize(material),
      balance: balanceByMaterial.get(String(material._id)) || 0,
      locations: balances
        .filter((balance) => String(balance.materialId) === String(material._id))
        .map((balance) => serialize(balance)),
    })),
  });
}

async function listMaterialLots(_request, response) {
  const lots = await RawMaterialLot.find().sort({ expiryDate: 1, createdAt: 1 }).lean();
  return response.json({ lots: lots.map(serialize) });
}

async function listMovements(request, response) {
  const limit = Math.min(200, Math.max(1, Number(request.query.limit) || 100));
  const movements = await RawMaterialMovement.find()
    .sort({ date: -1, createdAt: -1 })
    .limit(limit)
    .lean();
  return response.json({ movements: movements.map(serialize) });
}

async function receiveRawMaterial(request, response) {
  const body = request.body || {};
  if (!mongoose.isValidObjectId(body.materialId) || !Number.isSafeInteger(body.quantity) || body.quantity < 1) {
    return response.status(400).json({ error: "Provide a valid material and positive whole-number quantity." });
  }
  const session = await mongoose.startSession();
  try {
    let movement;
    await session.withTransaction(async () => {
      movement = await recordRawMaterialMovement({
        materialId: body.materialId,
        type: "Receipt",
        direction: "in",
        quantity: body.quantity,
        date: body.date,
        reference: body.reference,
        sourceType: "receipt",
        sourceId: null,
        idempotencyKey: body.idempotencyKey,
        reason: body.reason || "",
        actor: request.authUser._id,
        location: body.location,
        toLocation: body.location,
      }, session);
    });
    return response.status(201).json({ movement: serialize(movement) });
  } catch (error) {
    return response.status(error.statusCode || 500).json({ error: error.message });
  } finally {
    await session.endSession();
  }
}

async function adjustRawMaterial(request, response) {
  const body = request.body || {};
  if (!mongoose.isValidObjectId(body.materialId) || !Number.isSafeInteger(body.quantity) || body.quantity < 1) {
    return response.status(400).json({ error: "Provide a valid material and positive whole-number quantity." });
  }
  const session = await mongoose.startSession();
  try {
    let movement;
    await session.withTransaction(async () => {
      const delta = body.direction === "out" ? -body.quantity : body.quantity;
      await applyRawMaterialStockDelta(body.materialId, delta, request.authUser._id, session, body.location);
      [movement] = await RawMaterialMovement.create([{
        materialId: body.materialId,
        type: "Adjustment",
        direction: body.direction,
        quantity: body.quantity,
        date: body.date,
        reference: body.reference || "",
        sourceType: "adjustment",
        sourceId: null,
        idempotencyKey: body.idempotencyKey,
        reason: body.reason || "",
        actor: request.authUser._id,
        location: body.location,
      }], { session });
    });
    return response.status(201).json({ movement: serialize(movement) });
  } catch (error) {
    return response.status(error.statusCode || 500).json({ error: error.message });
  } finally {
    await session.endSession();
  }
}

module.exports = {
  adjustRawMaterial,
  listMaterialLots,
  listMaterials,
  listMovements,
  receiveRawMaterial,
};
