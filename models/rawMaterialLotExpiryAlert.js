const mongoose = require("mongoose");

const rawMaterialLotExpiryAlertSchema = new mongoose.Schema(
  {
    lotId: { type: mongoose.Schema.Types.ObjectId, ref: "RawMaterialLot", required: true, index: true },
    stage: { type: String, enum: ["two_days", "one_day", "expiry_day", "expired"], required: true },
    status: { type: String, enum: ["active", "resolved"], default: "active", required: true },
    eventKey: { type: String, required: true, unique: true, trim: true, maxlength: 240 },
    triggeredAt: { type: Date, required: true, default: Date.now },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

rawMaterialLotExpiryAlertSchema.index({ lotId: 1, stage: 1 }, { unique: true });
rawMaterialLotExpiryAlertSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.models.RawMaterialLotExpiryAlert ||
  mongoose.model("RawMaterialLotExpiryAlert", rawMaterialLotExpiryAlertSchema);
