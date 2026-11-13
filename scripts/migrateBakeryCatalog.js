require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const mongoose = require("mongoose");
const FinishedProduct = require("../models/finishedProduct");
const FinishedStockBalance = require("../models/finishedStockBalance");
const FinishedStockMovement = require("../models/finishedStockMovement");
const BakeryProductFamily = require("../models/bakeryProductFamily");
const BakeryProductVariant = require("../models/bakeryProductVariant");
const FinishedStockLot = require("../models/finishedStockLot");
const FinishedStockLotMovement = require("../models/finishedStockLotMovement");
const User = require("../models/user");
const audit = require("../lib/audit");
const { validateFamily, validateVariants } = require("../controllers/bakeryProductionController");

function companyDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function hasOnlyKeys(value, allowed) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).every((key) => allowed.includes(key));
}

function validateOpeningLots(lots, productId) {
  if (!Array.isArray(lots)) return { error: "openingLots must be an array, even when the reviewed stock quantity is zero." };
  let remaining = 0;
  let reserved = 0;
  const references = new Set();
  for (const lot of lots) {
    if (!hasOnlyKeys(lot, ["reference", "location", "productionDate", "expiryDate", "producedQuantity", "remainingQuantity", "reservedQuantity"])
      || typeof lot.reference !== "string" || !lot.reference.trim() || lot.reference.length > 100
      || typeof lot.location !== "string" || !lot.location.trim() || lot.location.length > 100
      || !validDate(lot.productionDate) || !validDate(lot.expiryDate) || lot.expiryDate < lot.productionDate
      || !Number.isSafeInteger(lot.producedQuantity) || lot.producedQuantity < 1
      || !Number.isSafeInteger(lot.remainingQuantity) || lot.remainingQuantity < 0
      || !Number.isSafeInteger(lot.reservedQuantity ?? 0) || (lot.reservedQuantity ?? 0) < 0
      || (lot.reservedQuantity ?? 0) > lot.remainingQuantity
      || lot.producedQuantity < lot.remainingQuantity) {
      return { error: `Opening-stock lot data for ${productId} needs valid dates, quantities, and a unique reference.` };
    }
    if (references.has(lot.reference)) return { error: `Opening-stock lot references for ${productId} must be unique.` };
    references.add(lot.reference);
    remaining += lot.remainingQuantity;
    reserved += lot.reservedQuantity ?? 0;
  }
  return { value: lots.map((lot) => ({ ...lot, reservedQuantity: lot.reservedQuantity ?? 0 })), remaining, reserved };
}

