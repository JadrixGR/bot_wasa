"use strict";

const THEME_STORAGE_KEY = "jadrixservs-theme";

const state = {
  clients: [],
  settings: null,
  products: [],
  plans: [],
  lookupClients: [],
  activeSection: "dashboard",
  poller: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

function preferredTheme() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // El panel continúa aunque el navegador bloquee el almacenamiento local.
  }
  if (document.documentElement.dataset.theme === "dark") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme, persist = false) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  const isDark = nextTheme === "dark";
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;

  const themeMeta = $("#themeColorMeta");
  if (themeMeta) themeMeta.setAttribute("content", isDark ? "#090e1a" : "#f3f6fc");

  $$('[data-theme-toggle]').forEach((button) => {
    button.setAttribute("aria-pressed", String(isDark));
    button.setAttribute("aria-label", isDark ? "Activar modo día" : "Activar modo noche");
    button.title = isDark ? "Cambiar a modo día" : "Cambiar a modo noche";
    const icon = $(".theme-icon", button);
    const label = $(".theme-label", button);
    if (icon) icon.textContent = isDark ? "☀" : "☾";
    if (label) label.textContent = isDark ? "Modo día" : "Modo noche";
  });

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // La preferencia solo durará hasta recargar si el almacenamiento está bloqueado.
    }
  }
}

function toggleTheme() {
  const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const nextTheme = current === "dark" ? "light" : "dark";
  applyTheme(nextTheme, true);
  showToast(nextTheme === "dark" ? "Modo noche activado." : "Modo día activado.");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
  if (
    response.status === 401 &&
    url !== "/api/auth/login" &&
    !(typeof payload === "object" && payload?.code)
  ) {
    showLogin();
    throw new Error("La sesión terminó. Vuelve a ingresar.");
  }
  if (!response.ok) {
    const error = new Error(
      (typeof payload === "object" && payload?.error) ||
        (typeof payload === "string" && payload) ||
        "No se pudo completar la operación."
    );
    error.code = typeof payload === "object" ? payload?.code : undefined;
    error.status = response.status;
    throw error;
  }
  return payload;
}

function showLogin() {
  $("#loginView").classList.remove("hidden");
  $("#appView").classList.add("hidden");
  document.body.classList.remove("app-active", "menu-open");
  setSidebarOpen(false);
  clearInterval(state.poller);
}

async function showApp() {
  $("#loginView").classList.add("hidden");
  $("#appView").classList.remove("hidden");
  document.body.classList.add("app-active");
  await refreshAll();
  clearInterval(state.poller);
  state.poller = setInterval(refreshWhatsAppStatus, 4000);
}

function setSidebarOpen(open) {
  const sidebar = $(".sidebar");
  const backdrop = $("#sidebarBackdrop");
  const menuButton = $("#mobileMenu");
  sidebar.classList.toggle("open", open);
  backdrop.classList.toggle("visible", open);
  document.body.classList.toggle("menu-open", open);
  menuButton.setAttribute("aria-expanded", String(open));
  menuButton.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
}

function navigate(section) {
  state.activeSection = section;
  $$(".page-section").forEach((element) => element.classList.toggle("active", element.id === `section-${section}`));
  $$(".nav-button").forEach((button) => {
    const active = button.dataset.section === section;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  const titles = {
    dashboard: "Resumen",
    whatsapp: "WhatsApp",
    clients: "Clientes y cobros",
    lookup: "Buscar celular",
    messages: "Mensajes automáticos",
    afk: "Modo AFK",
    activity: "Actividad"
  };
  $("#pageTitle").textContent = titles[section] || "JadrixServs";
  setSidebarOpen(false);
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
  });
  if (section === "clients") loadClients();
  if (section === "activity") loadLogs();
  if (section === "messages" || section === "afk") loadSettings();
}

