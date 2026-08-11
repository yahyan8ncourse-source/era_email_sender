let appPassword = "";

const $ = (sel) => document.querySelector(sel);
const loginScreen = $("#login-screen");
const app = $("#app");
const loginForm = $("#login-form");
const loginError = $("#login-error");

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
  const unique = new Set(parts.map((e) => e.toLowerCase()));
  return unique.size;
}

function updateRecipientCount() {
  const n = countRecipients($("#recipients").value);
  $("#recipient-count").textContent = `${n} contact${n !== 1 ? "s" : ""}`;
}

function updatePreview() {
  const subject = $("#subject").value.trim() || "Objet de l'email";
  const msg = $("#message").value.trim() || "Votre message apparaîtra ici…";
  const preview = $("#preview");
  preview.innerHTML = `<h2>${escapeHtml(subject)}</h2><p>${escapeHtml(msg)}</p>`;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getFormData() {
  return {
    subject: $("#subject").value.trim(),
    message: $("#message").value.trim(),
  };
}

function updateQuotaDisplay(quota) {
  if (!quota) return;
  const resetMin = Math.max(0, Math.ceil((quota.resetAt - Date.now()) / 60000));
  $("#quota-display").textContent = `${quota.remaining}/${quota.maxPerHour} restants`;
  $("#quota-hint").textContent = quota.maxPerHour;
  const guideHint = $("#quota-hint-guide");
  if (guideHint) guideHint.textContent = quota.maxPerHour;
  if (quota.remaining === 0) {
    $("#quota-display").textContent += ` (reset ~${resetMin} min)`;
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
  } catch {
    showLogin();
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
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    const tab = btn.dataset.tab;
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    $(`#tab-${tab}`).classList.remove("hidden");
    $("#page-title").textContent = tab === "guide" ? "Guide rapide" : "Nouveau message";
  });
});

$("#recipients").addEventListener("input", updateRecipientCount);
$("#message").addEventListener("input", updatePreview);
$("#subject").addEventListener("input", updatePreview);

$("#clear-recipients").addEventListener("click", () => {
  $("#recipients").value = "";
  updateRecipientCount();
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

let abortBulk = false;

$("#cancel-send").addEventListener("click", () => {
  abortBulk = true;
});

$("#email-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const recipients = $("#recipients").value.trim();
  const { subject, message } = getFormData();

  if (!recipients) return showToast("Ajoutez au moins un destinataire", "error");
  if (!subject || !message) return showToast("Remplissez l'objet et le message", "error");

  const sendBtn = $("#send-bulk");
  const progressWrap = $("#progress-wrap");
  const resultsEl = $("#results");
  const cancelBtn = $("#cancel-send");

  abortBulk = false;
  sendBtn.disabled = true;
  cancelBtn.classList.remove("hidden");
  progressWrap.classList.remove("hidden");
  resultsEl.classList.remove("hidden");
  resultsEl.innerHTML = "";
  $("#progress-fill").style.width = "0%";

  try {
    const res = await fetch("api/send-bulk", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ recipients, subject, message }),
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line);

        if (event.type === "progress") {
          const pct = (event.current / event.total) * 100;
          $("#progress-fill").style.width = `${pct}%`;
          $("#progress-text").textContent = `${event.current} / ${event.total}`;
          if (event.quota) updateQuotaDisplay(event.quota);
          const cls = event.result.ok ? "ok" : "fail";
          const icon = event.result.ok ? "✅" : "❌";
          resultsEl.insertAdjacentHTML(
            "beforeend",
            `<div class="result-item ${cls}">${icon} ${event.result.to}${event.result.error ? " — " + event.result.error : ""}</div>`
          );
        }

        if (event.type === "done") {
          resultsEl.insertAdjacentHTML(
            "afterbegin",
            `<div class="result-summary">✅ ${event.sent} envoyé(s) · ❌ ${event.failed} échec(s) · ${event.total} total</div>`
          );
          if (event.quota) updateQuotaDisplay(event.quota);
          showToast(`Envoi terminé : ${event.sent}/${event.total}`, event.failed ? "" : "success");
        }

        if (event.type === "invalid") {
          resultsEl.insertAdjacentHTML(
            "beforeend",
            `<div class="result-item fail">⚠️ ${event.email} — adresse invalide</div>`
          );
        }
      }
    }
  } catch (err) {
    showToast(err.message, "error");
    refreshQuota();
  } finally {
    sendBtn.disabled = false;
    cancelBtn.classList.add("hidden");
  }
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
    try {
      const res = await fetch("api/config");
      const data = await res.json();
      $("#from-display").textContent = data.from;
      if (data.quota) updateQuotaDisplay(data.quota);
    } catch {}
  } else {
    showLogin();
  }

  updateRecipientCount();
  updatePreview();
})();
