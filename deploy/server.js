const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { sendOne, parseEmails, getConfig } = require("./lib/mailer");
const { getQuota, assertCanSend, recordSend, trimLog } = require("./lib/rate-limit");

const LOG_FILE = path.join(__dirname, "boot.log");

function logBoot(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    /* ignore */
  }
  console.log(msg);
}

process.on("uncaughtException", (err) => logBoot(`FATAL: ${err.stack || err.message}`));
process.on("unhandledRejection", (err) => logBoot(`REJECT: ${err.stack || err}`));

const APP_PASSWORD = (process.env.APP_PASSWORD || "").trim();
const AUTH_ENABLED = APP_PASSWORD.length > 0;
const BASE = (process.env.BASE_PATH || "").replace(/\/$/, "");
const PUBLIC_DIR = path.join(__dirname, "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

function normalizePath(pathname) {
  if (BASE && (pathname === BASE || pathname.startsWith(`${BASE}/`))) {
    const rest = pathname.slice(BASE.length);
    return rest || "/";
  }
  if (pathname === "/era-email-sender" || pathname.startsWith("/era-email-sender/")) {
    const rest = pathname.slice("/era-email-sender".length);
    return rest || "/";
  }
  return pathname;
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function requireAuth(req, res) {
  if (!AUTH_ENABLED) return true;
  const token = String(req.headers["x-app-password"] || "").trim();
  if (token === APP_PASSWORD) return true;
  json(res, 401, { error: "Mot de passe incorrect." });
  return false;
}

function serveStatic(req, res, relPath) {
  const safe = path.normalize(relPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe === "/" ? "index.html" : safe);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    json(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    res.end(data);
  });
}

async function handleSendBulk(req, res) {
  try {
    const raw = await readBody(req);
    const body = JSON.parse(raw || "{}");
    const { recipients: rawRecipients, subject, message } = body;

    if (!rawRecipients || !subject || !message) {
      return json(res, 400, { error: "Destinataires, objet et message requis." });
    }

    const { valid, invalid } = parseEmails(rawRecipients);
    const max = Number(process.env.MAX_RECIPIENTS || 50);
    const quota = getQuota();

    if (!valid.length) {
      return json(res, 400, { error: "Aucune adresse email valide." });
    }
    if (valid.length > max) {
      return json(res, 400, { error: `Maximum ${max} destinataires par envoi.` });
    }
    if (valid.length > quota.remaining) {
      return json(res, 429, {
        error: `Limite : ${quota.maxPerHour} emails/heure. Vous avez ${quota.remaining} restant(s) mais ${valid.length} destinataire(s). Réduisez la liste ou attendez.`,
        quota: getQuota(),
      });
    }

    res.writeHead(200, {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    for (const email of invalid) {
      res.write(`${JSON.stringify({ type: "invalid", email })}\n`);
    }

    const toSend = valid.slice(0, quota.remaining);
    const results = [];

    for (let i = 0; i < toSend.length; i++) {
      const to = toSend[i];
      try {
        assertCanSend(1);
        const info = await sendOne({ to, subject, message });
        recordSend(1);
        results.push({ to, ok: true, messageId: info.messageId });
      } catch (err) {
        results.push({ to, ok: false, error: err.message });
      }

      res.write(
        `${JSON.stringify({
          type: "progress",
          current: i + 1,
          total: toSend.length,
          result: results[results.length - 1],
          quota: getQuota(),
        })}\n`
      );

      if (i < toSend.length - 1) {
        const delay = getConfig().delayMs;
        await new Promise((r) => setTimeout(r, delay));
      }
    }

    const sent = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    res.write(
      `${JSON.stringify({ type: "done", sent, failed, total: toSend.length, quota: getQuota() })}\n`
    );
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      const code = err.message.includes("Limite") ? 429 : 500;
      return json(res, code, { error: err.message, quota: getQuota() });
    }
    res.write(`${JSON.stringify({ type: "error", error: err.message })}\n`);
    res.end();
  }
}

async function handleRequest(req, res) {
  try {
    const host = req.headers.host || "localhost";
    const parsed = new URL(req.url, `http://${host}`);
    const pathname = normalizePath(parsed.pathname);

    if (req.method === "GET" && pathname === "/api/health") {
      return json(res, 200, { ok: true, app: "era-email-sender", node: process.version });
    }

    if (req.method === "GET" && pathname === "/api/config") {
      if (!requireAuth(req, res)) return;
      const cfg = getConfig();
      return json(res, 200, {
        from: cfg.from,
        fromName: cfg.fromName,
        maxRecipients: Number(process.env.MAX_RECIPIENTS || 50),
        quota: getQuota(),
      });
    }

    if (req.method === "GET" && pathname === "/api/quota") {
      if (!requireAuth(req, res)) return;
      return json(res, 200, getQuota());
    }

    if (req.method === "POST" && pathname === "/api/login") {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}");
      if (!AUTH_ENABLED) {
        return json(res, 200, { ok: true, authRequired: false });
      }
      const attempt = String(body.password || "").trim();
      if (attempt === APP_PASSWORD) {
        return json(res, 200, { ok: true, authRequired: true });
      }
      return json(res, 401, { ok: false, error: "Mot de passe incorrect." });
    }

    if (req.method === "POST" && pathname === "/api/send-bulk") {
      if (!requireAuth(req, res)) return;
      return handleSendBulk(req, res);
    }

    if (req.method === "GET") {
      return serveStatic(req, res, pathname);
    }

    json(res, 404, { error: "Not found" });
  } catch (err) {
    logBoot(`REQ ERR: ${err.message}`);
    json(res, 500, { error: err.message || "Server error" });
  }
}

trimLog();

const server = http.createServer(handleRequest);

if (require.main === module) {
  const port = Number(process.env.PORT);
  if (!port) {
    logBoot("ERROR: PORT is not set by cPanel/Passenger");
    process.exit(1);
  }

  server.listen(port, () => {
    logBoot(`ERA Email Sender started on port ${port} (Node ${process.version})`);
  });
  server.on("error", (err) => {
    logBoot(`LISTEN ERR: ${err.message}`);
    process.exit(1);
  });
}

module.exports = server;
