"use strict";

const state = {
  clients: [],
  settings: null,
  products: [],
  plans: [],
  media: {},
  activeSection: "dashboard",
  poller: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function displayWhatsAppId(value) {
  return String(value || "")
    .replace(/@(c\.us|s\.whatsapp\.net|lid)$/, "")
    .split(":")[0];
}

function showToast(message, error = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", error);
  toast.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("show"), 3500);
}

async function api(url, options = {}) {
  const isBinary = options.body instanceof Blob;
  const request = {
    credentials: "same-origin",
    headers: { ...((options.body instanceof FormData || isBinary) ? {} : { "Content-Type": "application/json" }), ...(options.headers || {}) },
    ...options
  };
  if (request.body && !(request.body instanceof FormData) && !isBinary && typeof request.body !== "string") {
    request.body = JSON.stringify(request.body);
  }
  const response = await fetch(url, request);
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : await response.text();
  if (response.status === 401 && url !== "/api/auth/login") {
    showLogin();
    throw new Error("La sesión terminó. Vuelve a ingresar.");
  }
  if (!response.ok) throw new Error(payload.error || payload || "No se pudo completar la operación.");
  return payload;
}

function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
  clearInterval(state.poller);
}

async function showApp() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  await refreshAll();
  clearInterval(state.poller);
  state.poller = setInterval(refreshWhatsAppStatus, 4000);
}

function navigate(section) {
  state.activeSection = section;
  $$(".page-section").forEach((element) => element.classList.toggle("active", element.id === `section-${section}`));
  $$(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.section === section));
  const titles = {
    dashboard: "Resumen",
    whatsapp: "WhatsApp",
    clients: "Clientes y cobros",
    messages: "Mensajes y archivos",
    attention: "Atención personal",
    activity: "Actividad"
  };
  $("#pageTitle").textContent = titles[section] || "JadrixServs";
  $(".sidebar").classList.remove("open");
  if (section === "clients") loadClients();
  if (section === "attention") loadConversations();
  if (section === "activity") loadLogs();
  if (section === "messages") loadSettings();
}

function statusPresentation(status) {
  const map = {
    ready: ["Conectado", "green", "WhatsApp está respondiendo automáticamente."],
    qr: ["Escanea el QR", "amber", "Abre WhatsApp en tu celular y vincula este dispositivo."],
    authenticated: ["Autenticando", "blue", "WhatsApp aceptó el QR. Espera unos segundos."],
    loading: ["Sincronizando", "blue", `WhatsApp está cargando${status.loadingPercent !== null ? ` (${status.loadingPercent}%)` : ""}.`],
    reconnecting: ["Completando conexión", "blue", status.loadingMessage || "Reabriendo la sesión aceptada."],
    recovering: ["Recuperando", "amber", status.error || "Completando la conexión automáticamente."],
    stalled: ["Conexión detenida", "red", status.error || "WhatsApp vinculó la sesión, pero no terminó de cargar."],
    initializing: ["Iniciando", "neutral", status.loadingMessage || "Preparando la conexión con WhatsApp."],
    starting: ["Iniciando", "neutral", "Preparando el servicio."],
    restarting: ["Reiniciando", "neutral", "Cerrando y abriendo la conexión."],
    reset: ["Sesión cerrada", "amber", "Preparando un código QR nuevo."],
    disconnected: ["Desconectado", "red", "La sesión se desconectó. Reinicia o vincula nuevamente."],
    auth_failure: ["Error de sesión", "red", "La autenticación falló. Cierra la sesión y escanea un QR nuevo."],
    error: ["Error", "red", status.error || "No se pudo iniciar WhatsApp."],
    disabled: ["Desactivado", "neutral", "WhatsApp está desactivado en este entorno."]
  };
  return map[status.state] || ["Procesando", "neutral", "Esperando el estado de WhatsApp."];
}

