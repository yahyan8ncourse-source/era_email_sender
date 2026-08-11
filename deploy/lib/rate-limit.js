const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const LOG_FILE = path.join(DATA_DIR, "send-history.json");
const HOUR_MS = 60 * 60 * 1000;

function getMaxPerHour() {
  return Number(process.env.MAX_EMAILS_PER_HOUR || 5);
}

function getDelayMs() {
  const configured = Number(process.env.SEND_DELAY_MS || 0);
  if (configured > 0) return configured;
  const max = getMaxPerHour();
  return Math.ceil(HOUR_MS / max);
}

function readLog() {
  try {
    if (!fs.existsSync(LOG_FILE)) return [];
    const data = JSON.parse(fs.readFileSync(LOG_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeLog(entries) {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(LOG_FILE, JSON.stringify(entries, null, 2));
  } catch {
    /* quota file optional on shared hosting */
  }
}

function recentSends() {
  const cutoff = Date.now() - HOUR_MS;
  return readLog().filter((ts) => ts >= cutoff);
}

function getQuota() {
  const maxPerHour = getMaxPerHour();
  const sent = recentSends().length;
  const remaining = Math.max(0, maxPerHour - sent);
  const timestamps = recentSends();
  const resetAt =
    timestamps.length > 0 ? timestamps[0] + HOUR_MS : Date.now();

  return {
    maxPerHour,
    sent,
    remaining,
    resetAt,
    delayMs: getDelayMs(),
    delayMinutes: Math.round(getDelayMs() / 60000),
  };
}

function assertCanSend(count = 1) {
  const quota = getQuota();
  if (count > quota.remaining) {
    const waitMin = Math.ceil((quota.resetAt - Date.now()) / 60000);
    throw new Error(
      `Limite atteinte : ${quota.maxPerHour} emails/heure. ` +
        `Restants : ${quota.remaining}. Réessayez dans ~${Math.max(waitMin, 1)} min.`
    );
  }
}

function recordSend(count = 1) {
  const entries = readLog();
  const cutoff = Date.now() - HOUR_MS;
  const kept = entries.filter((ts) => ts >= cutoff);
  const now = Date.now();
  for (let i = 0; i < count; i++) kept.push(now);
  writeLog(kept);
}

function trimLog() {
  try {
    const cutoff = Date.now() - HOUR_MS;
    writeLog(readLog().filter((ts) => ts >= cutoff));
  } catch {
    /* ignore */
  }
}

module.exports = {
  getQuota,
  assertCanSend,
  recordSend,
  trimLog,
  getDelayMs,
};