async function buildMigrationPlan(mapping) {
  const blockers = [];
  if (!hasOnlyKeys(mapping, ["families"]) || !Array.isArray(mapping.families) || !mapping.families.length) {
    throw new Error("Mapping file must contain a non-empty families array and no other root fields.");
  }
  const mappedIds = [];
  const familyPlans = [];
  const seenFamilyCodes = new Set();
  for (const entry of mapping.families) {
    if (!hasOnlyKeys(entry, ["family", "variants"]) || !entry.family || !Array.isArray(entry.variants) || !entry.variants.length) {
      blockers.push({ scope: "family", reason: "Each mapping entry requires family data and at least one explicitly mapped variant." });
      continue;
    }
    if (!hasOnlyKeys(entry.family, ["code", "name", "category", "flavour", "baseUnit", "shelfLifeDays", "dateLabelType", "storageInstructions", "storefront", "active"])) {
      blockers.push({ scope: "family", code: entry.family.code, reason: "Family mapping contains unsupported fields." });
      continue;
    }
    const rawVariants = [];
    for (const source of entry.variants) {
      if (!hasOnlyKeys(source, ["legacyProductId", "variant", "openingLots"])
        || !mongoose.isValidObjectId(source.legacyProductId)
        || !source.variant
        || !Array.isArray(source.openingLots)) {
        blockers.push({ scope: "family", code: entry.family.code, reason: "Each variant mapping requires legacyProductId, variant data, and an openingLots array." });
        continue;
      }
      const variant = validateVariants([source.variant]);
      if (variant.error) {
        blockers.push({ scope: "product", productId: source.legacyProductId, reason: variant.error });
        continue;
      }
      const stock = validateOpeningLots(source.openingLots, source.legacyProductId);
      if (stock.error) {
        blockers.push({ scope: "product", productId: source.legacyProductId, reason: stock.error });
        continue;
      }
      mappedIds.push(String(new mongoose.Types.ObjectId(source.legacyProductId)));
      rawVariants.push({
        legacyProductId: String(new mongoose.Types.ObjectId(source.legacyProductId)),
        variant: variant.value[0],
        openingLots: stock.value,
        mappedRemaining: stock.remaining,
        mappedReserved: stock.reserved,
      });
    }
    const family = validateFamily({ ...entry.family, variants: rawVariants.map((item) => item.variant) });
    if (family.error) {
      blockers.push({ scope: "family", code: entry.family.code, reason: family.error });
      continue;
    }
    if (seenFamilyCodes.has(family.value.code.toUpperCase())) {
      blockers.push({ scope: "family", code: family.value.code, reason: "Family codes must be unique in the mapping file." });
    }
    seenFamilyCodes.add(family.value.code.toUpperCase());
    familyPlans.push({
      family: Object.fromEntries(Object.entries(family.value).filter(([key]) => key !== "variants")),
      variants: rawVariants,
    });
  }
  if (new Set(mappedIds).size !== mappedIds.length) {
    blockers.push({ scope: "mapping", reason: "A legacy product may be mapped only once." });
  }
  if (!familyPlans.length) return { mode: "dry-run", blockers, families: [], unmappedProducts: [] };

  const allProducts = await FinishedProduct.find().lean();
  const allProductIds = new Set(allProducts.map((product) => String(product._id)));
  const unknownIds = mappedIds.filter((id) => !allProductIds.has(id));
  for (const productId of unknownIds) blockers.push({ scope: "product", productId, reason: "Legacy finished product does not exist." });
  const validIds = mappedIds.filter((id) => allProductIds.has(id));
  const objectIds = validIds.map((id) => new mongoose.Types.ObjectId(id));
  const [balances, movementProductIds, existingFamilies, existingVariants, existingLots] = await Promise.all([
    FinishedStockBalance.find().lean(),
    FinishedStockMovement.distinct("productId", { productId: { $in: objectIds } }),
    BakeryProductFamily.find({ code: { $in: familyPlans.map((plan) => plan.family.code) } }).lean(),
    BakeryProductVariant.find({ legacyProductId: { $in: objectIds } }).lean(),
    FinishedStockLot.find({ sourceType: "legacy_migration", sourceReference: { $in: validIds } }).lean(),
  ]);
  const balanceByProduct = new Map(balances.map((balance) => [String(balance.productId), balance]));
  const movedProductIds = new Set(movementProductIds.map(String));
  const productById = new Map(allProducts.map((product) => [String(product._id), product]));
  const familyByCode = new Map(existingFamilies.map((family) => [family.code.toUpperCase(), family]));
  const variantByLegacyId = new Map(existingVariants.map((variant) => [String(variant.legacyProductId), variant]));
  const lotsBySource = new Map();
  for (const lot of existingLots) {
    lotsBySource.set(String(lot.sourceReference), [...(lotsBySource.get(String(lot.sourceReference)) || []), lot]);
  }

  for (const familyPlan of familyPlans) {
    const existingFamily = familyByCode.get(familyPlan.family.code.toUpperCase());
    familyPlan.existingFamilyId = existingFamily ? String(existingFamily._id) : null;
    if (existingFamily) {
      const mappedVariants = familyPlan.variants.map((item) => variantByLegacyId.get(item.legacyProductId));
      if (mappedVariants.some((variant) => !variant || String(variant.familyId) !== String(existingFamily._id))) {
        blockers.push({ scope: "family", code: familyPlan.family.code, reason: "A family with this code already exists but is not the same reviewed migration." });
      } else {
        familyPlan.alreadyMigrated = true;
        const familyValues = {
          code: familyPlan.family.code.toUpperCase(),
          name: familyPlan.family.name,
          category: familyPlan.family.category,
          flavour: familyPlan.family.flavour || "",
          baseUnit: familyPlan.family.baseUnit,
          shelfLifeDays: familyPlan.family.shelfLifeDays ?? 2,
          dateLabelType: familyPlan.family.dateLabelType || "best_before",
          storageInstructions: familyPlan.family.storageInstructions || "",
          active: familyPlan.family.active ?? true,
        };
        if (Object.entries(familyValues).some(([key, value]) => existingFamily[key] !== value)) {
          blockers.push({ scope: "family", code: familyPlan.family.code, reason: "Existing migrated family data differs from the reviewed mapping; reconcile manually." });
        }
        for (let index = 0; index < familyPlan.variants.length; index += 1) {
          const item = familyPlan.variants[index];
          const existingVariant = mappedVariants[index];
          item.existingVariant = existingVariant;
          const variantValues = {
            sku: item.variant.sku.toUpperCase(),
            name: item.variant.name,
            saleUnit: item.variant.saleUnit,
            unitsPerSaleUnit: item.variant.unitsPerSaleUnit,
            price: item.variant.price,
            active: item.variant.active ?? true,
          };
          if (Object.entries(variantValues).some(([key, value]) => existingVariant[key] !== value)) {
            blockers.push({ scope: "product", productId: item.legacyProductId, reason: "Existing migrated SKU data differs from the reviewed mapping; reconcile manually." });
          }
        }
      }
    } else if (familyPlan.variants.some((item) => variantByLegacyId.has(item.legacyProductId))) {
      blockers.push({ scope: "family", code: familyPlan.family.code, reason: "A legacy product variant is already assigned to another family." });
    }
    for (const item of familyPlan.variants) {
      const product = productById.get(item.legacyProductId);
      if (!product) continue;
      item.legacyProduct = product;
      const balance = balanceByProduct.get(item.legacyProductId);
      item.legacyBalance = balance ?? null;
      const expectedQuantity = balance?.quantityPacks ?? 0;
      const expectedReserved = balance?.reservedPacks ?? 0;
      if (balance && (balance.inventoryUnit !== "pack" || !Number.isSafeInteger(expectedQuantity) || expectedQuantity < 0
        || !Number.isSafeInteger(expectedReserved) || expectedReserved < 0 || expectedReserved > expectedQuantity)) {
        blockers.push({ scope: "stock", productId: item.legacyProductId, reason: "Run the existing finished-stock pack migration and reconcile its balance before bakery migration." });
      } else if (!balance && movedProductIds.has(item.legacyProductId)) {
        blockers.push({ scope: "stock", productId: item.legacyProductId, reason: "Legacy stock movements exist without a current pack balance." });
      } else if (!familyPlan.alreadyMigrated && (item.mappedRemaining !== expectedQuantity || item.mappedReserved !== expectedReserved)) {
        blockers.push({
          scope: "stock",
          productId: item.legacyProductId,
          reason: `Reviewed opening lots must total ${expectedQuantity} remaining and ${expectedReserved} reserved sale units.`,
        });
      }
      const existingLotsForProduct = lotsBySource.get(item.legacyProductId) || [];
      if (familyPlan.alreadyMigrated && existingLotsForProduct.length !== item.openingLots.length) {
        blockers.push({ scope: "stock", productId: item.legacyProductId, reason: "Existing migrated lots do not match the reviewed opening-lot mapping." });
      }
      if (familyPlan.alreadyMigrated && existingLotsForProduct.some((lot) => {
        const expected = item.openingLots.find((candidate) => candidate.reference === lot.reference);
        return !expected
          || expected.productionDate !== lot.productionDate
          || expected.expiryDate !== lot.expiryDate
          || expected.location !== lot.location
          || expected.producedQuantity !== lot.producedQuantity;
      })) {
        blockers.push({ scope: "stock", productId: item.legacyProductId, reason: "An existing migrated lot reference is not present in the reviewed mapping." });
      }
    }
  }

  const mappedSet = new Set(mappedIds);
  const unmappedProducts = allProducts.filter((product) => !mappedSet.has(String(product._id))).map((product) => ({
    productId: String(product._id),
    code: product.code,
    name: product.name,
    stockQuantity: balanceByProduct.get(String(product._id))?.quantityPacks
      ?? balanceByProduct.get(String(product._id))?.quantityPieces
      ?? 0,
    stockUnit: balanceByProduct.get(String(product._id))?.inventoryUnit === "pack" ? "sale_unit" : "legacy_piece",
    status: "preserved_unmapped",
  }));
  return {
    mode: "dry-run",
    blockers,
    families: familyPlans.map((plan) => ({
      code: plan.family.code,
      name: plan.family.name,
      existing: Boolean(plan.existingFamilyId),
      products: plan.variants.map((item) => ({
        legacyProductId: item.legacyProductId,
        legacyName: item.legacyProduct?.name,
        sku: item.variant.sku,
        openingLots: item.openingLots.length,
        openingQuantity: item.mappedRemaining,
        reservedQuantity: item.mappedReserved,
      })),
    })),
    unmappedProducts,
    operations: familyPlans,
  };
}

