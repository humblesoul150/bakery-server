const mongoose = require("mongoose");
const BakeryProductFamily = require("../models/bakeryProductFamily");
const BakeryProductVariant = require("../models/bakeryProductVariant");
const BakeryStockAlert = require("../models/bakeryStockAlert");
const FinishedStockLot = require("../models/finishedStockLot");
const { enqueueNotificationEvent } = require("./notificationEvents");

const RECIPIENT_ROLES = [
  "Sales Manager",
  "Inventory Manager",
  "Production Manager",
  "General Manager",
  "Super Admin",
];

function companyDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Kampala",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

function stockStateFor(currentQuantity, lowStockThreshold) {
  if (currentQuantity === 0) return "out_of_stock";
  if (currentQuantity <= lowStockThreshold) return "low_stock";
  return "stocked";
}

function attachSession(query, session) {
  return session ? query.session(session) : query;
}

async function evaluateVariantStock(variantId, now = new Date(), session) {
  const variant = await attachSession(
    BakeryProductVariant.findById(variantId).lean(),
    session,
  );
  const family = variant
    ? await attachSession(
      BakeryProductFamily.findOne({ _id: variant.familyId, active: true })
        .select("_id")
        .lean(),
      session,
    )
    : null;
  const active = Boolean(variant?.active && family);
  const lowStockThreshold = Number.isSafeInteger(variant?.lowStockThreshold)
    ? variant.lowStockThreshold
    : 10;

  let currentQuantity = 0;
  if (active) {
    const aggregate = FinishedStockLot.aggregate([
      {
        $match: {
          variantId: variant._id,
          status: "active",
          expiryDate: { $gte: companyDate(now) },
        },
      },
      {
        $project: {
          available: {
            $max: [
              0,
              { $subtract: ["$remainingQuantity", "$reservedQuantity"] },
            ],
          },
        },
      },
      { $group: { _id: null, currentQuantity: { $sum: "$available" } } },
    ]);
    const [quantity] = await attachSession(aggregate, session).exec();
    currentQuantity = quantity?.currentQuantity ?? 0;
  }

  return {
    variant,
    active,
    currentQuantity,
    lowStockThreshold,
    state: active
      ? stockStateFor(currentQuantity, lowStockThreshold)
      : "inactive",
  };
}

function notificationFor(alert, previousState, now, actorId) {
  const transition = `${previousState || "uninitialized"}-${alert.state}`;
  const eventKey = `bakery-stock:${alert.variantId}:${transition}:${now.getTime()}`;
  const descriptions = {
    low_stock: {
      type: "inventory.bakery_stock_low",
      title: "Bakery product stock is low",
      severity: "action_required",
      message: `${alert.productName} (${alert.sku}) has ${alert.currentQuantity} ${alert.saleUnit} available; low-stock threshold is ${alert.lowStockThreshold}.`,
    },
    out_of_stock: {
      type: "inventory.bakery_stock_out",
      title: "Bakery product is out of stock",
      severity: "urgent",
      message: `${alert.productName} (${alert.sku}) has no sellable stock. Its low-stock threshold is ${alert.lowStockThreshold} ${alert.saleUnit}.`,
    },
    stocked: {
      type: "inventory.bakery_stock_recovered",
      title: "Bakery product stock recovered",
      severity: "info",
      message: `${alert.productName} (${alert.sku}) now has ${alert.currentQuantity} ${alert.saleUnit}, above its low-stock threshold of ${alert.lowStockThreshold}.`,
    },
  };
  const description = descriptions[alert.state];
  return {
    eventKey,
    type: description.type,
    category: "inventory",
    severity: description.severity,
    title: description.title,
    message: description.message,
    resource: {
      type: "bakery_product_variant",
      id: String(alert.variantId),
      reference: alert.sku,
    },
    actorId: actorId || null,
    recipientRoles: RECIPIENT_ROLES,
    occurredAt: now,
  };
}