function statusPresentation(status) {
  const map = {
    ready: ["Conectado", "green", "WhatsApp está listo para bienvenidas, recordatorios y cobranzas."],
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
    ? `<span class="dashboard-status-icon success">✓</span><div><strong>Bot conectado</strong><p class="muted">${escapeHtml(status.phone || "Sesión activa")} · Bienvenidas y renovaciones automáticas disponibles.</p></div>`
    : status.qrDataUrl
      ? `<span class="dashboard-status-icon warning">⌁</span><div><strong>Falta escanear el QR</strong><p class="muted">Ve a la sección WhatsApp para vincular tu celular.</p></div>`
      : `<span class="dashboard-status-icon neutral">••</span><div><strong>${escapeHtml(label)}</strong><p class="muted">${escapeHtml(status.error || description)}</p></div>`;
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
    const [dashboard] = await Promise.all([api("/api/dashboard"), loadSettings(), loadClients()]);
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
  animateStatValue($("#statActive"), dashboard.stats.active);
  animateStatValue($("#statDue"), dashboard.stats.dueSoon);
  animateStatValue($("#statToday"), dashboard.stats.dueToday);
  animateStatValue($("#statExpired"), dashboard.stats.expired);
  const storageNotice = $("#storageNotice");
  if (storageNotice) {
    const protectedStorage = Boolean(
      dashboard.storage?.persistentDiskConfigured
    );
    storageNotice.className = `notice ${protectedStorage ? "success" : "error"}`;
    storageNotice.innerHTML = protectedStorage
      ? "<strong>Datos protegidos:</strong> la sesión de WhatsApp, los clientes y la copia automática se guardan en el disco persistente <code>/data</code>."
      : "<strong>Atención:</strong> DATA_DIR no apunta a <code>/data</code>. Corrígelo en Render antes de actualizar para no perder la sesión ni los clientes al reiniciar.";
  }
  renderLogs(dashboard.recentLogs, $("#recentLogs"), true);
}

function animateStatValue(element, value) {
  const target = Number(value) || 0;
  const start = Number(element.textContent) || 0;
  if (start === target || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    element.textContent = target;
    return;
  }
  const startedAt = performance.now();
  const duration = 520;
  const tick = (time) => {
    const progress = Math.min(1, (time - startedAt) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    element.textContent = Math.round(start + (target - start) * eased);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

async function loadClients() {
  state.clients = await api("/api/clients");
  renderClients();
}

function clientStatusTone(status) {
  return status === "activo" ? "green" : status === "vencido" ? "red" : "amber";
}

function daysRemainingPresentation(client) {
  const days = Number(client.daysRemaining);
  if (!Number.isFinite(days)) {
    return { tone: "neutral", label: "Sin cálculo", detail: "Revisa la fecha" };
  }
  if (client.status === "vencido" || days < 0) {
    const overdue = Math.abs(days);
    return {
      tone: "red",
      label: "Vencido",
      detail: overdue === 1 ? "Hace 1 día" : `Hace ${overdue} días`
    };
  }
  if (days === 0) {
    return { tone: "yellow", label: "Vence hoy", detail: "Cobrar hoy" };
  }
  if (days === 1) {
    return { tone: "yellow", label: "1 día", detail: "Falta 1 día" };
  }
  if (days === 2) {
    return { tone: "yellow", label: "2 días", detail: "Faltan 2 días" };
  }
  if (days >= 3 && days <= 30) {
    return { tone: "green", label: `${days} días`, detail: `Faltan ${days} días` };
  }
  return { tone: "neutral", label: `${days} días`, detail: `Faltan ${days} días` };
}

async function copyPhoneToClipboard(phone) {
  const value = String(phone || "").trim();
  if (!value) throw new Error("No hay un número para copiar.");
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("No se pudo copiar el número.");
}

function renderLookupResults(clients, phone = "") {
  state.lookupClients = clients;
  const target = $("#lookupResults");
  if (!clients.length) {
    target.innerHTML = `
      <article class="panel empty-state compact">
        <strong>No encontramos servicios para ${escapeHtml(phone || "ese número")}.</strong>
        <span>Revisa los dígitos o registra al cliente desde Clientes y cobros.</span>
      </article>`;
    return;
  }

  target.innerHTML = `
    <div class="lookup-summary">
      <strong>${clients.length} servicio${clients.length === 1 ? "" : "s"} encontrado${clients.length === 1 ? "" : "s"}</strong>
      <span>${escapeHtml(clients[0].name)} · ${escapeHtml(clients[0].whatsapp)}</span>
    </div>
    <div class="lookup-grid">
      ${clients.map((client) => `
        <article class="panel lookup-card">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">SERVICIO</p>
              <h3>${escapeHtml(client.product)}</h3>
            </div>
            <span class="pill ${clientStatusTone(client.status)}">${escapeHtml(client.status)}</span>
          </div>
          <dl class="client-details">
            <div><dt>Vencimiento</dt><dd>${escapeHtml(formatDate(client.expiryDate))}</dd></div>
            <div><dt>Días restantes</dt><dd>${escapeHtml(daysRemainingPresentation(client).detail)}</dd></div>
            <div><dt>Activación</dt><dd>${escapeHtml(formatDate(client.startDate))}</dd></div>
            <div><dt>Precio</dt><dd>${escapeHtml(client.price || "Sin registrar")}</dd></div>
            <div><dt>Cuenta</dt><dd>${escapeHtml(client.accountReference || "Sin registrar")}</dd></div>
          </dl>
          <button class="button secondary wide" data-lookup-edit="${client.id}" type="button">Abrir ficha del cliente</button>
        </article>`).join("")}
    </div>`;
}

async function lookupClient(event) {
  event.preventDefault();
  const phone = $("#lookupPhone").value.trim();
  const button = $("#lookupButton");
  button.disabled = true;
  button.textContent = "Buscando…";
  try {
    const result = await api(`/api/clients/lookup?phone=${encodeURIComponent(phone)}`);
    renderLookupResults(result.clients, result.phone);
  } catch (error) {
    renderLookupResults([], phone);
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Buscar cliente";
  }
}

function renderClients() {
  const query = $("#clientSearch").value.trim().toLowerCase();
  const status = $("#clientStatusFilter").value;
  const clients = state.clients.filter((client) => {
    const haystack = `${client.whatsapp} ${client.product} ${client.accountReference || ""}`.toLowerCase();
    return (!query || haystack.includes(query)) && (!status || client.status === status);
  });
  const table = $("#clientsTable");
  table.innerHTML = clients.map((client, index) => {
    const remaining = daysRemainingPresentation(client);
    return `
    <tr class="client-row tone-${remaining.tone}" style="--row-index:${index}">
      <td>
        <button class="phone-copy" data-action="copy-phone" data-id="${client.id}" type="button" title="Copiar número al portapapeles">
          ${escapeHtml(client.whatsapp)}
          <span>Haz clic para copiar</span>
        </button>
      </td>
      <td><strong>${escapeHtml(client.product)}</strong><span>${escapeHtml(client.price || "Sin precio")}${client.durationDays ? ` · ${escapeHtml(client.durationDays)} días` : ""}</span></td>
      <td><strong>${escapeHtml(client.accountReference || "Sin registrar")}</strong></td>
      <td><strong>${escapeHtml(formatDate(client.expiryDate))}</strong><span>Desde ${escapeHtml(formatDate(client.startDate))}</span></td>
      <td><span class="days-badge ${remaining.tone}">${escapeHtml(remaining.label)}</span><span>${escapeHtml(remaining.detail)}</span></td>
      <td><div class="automation-flags"><span class="mini-flag ${client.autoReminder ? "on" : ""}">Aviso 2d</span><span class="mini-flag ${client.autoCharge ? "on" : ""}">Cobro</span></div></td>
      <td><span class="pill ${clientStatusTone(client.status)}">${escapeHtml(client.status)}</span></td>
      <td><div class="row-actions">
        <button class="action-remind" data-action="remind" data-id="${client.id}" type="button" title="Enviar recordatorio manual">Recordar</button>
        <button class="action-charge" data-action="charge" data-id="${client.id}" type="button" title="Enviar cobranza ahora">Cobrar</button>
        <button class="action-renew" data-action="renew" data-id="${client.id}" type="button" title="Registrar renovación">Renovar</button>
        <button class="action-edit" data-action="edit" data-id="${client.id}" type="button" title="Editar este registro">Editar</button>
        <button class="danger" data-action="delete-record" data-id="${client.id}" type="button" title="Eliminar únicamente esta compra">Eliminar registro</button>
        <button class="danger" data-action="delete-client" data-id="${client.id}" type="button" title="Eliminar todas las compras de este número">Eliminar cliente</button>
      </div></td>
    </tr>`;
  }).join("");
  $("#clientsEmpty").classList.toggle("hidden", clients.length > 0);
  $(".table-wrap").classList.toggle("hidden", clients.length === 0);
}

function openClientDialog(client = null) {
  $("#clientDialogTitle").textContent = client ? "Editar cliente" : "Nuevo registro";
  $("#clientId").value = client?.id || "";
  $("#clientName").value = client?.name || "";
  $("#clientWhatsapp").value = client?.whatsapp || "";
  $("#clientProduct").value = client?.product || "";
  $("#clientAccountReference").value = client?.accountReference || "";
  $("#clientPrice").value = client?.price || "";
  $("#clientPaymentMethod").value = client?.paymentMethod || "";
  $("#clientStatus").value = client?.status || "activo";
  $("#clientStartDate").value = client?.startDate || today();
  $("#clientTermMonths").value = String(client?.termMonths || 1);
  $("#clientExpiryDate").value = client?.expiryDate || addMonths(today(), 1);
  $("#clientAutoReminder").checked = client ? Boolean(client.autoReminder) : true;
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
    accountReference: $("#clientAccountReference").value,
    price: $("#clientPrice").value,
    paymentMethod: $("#clientPaymentMethod").value,
    status: $("#clientStatus").value,
    startDate: $("#clientStartDate").value,
    expiryDate: $("#clientExpiryDate").value,
    termMonths: Number($("#clientTermMonths").value),
    reminderDays: 2,
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
  $("#renewAccountReference").value = client.accountReference || "";
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
        paymentMethod: $("#renewPaymentMethod").value,
        accountReference: $("#renewAccountReference").value
      }
    });
    $("#renewDialog").close();
    await Promise.all([loadClients(), refreshDashboardOnly()]);
    showToast(`Renovado hasta ${formatDate(renewed.expiryDate)} sin perder días.`);
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderAfkStatus(settings) {
  const notice = $("#afkStatusNotice");
  if (!notice) return;
  const enabled = Boolean(settings.afkEnabled);
  notice.className = `notice ${enabled ? "success" : ""}`;
  notice.innerHTML = enabled
    ? "<strong>AFK activo:</strong> los contactos recibirán una respuesta fuera de horario una sola vez durante esta ausencia."
    : "<strong>AFK desactivado:</strong> el bot mantiene el funcionamiento normal de bienvenida y renovaciones.";
}

async function loadSettings() {
  const payload = await api("/api/settings");
  state.settings = payload.settings;
  state.products = payload.products;
  state.plans = payload.plans;
  $("#greeting1").value = payload.settings.greetingMessages[0] || "";
  $("#greeting2").value = payload.settings.greetingMessages[1] || "";
  $("#greeting3").value = payload.settings.greetingMessages[2] || "";
  $("#reminderTemplate").value = payload.settings.reminderTemplate || "";
  $("#chargeTemplate").value = payload.settings.chargeTemplate || "";
  $("#chargeStartTime").value = payload.settings.chargeStartTime || "09:00";
  $("#afkEnabled").checked = Boolean(payload.settings.afkEnabled);
  $("#afkMessage").value = payload.settings.afkMessage || "";
  renderAfkStatus(payload.settings);
  $("#productOptions").innerHTML = [...payload.products, ...payload.plans]
    .map((item) => `<option value="${escapeHtml(item.name)}"></option>`).join("");
}

async function saveSettings() {
  try {
    const payload = await api("/api/settings", {
      method: "PUT",
      body: {
        inboundMode: "welcome_once",
        greetingMessages: [$("#greeting1").value, $("#greeting2").value, $("#greeting3").value],
        reminderTemplate: $("#reminderTemplate").value,
        chargeTemplate: $("#chargeTemplate").value,
        chargeStartTime: $("#chargeStartTime").value
      }
    });
    state.settings = payload.settings;
    showToast("Mensajes y horario de cobranza guardados.");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function saveAfkSettings() {
  const button = $("#saveAfkButton");
  button.disabled = true;
  button.textContent = "Guardando…";
  try {
    const payload = await api("/api/settings", {
      method: "PUT",
      body: {
        afkEnabled: $("#afkEnabled").checked,
        afkMessage: $("#afkMessage").value
      }
    });
    state.settings = payload.settings;
    renderAfkStatus(payload.settings);
    showToast(payload.settings.afkEnabled ? "Modo AFK activado." : "Modo AFK desactivado.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Guardar modo AFK";
  }
}

function logLabel(type) {
  return {
    incoming: "Mensaje recibido",
    outgoing: "Mensaje enviado",
    welcome: "Bienvenida",
    afk: "Modo AFK",
    whatsapp: "WhatsApp",
    reminder: "Recordatorio",
    charge: "Cobranza",
    command: "Comando",
    client: "Cliente",
    security: "Seguridad",
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
  $$(`[data-theme-toggle]`).forEach((button) => button.addEventListener("click", toggleTheme));
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
  $("#mobileMenu").addEventListener("click", () => setSidebarOpen(!$(".sidebar").classList.contains("open")));
  $("#sidebarBackdrop").addEventListener("click", () => setSidebarOpen(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $(".sidebar").classList.contains("open")) setSidebarOpen(false);
  });
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
  $("#lookupForm").addEventListener("submit", lookupClient);
  $("#lookupResults").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-lookup-edit]");
    if (!button) return;
    const client = state.lookupClients.find((item) => item.id === button.dataset.lookupEdit);
    if (!client) return;
    navigate("clients");
    openClientDialog(client);
  });
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
    if (button.dataset.action === "copy-phone") {
      try {
        await copyPhoneToClipboard(client.whatsapp);
        showToast(`Número ${client.whatsapp} copiado.`);
      } catch (error) {
        showToast(error.message, true);
      }
      return;
    }
    if (button.dataset.action === "edit") openClientDialog(client);
    if (button.dataset.action === "renew") openRenewDialog(client);
    if (button.dataset.action === "delete-record") {
      if (!confirm(`¿Eliminar solo el registro “${client.product}” del número ${client.whatsapp}? Esta acción no elimina sus otras compras.`)) return;
      try {
        await api(`/api/clients/${client.id}`, { method: "DELETE" });
        await Promise.all([loadClients(), refreshDashboardOnly()]);
        showToast("Registro eliminado. La copia automática conserva el estado anterior.");
      } catch (error) { showToast(error.message, true); }
      return;
    }
    if (button.dataset.action === "delete-client") {
      const purchases = state.clients.filter((item) => item.whatsapp === client.whatsapp).length;
      if (!confirm(`¿Eliminar por completo al número ${client.whatsapp} y sus ${purchases} compra${purchases === 1 ? "" : "s"}? Esta acción elimina todos sus registros.`)) return;
      try {
        const result = await api(`/api/clients/by-phone/${encodeURIComponent(client.whatsapp)}`, { method: "DELETE" });
        await Promise.all([loadClients(), refreshDashboardOnly()]);
        showToast(`Cliente eliminado: ${result.deleted} registro${result.deleted === 1 ? "" : "s"}.`);
      } catch (error) { showToast(error.message, true); }
      return;
    }
    if (button.dataset.action === "remind") {
      try {
        await api(`/api/clients/${client.id}/reminder`, { method: "POST" });
        showToast(`Recordatorio enviado a ${client.name}.`);
        await loadClients();
      } catch (error) { showToast(error.message, true); }
    }
    if (button.dataset.action === "charge") {
      if (!confirm(`¿Enviar ahora el mensaje de cobranza a ${client.name}?`)) return;
      try {
        await api(`/api/clients/${client.id}/charge`, { method: "POST" });
        showToast(`Cobranza enviada a ${client.name}.`);
        await loadClients();
      } catch (error) { showToast(error.message, true); }
    }
  });
  $("#restoreBackupButton").addEventListener("click", () => {
    $("#restoreBackupInput").value = "";
    $("#restoreBackupInput").click();
  });
  $("#restoreBackupInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!confirm("Restaurar este respaldo reemplazará la base actual de clientes y configuración. La sesión de WhatsApp no se modifica. ¿Continuar?")) return;
    const button = $("#restoreBackupButton");
    button.disabled = true;
    button.textContent = "Restaurando…";
    try {
      const snapshot = JSON.parse(await file.text());
      const result = await api("/api/backup/restore", {
        method: "POST",
        body: snapshot
      });
      await refreshAll();
      showToast(`Respaldo restaurado: ${result.clients} cliente${result.clients === 1 ? "" : "s"}.`);
    } catch (error) {
      showToast(error instanceof SyntaxError ? "El archivo no contiene un JSON válido." : error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "Restaurar respaldo JSON";
    }
  });
  $("#saveSettingsButton").addEventListener("click", saveSettings);
  $("#saveAfkButton").addEventListener("click", saveAfkSettings);
  $("#afkEnabled").addEventListener("change", () => {
    renderAfkStatus({ ...state.settings, afkEnabled: $("#afkEnabled").checked });
  });
  $("#chargeTodayButton").addEventListener("click", async () => {
    if (!confirm("Se enviará la cobranza a todos los clientes activos que vencen hoy y que todavía no fueron cobrados. ¿Continuar?")) return;
    const button = $("#chargeTodayButton");
    button.disabled = true;
    button.textContent = "Enviando cobranzas…";
    try {
      const result = await api("/api/clients/charge-due-today", { method: "POST" });
      const errorText = result.errors.length ? ` ${result.errors.length} no pudieron enviarse.` : "";
      showToast(
        result.totalDue === 0
          ? "No hay clientes que venzan hoy."
          : `${result.sent} cobranza${result.sent === 1 ? "" : "s"} enviada${result.sent === 1 ? "" : "s"}. ${result.alreadyCharged} ya estaba${result.alreadyCharged === 1 ? "" : "n"} cobrada${result.alreadyCharged === 1 ? "" : "s"}.${errorText}`,
        result.errors.length > 0
      );
      await Promise.all([loadClients(), refreshDashboardOnly()]);
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "Cobrar a los que vencen hoy";
    }
  });
  $("#runSchedulerButton").addEventListener("click", async () => {
    const button = $("#runSchedulerButton");
    button.disabled = true;
    button.textContent = "Procesando…";
    try {
      const result = await api("/api/scheduler/run", { method: "POST" });
      showToast(
        result.skipped
          ? "WhatsApp debe estar conectado para procesar vencimientos."
          : `${result.sent} mensaje${result.sent === 1 ? "" : "s"} enviado${result.sent === 1 ? "" : "s"}.`
      );
      await Promise.all([loadClients(), refreshDashboardOnly()]);
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "Procesar vencimientos";
    }
  });
  $("#refreshLogsButton").addEventListener("click", loadLogs);
}

async function init() {
  applyTheme(preferredTheme());
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
  } finally {
    requestAnimationFrame(() => document.body.classList.add("ui-ready"));
  }
}

document.addEventListener("DOMContentLoaded", init);
