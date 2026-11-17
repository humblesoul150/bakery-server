const { validateFamily, validateVariants, validateRecipe } = require("../controllers/bakeryProductionController");
const { ConnectionString } = require("mongodb-connection-string-url");

function normalized(value) {
  return String(value || "").trim().toLocaleLowerCase("en");
}

function validateCatalog(catalog) {
  const errors = [];
  if (!catalog || catalog.version !== 1 || catalog.currency !== "UGX"
    || !Array.isArray(catalog.families) || !Array.isArray(catalog.materialDefinitions)) {
    return ["Catalog must have version 1, UGX currency, families, and material definitions."];
  }

  const codes = new Set();
  const materialCodes = new Set();
  const slugs = new Set();
  const skus = new Set();
  const categories = new Map();
  const flavourGroups = new Map();
  const materialByName = new Map();

  for (const material of catalog.materialDefinitions) {
    const nameKey = normalized(material.name);
    if (!nameKey || !material.code || !material.unit || material.category !== "Ingredients") {
      errors.push(`Material definition "${material.name || "unnamed"}" needs a code, unit, and Ingredients category.`);
      continue;
    }
    if (materialByName.has(nameKey)) errors.push(`Duplicate raw material definition: ${material.name}.`);
    const materialCode = String(material.code).toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(materialCode) || materialCodes.has(materialCode)) {
      errors.push(`Raw material code ${material.code} is invalid or duplicated.`);
    }
    materialCodes.add(materialCode);
    materialByName.set(nameKey, material);
  }

  for (const family of catalog.families) {
    categories.set(family.category, (categories.get(family.category) || 0) + 1);
    const flavourGroupKey = `${family.category}:${family.flavourGroup}`;
    const group = flavourGroups.get(flavourGroupKey) || new Set();
    group.add(normalized(family.flavour));
    flavourGroups.set(flavourGroupKey, group);
    if (codes.has(family.code)) errors.push(`Duplicate family code: ${family.code}.`);
    if (slugs.has(family.slug)) errors.push(`Duplicate storefront slug: ${family.slug}.`);
    codes.add(family.code);
    slugs.add(family.slug);
    const familyData = {
      code: family.code,
      name: family.name,
      category: family.category,
      flavour: family.flavour,
      baseUnit: family.baseUnit,
      shelfLifeDays: family.shelfLifeDays,
      dateLabelType: family.dateLabelType,
      storageInstructions: family.storageInstructions,
      active: family.active,
      storefront: family.storefront,
      variants: family.variants,
    };
    const familyValidation = validateFamily(familyData);
    if (familyValidation.error) errors.push(`${family.code}: ${familyValidation.error}`);
    const variantValidation = validateVariants(family.variants);
    if (variantValidation.error) errors.push(`${family.code}: ${variantValidation.error}`);
    if (!family.seedKey || !family.flavourGroup || family.active !== false || family.storefront?.published !== false
      || (family.storefront?.images || []).length !== 0 || !family.storefront?.description?.trim()
      || !family.storefront?.ingredientsStatement?.trim()) {
      errors.push(`${family.code}: seed identity, inactive/unpublished state, image-free profile, description, and ingredient statement are required.`);
    }

    const recipe = family.recipe;
    if (!recipe || !Number.isSafeInteger(recipe.batchYield) || recipe.batchYield < 1
      || recipe.yieldUnit !== family.baseUnit || !Array.isArray(recipe.ingredients)
      || !recipe.ingredients.length || !Array.isArray(recipe.sourceReferences)
      || !recipe.sourceReferences.length || typeof recipe.formulationNote !== "string"
      || !recipe.formulationNote.trim()) {
      errors.push(`${family.code}: recipe needs a positive whole yield in the family base unit, ingredients, source references, and a formulation note.`);
      continue;
    }
    const recipeValidation = validateRecipe({
      batchYield: recipe.batchYield,
      yieldUnit: recipe.yieldUnit,
      ingredients: recipe.ingredients.map((ingredient, index) => ({
        materialId: index.toString(16).padStart(24, "0"),
        quantityPerBatch: ingredient.quantityPerBatch,
      })),
    });
    if (recipeValidation.error) errors.push(`${family.code}: ${recipeValidation.error}`);
    if (recipe.sourceReferences.some((source) => {
      try {
        const parsed = new URL(source);
        return parsed.protocol !== "https:" || !parsed.hostname;
      } catch {
        return true;
      }
    })) {
      errors.push(`${family.code}: recipe source references must be HTTPS URLs.`);
    }
    const seenIngredients = new Set();
    for (const ingredient of recipe.ingredients) {
      const key = normalized(ingredient.materialName);
      if (!key || seenIngredients.has(key) || !Number.isFinite(ingredient.quantityPerBatch)
        || ingredient.quantityPerBatch <= 0 || !ingredient.unit) {
        errors.push(`${family.code}: recipe ingredients must be unique, named, unit-bearing, and positive.`);
        continue;
      }
      seenIngredients.add(key);
      const definition = materialByName.get(key);
      if (!definition || definition.unit !== ingredient.unit) {
        errors.push(`${family.code}: ingredient ${ingredient.materialName} has no matching ${ingredient.unit} catalog definition.`);
      }
    }
    for (const variant of family.variants || []) {
      if (skus.has(variant.sku)) errors.push(`Duplicate sellable SKU: ${variant.sku}.`);
      skus.add(variant.sku);
    }
  }

  for (const [category, count] of categories) {
    if (count < 3) errors.push(`${category} has ${count} profiles; at least three are required.`);
    if (catalog.productCountByCategory?.[category] !== count) {
      errors.push(`${category} profile count does not match the catalog summary.`);
    }
  }
  if (categories.size !== 17) errors.push(`Catalog must contain all 17 categories; found ${categories.size}.`);
  for (const category of categories.keys()) {
    const hasThreeFlavours = [...flavourGroups.entries()].some(([key, flavours]) =>
      key.startsWith(`${category}:`) && flavours.size >= 3);
    if (!hasThreeFlavours) errors.push(`${category} needs at least one product with three distinct flavour profiles.`);
  }
  for (const category of Object.keys(catalog.productCountByCategory || {})) {
    if (!categories.has(category)) errors.push(`${category} has no product profiles.`);
  }
  return errors;
}

