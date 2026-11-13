const { createHash, randomUUID } = require("node:crypto");
const mongoose = require("mongoose");
const BakeryProductFamily = require("../models/bakeryProductFamily");
const BakeryProductImageCleanup = require("../models/bakeryProductImageCleanup");
const BakeryProductVariant = require("../models/bakeryProductVariant");
const BakeryRecipe = require("../models/bakeryRecipe");
const BakeryProductionBatch = require("../models/bakeryProductionBatch");
const FinishedStockLot = require("../models/finishedStockLot");
const FinishedStockLotMovement = require("../models/finishedStockLotMovement");
const RawMaterial = require("../models/rawMaterial");
const RawMaterialBalance = require("../models/rawMaterialBalance");
const RawMaterialMovement = require("../models/rawMaterialMovement");
const audit = require("../lib/audit");
const { deleteImage } = require("../configs/cloudinary");
const { recordRawMaterialMovement } = require("../lib/productionInventory");
const { resolveFinishedStockExpiryAlerts } = require("../lib/finishedStockExpiryAlerts");
const { allocatePreorderOutput } = require("../lib/finishedStockLotOrders");

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const MAX_INGREDIENTS = 100;
const MAX_OUTPUTS = 100;

function isBakeryProductImagePublicId(publicId, familyId) {
  return typeof publicId === "string" &&
    publicId.startsWith(`family-${familyId}-`) &&
    /^family-[a-f0-9]{24}-[a-z0-9-]+$/i.test(publicId);
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validId(value) {
  return typeof value === "string" && mongoose.isValidObjectId(value);
}

function positive(value) {
  return Number.isFinite(value) && value > 0;
}

function validateObject(body, fields) {
  if (!isRecord(body) || Object.keys(body).some((key) => !fields.includes(key))) {
    return { error: "Provide only fields supported by this bakery production request." };
  }
  return { value: body };
}

function validateStorefront(value) {
  const fields = ["published", "slug", "description", "images", "ingredientsStatement", "allergens"];
  if (!isRecord(value) || Object.keys(value).some((key) => !fields.includes(key))) {
    return { error: "Provide supported customer-facing product fields." };
  }
  if (value.published !== undefined && typeof value.published !== "boolean") {
    return { error: "storefront.published must be true or false." };
  }
  const output = {};
  if (value.published !== undefined) output.published = value.published;
  if (value.slug !== undefined) {
    if (typeof value.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) || value.slug.length > 120) {
      return { error: "Storefront slug must contain lowercase letters, numbers, and single dashes." };
    }
    output.slug = value.slug;
  }
  for (const [field, max] of [["description", 2000], ["ingredientsStatement", 2000]]) {
    if (value[field] !== undefined) {
      if (typeof value[field] !== "string" || value[field].length > max) {
        return { error: `storefront.${field} must be ${max} characters or fewer.` };
      }
      output[field] = value[field].trim();
    }
  }
  if (value.images !== undefined) {
    if (!Array.isArray(value.images) || value.images.length > 10) {
      return { error: "Provide no more than 10 product images." };
    }
    const images = [];
    for (const image of value.images) {
      if (!isRecord(image) || Object.keys(image).some((key) => !["url", "publicId", "altText", "sortOrder"].includes(key))
        || typeof image.url !== "string" || !image.url.trim() || image.url.length > 1000
        || (image.publicId !== undefined && (typeof image.publicId !== "string" || !image.publicId.trim() || image.publicId.length > 255))
        || (image.altText !== undefined && (typeof image.altText !== "string" || image.altText.length > 240))
        || (image.sortOrder !== undefined && (!Number.isInteger(image.sortOrder) || image.sortOrder < 0))) {
        return { error: "Each product image must have a valid URL, optional public ID and alt text, and non-negative sort order." };
      }
      if (image.publicId) {
        let parsedUrl;
        try {
          parsedUrl = new URL(image.url);
        } catch {
          return { error: "Cloudinary product images must use a valid HTTPS URL." };
        }
        if (parsedUrl.protocol !== "https:" || parsedUrl.hostname !== "res.cloudinary.com"
          || !/^family-[a-f0-9]{24}-[a-z0-9-]+$/i.test(image.publicId)) {
          return { error: "New product images must use a Cloudinary HTTPS URL and a family-scoped image ID." };
        }
      }
      images.push({
        url: image.url.trim(),
        ...(image.publicId ? { publicId: image.publicId.trim() } : {}),
        altText: image.altText?.trim() ?? "",
        sortOrder: image.sortOrder ?? images.length,
      });
    }
    output.images = images;
  }
  if (value.allergens !== undefined) {
    if (!Array.isArray(value.allergens) || value.allergens.length > 30
      || value.allergens.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 80)) {
      return { error: "Allergens must be a list of up to 30 non-empty labels." };
    }
    output.allergens = [...new Set(value.allergens.map((item) => item.trim()))];
  }
  return { value: output };
}

