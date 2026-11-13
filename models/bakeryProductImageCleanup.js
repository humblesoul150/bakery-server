const mongoose = require("mongoose");

const bakeryProductImageCleanupSchema = new mongoose.Schema(
  {
    familyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BakeryProductFamily",
      required: true,
      index: true,
    },
    publicId: { type: String, required: true, trim: true, maxlength: 255, unique: true },
    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    attempts: { type: Number, min: 0, default: 0 },
    lastError: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { timestamps: true },
);

module.exports = mongoose.models.BakeryProductImageCleanup ||
  mongoose.model("BakeryProductImageCleanup", bakeryProductImageCleanupSchema);