async function refreshVariantStockAlertInSession(variantId, actorId, now, session) {
  const stock = await evaluateVariantStock(variantId, now, session);
  if (!stock.variant) {
    const existing = await BakeryStockAlert.findOne({ variantId }).session(session);
    if (!existing) return null;
    existing.state = "inactive";
    existing.status = "resolved";
    existing.currentQuantity = 0;
    existing.resolvedAt = existing.resolvedAt || now;
    await existing.save({ session });
    return existing;
  }

  let alert = await BakeryStockAlert.findOne({ variantId }).session(session);
  const previousState = alert?.state;
  const changed = Boolean(alert && previousState !== stock.state);
  if (!alert) {
    [alert] = await BakeryStockAlert.create([{
      variantId: stock.variant._id,
      familyId: stock.variant.familyId,
      sku: stock.variant.sku,
      productName: stock.variant.name,
      saleUnit: stock.variant.saleUnit,
      lowStockThreshold: stock.lowStockThreshold,
      currentQuantity: stock.currentQuantity,
      state: stock.state,
      status: stock.state === "stocked" || stock.state === "inactive" ? "resolved" : "active",
      lastTriggeredAt: stock.state === "stocked" || stock.state === "inactive" ? null : now,
      resolvedAt: stock.state === "stocked" || stock.state === "inactive" ? now : null,
    }], { session });
  } else {
    alert.familyId = stock.variant.familyId;
    alert.sku = stock.variant.sku;
    alert.productName = stock.variant.name;
    alert.saleUnit = stock.variant.saleUnit;
    alert.lowStockThreshold = stock.lowStockThreshold;
    alert.currentQuantity = stock.currentQuantity;
    alert.state = stock.state;
    alert.status = stock.state === "stocked" || stock.state === "inactive" ? "resolved" : "active";
    if (stock.state === "stocked" || stock.state === "inactive") {
      if (previousState !== stock.state) alert.resolvedAt = now;
    } else {
      alert.lastTriggeredAt = changed ? now : alert.lastTriggeredAt;
      alert.resolvedAt = null;
    }
    await alert.save({ session });
  }

  const shouldNotify = stock.active && (
    changed && stock.state !== "inactive" ||
    !previousState && stock.state !== "stocked"
  );
  if (shouldNotify) {
    await enqueueNotificationEvent(
      notificationFor(alert, previousState, now, actorId),
      session,
    );
  }
  return alert;
}

async function refreshBakeryStockAlert(variantId, actorId = null, options = {}) {
  const now = options.now || new Date();
  if (options.session) {
    return refreshVariantStockAlertInSession(
      variantId,
      actorId,
      now,
      options.session,
    );
  }

  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await refreshVariantStockAlertInSession(
        variantId,
        actorId,
        now,
        session,
      );
    });
    return result;
  } finally {
    await session.endSession();
  }
}

async function generateBakeryStockAlerts(now = new Date()) {
  const activeFamilies = await BakeryProductFamily.find({ active: true })
    .select("_id")
    .lean();
  const activeVariants = activeFamilies.length
    ? await BakeryProductVariant.find({
      familyId: { $in: activeFamilies.map((family) => family._id) },
      active: true,
    }).select("_id").lean()
    : [];
  const activeVariantIds = activeVariants.map((variant) => String(variant._id));
  for (const variant of activeVariants) {
    await refreshBakeryStockAlert(variant._id, null, { now });
  }

  const activeAlerts = await BakeryStockAlert.find({ status: "active" })
    .select("variantId")
    .lean();
  const inactiveVariantIds = [...new Set(
    activeAlerts
      .map((alert) => String(alert.variantId))
      .filter((variantId) => !activeVariantIds.includes(variantId)),
  )];
  for (const variantId of inactiveVariantIds) {
    await refreshBakeryStockAlert(variantId, null, { now });
  }
  return {
    evaluated: activeVariants.length,
    resolved: inactiveVariantIds.length,
  };
}

module.exports = {
  RECIPIENT_ROLES,
  companyDate,
  evaluateVariantStock,
  generateBakeryStockAlerts,
  notificationFor,
  refreshBakeryStockAlert,
  stockStateFor,
};
