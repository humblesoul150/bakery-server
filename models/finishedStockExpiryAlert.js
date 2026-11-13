const mongoose = require("mongoose");

const finishedStockExpiryAlertSchema = new mongoose.Schema(
  {
    lotId: { type: mongoose.Schema.Types.ObjectId, ref: "FinishedStockLot", required: true, index: true },
    stage: { type: String, enum: ["two_days", "one_day", "expiry_day", "expired"], required: true },
    status: { type: String, enum: ["active", "resolved"], default: "active", required: true },
    eventKey: { type: String, required: true, unique: true, trim: true, maxlength: 240 },
    triggeredAt: { type: Date, required: true, default: Date.now },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

finishedStockExpiryAlertSchema.index({ lotId: 1, stage: 1 }, { unique: true });
finishedStockExpiryAlertSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.models.FinishedStockExpiryAlert ||
  mongoose.model("FinishedStockExpiryAlert", finishedStockExpiryAlertSchema);