function validateVariants(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    return { error: "A product family must have between 1 and 100 sellable variants." };
  }
  const skus = new Set();
  const variants = [];
  for (const variant of value) {
    if (!isRecord(variant) || Object.keys(variant).some((key) =>
      !["sku", "name", "saleUnit", "unitsPerSaleUnit", "price", "active", "responsibleUserId", "packagingMaterials"].includes(key))) {
      return { error: "Each sellable variant contains unsupported fields." };
    }
    const sku = typeof variant.sku === "string" ? variant.sku.trim().toUpperCase() : "";
    const name = typeof variant.name === "string" ? variant.name.trim() : "";
    const saleUnit = typeof variant.saleUnit === "string" ? variant.saleUnit.trim() : "";
    const units = Number(variant.unitsPerSaleUnit);
    const price = Number(variant.price);
    if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(sku) || !name || name.length > 160
      || !saleUnit || saleUnit.length > 40 || !Number.isSafeInteger(units) || units < 1
      || !Number.isSafeInteger(price) || price < 1) {
      return { error: "Each variant needs a valid SKU, name, sale unit, positive whole unit count, and whole-UGX price." };
    }
    if (skus.has(sku)) return { error: "Variant SKUs must be unique within a product family." };
    skus.add(sku);
    if (variant.active !== undefined && typeof variant.active !== "boolean") {
      return { error: "Variant active must be true or false." };
    }
    if (variant.responsibleUserId !== undefined && variant.responsibleUserId !== null
      && !validId(variant.responsibleUserId)) {
      return { error: "Variant responsibleUserId must identify a valid user." };
    }
    const packagingMaterials = variant.packagingMaterials ?? [];
    if (!Array.isArray(packagingMaterials) || packagingMaterials.length > 30) {
      return { error: "A variant may have up to 30 packaging materials." };
    }
    const packagingIds = new Set();
    const validatedPackaging = [];
    for (const item of packagingMaterials) {
      if (!isRecord(item) || Object.keys(item).some((key) => !["materialId", "quantityPerSaleUnit"].includes(key))
        || !validId(item.materialId) || !positive(Number(item.quantityPerSaleUnit))) {
        return { error: "Each packaging material requires an existing material ID and positive quantity per sale unit." };
      }
      const materialId = String(new mongoose.Types.ObjectId(item.materialId));
      if (packagingIds.has(materialId)) return { error: "A packaging material may appear only once per variant." };
      packagingIds.add(materialId);
      validatedPackaging.push({ materialId, quantityPerSaleUnit: Number(item.quantityPerSaleUnit) });
    }
    variants.push({
      sku,
      name,
      saleUnit,
      unitsPerSaleUnit: units,
      price,
      active: variant.active ?? true,
      responsibleUserId: variant.responsibleUserId || null,
      packagingMaterials: validatedPackaging,
    });
  }
  return { value: variants };
}

async function resolveVariantPackaging(variants, session) {
  const resolved = [];
  for (const variant of variants) {
    const packagingMaterials = [];
    for (const item of variant.packagingMaterials || []) {
      const material = await RawMaterial.findOne({
        _id: item.materialId,
        active: true,
        category: "Packaging",
      }).session(session);
      if (!material) throw conflict("Each variant packaging material must be an active material in the Packaging category.");
      packagingMaterials.push({
        materialId: material._id,
        materialName: material.name,
        unit: material.unit,
        quantityPerSaleUnit: item.quantityPerSaleUnit,
      });
    }
    resolved.push({ ...variant, packagingMaterials });
  }
  return resolved;
}

function validateFamily(body, partial = false) {
  const fields = ["code", "name", "category", "flavour", "baseUnit", "shelfLifeDays", "dateLabelType", "storageInstructions", "storefront", "active", "variants"];
  const request = validateObject(body, fields, partial);
  if (request.error) return request;
  const value = {};
  for (const field of ["code", "name", "category", "baseUnit"]) {
    if (!own(body, field) && partial) continue;
    if (typeof body[field] !== "string" || !body[field].trim()) return { error: `${field} is required.` };
    value[field] = field === "code" ? body[field].trim().toUpperCase() : body[field].trim();
  }
  if (value.code && (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/.test(value.code))) {
    return { error: "Product family code must contain at most 40 letters, numbers, dots, dashes, or underscores." };
  }
  if (value.name && value.name.length > 160) return { error: "Product family name must be 160 characters or fewer." };
  if (value.category && value.category.length > 80) return { error: "Product category must be 80 characters or fewer." };
  if (value.baseUnit && value.baseUnit.length > 24) return { error: "Product base unit must be 24 characters or fewer." };
  if (own(body, "flavour")) {
    if (typeof body.flavour !== "string" || body.flavour.trim().length > 80) return { error: "flavour must be text of 80 characters or fewer." };
    value.flavour = body.flavour.trim();
  }
  if (own(body, "shelfLifeDays")) {
    const days = Number(body.shelfLifeDays);
    if (!positive(days) || days < 0.25 || days > 365) return { error: "shelfLifeDays must be from 0.25 to 365 days." };
    value.shelfLifeDays = days;
  }
  if (own(body, "dateLabelType")) {
    if (!["best_before", "use_by"].includes(body.dateLabelType)) return { error: "Choose best_before or use_by for the date label type." };
    value.dateLabelType = body.dateLabelType;
  }
  if (own(body, "storageInstructions")) {
    if (typeof body.storageInstructions !== "string" || body.storageInstructions.length > 500) return { error: "storageInstructions must be 500 characters or fewer." };
    value.storageInstructions = body.storageInstructions.trim();
  }
  if (own(body, "active")) {
    if (typeof body.active !== "boolean") return { error: "active must be true or false." };
    value.active = body.active;
  }
  if (own(body, "storefront")) {
    const storefront = validateStorefront(body.storefront);
    if (storefront.error) return storefront;
    value.storefront = storefront.value;
  }
  if (own(body, "variants")) {
    const variants = validateVariants(body.variants);
    if (variants.error) return variants;
    value.variants = variants.value;
  } else if (!partial) {
    return { error: "A product family must include sellable variants." };
  }
  return { value };
}

function validateRecipe(body) {
  const request = validateObject(body, ["batchYield", "yieldUnit", "ingredients"]);
  if (request.error) return request;
  if (!["batchYield", "yieldUnit", "ingredients"].every((field) => own(body, field))) {
    return { error: "Batch yield, yield unit, and ingredients are required." };
  }
  const batchYield = Number(body.batchYield);
  const yieldUnit = typeof body.yieldUnit === "string" ? body.yieldUnit.trim() : "";
  if (!positive(batchYield) || batchYield > 1_000_000 || !yieldUnit || yieldUnit.length > 40) {
    return { error: "Provide a positive batch yield and a valid yield unit." };
  }
  if (!Array.isArray(body.ingredients) || body.ingredients.length < 1 || body.ingredients.length > MAX_INGREDIENTS) {
    return { error: `A recipe must contain between 1 and ${MAX_INGREDIENTS} ingredients.` };
  }
  const ids = new Set();
  const ingredients = [];
  for (const item of body.ingredients) {
    if (!isRecord(item) || Object.keys(item).some((key) => !["materialId", "quantityPerBatch"].includes(key))
      || !validId(item.materialId)) {
      return { error: "Each ingredient must reference a valid raw material." };
    }
    const materialId = String(new mongoose.Types.ObjectId(item.materialId));
    const quantity = Number(item.quantityPerBatch);
    if (!positive(quantity) || quantity > 1_000_000_000) return { error: "Ingredient quantity per batch must be a positive finite number." };
    if (ids.has(materialId)) return { error: "A raw material can appear only once in a recipe." };
    ids.add(materialId);
    ingredients.push({ materialId, quantityPerBatch: quantity });
  }
  return { value: { batchYield, yieldUnit, ingredients } };
}

