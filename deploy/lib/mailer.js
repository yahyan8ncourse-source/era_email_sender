const { sendMail } = require("./smtp");

function getConfig() {
  const pass = process.env.SMTP_PASS;
  if (!pass) {
    throw new Error("SMTP_PASS is not configured.");
  }

  return {
    authUser: process.env.SMTP_USER || "_mainaccount@acci-dz.com",
    from: process.env.SMTP_FROM || "accidzco@acci-dz.com",
    fromName: process.env.SMTP_FROM_NAME || "ERA Formation",
    pass,
    host: process.env.SMTP_HOST || "mail.acci-dz.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== "false",
    delayMs: Number(process.env.SEND_DELAY_MS || 0) || require("./rate-limit").getDelayMs(),
  };
}

function buildHtml(subject, message) {
  const text = message.trim();
  const subj = subject.trim();

  if (
    subj === "Test Email" &&
    text === "This is a test email from ERA Formation (acci-dz.com)."
  ) {
    return "<h2>Test Email</h2><p>This is a test email from <strong>ERA Formation</strong> (acci-dz.com).</p>";
  }

  const body = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
  const safeSubj = subj
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<h2>${safeSubj}</h2><p>${body}</p>`;
}

async function sendOne({ to, subject, message }) {
  const cfg = getConfig();
  const text = message.trim();
  const subj = subject.trim();

  const info = await sendMail({
    host: cfg.host,
    port: cfg.port,
    user: cfg.authUser,
    pass: cfg.pass,
    from: cfg.from,
    fromName: cfg.fromName,
    to,
    subject: subj,
    text,
    html: buildHtml(subj, text),
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

module.exports = {
  getConfig,
  sendOne,
  parseEmails,
  buildHtml,
};
