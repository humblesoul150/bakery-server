const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
  {
    direction: {
      type: String,
      enum: ["inbound", "outbound", "internal"],
      required: true,
    },
    channel: { type: String, enum: ["form", "email"], required: true },
    from: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
    to: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
    subject: { type: String, trim: true, maxlength: 200, default: "" },
    text: { type: String, required: true, maxlength: 20000 },
    senderUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    providerEmailId: { type: String, trim: true, maxlength: 200, default: "" },
    messageId: { type: String, trim: true, maxlength: 998, default: "" },
    inReplyTo: { type: String, trim: true, maxlength: 998, default: "" },
    idempotencyKey: { type: String, trim: true, maxlength: 128, default: "" },
    deliveryStatus: {
      type: String,
      enum: ["not_applicable", "pending", "sent", "failed"],
      default: "not_applicable",
    },
    deliveryError: { type: String, trim: true, maxlength: 500, default: "" },
    sentAt: { type: Date, default: null },
    receivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const customOrderSchema = new mongoose.Schema(
  {
    orderType: { type: String, trim: true, maxlength: 80, default: "" },
    requestedProducts: { type: String, trim: true, maxlength: 1000, default: "" },
    estimatedQuantity: { type: Number, min: 1, validate: Number.isInteger, default: null },
    preferredDate: { type: String, match: /^\d{4}-\d{2}-\d{2}$/, default: "" },
    fulfillment: { type: String, enum: ["Collection", "Delivery", ""], default: "" },
    requirements: { type: String, trim: true, maxlength: 5000, default: "" },
  },
  { _id: false },
);

const conversationSchema = new mongoose.Schema(
  {
    reference: { type: String, required: true, unique: true, trim: true, maxlength: 32 },
    type: {
      type: String,
      enum: ["contact", "custom_order", "sales"],
      required: true,
      index: true,
    },
    channel: {
      type: String,
      enum: ["website_contact", "website_custom_order", "email"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["new", "in_progress", "awaiting_customer", "quoted", "converted_to_order", "closed"],
      default: "new",
      index: true,
    },
    customerName: { type: String, trim: true, maxlength: 180, default: "" },
    customerEmail: { type: String, trim: true, lowercase: true, maxlength: 254, required: true, index: true },
    customerPhone: { type: String, trim: true, maxlength: 40, default: "" },
    subject: { type: String, trim: true, maxlength: 200, default: "" },
    customOrder: { type: customOrderSchema, default: null },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null, index: true },
    recipientAddress: { type: String, trim: true, lowercase: true, maxlength: 254, default: "" },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastMessagePreview: { type: String, trim: true, maxlength: 240, default: "" },
    unread: { type: Boolean, default: true, index: true },
    messages: { type: [messageSchema], default: [] },
    providerMessageIds: { type: [String], default: [] },
    submissionKey: { type: String, trim: true, maxlength: 128 },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

conversationSchema.index({ status: 1, lastMessageAt: -1 });
conversationSchema.index({ customerEmail: 1, lastMessageAt: -1 });
conversationSchema.index({ submissionKey: 1 }, { sparse: true, unique: true });

module.exports = mongoose.models.WebsiteConversation
  || mongoose.model("WebsiteConversation", conversationSchema);
