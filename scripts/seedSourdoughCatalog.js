require("dotenv").config();
const fs = require("node:fs");
const mongoose = require("mongoose");
const path = require("node:path");
const BakeryProductFamily = require("../models/bakeryProductFamily");
const BakeryProductVariant = require("../models/bakeryProductVariant");
const BakeryRecipe = require("../models/bakeryRecipe");
const RawMaterial = require("../models/rawMaterial");
const User = require("../models/user");
const audit = require("../lib/audit");
const {
  isNonProductionTarget,
  planMaterialResolution,
  validateCatalog,
} = require("../lib/sourdoughCatalogSeed");
const catalogPath = path.join(__dirname, "data", "sourdoughCatalogImport.json");
const FAMILIES_PER_TRANSACTION = 5;

function loadCatalog() {
  return JSON.parse(fs.readFileSync(catalogPath, "utf8"));
}

function redactErrorMessage(value) {
  let message = String(value || "");
  if (process.env.DB_URL) {
    message = message.replaceAll(process.env.DB_URL, "[redacted DB_URL]");
  }
  return message.replace(/mongodb(?:\+srv)?:\/\/[^\s"'`]+/gi, "[redacted MongoDB URL]");
}

function errorDiagnostics(error) {
  const causes = [];
  const seen = new Set();
  let current = error;
  while (current && causes.length < 5 && !seen.has(current)) {
    seen.add(current);
    const item = {
      name: typeof current.name === "string" ? current.name : "Error",
      message: redactErrorMessage(current.message || current),
    };
    for (const field of ["stage", "code", "codeName"]) {
      if (current[field] !== undefined) item[field] = current[field];
    }
    if (Array.isArray(current.errorLabels)) item.errorLabels = current.errorLabels;
    if (typeof current.stack === "string") {
      item.stack = redactErrorMessage(current.stack).split("\n").slice(0, 8).join("\n");
    }
    causes.push(item);
    current = current.cause;
  }
  return causes;
}

function argumentValue(args, name) {
  const prefix = `${name}=`;
  const inline = args.find((item) => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function normalize(value) {
  return String(value || "").trim().toLocaleLowerCase("en");
}

function profileFields(profile) {
  return {
    code: profile.code,
    seedKey: profile.seedKey,
    name: profile.name,
    category: profile.category,
    flavour: profile.flavour,
    baseUnit: profile.baseUnit,
    shelfLifeDays: profile.shelfLifeDays,
    dateLabelType: profile.dateLabelType,
    storageInstructions: profile.storageInstructions,
    active: false,
    storefront: {
      published: false,
      slug: profile.slug,
      description: profile.storefront.description,
      ingredientsStatement: profile.storefront.ingredientsStatement,
      allergens: profile.storefront.allergens,
      images: [],
    },
  };
}

function recipeMatches(existing, profile) {
  if (!existing || existing.seedKey !== `${profile.seedKey}:recipe`
    || existing.batchYield !== profile.recipe.batchYield
    || existing.yieldUnit !== profile.recipe.yieldUnit
    || existing.formulationNote !== profile.recipe.formulationNote
    || JSON.stringify(existing.sourceReferences || []) !== JSON.stringify(profile.recipe.sourceReferences)) {
    return false;
  }
  const expected = profile.recipe.ingredients
    .map((item) => `${normalize(item.materialName)}|${item.unit}|${item.quantityPerBatch}`)
    .sort();
  const actual = (existing.ingredients || [])
    .map((item) => `${normalize(item.materialName)}|${item.unit}|${item.quantityPerBatch}`)
    .sort();
  return JSON.stringify(expected) === JSON.stringify(actual);
}

function variantMatches(existing, expected) {
  return existing
    && existing.sku === expected.sku
    && existing.name === expected.name
    && existing.saleUnit === expected.saleUnit
    && existing.unitsPerSaleUnit === expected.unitsPerSaleUnit
    && existing.price === expected.price
    && existing.active === true;
}

function familyMatches(existing, profile) {
  const expected = profileFields(profile);
  return ["code", "seedKey", "name", "category", "flavour", "baseUnit", "shelfLifeDays", "dateLabelType", "storageInstructions", "active"]
    .every((field) => existing[field] === expected[field])
    && existing.storefront?.published === false
    && existing.storefront?.slug === expected.storefront.slug
    && existing.storefront?.description === expected.storefront.description
    && existing.storefront?.ingredientsStatement === expected.storefront.ingredientsStatement
    && JSON.stringify(existing.storefront?.allergens || []) === JSON.stringify(expected.storefront.allergens)
    && !(existing.storefront?.images || []).length;
}

async function inspectDatabase(catalog) {
  const familyCodes = catalog.families.map((item) => item.code);
  const familySeedKeys = catalog.families.map((item) => item.seedKey);
  const familySlugs = catalog.families.map((item) => item.slug);
  const materialNames = catalog.materialDefinitions.map((item) => item.name);
  const materialCodes = catalog.materialDefinitions.map((item) => item.code);
  const skus = catalog.families.flatMap((item) => item.variants.map((variant) => variant.sku));
  const recipeSeedKeys = catalog.families.map((item) => `${item.seedKey}:recipe`);

  const [materials, families, variants, recipes] = await Promise.all([
    RawMaterial.find({
      $or: [{ name: { $in: materialNames } }, { code: { $in: materialCodes } }],
    }).collation({ locale: "en", strength: 2 }).lean(),
    BakeryProductFamily.find({
      $or: [
        { seedKey: { $in: familySeedKeys } },
        { code: { $in: familyCodes } },
        { "storefront.slug": { $in: familySlugs } },
      ],
    }).lean(),
    BakeryProductVariant.find({ sku: { $in: skus } }).lean(),
    BakeryRecipe.find({ seedKey: { $in: recipeSeedKeys } }).lean(),
  ]);
  const allIngredients = catalog.families.flatMap((family) => family.recipe.ingredients);
  const materialPlan = planMaterialResolution(catalog.materialDefinitions, allIngredients, materials);
  const familyBySeedKey = new Map(families.filter((item) => item.seedKey).map((item) => [item.seedKey, item]));
  const familiesByCode = new Map(families.map((item) => [String(item.code).toUpperCase(), item]));
  const familiesBySlug = new Map(families.map((item) => [item.storefront?.slug, item]).filter(([slug]) => slug));
  const variantsBySku = new Map(variants.map((item) => [String(item.sku).toUpperCase(), item]));
  const recipesBySeedKey = new Map(recipes.map((item) => [item.seedKey, item]));
  const familyPlans = [];
  const errors = [...materialPlan.errors];

  for (const profile of catalog.families) {
    const existing = familyBySeedKey.get(profile.seedKey);
    const collision = familiesByCode.get(profile.code.toUpperCase()) || familiesBySlug.get(profile.slug);
    if (!existing && collision) {
      errors.push(`Family code or slug for ${profile.code} already belongs to a non-seed family.`);
      continue;
    }
    if (existing && !familyMatches(existing, profile)) {
      errors.push(`Seeded family ${profile.code} already exists with different values; reconcile it manually.`);
      continue;
    }
    const existingVariants = existing
      ? variants.filter((variant) => String(variant.familyId) === String(existing._id))
      : [];
    const hasSkuCollision = profile.variants.some((variant) => {
      const owner = variantsBySku.get(variant.sku.toUpperCase());
      return owner && (!existing || String(owner.familyId) !== String(existing._id));
    });
    if (hasSkuCollision) {
      errors.push(`A variant SKU for ${profile.code} is already assigned to another family.`);
      continue;
    }
    if (existing) {
      const recipe = recipesBySeedKey.get(`${profile.seedKey}:recipe`);
      if (existingVariants.length !== profile.variants.length
        || profile.variants.some((variant) => !existingVariants.some((item) => variantMatches(item, variant)))
        || String(existing.activeRecipeId || "") !== String(recipe?._id || "")
        || !recipeMatches(recipe, profile)) {
        errors.push(`Seeded family ${profile.code} is incomplete or differs from this data version; reconcile it manually.`);
        continue;
      }
    } else if (recipesBySeedKey.has(`${profile.seedKey}:recipe`)) {
      errors.push(`Recipe seed key for ${profile.code} exists without its seeded family.`);
      continue;
    }
    familyPlans.push({ profile, existingFamily: existing || null });
  }

  const rawMaterialByName = new Map(materials.map((item) => [normalize(item.name), item]));
  return {
    errors,
    missingMaterials: materialPlan.missing,
    familyPlans,
    rawMaterialByName,
  };
}

function printReport(catalog, databasePlan) {
  const seeded = databasePlan
    ? databasePlan.familyPlans.filter((item) => !item.existingFamily).length
    : catalog.families.length;
  const existing = databasePlan
    ? databasePlan.familyPlans.filter((item) => item.existingFamily).length
    : 0;
  const report = {
    mode: databasePlan ? "database-check" : "offline-dry-run",
    categoryCount: Object.keys(catalog.productCountByCategory).length,
    familyCount: catalog.families.length,
    coreProfiles: catalog.families.length - Object.keys(catalog.productCountByCategory).length * 2,
    flavourSpecificProfiles: catalog.families.length - (catalog.families.length - Object.keys(catalog.productCountByCategory).length * 2),
    variantCount: catalog.families.reduce((total, item) => total + item.variants.length, 0),
    recipeCount: catalog.families.length,
    ingredientLineCount: catalog.families.reduce((total, item) => total + item.recipe.ingredients.length, 0),
    materialDefinitionCount: catalog.materialDefinitions.length,
    familiesToInsert: seeded,
    familiesAlreadySeeded: existing,
    rawMaterialReconciliation: databasePlan ? "checked against the configured database" : "not checked; run with --check-database",
    missingRawMaterials: databasePlan
      ? databasePlan.missingMaterials.map(({ name, unit }) => ({ name, unit }))
      : null,
    blockers: databasePlan?.errors || [],
    publication: "all profiles unpublished, image-free, and inactive until reviewed",
    pricing: "integer UGX estimates; owner review required",
  };
  console.log(JSON.stringify(report, null, 2));
}

async function applyCatalog(catalog, databasePlan, actor, args) {
  if (databasePlan.errors.length) {
    throw new Error(`Catalog import blocked: ${databasePlan.errors.join(" ")}`);
  }
  if (databasePlan.missingMaterials.length && !args.includes("--create-missing-materials")) {
    throw new Error("Missing raw materials exist. Review the report and use --create-missing-materials to add definitions with zero stock.");
  }

  const withDiagnosticTransaction = async (label, operation) => {
    let stage = label;
    try {
      return await mongoose.connection.transaction((session) => operation(
        session,
        (nextStage) => { stage = nextStage; },
      ));
    } catch (error) {
      const contextualError = new Error(`Catalog transaction failed during ${stage}.`, { cause: error });
      contextualError.stage = stage;
      throw contextualError;
    }
  };

  const materialByName = new Map(databasePlan.rawMaterialByName);
  if (databasePlan.missingMaterials.length) {
    await withDiagnosticTransaction("creating missing raw materials", async (session, setStage) => {
      setStage(`creating ${databasePlan.missingMaterials.length} missing raw materials`);
      const createdMaterials = await RawMaterial.create(
        databasePlan.missingMaterials.map((definition) => ({
          ...definition,
          createdBy: actor._id,
          updatedBy: actor._id,
        })),
        { session, ordered: true },
      );
      for (const material of createdMaterials) {
        materialByName.set(normalize(material.name), material);
      }
      setStage("writing raw-material seed audit event");
      await audit.recordAudit({
        eventType: "production.sourdough_catalog_seeded",
        outcome: "success",
        reason: "sourdough_catalog_import",
        actor,
        resource: { type: "production_product" },
        details: {
          catalogVersion: catalog.version,
          familyCount: 0,
          variantCount: 0,
          recipeCount: 0,
          materialCount: createdMaterials.length,
          published: false,
          active: false,
        },
        transaction: session,
      });
    });
  }

  const newFamilyPlans = databasePlan.familyPlans.filter((item) => !item.existingFamily);
  const familyBatches = chunkItems(newFamilyPlans, FAMILIES_PER_TRANSACTION);
  let familyCount = 0;
  let variantCount = 0;
  let recipeCount = 0;

  for (const [batchIndex, familyBatch] of familyBatches.entries()) {
    await withDiagnosticTransaction(
      `starting family batch ${batchIndex + 1} of ${familyBatches.length}`,
      async (session, setStage) => {
        let batchFamilyCount = 0;
        let batchVariantCount = 0;
        let batchRecipeCount = 0;

        for (const { profile } of familyBatch) {
          setStage(`creating bakery family ${profile.code}`);
          const [family] = await BakeryProductFamily.create([{
            ...profileFields(profile),
            createdBy: actor._id,
            updatedBy: actor._id,
          }], { session });
          setStage(`creating variants for ${profile.code}`);
          const variantDocs = profile.variants.map((variant) => ({
            familyId: family._id,
            ...variant,
            createdBy: actor._id,
            updatedBy: actor._id,
          }));
          const variants = await BakeryProductVariant.create(variantDocs, { session, ordered: true });
          setStage(`resolving ingredients for ${profile.code}`);
          const ingredients = profile.recipe.ingredients.map((ingredient) => {
            const material = materialByName.get(normalize(ingredient.materialName));
            if (!material || material.unit !== ingredient.unit || !material.active) {
              throw new Error(`Raw material ${ingredient.materialName} is unavailable with expected unit ${ingredient.unit}.`);
            }
            return {
              materialId: material._id,
              materialName: material.name,
              unit: material.unit,
              quantityPerBatch: ingredient.quantityPerBatch,
            };
          });
          setStage(`creating recipe for ${profile.code}`);
          const [recipe] = await BakeryRecipe.create([{
            familyId: family._id,
            seedKey: `${profile.seedKey}:recipe`,
            version: 1,
            batchYield: profile.recipe.batchYield,
            yieldUnit: profile.recipe.yieldUnit,
            ingredients,
            sourceReferences: profile.recipe.sourceReferences,
            formulationNote: profile.recipe.formulationNote,
            createdBy: actor._id,
          }], { session });
          setStage(`linking recipe to ${profile.code}`);
          family.activeRecipeId = recipe._id;
          await family.save({ session });
          batchFamilyCount += 1;
          batchVariantCount += variants.length;
          batchRecipeCount += 1;
        }

        setStage(`writing audit event for family batch ${batchIndex + 1}`);
        await audit.recordAudit({
          eventType: "production.sourdough_catalog_seeded",
          outcome: "success",
          reason: "sourdough_catalog_import",
          actor,
          resource: { type: "production_product" },
          details: {
            catalogVersion: catalog.version,
            familyCount: batchFamilyCount,
            variantCount: batchVariantCount,
            recipeCount: batchRecipeCount,
            materialCount: 0,
            batchIndex: batchIndex + 1,
            batchCount: familyBatches.length,
            published: false,
            active: false,
          },
          transaction: session,
        });

        familyCount += batchFamilyCount;
        variantCount += batchVariantCount;
        recipeCount += batchRecipeCount;
      },
    );
  }

  return {
    familyCount,
    variantCount,
    recipeCount,
    materialCount: databasePlan.missingMaterials.length,
    unchangedFamilyCount: databasePlan.familyPlans.filter((item) => item.existingFamily).length,
    transactionBatchSize: FAMILIES_PER_TRANSACTION,
    familyBatchCount: familyBatches.length,
  };
}

async function main(args = process.argv.slice(2)) {
  if (args.includes("--help")) {
    console.log("Usage: node scripts/seedSourdoughCatalog.js [--check-database | --apply --confirm-database <name> --actor-id <id> [--create-missing-materials]]");
    return;
  }

  const catalog = loadCatalog();
  const validationErrors = validateCatalog(catalog);
  if (validationErrors.length) {
    throw new Error(`Catalog validation failed: ${validationErrors.join(" ")}`);
  }

  const apply = args.includes("--apply");
  const checkDatabase = args.includes("--check-database") || apply;
  if (!checkDatabase) {
    printReport(catalog);
    return;
  }

  const target = isNonProductionTarget(process.env.DB_URL);
  if (!target.allowed) throw new Error(target.reason);
  if (argumentValue(args, "--confirm-database") !== target.database) {
    throw new Error("Pass --confirm-database with the exact non-production database name from DB_URL.");
  }

  await mongoose.connect(process.env.DB_URL);
  try {
    const databasePlan = await inspectDatabase(catalog);
    printReport(catalog, databasePlan);
    if (!apply) {
      if (databasePlan.errors.length) throw new Error("Database check found blockers; see the report above.");
      return;
    }

    const actorId = argumentValue(args, "--actor-id");
    if (!mongoose.isValidObjectId(actorId)) throw new Error("--actor-id must be an active Super Admin user ID.");
    const actor = await User.findOne({
      _id: actorId,
      status: "Active",
      roles: "Super Admin",
    }).select("_id name email roles").lean();
    if (!actor) throw new Error("--actor-id must identify an active Super Admin.");
    const result = await applyCatalog(catalog, databasePlan, actor, args);
    console.log(JSON.stringify({ mode: "applied", database: target.database, ...result }, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({ errors: errorDiagnostics(error) }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = {
  familyMatches,
  chunkItems,
  errorDiagnostics,
  inspectDatabase,
  main,
  recipeMatches,
  variantMatches,
};
