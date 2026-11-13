const mongoose = require("mongoose");

const finishedStockLotSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, trim: true, maxlength: 100 },
    batchId: { type: mongoose.Schema.Types.ObjectId, ref: "BakeryProductionBatch", default: null, index: true },
    sourceType: { type: String, enum: ["production", "legacy_migration"], default: "production", required: true },
    sourceReference: { type: String, trim: true, maxlength: 120 },
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: "BakeryProductFamily", required: true, index: true },
    variantId: { type: mongoose.Schema.Types.ObjectId, ref: "BakeryProductVariant", required: true, index: true },
    sku: { type: String, required: true, trim: true, maxlength: 40 },
    productName: { type: String, required: true, trim: true, maxlength: 160 },
    saleUnit: { type: String, required: true, trim: true, maxlength: 40 },
    unitsPerSaleUnit: { type: Number, required: true, min: 1, validate: Number.isInteger },
    location: { type: String, required: true, trim: true, maxlength: 100 },
    productionDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    expiryDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    dateLabelType: { type: String, enum: ["best_before", "use_by"], required: true },
    producedQuantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
    remainingQuantity: { type: Number, required: true, min: 0, validate: Number.isInteger },
    reservedQuantity: { type: Number, required: true, min: 0, validate: Number.isInteger, default: 0 },
    responsibleUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    status: { type: String, enum: ["active", "depleted", "written_off"], default: "active", required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_document, value) {
        value.id = String(value._id);
        delete value._id;
        delete value.__v;
        return value;
      },
    },
  },
);

finishedStockLotSchema.index(
  { batchId: 1, variantId: 1 },
  { unique: true, partialFilterExpression: { batchId: { $type: "objectId" } } },
);
finishedStockLotSchema.index({ status: 1, expiryDate: 1, remainingQuantity: 1 });
finishedStockLotSchema.index({ variantId: 1, expiryDate: 1, createdAt: 1 });

module.exports = mongoose.models.FinishedStockLot ||
  mongoose.model("FinishedStockLot", finishedStockLotSchema);
