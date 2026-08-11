let appPassword = "";
let attachmentFiles = [];
let editorReady = false;

const $ = (sel) => document.querySelector(sel);
const loginScreen = $("#login-screen");
const app = $("#app");
const loginForm = $("#login-form");
const loginError = $("#login-error");

const MAX_ATTACHMENTS = 5;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

function headers() {
  const h = { "Content-Type": "application/json" };
  if (appPassword) h["X-App-Password"] = appPassword;
  return h;
}

function showToast(msg, type = "") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast ${type}`;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 3500);
}

function countRecipients(text) {
  const parts = text.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
  return parts.length;
}

function updateRecipientCount() {
  const n = countRecipients($("#recipients").value);
  $("#recipient-count").textContent = `${n} contact${n !== 1 ? "s" : ""}`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function renderAttachmentList() {
  const list = $("#attachment-list");
  list.innerHTML = "";
  attachmentFiles.forEach((file, index) => {
    const li = document.createElement("li");
    li.className = "attachment-item";
    li.innerHTML = `<span>📄 ${file.name} (${formatFileSize(file.size)})</span>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Retirer";
    btn.addEventListener("click", () => {
      attachmentFiles.splice(index, 1);
      renderAttachmentList();
    });
    li.appendChild(btn);
    list.appendChild(li);
  });
}

function readFileBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = String(reader.result).split(",")[1] || "";
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function attachmentsToPayload() {
  const out = [];
  for (const file of attachmentFiles) {
    out.push({
      filename: file.name,
      contentType: file.type || "application/octet-stream",
      content: await readFileBase64(file),
    });
  }
  return out;
}

function getEditorContent() {
  const ed = tinymce.get("message-editor");
  if (!ed) return { message: "", html: "" };
  return {
    message: ed.getContent({ format: "text" }).trim(),
    html: ed.getContent(),
  };
}

function initRichEditor() {
  if (editorReady || typeof tinymce === "undefined") return;

  tinymce.init({
    selector: "#message-editor",
    base_url: "vendor/tinymce",
    suffix: ".min",
    min_height: 520,
    autoresize_bottom_margin: 32,
    autoresize_min_height: 520,
    autoresize_max_height: 1400,
    resize: true,
    menubar: "file edit view insert format table tools",
    plugins:
      "lists link table image code autoresize advlist autolink charmap preview searchreplace visualblocks wordcount fullscreen quickbars",
    toolbar:
      "undo redo | blocks fontsize fontfamily | bold italic underline strikethrough | forecolor backcolor | " +
      "alignleft aligncenter alignright alignjustify | bullist numlist outdent indent | " +
      "link table image | tableprops tablerowprops tablecellprops tabledelete | " +
      "tableinsertrowbefore tableinsertrowafter tabledeleterow tableinsertcolbefore tableinsertcolafter tabledeletecol | " +
      "tablemergecells tablesplitcells | removeformat | fullscreen preview code",
    table_toolbar:
      "tableprops tablerowprops tablecellprops tabledelete | " +
      "tableinsertrowbefore tableinsertrowafter tabledeleterow | " +
      "tableinsertcolbefore tableinsertcolafter tabledeletecol | " +
      "tablemergecells tablesplitcells",
    table_appearance_options: true,
    table_advtab: true,
    table_cell_advtab: true,
    table_row_advtab: true,
    table_resize_bars: true,
    table_use_colgroups: true,
    object_resizing: "table,img",
    quickbars_selection_toolbar: "bold italic underline | forecolor backcolor | quicklink",
    quickbars_insert_toolbar: "image table hr",
    font_family_formats:
      "Arial=arial,helvetica,sans-serif; Helvetica=helvetica,arial,sans-serif; Georgia=georgia,palatino,serif; Times New Roman=times new roman,times,serif; Verdana=verdana,geneva,sans-serif; Tahoma=tahoma,arial,helvetica,sans-serif",
    fontsize_formats: "10px 11px 12px 13px 14px 16px 18px 20px 24px",
    line_height_formats: "1 1.15 1.5 1.75 2",
    paste_data_images: true,
    automatic_uploads: false,
    branding: false,
    promotion: false,
    content_style:
      "body { font-family: Arial, Helvetica, sans-serif; font-size: 14px; line-height: 1.6; color: #202124; margin: 20px 28px; } " +
      "table { border-collapse: collapse; width: 100%; max-width: 100%; } " +
      "table td, table th { border: 1px solid #dadce0; padding: 8px 12px; vertical-align: top; } " +
      "table th { background: #f8f9fa; font-weight: 600; }",
    table_default_styles: {
      width: "100%",
      "border-collapse": "collapse",
    },
    table_default_attributes: {
      border: "1",
    },
    setup(editor) {
      editor.on("init", () => {
        editorReady = true;
        if (!editor.getContent()) {
          editor.setContent("<p>Bonjour,</p><p><br></p><p>Cordialement,</p>");
        }
      });
    },
  });

  editorReady = true;
}

