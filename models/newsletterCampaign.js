const mongoose = require("mongoose");

const blockSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["heading", "paragraph", "button", "image"], required: true },
    text: { type: String, trim: true, maxlength: 2000, default: "" },
    label: { type: String, trim: true, maxlength: 120, default: "" },
    url: { type: String, trim: true, maxlength: 1000, default: "" },
    alt: { type: String, trim: true, maxlength: 250, default: "" },
  },
  { _id: false },
);

const campaignSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    subject: { type: String, required: true, trim: true, maxlength: 180 },
    previewText: { type: String, trim: true, maxlength: 200, default: "" },
    intro: { type: String, trim: true, maxlength: 2000, default: "" },
    blocks: { type: [blockSchema], default: [] },
    status: {
      type: String,
      enum: ["draft", "sending", "sent", "failed"],
      default: "draft",
      index: true,
    },
    audienceCount: { type: Number, min: 0, default: 0 },
    resendBroadcastId: { type: String, trim: true, maxlength: 128, default: "" },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    sentAt: { type: Date, default: null },
    failureReason: { type: String, trim: true, maxlength: 500, default: "" },
  },
  { timestamps: true },
);

campaignSchema.index({ status: 1, updatedAt: -1 });

module.exports = mongoose.models.NewsletterCampaign
  || mongoose.model("NewsletterCampaign", campaignSchema);
