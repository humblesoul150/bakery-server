const assert = require("node:assert/strict");
const { test } = require("node:test");
const { AUDIT_EVENT_TYPES } = require("../models/auditEvent");
const routes = require("../routes/production");
const uploadRoutes = require("../routes/uploads");
const {
  addShelfLifeDays,
  validateBatch,
  validateCompletion,
  validateFamily,
  validateRecipe,
  validateStorefront,
  isBakeryProductImagePublicId,
} = require("../controllers/bakeryProductionController");

const familyId = "507f1f77bcf86cd799439011";
const materialId = "507f1f77bcf86cd799439012";
const variantId = "507f1f77bcf86cd799439013";

test("bakery family validation accepts optional bakery defaults and rejects unsafe catalog fields", () => {
  const result = validateFamily({
    code: "BREAD",
    name: "Sourdough",
    category: "Bread",
    baseUnit: "piece",
    shelfLifeDays: 2.5,
    variants: [{
      sku: "BREAD-LOAF",
      name: "Classic loaf",
      saleUnit: "loaf",
      unitsPerSaleUnit: 1,
      price: 5000,
    }],
  });
  assert.equal(result.error, undefined);
  assert.equal(validateFamily({
    code: "bread",
    name: "Sourdough",
    category: "Bread",
    baseUnit: "piece",
    variants: result.value.variants,
  }).value.code, "BREAD");
  assert.equal(result.value.shelfLifeDays, 2.5);
  assert.ok(validateFamily({
    code: "BREAD",
    name: "Sourdough",
    category: "Bread",
    baseUnit: "piece",
    shelfLifeDays: 0.1,
    variants: result.value.variants,
  }).error);
  assert.equal(validateFamily({ ...result.value, storefront: { published: "true" } }).error, "storefront.published must be true or false.");
  assert.match(validateFamily({
    code: "BREAD",
    name: "Sourdough",
    category: "Bread",
    baseUnit: "piece",
    variants: result.value.variants,
    unexpected: true,
  }).error, /supported by this bakery production request/);
});

test("bakery storefront image validation preserves legacy URLs and accepts owned Cloudinary metadata", () => {
  const legacy = validateStorefront({
    images: [{ url: "https://cdn.example/legacy-product.png" }],
  });
  assert.equal(legacy.error, undefined);
  assert.equal(legacy.value.images[0].publicId, undefined);

  const publicId = `family-${familyId}-image-123`;
  const image = validateStorefront({
    images: [{
      url: "https://res.cloudinary.com/demo/image/upload/v1/anli/bakery/products/product.webp",
      publicId,
      altText: "Sourdough loaf",
      sortOrder: 0,
    }],
  });
  assert.equal(image.error, undefined);
  assert.equal(image.value.images[0].publicId, publicId);
  assert.equal(isBakeryProductImagePublicId(publicId, familyId), true);
  assert.equal(isBakeryProductImagePublicId(publicId, materialId), false);

  assert.match(validateStorefront({
    images: [{
      url: "http://res.cloudinary.com/demo/image/upload/product.webp",
      publicId,
    }],
  }).error, /Cloudinary HTTPS URL/);
  assert.match(validateStorefront({
    images: [{
      url: "https://res.cloudinary.com/demo/image/upload/product.webp",
      publicId: "product.webp",
    }],
  }).error, /family-scoped image ID/);
  assert.match(validateStorefront({
    images: [{
      url: "https://res.cloudinary.com/demo/image/upload/product.webp",
      publicId,
      unexpected: "not accepted",
    }],
  }).error, /valid URL/);
});

test("bakery recipe, batch, and completion validators require their core fields", () => {
  assert.match(validateRecipe({ batchYield: 2, yieldUnit: "loaf" }).error, /ingredients are required/);
  assert.equal(validateRecipe({
    batchYield: 2,
    yieldUnit: "loaf",
    ingredients: [{ materialId, quantityPerBatch: 3.25 }],
  }).error, undefined);
  assert.match(validateBatch({ familyId, productionDate: "2025-02-29", location: "Main Warehouse", batchMultiplier: 1, idempotencyKey: "batch-1" }).error, /valid family/);
  assert.equal(validateCompletion({
    actualIngredients: [{ materialId, actualQuantity: 2.75 }],
    outputs: [{ variantId, quantity: 3 }],
    idempotencyKey: "completion-1",
  }).error, undefined);
  assert.match(validateCompletion({
    actualIngredients: [],
    outputs: [{ variantId, quantity: 3 }],
    idempotencyKey: "completion-1",
    unapprovedField: true,
  }).error, /supported by this bakery production request/);
});

test("fractional shelf-life days round upward to avoid expiring product too early", () => {
  assert.equal(addShelfLifeDays("2026-03-10", 0.25), "2026-03-11");
  assert.equal(addShelfLifeDays("2026-03-10", 2), "2026-03-12");
});

test("bakery production endpoints use the existing production role policies and audit event types", () => {
  const paths = routes.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
  for (const path of [
    "/bakery/families",
    "/bakery/families/:id",
    "/bakery/families/:id/variants",
    "/bakery/families/:id/recipe",
    "/bakery/batches",
    "/bakery/batches/:id/complete",
    "/bakery/lots",
    "/bakery/lots/:id/write-off",
  ]) {
    assert.ok(paths.includes(path), `Missing route ${path}`);
  }
  for (const eventType of [
    "production.bakery_family_created",
    "production.bakery_family_updated",
    "production.bakery_variant_created",
    "production.bakery_recipe_updated",
    "production.bakery_batch_created",
    "production.bakery_batch_completed",
  ]) {
    assert.ok(AUDIT_EVENT_TYPES.includes(eventType), `Missing audit type ${eventType}`);
  }
});

test("bakery product image signing and cleanup routes are registered", () => {
  const uploadPaths = uploadRoutes.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
  const productionPaths = routes.stack.filter((layer) => layer.route).map((layer) => layer.route.path);
  assert.ok(uploadPaths.includes("/bakery-product-image/signed"));
  assert.ok(productionPaths.includes("/bakery/families/:id/images/cleanup"));
  assert.ok(productionPaths.includes("/bakery/families/:id/images/unattached"));
});