function validateBatch(body) {
  const request = validateObject(body, ["familyId", "productionDate", "location", "batchMultiplier", "idempotencyKey", "notes"]);
  if (request.error) return request;
  if (!["familyId", "productionDate", "location", "batchMultiplier", "idempotencyKey"].every((field) => own(body, field))) {
    return { error: "All production batch fields are required." };
  }
  const batchMultiplier = Number(body.batchMultiplier);
  if (!validId(body.familyId) || !validDate(body.productionDate) || body.productionDate > today()
    || !positive(batchMultiplier) || batchMultiplier > 1000
    || typeof body.location !== "string" || !body.location.trim() || body.location.trim().length > 100
    || typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim() || body.idempotencyKey.length > 120) {
    return { error: "Provide a valid family, production date, location, positive batch multiplier, and idempotency key." };
  }
  if (body.notes !== undefined && (typeof body.notes !== "string" || body.notes.length > 500)) {
    return { error: "Batch notes must be 500 characters or fewer." };
  }
  return {
    value: {
      familyId: String(new mongoose.Types.ObjectId(body.familyId)),
      productionDate: body.productionDate,
      location: body.location.trim(),
      batchMultiplier,
      idempotencyKey: body.idempotencyKey.trim(),
      notes: body.notes?.trim() ?? "",
    },
  };
}

function validateCompletion(body) {
  const request = validateObject(body, ["actualIngredients", "outputs", "wasteQuantity", "wasteReason", "expiryDate", "dateOverrideReason", "bestBeforeReviewReason", "idempotencyKey"]);
  if (request.error) return request;
  if (!["actualIngredients", "outputs", "idempotencyKey"].every((field) => own(body, field))) {
    return { error: "Ingredient measurements, finished outputs, and an idempotency key are required." };
  }
  if (!Array.isArray(body.actualIngredients) || body.actualIngredients.length > MAX_INGREDIENTS
    || !Array.isArray(body.outputs) || body.outputs.length < 1 || body.outputs.length > MAX_OUTPUTS) {
    return { error: "Provide ingredient measurements and between 1 and 100 finished outputs." };
  }
  const actualIds = new Set();
  const actualIngredients = [];
  for (const line of body.actualIngredients) {
    if (!isRecord(line) || Object.keys(line).some((key) => !["materialId", "actualQuantity"].includes(key))
      || !validId(line.materialId)) {
      return { error: "Each measured ingredient must identify a valid raw material." };
    }
    const materialId = String(new mongoose.Types.ObjectId(line.materialId));
    const actualQuantity = Number(line.actualQuantity);
    if (!Number.isFinite(actualQuantity) || actualQuantity < 0 || actualQuantity > 1_000_000_000) {
      return { error: "Actual ingredient quantities must be non-negative finite numbers." };
    }
    if (actualIds.has(materialId)) return { error: "Each ingredient can be measured only once per batch." };
    actualIds.add(materialId);
    actualIngredients.push({ materialId, actualQuantity });
  }
  const outputIds = new Set();
  const outputs = [];
  for (const output of body.outputs) {
    if (!isRecord(output) || Object.keys(output).some((key) => !["variantId", "quantity"].includes(key))
      || !validId(output.variantId)) {
      return { error: "Each finished output must reference a valid sellable variant." };
    }
    const variantId = String(new mongoose.Types.ObjectId(output.variantId));
    const quantity = Number(output.quantity);
    if (!Number.isSafeInteger(quantity) || quantity < 1) return { error: "Finished output quantities must be positive whole sale units." };
    if (outputIds.has(variantId)) return { error: "A sellable variant can appear only once in batch output." };
    outputIds.add(variantId);
    outputs.push({ variantId, quantity });
  }
  const wasteQuantity = body.wasteQuantity === undefined ? 0 : Number(body.wasteQuantity);
  const wasteReason = body.wasteReason === undefined ? "" : body.wasteReason;
  if (!Number.isFinite(wasteQuantity) || wasteQuantity < 0 || wasteQuantity > 1_000_000_000
    || typeof wasteReason !== "string" || wasteReason.length > 500
    || (wasteQuantity > 0 && !wasteReason.trim())) {
    return { error: "Waste quantity must be non-negative, and a reason is required when waste is recorded." };
  }
  if (body.expiryDate !== undefined && !validDate(body.expiryDate)) return { error: "expiryDate must be a valid YYYY-MM-DD date." };
  if (body.dateOverrideReason !== undefined && (typeof body.dateOverrideReason !== "string" || body.dateOverrideReason.length > 500)) {
    return { error: "dateOverrideReason must be 500 characters or fewer." };
  }
  if (body.bestBeforeReviewReason !== undefined
    && (typeof body.bestBeforeReviewReason !== "string" || body.bestBeforeReviewReason.length > 500)) {
    return { error: "bestBeforeReviewReason must be 500 characters or fewer." };
  }
  if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey.trim() || body.idempotencyKey.length > 120) {
    return { error: "A completion idempotency key is required." };
  }
  return {
    value: {
      actualIngredients,
      outputs,
      wasteQuantity,
      wasteReason: wasteReason.trim(),
      expiryDate: body.expiryDate,
      dateOverrideReason: body.dateOverrideReason?.trim() ?? "",
      bestBeforeReviewReason: body.bestBeforeReviewReason?.trim() ?? "",
      idempotencyKey: body.idempotencyKey.trim(),
    },
  };
}

function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addShelfLifeDays(date, days) {
  const result = new Date(`${date}T00:00:00.000Z`);
  result.setUTCDate(result.getUTCDate() + Math.ceil(days));
  return result.toISOString().slice(0, 10);
}

function serialize(document) {
  if (!document) return document;
  if (document.toJSON) return document.toJSON();
  const result = { ...document };
  if (result._id !== undefined) {
    result.id = String(result._id);
    delete result._id;
  }
  delete result.__v;
  return result;
}

