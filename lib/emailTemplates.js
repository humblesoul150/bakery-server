const BRAND = {
  background: "#f5f0e7",
  surface: "#ffffff",
  foreground: "#30231d",
  muted: "#6f655a",
  olive: "#48513d",
  bronze: "#b38a5e",
  border: "#ded5c7",
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeLink(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

function frame({ preheader, title, content, footer = "" }) {
  const preview = escapeHtml(preheader);
  const safeTitle = escapeHtml(title);
  const footerText = footer || "The SourDough Bakery";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><title>${safeTitle}</title></head>
<body style="margin:0;padding:0;background:${BRAND.background};color:${BRAND.foreground};font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;font-size:1px;color:${BRAND.background};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${preview}${"&nbsp;".repeat(32)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${BRAND.background};"><tr><td align="center" style="padding:28px 12px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;background:${BRAND.surface};border:1px solid ${BRAND.border};">
      <tr><td style="padding:26px 30px;border-bottom:1px solid ${BRAND.border};">
        <p style="margin:0;color:${BRAND.olive};font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:1.2;">The SourDough Bakery</p>
        <p style="margin:5px 0 0;color:${BRAND.muted};font-size:10px;letter-spacing:1.8px;text-transform:uppercase;">Made with patience in Kampala</p>
      </td></tr>
      <tr><td style="padding:30px;">${content}</td></tr>
      <tr><td style="padding:20px 30px;border-top:1px solid ${BRAND.border};color:${BRAND.muted};font-size:12px;line-height:1.6;">${footerText}</td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

function button(label, href) {
  const url = safeLink(href);
  if (!url) return "";
  return `<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:24px 0;"><tr><td bgcolor="${BRAND.olive}" style="border-radius:4px;"><a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 22px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:bold;">${escapeHtml(label)}</a></td></tr></table>`;
}

function messageReceived({ name, reference, type, message, followUpText }) {
  const customOrder = type === "custom_order";
  const title = customOrder ? "We received your custom-order enquiry" : "We received your message";
  const content = `<h1 style="margin:0 0 18px;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:normal;line-height:1.2;">${escapeHtml(title)}</h1>
    <p style="margin:0 0 14px;font-size:16px;line-height:1.6;">Hello ${escapeHtml(name)},</p>
    <p style="margin:0 0 18px;color:${BRAND.muted};font-size:15px;line-height:1.7;">Thank you for reaching out. Your reference is <strong style="color:${BRAND.foreground};">${escapeHtml(reference)}</strong>.</p>
    ${customOrder ? `<p style="margin:0 0 18px;padding:14px;background:${BRAND.background};font-size:14px;line-height:1.6;">This is an enquiry, not a confirmed order. We will review the details and reply to discuss availability, pricing, and timing.</p>` : ""}
    ${message ? `<p style="margin:0 0 8px;font-size:13px;font-weight:bold;">Your message</p><p style="margin:0 0 18px;padding:14px;background:${BRAND.background};font-size:14px;line-height:1.7;">${escapeHtml(message)}</p>` : ""}
    <p style="margin:0;color:${BRAND.muted};font-size:14px;line-height:1.7;">${escapeHtml(followUpText || "You can reply to this email if you would like to add anything.")}</p>`;
  const text = `${title}\n\nHello ${name},\n\nThank you for reaching out. Your reference is ${reference}.${customOrder ? "\n\nThis is an enquiry, not a confirmed order. We will review the details and reply to discuss availability, pricing, and timing." : ""}${message ? `\n\nYour message:\n${message}` : ""}\n\n${followUpText || "You can reply to this email if you would like to add anything."}`;
  return { subject: `${title} · ${reference}`, html: frame({ preheader: `Your reference is ${reference}.`, title, content }), text };
}

function newsletterVerification({ confirmUrl }) {
  const title = "Confirm your bakery newsletter signup";
  const content = `<h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:normal;line-height:1.2;">One last step</h1>
    <p style="margin:0;color:${BRAND.muted};font-size:15px;line-height:1.7;">Please confirm that you want to receive occasional bakery news, new bakes, and offers by email.</p>
    ${button("Confirm subscription", confirmUrl)}
    <p style="margin:0;color:${BRAND.muted};font-size:13px;line-height:1.7;">If you did not sign up, you can ignore this email. You will not receive newsletter emails unless you confirm.</p>`;
  const text = `Please confirm your bakery newsletter signup:\n${confirmUrl}\n\nIf you did not sign up, ignore this email. You will not receive newsletter emails unless you confirm.`;
  return { subject: "Please confirm your bakery newsletter signup", html: frame({ preheader: "Confirm your email to join the bakery newsletter.", title, content }), text };
}

function newsletterWelcome({ preferencesUrl, unsubscribeUrl }) {
  const title = "Welcome to the bakery newsletter";
  const content = `<h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:normal;line-height:1.2;">A little good in your inbox</h1>
    <p style="margin:0 0 16px;color:${BRAND.muted};font-size:15px;line-height:1.7;">You are subscribed. We will send occasional notes about fresh bakes, bakery news, and special offers.</p>
    <p style="margin:0;color:${BRAND.muted};font-size:13px;line-height:1.7;">You can update your preferences or unsubscribe at any time.</p>
    ${preferencesUrl ? button("Manage preferences", preferencesUrl) : ""}
    ${unsubscribeUrl ? `<p style="margin:16px 0 0;color:${BRAND.muted};font-size:12px;line-height:1.6;"><a href="${escapeHtml(safeLink(unsubscribeUrl))}" style="color:${BRAND.olive};">Unsubscribe</a></p>` : ""}`;
  const text = `Welcome to the bakery newsletter.\n\nYou are subscribed to occasional notes about fresh bakes, bakery news, and special offers.${preferencesUrl ? `\n\nManage preferences: ${preferencesUrl}` : ""}${unsubscribeUrl ? `\n\nUnsubscribe: ${unsubscribeUrl}` : ""}`;
  return { subject: "Welcome to The SourDough Bakery newsletter", html: frame({ preheader: "Thanks for confirming your subscription.", title, content }), text };
}

function newsletterCampaign({
  title,
  intro,
  blocks = [],
  unsubscribeUrl,
  preferencesUrl,
  resendUnsubscribe = true,
}) {
  const rendered = blocks.map((block) => {
    if (block.type === "heading") {
      return `<h2 style="margin:26px 0 10px;font-family:Georgia,'Times New Roman',serif;font-size:23px;font-weight:normal;line-height:1.3;">${escapeHtml(block.text)}</h2>`;
    }
    if (block.type === "paragraph") {
      return `<p style="margin:0 0 16px;color:${BRAND.muted};font-size:15px;line-height:1.7;">${escapeHtml(block.text)}</p>`;
    }
    if (block.type === "button") {
      return button(block.label, block.url);
    }
    if (block.type === "image") {
      const url = safeLink(block.url);
      return url ? `<p style="margin:20px 0;"><img src="${escapeHtml(url)}" alt="${escapeHtml(block.alt || "")}" width="540" style="display:block;width:100%;max-width:540px;height:auto;border:0;"></p>` : "";
    }
    return "";
  }).join("");
  const unsubscribeHref = safeLink(unsubscribeUrl) || "{{{RESEND_UNSUBSCRIBE_URL}}}";
  const footerLinks = [
    preferencesUrl ? `<a href="${escapeHtml(safeLink(preferencesUrl))}" style="color:${BRAND.olive};">Preferences</a>` : "",
    unsubscribeUrl || resendUnsubscribe
      ? `<a href="${unsubscribeUrl ? escapeHtml(safeLink(unsubscribeUrl)) : unsubscribeHref}" style="color:${BRAND.olive};">Unsubscribe</a>`
      : "",
  ].filter(Boolean).join(" · ");
  const content = `<h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:30px;font-weight:normal;line-height:1.2;">${escapeHtml(title)}</h1>
    ${intro ? `<p style="margin:0 0 20px;color:${BRAND.muted};font-size:15px;line-height:1.7;">${escapeHtml(intro)}</p>` : ""}
    ${rendered}`;
  const textBlocks = blocks.map((block) => {
    if (block.type === "button") return `${block.label}: ${block.url}`;
    if (block.type === "image") return block.alt || "";
    return block.text || "";
  }).filter(Boolean).join("\n\n");
  return {
    html: frame({ preheader: intro || title, title, content, footer: `${footerLinks}<br>The SourDough Bakery · Kampala, Uganda` }),
    text: `${title}\n\n${intro || ""}\n\n${textBlocks}\n\nThe SourDough Bakery · Kampala, Uganda\n${preferencesUrl ? `Preferences: ${preferencesUrl}\n` : ""}${unsubscribeUrl || resendUnsubscribe ? `Unsubscribe: ${unsubscribeUrl || unsubscribeHref}` : ""}`,
  };
}

function orderStatus({ name, orderNumber, status, details, nextStep }) {
  const title = `Update on order ${orderNumber}`;
  const content = `<h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:28px;font-weight:normal;line-height:1.2;">${escapeHtml(status)}</h1>
    <p style="margin:0 0 16px;font-size:15px;line-height:1.7;">Hello ${escapeHtml(name)}, here is an update for order <strong>${escapeHtml(orderNumber)}</strong>.</p>
    <p style="margin:0 0 16px;padding:14px;background:${BRAND.background};font-size:14px;line-height:1.7;">${escapeHtml(details)}</p>
    <p style="margin:0;color:${BRAND.muted};font-size:14px;line-height:1.7;">${escapeHtml(nextStep)}</p>`;
  const text = `Hello ${name},\n\n${status} for order ${orderNumber}.\n\n${details}\n\n${nextStep}`;
  return { subject: `${status} · Order ${orderNumber}`, html: frame({ preheader: `${status} for order ${orderNumber}.`, title, content }), text };
}

module.exports = {
  BRAND,
  escapeHtml,
  frame,
  messageReceived,
  newsletterCampaign,
  newsletterVerification,
  newsletterWelcome,
  orderStatus,
};