function planMaterialResolution(definitions, ingredients, existingMaterials) {
  const errors = [];
  const missing = [];
  const byName = new Map();
  const byCode = new Map();
  for (const material of existingMaterials) {
    byName.set(normalized(material.name), material);
    byCode.set(String(material.code || "").toUpperCase(), material);
  }

  for (const definition of definitions) {
    const existing = byName.get(normalized(definition.name));
    const codeOwner = byCode.get(String(definition.code).toUpperCase());
    if (codeOwner && normalized(codeOwner.name) !== normalized(definition.name)) {
      errors.push(`Raw-material code ${definition.code} is already assigned to ${codeOwner.name}.`);
    }
    if (!existing) {
      missing.push(definition);
      continue;
    }
    if (!existing.active) {
      errors.push(`Raw material ${existing.name} exists but is inactive.`);
    } else if (existing.unit !== definition.unit || existing.category !== "Ingredients") {
      errors.push(`Raw material ${existing.name} must use unit ${definition.unit} and category Ingredients; found ${existing.unit} / ${existing.category}.`);
    }
  }

  const needed = new Set(ingredients.map((item) => normalized(item.materialName)));
  for (const name of needed) {
    if (!definitions.some((definition) => normalized(definition.name) === name)) {
      errors.push(`Recipe ingredient ${name} has no catalog material definition.`);
    }
  }
  return { errors, missing };
}

function isNonProductionTarget(databaseUrl, nodeEnv = process.env.NODE_ENV) {
  let parsed;
  try {
    parsed = new ConnectionString(databaseUrl);
  } catch {
    return { allowed: false, reason: "DB_URL must be a valid MongoDB URL." };
  }
  if (parsed.protocol !== "mongodb:" && parsed.protocol !== "mongodb+srv:") {
    return { allowed: false, reason: "DB_URL must use the mongodb or mongodb+srv protocol." };
  }
  let database;
  try {
    database = decodeURIComponent(parsed.pathname.replace(/^\/+/, "").split("/")[0] || "");
  } catch {
    return { allowed: false, reason: "DB_URL must contain a valid database name." };
  }
  const hosts = parsed.hosts.map((entry) => {
    if (entry.startsWith("[")) return entry.slice(1, entry.indexOf("]")).toLowerCase();
    return entry.replace(/:\d+$/, "").toLowerCase();
  });
  const localHost = hosts.length > 0
    && hosts.every((host) => ["localhost", "127.0.0.1", "::1"].includes(host));
  const nonProductionName = /(^|[-_.])(dev|development|test|testing|staging|sandbox)([-_.]|$)/i.test(database);
  if (!database) return { allowed: false, reason: "DB_URL must name a database." };
  if (nodeEnv === "production" || /(^|[-_.])prod(uction)?([-_.]|$)/i.test(database)) {
    return { allowed: false, reason: "Refusing to seed a production environment or production database." };
  }
  if (!localHost && !nonProductionName) {
    return { allowed: false, reason: "Remote database names must explicitly contain dev, test, staging, or sandbox." };
  }
  return { allowed: true, database };
}

module.exports = {
  isNonProductionTarget,
  planMaterialResolution,
  validateCatalog,
};
