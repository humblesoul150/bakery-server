const mongoose = require("mongoose");

const consentSchema = new mongoose.Schema(
  {
    source: { type: String, enum: ["storefront"], required: true },
    wordingVersion: { type: String, trim: true, maxlength: 40, required: true },
    consentedAt: { type: Date, required: true },
    verifiedAt: { type: Date, default: null },
  },
  { _id: false },
);

const subscriberSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    status: {
      type: String,
      enum: ["pending_verification", "active", "unsubscribed", "suspended", "suppressed"],
      required: true,
      default: "pending_verification",
      index: true,
    },
    consent: { type: consentSchema, required: true },
    verificationTokenHash: { type: String, trim: true, select: false },
    verificationExpiresAt: { type: Date, default: null },
    verificationEmailError: { type: String, trim: true, maxlength: 500, default: "" },
    unsubscribeTokenHash: { type: String, trim: true, required: true, select: false },
    suspendedAt: { type: Date, default: null },
    suspensionReason: { type: String, trim: true, maxlength: 500, default: "" },
    suppressedAt: { type: Date, default: null },
    suppressionReason: { type: String, trim: true, maxlength: 120, default: "" },
    resendContactId: { type: String, trim: true, maxlength: 128, default: "" },
    providerSyncStatus: {
      type: String,
      enum: ["pending", "synced", "failed", "not_required"],
      default: "pending",
    },
    providerSyncError: { type: String, trim: true, maxlength: 300, default: "" },
    lastCampaignAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

subscriberSchema.index({ email: 1 }, { unique: true });
subscriberSchema.index({ verificationTokenHash: 1 }, { sparse: true });
subscriberSchema.index({ unsubscribeTokenHash: 1 }, { unique: true });
subscriberSchema.index({ status: 1, "consent.verifiedAt": 1 });

module.exports = mongoose.models.NewsletterSubscriber
  || mongoose.model("NewsletterSubscriber", subscriberSchema);