async function applyMigrationPlan(plan, actor) {
  if (plan.blockers.length) throw new Error("Bakery migration has blockers; correct the reviewed mapping before applying.");
  if (!actor?._id) throw new Error("An active migration actor is required to apply the bakery catalog migration.");
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      for (const familyPlan of plan.operations) {
        let family = familyPlan.existingFamilyId
          ? await BakeryProductFamily.findById(familyPlan.existingFamilyId).session(session)
          : null;
        if (!family) {
          [family] = await BakeryProductFamily.create([{
            ...familyPlan.family,
            createdBy: actor._id,
            updatedBy: actor._id,
          }], { session });
        }
        for (const item of familyPlan.variants) {
          if (!familyPlan.alreadyMigrated) {
            const balance = await FinishedStockBalance.findOne({ productId: item.legacyProduct._id }).session(session).lean();
            const currentQuantity = balance?.quantityPacks ?? 0;
            const currentReserved = balance?.reservedPacks ?? 0;
            if (balance && (balance.inventoryUnit !== "pack" || currentQuantity !== item.mappedRemaining || currentReserved !== item.mappedReserved)) {
              throw new Error(`Legacy finished stock changed after preview for ${item.legacyProduct.name}; rerun the dry run and reconcile.`);
            }
          }
          const existingVariant = await BakeryProductVariant.findOne({ legacyProductId: item.legacyProductId }).session(session);
          if (!existingVariant) {
            [item.createdVariant] = await BakeryProductVariant.create([{
              ...item.variant,
              familyId: family._id,
              legacyProductId: item.legacyProduct._id,
              createdBy: actor._id,
              updatedBy: actor._id,
            }], { session });
          } else if (String(existingVariant.familyId) !== String(family._id)) {
            throw new Error(`Legacy product ${item.legacyProductId} is already assigned to another family.`);
          }
          const existingLots = await FinishedStockLot.find({
            sourceType: "legacy_migration",
            sourceReference: item.legacyProductId,
          }).session(session).lean();
          const existingReferences = new Set(existingLots.map((lot) => lot.reference));
          const newLots = item.openingLots.filter((lot) => !existingReferences.has(lot.reference));
          if (newLots.length) {
            const variant = item.createdVariant || existingVariant;
            const createdLots = await FinishedStockLot.create(newLots.map((lot) => ({
              reference: lot.reference,
              batchId: null,
              sourceType: "legacy_migration",
              sourceReference: item.legacyProductId,
              familyId: family._id,
              variantId: variant._id,
              sku: variant.sku,
              productName: variant.name,
              saleUnit: variant.saleUnit,
              unitsPerSaleUnit: variant.unitsPerSaleUnit,
              location: lot.location,
              productionDate: lot.productionDate,
              expiryDate: lot.expiryDate,
              dateLabelType: family.dateLabelType,
              producedQuantity: lot.producedQuantity,
              remainingQuantity: lot.remainingQuantity,
              reservedQuantity: lot.reservedQuantity,
              status: lot.remainingQuantity === 0 ? "depleted" : "active",
              createdBy: actor._id,
            })), { session });
            const openingMovements = createdLots.filter((lot) => lot.remainingQuantity > 0).map((lot) => ({
              lotId: lot._id,
              type: "Opening balance",
              direction: "in",
              quantity: lot.remainingQuantity,
              date: companyDate(),
              reference: lot.reference,
              sourceType: "legacy-migration",
              sourceId: item.legacyProduct._id,
              idempotencyKey: `migration:${lot.reference}:opening`,
              reason: "Reviewed legacy finished-stock opening balance",
              actor: actor._id,
            }));
            if (openingMovements.length) await FinishedStockLotMovement.create(openingMovements, { session });
          }
        }
      }
      await audit.recordAudit({
        eventType: "production.bakery_catalog_migrated",
        outcome: "success",
        actor,
        details: {
          familyCount: plan.operations.length,
          productCount: plan.operations.reduce((total, item) => total + item.variants.length, 0),
          lotCount: plan.operations.reduce((total, item) => total + item.variants.reduce((count, variant) => count + variant.openingLots.length, 0), 0),
        },
        transaction: session,
      });
    });
  } finally {
    await session.endSession();
  }
  return {
    mode: "applied",
    familyCount: plan.operations.length,
    productCount: plan.operations.reduce((total, item) => total + item.variants.length, 0),
    lotCount: plan.operations.reduce((total, item) => total + item.variants.reduce((count, variant) => count + variant.openingLots.length, 0), 0),
    preservedUnmappedProductCount: plan.unmappedProducts.length,
  };
}

