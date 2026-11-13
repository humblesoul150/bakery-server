const mongoose = require("mongoose");

const finishedStockLotAllocationSchema = new mongoose.Schema(
  {
    lotId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FinishedStockLot",
      required: true,
      index: true,
    },
    variantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BakeryProductVariant",
      required: true,
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Order",
      required: true,
      index: true,
    },
    orderLineId: { type: mongoose.Schema.Types.ObjectId, required: true },
    allocationType: {
      type: String,
      enum: ["stock_reservation", "preorder_output"],
      required: true,
    },
    quantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
    status: {
      type: String,
      enum: ["reserved", "released", "consumed"],
      required: true,
      default: "reserved",
    },
    idempotencyKey: {
      type: String,
      required: true,
      trim: true,
      maxlength: 160,
      unique: true,
    },
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    releasedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    releasedAt: { type: Date, default: null },
    consumedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

finishedStockLotAllocationSchema.index({ orderId: 1, orderLineId: 1, status: 1 });
finishedStockLotAllocationSchema.index({ lotId: 1, status: 1 });

module.exports =
  mongoose.models.FinishedStockLotAllocation ||
  mongoose.model("FinishedStockLotAllocation", finishedStockLotAllocationSchema);
