const fs = require("fs");
const path = require("path");

const HOUR_MS = 60 * 60 * 1000;

function getDataDir() {
  return process.env.DATA_DIR || path.join(__dirname, "..", "data");
}

function getLogFile() {
  return path.join(getDataDir(), "send-history.json");
}

function getMaxPerHour() {
  return Number(process.env.MAX_EMAILS_PER_HOUR || 85);
}

function getDelayBoundsMs() {
  const minSec = Number(process.env.SEND_DELAY_MIN_SEC || 0);
  const maxSec = Number(process.env.SEND_DELAY_MAX_SEC || 0);

  if (minSec > 0 && maxSec >= minSec) {
    return { minMs: minSec * 1000, maxMs: maxSec * 1000 };
  }

  const max = getMaxPerHour();
  const avgMs = HOUR_MS / max;
  return {
    minMs: Math.floor(avgMs * 0.5),
    maxMs: Math.floor(avgMs * 1.5),
  };
}

function getRandomDelayMs() {
  const fixed = Number(process.env.SEND_DELAY_MS || 0);
  if (fixed > 0) return fixed;

  const { minMs, maxMs } = getDelayBoundsMs();
  return Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
}

/** Random gaps between emails, decided once at batch start and spread across the hour. */
function buildSendSchedule(count, maxPerHour = getMaxPerHour()) {
  if (count <= 1) {
    return { gaps: [], windowMs: 0, totalMinutes: 0 };
  }

  const fixed = Number(process.env.SEND_DELAY_MS || 0);
  if (fixed > 0) {
    const gaps = Array(count - 1).fill(fixed);
    return {
      gaps,
      windowMs: fixed * gaps.length,
      totalMinutes: Math.round((fixed * gaps.length) / 60000),
    };
  }

  const windowMs = Math.round(HOUR_MS * (count / maxPerHour));
  const gapCount = count - 1;
  const weights = Array.from({ length: gapCount }, () => Math.random() + 0.2);
  const sum = weights.reduce((a, b) => a + b, 0);
  const gaps = weights.map((w) => Math.max(1000, Math.round((w / sum) * windowMs)));
  const total = gaps.reduce((a, b) => a + b, 0);
  gaps[gaps.length - 1] += windowMs - total;

  return {
    gaps,
    windowMs,
    totalMinutes: Math.round(windowMs / 60000),
  };
}

function getDelayMs() {
  const fixed = Number(process.env.SEND_DELAY_MS || 0);
  if (fixed > 0) return fixed;
  const { minMs, maxMs } = getDelayBoundsMs();
  return Math.round((minMs + maxMs) / 2);
}

function interruptibleSleep(ms, isCancelled) {
  return new Promise((resolve) => {
    const step = 200;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += step;
      if (isCancelled() || elapsed >= ms) {
        clearInterval(timer);
        resolve(Boolean(isCancelled()));
      }
    }, step);
  });
}

function readLog() {
  try {
    const logFile = getLogFile();
    if (!fs.existsSync(logFile)) return [];
    const data = JSON.parse(fs.readFileSync(logFile, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeLog(entries) {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(getLogFile(), JSON.stringify(entries, null, 2));
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
  const { minMs, maxMs } = getDelayBoundsMs();

  return {
    maxPerHour,
    sent,
    remaining,
    resetAt,
    delayMs: getDelayMs(),
    delayMinutes: Math.round(getDelayMs() / 60000),
    delayMinSec: Math.round(minMs / 1000),
    delayMaxSec: Math.round(maxMs / 1000),
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

function getMsUntilQuotaReset() {
  const quota = getQuota();
  if (quota.remaining > 0) return 0;
  return Math.max(1000, quota.resetAt - Date.now());
}

async function waitForQuotaReset(isCancelled) {
  const waitMs = getMsUntilQuotaReset();
  if (waitMs <= 0) return false;
  return interruptibleSleep(waitMs, isCancelled);
}

function trimLog() {
  const cutoff = Date.now() - HOUR_MS;
  writeLog(readLog().filter((ts) => ts >= cutoff));
}

module.exports = {
  getQuota,
  assertCanSend,
  recordSend,
  trimLog,
  getDelayMs,
  getRandomDelayMs,
  buildSendSchedule,
  getMsUntilQuotaReset,
  waitForQuotaReset,
  interruptibleSleep,
};
