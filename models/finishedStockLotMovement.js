const mongoose = require("mongoose");

const finishedStockLotMovementSchema = new mongoose.Schema(
  {
    lotId: { type: mongoose.Schema.Types.ObjectId, ref: "FinishedStockLot", required: true, index: true },
    type: { type: String, enum: ["Opening balance", "Production output", "Sales dispatch", "Write-off", "Manual receipt", "Adjustment in", "Adjustment out"], required: true },
    direction: { type: String, enum: ["in", "out"], required: true },
    quantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },
    reference: { type: String, required: true, trim: true, maxlength: 100 },
    sourceType: { type: String, enum: ["production-batch", "order", "sale", "write-off", "manual-receipt", "manual-adjustment", "legacy-migration"], required: true },
    sourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    idempotencyKey: { type: String, trim: true, maxlength: 120 },
    reason: { type: String, trim: true, maxlength: 300, default: "" },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);

finishedStockLotMovementSchema.index({ lotId: 1, date: -1, createdAt: -1 });
finishedStockLotMovementSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

module.exports = mongoose.models.FinishedStockLotMovement ||
  mongoose.model("FinishedStockLotMovement", finishedStockLotMovementSchema);