function argumentValue(args, option) {
  const index = args.indexOf(option);
  return index < 0 ? undefined : args[index + 1];
}

function mappingArgument(args) {
  const index = args.indexOf("--mapping");
  if (index < 0 || !args[index + 1]) throw new Error("Provide an explicit mapping file with --mapping <path>.");
  return path.resolve(args[index + 1]);
}

async function main() {
  const mappingPath = mappingArgument(process.argv.slice(2));
  const mapping = JSON.parse(fs.readFileSync(mappingPath, "utf8"));
  if (!process.env.DB_URL) throw new Error("DB_URL is required.");
  const apply = process.argv.includes("--apply");
  const actorId = argumentValue(process.argv.slice(2), "--actor-id");
  if (apply && !mongoose.isValidObjectId(actorId)) throw new Error("Applying the migration requires --actor-id <active-user-id>.");
  await mongoose.connect(process.env.DB_URL);
  try {
    const plan = await buildMigrationPlan(mapping);
    const report = {
      mode: process.argv.includes("--apply") ? "apply-preview" : "dry-run",
      blockers: plan.blockers,
      families: plan.families,
      unmappedProducts: plan.unmappedProducts,
    };
    console.log(JSON.stringify(report, null, 2));
    if (plan.blockers.length) process.exitCode = 2;
    else if (apply) {
      const actor = await User.findOne({ _id: actorId, status: "Active" }).lean();
      if (!actor) throw new Error("The migration actor must be an active user.");
      console.log(JSON.stringify(await applyMigrationPlan(plan, actor), null, 2));
    }
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

module.exports = { applyMigrationPlan, argumentValue, buildMigrationPlan, mappingArgument, validateOpeningLots };
