const mongoose = require("mongoose");

const rawMaterialLotSchema = new mongoose.Schema(
  {
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: "RawMaterial", required: true, index: true },
    internalLotCode: { type: String, required: true, trim: true, maxlength: 80 },
    supplierLotReference: { type: String, trim: true, maxlength: 120, default: "" },
    supplier: { type: String, trim: true, maxlength: 160, default: "" },
    source: { type: String, enum: ["receipt", "opening", "adjustment"], required: true },
    receiptDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    expiryDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/ },
    dateLabelType: { type: String, enum: ["use_by", "best_before"] },
    receivedQuantity: { type: Number, required: true, min: 0.000001 },
    unitCost: { type: Number, min: 0 },
    status: { type: String, enum: ["available", "quarantined", "depleted"], default: "available", index: true },
    notes: { type: String, trim: true, maxlength: 500, default: "" },
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

rawMaterialLotSchema.index({ internalLotCode: 1 }, { unique: true });
rawMaterialLotSchema.index({ materialId: 1, status: 1, expiryDate: 1, receiptDate: 1 });
rawMaterialLotSchema.index({ materialId: 1, supplierLotReference: 1, receiptDate: 1 });

module.exports = mongoose.models.RawMaterialLot ||
  mongoose.model("RawMaterialLot", rawMaterialLotSchema);
