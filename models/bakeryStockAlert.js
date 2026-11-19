const mongoose = require("mongoose");

const bakeryStockAlertSchema = new mongoose.Schema(
  {
    variantId: { type: mongoose.Schema.Types.ObjectId, ref: "BakeryProductVariant", required: true },
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: "BakeryProductFamily", required: true },
    sku: { type: String, required: true, trim: true, maxlength: 40 },
    productName: { type: String, required: true, trim: true, maxlength: 160 },
    saleUnit: { type: String, required: true, trim: true, maxlength: 40 },
    lowStockThreshold: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    currentQuantity: { type: Number, required: true, min: 0, validate: Number.isSafeInteger },
    state: {
      type: String,
      enum: ["stocked", "low_stock", "out_of_stock", "inactive"],
      required: true,
    },
    status: { type: String, enum: ["active", "resolved"], required: true },
    lastTriggeredAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

bakeryStockAlertSchema.index({ variantId: 1 }, { unique: true });
bakeryStockAlertSchema.index({ status: 1, state: 1, updatedAt: -1 });

module.exports = mongoose.models.BakeryStockAlert ||
  mongoose.model("BakeryStockAlert", bakeryStockAlertSchema);
