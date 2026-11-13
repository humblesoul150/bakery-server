const mongoose = require("mongoose");

const ingredientLotAllocationSchema = new mongoose.Schema(
  {
    lotId: { type: mongoose.Schema.Types.ObjectId, ref: "RawMaterialLot", required: true },
    internalLotCode: { type: String, required: true, trim: true, maxlength: 80 },
    supplierLotReference: { type: String, trim: true, maxlength: 120, default: "" },
    expiryDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    dateLabelType: { type: String, enum: ["use_by", "best_before"] },
    quantity: { type: Number, required: true, min: 0.000001 },
    bestBeforeReviewReason: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { _id: false },
);

const ingredientSnapshotSchema = new mongoose.Schema(
  {
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: "RawMaterial", required: true },
    materialName: { type: String, required: true, trim: true, maxlength: 160 },
    unit: { type: String, required: true, trim: true, maxlength: 24 },
    expectedQuantity: { type: Number, required: true, min: 0 },
    actualQuantity: { type: Number, required: true, min: 0 },
    lotAllocations: { type: [ingredientLotAllocationSchema], default: [] },
  },
  { _id: false },
);

const outputSchema = new mongoose.Schema(
  {
    variantId: { type: mongoose.Schema.Types.ObjectId, ref: "BakeryProductVariant", required: true },
    sku: { type: String, required: true, trim: true, maxlength: 40 },
    productName: { type: String, required: true, trim: true, maxlength: 160 },
    saleUnit: { type: String, required: true, trim: true, maxlength: 40 },
    unitsPerSaleUnit: { type: Number, required: true, min: 1, validate: Number.isInteger },
    quantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
    packagingMaterials: {
      type: [{
        materialId: { type: mongoose.Schema.Types.ObjectId, ref: "RawMaterial", required: true },
        materialName: { type: String, required: true, trim: true, maxlength: 160 },
        unit: { type: String, required: true, trim: true, maxlength: 24 },
        quantityPerSaleUnit: { type: Number, required: true, min: 0.000001 },
        actualQuantity: { type: Number, required: true, min: 0 },
        lotAllocations: { type: [ingredientLotAllocationSchema], default: [] },
      }],
      default: [],
    },
  },
  { _id: false },
);

const bakeryProductionBatchSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: "BakeryProductFamily", required: true, index: true },
    familyName: { type: String, required: true, trim: true, maxlength: 160 },
    recipeId: { type: mongoose.Schema.Types.ObjectId, ref: "BakeryRecipe", required: true },
    recipeVersion: { type: Number, required: true, min: 1, validate: Number.isInteger },
    batchYield: { type: Number, required: true, min: 0.000001 },
    yieldUnit: { type: String, required: true, trim: true, maxlength: 40 },
    shelfLifeDays: { type: Number, required: true, min: 0.25, max: 365 },
    batchMultiplier: { type: Number, required: true, min: 0.000001 },
    notes: { type: String, trim: true, maxlength: 500, default: "" },
    productionDate: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    location: { type: String, required: true, trim: true, maxlength: 100 },
    status: { type: String, enum: ["in_progress", "completed", "cancelled"], default: "in_progress", required: true },
    ingredients: { type: [ingredientSnapshotSchema], default: [] },
    outputs: { type: [outputSchema], default: [] },
    wasteQuantity: { type: Number, min: 0, default: 0 },
    wasteUnit: { type: String, trim: true, maxlength: 40, default: "" },
    wasteReason: { type: String, trim: true, maxlength: 500, default: "" },
    actualYield: { type: Number, min: 0 },
    yieldVariance: { type: Number },
    expiryDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    dateLabelType: { type: String, enum: ["best_before", "use_by"], required: true },
    dateOverrideReason: { type: String, trim: true, maxlength: 500, default: "" },
    idempotencyKey: { type: String, trim: true, maxlength: 120 },
    completionIdempotencyKey: { type: String, trim: true, maxlength: 120 },
    completionRequestHash: { type: String, trim: true, maxlength: 64 },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    completedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    completedAt: { type: Date },
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

bakeryProductionBatchSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });
bakeryProductionBatchSchema.index({ completionIdempotencyKey: 1 }, { unique: true, sparse: true });
bakeryProductionBatchSchema.index({ productionDate: -1, createdAt: -1 });
bakeryProductionBatchSchema.index({ familyId: 1, productionDate: -1 });

module.exports = mongoose.models.BakeryProductionBatch ||
  mongoose.model("BakeryProductionBatch", bakeryProductionBatchSchema);