function getFormData() {
  const { message, html } = getEditorContent();
  return {
    subject: $("#subject").value.trim(),
    message,
    html,
  };
}

function updateQuotaDisplay(quota) {
  if (!quota) return;
  const resetMin = Math.max(0, Math.ceil((quota.resetAt - Date.now()) / 60000));
  $("#quota-display").textContent = `${quota.remaining}/${quota.maxPerHour} restants`;
  $("#quota-hint").textContent = quota.maxPerHour;
  const guideHint = $("#quota-hint-guide");
  if (guideHint) guideHint.textContent = quota.maxPerHour;
  const delayHint = $("#delay-hint");
  if (delayHint && quota.delayMinSec && quota.delayMaxSec) {
    delayHint.textContent = "60 min";
  }
  if (quota.remaining === 0) {
    $("#quota-display").textContent += ` (reset ~${resetMin} min)`;
  }
}

async function initApp() {
  try {
    const res = await fetch("api/config", { headers: headers() });
    if (res.status === 401) {
      showLogin();
      return;
    }
    const data = await res.json();
    $("#from-display").textContent = data.from;
    updateQuotaDisplay(data.quota);
    showApp();
    initRichEditor();
    if (!data.smtpReady) {
      showToast("Configurez le mot de passe SMTP dans Paramètres", "error");
      switchTab("settings");
    } else if (data.pausedJob?.workerRunning) {
      setSendControls(true);
      startSendPolling();
    } else if (data.pausedJob?.active) {
      updateResumeBanner(data.pausedJob);
    }
  } catch {
    showLogin();
  }
}

async function refreshQuota() {
  try {
    const res = await fetch("api/quota", { headers: headers() });
    const quota = await res.json();
    updateQuotaDisplay(quota);
    return quota;
  } catch {
    return null;
  }
}

function switchTab(tab) {
  document.querySelectorAll(".nav-item").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
  $(`#tab-${tab}`).classList.remove("hidden");
  const titles = {
    compose: "Nouveau message",
    settings: "Paramètres",
    guide: "Guide rapide",
  };
  $("#page-title").textContent = titles[tab] || "ERA Formation";
  if (tab === "settings") loadSettings();
  if (tab === "compose" && typeof tinymce !== "undefined") {
    tinymce.get("message-editor")?.focus();
  }
}

async function loadSettings() {
  const fallback = {
    smtpFrom: "accidzco@acci-dz.com",
    smtpReplyTo: "B.bachir-eraforma@acci-dz.com,s.ammi@eraforma.com",
    smtpUser: "_mainaccount@acci-dz.com",
    smtpPass: "",
    smtpReady: false,
  };

  try {
    const res = await fetch("api/settings", { headers: headers() });
    const data = res.ok ? await res.json() : fallback;
    if (!res.ok && res.status !== 401) throw new Error("load failed");

    $("#set-from").value = data.smtpFrom || fallback.smtpFrom;
    $("#set-reply-to").value = data.smtpReplyTo || fallback.smtpReplyTo;
    $("#set-user").value = data.smtpUser || fallback.smtpUser;
    if (data.smtpPass) $("#set-pass").value = data.smtpPass;

    const status = $("#settings-status");
    if (data.smtpReady) {
      status.textContent = "Configuration OK — vous pouvez envoyer des emails.";
      status.className = "settings-status";
    } else {
      status.textContent = "Entrez le mot de passe SMTP ci-dessous, puis cliquez Enregistrer.";
      status.className = "settings-status warn";
    }
    status.classList.remove("hidden");
  } catch {
    $("#set-from").value = fallback.smtpFrom;
    $("#set-reply-to").value = fallback.smtpReplyTo;
    $("#set-user").value = fallback.smtpUser;
    showToast("Champs pré-remplis — entrez le mot de passe SMTP", "");
    switchTab("settings");
  }
}

