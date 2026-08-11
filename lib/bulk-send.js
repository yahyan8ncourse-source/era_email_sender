const { sendOne, resetTransporter } = require("./mailer");
const {
  getQuota,
  assertCanSend,
  recordSend,
  trimLog,
  buildSendSchedule,
  getMsUntilQuotaReset,
  interruptibleSleep,
} = require("./rate-limit");
const { updateJob, pauseJob, clearJob } = require("./send-job");

function safeEmit(onEvent, event) {
  if (!onEvent) return;
  try {
    onEvent(event);
  } catch {
    /* UI disconnected — worker keeps running */
  }
}

async function runBulkSend({
  pending,
  totalAll,
  subject,
  message,
  html,
  attachments,
  initialSent = 0,
  initialFailed = 0,
  onEvent,
  isCancelled,
}) {
  let sentOk = initialSent;
  let sentFail = initialFailed;
  let globalIndex = initialSent + initialFailed;
  let batchNumber = 0;
  let consecutiveFails = 0;

  const persist = (patch = {}) => {
    if (pending.length === 0 && patch.status !== "running") return;
    try {
      updateJob({
        status: "running",
        subject,
        message,
        html,
        attachments,
        pending: [...pending],
        sent: sentOk,
        failed: sentFail,
        total: totalAll,
        ...patch,
      });
    } catch {
      /* disk issue — continue sending */
    }
  };

  try {
    safeEmit(onEvent, {
      type: "queue",
      total: totalAll,
      pending: pending.length,
      maxPerHour: getQuota().maxPerHour,
      resumed: initialSent + initialFailed > 0,
      quota: getQuota(),
    });

    while (pending.length > 0 && !isCancelled()) {
      trimLog();
      const quota = getQuota();

      if (quota.remaining === 0) {
        const waitMs = getMsUntilQuotaReset();
        const waitMin = Math.max(1, Math.ceil(waitMs / 60000));
        persist({
          phase: "hourly_pause",
          phaseDetail: `Pause horaire (~${waitMin} min)`,
        });
        safeEmit(onEvent, {
          type: "hourly_pause",
          waitSec: Math.round(waitMs / 1000),
          waitMin,
          remaining: pending.length,
          sent: sentOk,
          total: totalAll,
          quota: getQuota(),
        });
        const stopped = await interruptibleSleep(waitMs, isCancelled);
        if (stopped) break;
        trimLog();
        continue;
      }

      const batchSize = Math.min(pending.length, quota.remaining, quota.maxPerHour);
      const batch = pending.splice(0, batchSize);
      const schedule = buildSendSchedule(batch.length);
      batchNumber += 1;

      persist({
        phase: "batch",
        phaseDetail: `Lot ${batchNumber} — ${batch.length} email(s)`,
      });

      safeEmit(onEvent, {
        type: "batch_start",
        batch: batchNumber,
        batchSize: batch.length,
        remaining: pending.length,
        sent: sentOk,
        total: totalAll,
        windowMinutes: schedule.totalMinutes,
        gapsSec: schedule.gaps.map((ms) => Math.round(ms / 1000)),
        quota: getQuota(),
      });

      for (let i = 0; i < batch.length; i++) {
        if (isCancelled()) {
          pending.unshift(...batch.slice(i));
          break;
        }

        const to = batch[i];
        let result;
        try {
          assertCanSend(1);
          const info = await sendOne({ to, subject, message, html, attachments });
          recordSend(1);
          result = { to, ok: true, messageId: info.messageId };
          sentOk += 1;
          consecutiveFails = 0;
        } catch (err) {
          result = { to, ok: false, error: err.message };
          sentFail += 1;
          consecutiveFails += 1;
          if (consecutiveFails >= 5) {
            resetTransporter();
            consecutiveFails = 0;
          }
        }

        globalIndex += 1;
        persist({
          phase: "sending",
          phaseDetail: `${globalIndex}/${totalAll}`,
          lastResult: result,
        });

        safeEmit(onEvent, {
          type: "progress",
          current: globalIndex,
          total: totalAll,
          sent: sentOk,
          failed: sentFail,
          pending: pending.length,
          batch: batchNumber,
          batchCurrent: i + 1,
          batchTotal: batch.length,
          result,
          quota: getQuota(),
        });

        if (isCancelled()) {
          pending.unshift(...batch.slice(i + 1));
          break;
        }

        if (i < batch.length - 1) {
          const delayMs = schedule.gaps[i];
          persist({
            phase: "waiting",
            phaseDetail: `Attente ${Math.round(delayMs / 1000)} s`,
          });
          safeEmit(onEvent, {
            type: "waiting",
            current: globalIndex,
            total: totalAll,
            batch: batchNumber,
            waitSec: Math.round(delayMs / 1000),
            nextIndex: globalIndex + 1,
          });
          const stopped = await interruptibleSleep(delayMs, isCancelled);
          if (stopped) {
            pending.unshift(...batch.slice(i + 1));
            break;
          }
        }
      }
    }

    return {
      sent: sentOk,
      failed: sentFail,
      remaining: pending.length,
      batches: batchNumber,
      cancelled: isCancelled(),
    };
  } catch (err) {
    if (pending.length > 0) {
      pauseJob({
        subject,
        message,
        html,
        attachments,
        pending,
        sent: sentOk,
        failed: sentFail,
        total: totalAll,
        phaseDetail: err.message,
      });
    }
    safeEmit(onEvent, { type: "error", error: err.message });
    throw err;
  }
}

module.exports = { runBulkSend, clearJob };
