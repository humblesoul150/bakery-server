const crypto = require("node:crypto");
const mongoose = require("mongoose");
const WebsiteConversation = require("../models/websiteConversation");
const NewsletterSubscriber = require("../models/newsletterSubscriber");
const NewsletterCampaign = require("../models/newsletterCampaign");
const User = require("../models/user");
const audit = require("../lib/audit");
const emailTemplates = require("../lib/emailTemplates");
const {
  getPublicSiteUrl,
  getResendClient,
  getSender,
  getReceivingEmail,
  sendEmail,
  verifyResendWebhook,
} = require("../lib/resendEmail");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SUBMISSION_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const STATUSES = new Set([
  "new",
  "in_progress",
  "awaiting_customer",
  "quoted",
  "converted_to_order",
  "closed",
]);
const SUBSCRIBER_STATUSES = new Set(["active", "suspended", "unsubscribed"]);
const CONSENT_VERSION = "newsletter-consent-v1";

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function text(value, maximum, field, required = false) {
  if (typeof value !== "string") {
    if (required) throw httpError(400, `${field} is required.`);
    return "";
  }
  const normalized = value.trim();
  if (required && !normalized) throw httpError(400, `${field} is required.`);
  if (normalized.length > maximum) {
    throw httpError(400, `${field} must be ${maximum} characters or fewer.`);
  }
  return normalized;
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL_PATTERN.test(email)) {
    throw httpError(400, "Enter a valid email address.");
  }
  return email;
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function createUnsubscribeToken(subscriberId) {
  const secret = String(process.env.NEWSLETTER_TOKEN_SECRET || "").trim();
  if (!secret) throw new Error("NEWSLETTER_TOKEN_SECRET is not configured.");
  return crypto
    .createHmac("sha256", secret)
    .update(String(subscriberId))
    .digest("base64url");
}

function createUnsubscribeUrl(subscriberId) {
  const url = new URL("/newsletter/unsubscribe", `${getPublicSiteUrl()}/`);
  url.searchParams.set("id", String(subscriberId));
  url.searchParams.set("token", createUnsubscribeToken(subscriberId));
  return url.toString();
}