function renderWhatsApp(status) {
  const [label, tone, description] = statusPresentation(status);
  for (const id of ["waPill", "dashboardWaPill", "heroBadge"]) {
    const element = $(`#${id}`);
    element.textContent = label;
    element.className = `pill ${tone}`;
  }
  $("#sidebarStatus").className = `status-dot ${status.ready ? "online" : status.state === "qr" ? "waiting" : "offline"}`;
  $("#sidebarStatusText").textContent = status.ready ? "WhatsApp activo" : label;
  $("#heroText").textContent = description;
  $("#waTitle").textContent = status.ready ? `Conectado${status.name ? ` como ${status.name}` : ""}` : label;
  $("#waDescription").textContent = status.error || description;
  const diagnosticParts = [
    status.updatedAt ? `Actualizado ${formatRelative(status.updatedAt)}` : "",
    status.waState ? `Estado: ${status.waState}` : "",
    status.webVersion ? `Motor: ${status.webVersion}` : ""
  ].filter(Boolean);
  $("#waUpdated").textContent = diagnosticParts.join(" · ");

  const visual = $("#waVisual");
  if (status.ready) {
    visual.innerHTML = `<div class="success-orb">✓</div><strong>Bot en línea</strong><p>${escapeHtml(status.phone || "")}</p>`;
  } else if (status.qrDataUrl) {
    visual.innerHTML = `<img src="${escapeHtml(status.qrDataUrl)}" alt="Código QR de WhatsApp"><strong>Escanéalo desde tu celular</strong>`;
  } else if (["error", "auth_failure", "disconnected"].includes(status.state)) {
    visual.innerHTML = `<div class="error-orb">!</div><strong>${escapeHtml(label)}</strong><p>${escapeHtml(status.error || description)}</p>`;
  } else {
    const progress = status.loadingPercent !== null && status.loadingPercent !== undefined
      ? `<progress class="loading-progress" max="100" value="${Math.max(0, Math.min(100, Number(status.loadingPercent) || 0))}"></progress>`
      : "";
    visual.innerHTML = `<div class="loader-ring"></div><p>${escapeHtml(description)}</p>${progress}`;
  }

  $("#dashboardWaBody").innerHTML = status.ready
    ? `<strong>✓ Bot conectado</strong><p class="muted">${escapeHtml(status.phone || "Sesión activa")} · Las respuestas y recordatorios están disponibles.</p>`
    : status.qrDataUrl
      ? `<strong>Falta escanear el QR</strong><p class="muted">Ve a la sección WhatsApp para vincular tu celular.</p>`
      : `<strong>${escapeHtml(label)}</strong><p class="muted">${escapeHtml(status.error || description)}</p>`;
}

