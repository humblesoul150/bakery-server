const BakeryProductFamily = require("../models/bakeryProductFamily");
const BakeryProductVariant = require("../models/bakeryProductVariant");
const Sale = require("../models/sale");

const TIME_ZONE = "Africa/Kampala";
const BESTSELLER_WINDOW_DAYS = 30;
const BESTSELLER_LIMIT = 3;
const BESTSELLER_MINIMUM_SALES = 5;

function datePartsInKampala(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  return Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
}

function dateKeyInKampala(value = new Date()) {
  const parts = datePartsInKampala(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function monthKeyInKampala(value) {
  if (!value) return "";
  const parts = datePartsInKampala(value instanceof Date ? value : new Date(value));
  return `${parts.year}-${parts.month}`;
}

function isNewThisMonth(firstPublishedAt, now = new Date()) {
  return Boolean(firstPublishedAt)
    && monthKeyInKampala(firstPublishedAt) === monthKeyInKampala(now);
}

function bestsellerWindow(now = new Date()) {
  const endDate = dateKeyInKampala(now);
  const start = new Date(`${endDate}T00:00:00.000Z`);
  start.setUTCDate(start.getUTCDate() - (BESTSELLER_WINDOW_DAYS - 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate,
  };
}

function buildBestsellerPipeline(variantIds, startDate, endDate) {
  return [
    {
      $match: {
        date: { $gte: startDate, $lte: endDate },
        voidedAt: null,
        "lines.variantId": { $in: variantIds },
      },
    },
    { $unwind: "$lines" },
    { $match: { "lines.variantId": { $in: variantIds } } },
    {
      $lookup: {
        from: BakeryProductVariant.collection.name,
        localField: "lines.variantId",
        foreignField: "_id",
        as: "variant",
      },
    },
    { $unwind: "$variant" },
    {
      $group: {
        _id: { saleId: "$_id", familyId: "$variant.familyId" },
      },
    },
    {
      $group: {
        _id: "$_id.familyId",
        salesCount: { $sum: 1 },
      },
    },
    { $match: { salesCount: { $gte: BESTSELLER_MINIMUM_SALES } } },
    { $sort: { salesCount: -1, _id: 1 } },
    { $limit: BESTSELLER_LIMIT },
  ];
}

function serializePublicProduct(family, variants, bestsellerFamilyIds, now = new Date()) {
  const storefront = family.storefront || {};
  const badges = [];
  if (bestsellerFamilyIds.has(String(family._id))) badges.push("bestseller");
  if (isNewThisMonth(storefront.firstPublishedAt, now)) badges.push("new");
  return {
    id: String(family._id),
    name: family.name,
    category: family.category,
    flavour: family.flavour || "",
    slug: storefront.slug,
    description: storefront.description || "",
    ingredientsStatement: storefront.ingredientsStatement || "",
    allergens: storefront.allergens || [],
    images: (storefront.images || [])
      .filter((image) => typeof image.url === "string" && image.url.startsWith("https://"))
      .sort((left, right) => left.sortOrder - right.sortOrder)
      .map((image) => ({ url: image.url, altText: image.altText || "" })),
    firstPublishedAt: storefront.firstPublishedAt || null,
    badges,
    variants: variants.map((variant) => ({
      id: String(variant._id),
      sku: variant.sku,
      name: variant.name,
      saleUnit: variant.saleUnit,
      unitsPerSaleUnit: variant.unitsPerSaleUnit,
      price: variant.price,
    })),
  };
}

async function listCatalog(_request, response) {
  const families = await BakeryProductFamily.find({
    active: true,
    "storefront.published": true,
  })
    .select("_id name category flavour storefront")
    .sort({ category: 1, name: 1, _id: 1 })
    .lean();

  if (!families.length) {
    response.set("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
    return response.json({ products: [] });
  }

  const variants = await BakeryProductVariant.find({
    familyId: { $in: families.map((family) => family._id) },
    active: true,
  })
    .select("_id familyId sku name saleUnit unitsPerSaleUnit price")
    .sort({ sku: 1, _id: 1 })
    .lean();
  const variantsByFamily = new Map();
  for (const variant of variants) {
    const familyId = String(variant.familyId);
    variantsByFamily.set(familyId, [...(variantsByFamily.get(familyId) || []), variant]);
  }
  const products = families.filter((family) => variantsByFamily.has(String(family._id)));
  const productFamilyIds = new Set(products.map((family) => String(family._id)));
  const publicVariants = variants.filter((variant) =>
    productFamilyIds.has(String(variant.familyId)),
  );
  const { startDate, endDate } = bestsellerWindow();
  const bestsellerRecords = publicVariants.length
    ? await Sale.aggregate(
      buildBestsellerPipeline(
        publicVariants.map((variant) => variant._id),
        startDate,
        endDate,
      ),
    )
    : [];
  const bestsellerFamilyIds = new Set(
    bestsellerRecords.map((record) => String(record._id)),
  );
  const now = new Date();
  const result = products.map((family) =>
    serializePublicProduct(
      family,
      variantsByFamily.get(String(family._id)) || [],
      bestsellerFamilyIds,
      now,
    ),
  );

  response.set("Cache-Control", "public, max-age=0, s-maxage=60, stale-while-revalidate=300");
  return response.json({ products: result });
}

module.exports = {
  BESTSELLER_LIMIT,
  BESTSELLER_MINIMUM_SALES,
  BESTSELLER_WINDOW_DAYS,
  bestsellerWindow,
  buildBestsellerPipeline,
  isNewThisMonth,
  listCatalog,
  monthKeyInKampala,
  serializePublicProduct,
};
