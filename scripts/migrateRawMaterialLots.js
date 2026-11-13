require("dotenv").config();
const { createHash } = require("node:crypto");
const mongoose = require("mongoose");
const RawMaterial = require("../models/rawMaterial");
const RawMaterialBalance = require("../models/rawMaterialBalance");
const RawMaterialMovement = require("../models/rawMaterialMovement");
const RawMaterialLot = require("../models/rawMaterialLot");
const RawMaterialLotBalance = require("../models/rawMaterialLotBalance");
const User = require("../models/user");
const audit = require("../lib/audit");

const MIGRATION_ID = "raw-material-lots-opening-v1";

function companyDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function locationKey(materialId, location) {
  return `${String(materialId)}:${String(location).trim()}`;
}

function buildLotMigrationPlan({ materials, balances, lotBalances }) {
  const materialMap = new Map(materials.map((material) => [String(material._id), material]));
  const lotTotals = new Map();
  for (const balance of lotBalances) {
    const key = locationKey(balance.materialId, balance.location);
    lotTotals.set(key, (lotTotals.get(key) || 0) + Number(balance.quantity));
  }
  const plans = [];
  const blockers = [];
  const eligible = materials.filter((material) =>
    material.lotTrackingRequired || material.category === "Ingredients");
  const eligibleIds = new Set(eligible.map((material) => String(material._id)));
  const aggregateKeys = new Set(balances.map((balance) => locationKey(balance.materialId, balance.location)));

  for (const balance of lotBalances) {
    const materialId = String(balance.materialId);
    if (!eligibleIds.has(materialId)) continue;
    if (!Number.isFinite(Number(balance.quantity)) || Number(balance.quantity) < 0) {
      blockers.push({
        materialId,
        location: balance.location,
        lotId: String(balance.lotId),
        reason: "Existing lot balance is invalid.",
      });
    } else if (balance.quantity > 1e-8 && !aggregateKeys.has(locationKey(materialId, balance.location))) {
      blockers.push({
        materialId,
        location: balance.location,
        lotId: String(balance.lotId),
        lotQuantity: balance.quantity,
        reason: "A positive lot balance has no matching aggregate balance.",
      });
    }
  }

  for (const balance of balances) {
    const materialId = String(balance.materialId);
    if (!eligibleIds.has(materialId)) continue;
    const material = materialMap.get(materialId);
    const aggregateQuantity = Number(balance.quantity);
    const existingLotQuantity = lotTotals.get(locationKey(materialId, balance.location)) || 0;
    if (!Number.isFinite(aggregateQuantity) || aggregateQuantity < 0
      || !Number.isFinite(existingLotQuantity) || existingLotQuantity < 0) {
      blockers.push({ materialId, location: balance.location, reason: "Aggregate or lot quantity is invalid." });
      continue;
    }
    if (existingLotQuantity > aggregateQuantity + 1e-8) {
      blockers.push({
        materialId,
        materialCode: material.code,
        location: balance.location,
        aggregateQuantity,
        existingLotQuantity,
        reason: "Existing lot quantity exceeds the aggregate balance.",
      });
      continue;
    }
    const openingQuantity = aggregateQuantity - existingLotQuantity;
    if (openingQuantity > 1e-8) {
      plans.push({
        materialId,
        materialCode: material.code,
        materialName: material.name,
        unit: material.unit,
        location: balance.location,
        openingQuantity,
        existingLotQuantity,
        aggregateQuantity,
      });
    }
  }

  return {
    mode: "dry-run",
    migrationId: MIGRATION_ID,
    eligibleMaterialCount: eligible.length,
    openingLotCount: plans.length,
    openingQuantity: plans.reduce((total, plan) => total + plan.openingQuantity, 0),
    plans,
    blockers,
  };
}

async function inspectDatabase(session) {
  const materialsQuery = RawMaterial.find().lean();
  const balancesQuery = RawMaterialBalance.find().lean();
  const lotBalancesQuery = RawMaterialLotBalance.find().lean();
  if (session) {
    materialsQuery.session(session);
    balancesQuery.session(session);
    lotBalancesQuery.session(session);
  }
  const [materials, balances, lotBalances] = await Promise.all([
    materialsQuery,
    balancesQuery,
    lotBalancesQuery,
  ]);
  return buildLotMigrationPlan({ materials, balances, lotBalances });
}