function formatRelative(value) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "hace unos segundos";
  if (seconds < 3600) return `hace ${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `hace ${Math.floor(seconds / 3600)} h`;
  return new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatDate(value) {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("es-PE", { day: "2-digit", month: "short", year: "numeric" })
    .format(new Date(year, month - 1, day));
}

function addMonths(value, months) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1 + Number(months), 1);
  const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  date.setDate(Math.min(day, lastDay));
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}

function today() {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"), String(now.getDate()).padStart(2, "0")].join("-");
}

async function refreshAll() {
  try {
    const [dashboard] = await Promise.all([api("/api/dashboard"), loadSettings(), loadClients(), loadConversations()]);
    renderDashboard(dashboard);
    renderWhatsApp(dashboard.whatsapp);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function refreshWhatsAppStatus() {
  try {
    renderWhatsApp(await api("/api/whatsapp/status"));
  } catch {
    // api() ya actualiza la interfaz cuando la sesión termina.
  }
}

function renderDashboard(dashboard) {
  $("#statActive").textContent = dashboard.stats.active;
  $("#statDue").textContent = dashboard.stats.dueSoon;
  $("#statExpired").textContent = dashboard.stats.expired;
  $("#statPaused").textContent = dashboard.stats.pausedChats;
  renderLogs(dashboard.recentLogs, $("#recentLogs"), true);
}

async function loadClients() {
  state.clients = await api("/api/clients");
  renderClients();
}

function renderClients() {
  const query = $("#clientSearch").value.trim().toLowerCase();
  const status = $("#clientStatusFilter").value;
  const clients = state.clients.filter((client) => {
    const haystack = `${client.name} ${client.whatsapp} ${client.product}`.toLowerCase();
    return (!query || haystack.includes(query)) && (!status || client.status === status);
  });
  const table = $("#clientsTable");
  table.innerHTML = clients.map((client) => `
    <tr>
      <td><strong>${escapeHtml(client.name)}</strong><span>${escapeHtml(client.whatsapp)}</span></td>
      <td><strong>${escapeHtml(client.product)}</strong><span>${escapeHtml(client.price || "Sin precio")}</span></td>
      <td><strong>${escapeHtml(formatDate(client.expiryDate))}</strong><span>Desde ${escapeHtml(formatDate(client.startDate))}</span></td>
      <td><div class="automation-flags"><span class="mini-flag ${client.autoReminder ? "on" : ""}">Aviso ${client.reminderDays}d</span><span class="mini-flag ${client.autoCharge ? "on" : ""}">Cobro</span></div></td>
      <td><span class="pill ${client.status === "activo" ? "green" : client.status === "vencido" ? "red" : "amber"}">${escapeHtml(client.status)}</span></td>
      <td><div class="row-actions">
        <button data-action="remind" data-id="${client.id}" type="button">Avisar</button>
        <button data-action="renew" data-id="${client.id}" type="button">Renovar</button>
        <button data-action="edit" data-id="${client.id}" type="button">Editar</button>
      </div></td>
    </tr>
  `).join("");
  $("#clientsEmpty").classList.toggle("hidden", clients.length > 0);
  $(".table-wrap").classList.toggle("hidden", clients.length === 0);
}

function openClientDialog(client = null) {
  $("#clientDialogTitle").textContent = client ? "Editar cliente" : "Nuevo registro";
  $("#clientId").value = client?.id || "";
  $("#clientName").value = client?.name || "";
  $("#clientWhatsapp").value = client?.whatsapp || "";
  $("#clientProduct").value = client?.product || "";
  $("#clientPrice").value = client?.price || "";
  $("#clientPaymentMethod").value = client?.paymentMethod || "";
  $("#clientStatus").value = client?.status || "activo";
  $("#clientStartDate").value = client?.startDate || today();
  $("#clientTermMonths").value = String(client?.termMonths || 1);
  $("#clientExpiryDate").value = client?.expiryDate || addMonths(today(), 1);
  $("#clientReminderDays").value = String(client?.reminderDays || 2);
  $("#clientAutoReminder").checked = Boolean(client?.autoReminder);
  $("#clientAutoCharge").checked = Boolean(client?.autoCharge);
  $("#clientNotes").value = client?.notes || "";
  $("#clientDialog").showModal();
}

async function saveClient(event) {
  event.preventDefault();
  const id = $("#clientId").value;
  const payload = {
    name: $("#clientName").value,
    whatsapp: $("#clientWhatsapp").value,
    product: $("#clientProduct").value,
    price: $("#clientPrice").value,
    paymentMethod: $("#clientPaymentMethod").value,
    status: $("#clientStatus").value,
    startDate: $("#clientStartDate").value,
    expiryDate: $("#clientExpiryDate").value,
    termMonths: Number($("#clientTermMonths").value),
    reminderDays: Number($("#clientReminderDays").value),
    autoReminder: $("#clientAutoReminder").checked,
    autoCharge: $("#clientAutoCharge").checked,
    notes: $("#clientNotes").value
  };
  try {
    await api(id ? `/api/clients/${id}` : "/api/clients", { method: id ? "PUT" : "POST", body: payload });
    $("#clientDialog").close();
    await Promise.all([loadClients(), refreshDashboardOnly()]);
    showToast(id ? "Cliente actualizado." : "Cliente registrado.");
  } catch (error) {
    showToast(error.message, true);
  }
}

function openRenewDialog(client) {
  $("#renewDialogTitle").textContent = `Renovar a ${client.name}`;
  $("#renewClientId").value = client.id;
  $("#renewPaymentDate").value = today();
  $("#renewTermMonths").value = String(client.termMonths || 1);
  $("#renewPrice").value = client.price || "";
  $("#renewPaymentMethod").value = client.paymentMethod || "";
  $("#renewDialog").showModal();
}

async function saveRenewal(event) {
  event.preventDefault();
  const id = $("#renewClientId").value;
  try {
    const renewed = await api(`/api/clients/${id}/renew`, {
      method: "POST",
      body: {
        paymentDate: $("#renewPaymentDate").value,
        termMonths: Number($("#renewTermMonths").value),
        price: $("#renewPrice").value,
        paymentMethod: $("#renewPaymentMethod").value
      }
    });
    $("#renewDialog").close();
    await Promise.all([loadClients(), refreshDashboardOnly()]);
    showToast(`Renovado hasta ${formatDate(renewed.expiryDate)} sin perder días.`);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadSettings() {
  const payload = await api("/api/settings");
  state.settings = payload.settings;
  state.products = payload.products;
  state.plans = payload.plans;
  state.media = payload.media;
  $("#greeting1").value = payload.settings.greetingMessages[0] || "";
  $("#greeting2").value = payload.settings.greetingMessages[1] || "";
  $("#greeting3").value = payload.settings.greetingMessages[2] || "";
  $("#shortGreeting").value = payload.settings.shortGreeting || "";
  $("#peruPayment").value = payload.settings.peruPayment || "";
  $("#internationalPayment").value = payload.settings.internationalPayment || "";
  $("#reminderTemplate").value = payload.settings.reminderTemplate || "";
  $("#chargeTemplate").value = payload.settings.chargeTemplate || "";
  $("#receiptReply").value = payload.settings.receiptReply || "";
  $("#humanReply").value = payload.settings.humanReply || "";
  $("#fallbackReply").value = payload.settings.fallbackReply || "";
  $("#audioStatus").textContent = payload.media.dicloakAudio?.originalName || "Sin cargar";
  $("#pdfStatus").textContent = payload.media.catalogPdf?.originalName || "Sin cargar";
  $("#aiStatusPill").textContent = payload.ai?.enabled ? "Activa" : "Sin clave";
  $("#aiStatusPill").className = `pill ${payload.ai?.enabled ? "green" : "amber"}`;
  $("#aiStatusText").textContent = payload.ai?.enabled
    ? `OPENAI_API_KEY está configurada. Modelo: ${payload.ai.model}. Pulsa “Probar conexión con OpenAI” para verificarla.`
    : "Las respuestas predeterminadas funcionan, pero las preguntas no previstas pasarán a un asesor hasta configurar la clave.";
  $("#productOptions").innerHTML = [...payload.products, ...payload.plans]
    .map((item) => `<option value="${escapeHtml(item.name)}"></option>`).join("");
}

async function saveSettings() {
  try {
    await api("/api/settings", {
      method: "PUT",
      body: {
        shortGreeting: $("#shortGreeting").value,
        greetingMessages: [$("#greeting1").value, $("#greeting2").value, $("#greeting3").value],
        peruPayment: $("#peruPayment").value,
        internationalPayment: $("#internationalPayment").value,
        reminderTemplate: $("#reminderTemplate").value,
        chargeTemplate: $("#chargeTemplate").value,
        receiptReply: $("#receiptReply").value,
        humanReply: $("#humanReply").value,
        fallbackReply: $("#fallbackReply").value
      }
    });
    showToast("Mensajes guardados.");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function uploadMedia(event, kind) {
  event.preventDefault();
  const fileInput = kind === "dicloakAudio" ? $("#audioFile") : $("#pdfFile");
  if (!fileInput.files[0]) return;
  const file = fileInput.files[0];
  try {
    await api(`/api/media/${kind}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        "X-File-Type": file.type || "application/octet-stream"
      },
      body: file
    });
    fileInput.value = "";
    await loadSettings();
    showToast("Archivo cargado correctamente.");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadConversations() {
  const conversations = await api("/api/conversations");
  $("#pausedConversations").innerHTML = conversations.map((item) => `
    <article class="attention-card">
      <div><strong>${escapeHtml(displayWhatsAppId(item.chatId))}</strong><span>${escapeHtml(item.pauseReason || "Solicitó atención personal")} · ${escapeHtml(formatRelative(item.pausedAt || item.updatedAt))}</span></div>
      <button class="button secondary" data-resume="${escapeHtml(item.chatId)}" type="button">Reactivar bot</button>
    </article>
  `).join("");
  $("#pausedEmpty").classList.toggle("hidden", conversations.length > 0);
}

