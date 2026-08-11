const fs = require("fs");
const path = require("path");

const DEFAULTS = {
  SMTP_HOST: "mail.acci-dz.com",
  SMTP_PORT: "465",
  SMTP_SECURE: "true",
  SMTP_USER: "_mainaccount@acci-dz.com",
  SMTP_PASS: "!.Ah%Z-775VzK3nf",
  SMTP_FROM: "accidzco@acci-dz.com",
  SMTP_FROM_NAME: "ERA Formation",
  SMTP_REPLY_TO: "B.bachir-eraforma@acci-dz.com,s.ammi@eraforma.com",
  MAX_RECIPIENTS: "10000",
  MAX_EMAILS_PER_HOUR: "85",
};

function getEnvPath() {
  return process.env.ENV_FILE || path.join(process.cwd(), ".env");
}

function parseEnv(content) {
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    result[key] = val;
  }
  return result;
}

function readEnvFile() {
  const envPath = getEnvPath();
  if (!fs.existsSync(envPath)) return { ...DEFAULTS };
  return { ...DEFAULTS, ...parseEnv(fs.readFileSync(envPath, "utf8")) };
}

function applyToProcess(values) {
  for (const [key, val] of Object.entries(values)) {
    if (key === "APP_PASSWORD") continue;
    if (val !== undefined && val !== null) process.env[key] = String(val);
  }
  delete process.env.APP_PASSWORD;
  delete process.env.SEND_DELAY_MS;
  delete process.env.SEND_DELAY_MIN_SEC;
  delete process.env.SEND_DELAY_MAX_SEC;
}

function writeEnvFile(values) {
  const envPath = getEnvPath();
  const merged = { ...readEnvFile(), ...values };
  delete merged.APP_PASSWORD;
  delete merged.SEND_DELAY_MS;
  delete merged.SEND_DELAY_MIN_SEC;
  delete merged.SEND_DELAY_MAX_SEC;
  const lines = [
    "# ERA Formation — configuration email",
    `SMTP_HOST=${merged.SMTP_HOST}`,
    `SMTP_PORT=${merged.SMTP_PORT}`,
    `SMTP_SECURE=${merged.SMTP_SECURE}`,
    `SMTP_USER=${merged.SMTP_USER}`,
    `SMTP_PASS=${merged.SMTP_PASS}`,
    `SMTP_FROM=${merged.SMTP_FROM}`,
    `SMTP_FROM_NAME=${merged.SMTP_FROM_NAME}`,
    `SMTP_REPLY_TO=${merged.SMTP_REPLY_TO}`,
    "",
    `MAX_RECIPIENTS=${merged.MAX_RECIPIENTS}`,
    `MAX_EMAILS_PER_HOUR=${merged.MAX_EMAILS_PER_HOUR}`,
    "",
  ];
  const dir = path.dirname(envPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(envPath, lines.join("\n"), "utf8");
  applyToProcess(merged);
}

function reloadEnv() {
  const values = readEnvFile();
  delete values.APP_PASSWORD;
  applyToProcess(values);
  return values;
}

function isSmtpReady() {
  const pass = (process.env.SMTP_PASS || "").trim();
  return pass.length > 0 && pass !== "your-password-here";
}

function getSettingsForClient() {
  const values = readEnvFile();
  const pass = values.SMTP_PASS || "";
  return {
    smtpHost: values.SMTP_HOST,
    smtpPort: Number(values.SMTP_PORT || 465),
    smtpSecure: values.SMTP_SECURE !== "false",
    smtpUser: values.SMTP_USER,
    smtpFrom: values.SMTP_FROM,
    smtpFromName: values.SMTP_FROM_NAME,
    smtpReplyTo: values.SMTP_REPLY_TO,
    smtpPass: pass,
    smtpReady: isSmtpReady(),
  };
}

function updateSettings(body) {
  const updates = {};
  if (body.smtpHost) updates.SMTP_HOST = String(body.smtpHost).trim();
  if (body.smtpPort) updates.SMTP_PORT = String(body.smtpPort).trim();
  if (body.smtpSecure !== undefined) updates.SMTP_SECURE = body.smtpSecure ? "true" : "false";
  if (body.smtpUser) updates.SMTP_USER = String(body.smtpUser).trim();
  if (body.smtpFrom) updates.SMTP_FROM = String(body.smtpFrom).trim();
  if (body.smtpFromName) updates.SMTP_FROM_NAME = String(body.smtpFromName).trim();
  if (body.smtpReplyTo !== undefined) {
    updates.SMTP_REPLY_TO = String(body.smtpReplyTo).trim();
  }
  if (body.smtpPass !== undefined && body.smtpPass !== "") {
    updates.SMTP_PASS = String(body.smtpPass);
  }
  writeEnvFile(updates);
}

module.exports = {
  getEnvPath,
  readEnvFile,
  writeEnvFile,
  reloadEnv,
  isSmtpReady,
  getSettingsForClient,
  updateSettings,
  DEFAULTS,
};
