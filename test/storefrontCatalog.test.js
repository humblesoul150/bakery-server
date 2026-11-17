const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  BESTSELLER_LIMIT,
  BESTSELLER_MINIMUM_SALES,
  bestsellerWindow,
  buildBestsellerPipeline,
  isNewThisMonth,
  serializePublicProduct,
} = require("../controllers/storefrontController");
const routes = require("../routes/storefront");
const { backfillFirstPublishedAt } = require("../scripts/backfillBakeryFirstPublishedAt");

const familyId = "507f1f77bcf86cd799439011";
const variantId = "507f1f77bcf86cd799439012";

test("New badge follows the first-published calendar month in Kampala", () => {
  assert.equal(
    isNewThisMonth(
      new Date("2026-11-30T21:30:00.000Z"),
      new Date("2026-12-01T01:00:00.000Z"),
    ),
    true,
  );
  assert.equal(
    isNewThisMonth(
      new Date("2026-11-30T20:30:00.000Z"),
      new Date("2026-12-01T01:00:00.000Z"),
    ),
    false,
  );
  assert.equal(isNewThisMonth(null, new Date("2026-12-01T01:00:00.000Z")), false);
});

test("bestseller window is 30 Kampala business dates including today", () => {
  assert.deepEqual(
    bestsellerWindow(new Date("2026-11-15T12:00:00.000Z")),
    { startDate: "2026-10-17", endDate: "2026-11-15" },
  );
  assert.equal(BESTSELLER_LIMIT, 3);
  assert.equal(BESTSELLER_MINIMUM_SALES, 5);
});

test("bestseller aggregation excludes voided sales and counts each family once per sale", () => {
  const pipeline = buildBestsellerPipeline(
    [variantId],
    "2026-10-17",
    "2026-11-15",
  );
  assert.deepEqual(pipeline[0].$match, {
    date: { $gte: "2026-10-17", $lte: "2026-11-15" },
    voidedAt: null,
    "lines.variantId": { $in: [variantId] },
  });
  assert.deepEqual(pipeline[5].$group._id, {
    saleId: "$_id",
    familyId: "$variant.familyId",
  });
  assert.deepEqual(pipeline[7], { $match: { salesCount: { $gte: 5 } } });
  assert.deepEqual(pipeline[9], { $limit: 3 });
});

test("public product projection omits internal fields and includes computed badges", () => {
  const product = serializePublicProduct(
    {
      _id: familyId,
      name: "Country loaf",
      category: "Bread",
      flavour: "Classic",
      createdBy: "staff-id",
      recipe: { ingredients: ["private"] },
      storefront: {
        published: true,
        slug: "country-loaf",
        description: "Naturally leavened loaf.",
        ingredientsStatement: "Flour, water, salt.",
        allergens: ["Wheat"],
        firstPublishedAt: new Date("2026-11-02T10:00:00.000Z"),
        images: [
          { url: "https://cdn.example/second.webp", altText: "Second", sortOrder: 1 },
          { url: "https://cdn.example/first.webp", altText: "First", sortOrder: 0 },
          { url: "http://cdn.example/insecure.webp", altText: "Insecure", sortOrder: 2 },
        ],
      },
    },
    [{
      _id: variantId,
      sku: "COUNTRY-1",
      name: "One loaf",
      saleUnit: "loaf",
      unitsPerSaleUnit: 1,
      price: 18000,
      responsibleUserId: "staff-id",
    }],
    new Set([familyId]),
    new Date("2026-11-15T10:00:00.000Z"),
  );
  assert.deepEqual(product.badges, ["bestseller", "new"]);
  assert.deepEqual(product.images.map((image) => image.altText), ["First", "Second"]);
  assert.equal(product.variants[0].id, variantId);
  assert.equal("createdBy" in product, false);
  assert.equal("recipe" in product, false);
  assert.equal("responsibleUserId" in product.variants[0], false);
});

test("public catalog route exposes only the intended unauthenticated GET", () => {
  const route = routes.stack.find((layer) => layer.route?.path === "/catalog");
  assert.ok(route);
  assert.equal(route.route.methods.get, true);
  assert.equal(route.route.stack.length, 1);
});

test("public settings route exposes only the intended unauthenticated GET", () => {
  const route = routes.stack.find((layer) => layer.route?.path === "/settings");
  assert.ok(route);
  assert.equal(route.route.methods.get, true);
  assert.equal(route.route.stack.length, 1);
});

test("first-publish backfill is dry-run by default and idempotent when applied", async () => {
  const family = {
    _id: familyId,
    createdAt: new Date("2026-10-28T10:00:00.000Z"),
  };
  const bulkWrites = [];
  const filter = {
    "storefront.published": true,
    "storefront.firstPublishedAt": null,
  };
  const Family = {
    find(receivedFilter) {
      assert.deepEqual(receivedFilter, filter);
      return {
        select() { return this; },
        lean() { return this; },
        cursor() {
          return {
            async *[Symbol.asyncIterator]() {
              yield family;
            },
          };
        },
      };
    },
    async bulkWrite(operations, options) {
      bulkWrites.push({ operations, options });
      return { modifiedCount: operations.length };
    },
  };

  assert.deepEqual(await backfillFirstPublishedAt({ Family }), { candidates: 1, updated: 0 });
  assert.equal(bulkWrites.length, 0);
  assert.deepEqual(
    await backfillFirstPublishedAt({ Family, apply: true }),
    { candidates: 1, updated: 1 },
  );
  assert.deepEqual(
    bulkWrites[0].operations[0].updateOne.update.$set,
    { "storefront.firstPublishedAt": family.createdAt },
  );
  assert.equal(bulkWrites[0].options.ordered, false);
});