function showLogin() {
  loginScreen.classList.remove("hidden");
  app.classList.add("hidden");
}

function showApp() {
  loginScreen.classList.add("hidden");
  app.classList.remove("hidden");
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const password = $("#login-password").value.trim();
  const res = await fetch("api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  const data = await res.json();
  if (!data.ok) {
    appPassword = "";
    loginError.textContent = data.error || "Erreur de connexion";
    loginError.classList.remove("hidden");
    return;
  }
  appPassword = password;
  loginError.classList.add("hidden");
  initApp();
});

$("#toggle-password").addEventListener("click", () => {
  const input = $("#login-password");
  const btn = $("#toggle-password");
  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "Masquer";
  } else {
    input.type = "password";
    btn.textContent = "Afficher";
  }
});

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

$("#toggle-smtp-pass").addEventListener("click", () => {
  const input = $("#set-pass");
  const btn = $("#toggle-smtp-pass");
  if (input.type === "password") {
    input.type = "text";
    btn.textContent = "Masquer";
  } else {
    input.type = "password";
    btn.textContent = "Afficher";
  }
});

$("#settings-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const smtpPass = $("#set-pass").value;
  if (!smtpPass.trim()) {
    return showToast("Entrez le mot de passe SMTP", "error");
  }

  try {
    const res = await fetch("api/settings", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        smtpPass: smtpPass.trim(),
        smtpFrom: $("#set-from").value.trim(),
        smtpReplyTo: $("#set-reply-to").value.trim(),
        smtpUser: $("#set-user").value.trim(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error("Accès refusé. Redémarrez l'application.");
      }
      throw new Error(data.error || "Erreur");
    }
    showToast("Paramètres enregistrés", "success");
    $("#from-display").textContent = $("#set-from").value.trim();
    loadSettings();
    if (data.smtpReady) switchTab("compose");
  } catch (err) {
    showToast(err.message, "error");
  }
});

$("#recipients").addEventListener("input", updateRecipientCount);

$("#clear-recipients").addEventListener("click", () => {
  $("#recipients").value = "";
  updateRecipientCount();
});

$("#attach-files").addEventListener("change", (e) => {
  for (const file of e.target.files) {
    if (attachmentFiles.length >= MAX_ATTACHMENTS) {
      showToast(`Maximum ${MAX_ATTACHMENTS} fichiers`, "error");
      break;
    }
    if (file.size > MAX_FILE_BYTES) {
      showToast(`${file.name} dépasse 5 Mo`, "error");
      continue;
    }
    attachmentFiles.push(file);
  }
  renderAttachmentList();
  e.target.value = "";
});

$("#csv-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (ev) => {
    const text = ev.target.result;
    const emails = text
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter((s) => s.includes("@"));
    const existing = $("#recipients").value.trim();
    $("#recipients").value = existing
      ? existing + "\n" + emails.join("\n")
      : emails.join("\n");
    updateRecipientCount();
    showToast(`${emails.length} adresse(s) importée(s)`, "success");
  };
  reader.readAsText(file);
  e.target.value = "";
});

function updateResumeBanner(job) {
  const banner = $("#resume-banner");
  if (!job || !job.active || job.workerRunning || job.status === "running") {
    banner.classList.add("hidden");
    return;
  }
  if (job.status !== "paused") {
    banner.classList.add("hidden");
    return;
  }
  banner.classList.remove("hidden");
  $("#resume-pending").textContent = String(job.pending);
  $("#resume-subject").textContent = job.subject ? `« ${job.subject} »` : "";
}

async function refreshPausedJob() {
  try {
    const res = await fetch("api/send-status", { headers: headers() });
    const job = await res.json();
    updateResumeBanner(job);
    return job;
  } catch {
    updateResumeBanner(null);
    return null;
  }
}

