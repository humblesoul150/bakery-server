const mongoose = require("mongoose");

const packagingMaterialSchema = new mongoose.Schema(
  {
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: "RawMaterial", required: true },
    materialName: { type: String, required: true, trim: true, maxlength: 160 },
    unit: { type: String, required: true, trim: true, maxlength: 24 },
    quantityPerSaleUnit: { type: Number, required: true, min: 0.000001 },
  },
  { _id: false },
);

const bakeryProductVariantSchema = new mongoose.Schema(
  {
    familyId: { type: mongoose.Schema.Types.ObjectId, ref: "BakeryProductFamily", required: true, index: true },
    legacyProductId: { type: mongoose.Schema.Types.ObjectId, ref: "FinishedProduct", default: undefined },
    sku: { type: String, required: true, trim: true, uppercase: true, maxlength: 40 },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    saleUnit: { type: String, required: true, trim: true, maxlength: 40 },
    unitsPerSaleUnit: { type: Number, required: true, min: 1, validate: Number.isInteger },
    price: { type: Number, required: true, min: 1, validate: Number.isInteger },
    packagingMaterials: { type: [packagingMaterialSchema], default: [] },
    active: { type: Boolean, default: true, index: true },
    responsibleUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
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

bakeryProductVariantSchema.index({ sku: 1 }, { unique: true });
bakeryProductVariantSchema.index({ legacyProductId: 1 }, { unique: true, sparse: true });
bakeryProductVariantSchema.index({ familyId: 1, active: 1, sku: 1 });

module.exports = mongoose.models.BakeryProductVariant ||
  mongoose.model("BakeryProductVariant", bakeryProductVariantSchema);