function conflict(message) {
  return Object.assign(new Error(message), { statusCode: 409 });
}

function respondError(error, response) {
  if (Number.isInteger(error.statusCode)) return response.status(error.statusCode).json({ error: error.message });
  if (error.code === 11000) return response.status(409).json({ error: "A bakery record with that code, slug, SKU, or request key already exists." });
  if (["ValidationError", "CastError"].includes(error.name)) return response.status(400).json({ error: error.message });
  throw error;
}

async function inTransaction(work) {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function processFamilyImageCleanup(familyId) {
  const pending = await BakeryProductImageCleanup.find({ familyId })
    .sort({ createdAt: 1 })
    .limit(10)
    .lean();
  for (const item of pending) {
    try {
      const isAttached = await BakeryProductFamily.exists({ "storefront.images.publicId": item.publicId });
      if (isAttached) {
        await BakeryProductImageCleanup.deleteOne({ _id: item._id });
        continue;
      }
      const result = await deleteImage(item.publicId);
      if (!["ok", "not found"].includes(result?.result)) {
        throw new Error("Cloudinary did not confirm image deletion.");
      }
      await BakeryProductImageCleanup.deleteOne({ _id: item._id });
    } catch (error) {
      await BakeryProductImageCleanup.updateOne(
        { _id: item._id },
        {
          $inc: { attempts: 1 },
          $set: { lastError: String(error.message || "Cloudinary image deletion failed.").slice(0, 500) },
        },
      );
      console.error("Unable to remove a replaced bakery product image from Cloudinary:", {
        familyId: String(familyId),
        publicId: item.publicId,
        error,
      });
    }
  }
  return BakeryProductImageCleanup.countDocuments({ familyId });
}

async function listFamilies(_request, response) {
  const families = await BakeryProductFamily.find().sort({ category: 1, name: 1 }).lean();
  const ids = families.map((family) => family._id);
  const [variants, recipes, imageCleanupCounts] = await Promise.all([
    BakeryProductVariant.find({ familyId: { $in: ids } }).sort({ sku: 1 }).lean(),
    BakeryRecipe.find({ _id: { $in: families.map((family) => family.activeRecipeId).filter(Boolean) } }).lean(),
    BakeryProductImageCleanup.aggregate([
      { $match: { familyId: { $in: ids } } },
      { $group: { _id: "$familyId", count: { $sum: 1 } } },
    ]),
  ]);
  const variantsByFamily = new Map();
  for (const variant of variants) {
    const key = String(variant.familyId);
    variantsByFamily.set(key, [...(variantsByFamily.get(key) || []), serialize(variant)]);
  }
  const recipesById = new Map(recipes.map((recipe) => [String(recipe._id), serialize(recipe)]));
  const imageCleanupByFamily = new Map(imageCleanupCounts.map((item) => [String(item._id), item.count]));
  return response.json({
    families: families.map((family) => ({
      ...serialize(family),
      variants: variantsByFamily.get(String(family._id)) || [],
      recipe: recipesById.get(String(family.activeRecipeId)) || null,
      imageCleanupPending: imageCleanupByFamily.get(String(family._id)) || 0,
    })),
  });
}

async function createFamily(request, response) {
  const { value, error } = validateFamily(request.body);
  if (error) return response.status(400).json({ error });
  if (value.storefront?.images?.some((image) => image.publicId)) {
    return response.status(400).json({ error: "Create the product family first, then attach uploaded images to its profile." });
  }
  try {
    const family = await inTransaction(async (session) => {
      const { variants, ...familyValues } = value;
      const resolvedVariants = await resolveVariantPackaging(variants, session);
      const [created] = await BakeryProductFamily.create([{
        ...familyValues,
        createdBy: request.authUser._id,
        updatedBy: request.authUser._id,
      }], { session });
      const createdVariants = await BakeryProductVariant.create(resolvedVariants.map((variant) => ({
        ...variant,
        familyId: created._id,
        createdBy: request.authUser._id,
        updatedBy: request.authUser._id,
      })), { session });
      await audit.recordAudit({
        request,
        eventType: "production.bakery_family_created",
        outcome: "success",
        resource: { type: "production_product", id: String(created._id) },
        details: { familyId: String(created._id), code: created.code, name: created.name, variantCount: variants.length },
        transaction: session,
      });
      return {
        ...serialize(created),
        variants: createdVariants.map(serialize),
      };
    });
    return response.status(201).json({ family });
  } catch (error) {
    return respondError(error, response);
  }
}

async function updateFamily(request, response) {
  if (!validId(request.params.id)) return response.status(400).json({ error: "Product family ID is invalid." });
  const { value, error } = validateFamily(request.body, true);
  if (error) return response.status(400).json({ error });
  if (!Object.keys(value).length) return response.status(400).json({ error: "Provide at least one supported family field." });
  if (value.variants) return response.status(400).json({ error: "Use the sellable variant endpoint to manage variants." });
  if (value.storefront?.images) {
    const invalidImageOwner = value.storefront.images.some((image) =>
      image.publicId && !isBakeryProductImagePublicId(image.publicId, request.params.id));
    if (invalidImageOwner) {
      return response.status(400).json({ error: "The image ID does not belong to this bakery product family." });
    }
  }
  try {
    const result = await inTransaction(async (session) => {
      const record = await BakeryProductFamily.findById(request.params.id).session(session);
      if (!record) throw Object.assign(new Error("Product family not found."), { statusCode: 404 });
      if (value.baseUnit && value.baseUnit !== record.baseUnit) {
        throw conflict("Product base unit cannot change after the family has been created.");
      }
      const updates = { ...value };
      let removedImageIds = [];
      if (updates.storefront) {
        const currentStorefront = record.storefront?.toObject?.() || record.storefront || {};
        updates.storefront = { ...currentStorefront, ...updates.storefront };
        if (Array.isArray(value.storefront.images)) {
          const nextImageIds = new Set(value.storefront.images.map((image) => image.publicId).filter(Boolean));
          removedImageIds = (currentStorefront.images || [])
            .map((image) => image.publicId)
            .filter((publicId) => publicId && !nextImageIds.has(publicId) &&
              isBakeryProductImagePublicId(publicId, request.params.id));
          for (const publicId of removedImageIds) {
            await BakeryProductImageCleanup.updateOne(
              { publicId },
              {
                $setOnInsert: {
                  familyId: record._id,
                  publicId,
                  requestedBy: request.authUser._id,
                },
              },
              { upsert: true, session },
            );
          }
        }
      }
      Object.assign(record, updates, { updatedBy: request.authUser._id });
      await record.save({ session });
      await audit.recordAudit({
        request,
        eventType: "production.bakery_family_updated",
        outcome: "success",
        resource: { type: "production_product", id: String(record._id) },
        details: {
          familyId: String(record._id),
          changedFields: Object.keys(updates),
          removedProductImageCount: removedImageIds.length,
        },
        transaction: session,
      });
      return { family: record, shouldCleanupImages: removedImageIds.length > 0 };
    });
    const imageCleanupPending = result.shouldCleanupImages
      ? await processFamilyImageCleanup(result.family._id)
      : 0;
    return response.json({ family: serialize(result.family), imageCleanupPending });
  } catch (error) {
    return respondError(error, response);
  }
}

async function retryFamilyImageCleanup(request, response) {
  if (!validId(request.params.id)) return response.status(400).json({ error: "Product family ID is invalid." });
  const familyExists = await BakeryProductFamily.exists({ _id: request.params.id });
  if (!familyExists) return response.status(404).json({ error: "Product family not found." });
  const imageCleanupPending = await processFamilyImageCleanup(request.params.id);
  return response.json({ imageCleanupPending });
}

async function deleteUnattachedFamilyImage(request, response) {
  if (!validId(request.params.id)) return response.status(400).json({ error: "Product family ID is invalid." });
  const { publicId } = request.body || {};
  if (!isBakeryProductImagePublicId(publicId, request.params.id)) {
    return response.status(400).json({ error: "The image ID does not belong to this bakery product family." });
  }
  const familyExists = await BakeryProductFamily.exists({ _id: request.params.id });
  if (!familyExists) return response.status(404).json({ error: "Product family not found." });
  const isAttached = await BakeryProductFamily.exists({ "storefront.images.publicId": publicId });
  if (isAttached) return response.status(409).json({ error: "The image is already attached to a product profile." });
  await BakeryProductImageCleanup.updateOne(
    { publicId },
    {
      $setOnInsert: {
        familyId: request.params.id,
        publicId,
        requestedBy: request.authUser._id,
      },
    },
    { upsert: true },
  );
  const imageCleanupPending = await processFamilyImageCleanup(request.params.id);
  const stillPending = await BakeryProductImageCleanup.exists({ familyId: request.params.id, publicId });
  await audit.recordAudit({
    request,
    eventType: "production.bakery_family_updated",
    outcome: "success",
    resource: { type: "production_product", id: request.params.id },
    details: {
      familyId: request.params.id,
      imageAction: stillPending ? "unattached_image_cleanup_queued" : "unattached_image_removed",
    },
  });
  return response.json({ removed: !stillPending, imageCleanupPending });
}

async function addVariant(request, response) {
  if (!validId(request.params.id)) return response.status(400).json({ error: "Product family ID is invalid." });
  const validated = validateVariants([request.body]);
  if (validated.error) return response.status(400).json({ error: validated.error });
  try {
    const variant = await inTransaction(async (session) => {
      const family = await BakeryProductFamily.findById(request.params.id).session(session);
      if (!family || !family.active) throw conflict("The selected product family is missing or inactive.");
      const [resolvedVariant] = await resolveVariantPackaging(validated.value, session);
      const [created] = await BakeryProductVariant.create([{
        ...resolvedVariant,
        familyId: family._id,
        createdBy: request.authUser._id,
        updatedBy: request.authUser._id,
      }], { session });
      await audit.recordAudit({
        request,
        eventType: "production.bakery_variant_created",
        outcome: "success",
        resource: { type: "production_product", id: String(family._id) },
        details: { familyId: String(family._id), variantId: String(created._id), sku: created.sku },
        transaction: session,
      });
      return created;
    });
    return response.status(201).json({ variant: serialize(variant) });
  } catch (error) {
    return respondError(error, response);
  }
}

async function saveRecipe(request, response) {
  if (!validId(request.params.id)) return response.status(400).json({ error: "Product family ID is invalid." });
  const { value, error } = validateRecipe(request.body);
  if (error) return response.status(400).json({ error });
  try {
    const recipe = await inTransaction(async (session) => {
      const family = await BakeryProductFamily.findById(request.params.id).session(session);
      if (!family || !family.active) throw conflict("The selected product family is missing or inactive.");
      const ingredients = [];
      for (const item of value.ingredients) {
        const material = await RawMaterial.findOne({ _id: item.materialId, active: true }).session(session);
        if (!material) throw conflict("A selected raw material is missing or inactive.");
        ingredients.push({
          materialId: material._id,
          materialName: material.name,
          unit: material.unit,
          quantityPerBatch: item.quantityPerBatch,
        });
      }
      const latest = family.activeRecipeId
        ? await BakeryRecipe.findById(family.activeRecipeId).session(session)
        : null;
      const [created] = await BakeryRecipe.create([{
        familyId: family._id,
        version: (latest?.version ?? 0) + 1,
        batchYield: value.batchYield,
        yieldUnit: value.yieldUnit,
        ingredients,
        createdBy: request.authUser._id,
      }], { session });
      family.activeRecipeId = created._id;
      family.updatedBy = request.authUser._id;
      await family.save({ session });
      await audit.recordAudit({
        request,
        eventType: "production.bakery_recipe_updated",
        outcome: "success",
        resource: { type: "production_product", id: String(family._id) },
        details: { familyId: String(family._id), recipeId: String(created._id), recipeVersion: created.version, ingredientCount: ingredients.length },
        transaction: session,
      });
      return created;
    });
    return response.status(201).json({ recipe: serialize(recipe) });
  } catch (error) {
    return respondError(error, response);
  }
}

async function createBatch(request, response) {
  const { value, error } = validateBatch(request.body);
  if (error) return response.status(400).json({ error });
  try {
    const result = await inTransaction(async (session) => {
      const existing = await BakeryProductionBatch.findOne({ idempotencyKey: value.idempotencyKey }).session(session);
      if (existing) {
        const same = String(existing.familyId) === value.familyId
          && existing.productionDate === value.productionDate
          && existing.location === value.location
          && existing.batchMultiplier === value.batchMultiplier
          && (existing.notes || "") === value.notes;
        if (!same) throw conflict("This batch request key was already used with different details.");
        return { batch: serialize(existing), replayed: true };
      }
      const family = await BakeryProductFamily.findOne({ _id: value.familyId, active: true }).session(session);
      if (!family || !family.activeRecipeId) throw conflict("Select an active product family with a saved recipe.");
      const recipe = await BakeryRecipe.findById(family.activeRecipeId).session(session);
      if (!recipe || String(recipe.familyId) !== String(family._id)) throw conflict("The active family recipe is missing or invalid.");
      const reference = `BATCH-${value.productionDate.replace(/-/g, "")}-${randomUUID().slice(0, 8).toUpperCase()}`;
      const [batch] = await BakeryProductionBatch.create([{
        reference,
        familyId: family._id,
        familyName: family.name,
        recipeId: recipe._id,
        recipeVersion: recipe.version,
        batchYield: recipe.batchYield,
        yieldUnit: recipe.yieldUnit,
        shelfLifeDays: family.shelfLifeDays,
        batchMultiplier: value.batchMultiplier,
        notes: value.notes,
        productionDate: value.productionDate,
        location: value.location,
        dateLabelType: family.dateLabelType,
        ingredients: recipe.ingredients.map((ingredient) => ({
          materialId: ingredient.materialId,
          materialName: ingredient.materialName,
          unit: ingredient.unit,
          expectedQuantity: ingredient.quantityPerBatch * value.batchMultiplier,
          actualQuantity: 0,
        })),
        idempotencyKey: value.idempotencyKey,
        actor: request.authUser._id,
      }], { session });
      await audit.recordAudit({
        request,
        eventType: "production.bakery_batch_created",
        outcome: "success",
        resource: { type: "production", id: String(batch._id), reference },
        details: { batchId: String(batch._id), reference, familyId: String(family._id), recipeVersion: recipe.version },
        transaction: session,
      });
      return { batch: serialize(batch), replayed: false };
    });
    return response.status(result.replayed ? 200 : 201).json(result);
  } catch (error) {
    return respondError(error, response);
  }
}

async function completeBatch(request, response) {
  if (!validId(request.params.id)) return response.status(400).json({ error: "Production batch ID is invalid." });
  const { value, error } = validateCompletion(request.body);
  if (error) return response.status(400).json({ error });
  const requestHash = createHash("sha256").update(JSON.stringify(value)).digest("hex");
  try {
    const result = await inTransaction(async (session) => {
      const batch = await BakeryProductionBatch.findById(request.params.id).session(session);
      if (!batch) throw Object.assign(new Error("Production batch not found."), { statusCode: 404 });
      if (batch.status === "completed") {
        if (batch.completionIdempotencyKey === value.idempotencyKey && batch.completionRequestHash === requestHash) {
          return { batch: serialize(batch), replayed: true };
        }
        throw conflict("This production batch has already been completed.");
      }
      if (batch.status !== "in_progress") throw conflict("Only an in-progress batch can be completed.");

      const family = await BakeryProductFamily.findById(batch.familyId).session(session);
      if (!family) throw conflict("The product family for this batch is no longer available.");
      const recipe = await BakeryRecipe.findById(batch.recipeId).session(session);
      if (!recipe || String(recipe.familyId) !== String(batch.familyId) || recipe.version !== batch.recipeVersion) {
        throw conflict("The batch's saved recipe version is missing; completion is blocked.");
      }
      const expectedIds = new Set(batch.ingredients.map((line) => String(line.materialId)));
      const actualById = new Map(value.actualIngredients.map((line) => [line.materialId, line.actualQuantity]));
      if (actualById.size !== expectedIds.size || [...expectedIds].some((id) => !actualById.has(id))) {
        throw Object.assign(new Error("Record an actual quantity for every ingredient in the batch recipe."), { statusCode: 400 });
      }
      for (const line of batch.ingredients) {
        const material = await RawMaterial.findOne({ _id: line.materialId, active: true }).session(session);
        if (!material || material.unit !== line.unit) {
          throw conflict(`The ingredient ${line.materialName} is missing, inactive, or has changed base units.`);
        }
        const actualQuantity = actualById.get(String(line.materialId));
        if (actualQuantity > 0) {
          const balance = await RawMaterialBalance.findOne({
            materialId: line.materialId,
            location: batch.location,
          }).session(session).lean();
          if (!balance) throw conflict(`${line.materialName} has no stock balance at ${batch.location}.`);
          const movementLocations = [
            { fromLocation: batch.location },
            { toLocation: batch.location },
          ];
          if (batch.location === "Main Warehouse") {
            movementLocations.push({
              fromLocation: { $exists: false },
              toLocation: { $exists: false },
            });
          }
          const latestMovement = await RawMaterialMovement.findOne({
            materialId: line.materialId,
            $or: movementLocations,
          }).sort({ date: -1, createdAt: -1 }).session(session).lean();
          if (latestMovement && latestMovement.date > batch.productionDate) {
            throw conflict(`Batch date is earlier than the latest stock movement for ${line.materialName} at ${batch.location}.`);
          }
          const movement = await recordRawMaterialMovement({
            materialId: line.materialId,
            type: "Production use",
            direction: "out",
            quantity: actualQuantity,
            date: batch.productionDate,
            reference: batch.reference,
            sourceType: "production-usage",
            sourceId: batch._id,
            idempotencyKey: `${String(batch._id)}:${String(line.materialId)}`,
            reason: `Actual use for ${batch.familyName}, recipe v${batch.recipeVersion}`,
            fromLocation: batch.location,
            bestBeforeReviewReason: value.bestBeforeReviewReason,
            materialName: material.name,
            unit: material.unit,
            actor: request.authUser._id,
          }, session);
          line.lotAllocations = movement.lotAllocations || [];
        } else {
          line.lotAllocations = [];
        }
        line.actualQuantity = actualQuantity;
      }

      const outputVariants = [];
      for (const output of value.outputs) {
        const variant = await BakeryProductVariant.findOne({
          _id: output.variantId,
          familyId: batch.familyId,
          active: true,
        }).session(session);
        if (!variant) throw Object.assign(new Error("Each output must be an active sellable variant of the batch product family."), { statusCode: 400 });
        const outputSnapshot = {
          variantId: variant._id,
          sku: variant.sku,
          productName: variant.name,
          saleUnit: variant.saleUnit,
          unitsPerSaleUnit: variant.unitsPerSaleUnit,
          quantity: output.quantity,
          packagingMaterials: (variant.packagingMaterials || []).map((item) => ({
            materialId: item.materialId,
            materialName: item.materialName,
            unit: item.unit,
            quantityPerSaleUnit: item.quantityPerSaleUnit,
            actualQuantity: 0,
            lotAllocations: [],
          })),
        };
        const expiryDate = value.expiryDate || addShelfLifeDays(batch.productionDate, batch.shelfLifeDays);
        if (expiryDate < batch.productionDate) throw Object.assign(new Error("Expiry date cannot be before the production date."), { statusCode: 400 });
        outputVariants.push({ variant, outputSnapshot, expiryDate });
      }
      const calculatedExpiry = addShelfLifeDays(batch.productionDate, batch.shelfLifeDays);
      if (value.expiryDate && value.expiryDate !== calculatedExpiry && !value.dateOverrideReason) {
        throw Object.assign(new Error("Provide a reason when overriding the calculated expiry date."), { statusCode: 400 });
      }

      const outputs = outputVariants.map(({ outputSnapshot }) => outputSnapshot);
      const actualYield = outputs.reduce(
        (total, output) => total + output.quantity * output.unitsPerSaleUnit,
        value.wasteQuantity,
      );
      const expectedYield = batch.batchYield * batch.batchMultiplier;
      const preorderAllocations = [];
      for (const { variant, outputSnapshot, expiryDate } of outputVariants) {
        for (const packaging of outputSnapshot.packagingMaterials) {
          const material = await RawMaterial.findOne({ _id: packaging.materialId, active: true }).session(session);
          if (!material || material.unit !== packaging.unit || material.category !== "Packaging") {
            throw conflict(`Packaging material ${packaging.materialName} is missing, inactive, or has changed units/category.`);
          }
          const actualQuantity = packaging.quantityPerSaleUnit * outputSnapshot.quantity;
          if (!Number.isFinite(actualQuantity) || actualQuantity <= 0) {
            throw Object.assign(new Error(`Packaging quantity for ${variant.name} is invalid.`), { statusCode: 409 });
          }
          const movement = await recordRawMaterialMovement({
            materialId: material._id,
            type: "Production use",
            direction: "out",
            quantity: actualQuantity,
            date: batch.productionDate,
            reference: batch.reference,
            sourceType: "production-usage",
            sourceId: batch._id,
            idempotencyKey: `${String(batch._id)}:pack:${String(variant._id)}:${String(material._id)}`,
            reason: `Packaging for ${outputSnapshot.quantity} ${variant.saleUnit} of ${variant.name}`,
            fromLocation: batch.location,
            bestBeforeReviewReason: value.bestBeforeReviewReason,
            materialName: material.name,
            unit: material.unit,
            actor: request.authUser._id,
          }, session);
          packaging.actualQuantity = actualQuantity;
          packaging.lotAllocations = movement.lotAllocations || [];
        }
        const lotReference = `${batch.reference}-${variant.sku}`;
        const [lot] = await FinishedStockLot.create([{
          reference: lotReference,
          batchId: batch._id,
          familyId: family._id,
          variantId: variant._id,
          sku: variant.sku,
          productName: variant.name,
          saleUnit: variant.saleUnit,
          unitsPerSaleUnit: variant.unitsPerSaleUnit,
          location: batch.location,
          productionDate: batch.productionDate,
          expiryDate,
          dateLabelType: batch.dateLabelType,
          producedQuantity: outputSnapshot.quantity,
          remainingQuantity: outputSnapshot.quantity,
          responsibleUserId: variant.responsibleUserId,
          createdBy: request.authUser._id,
        }], { session });
        await FinishedStockLotMovement.create([{
          lotId: lot._id,
          type: "Production output",
          direction: "in",
          quantity: outputSnapshot.quantity,
          date: batch.productionDate,
          reference: lotReference,
          sourceType: "production-batch",
          sourceId: batch._id,
          idempotencyKey: `${String(batch._id)}:${String(variant._id)}:output`,
          reason: `Finished output for ${batch.reference}`,
          actor: request.authUser._id,
        }], { session });
        const allocations = await allocatePreorderOutput({
          lot,
          actorId: request.authUser._id,
          request,
          session,
        });
        if (allocations.length) {
          preorderAllocations.push({
            variantId: String(variant._id),
            allocations,
          });
        }
      }
      batch.ingredients = batch.ingredients.map((line) => ({
        ...line.toObject(),
        actualQuantity: actualById.get(String(line.materialId)),
      }));
      batch.outputs = outputs;
      batch.wasteQuantity = value.wasteQuantity;
      batch.wasteUnit = recipe.yieldUnit;
      batch.wasteReason = value.wasteReason;
      batch.actualYield = actualYield;
      batch.yieldVariance = actualYield - expectedYield;
      batch.expiryDate = value.expiryDate || calculatedExpiry;
      batch.dateOverrideReason = value.dateOverrideReason;
      batch.status = "completed";
      batch.completionIdempotencyKey = value.idempotencyKey;
      batch.completionRequestHash = requestHash;
      batch.completedBy = request.authUser._id;
      batch.completedAt = new Date();
      await batch.save({ session });
      await audit.recordAudit({
        request,
        eventType: "production.bakery_batch_completed",
        outcome: "success",
        resource: { type: "production", id: String(batch._id), reference: batch.reference },
        details: {
          batchId: String(batch._id),
          reference: batch.reference,
          familyId: String(family._id),
          recipeVersion: batch.recipeVersion,
          ingredientCount: batch.ingredients.length,
          outputCount: outputs.length,
          wasteQuantity: batch.wasteQuantity,
          actualYield,
          yieldVariance: batch.yieldVariance,
          expiryDate: batch.expiryDate,
        },
        transaction: session,
      });
      return { batch: serialize(batch), preorderAllocations, replayed: false };
    });
    return response.status(200).json(result);
  } catch (error) {
    return respondError(error, response);
  }
}

async function writeOffLot(request, response) {
  if (!validId(request.params.id)) return response.status(400).json({ error: "Finished-stock lot ID is invalid." });
  const lotId = String(new mongoose.Types.ObjectId(request.params.id));
  const fields = ["quantity", "date", "reason", "idempotencyKey"];
  const validation = validateObject(request.body, fields);
  if (validation.error) return response.status(400).json({ error: validation.error });
  const { quantity, date, reason, idempotencyKey } = request.body;
  if (!Number.isSafeInteger(quantity) || quantity < 1 || !validDate(date) || date > today()
    || typeof reason !== "string" || !reason.trim() || reason.length > 300
    || typeof idempotencyKey !== "string" || !idempotencyKey.trim() || idempotencyKey.length > 120) {
    return response.status(400).json({ error: "Provide a positive whole quantity, valid date, reason, and idempotency key." });
  }
  try {
    const result = await inTransaction(async (session) => {
      const existing = await FinishedStockLotMovement.findOne({ idempotencyKey: idempotencyKey.trim() }).session(session);
      if (existing) {
        const same = String(existing.lotId) === lotId
          && existing.type === "Write-off"
          && existing.quantity === quantity
          && existing.date === date
          && existing.reason === reason.trim();
        if (!same) throw conflict("This write-off request key was already used with different details.");
        const lot = await FinishedStockLot.findById(existing.lotId).session(session);
        return { lot: serialize(lot), movement: serialize(existing), replayed: true };
      }
      const lot = await FinishedStockLot.findById(lotId).session(session);
      if (!lot || lot.status !== "active") throw conflict("Only active finished-stock lots can be written off.");
      const available = lot.remainingQuantity - lot.reservedQuantity;
      if (quantity > available) throw conflict("Write-off quantity exceeds unreserved finished stock.");
      const latestMovement = await FinishedStockLotMovement.findOne({ lotId: lot._id })
        .sort({ date: -1, createdAt: -1 }).session(session).lean();
      if (latestMovement && latestMovement.date > date) {
        throw conflict("Write-off date is earlier than the lot's latest stock movement.");
      }
      lot.remainingQuantity -= quantity;
      if (lot.remainingQuantity === 0) lot.status = "written_off";
      await lot.save({ session });
      const [movement] = await FinishedStockLotMovement.create([{
        lotId: lot._id,
        type: "Write-off",
        direction: "out",
        quantity,
        date,
        reference: lot.reference,
        sourceType: "write-off",
        sourceId: lot._id,
        idempotencyKey: idempotencyKey.trim(),
        reason: reason.trim(),
        actor: request.authUser._id,
      }], { session });
      if (lot.status !== "active") await resolveFinishedStockExpiryAlerts(lot._id, new Date(), session);
      await audit.recordAudit({
        request,
        eventType: "production.bakery_lot_written_off",
        outcome: "success",
        resource: { type: "production", id: String(lot._id), reference: lot.reference },
        details: { lotId: String(lot._id), reference: lot.reference, quantity, remainingQuantity: lot.remainingQuantity, reason: reason.trim() },
        transaction: session,
      });
      return { lot: serialize(lot), movement: serialize(movement), replayed: false };
    });
    return response.status(200).json(result);
  } catch (error) {
    return respondError(error, response);
  }
}

async function listBatches(request, response) {
  const query = {};
  if (request.query.status && !["in_progress", "completed", "cancelled"].includes(request.query.status)) {
    return response.status(400).json({ error: "status must be in_progress, completed, or cancelled." });
  }
  if (request.query.status) {
    query.status = request.query.status;
  }
  if (request.query.from && !validDate(request.query.from)) return response.status(400).json({ error: "from must be a valid YYYY-MM-DD date." });
  if (request.query.to && !validDate(request.query.to)) return response.status(400).json({ error: "to must be a valid YYYY-MM-DD date." });
  if (request.query.from && request.query.to && request.query.from > request.query.to) {
    return response.status(400).json({ error: "from must not be after to." });
  }
  if (request.query.from) query.productionDate = { $gte: request.query.from };
  if (request.query.to) {
    query.productionDate = { ...(query.productionDate || {}), $lte: request.query.to };
  }
  const limit = Math.max(1, Math.min(200, Number.parseInt(request.query.limit, 10) || 100));
  const batches = await BakeryProductionBatch.find(query).sort({ productionDate: -1, createdAt: -1 }).limit(limit).lean();
  return response.json({ batches: batches.map(serialize) });
}

async function listLots(request, response) {
  const query = {};
  if (request.query.status && !["active", "depleted", "written_off"].includes(request.query.status)) {
    return response.status(400).json({ error: "status must be active, depleted, or written_off." });
  }
  if (request.query.status) {
    query.status = request.query.status;
  }
  if (request.query.expiring === "true") {
    query.status = "active";
    query.remainingQuantity = { $gt: 0 };
    query.expiryDate = { $lte: addShelfLifeDays(today(), 2) };
  }
  if (request.query.variantId && !validId(request.query.variantId)) return response.status(400).json({ error: "variantId must be a valid identifier." });
  if (request.query.variantId) query.variantId = request.query.variantId;
  const limit = Math.max(1, Math.min(200, Number.parseInt(request.query.limit, 10) || 100));
  const lots = await FinishedStockLot.find(query).sort({ expiryDate: 1, createdAt: 1 }).limit(limit).lean();
  return response.json({ lots: lots.map(serialize) });
}

module.exports = {
  addShelfLifeDays,
  completeBatch,
  createBatch,
  createFamily,
  deleteUnattachedFamilyImage,
  listBatches,
  listFamilies,
  listLots,
  writeOffLot,
  saveRecipe,
  updateFamily,
  retryFamilyImageCleanup,
  addVariant,
  validateBatch,
  validateCompletion,
  validateFamily,
  validateRecipe,
  validateStorefront,
  validateVariants,
  isBakeryProductImagePublicId,
};