let pollTimer = null;
let lastLoggedResultKey = "";
let lastEventCount = 0;
let sendUiActive = false;
let completedNotified = false;
const MAX_VISIBLE_RESULTS = 40;

function trimResultsList() {
  const resultsEl = $("#results");
  const items = resultsEl.querySelectorAll(".result-item");
  if (items.length > MAX_VISIBLE_RESULTS) {
    for (let i = 0; i < items.length - MAX_VISIBLE_RESULTS; i++) {
      items[i].remove();
    }
  }
}

function appendResultLine(result) {
  if (!result) return;
  const resultsEl = $("#results");
  const cls = result.ok ? "ok" : "fail";
  const icon = result.ok ? "✅" : "❌";
  resultsEl.insertAdjacentHTML(
    "beforeend",
    `<div class="result-item ${cls}">${icon} ${result.to}${result.error ? " — " + result.error : ""}</div>`
  );
  trimResultsList();
}

function updateSendUi(status) {
  const resultsEl = $("#results");
  const current = status.current ?? (status.sent || 0) + (status.failed || 0);
  const total = status.total || current + (status.pending || 0);
  const pct = total ? (current / total) * 100 : 0;

  $("#progress-fill").style.width = `${pct}%`;
  $("#progress-text").textContent = `${current}/${total}`;

  if (status.quota) updateQuotaDisplay(status.quota);

  if (status.lastResult) {
    const key = `${status.lastResult.to}|${status.lastResult.ok}|${status.lastResult.error || ""}`;
    if (key !== lastLoggedResultKey) {
      lastLoggedResultKey = key;
      appendResultLine(status.lastResult);
    }
  }

  for (let i = lastEventCount; i < (status.recentEvents || []).length; i++) {
    const event = status.recentEvents[i];
    if (event.type === "progress" && event.result) {
      const key = `${event.result.to}|${event.result.ok}|${event.result.error || ""}`;
      if (key !== lastLoggedResultKey) {
        lastLoggedResultKey = key;
        appendResultLine(event.result);
      }
    }
    if (event.type === "hourly_pause") {
      resultsEl.insertAdjacentHTML(
        "beforeend",
        `<div class="result-summary">⏳ Pause horaire (~${event.waitMin} min) — ${event.sent}/${event.total}</div>`
      );
    }
    if (event.type === "batch_start") {
      resultsEl.insertAdjacentHTML(
        "beforeend",
        `<div class="result-summary">📅 Lot ${event.batch} — ${event.batchSize} email(s)</div>`
      );
    }
  }
  lastEventCount = (status.recentEvents || []).length;

  if (status.workerRunning) {
    updateResumeBanner(null);
  } else if (status.active && status.status === "paused") {
    updateResumeBanner(status);
  } else if (!status.active) {
    updateResumeBanner(null);
  }
}

function setSendControls(active) {
  sendUiActive = active;
  $("#send-bulk").disabled = active;
  $("#resume-send").disabled = active;
  if (active) {
    $("#cancel-send").classList.remove("hidden");
    $("#progress-wrap").classList.remove("hidden");
    $("#results").classList.remove("hidden");
  } else {
    $("#cancel-send").classList.add("hidden");
  }
}

async function pollSendStatus() {
  try {
    const res = await fetch("api/send-status", {
      headers: headers(),
      cache: "no-store",
    });
    const status = await res.json();
    updateSendUi(status);

    if (status.workerRunning) return;

    stopSendPolling();

    if (!status.active && !completedNotified) {
      completedNotified = true;
      if (status.status === "done" || (status.sent || 0) + (status.failed || 0) > 0) {
        $("#results").insertAdjacentHTML(
          "afterbegin",
          `<div class="result-summary">✅ Terminé — ${status.sent || 0} envoyé(s) · ❌ ${status.failed || 0} échec(s)</div>`
        );
        showToast(`Envoi terminé : ${status.sent}/${status.total}`, "success");
      }
      setSendControls(false);
      lastLoggedResultKey = "";
      lastEventCount = 0;
    } else if (status.status === "paused" && sendUiActive) {
      $("#results").insertAdjacentHTML(
        "afterbegin",
        `<div class="result-summary">⏸ En pause — ${status.sent} envoyé(s) · ${status.pending} restant(s)</div>`
      );
      showToast("Envoi en pause", "");
      setSendControls(false);
      updateResumeBanner(status);
    }
  } catch {
    /* keep polling — server may be busy */
  }
}

function startSendPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(pollSendStatus, 800);
  pollSendStatus();
}

function stopSendPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

$("#cancel-send").addEventListener("click", async () => {
  try {
    await fetch("api/send-stop", { method: "POST", headers: headers() });
    showToast("Arrêt demandé — l'envoi se met en pause…", "");
  } catch {
    showToast("Impossible d'arrêter l'envoi", "error");
  }
});

$("#resume-send").addEventListener("click", () => {
  runBulkSendClient({ resume: true });
});

$("#abandon-job").addEventListener("click", async () => {
  if (!confirm("Abandonner l'envoi en pause ? Les emails restants ne seront pas envoyés.")) return;
  try {
    await fetch("api/send-job", { method: "DELETE", headers: headers() });
    stopSendPolling();
    setSendControls(false);
    updateResumeBanner(null);
    showToast("Envoi abandonné", "");
  } catch {
    showToast("Impossible d'abandonner l'envoi", "error");
  }
});

async function runBulkSendClient({ resume = false } = {}) {
  if (sendUiActive) return;

  if (!resume) {
    const recipients = $("#recipients").value.trim();
    const { subject, message, html } = getFormData();
    if (!recipients) return showToast("Ajoutez au moins un destinataire", "error");
    if (!subject || (!message && !html.replace(/<[^>]+>/g, "").trim())) {
      return showToast("Remplissez l'objet et le message", "error");
    }
  }

  setSendControls(true);
  if (!resume) {
    $("#results").innerHTML = "";
    lastLoggedResultKey = "";
    lastEventCount = 0;
    completedNotified = false;
    $("#progress-fill").style.width = "0%";
  }

  try {
    let body;
    if (resume) {
      body = { resume: true };
    } else {
      const attachments = await attachmentsToPayload();
      const { subject, message, html } = getFormData();
      body = {
        recipients: $("#recipients").value.trim(),
        subject,
        message,
        html,
        attachments,
      };
    }

    const res = await fetch("api/send-bulk", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    if (data.invalid?.length) {
      for (const email of data.invalid) {
        appendResultLine({ to: email, ok: false, error: "adresse invalide" });
      }
    }

    if (data.job) {
      updateSendUi(data.job);
      $("#progress-text").textContent = `0/${data.job.total || "?"}`;
    }

    const rate = data.job?.quota?.maxPerHour || data.job?.maxPerHour || 85;
    $("#results").insertAdjacentHTML(
      "afterbegin",
      `<div class="result-summary">📋 ${data.job?.total || "?"} email(s) · ${rate}/heure · envoi en arrière-plan</div>`
    );

    startSendPolling();
    showToast(resume ? "Reprise de l'envoi…" : "Envoi démarré — vous pouvez laisser l'application ouverte", "success");
  } catch (err) {
    setSendControls(false);
    showToast(err.message, "error");
  }
}

$("#email-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  runBulkSendClient({ resume: false });
});

(async () => {
  $("#login-url-hint").textContent = window.location.origin;

  const loginRes = await fetch("api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: "" }),
  });
  const loginData = await loginRes.json();

  if (!loginData.authRequired) {
    showApp();
    initRichEditor();
    try {
      const res = await fetch("api/config");
      const data = await res.json();
      $("#from-display").textContent = data.from;
      if (data.quota) updateQuotaDisplay(data.quota);
      if (data.pausedJob?.workerRunning) {
        setSendControls(true);
        startSendPolling();
      } else if (data.pausedJob?.active) {
        updateResumeBanner(data.pausedJob);
      }
      if (!data.smtpReady) {
        showToast("Configurez le mot de passe SMTP dans Paramètres", "error");
        switchTab("settings");
      }
    } catch {}
  } else {
    showLogin();
  }

  updateRecipientCount();
})();
