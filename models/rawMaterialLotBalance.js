const mongoose = require("mongoose");

const rawMaterialLotBalanceSchema = new mongoose.Schema(
  {
    lotId: { type: mongoose.Schema.Types.ObjectId, ref: "RawMaterialLot", required: true },
    materialId: { type: mongoose.Schema.Types.ObjectId, ref: "RawMaterial", required: true },
    location: { type: String, required: true, trim: true, maxlength: 100 },
    quantity: { type: Number, required: true, min: 0, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

rawMaterialLotBalanceSchema.index({ lotId: 1, location: 1 }, { unique: true });
rawMaterialLotBalanceSchema.index({ materialId: 1, location: 1, quantity: 1 });

module.exports = mongoose.models.RawMaterialLotBalance ||
  mongoose.model("RawMaterialLotBalance", rawMaterialLotBalanceSchema);
