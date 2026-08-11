const nodemailer = require("nodemailer");
const { validateAttachments } = require("./attachments");
const { buildSendSchedule, interruptibleSleep } = require("./rate-limit");

function getConfig() {
  const pass = process.env.SMTP_PASS;
  if (!pass) {
    throw new Error("SMTP_PASS is not configured.");
  }

  return {
    authUser: process.env.SMTP_USER || "_mainaccount@acci-dz.com",
    from: process.env.SMTP_FROM || "accidzco@acci-dz.com",
    fromName: process.env.SMTP_FROM_NAME || "ERA Formation",
    replyTo:
      process.env.SMTP_REPLY_TO ||
      "B.bachir-eraforma@acci-dz.com,s.ammi@eraforma.com",
    pass,
    host: process.env.SMTP_HOST || "mail.acci-dz.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== "false",
    delayMs: Number(process.env.SEND_DELAY_MS || 0) || require("./rate-limit").getDelayMs(),
  };
}

let sharedTransporter = null;
let verifiedOnce = false;

function resetTransporter() {
  sharedTransporter = null;
  verifiedOnce = false;
}

function createTransporter() {
  const cfg = getConfig();
  if (sharedTransporter) return sharedTransporter;

  sharedTransporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: { user: cfg.authUser, pass: cfg.pass },
    tls: { minVersion: "TLSv1.2" },
  });

  return sharedTransporter;
}

async function ensureVerified() {
  if (verifiedOnce) return;
  const transporter = createTransporter();
  await transporter.verify();
  verifiedOnce = true;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function signatureText() {
  return ["", "--", "ERA Formation", "accidzco@acci-dz.com"].join("\n");
}

function signatureHtml() {
  return (
    '<p style="margin-top:20px;font-size:13px;color:#555">--<br>ERA Formation<br>' +
    '<a href="mailto:accidzco@acci-dz.com">accidzco@acci-dz.com</a></p>'
  );
}

function buildText(message) {
  return `${message.trim()}${signatureText()}`;
}

function buildHtml(message) {
  const text = message.trim();

  if (text === "This is a test email from ERA Formation (acci-dz.com).") {
    return [
      "<!DOCTYPE html>",
      '<html lang="fr"><head><meta charset="UTF-8"></head>',
      '<body style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;margin:0;padding:16px">',
      "<p>This is a test email from <strong>ERA Formation</strong> (acci-dz.com).</p>",
      signatureHtml(),
      "</body></html>",
    ].join("");
  }

  const body = escapeHtml(text).replace(/\n/g, "<br>");
  return wrapHtmlDocument(`<p>${body}</p>${signatureHtml()}`);
}

function wrapHtmlDocument(innerHtml) {
  return [
    "<!DOCTYPE html>",
    '<html lang="fr"><head><meta charset="UTF-8"></head>',
    '<body style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#222;margin:0;padding:16px">',
    innerHtml,
    "</body></html>",
  ].join("");
}

function wrapRichHtml(htmlContent) {
  const inner = String(htmlContent || "").trim();
  if (!inner) return buildHtml("");
  if (/<html[\s>]/i.test(inner)) {
    return inner.includes("ERA Formation") ? inner : inner.replace(/<\/body>/i, `${signatureHtml()}</body>`);
  }
  return wrapHtmlDocument(`${inner}${signatureHtml()}`);
}

function fromDomain(email) {
  const part = String(email).split("@")[1];
  return part || "acci-dz.com";
}

function parseReplyTo(raw, fallback, fromName) {
  const emails = String(raw || fallback)
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  if (!emails.length) {
    return { name: fromName, address: fallback };
  }
  if (emails.length === 1) {
    return { name: fromName, address: emails[0] };
  }
  return emails.map((address) => ({ name: fromName, address }));
}

async function sendOne({ to, subject, message, html, attachments }) {
  const cfg = getConfig();
  const subj = subject.trim();
  const plain = (message || stripHtml(html)).trim();
  const transporter = createTransporter();
  const mailAttachments = validateAttachments(attachments);

  if (!plain && !html) {
    throw new Error("Message vide.");
  }

  await ensureVerified();

  const domain = fromDomain(cfg.from);
  const replyTo = parseReplyTo(cfg.replyTo, cfg.from, cfg.fromName);
  const info = await transporter.sendMail({
    from: { name: cfg.fromName, address: cfg.from },
    sender: cfg.from,
    replyTo,
    returnPath: cfg.from,
    to,
    subject: subj,
    text: html ? `${stripHtml(html)}${signatureText()}` : buildText(plain),
    html: html ? wrapRichHtml(html) : buildHtml(plain),
    attachments: mailAttachments,
    envelope: {
      from: cfg.from,
      to,
    },
    headers: {
      "Auto-Submitted": "no",
      "X-Auto-Response-Suppress": "All",
      "X-Mailer": "ERA Formation Mailer",
    },
    messageId: `<${Date.now()}.${Math.random().toString(36).slice(2)}@${domain}>`,
  });

  return { messageId: info.messageId, response: info.response };
}

function parseEmails(raw) {
  const parts = raw
    .split(/[\n,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const valid = [];
  const invalid = [];

  for (const email of parts) {
    if (!emailRe.test(email)) {
      invalid.push(email);
      continue;
    }
    valid.push(email);
  }

  return { valid, invalid };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function sendBulk({ recipients, subject, message, html, attachments, onProgress }) {
  const results = [];
  const schedule = buildSendSchedule(recipients.length);

  for (let i = 0; i < recipients.length; i++) {
    const to = recipients[i];
    try {
      const info = await sendOne({ to, subject, message, html, attachments });
      results.push({ to, ok: true, messageId: info.messageId });
    } catch (err) {
      results.push({ to, ok: false, error: err.message });
    }

    if (onProgress) onProgress(i + 1, recipients.length, results[results.length - 1]);

    if (i < recipients.length - 1) {
      await interruptibleSleep(schedule.gaps[i], () => false);
    }
  }

  return results;
}

module.exports = {
  getConfig,
  createTransporter,
  sendOne,
  sendBulk,
  parseEmails,
  buildHtml,
  buildText,
  wrapRichHtml,
  resetTransporter,
};
