const test = require("node:test");
const assert = require("node:assert/strict");
const emailTemplates = require("../lib/emailTemplates");
const { verifyResendWebhook } = require("../lib/resendEmail");
const {
  campaignInput,
  validateWebsiteMessage,
} = require("../controllers/websiteCommunicationsController");

test("website contact forms normalize identity and require a message", () => {
  const result = validateWebsiteMessage({
    name: "  Ada Baker ",
    email: " ADA@EXAMPLE.COM ",
    phone: " 0700 000 000 ",
    message: "  I would like to ask about your sourdough. ",
  }, "contact");

  assert.equal(result.customerName, "Ada Baker");
  assert.equal(result.customerEmail, "ada@example.com");
  assert.equal(result.messageText, "I would like to ask about your sourdough.");
  assert.throws(
    () => validateWebsiteMessage({ name: "Ada", email: "ada@example.com", message: " " }, "contact"),
    { statusCode: 400 },
  );
});

test("custom-order forms reject invalid quantities and fulfillment values", () => {
  const valid = validateWebsiteMessage({
    name: "Ada Baker",
    email: "ada@example.com",
    message: "Please let me know whether this is possible.",
    estimatedQuantity: "24",
    preferredDate: "2026-10-10",
    fulfillment: "Collection",
  }, "custom_order");
  assert.equal(valid.customOrder.estimatedQuantity, 24);

  assert.throws(
    () => validateWebsiteMessage({
      name: "Ada Baker",
      email: "ada@example.com",
      message: "Please let me know.",
      estimatedQuantity: "1.5",
    }, "custom_order"),
    { statusCode: 400 },
  );
  assert.throws(
    () => validateWebsiteMessage({
      name: "Ada Baker",
      email: "ada@example.com",
      message: "Please let me know.",
      fulfillment: "Courier",
    }, "custom_order"),
    { statusCode: 400 },
  );
});

test("campaign content accepts only safe HTTP(S) links", () => {
  assert.throws(
    () => campaignInput({
      name: "Weekend bakes",
      subject: "Fresh bakes",
      blocks: [{ type: "button", label: "Shop", url: "javascript:alert(1)" }],
    }),
    { statusCode: 400 },
  );
  assert.throws(
    () => campaignInput({
      name: "Weekend bakes",
      subject: "Fresh bakes",
      blocks: [{ type: "image", url: "https://user:pass@example.com/image.png" }],
    }),
    { statusCode: 400 },
  );
});

test("newsletter templates escape content and include Resend's unsubscribe merge tag", () => {
  const template = emailTemplates.newsletterCampaign({
    title: "<hello>",
    intro: "Fresh <bakes>",
    blocks: [{ type: "paragraph", text: "A & B" }],
  });

  assert.match(template.html, /&lt;hello&gt;/);
  assert.match(template.html, /A &amp; B/);
  assert.match(template.html, /\{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/);
  assert.match(template.text, /Unsubscribe: \{\{\{RESEND_UNSUBSCRIBE_URL\}\}\}/);
  const testTemplate = emailTemplates.newsletterCampaign({
    title: "Test",
    resendUnsubscribe: false,
  });
  assert.doesNotMatch(testTemplate.html, /RESEND_UNSUBSCRIBE_URL/);
});

test("Resend webhook verification receives the exact raw payload and normalized headers", () => {
  let actual;
  const fakeResend = {
    webhooks: {
      verify(options) {
        actual = options;
        return { type: "email.received" };
      },
    },
  };
  const event = verifyResendWebhook(
    Buffer.from('{"type":"email.received"}'),
    {
      "svix-id": "evt_1",
      "svix-timestamp": "1700000000",
      "svix-signature": "v1,test",
    },
    { webhookSecret: "test-secret", resend: fakeResend },
  );

  assert.equal(event.type, "email.received");
  assert.equal(actual.payload, '{"type":"email.received"}');
  assert.deepEqual(actual.headers, {
    id: "evt_1",
    timestamp: "1700000000",
    signature: "v1,test",
  });
});
