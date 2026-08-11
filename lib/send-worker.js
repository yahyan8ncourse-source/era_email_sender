const { getQuota } = require("./rate-limit");
const { runBulkSend, clearJob } = require("./bulk-send");
const {
  loadJob,
  createJob,
  getJobSummary,
  pauseJob,
  updateJob,
} = require("./send-job");

let workerPromise = null;
let userStopRequested = false;
let recentEvents = [];
let lastDone = null;
let liveProgress = null;
const MAX_EVENTS = 50;

function isWorkerRunning() {
  return workerPromise !== null;
}

function resetLiveProgress(data) {
  liveProgress = {
    sent: data.sent || 0,
    failed: data.failed || 0,
    pending: Array.isArray(data.pending) ? data.pending.length : data.pending || 0,
    total: data.total || 0,
    current: (data.sent || 0) + (data.failed || 0),
    phase: "starting",
    phaseDetail: "Démarrage…",
    lastResult: null,
  };
}

function applyLiveFromEvent(event) {
  if (!liveProgress) return;
  if (event.type === "queue") {
    liveProgress.pending = event.pending;
    liveProgress.total = event.total;
    liveProgress.phaseDetail = `${liveProgress.current}/${event.total}`;
  }
  if (event.type === "progress") {
    liveProgress.sent = event.sent;
    liveProgress.failed = event.failed;
    liveProgress.pending = event.pending;
    liveProgress.total = event.total;
    liveProgress.current = event.current;
    liveProgress.phase = "sending";
    liveProgress.phaseDetail = `${event.current}/${event.total}`;
    liveProgress.lastResult = event.result;
  }
  if (event.type === "waiting") {
    liveProgress.phase = "waiting";
    liveProgress.phaseDetail = `${event.current}/${event.total} · attente ${event.waitSec}s`;
  }
  if (event.type === "hourly_pause") {
    liveProgress.phase = "hourly_pause";
    liveProgress.phaseDetail = `Pause ~${event.waitMin} min · ${event.sent}/${event.total}`;
    liveProgress.sent = event.sent;
    liveProgress.pending = event.remaining;
  }
  if (event.type === "batch_start") {
    liveProgress.phase = "batch";
    liveProgress.phaseDetail = `Lot ${event.batch} · ${event.sent}/${event.total}`;
  }
}

function pushEvent(event) {
  recentEvents.push({ ...event, at: Date.now() });
  if (recentEvents.length > MAX_EVENTS) {
    recentEvents = recentEvents.slice(-MAX_EVENTS);
  }
  applyLiveFromEvent(event);
}

function getWorkerStatus() {
  const job = getJobSummary();
  const base = {
    ...job,
    workerRunning: isWorkerRunning(),
    quota: getQuota(),
    recentEvents: recentEvents.slice(-20),
  };

  if (isWorkerRunning() && liveProgress) {
    return {
      ...base,
      active: true,
      status: "running",
      running: true,
      sent: liveProgress.sent,
      failed: liveProgress.failed,
      pending: liveProgress.pending,
      total: liveProgress.total,
      current: liveProgress.current,
      phase: liveProgress.phase,
      phaseDetail: liveProgress.phaseDetail,
      lastResult: liveProgress.lastResult,
    };
  }

  if (!job.active && lastDone) {
    return {
      active: false,
      running: false,
      status: "done",
      workerRunning: false,
      sent: lastDone.sent,
      failed: lastDone.failed,
      total: lastDone.total,
      pending: 0,
      current: lastDone.sent + lastDone.failed,
      phase: "done",
      phaseDetail: "Terminé",
      quota: getQuota(),
      recentEvents: recentEvents.slice(-20),
    };
  }

  return {
    ...base,
    current: (base.sent || 0) + (base.failed || 0),
  };
}

function requestStop() {
  userStopRequested = true;
}

async function runWorker(jobData) {
  userStopRequested = false;
  recentEvents = [];
  resetLiveProgress(jobData);

  const pending = [...jobData.pending];
  const attachments = jobData.attachments || [];

  try {
    const outcome = await runBulkSend({
      pending,
      totalAll: jobData.total,
      subject: jobData.subject,
      message: jobData.message,
      html: jobData.html,
      attachments,
      initialSent: jobData.sent || 0,
      initialFailed: jobData.failed || 0,
      onEvent: pushEvent,
      isCancelled: () => userStopRequested,
    });

    if (outcome.cancelled && outcome.remaining > 0) {
      pauseJob({
        subject: jobData.subject,
        message: jobData.message,
        html: jobData.html,
        attachments,
        pending,
        sent: outcome.sent,
        failed: outcome.failed,
        total: jobData.total,
      });
      pushEvent({
        type: "paused",
        sent: outcome.sent,
        failed: outcome.failed,
        total: jobData.total,
        remaining: outcome.remaining,
      });
      return outcome;
    }

    lastDone = {
      sent: outcome.sent,
      failed: outcome.failed,
      total: jobData.total,
    };
    liveProgress = null;
    clearJob();
    pushEvent({
      type: "done",
      sent: outcome.sent,
      failed: outcome.failed,
      total: jobData.total,
      batches: outcome.batches,
    });
    return outcome;
  } catch (err) {
    pushEvent({ type: "error", error: err.message });
    throw err;
  }
}

function startWorker(jobData) {
  if (isWorkerRunning()) {
    throw new Error("Un envoi est déjà en cours.");
  }

  workerPromise = runWorker(jobData)
    .catch(() => {
      /* paused or saved in runWorker / runBulkSend */
    })
    .finally(() => {
      workerPromise = null;
      userStopRequested = false;
    });

  return workerPromise;
}

function startNewJob(payload) {
  lastDone = null;
  createJob(payload);
  return startWorker(payload);
}

function resumeWorker() {
  const job = loadJob();
  if (!job) {
    throw new Error("Aucun envoi à reprendre.");
  }
  lastDone = null;
  updateJob({ status: "running", phase: "starting", phaseDetail: "Reprise…" });
  return startWorker(job);
}

function resumeIfNeeded() {
  const job = loadJob();
  if (!job || isWorkerRunning()) return false;
  if (job.status !== "running") return false;
  startWorker(job);
  return true;
}

module.exports = {
  isWorkerRunning,
  getWorkerStatus,
  requestStop,
  startNewJob,
  resumeWorker,
  resumeIfNeeded,
};