async function migrate(actorId, apply = false) {
  if (!apply) return inspectDatabase();
  if (!mongoose.isValidObjectId(actorId)) throw new Error("Provide a valid --actor-id.");
  const session = await mongoose.startSession();
  try {
    let report;
    await session.withTransaction(async () => {
      report = await inspectDatabase(session);
      if (!apply) return;
      if (report.blockers.length) throw new Error("Lot migration is blocked; resolve the dry-run blockers before applying.");
      const operator = await User.findOne({
        _id: actorId,
        status: "Active",
        roles: { $in: ["Inventory Manager", "Admin", "Super Admin"] },
      }).session(session);
      if (!operator) throw new Error("The actor must be an active inventory manager or administrator.");
      const marker = await mongoose.connection.collection("migration_markers").findOne({ _id: MIGRATION_ID }, { session });
      if (marker) {
        report.mode = "already-applied";
        return;
      }

      const runDate = companyDate();
      for (const plan of report.plans) {
        const material = await RawMaterial.findById(plan.materialId).session(session);
        const digest = createHash("sha256").update(locationKey(plan.materialId, plan.location)).digest("hex").slice(0, 20).toUpperCase();
        const internalLotCode = `OPEN-${digest}`;
        const [lot] = await RawMaterialLot.create([{
          materialId: material._id,
          internalLotCode,
          source: "opening",
          receivedQuantity: plan.openingQuantity,
          status: "available",
          notes: "Opening stock migration; supplier lot, receipt date, and expiry are unknown.",
          createdBy: operator._id,
        }], { session });
        await RawMaterialLotBalance.create([{
          lotId: lot._id,
          materialId: material._id,
          location: plan.location,
          quantity: plan.openingQuantity,
          updatedBy: operator._id,
        }], { session });
        await RawMaterialMovement.create([{
          materialId: material._id,
          type: "Opening balance",
          direction: "in",
          quantity: plan.openingQuantity,
          date: runDate,
          reference: `OPEN-${digest}`,
          sourceType: "migration",
          sourceId: lot._id,
          idempotencyKey: `${MIGRATION_ID}:${digest}`,
          reason: "Opening stock migration; supplier lot, receipt date, and expiry are unknown.",
          toLocation: plan.location,
          lotAllocations: [{
            lotId: lot._id,
            internalLotCode,
            supplierLotReference: "",
            quantity: plan.openingQuantity,
          }],
          materialName: material.name,
          unit: material.unit,
          actor: operator._id,
        }], { session });
      }

      await RawMaterial.updateMany(
        { $or: [{ category: "Ingredients" }, { lotTrackingRequired: true }] },
        { $set: { lotTrackingRequired: true, updatedBy: operator._id } },
        { session },
      );
      await audit.recordAudit({
        actor: operator,
        eventType: "inventory.raw_material_lots_migrated",
        outcome: "success",
        resource: {
          type: "raw_material_lot",
          id: MIGRATION_ID,
          reference: MIGRATION_ID,
        },
        details: {
          migrationId: MIGRATION_ID,
          eligibleMaterialCount: report.eligibleMaterialCount,
          openingLotCount: report.openingLotCount,
          openingQuantity: report.openingQuantity,
        },
        transaction: session,
      });
      await mongoose.connection.collection("migration_markers").insertOne({
        _id: MIGRATION_ID,
        actorId: operator._id,
        openingLotCount: report.openingLotCount,
        createdAt: new Date(),
      }, { session });
      report.mode = "applied";
    });
    return report;
  } finally {
    await session.endSession();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const actorArg = args.find((argument) => argument.startsWith("--actor-id="));
  const actorId = actorArg ? actorArg.slice("--actor-id=".length) : undefined;
  if (apply && !actorId) throw new Error("--actor-id is required with --apply.");
  if (!process.env.DB_URL) throw new Error("DB_URL is required.");
  await mongoose.connect(process.env.DB_URL);
  try {
    const report = await migrate(actorId, apply);
    console.log(JSON.stringify(report, null, 2));
    if (report.blockers.length) process.exitCode = 2;
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { buildLotMigrationPlan, migrate };