function logLabel(type) {
  return {
    incoming: "Mensaje recibido",
    outgoing: "Mensaje enviado",
    receipt: "Comprobante",
    whatsapp: "WhatsApp",
    reminder: "Recordatorio",
    human: "Atención personal",
    client: "Cliente",
    media: "Archivo",
    error: "Error"
  }[type] || type;
}

function renderLogs(logs, target, compact = false) {
  if (!logs.length) {
    target.innerHTML = `<div class="empty-state compact"><span>No hay actividad todavía.</span></div>`;
    return;
  }
  target.innerHTML = logs.map((log) => `
    <div class="timeline-item">
      <span class="timeline-marker"></span>
      <p><strong>${escapeHtml(logLabel(log.type))}</strong>${compact ? "<br>" : " · "}${escapeHtml(log.message)}</p>
      <time>${escapeHtml(formatRelative(log.createdAt))}</time>
    </div>
  `).join("");
}

async function loadLogs() {
  renderLogs(await api("/api/logs?limit=250"), $("#allLogs"));
}

async function refreshDashboardOnly() {
  const dashboard = await api("/api/dashboard");
  renderDashboard(dashboard);
  renderWhatsApp(dashboard.whatsapp);
}

function bindEvents() {
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await api("/api/auth/login", { method: "POST", body: { password: $("#loginPassword").value } });
      $("#loginPassword").value = "";
      await showApp();
    } catch (error) {
      showToast(error.message, true);
    }
  });
  $("#logoutButton").addEventListener("click", async () => {
    await api("/api/auth/logout", { method: "POST" });
    showLogin();
  });
  $$(".nav-button").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.section)));
  $$("[data-go]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.go)));
  $("#mobileMenu").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
  $("#restartWaButton").addEventListener("click", async () => {
    try {
      await api("/api/whatsapp/restart", { method: "POST" });
      showToast("WhatsApp se está reiniciando.");
      setTimeout(refreshWhatsAppStatus, 1500);
    } catch (error) { showToast(error.message, true); }
  });
  $("#recoverWaButton").addEventListener("click", async () => {
    try {
      await api("/api/whatsapp/recover", { method: "POST" });
      showToast("Estamos completando la conexión. Espera unos segundos.");
      setTimeout(refreshWhatsAppStatus, 1500);
    } catch (error) { showToast(error.message, true); }
  });
  $("#resetWaButton").addEventListener("click", async () => {
    if (!confirm("Se cerrará la sesión actual de WhatsApp y tendrás que escanear un QR nuevo. ¿Continuar?")) return;
    try {
      await api("/api/whatsapp/reset", { method: "POST" });
      showToast("Sesión cerrada. Esperando QR nuevo.");
      setTimeout(refreshWhatsAppStatus, 1500);
    } catch (error) { showToast(error.message, true); }
  });
  $("#newClientButton").addEventListener("click", () => openClientDialog());
  $("#clientForm").addEventListener("submit", saveClient);
  $("#renewForm").addEventListener("submit", saveRenewal);
  $$(".dialog-close").forEach((button) => button.addEventListener("click", () => $("#clientDialog").close()));
  $$(".renew-close").forEach((button) => button.addEventListener("click", () => $("#renewDialog").close()));
  $("#clientSearch").addEventListener("input", renderClients);
  $("#clientStatusFilter").addEventListener("change", renderClients);
  $("#clientStartDate").addEventListener("change", () => {
    if ($("#clientStartDate").value) $("#clientExpiryDate").value = addMonths($("#clientStartDate").value, $("#clientTermMonths").value);
  });
  $("#clientTermMonths").addEventListener("change", () => {
    if ($("#clientStartDate").value) $("#clientExpiryDate").value = addMonths($("#clientStartDate").value, $("#clientTermMonths").value);
  });
  $("#clientsTable").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const client = state.clients.find((item) => item.id === button.dataset.id);
    if (!client) return;
    if (button.dataset.action === "edit") openClientDialog(client);
    if (button.dataset.action === "renew") openRenewDialog(client);
    if (button.dataset.action === "remind") {
      try {
        await api(`/api/clients/${client.id}/reminder`, { method: "POST" });
        showToast(`Recordatorio enviado a ${client.name}.`);
      } catch (error) { showToast(error.message, true); }
    }
  });
  $("#saveSettingsButton").addEventListener("click", saveSettings);
  $("#testAiButton").addEventListener("click", async () => {
    const button = $("#testAiButton");
    button.disabled = true;
    button.textContent = "Probando…";
    try {
      const result = await api("/api/ai/test", { method: "POST" });
      showToast(`OpenAI conectado correctamente con ${result.model}.`);
      await loadSettings();
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "Probar conexión con OpenAI";
    }
  });
  $("#audioForm").addEventListener("submit", (event) => uploadMedia(event, "dicloakAudio"));
  $("#pdfForm").addEventListener("submit", (event) => uploadMedia(event, "catalogPdf"));
  $("#pausedConversations").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-resume]");
    if (!button) return;
    try {
      await api(`/api/conversations/${encodeURIComponent(button.dataset.resume)}/resume`, { method: "POST" });
      await Promise.all([loadConversations(), refreshDashboardOnly()]);
      showToast("El bot volvió a atender esa conversación.");
    } catch (error) { showToast(error.message, true); }
  });
  $("#refreshLogsButton").addEventListener("click", loadLogs);
}

async function init() {
  bindEvents();
  const date = new Intl.DateTimeFormat("es-PE", { dateStyle: "full" }).format(new Date());
  $("#clockText").textContent = date.charAt(0).toUpperCase() + date.slice(1);
  try {
    const session = await api("/api/auth/session");
    $("#loginWarning").classList.toggle("hidden", !session.usingDefaultPassword);
    if (session.authenticated) await showApp();
    else showLogin();
  } catch (error) {
    showToast(error.message, true);
  }
}

document.addEventListener("DOMContentLoaded", init);