function tokensMatch(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  return leftBuffer.length === rightBuffer.length
    && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function randomReference(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function senderKindForType(type) {
  if (type === "custom_order") return "orders";
  if (type === "sales") return "sales";
  return "info";
}

function emailAddress(value) {
  const input = String(value || "").trim();
  const bracketed = input.match(/<([^<>]+)>/);
  return (bracketed ? bracketed[1] : input).trim().toLowerCase();
}

function providerRecipientAddress(kind) {
  try {
    return emailAddress(getSender(kind));
  } catch {
    return "";
  }
}

function validateWebsiteMessage(body, type) {
  const customerName = text(body.name, 180, "Name", true);
  const customerEmail = normalizeEmail(body.email);
  const customerPhone = text(body.phone, 40, "Phone");
  const messageText = text(body.message, 10000, "Message", true);
  const subject = text(
    body.subject,
    200,
    "Subject",
  ) || (type === "custom_order" ? "Custom-order enquiry" : "Website message");
  const customOrder = type === "custom_order"
    ? {
      orderType: text(body.orderType, 80, "Order type"),
      requestedProducts: text(body.requestedProducts, 1000, "Requested products"),
      estimatedQuantity: body.estimatedQuantity === "" || body.estimatedQuantity == null
        ? null
        : Number(body.estimatedQuantity),
      preferredDate: text(body.preferredDate, 10, "Preferred date"),
      fulfillment: body.fulfillment || "",
      requirements: text(body.requirements, 5000, "Requirements"),
    }
    : null;

  if (customOrder) {
    if (
      customOrder.estimatedQuantity !== null
      && (!Number.isInteger(customOrder.estimatedQuantity) || customOrder.estimatedQuantity < 1)
    ) {
      throw httpError(400, "Estimated quantity must be a positive whole number.");
    }
    if (customOrder.preferredDate && !/^\d{4}-\d{2}-\d{2}$/.test(customOrder.preferredDate)) {
      throw httpError(400, "Preferred date must use YYYY-MM-DD.");
    }
    if (!["", "Collection", "Delivery"].includes(customOrder.fulfillment)) {
      throw httpError(400, "Fulfillment must be Collection or Delivery.");
    }
  }

  return {
    customerName,
    customerEmail,
    customerPhone,
    messageText,
    subject,
    customOrder,
  };
}

function messagePayload(conversation, input) {
  return {
    direction: "inbound",
    channel: input.channel,
    from: input.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    providerEmailId: input.providerEmailId || "",
    messageId: input.messageId || "",
    inReplyTo: input.inReplyTo || "",
    receivedAt: input.receivedAt || new Date(),
  };
}

async function submitWebsiteMessage(request, response, type) {
  const input = validateWebsiteMessage(request.body || {}, type);
  const submissionKey = String(
    request.get("Idempotency-Key") || request.body?.submissionKey || "",
  ).trim();
  if (submissionKey && !SUBMISSION_KEY_PATTERN.test(submissionKey)) {
    return response.status(400).json({ error: "The submission key is invalid." });
  }
  const senderKind = senderKindForType(type);
  const recipientAddress = providerRecipientAddress(senderKind);
  const reference = randomReference(type === "custom_order" ? "ORD-ENQ" : "MSG");
  const conversation = new WebsiteConversation({
    reference,
    type,
    channel: type === "custom_order" ? "website_custom_order" : "website_contact",
    customerName: input.customerName,
    customerEmail: input.customerEmail,
    customerPhone: input.customerPhone,
    subject: input.subject,
    customOrder: input.customOrder,
    recipientAddress,
    submissionKey: submissionKey || undefined,
    messages: [
      messagePayload(null, {
        channel: "form",
        from: input.customerEmail,
        to: recipientAddress,
        subject: input.subject,
        text: input.messageText,
      }),
    ],
  });
  conversation.lastMessagePreview = input.messageText.slice(0, 240);
  conversation.lastMessageAt = new Date();

  try {
    await conversation.save();
  } catch (error) {
    if (error.code === 11000 && submissionKey) {
      const existing = await WebsiteConversation.findOne({ submissionKey }).lean();
      if (existing) {
        return response.status(200).json({
          received: true,
          reference: existing.reference,
          duplicate: true,
        });
      }
    }
    throw error;
  }

  const receipt = emailTemplates.messageReceived({
    name: input.customerName,
    reference,
    type,
    message: input.messageText,
  });
  const outbound = conversation.messages.create({
    direction: "outbound",
    channel: "email",
    from: recipientAddress,
    to: input.customerEmail,
    subject: receipt.subject,
    text: receipt.text,
    idempotencyKey: `message-receipt-${conversation.id}`,
    deliveryStatus: "pending",
  });
  conversation.messages.push(outbound);
  await conversation.save();

  try {
    const sent = await sendEmail({
      from: getSender(senderKind),
      to: input.customerEmail,
      replyTo: recipientAddress || undefined,
      subject: receipt.subject,
      html: receipt.html,
      text: receipt.text,
    }, { idempotencyKey: outbound.idempotencyKey });
    outbound.deliveryStatus = "sent";
    outbound.providerEmailId = sent?.id || "";
    outbound.sentAt = new Date();
    await conversation.save();
  } catch (error) {
    outbound.deliveryStatus = "failed";
    outbound.deliveryError = error.message.slice(0, 500);
    await conversation.save();
    console.error("Could not send website message receipt:", error);
  }

  return response.status(201).json({ received: true, reference });
}

function serializeConversation(conversation, includeMessages = true) {
  const result = conversation.toObject
    ? conversation.toObject()
    : { ...conversation };
  if (!includeMessages) {
    delete result.messages;
    delete result.providerMessageIds;
  }
  return result;
}

async function listConversations(request, response) {
  const page = Math.max(1, Number.parseInt(request.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.query.limit, 10) || 30));
  const filter = {};
  if (request.query.status && request.query.status !== "all") {
    if (!STATUSES.has(request.query.status)) return response.status(400).json({ error: "Invalid status filter." });
    filter.status = request.query.status;
  }
  if (request.query.type && request.query.type !== "all") {
    if (!["contact", "custom_order", "sales"].includes(request.query.type)) {
      return response.status(400).json({ error: "Invalid message type filter." });
    }
    filter.type = request.query.type;
  }
  if (request.query.unread === "true") filter.unread = true;
  if (request.query.assignedTo === "me") filter.assignedTo = request.authUser._id;
  if (request.query.search) {
    const search = text(String(request.query.search), 100, "Search");
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.$or = [
      { reference: { $regex: escaped, $options: "i" } },
      { customerName: { $regex: escaped, $options: "i" } },
      { customerEmail: { $regex: escaped, $options: "i" } },
      { subject: { $regex: escaped, $options: "i" } },
    ];
  }
  const [items, total] = await Promise.all([
    WebsiteConversation.find(filter)
      .select("-messages.text -providerMessageIds")
      .populate("assignedTo", "name email")
      .sort({ lastMessageAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    WebsiteConversation.countDocuments(filter),
  ]);
  return response.json({ items, page, limit, total });
}

async function listMessageAssignees(_request, response) {
  const items = await User.find({
    status: "Active",
    roles: { $in: ["Admin", "General Manager", "Sales Manager", "Marketing Manager", "Super Admin"] },
  })
    .select("name email roles")
    .sort({ name: 1 })
    .lean();
  return response.json({ items });
}

async function findConversation(id) {
  const query = mongoose.isValidObjectId(id)
    ? { _id: id }
    : { reference: id };
  return WebsiteConversation.findOne(query).populate("assignedTo", "name email");
}

async function getConversation(request, response) {
  const conversation = await findConversation(request.params.id);
  if (!conversation) return response.status(404).json({ error: "Conversation not found." });
  if (conversation.unread) {
    conversation.unread = false;
    await conversation.save();
  }
  return response.json({ conversation: serializeConversation(conversation) });
}

async function updateConversation(request, response) {
  const conversation = await findConversation(request.params.id);
  if (!conversation) return response.status(404).json({ error: "Conversation not found." });
  const { status, assignedTo, unread } = request.body || {};
  if (status !== undefined) {
    if (!STATUSES.has(status)) return response.status(400).json({ error: "Invalid conversation status." });
    conversation.status = status;
    conversation.closedAt = status === "closed" ? new Date() : null;
  }
  if (assignedTo !== undefined) {
    if (assignedTo === null || assignedTo === "") {
      conversation.assignedTo = null;
    } else {
      if (!mongoose.isValidObjectId(assignedTo)) return response.status(400).json({ error: "Assigned user is invalid." });
      const user = await User.findOne({
        _id: assignedTo,
        status: "Active",
        roles: { $in: ["Admin", "General Manager", "Sales Manager", "Marketing Manager", "Super Admin"] },
      }).select("_id");
      if (!user) return response.status(400).json({ error: "Choose an active communications team member." });
      conversation.assignedTo = user._id;
    }
  }
  if (unread !== undefined) {
    if (typeof unread !== "boolean") return response.status(400).json({ error: "Unread must be true or false." });
    conversation.unread = unread;
  }
  await conversation.save();
  await audit.recordAudit({
    request,
    eventType: "website_communications.conversation_updated",
    outcome: "success",
    actor: request.authUser,
    details: { reference: conversation.reference, status: conversation.status },
  });
  return response.json({ conversation: serializeConversation(conversation) });
}

async function addConversationNote(request, response) {
  const note = text(request.body?.text, 20000, "Note", true);
  const conversation = await findConversation(request.params.id);
  if (!conversation) return response.status(404).json({ error: "Conversation not found." });
  const message = conversation.messages.create({
    direction: "internal",
    channel: "form",
    from: request.authUser.email || "",
    senderUserId: request.authUser._id,
    subject: "Internal note",
    text: note,
  });
  conversation.messages.push(message);
  conversation.lastMessageAt = new Date();
  conversation.lastMessagePreview = note.slice(0, 240);
  await conversation.save();
  await audit.recordAudit({
    request,
    eventType: "website_communications.internal_note_added",
    outcome: "success",
    actor: request.authUser,
    details: { reference: conversation.reference },
  });
  return response.status(201).json({ conversation: serializeConversation(conversation) });
}

async function sendConversationReply(request, response, retryMessageId = "") {
  const replyText = retryMessageId
    ? ""
    : text(request.body?.text, 20000, "Reply", true);
  const conversation = await findConversation(request.params.id);
  if (!conversation) return response.status(404).json({ error: "Conversation not found." });
  let outbound = retryMessageId
    ? conversation.messages.id(retryMessageId)
    : null;
  if (retryMessageId && (!outbound || outbound.deliveryStatus !== "failed" || outbound.direction !== "outbound")) {
    return response.status(404).json({ error: "Failed email reply not found." });
  }
  if (!outbound) {
    const from = providerRecipientAddress(senderKindForType(conversation.type));
    if (!from) return response.status(503).json({ error: "The sender address is not configured." });
    outbound = conversation.messages.create({
      direction: "outbound",
      channel: "email",
      from,
      to: conversation.customerEmail,
      subject: conversation.subject.toLowerCase().startsWith("re:")
        ? conversation.subject
        : `Re: ${conversation.subject}`,
      text: replyText,
      senderUserId: request.authUser._id,
      idempotencyKey: `conversation-reply-${conversation.id}-${crypto.randomUUID()}`,
      deliveryStatus: "pending",
    });
    conversation.messages.push(outbound);
  } else {
    outbound.deliveryStatus = "pending";
    outbound.deliveryError = "";
  }
  conversation.lastMessageAt = new Date();
  conversation.lastMessagePreview = outbound.text.slice(0, 240);
  conversation.status = "awaiting_customer";
  conversation.unread = false;
  await conversation.save();

  try {
    const senderKind = senderKindForType(conversation.type);
    const sent = await sendEmail({
      from: getSender(senderKind),
      to: conversation.customerEmail,
      replyTo: outbound.from,
      subject: outbound.subject,
      text: outbound.text,
      headers: conversation.messages
        .filter((message) => message.direction === "inbound" && message.messageId)
        .slice(-1)
        .map((message) => message.messageId)
        .map((messageId) => ({ "In-Reply-To": messageId }))[0],
    }, { idempotencyKey: outbound.idempotencyKey });
    outbound.deliveryStatus = "sent";
    outbound.providerEmailId = sent?.id || "";
    outbound.sentAt = new Date();
    await conversation.save();
    await audit.recordAudit({
      request,
      eventType: "website_communications.reply_sent",
      outcome: "success",
      actor: request.authUser,
      details: { reference: conversation.reference },
    });
    return response.status(retryMessageId ? 200 : 201).json({
      conversation: serializeConversation(conversation),
    });
  } catch (error) {
    outbound.deliveryStatus = "failed";
    outbound.deliveryError = error.message.slice(0, 500);
    await conversation.save();
    console.error("Could not send website conversation reply:", error);
    return response.status(502).json({
      error: "The reply could not be delivered. It has been saved as failed and can be retried.",
      conversation: serializeConversation(conversation),
    });
  }
}

async function getResendContact(resend, email) {
  const result = await resend.contacts.get({ email });
  if (result.error) {
    throw new Error(`Resend could not retrieve the subscriber contact: ${result.error.message}`);
  }
  return result.data;
}

async function syncSubscriber(subscriber, active) {
  const segmentId = String(process.env.RESEND_NEWSLETTER_SEGMENT_ID || "").trim();
  if (!segmentId) throw new Error("RESEND_NEWSLETTER_SEGMENT_ID is not configured.");
  const resend = getResendClient();
  if (!active) {
    const unsubscribe = subscriber.status !== "suspended";
    const contact = await getResendContact(resend, subscriber.email).catch((error) => {
      if (/not found|does not exist|404/i.test(error.message)) return null;
      throw error;
    });
    if (contact?.id) {
      const update = await resend.contacts.update({
        id: contact.id,
        unsubscribed: unsubscribe,
      });
      if (update.error) throw new Error(`Resend could not suppress the subscriber: ${update.error.message}`);
      const removal = await resend.contacts.segments.remove({
        contactId: contact.id,
        segmentId,
      });
      if (removal.error && !/not found|not in|does not belong|already/i.test(removal.error.message)) {
        throw new Error(`Resend could not remove the subscriber from the newsletter segment: ${removal.error.message}`);
      }
    }
    subscriber.providerSyncStatus = "synced";
    subscriber.providerSyncError = "";
    await subscriber.save();
    return;
  }

  let contact = await getResendContact(resend, subscriber.email).catch((error) => {
    if (/not found|does not exist|404/i.test(error.message)) return null;
    throw error;
  });
  if (contact?.id) {
    const update = await resend.contacts.update({
      id: contact.id,
      unsubscribed: false,
    });
    if (update.error) throw new Error(`Resend could not update the subscriber: ${update.error.message}`);
    const add = await resend.contacts.segments.add({ contactId: contact.id, segmentId });
    if (add.error && !/already|exists/i.test(add.error.message)) {
      throw new Error(`Resend could not add the subscriber to the newsletter segment: ${add.error.message}`);
    }
  } else {
    const created = await resend.contacts.create({
      email: subscriber.email,
      unsubscribed: false,
      segments: [{ id: segmentId }],
    });
    if (created.error) throw new Error(`Resend could not create the subscriber contact: ${created.error.message}`);
    contact = { id: created.data.id };
  }
  subscriber.resendContactId = contact.id;
  subscriber.providerSyncStatus = "synced";
  subscriber.providerSyncError = "";
  await subscriber.save();
}

async function subscribeToNewsletter(request, response) {
  const email = normalizeEmail(request.body?.email);
  if (request.body?.consent !== true) {
    return response.status(400).json({ error: "Newsletter consent is required." });
  }
  const existing = await NewsletterSubscriber.findOne({ email }).select("+verificationTokenHash");
  if (existing && ["active", "suspended", "suppressed"].includes(existing.status)) {
    return response.json({
      message: "If this address can be subscribed, a verification email will be sent.",
    });
  }

  const token = createToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const subscriber = existing || new NewsletterSubscriber({ email });
  subscriber.status = "pending_verification";
  subscriber.consent = {
    source: "storefront",
    wordingVersion: CONSENT_VERSION,
    consentedAt: new Date(),
    verifiedAt: null,
  };
  subscriber.verificationTokenHash = hash(token);
  subscriber.verificationExpiresAt = expiresAt;
  subscriber.unsubscribeTokenHash = hash(createUnsubscribeToken(subscriber._id));
  subscriber.verificationEmailError = "";
  subscriber.providerSyncStatus = "pending";
  await subscriber.save();

  try {
    const confirmUrl = `${getPublicSiteUrl()}/api/newsletter/confirm?token=${encodeURIComponent(token)}`;
    const template = emailTemplates.newsletterVerification({ confirmUrl });
    await sendEmail({
      from: getSender("newsletter"),
      to: email,
      subject: template.subject,
      html: template.html,
      text: template.text,
    }, { idempotencyKey: `newsletter-verification-${subscriber.id}-${hash(token)}` });
  } catch (error) {
    subscriber.verificationEmailError = error.message.slice(0, 500);
    await subscriber.save();
    console.error("Could not send newsletter verification:", error);
    return response.status(502).json({
      error: "The subscription request was saved, but its verification email could not be sent. Please try again.",
    });
  }
  return response.status(202).json({
    message: "If this address can be subscribed, a verification email will be sent.",
  });
}

async function confirmNewsletterSubscription(request, response) {
  const token = String(request.query.token || "").trim();
  if (token.length < 20 || token.length > 200) {
    return response.status(400).json({ error: "The verification link is invalid or expired." });
  }
  const subscriber = await NewsletterSubscriber.findOne({
    verificationTokenHash: hash(token),
    status: "pending_verification",
    verificationExpiresAt: { $gt: new Date() },
  }).select("+verificationTokenHash");
  if (!subscriber || !tokensMatch(subscriber.verificationTokenHash, hash(token))) {
    return response.status(400).json({ error: "The verification link is invalid or expired." });
  }
  subscriber.status = "active";
  subscriber.consent.verifiedAt = new Date();
  subscriber.verificationTokenHash = undefined;
  subscriber.verificationExpiresAt = null;
  subscriber.verificationEmailError = "";
  await subscriber.save();

  try {
    await syncSubscriber(subscriber, true);
  } catch (error) {
    subscriber.providerSyncStatus = "failed";
    subscriber.providerSyncError = error.message.slice(0, 300);
    await subscriber.save();
    console.error("Could not sync verified newsletter subscriber:", error);
    return response.status(202).json({
      confirmed: true,
      warning: "Your address is verified, but a temporary email-list sync issue needs attention.",
    });
  }

  try {
    const template = emailTemplates.newsletterWelcome({
      unsubscribeUrl: createUnsubscribeUrl(subscriber._id),
    });
    await sendEmail({
      from: getSender("newsletter"),
      to: subscriber.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
      headers: {
        "List-Unsubscribe": `<${createUnsubscribeUrl(subscriber._id)}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    }, { idempotencyKey: `newsletter-welcome-${subscriber.id}` });
  } catch (error) {
    console.error("Could not send newsletter welcome email:", error);
  }
  return response.json({ confirmed: true });
}

async function unsubscribeFromNewsletter(request, response) {
  const id = String(request.body?.id || request.query.id || "").trim();
  const token = String(request.body?.token || request.query.token || "").trim();
  if (!mongoose.isValidObjectId(id) || token.length < 20 || token.length > 200) {
    return response.status(400).json({ error: "The unsubscribe link is invalid." });
  }
  const subscriber = await NewsletterSubscriber.findById(id).select("+unsubscribeTokenHash");
  if (
    !subscriber
    || !tokensMatch(subscriber.unsubscribeTokenHash, hash(createUnsubscribeToken(subscriber._id)))
    || !tokensMatch(token, createUnsubscribeToken(subscriber._id))
  ) {
    return response.status(400).json({ error: "The unsubscribe link is invalid." });
  }
  if (subscriber.status !== "unsubscribed") {
    subscriber.status = "unsubscribed";
    subscriber.verificationTokenHash = undefined;
    subscriber.verificationExpiresAt = null;
    subscriber.providerSyncStatus = "pending";
    await subscriber.save();
  }
  try {
    await syncSubscriber(subscriber, false);
  } catch (error) {
    subscriber.providerSyncStatus = "failed";
    subscriber.providerSyncError = error.message.slice(0, 300);
    await subscriber.save();
    console.error("Could not sync newsletter unsubscribe:", error);
    return response.status(202).json({
      unsubscribed: true,
      warning: "You are unsubscribed here; the email provider sync is pending.",
    });
  }
  return response.json({ unsubscribed: true });
}

async function listSubscribers(request, response) {
  const page = Math.max(1, Number.parseInt(request.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, Number.parseInt(request.query.limit, 10) || 30));
  const filter = {};
  if (request.query.status && request.query.status !== "all") {
    if (!SUBSCRIBER_STATUSES.has(request.query.status) && request.query.status !== "pending_verification" && request.query.status !== "suppressed") {
      return response.status(400).json({ error: "Invalid subscriber status filter." });
    }
    filter.status = request.query.status;
  }
  if (request.query.search) {
    const escaped = text(String(request.query.search), 100, "Search")
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.email = { $regex: escaped, $options: "i" };
  }
  const [items, total, eligibleCount] = await Promise.all([
    NewsletterSubscriber.find(filter)
      .select("-unsubscribeTokenHash -verificationTokenHash")
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    NewsletterSubscriber.countDocuments(filter),
    NewsletterSubscriber.countDocuments({
      status: "active",
      "consent.verifiedAt": { $ne: null },
      providerSyncStatus: "synced",
    }),
  ]);
  return response.json({ items, page, limit, total, eligibleCount });
}

async function updateSubscriberStatus(request, response) {
  const status = request.body?.status;
  if (!["suspended", "active", "unsubscribed"].includes(status)) {
    return response.status(400).json({ error: "Status must be active, suspended, or unsubscribed." });
  }
  const subscriber = await NewsletterSubscriber.findById(request.params.id);
  if (!subscriber) return response.status(404).json({ error: "Subscriber not found." });
  if (subscriber.status === "unsubscribed" || subscriber.status === "suppressed") {
    return response.status(409).json({ error: "Unsubscribed or suppressed subscribers cannot be reactivated here." });
  }
  if (status === "active" && !subscriber.consent.verifiedAt) {
    return response.status(409).json({ error: "Only a verified subscriber can be reactivated." });
  }
  subscriber.status = status;
  if (status === "unsubscribed") {
    subscriber.verificationTokenHash = undefined;
    subscriber.verificationExpiresAt = null;
  }
  subscriber.suspendedAt = status === "suspended" ? new Date() : null;
  subscriber.suspensionReason = status === "suspended"
    ? text(request.body?.reason || "Suspended by an authorized manager.", 500, "Reason")
    : "";
  await subscriber.save();
  try {
    await syncSubscriber(subscriber, status === "active");
  } catch (error) {
    subscriber.providerSyncStatus = "failed";
    subscriber.providerSyncError = error.message.slice(0, 300);
    await subscriber.save();
    console.error("Could not sync newsletter subscriber status:", error);
    return response.status(502).json({ error: "Subscriber status was saved, but Resend could not be synchronized." });
  }
  await audit.recordAudit({
    request,
    eventType: status === "active"
      ? "newsletter.subscriber_reactivated"
      : status === "suspended"
        ? "newsletter.subscriber_suspended"
        : "newsletter.subscriber_unsubscribed_by_manager",
    outcome: "success",
    actor: request.authUser,
    details: { subscriberId: subscriber.id },
  });
  return response.json({ subscriber });
}

async function deleteSubscriber(request, response) {
  const emailConfirmation = normalizeEmail(request.body?.confirmEmail);
  const subscriber = await NewsletterSubscriber.findById(request.params.id);
  if (!subscriber) return response.status(404).json({ error: "Subscriber not found." });
  if (emailConfirmation !== subscriber.email) {
    return response.status(400).json({ error: "Type the subscriber email to confirm deletion." });
  }
  try {
    await syncSubscriber(subscriber, false);
  } catch (error) {
    return response.status(502).json({
      error: "The subscriber was not deleted because Resend could not first suppress the contact.",
    });
  }
  await NewsletterSubscriber.deleteOne({ _id: subscriber._id });
  await audit.recordAudit({
    request,
    eventType: "newsletter.subscriber_deleted",
    outcome: "success",
    actor: request.authUser,
    details: { subscriberId: subscriber.id },
  });
  return response.status(204).end();
}

function campaignInput(body) {
  const name = text(body.name, 160, "Campaign name", true);
  const subject = text(body.subject, 180, "Subject", true);
  const previewText = text(body.previewText, 200, "Preview text");
  const intro = text(body.intro, 2000, "Introduction");
  if (!Array.isArray(body.blocks) || body.blocks.length > 30) {
    throw httpError(400, "Campaign content must contain 30 or fewer blocks.");
  }
  const blocks = body.blocks.map((block, index) => {
    if (!block || !["heading", "paragraph", "button", "image"].includes(block.type)) {
      throw httpError(400, `Campaign block ${index + 1} has an unsupported type.`);
    }
    const normalized = { type: block.type };
    if (block.type === "heading" || block.type === "paragraph") {
      normalized.text = text(block.text, 2000, `Campaign block ${index + 1}`, true);
    } else if (block.type === "button") {
      normalized.label = text(block.label, 120, "Button label", true);
      normalized.url = text(block.url, 1000, "Button URL", true);
      let url;
      try {
        url = new URL(normalized.url);
      } catch {
        throw httpError(400, "Campaign button URLs must be valid HTTP or HTTPS links.");
      }
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
        throw httpError(400, "Campaign button URLs must be valid HTTP or HTTPS links.");
      }
    } else {
      normalized.url = text(block.url, 1000, "Image URL", true);
      normalized.alt = text(block.alt, 250, "Image description");
      let url;
      try {
        url = new URL(normalized.url);
      } catch {
        throw httpError(400, "Campaign image URLs must be valid HTTP or HTTPS links.");
      }
      if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
        throw httpError(400, "Campaign image URLs must be valid HTTP or HTTPS links.");
      }
    }
    return normalized;
  });
  return { name, subject, previewText, intro, blocks };
}

async function listCampaigns(_request, response) {
  const campaigns = await NewsletterCampaign.find()
    .populate("createdBy", "name email")
    .sort({ updatedAt: -1 })
    .limit(100)
    .lean();
  return response.json({ items: campaigns });
}

async function createCampaign(request, response) {
  const input = campaignInput(request.body || {});
  const campaign = await NewsletterCampaign.create({
    ...input,
    createdBy: request.authUser._id,
  });
  await audit.recordAudit({
    request,
    eventType: "newsletter.campaign_created",
    outcome: "success",
    actor: request.authUser,
    details: { campaignId: campaign.id },
  });
  return response.status(201).json({ campaign });
}

async function updateCampaign(request, response) {
  const campaign = await NewsletterCampaign.findById(request.params.id);
  if (!campaign) return response.status(404).json({ error: "Campaign not found." });
  if (campaign.status !== "draft") return response.status(409).json({ error: "Only draft campaigns can be edited." });
  Object.assign(campaign, campaignInput(request.body || {}));
  await campaign.save();
  return response.json({ campaign });
}

async function getCampaignPreview(request, response) {
  const campaign = await NewsletterCampaign.findById(request.params.id);
  if (!campaign) return response.status(404).json({ error: "Campaign not found." });
  const rendered = emailTemplates.newsletterCampaign({
    title: campaign.subject,
    intro: campaign.intro,
    blocks: campaign.blocks,
  });
  return response.json(rendered);
}

async function sendCampaignTest(request, response) {
  const campaign = await NewsletterCampaign.findById(request.params.id);
  if (!campaign) return response.status(404).json({ error: "Campaign not found." });
  if (campaign.status !== "draft") return response.status(409).json({ error: "Only draft campaigns can be tested." });
  const to = normalizeEmail(request.body?.email);
  const rendered = emailTemplates.newsletterCampaign({
    title: campaign.subject,
    intro: campaign.intro,
    blocks: campaign.blocks,
    resendUnsubscribe: false,
  });
  const result = await sendEmail({
    from: getSender("newsletter"),
    to,
    subject: campaign.subject,
    html: rendered.html,
    text: rendered.text,
  }, { idempotencyKey: `newsletter-test-${campaign.id}-${crypto.randomUUID()}` });
  return response.json({ sent: true, emailId: result?.id || "" });
}

async function sendCampaign(request, response) {
  const campaign = await NewsletterCampaign.findById(request.params.id);
  if (!campaign) return response.status(404).json({ error: "Campaign not found." });
  if (campaign.status !== "draft") return response.status(409).json({ error: "Only draft campaigns can be sent." });
  const segmentId = String(process.env.RESEND_NEWSLETTER_SEGMENT_ID || "").trim();
  if (!segmentId) return response.status(503).json({ error: "Newsletter segment is not configured in Resend." });
  const audienceCount = await NewsletterSubscriber.countDocuments({
    status: "active",
    "consent.verifiedAt": { $ne: null },
    providerSyncStatus: "synced",
  });
  if (!audienceCount) return response.status(409).json({ error: "There are no verified, synchronized subscribers to receive this campaign." });

  const rendered = emailTemplates.newsletterCampaign({
    title: campaign.subject,
    intro: campaign.intro,
    blocks: campaign.blocks,
  });
  campaign.status = "sending";
  campaign.audienceCount = audienceCount;
  campaign.failureReason = "";
  await campaign.save();
  let broadcastId = campaign.resendBroadcastId;
  try {
    const resend = getResendClient();
    if (!broadcastId) {
      const created = await resend.broadcasts.create({
        name: campaign.name,
        from: getSender("newsletter"),
        segmentId,
        subject: campaign.subject,
        previewText: campaign.previewText,
        html: rendered.html,
        text: rendered.text,
        send: false,
      }, { idempotencyKey: `newsletter-broadcast-create-${campaign.id}` });
      if (created.error) throw new Error(`Resend could not create the broadcast: ${created.error.message}`);
      broadcastId = created.data.id;
      campaign.resendBroadcastId = broadcastId;
      await campaign.save();
    }
    const sent = await resend.broadcasts.send(
      broadcastId,
      undefined,
      { idempotencyKey: `newsletter-broadcast-send-${campaign.id}` },
    );
    if (sent.error) throw new Error(`Resend could not send the broadcast: ${sent.error.message}`);
    campaign.status = "sent";
    campaign.sentAt = new Date();
    await campaign.save();
    await NewsletterSubscriber.updateMany(
      {
        status: "active",
        "consent.verifiedAt": { $ne: null },
        providerSyncStatus: "synced",
      },
      { $set: { lastCampaignAt: campaign.sentAt } },
    );
    await audit.recordAudit({
      request,
      eventType: "newsletter.campaign_sent",
      outcome: "success",
      actor: request.authUser,
      details: { campaignId: campaign.id, audienceCount, resendBroadcastId: broadcastId },
    });
    return response.json({ campaign });
  } catch (error) {
    campaign.status = "failed";
    campaign.failureReason = error.message.slice(0, 500);
    await campaign.save();
    console.error("Could not send newsletter campaign:", error);
    return response.status(502).json({
      error: "The campaign could not be sent. Review the error and provider state before retrying.",
      campaign,
    });
  }
}

function cleanEmailText(value) {
  return String(value || "")
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 20000);
}

function headerValue(headers, name) {
  if (!headers || typeof headers !== "object") return "";
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return Array.isArray(entry?.[1]) ? entry[1].join(" ") : String(entry?.[1] || "");
}

function parseEmailAddress(value) {
  const input = String(value || "").trim();
  const bracketed = input.match(/<([^<>]+)>/);
  const address = (bracketed ? bracketed[1] : input).trim().toLowerCase();
  return EMAIL_PATTERN.test(address) ? address : "";
}

async function processReceivedEmail(data) {
  const emailId = String(data.email_id || data.id || "").trim();
  if (!emailId) throw new Error("The inbound email event has no email ID.");
  const existing = await WebsiteConversation.findOne({
    $or: [
      { "messages.providerEmailId": emailId },
      { providerMessageIds: emailId },
    ],
  });
  if (existing) return { duplicate: true };

  const email = await getReceivingEmail(emailId);
  const recipients = Array.isArray(email.to) ? email.to : [email.to];
  const recipient = recipients.map((value) => parseEmailAddress(value)).find((address) =>
    address && ["info", "orders", "sales"].some((kind) => providerRecipientAddress(kind) === address),
  );
  if (!recipient) return { ignored: true, reason: "unconfigured_recipient" };
  const kind = ["info", "orders", "sales"].find((item) => providerRecipientAddress(item) === recipient);
  const type = kind === "orders" ? "custom_order" : kind === "sales" ? "sales" : "contact";
  const sender = parseEmailAddress(email.from);
  if (!sender) return { ignored: true, reason: "invalid_sender" };
  const subject = text(email.subject || "Email enquiry", 200, "Subject");
  const messageText = cleanEmailText(email.text || email.html);
  if (!messageText) return { ignored: true, reason: "empty_message" };
  const headers = email.headers || {};
  const messageId = headerValue(headers, "message-id") || String(email.message_id || "");
  const inReplyTo = headerValue(headers, "in-reply-to");
  const references = `${headerValue(headers, "references")} ${inReplyTo}`
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  let conversation = references.length
    ? await WebsiteConversation.findOne({
      $or: [
        { providerMessageIds: { $in: references } },
        { "messages.messageId": { $in: references } },
      ],
    })
    : null;
  if (!conversation) {
    const normalizeSubject = (value) => String(value || "")
      .replace(/^\s*(re|fw|fwd)\s*:\s*/i, "")
      .trim()
      .toLowerCase();
    const candidates = await WebsiteConversation.find({
      customerEmail: sender,
      recipientAddress: recipient,
      status: { $nin: ["closed", "converted_to_order"] },
    })
      .sort({ lastMessageAt: -1 })
      .limit(10);
    conversation = candidates.find((candidate) =>
      normalizeSubject(candidate.subject) === normalizeSubject(subject),
    ) || null;
  }
  const receivedMessage = {
    direction: "inbound",
    channel: "email",
    from: sender,
    to: recipient,
    subject,
    text: messageText,
    providerEmailId: emailId,
    messageId,
    inReplyTo,
    receivedAt: new Date(),
  };
  if (!conversation) {
    conversation = new WebsiteConversation({
      reference: randomReference(type === "custom_order" ? "ORD-EMAIL" : "MSG-EMAIL"),
      type,
      channel: "email",
      customerName: "",
      customerEmail: sender,
      subject,
      recipientAddress: recipient,
      messages: [receivedMessage],
      providerMessageIds: [emailId, messageId].filter(Boolean),
      unread: true,
    });
  } else {
    conversation.messages.push(receivedMessage);
    conversation.providerMessageIds = [
      ...new Set([...conversation.providerMessageIds, emailId, messageId].filter(Boolean)),
    ];
    conversation.customerEmail = sender;
    conversation.unread = true;
    if (conversation.status === "closed") {
      conversation.status = "in_progress";
      conversation.closedAt = null;
    }
  }
  conversation.lastMessageAt = new Date();
  conversation.lastMessagePreview = messageText.slice(0, 240);
  await conversation.save();
  return { received: true, reference: conversation.reference };
}

async function processResendEvent(event) {
  if (event.type === "email.received") {
    return processReceivedEmail(event.data || {});
  }
  if (event.type === "contact.updated") {
    const data = event.data || {};
    const email = parseEmailAddress(data.email);
    if (!email || data.unsubscribed !== true) return { ignored: true, reason: "contact_not_unsubscribed" };
    const subscriber = await NewsletterSubscriber.findOne({ email });
    if (!subscriber || ["unsubscribed", "suppressed"].includes(subscriber.status)) {
      return { ignored: true, reason: "subscriber_not_eligible" };
    }
    subscriber.status = "unsubscribed";
    subscriber.verificationTokenHash = undefined;
    subscriber.verificationExpiresAt = null;
    subscriber.providerSyncStatus = "synced";
    subscriber.providerSyncError = "";
    await subscriber.save();
    return { unsubscribed: true };
  }
  if (["email.bounced", "email.complained", "email.suppressed", "suppression.added"].includes(event.type)) {
    const data = event.data || {};
    const candidates = [
      data.to,
      data.email,
      data.recipient,
      data.contact?.email,
    ];
    const addresses = candidates.flatMap((candidate) =>
      Array.isArray(candidate) ? candidate : [candidate],
    ).map(parseEmailAddress).filter(Boolean);
    if (!addresses.length) return { ignored: true, reason: "recipient_not_present" };
    const reason = event.type === "email.complained"
      ? "complaint"
      : event.type === "suppression.added"
        ? String(data.origin || "provider")
        : event.type === "email.suppressed"
          ? "provider_suppression"
          : "bounce";
    const subscriber = await NewsletterSubscriber.findOne({ email: { $in: addresses } });
    if (!subscriber) return { ignored: true, reason: "subscriber_not_found" };
    if (subscriber.status === "suppressed") return { ignored: true, reason: "already_suppressed" };
    subscriber.status = "suppressed";
    subscriber.suppressedAt = new Date();
    subscriber.suppressionReason = reason;
    subscriber.providerSyncStatus = "synced";
    await subscriber.save();
    return { suppressed: true };
  }
  return { ignored: true, reason: "unsupported_event" };
}

async function resendWebhook(request, response) {
  if (!Buffer.isBuffer(request.rawBody)) {
    return response.status(400).json({ error: "Raw webhook payload is unavailable for signature verification." });
  }
  let event;
  try {
    event = verifyResendWebhook(request.rawBody, request.headers);
  } catch (error) {
    return response.status(400).json({ error: "Resend webhook signature verification failed." });
  }
  try {
    const result = await processResendEvent(event);
    return response.json({ received: true, result });
  } catch (error) {
    console.error("Could not process Resend webhook:", error);
    return response.status(503).json({ error: "The Resend webhook could not be processed and may be retried." });
  }
}

async function getCommunicationSummary(_request, response) {
  const [newMessages, openMessages, unreadMessages] = await Promise.all([
    WebsiteConversation.countDocuments({ status: "new" }),
    WebsiteConversation.countDocuments({ status: { $nin: ["closed", "converted_to_order"] } }),
    WebsiteConversation.countDocuments({ unread: true }),
  ]);
  return response.json({ messages: { new: newMessages, open: openMessages, unread: unreadMessages } });
}

module.exports = {
  addConversationNote,
  confirmNewsletterSubscription,
  createCampaign,
  deleteSubscriber,
  getCampaignPreview,
  getCommunicationSummary,
  getConversation,
  listCampaigns,
  listConversations,
  listMessageAssignees,
  listSubscribers,
  processResendEvent,
  resendWebhook,
  sendCampaign,
  sendCampaignTest,
  sendConversationReply,
  submitContactMessage: (request, response) => submitWebsiteMessage(request, response, "contact"),
  submitCustomOrderEnquiry: (request, response) => submitWebsiteMessage(request, response, "custom_order"),
  subscribeToNewsletter,
  unsubscribeFromNewsletter,
  updateCampaign,
  updateConversation,
  updateSubscriberStatus,
  campaignInput,
  validateWebsiteMessage,
};
