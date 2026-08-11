const express = require("express");
const path = require("path");
const { parseEmails, getConfig, resetTransporter } = require("./lib/mailer");
const { getQuota, trimLog } = require("./lib/rate-limit");
const {
  isWorkerRunning,
  getWorkerStatus,
  requestStop,
  startNewJob,
  resumeWorker,
  resumeIfNeeded,
} = require("./lib/send-worker");
const { loadJob, clearJob } = require("./lib/send-job");
const envFile = require("./lib/env-file");

const app = express();

function isAuthEnabled() {
  return (process.env.APP_PASSWORD || "").trim().length > 0;
}
const BASE = (process.env.BASE_PATH || "").replace(/\/$/, "");

function getPublicDir() {
  return process.env.PUBLIC_DIR || path.join(__dirname, "public");
}

function route(pathname) {
  return `${BASE}${pathname}`;
}

app.use(express.json({ limit: "25mb" }));

if (BASE) {
  app.get(BASE, (_req, res) => res.redirect(`${BASE}/`));
}

app.get(route("/api/health"), (_req, res) => {
  res.json({ ok: true, app: "era-email-sender" });
});

app.use(BASE || "/", express.static(getPublicDir()));

function requireAuth(req, res, next) {
  if (!isAuthEnabled()) return next();
  const token = String(req.headers["x-app-password"] || "").trim();
  const expected = (process.env.APP_PASSWORD || "").trim();
  if (token === expected) return next();
  return res.status(401).json({ error: "Mot de passe incorrect." });
}

app.get(route("/api/config"), requireAuth, (_req, res) => {
  try {
    let from = process.env.SMTP_FROM || "accidzco@acci-dz.com";
    let fromName = process.env.SMTP_FROM_NAME || "ERA Formation";
    try {
      const cfg = getConfig();
      from = cfg.from;
      fromName = cfg.fromName;
    } catch {
      /* SMTP may not be configured yet */
    }
    res.json({
      from,
      fromName,
      maxRecipients: Number(process.env.MAX_RECIPIENTS || 10000),
      quota: getQuota(),
      smtpReady: envFile.isSmtpReady(),
      pausedJob: getWorkerStatus(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(route("/api/settings"), (_req, res) => {
  try {
    res.json(envFile.getSettingsForClient());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post(route("/api/settings"), (req, res) => {
  try {
    envFile.updateSettings(req.body);
    resetTransporter();
    res.json({ ok: true, smtpReady: envFile.isSmtpReady() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get(route("/api/quota"), requireAuth, (_req, res) => {
  res.json(getQuota());
});

app.get(route("/api/send-job"), requireAuth, (_req, res) => {
  res.json(getWorkerStatus());
});

app.get(route("/api/send-status"), requireAuth, (_req, res) => {
  res.json(getWorkerStatus());
});

app.post(route("/api/send-stop"), requireAuth, (_req, res) => {
  if (!isWorkerRunning() && !loadJob()) {
    return res.json({ ok: true, message: "Aucun envoi actif." });
  }
  requestStop();
  res.json({ ok: true, message: "Arrêt demandé…" });
});

app.delete(route("/api/send-job"), requireAuth, (_req, res) => {
  requestStop();
  setTimeout(() => {
    clearJob();
  }, 500);
  res.json({ ok: true });
});

app.post(route("/api/send-bulk"), requireAuth, async (req, res) => {
  try {
    if (!envFile.isSmtpReady()) {
      return res.status(400).json({
        error: "Mot de passe SMTP manquant. Ouvrez Paramètres et enregistrez la configuration.",
      });
    }

    if (isWorkerRunning()) {
      return res.status(409).json({
        error: "Un envoi est déjà en cours.",
        job: getWorkerStatus(),
      });
    }

    const resume = Boolean(req.body.resume);

    if (resume) {
      if (!loadJob()) {
        return res.status(404).json({ error: "Aucun envoi en pause à reprendre." });
      }
      resumeWorker();
      return res.json({ ok: true, resumed: true, job: getWorkerStatus() });
    }

    if (loadJob()) {
      return res.status(409).json({
        error: "Un envoi est en pause. Reprenez-le ou abandonnez-le avant d'en lancer un nouveau.",
        job: getWorkerStatus(),
      });
    }

    const { recipients: raw, subject, message, html, attachments } = req.body;
    if (!raw || !subject || (!message && !html)) {
      return res.status(400).json({ error: "Destinataires, objet et message requis." });
    }

    const { valid, invalid } = parseEmails(raw);
    const maxList = Number(process.env.MAX_RECIPIENTS || 10000);

    if (!valid.length) {
      return res.status(400).json({ error: "Aucune adresse email valide." });
    }
    if (valid.length > maxList) {
      return res.status(400).json({ error: `Maximum ${maxList} destinataires par liste.` });
    }

    startNewJob({
      subject,
      message,
      html,
      attachments: attachments || [],
      pending: valid,
      sent: 0,
      failed: 0,
      total: valid.length,
    });

    res.json({
      ok: true,
      started: true,
      invalid,
      job: getWorkerStatus(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message, job: getWorkerStatus() });
  }
});

app.post(route("/api/login"), (req, res) => {
  if (!isAuthEnabled()) {
    return res.json({ ok: true, authRequired: false });
  }
  const attempt = String(req.body.password || "").trim();
  const expected = (process.env.APP_PASSWORD || "").trim();
  if (attempt === expected) {
    return res.json({ ok: true, authRequired: true });
  }
  return res.status(401).json({ ok: false, error: "Mot de passe incorrect." });
});

function startServer(port = 0, host = process.env.HOST || "127.0.0.1") {
  trimLog();
  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" ? addr.port : port;
      resumeIfNeeded();
      resolve({ server, port: actualPort });
    });
    server.on("error", reject);
  });
}

function logStartup(port) {
  const q = getQuota();
  console.log("");
  console.log("  ERA Email Sender");
  console.log("  Open: http://127.0.0.1:" + port + (BASE || ""));
  console.log(`  Rate limit: ${q.maxPerHour} emails/hour (~${q.delayMinutes} min between sends)`);
  console.log("");
  if (!process.env.SMTP_PASS) {
    console.warn("  Warning: SMTP_PASS is not set");
  }
}

if (require.main === module) {
  require("dotenv").config();
  const port = Number(process.env.PORT) || 8765;
  startServer(port)
    .then(({ port: p }) => logStartup(p))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = app;
module.exports.startServer = startServer;
module.exports.logStartup = logStartup;
