const fs = require("fs");
const path = require("path");

function getDataDir() {
  return process.env.DATA_DIR || path.join(__dirname, "..", "data");
}

function getJobFile() {
  return path.join(getDataDir(), "send-job.json");
}

function getAttachmentsFile() {
  return path.join(getDataDir(), "send-job-attachments.json");
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function loadJobRaw() {
  const job = readJson(getJobFile(), null);
  if (!job) return null;
  if (!job.attachments && fs.existsSync(getAttachmentsFile())) {
    job.attachments = readJson(getAttachmentsFile(), []);
  }
  return job;
}

function loadJob() {
  const job = loadJobRaw();
  if (!job || !Array.isArray(job.pending) || !job.pending.length) {
    return null;
  }
  return job;
}

function saveJob(job) {
  const meta = { ...job };
  const attachments = meta.attachments || [];
  delete meta.attachments;
  meta.updatedAt = Date.now();
  writeJsonAtomic(getJobFile(), meta);
  if (attachments.length) {
    writeJsonAtomic(getAttachmentsFile(), attachments);
  }
}

function clearJob() {
  for (const file of [getJobFile(), getAttachmentsFile()]) {
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {
      /* ignore */
    }
  }
}

function getJobSummary() {
  const job = loadJob();
  if (!job) {
    return { active: false, running: false, status: "idle" };
  }
  return {
    active: true,
    running: job.status === "running",
    status: job.status || "paused",
    subject: job.subject || "",
    pending: job.pending.length,
    sent: job.sent || 0,
    failed: job.failed || 0,
    total: job.total || job.pending.length + (job.sent || 0) + (job.failed || 0),
    phase: job.phase || "",
    phaseDetail: job.phaseDetail || "",
    updatedAt: job.updatedAt,
    lastResult: job.lastResult || null,
  };
}

function createJob(payload) {
  const job = {
    status: "running",
    subject: payload.subject,
    message: payload.message,
    html: payload.html,
    attachments: payload.attachments || [],
    pending: [...payload.pending],
    sent: payload.sent || 0,
    failed: payload.failed || 0,
    total: payload.total,
    phase: "starting",
    phaseDetail: "",
    lastResult: null,
  };
  saveJob(job);
  return job;
}

function updateJob(patch) {
  const job = loadJobRaw();
  if (!job) return null;
  Object.assign(job, patch);
  saveJob(job);
  return job;
}

function pauseJob(payload) {
  saveJob({
    status: "paused",
    subject: payload.subject,
    message: payload.message,
    html: payload.html,
    attachments: payload.attachments || [],
    pending: payload.pending,
    sent: payload.sent || 0,
    failed: payload.failed || 0,
    total: payload.total,
    phase: "paused",
    phaseDetail: "Arrêté par l'utilisateur",
    lastResult: payload.lastResult || null,
  });
}

module.exports = {
  loadJob,
  saveJob,
  clearJob,
  getJobSummary,
  createJob,
  updateJob,
  pauseJob,
};
