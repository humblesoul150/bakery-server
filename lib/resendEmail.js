const { Resend } = require("resend");

let client;

function getResendClient() {
  const apiKey = String(process.env.RESEND_API_KEY || "").trim();
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured.");
  if (!client || client.key !== apiKey) client = new Resend(apiKey);
  return client;
}

function getSender(kind) {
  const key = {
    info: "RESEND_FROM_INFO",
    orders: "RESEND_FROM_ORDERS",
    sales: "RESEND_FROM_SALES",
    newsletter: "RESEND_FROM_NEWSLETTER",
  }[kind];
  if (!key) throw new Error("Unsupported email sender type.");
  const value = String(process.env[key] || "").trim();
  if (!value) throw new Error(`${key} is not configured.`);
  return value;
}

function getPublicSiteUrl() {
  const value = String(process.env.PUBLIC_STOREFRONT_URL || "").trim();
  if (!value) throw new Error("PUBLIC_STOREFRONT_URL is not configured.");
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("PUBLIC_STOREFRONT_URL must use HTTP or HTTPS.");
  }
  return url.toString().replace(/\/$/, "");
}

async function sendEmail(payload, options = {}) {
  const resend = options.resend || getResendClient();
  const requestOptions = options.idempotencyKey
    ? { idempotencyKey: options.idempotencyKey }
    : undefined;
  const result = await resend.emails.send(payload, requestOptions);
  if (result.error) {
    throw new Error(`Resend could not send the email: ${result.error.message}`);
  }
  return result.data;
}

async function getReceivingEmail(emailId, options = {}) {
  const resend = options.resend || getResendClient();
  const result = await resend.emails.receiving.get(emailId);
  if (result.error) {
    throw new Error(`Resend could not retrieve the received email: ${result.error.message}`);
  }
  return result.data;
}

function verifyResendWebhook(rawPayload, requestHeaders, options = {}) {
  const webhookSecret = options.webhookSecret || process.env.RESEND_WEBHOOK_SECRET;
  if (!webhookSecret) throw new Error("RESEND_WEBHOOK_SECRET is not configured.");
  const header = (primary, fallback) =>
    requestHeaders[primary] || requestHeaders[fallback] || "";
  const headers = {
    id: header("svix-id", "webhook-id"),
    timestamp: header("svix-timestamp", "webhook-timestamp"),
    signature: header("svix-signature", "webhook-signature"),
  };
  if (!headers.id || !headers.timestamp || !headers.signature) {
    throw new Error("Resend webhook signature headers are missing.");
  }
  return (options.resend || getResendClient()).webhooks.verify({
    payload: Buffer.isBuffer(rawPayload) ? rawPayload.toString("utf8") : String(rawPayload),
    headers,
    webhookSecret,
  });
}

module.exports = {
  getPublicSiteUrl,
  getResendClient,
  getSender,
  getReceivingEmail,
  sendEmail,
  verifyResendWebhook,
};
