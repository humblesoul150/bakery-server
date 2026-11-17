const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { buildCatalog } = require("../scripts/data/sourdoughCatalogData");
const { chunkItems } = require("../scripts/seedSourdoughCatalog");
const {
  isNonProductionTarget,
  planMaterialResolution,
  validateCatalog,
} = require("../lib/sourdoughCatalogSeed");
const { errorDiagnostics } = require("../scripts/seedSourdoughCatalog");
const BakeryProductFamily = require("../models/bakeryProductFamily");
const BakeryRecipe = require("../models/bakeryRecipe");

test("portable JSON catalog export matches the validated catalog", () => {
  const exportPath = path.join(__dirname, "../scripts/data/sourdoughCatalogImport.json");
  const catalog = JSON.parse(fs.readFileSync(exportPath, "utf8"));
  assert.deepEqual(catalog, buildCatalog());
  assert.deepEqual(validateCatalog(catalog), []);
});

test("family transaction batches preserve order and cap transaction size", () => {
  const items = Array.from({ length: 12 }, (_value, index) => index);
  const batches = chunkItems(items, 5);
  assert.deepEqual(batches, [[0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11]]);
  assert.ok(batches.every((batch) => batch.length <= 5));
});

test("sourdough catalog contains the required profiles, flavours, recipes, and UGX prices", () => {
  const catalog = buildCatalog();
  assert.deepEqual(validateCatalog(catalog), []);
  assert.equal(catalog.currency, "UGX");
  assert.equal(catalog.families.length, 85);
  assert.equal(Object.keys(catalog.productCountByCategory).length, 17);
  assert.equal(catalog.materialDefinitions.length, 50);
  assert.ok(Object.values(catalog.productCountByCategory).every((count) => count === 5));

  for (const profile of catalog.families) {
    assert.equal(profile.active, false);
    assert.equal(profile.storefront.published, false);
    assert.deepEqual(profile.storefront.images, []);
    assert.ok(profile.recipe.batchYield > 0);
    assert.ok(profile.recipe.ingredients.length > 0);
    assert.ok(profile.recipe.sourceReferences.every((source) => source.startsWith("https://")));
    assert.ok(profile.variants.every((variant) => Number.isSafeInteger(variant.price) && variant.price > 0));
  }
});

test("catalog validation rejects published, image-bearing, or invalid-price profiles", () => {
  const catalog = buildCatalog();
  catalog.families[0].storefront.published = true;
  catalog.families[1].storefront.images.push({ url: "https://example.com/image.jpg" });
  catalog.families[2].variants[0].price = 1.5;

  const errors = validateCatalog(catalog);
  assert.ok(errors.some((error) => error.includes("inactive/unpublished state")));
  assert.ok(errors.some((error) => error.includes("image-free profile")));
  assert.ok(errors.some((error) => error.includes("whole-UGX price")));
});

test("seed error diagnostics include transaction metadata and redact MongoDB URLs", () => {
  const previousDbUrl = process.env.DB_URL;
  process.env.DB_URL = "mongodb://operator:private-pass@db.example.test/bakery_staging";
  try {
    const cause = new Error(`Transaction aborted for ${process.env.DB_URL}`);
    cause.code = 251;
    cause.codeName = "NoSuchTransaction";
    cause.errorLabels = ["TransientTransactionError"];
    const error = new Error("Catalog import failed", { cause });
    error.stage = "creating raw material ING-FLOUR";

    const diagnostics = errorDiagnostics(error);
    const output = JSON.stringify(diagnostics);
    assert.equal(diagnostics[0].stage, "creating raw material ING-FLOUR");
    assert.equal(diagnostics[1].code, 251);
    assert.equal(diagnostics[1].codeName, "NoSuchTransaction");
    assert.deepEqual(diagnostics[1].errorLabels, ["TransientTransactionError"]);
    assert.doesNotMatch(output, /private-pass|db\.example\.test/);
    assert.match(output, /\[redacted DB_URL\]/);
  } finally {
    if (previousDbUrl === undefined) delete process.env.DB_URL;
    else process.env.DB_URL = previousDbUrl;
  }
});

test("material reconciliation detects missing materials, unit drift, and code collisions", () => {
  const definitions = [
    { code: "ING-FLOUR", name: "Bread flour", unit: "kg", category: "Ingredients" },
    { code: "ING-SALT", name: "Fine salt", unit: "kg", category: "Ingredients" },
  ];
  const ingredients = [
    { materialName: "Bread flour", unit: "kg" },
    { materialName: "Fine salt", unit: "kg" },
  ];
  const exact = planMaterialResolution(definitions, ingredients, [{
    code: "ING-FLOUR",
    name: "Bread flour",
    unit: "kg",
    category: "Ingredients",
    active: true,
  }]);
  assert.deepEqual(exact.errors, []);
  assert.deepEqual(exact.missing.map((item) => item.name), ["Fine salt"]);

  const conflicting = planMaterialResolution(definitions, ingredients, [{
    code: "ING-FLOUR",
    name: "Bread flour",
    unit: "g",
    category: "Ingredients",
    active: true,
  }, {
    code: "ING-SALT",
    name: "Other material",
    unit: "kg",
    category: "Ingredients",
    active: true,
  }]);
  assert.ok(conflicting.errors.some((error) => error.includes("unit kg")));
  assert.ok(conflicting.errors.some((error) => error.includes("already assigned")));
});

test("seed apply target check allows explicit non-production targets and rejects production", () => {
  assert.equal(isNonProductionTarget(
    "mongodb://operator:secret@localhost:27017/bakery_dev?replicaSet=rs0",
    "development",
  ).allowed, true);
  assert.equal(isNonProductionTarget(
    "mongodb+srv://operator:secret@cluster.example.mongodb.net/bakery_staging",
    "development",
  ).allowed, true);
  assert.equal(isNonProductionTarget(
    "mongodb://operator:secret@mongo-a.example.test:27017,mongo-b.example.test:27017/bakery_test?replicaSet=rs0",
    "development",
  ).allowed, true);
  assert.equal(isNonProductionTarget(
    "mongodb+srv://operator:secret@cluster.example.mongodb.net/bakery",
    "development",
  ).allowed, false);
  assert.equal(isNonProductionTarget(
    "mongodb://localhost:27017/bakery_dev",
    "production",
  ).allowed, false);
  assert.equal(isNonProductionTarget(
    "mongodb://localhost:27017/bakery_prod",
    "development",
  ).allowed, false);
  assert.equal(isNonProductionTarget(
    "https://localhost:27017/bakery_dev",
    "development",
  ).allowed, false);
});

test("catalog seed metadata is persisted on families and recipe source references are validated", () => {
  assert.ok(BakeryProductFamily.schema.path("seedKey"));
  assert.ok(BakeryRecipe.schema.path("seedKey"));
  assert.ok(BakeryRecipe.schema.path("sourceReferences"));
  assert.ok(BakeryRecipe.schema.path("formulationNote"));
});
