"use strict";

const THEME_STORAGE_KEY = "jadrixservs-theme";

const state = {
  clients: [],
  settings: null,
  products: [],
  plans: [],
  lookupClients: [],
  authenticatorAccounts: [],
  catalog: [],
  quickReplies: [],
  knowledgeBase: [],
  countryPriceBooks: [],
  aiStatus: null,
  quickReplyPendingFiles: [],
  accessEntries: [],
  accessAccountId: null,
  authenticatorSecurity: null,
  activeSection: "dashboard",
  loadedSections: new Set(),
  poller: null,
  authenticatorTicker: null,
  authenticatorRefreshPending: false
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
  if (document.documentElement.dataset.theme === "light") return "light";
  return "dark";
}

function applyTheme(theme, persist = false) {
  const nextTheme = theme === "dark" ? "dark" : "light";
  const isDark = nextTheme === "dark";
  document.documentElement.dataset.theme = nextTheme;
  document.documentElement.style.colorScheme = nextTheme;

  const themeMeta = $("#themeColorMeta");
  if (themeMeta) themeMeta.setAttribute("content", isDark ? "#07080f" : "#f3f6fc");

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
  clearInterval(state.authenticatorTicker);
  state.loadedSections.clear();
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

function updateActiveSection(section) {
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
    "ai-training": "IA y entrenamiento",
    "quick-replies": "Respuestas rápidas",
    afk: "Modo AFK",
    catalog: "Catálogo y comandos",
    authenticator: "Autenticador",
    activity: "Actividad"
  };
  $("#pageTitle").textContent = titles[section] || "JadrixServs";
}

function loadSectionData(section) {
  const reportError = (error) => showToast(error.message, true);
  if (section === "clients" && !state.loadedSections.has("clients")) {
    loadClients().catch(reportError);
  }
  if (section === "catalog" && !state.loadedSections.has("catalog")) {
    loadCatalog().catch(reportError);
  }
  if (
    section === "quick-replies" &&
    !state.loadedSections.has("quick-replies")
  ) {
    loadQuickReplies().catch(reportError);
  }
  if (section === "ai-training" && !state.loadedSections.has("settings")) {
    loadSettings().catch(reportError);
  }
  if (section === "activity" && !state.loadedSections.has("activity")) {
    loadLogs().catch(reportError);
  }
  if (
    (section === "messages" || section === "afk") &&
    !state.loadedSections.has("settings")
  ) {
    loadSettings().catch(reportError);
  }
  if (section === "authenticator") {
    loadAuthenticator().catch(reportError);
  } else {
    clearInterval(state.authenticatorTicker);
  }
}

function navigate(section) {
  const currentSection = state.activeSection;
  const target = $(`#section-${section}`);
  if (!target) return;

  setSidebarOpen(false);
  if (currentSection !== section) {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reducedMotion && typeof document.startViewTransition === "function") {
      document.startViewTransition(() => updateActiveSection(section));
    } else {
      updateActiveSection(section);
    }
    window.scrollTo({ top: 0, behavior: "auto" });
  }
  loadSectionData(section);
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
    resetting: ["Cerrando sesión", "amber", status.loadingMessage || "Eliminando las credenciales anteriores."],
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
  state.loadedSections.add("clients");
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

async function copyTextToClipboard(value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("No hay contenido para copiar.");
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const input = document.createElement("textarea");
  input.value = text;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  if (!copied) throw new Error("No se pudo copiar el contenido.");
}

async function copyPhoneToClipboard(phone) {
  const value = String(phone || "").trim();
  if (!value) throw new Error("No hay un número para copiar.");
  await copyTextToClipboard(value);
}

function formatAuthenticatorCode(code) {
  const value = String(code || "");
  if (value.length === 6) return `${value.slice(0, 3)} ${value.slice(3)}`;
  if (value.length === 8) return `${value.slice(0, 4)} ${value.slice(4)}`;
  return value.replace(/(\d{3})(?=\d)/g, "$1 ");
}

function deriveAuthenticatorCommand(value) {
  const slug = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .slice(0, 32);
  return `/${slug.length >= 2 ? slug : "2fa"}`;
}

function authenticatorInitials(account) {
  const source = String(account.service || account.name || "2FA").trim();
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase() || "2F";
}

function renderAuthenticator() {
  const search = $("#authenticatorSearch").value.trim().toLowerCase();
  const accounts = state.authenticatorAccounts.filter((account) =>
    `${account.name} ${account.service} ${account.email} ${account.command}`
      .toLowerCase()
      .includes(search)
  );
  const total = state.authenticatorAccounts.length;
  $("#authenticatorCount").textContent =
    `${total} cuenta${total === 1 ? "" : "s"}`;

  const grid = $("#authenticatorGrid");
  const empty = $("#authenticatorEmpty");
  empty.classList.toggle("hidden", total > 0);

  if (total > 0 && accounts.length === 0) {
    grid.innerHTML = `
      <article class="panel empty-state authenticator-no-results">
        <strong>No hay coincidencias.</strong>
        <span>Prueba con otro nombre, servicio o correo.</span>
      </article>`;
    return;
  }

  grid.innerHTML = accounts.map((account, index) => {
    const code = account.available
      ? formatAuthenticatorCode(account.code)
      : "No disponible";
    const remaining = Number(account.secondsRemaining) || 0;
    return `
      <article class="authenticator-card ${account.available ? "" : "has-error"}" style="--auth-index:${index}">
        <div class="authenticator-card-heading">
          <span class="authenticator-avatar">${escapeHtml(authenticatorInitials(account))}</span>
          <div>
            <span class="pill blue">${escapeHtml(account.service)}</span>
            <h3>${escapeHtml(account.name)}</h3>
            <p>${escapeHtml(account.email)}</p>
          </div>
          <button class="authenticator-menu-button" data-auth-action="edit" data-id="${escapeHtml(account.id)}" type="button" title="Editar cuenta" aria-label="Editar ${escapeHtml(account.name)}">•••</button>
        </div>
        <div class="authenticator-command-row">
          <span>COMANDO PRIVADO</span>
          <code>${escapeHtml(account.command)}</code>
          <button data-auth-action="copy-command" data-id="${escapeHtml(account.id)}" type="button" aria-label="Copiar comando ${escapeHtml(account.command)}">Copiar</button>
        </div>
        <div class="authenticator-code-panel">
          <div class="authenticator-code-label">
            <span>CÓDIGO ACTUAL</span>
            ${account.available
              ? `<span class="authenticator-live"><i></i> En vivo</span>`
              : `<span class="pill red">Revisar clave</span>`}
          </div>
          <div class="authenticator-code-row">
            <strong class="authenticator-code" data-auth-code="${escapeHtml(account.id)}">${escapeHtml(code)}</strong>
            <button class="authenticator-copy" data-auth-action="copy" data-id="${escapeHtml(account.id)}" type="button" ${account.available ? "" : "disabled"} aria-label="Copiar código">
              <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>
            </button>
          </div>
          ${account.available
            ? `<div class="authenticator-timer">
                <progress data-auth-progress="${escapeHtml(account.id)}" max="${escapeHtml(account.period)}" value="${escapeHtml(remaining)}"></progress>
                <span>Nuevo código en <strong data-auth-seconds="${escapeHtml(account.id)}">${escapeHtml(remaining)} s</strong></span>
              </div>`
            : `<p class="authenticator-error">${escapeHtml(account.error || "No se pudo generar el código.")}</p>`}
        </div>
        <div class="authenticator-card-footer">
          <span>${escapeHtml(account.algorithm)} · ${escapeHtml(account.digits)} dígitos · ${escapeHtml(account.period)} s</span>
          <div>
            <button data-auth-action="access" data-id="${escapeHtml(account.id)}" type="button">Accesos</button>
            <button data-auth-action="edit" data-id="${escapeHtml(account.id)}" type="button">Editar</button>
            <button class="danger" data-auth-action="delete" data-id="${escapeHtml(account.id)}" type="button">Eliminar</button>
          </div>
        </div>
      </article>`;
  }).join("");
}

function updateAuthenticatorCountdowns() {
  if (state.activeSection !== "authenticator") return;
  let expired = false;

  for (const account of state.authenticatorAccounts) {
    if (!account.available || !account.expiresAt) continue;
    const seconds = Math.max(
      0,
      Math.ceil((new Date(account.expiresAt).getTime() - Date.now()) / 1000)
    );
    const secondsElement = $(`[data-auth-seconds="${account.id}"]`);
    const progress = $(`[data-auth-progress="${account.id}"]`);
    if (secondsElement) secondsElement.textContent = `${seconds} s`;
    if (progress) progress.value = seconds;
    if (seconds === 0) expired = true;
  }

  if (expired && !state.authenticatorRefreshPending) {
    state.authenticatorRefreshPending = true;
    loadAuthenticator({ silent: true })
      .catch((error) => showToast(error.message, true))
      .finally(() => {
        state.authenticatorRefreshPending = false;
      });
  }
}

function startAuthenticatorTicker() {
  clearInterval(state.authenticatorTicker);
  state.authenticatorTicker = setInterval(updateAuthenticatorCountdowns, 1000);
}

async function loadAuthenticator({ silent = false } = {}) {
  const button = $("#refreshAuthenticatorButton");
  if (!silent) {
    button.disabled = true;
    button.textContent = "Actualizando…";
  }
  try {
    const payload = await api("/api/authenticator");
    state.authenticatorAccounts = payload.accounts || [];
    state.authenticatorSecurity = payload.security || null;
    const securityPill = $("#authenticatorSecurityPill");
    securityPill.textContent = payload.security?.dedicatedKeyConfigured
      ? "Clave dedicada activa"
      : "Cifrado con clave del panel";
    securityPill.className = "pill green";
    const keyNotice = $("#authenticatorKeyNotice");
    const dedicatedKey = Boolean(
      payload.security?.dedicatedKeyConfigured
    );
    keyNotice.classList.toggle("hidden", dedicatedKey);
    keyNotice.innerHTML = dedicatedKey
      ? ""
      : "<strong>Recomendación para Render:</strong> agrega una variable estable llamada <code>AUTHENTICATOR_ENCRYPTION_KEY</code> antes de guardar cuentas. Si no la agregas, el cifrado utiliza tu <code>COOKIE_SECRET</code> actual; no debes cambiarlo después.";
    renderAuthenticator();
    startAuthenticatorTicker();
  } finally {
    if (!silent) {
      button.disabled = false;
      button.textContent = "Actualizar códigos";
    }
  }
}

function openAuthenticatorDialog(account = null) {
  const secretInput = $("#authenticatorSecret");
  $("#authenticatorDialogTitle").textContent = account
    ? "Editar cuenta 2FA"
    : "Nueva cuenta 2FA";
  $("#authenticatorId").value = account?.id || "";
  $("#authenticatorName").value = account?.name || "";
  $("#authenticatorService").value = account?.service || "";
  $("#authenticatorEmail").value = account?.email || "";
  const commandInput = $("#authenticatorCommand");
  commandInput.value =
    account?.command ||
    deriveAuthenticatorCommand(account?.name || "");
  commandInput.dataset.manual = account ? "true" : "false";
  secretInput.value = "";
  secretInput.type = "password";
  secretInput.required = !account;
  secretInput.placeholder = account
    ? "Déjala vacía para conservar la clave actual"
    : "Pega la clave Base32 o el enlace otpauth://";
  $("#authenticatorSecretHelp").textContent = account
    ? "Déjala vacía para conservar la clave actual. Pega una nueva solo si deseas reemplazarla."
    : "Usa la clave de configuración que entrega el servicio, no el código temporal de 6 dígitos.";
  $("#toggleAuthenticatorSecret").textContent = "Mostrar";
  $("#toggleAuthenticatorSecret").setAttribute(
    "aria-label",
    "Mostrar clave secreta"
  );
  $("#authenticatorDialog").showModal();
}

async function saveAuthenticator(event) {
  event.preventDefault();
  const id = $("#authenticatorId").value;
  const button = $("#saveAuthenticatorButton");
  const payload = {
    name: $("#authenticatorName").value,
    service: $("#authenticatorService").value,
    email: $("#authenticatorEmail").value,
    command: $("#authenticatorCommand").value
  };
  const secret = $("#authenticatorSecret").value.trim();
  if (secret) payload.secret = secret;

  button.disabled = true;
  button.textContent = "Guardando…";
  try {
    await api(id ? `/api/authenticator/${id}` : "/api/authenticator", {
      method: id ? "PUT" : "POST",
      body: payload
    });
    $("#authenticatorDialog").close();
    await loadAuthenticator({ silent: true });
    showToast(id ? "Cuenta 2FA actualizada." : "Cuenta 2FA protegida y agregada.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Guardar cuenta";
  }
}

// ─── Respuestas rápidas ────────────────────────────────────────────────
function normalizeQuickReplyCommandInput(value) {
  const raw = String(value || "").trim().toLowerCase();
  const body = raw.startsWith("/") ? raw.slice(1) : raw;
  const clean = body
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]/g, "");
  return clean ? `/${clean.slice(0, 32)}` : "";
}

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function renderQuickReplies() {
  const search = $("#quickReplySearch").value.trim().toLowerCase();
  const items = state.quickReplies.filter((item) =>
    `${item.name} ${item.command} ${(item.texts || []).join(" ")}`
      .toLowerCase()
      .includes(search)
  );
  const total = state.quickReplies.length;
  $("#quickReplyCount").textContent = `${total} respuesta${total === 1 ? "" : "s"}`;
  $("#quickReplyEmpty").classList.toggle("hidden", total > 0);

  const grid = $("#quickReplyGrid");
  if (total > 0 && items.length === 0) {
    grid.innerHTML = `
      <article class="panel empty-state">
        <strong>No hay coincidencias.</strong>
        <span>Prueba con otro nombre, comando o fragmento de texto.</span>
      </article>`;
    return;
  }

  grid.innerHTML = items
    .map((item) => {
      const images = item.images || [];
      const texts = item.texts || [];
      return `
        <article class="quick-reply-card ${item.enabled ? "" : "is-disabled"}">
          <div class="quick-reply-card-top">
            <div>
              <span class="pill ${item.enabled ? "green" : "neutral"}">${item.enabled ? "Activo" : "Inactivo"}</span>
              <h3>${escapeHtml(item.name)}</h3>
            </div>
            <div class="quick-reply-command">
              <code>${escapeHtml(item.command)}</code>
              <button data-quick-reply-action="copy" data-id="${escapeHtml(item.id)}" type="button" aria-label="Copiar ${escapeHtml(item.command)}">Copiar</button>
            </div>
          </div>
          <div class="quick-reply-card-media ${images.length ? "" : "is-empty"}">
            ${images.length
              ? images.slice(0, 3).map((image, index) => `
                  <figure>
                    <img src="${escapeHtml(image.url)}" alt="Vista previa ${index + 1} de ${escapeHtml(item.name)}" loading="lazy">
                    <figcaption>${index + 1}</figcaption>
                  </figure>`).join("")
              : `<span>Sin imágenes</span>`}
            ${images.length > 3 ? `<strong>+${images.length - 3}</strong>` : ""}
          </div>
          <div class="quick-reply-card-sequence">
            <span>${images.length} ${images.length === 1 ? "imagen" : "imágenes"}</span>
            <i aria-hidden="true">+</i>
            <span>primer texto</span>
            ${texts.length > 1 ? `<i aria-hidden="true">→</i><span>${texts.length - 1} separado${texts.length - 1 === 1 ? "" : "s"}</span>` : ""}
          </div>
          <div class="quick-reply-card-copy">
            ${texts.slice(0, 2).map((text, index) => `<p><b>${index === 0 ? "↳" : index + 1}</b><span>${escapeHtml(text)}</span></p>`).join("")}
            ${texts.length > 2 ? `<small>+ ${texts.length - 2} mensaje${texts.length - 2 === 1 ? "" : "s"} más</small>` : ""}
          </div>
          <div class="quick-reply-card-footer">
            <span>Primer texto unido a la última imagen</span>
            <div>
              <button data-quick-reply-action="edit" data-id="${escapeHtml(item.id)}" type="button">Editar</button>
              <button class="danger" data-quick-reply-action="delete" data-id="${escapeHtml(item.id)}" type="button">Eliminar</button>
            </div>
          </div>
        </article>`;
    })
    .join("");
}

async function loadQuickReplies() {
  const payload = await api("/api/quick-replies");
  state.quickReplies = payload.items || [];
  state.loadedSections.add("quick-replies");
  renderQuickReplies();
}

function clearQuickReplyPendingFiles() {
  for (const entry of state.quickReplyPendingFiles) {
    if (entry.url) URL.revokeObjectURL(entry.url);
  }
  state.quickReplyPendingFiles = [];
}

function quickReplyTextValues() {
  return $$("textarea[data-quick-reply-text]", $("#quickReplyTexts")).map(
    (textarea) => textarea.value
  );
}

function renderQuickReplyTextRows(texts = [""]) {
  const values = texts.length ? texts : [""];
  $("#quickReplyTexts").innerHTML = values
    .map(
      (text, index) => `
        <div class="quick-reply-text-row">
          <div class="quick-reply-text-number">${index + 1}</div>
          <label>
            ${index === 0 ? "Mensaje 1 · pie de la imagen" : `Mensaje ${index + 1} · separado`}
            <textarea data-quick-reply-text rows="4" maxlength="4096" placeholder="${index === 0 ? "Este texto aparecerá dentro de la última imagen…" : "Este texto se enviará como un mensaje separado…"}" required>${escapeHtml(text)}</textarea>
            <small>${index === 0 ? "WhatsApp lo mostrará en la misma burbuja que la última imagen." : "Se enviará después de la imagen y de los textos anteriores."}</small>
          </label>
          <div class="quick-reply-text-actions">
            <button data-quick-text-action="up" data-index="${index}" type="button" aria-label="Subir mensaje ${index + 1}" ${index === 0 ? "disabled" : ""}>↑</button>
            <button data-quick-text-action="down" data-index="${index}" type="button" aria-label="Bajar mensaje ${index + 1}" ${index === values.length - 1 ? "disabled" : ""}>↓</button>
            <button class="danger" data-quick-text-action="remove" data-index="${index}" type="button" aria-label="Eliminar mensaje ${index + 1}" ${values.length === 1 ? "disabled" : ""}>×</button>
          </div>
        </div>`
    )
    .join("");
}

function currentQuickReply() {
  const id = $("#quickReplyId").value;
  return state.quickReplies.find((item) => item.id === id) || null;
}

function renderQuickReplyImages() {
  const existing = currentQuickReply()?.images || [];
  $("#quickReplyExistingImages").innerHTML = existing
    .map(
      (image, index) => `
        <figure class="quick-reply-image-item">
          <img src="${escapeHtml(image.url)}" alt="Imagen guardada ${index + 1}" loading="lazy">
          <figcaption><strong>${index + 1}. ${escapeHtml(image.originalName)}</strong><span>${escapeHtml(formatFileSize(image.size))}</span></figcaption>
          <button data-existing-image-delete="${escapeHtml(image.id)}" type="button" aria-label="Eliminar ${escapeHtml(image.originalName)}">×</button>
        </figure>`
    )
    .join("");
  $("#quickReplyPendingImages").innerHTML = state.quickReplyPendingFiles
    .map(
      (entry, index) => `
        <figure class="quick-reply-pending-item">
          <img src="${escapeHtml(entry.url)}" alt="Nueva imagen ${index + 1}">
          <figcaption><strong>${escapeHtml(entry.file.name)}</strong><span>Nueva · ${escapeHtml(formatFileSize(entry.file.size))}</span></figcaption>
          <button data-pending-image-delete="${index}" type="button" aria-label="Quitar ${escapeHtml(entry.file.name)}">×</button>
        </figure>`
    )
    .join("");
  const total = existing.length + state.quickReplyPendingFiles.length;
  $("#quickReplyImageCounter").textContent = `${total} / 6`;
  $("#quickReplyImages").disabled = total >= 6;
}

function openQuickReplyDialog(item = null) {
  clearQuickReplyPendingFiles();
  $("#quickReplyDialogTitle").textContent = item ? "Editar respuesta" : "Nueva respuesta";
  $("#quickReplyId").value = item?.id || "";
  $("#quickReplyName").value = item?.name || "";
  const commandInput = $("#quickReplyCommand");
  commandInput.value = item?.command || "";
  commandInput.dataset.manual = item ? "true" : "false";
  $("#quickReplyEnabled").checked = item ? item.enabled !== false : true;
  $("#quickReplyImages").value = "";
  renderQuickReplyTextRows(item?.texts || [""]);
  renderQuickReplyImages();
  $("#quickReplyDialog").showModal();
}

function closeQuickReplyDialog() {
  clearQuickReplyPendingFiles();
  $("#quickReplyDialog").close();
}

function addQuickReplyFiles(fileList) {
  const existingCount = currentQuickReply()?.images?.length || 0;
  const remaining = 6 - existingCount - state.quickReplyPendingFiles.length;
  const files = [...(fileList || [])];
  if (!files.length || remaining <= 0) return;
  const accepted = [];
  for (const file of files.slice(0, remaining)) {
    if (!new Set(["image/png", "image/jpeg", "image/webp"]).has(file.type)) {
      showToast(`${file.name} no es PNG, JPG ni WEBP.`, true);
      continue;
    }
    if (file.size > 8 * 1024 * 1024) {
      showToast(`${file.name} supera los 8 MB.`, true);
      continue;
    }
    accepted.push({ file, url: URL.createObjectURL(file) });
  }
  state.quickReplyPendingFiles.push(...accepted);
  $("#quickReplyImages").value = "";
  renderQuickReplyImages();
  if (files.length > remaining) {
    showToast("Solo se agregaron las imágenes que caben dentro del límite de 6.", true);
  }
}

async function uploadQuickReplyImage(replyId, file) {
  return api(`/api/quick-replies/${encodeURIComponent(replyId)}/images`, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name)
    },
    body: file
  });
}

async function saveQuickReply(event) {
  event.preventDefault();
  const existingId = $("#quickReplyId").value;
  const existing = currentQuickReply();
  const texts = quickReplyTextValues().map((text) => text.trim()).filter(Boolean);
  const command = normalizeQuickReplyCommandInput($("#quickReplyCommand").value);
  const finalImageCount = (existing?.images?.length || 0) + state.quickReplyPendingFiles.length;
  if (!command || !/^\/[a-z0-9][a-z0-9_-]{1,31}$/.test(command)) {
    showToast("Ingresa un comando válido, por ejemplo /diferencia.", true);
    return;
  }
  if (!finalImageCount) {
    showToast("Agrega al menos una imagen o captura.", true);
    return;
  }
  if (!texts.length) {
    showToast("Agrega al menos un mensaje de texto.", true);
    return;
  }

  const button = $("#saveQuickReplyButton");
  const desiredEnabled = $("#quickReplyEnabled").checked;
  const payload = {
    name: $("#quickReplyName").value,
    command,
    texts,
    enabled: existing?.images?.length ? desiredEnabled : false
  };
  button.disabled = true;
  button.textContent = "Guardando…";
  let replyId = existingId;
  let uploadedCount = 0;
  const pendingEntries = [...state.quickReplyPendingFiles];
  try {
    const saved = await api(
      existingId ? `/api/quick-replies/${encodeURIComponent(existingId)}` : "/api/quick-replies",
      { method: existingId ? "PUT" : "POST", body: payload }
    );
    replyId = saved.id;
    for (let index = 0; index < pendingEntries.length; index += 1) {
      button.textContent = `Subiendo imagen ${index + 1} de ${pendingEntries.length}…`;
      await uploadQuickReplyImage(replyId, pendingEntries[index].file);
      uploadedCount += 1;
    }
    if (desiredEnabled && !payload.enabled) {
      button.textContent = "Activando…";
      await api(`/api/quick-replies/${encodeURIComponent(replyId)}`, {
        method: "PUT",
        body: { ...payload, enabled: true }
      });
    }
    closeQuickReplyDialog();
    await loadQuickReplies();
    showToast(existingId ? "Respuesta rápida actualizada." : "Respuesta rápida creada y activada.");
  } catch (error) {
    if (uploadedCount) {
      const uploaded = state.quickReplyPendingFiles.splice(0, uploadedCount);
      uploaded.forEach((entry) => entry.url && URL.revokeObjectURL(entry.url));
    }
    await loadQuickReplies().catch(() => undefined);
    if (replyId) {
      $("#quickReplyId").value = replyId;
      $("#quickReplyDialogTitle").textContent = "Editar respuesta";
      $("#quickReplyEnabled").checked = false;
      renderQuickReplyImages();
    }
    showToast(
      replyId && !existingId
        ? `${error.message} La respuesta quedó guardada como inactiva para que puedas completarla.`
        : error.message,
      true
    );
  } finally {
    button.disabled = false;
    button.textContent = "Guardar respuesta";
  }
}

// ─── Catálogo y comandos ───────────────────────────────────────────────
function normalizeCommandInput(value) {
  const raw = String(value || "").trim().toLowerCase();
  const body = raw.startsWith("/") ? raw.slice(1) : raw;
  const clean = body
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
  return clean ? `/${clean.slice(0, 32)}` : "";
}

function renderCatalog() {
  const search = $("#catalogSearch").value.trim().toLowerCase();
  const items = state.catalog.filter((item) =>
    `${item.name} ${item.command} ${item.price} ${item.period}`
      .toLowerCase()
      .includes(search)
  );
  const total = state.catalog.length;
  $("#catalogCount").textContent = `${total} producto${total === 1 ? "" : "s"}`;
  $("#catalogEmpty").classList.toggle("hidden", total > 0);

  const grid = $("#catalogGrid");
  if (total > 0 && items.length === 0) {
    grid.innerHTML = `
      <article class="panel empty-state">
        <strong>No hay coincidencias.</strong>
        <span>Prueba con otro nombre o comando.</span>
      </article>`;
    return;
  }

  grid.innerHTML = items
    .map(
      (item) => `
      <article class="catalog-card ${item.commandEnabled === false ? "is-disabled" : ""}">
        <div class="catalog-card-heading">
          <div>
            <span class="pill ${item.itemType === "plan" ? "violet" : "blue"}">${item.itemType === "plan" ? "Plan" : "Producto"}</span>
            <h3>${escapeHtml(item.name)}</h3>
            <p>${escapeHtml(item.period || "Sin vigencia definida")}</p>
          </div>
          <strong class="catalog-price">${escapeHtml(item.price || "—")}</strong>
        </div>
        <div class="authenticator-command-row">
          <span>COMANDO</span>
          <code>${escapeHtml(item.command)}</code>
          <button data-catalog-action="copy" data-id="${escapeHtml(item.id)}" type="button">Copiar</button>
        </div>
        ${item.details ? `<p class="catalog-details">${escapeHtml(item.details)}</p>` : ""}
        ${Array.isArray(item.includes) && item.includes.length
          ? `<ul class="catalog-includes">${item.includes.map((entry) => `<li>${escapeHtml(entry)}</li>`).join("")}</ul>`
          : ""}
        <div class="authenticator-card-footer">
          <span>${item.commandEnabled === false ? "Comando desactivado" : "Comando activo"}</span>
          <div>
            <button data-catalog-action="edit" data-id="${escapeHtml(item.id)}" type="button">Editar</button>
            <button class="danger" data-catalog-action="delete" data-id="${escapeHtml(item.id)}" type="button">Eliminar</button>
          </div>
        </div>
      </article>`
    )
    .join("");
}

async function loadCatalog() {
  const payload = await api("/api/catalog");
  state.catalog = payload.items || [];
  state.loadedSections.add("catalog");
  renderCatalog();
}

function openCatalogDialog(item = null) {
  $("#catalogDialogTitle").textContent = item ? "Editar producto" : "Nuevo producto";
  $("#catalogItemId").value = item?.id || "";
  $("#catalogName").value = item?.name || "";
  $("#catalogType").value = item?.itemType === "plan" ? "plan" : "product";
  $("#catalogPrice").value = item?.price || "";
  $("#catalogPeriod").value = item?.period || "1 mes";
  const commandInput = $("#catalogCommand");
  commandInput.value = item?.command || "";
  commandInput.dataset.manual = item ? "true" : "false";
  $("#catalogAliases").value = Array.isArray(item?.aliases) ? item.aliases.join(", ") : "";
  $("#catalogDetails").value = item?.details || "";
  $("#catalogIncludes").value = Array.isArray(item?.includes) ? item.includes.join(", ") : "";
  $("#catalogEnabled").checked = item ? item.commandEnabled !== false : true;
  $("#catalogDialog").showModal();
}

async function saveCatalogItem(event) {
  event.preventDefault();
  const id = $("#catalogItemId").value;
  const button = $("#saveCatalogButton");
  const splitList = (value) =>
    String(value || "")
      .split(/[,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  const payload = {
    name: $("#catalogName").value,
    itemType: $("#catalogType").value,
    price: $("#catalogPrice").value,
    period: $("#catalogPeriod").value,
    command: normalizeCommandInput($("#catalogCommand").value),
    aliases: splitList($("#catalogAliases").value),
    details: $("#catalogDetails").value,
    includes: splitList($("#catalogIncludes").value),
    commandEnabled: $("#catalogEnabled").checked
  };
  if (!payload.command) {
    showToast("Ingresa un comando válido, por ejemplo /claudepro.", true);
    return;
  }
  button.disabled = true;
  button.textContent = "Guardando…";
  try {
    await api(id ? `/api/catalog/${id}` : "/api/catalog", {
      method: id ? "PUT" : "POST",
      body: payload
    });
    $("#catalogDialog").close();
    await loadCatalog();
    await loadSettings().catch(() => undefined);
    showToast(id ? "Producto actualizado." : "Producto agregado al catálogo.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Guardar producto";
  }
}

// ─── Accesos 2FA de clientes ───────────────────────────────────────────
function renderAccessList() {
  const list = $("#accessList");
  if (!state.accessEntries.length) {
    list.innerHTML = `<p class="muted access-empty">Todavía no hay clientes autorizados en esta cuenta.</p>`;
    return;
  }
  list.innerHTML = state.accessEntries
    .map(
      (entry) => `
      <div class="access-row ${entry.active ? "" : "is-off"}">
        <div>
          <strong>${escapeHtml(entry.name || "Cliente")}</strong>
          <span class="muted">+${escapeHtml(entry.whatsapp)}</span>
          <span class="muted">${entry.dailyLimit ? `${escapeHtml(entry.dailyLimit)} códigos/día` : "Sin límite diario"}${entry.expiresAt ? ` · vence ${escapeHtml(entry.expiresAt)}` : ""}</span>
        </div>
        <div class="access-row-actions">
          <span class="pill ${entry.active ? "green" : "red"}">${entry.active ? "Activo" : "Inactivo"}</span>
          <button data-access-action="edit" data-id="${escapeHtml(entry.id)}" type="button">Editar</button>
          <button class="danger" data-access-action="delete" data-id="${escapeHtml(entry.id)}" type="button">Quitar</button>
        </div>
      </div>`
    )
    .join("");
}

function resetAccessForm() {
  $("#accessId").value = "";
  $("#accessName").value = "";
  $("#accessWhatsapp").value = "";
  $("#accessExpiresAt").value = "";
  $("#accessDailyLimit").value = "";
  $("#accessNotes").value = "";
  $("#accessActive").checked = true;
  $("#saveAccessButton").textContent = "Autorizar cliente";
  $("#accessCancelEditButton").classList.add("hidden");
}

async function loadAccess(accountId) {
  const payload = await api(`/api/authenticator/access?accountId=${encodeURIComponent(accountId)}`);
  state.accessEntries = payload.access || [];
  renderAccessList();
}

async function openAccessDialog(account) {
  state.accessAccountId = account.id;
  $("#accessAccountId").value = account.id;
  $("#accessDialogTitle").textContent = `Accesos · ${account.name}`;
  $("#accessCommandHint").textContent = account.command;
  resetAccessForm();
  state.accessEntries = [];
  renderAccessList();
  $("#accessDialog").showModal();
  try {
    await loadAccess(account.id);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function saveAccess(event) {
  event.preventDefault();
  const accountId = $("#accessAccountId").value;
  const id = $("#accessId").value;
  const button = $("#saveAccessButton");
  const payload = {
    name: $("#accessName").value,
    whatsapp: $("#accessWhatsapp").value,
    expiresAt: $("#accessExpiresAt").value || null,
    dailyLimit: Number($("#accessDailyLimit").value) || 0,
    active: $("#accessActive").checked,
    notes: $("#accessNotes").value
  };
  button.disabled = true;
  button.textContent = "Guardando…";
  try {
    await api(
      id ? `/api/authenticator/access/${id}` : `/api/authenticator/${accountId}/access`,
      { method: id ? "PUT" : "POST", body: payload }
    );
    resetAccessForm();
    await loadAccess(accountId);
    showToast(id ? "Acceso actualizado." : "Cliente autorizado para pedir el código 2FA.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = $("#accessId").value ? "Guardar cambios" : "Autorizar cliente";
  }
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

const COUNTRY_GREETING_PRESETS = {
  peru: { country: "Perú", callingCode: "+51", currency: "PEN (S/)" },
  argentina: { country: "Argentina", callingCode: "+54", currency: "ARS ($)" },
  mexico: { country: "México", callingCode: "+52", currency: "MXN ($)" },
  colombia: { country: "Colombia", callingCode: "+57", currency: "COP ($)" },
  chile: { country: "Chile", callingCode: "+56", currency: "CLP ($)" },
  ecuador: { country: "Ecuador", callingCode: "+593", currency: "USD ($)" },
  bolivia: { country: "Bolivia", callingCode: "+591", currency: "BOB (Bs)" },
  brasil: { country: "Brasil", callingCode: "+55", currency: "BRL (R$)" },
  uruguay: { country: "Uruguay", callingCode: "+598", currency: "UYU ($)" },
  paraguay: { country: "Paraguay", callingCode: "+595", currency: "PYG (₲)" },
  venezuela: { country: "Venezuela", callingCode: "+58", currency: "USD ($)" },
  guatemala: { country: "Guatemala", callingCode: "+502", currency: "GTQ (Q)" },
  "el salvador": { country: "El Salvador", callingCode: "+503", currency: "USD ($)" },
  honduras: { country: "Honduras", callingCode: "+504", currency: "HNL (L)" },
  nicaragua: { country: "Nicaragua", callingCode: "+505", currency: "NIO (C$)" },
  "costa rica": { country: "Costa Rica", callingCode: "+506", currency: "CRC (₡)" },
  panama: { country: "Panamá", callingCode: "+507", currency: "USD ($)" },
  "republica dominicana": { country: "República Dominicana", callingCode: "+1809", currency: "DOP (RD$)" },
  "estados unidos": { country: "Estados Unidos", callingCode: "+1", currency: "USD ($)" },
  espana: { country: "España", callingCode: "+34", currency: "EUR (€)" }
};

function countryGreetingKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function normalizeCallingCodeInput(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 6);
  return digits ? `+${digits}` : "";
}

function countryGreetings() {
  return Array.isArray(state.settings?.countryGreetings)
    ? state.settings.countryGreetings
    : [];
}

function renderCountryGreetings() {
  const grid = $("#countryGreetingGrid");
  const empty = $("#countryGreetingEmpty");
  if (!grid || !empty) return;
  const profiles = [...countryGreetings()].sort((first, second) =>
    String(first.country).localeCompare(String(second.country), "es")
  );
  empty.classList.toggle("hidden", profiles.length > 0);
  grid.classList.toggle("hidden", profiles.length === 0);
  grid.innerHTML = profiles.map((profile) => {
    const preview = (profile.messages || [])[0] || "";
    return `
      <article class="country-greeting-card ${profile.enabled === false ? "is-disabled" : ""}">
        <div class="country-greeting-card-top">
          <span class="country-prefix">${escapeHtml(profile.callingCode)}</span>
          <span class="pill ${profile.enabled === false ? "neutral" : "green"}">${profile.enabled === false ? "Inactiva" : "Activa"}</span>
        </div>
        <div class="country-greeting-card-title">
          <div class="country-monogram" aria-hidden="true">${escapeHtml(String(profile.country || "P").charAt(0).toUpperCase())}</div>
          <div><h4>${escapeHtml(profile.country)}</h4><span>${escapeHtml(profile.currency)}</span></div>
        </div>
        <p class="country-message-preview">${escapeHtml(preview)}</p>
        <div class="country-greeting-card-footer">
          <span>3 mensajes · coincidencia ${escapeHtml(profile.callingCode)}</span>
          <div>
            <button class="button secondary compact-button" data-country-greeting-action="edit" data-id="${escapeHtml(profile.id)}" type="button">Editar</button>
            <button class="button danger-ghost compact-button" data-country-greeting-action="delete" data-id="${escapeHtml(profile.id)}" type="button">Eliminar</button>
          </div>
        </div>
      </article>`;
  }).join("");
}

function applyCountryGreetingPreset() {
  const preset = COUNTRY_GREETING_PRESETS[
    countryGreetingKey($("#countryGreetingCountry").value)
  ];
  if (!preset) return;
  $("#countryGreetingCountry").value = preset.country;
  $("#countryGreetingCallingCode").value = preset.callingCode;
  $("#countryGreetingCurrency").value = preset.currency;
}

function openCountryGreetingDialog(profile = null) {
  if (!state.settings) {
    showToast("Espera a que termine de cargar la configuración.", true);
    return;
  }
  const fallback = [
    $("#greeting1")?.value || state.settings.greetingMessages?.[0] || "",
    $("#greeting2")?.value || state.settings.greetingMessages?.[1] || "",
    $("#greeting3")?.value || state.settings.greetingMessages?.[2] || ""
  ];
  const messages = profile?.messages || fallback;
  $("#countryGreetingDialogTitle").textContent = profile
    ? `Editar ${profile.country}`
    : "Agregar país";
  $("#countryGreetingId").value = profile?.id || "";
  $("#countryGreetingCountry").value = profile?.country || "";
  $("#countryGreetingCallingCode").value = profile?.callingCode || "";
  $("#countryGreetingCurrency").value = profile?.currency || "";
  $("#countryGreeting1").value = messages[0] || "";
  $("#countryGreeting2").value = messages[1] || "";
  $("#countryGreeting3").value = messages[2] || "";
  $("#countryGreetingEnabled").checked = profile?.enabled !== false;
  $("#saveCountryGreetingButton").textContent = profile
    ? "Guardar cambios"
    : "Guardar país";
  $("#countryGreetingDialog").showModal();
  requestAnimationFrame(() => $("#countryGreetingCountry").focus());
}

async function saveCountryGreeting(event) {
  event.preventDefault();
  const id = $("#countryGreetingId").value;
  const callingCode = normalizeCallingCodeInput(
    $("#countryGreetingCallingCode").value
  );
  $("#countryGreetingCallingCode").value = callingCode;
  const duplicate = countryGreetings().find(
    (profile) => profile.id !== id && profile.callingCode === callingCode
  );
  if (duplicate) {
    showToast(`El prefijo ${callingCode} ya pertenece a ${duplicate.country}.`, true);
    return;
  }
  const previous = countryGreetings().find((profile) => profile.id === id);
  const now = new Date().toISOString();
  const nextProfile = {
    ...(previous || {}),
    ...(id ? { id } : {}),
    country: $("#countryGreetingCountry").value.trim(),
    callingCode,
    currency: $("#countryGreetingCurrency").value.trim(),
    enabled: $("#countryGreetingEnabled").checked,
    messages: [
      $("#countryGreeting1").value,
      $("#countryGreeting2").value,
      $("#countryGreeting3").value
    ],
    createdAt: previous?.createdAt || now,
    updatedAt: now
  };
  const profiles = previous
    ? countryGreetings().map((profile) =>
        profile.id === previous.id ? nextProfile : profile
      )
    : [...countryGreetings(), nextProfile];
  const button = $("#saveCountryGreetingButton");
  button.disabled = true;
  button.textContent = "Guardando…";
  try {
    const payload = await api("/api/settings", {
      method: "PUT",
      body: { countryGreetings: profiles }
    });
    state.settings = payload.settings;
    renderCountryGreetings();
    $("#countryGreetingDialog").close();
    showToast(
      previous
        ? `Bienvenida de ${nextProfile.country} actualizada.`
        : `Bienvenida de ${nextProfile.country} creada.`
    );
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = previous ? "Guardar cambios" : "Guardar país";
  }
}

async function deleteCountryGreeting(profile) {
  if (!confirm(`¿Eliminar la bienvenida de ${profile.country} (${profile.callingCode})? Los contactos de ese país recibirán la bienvenida predeterminada.`)) return;
  try {
    const payload = await api("/api/settings", {
      method: "PUT",
      body: {
        countryGreetings: countryGreetings().filter(
          (item) => item.id !== profile.id
        )
      }
    });
    state.settings = payload.settings;
    renderCountryGreetings();
    showToast(`Bienvenida de ${profile.country} eliminada.`);
  } catch (error) {
    showToast(error.message, true);
  }
}

function renderAiStatus(ai = {}) {
  if (!$("#aiStatusPill")) return;
  state.aiStatus = ai;
  const active = Boolean(ai.replyEnabled);
  const configured = Boolean(ai.configured || ai.keyConfigured);
  const hasError = Boolean(ai.lastError);
  const pill = $("#aiStatusPill");
  pill.className = `pill ${hasError ? "red" : active ? "green" : configured ? "blue" : "violet"}`;
  pill.textContent = hasError
    ? "Requiere atención"
    : active
      ? "Respuestas activas"
      : configured
        ? "Listo para activar"
        : "Falta API key";
  $("#aiProviderText").textContent = ai.provider === "openai" ? "OpenAI" : "Google Gemini";
  $("#aiModelText").textContent = ai.model || "gemini-3.6-flash";
  $("#aiKeyText").textContent = ai.keyConfigured
    ? ai.encryptedAtRest
      ? "Cifrada en el panel"
      : "Variable de entorno"
    : "Sin configurar";
  $("#geminiModel").value = ai.provider === "gemini" && ai.model
    ? ai.model
    : "gemini-3.6-flash";
  $("#aiReplyEnabled").checked = active || Boolean(ai.requestedEnabled);
  $("#deleteGeminiKeyButton").classList.toggle(
    "hidden",
    !ai.keyConfigured || ai.keySource !== "panel_encrypted"
  );
  $("#geminiKeyHelp").textContent = ai.keyConfigured
    ? "Ya existe una clave configurada. Deja este campo vacío para conservarla."
    : "La clave se cifra antes de guardarse y nunca vuelve al navegador.";
  const notice = $("#aiConfigurationNotice");
  notice.classList.toggle("error-notice", hasError);
  notice.classList.toggle("success-notice", active && !hasError);
  notice.textContent = hasError
    ? ai.lastError
    : active
      ? "Gemini está activo y responderá después de la bienvenida inicial."
      : configured
        ? "La conexión está configurada. Activa el interruptor y guarda cuando quieras usarla."
        : "Guarda una API key para habilitar las respuestas con IA.";
}

function renderKnowledgeBase() {
  if (!$("#knowledgeList")) return;
  const entries = Array.isArray(state.knowledgeBase) ? state.knowledgeBase : [];
  $("#knowledgeCount").textContent = `${entries.length} recuerdo${entries.length === 1 ? "" : "s"}`;
  $("#knowledgeEmpty").classList.toggle("hidden", entries.length > 0);
  $("#knowledgeList").innerHTML = entries.map((entry, index) => `
    <article class="knowledge-card" data-knowledge-id="${escapeHtml(entry.id || "")}">
      <div class="knowledge-card-heading">
        <span class="knowledge-number">${index + 1}</span>
        <strong>${escapeHtml(entry.title || "Nueva respuesta")}</strong>
        <label class="knowledge-enabled">
          <input data-knowledge-enabled type="checkbox" ${entry.enabled === false ? "" : "checked"}>
          Activa
        </label>
        <button class="button danger-ghost knowledge-remove" data-knowledge-remove type="button">Eliminar</button>
      </div>
      <div class="knowledge-fields">
        <label>Pregunta o tema<input data-knowledge-title type="text" maxlength="120" value="${escapeHtml(entry.title || "")}" placeholder="Ejemplo: Precio y entrega de ChatGPT Pro"></label>
        <label>Frases parecidas del cliente<textarea data-knowledge-triggers rows="4" placeholder="cuánto cuesta, precio, cómo lo entregan">${escapeHtml((entry.triggers || []).join(", "))}</textarea><small>Sepáralas con comas o saltos de línea.</small></label>
        <label>Respuesta modelo completa<textarea data-knowledge-answer rows="5" maxlength="3000" placeholder="Escribe exactamente cómo debe responder Gemini...">${escapeHtml(entry.answer || "")}</textarea><small>Incluye todos los detalles que no deben quedar incompletos.</small></label>
      </div>
    </article>
  `).join("");
}

function renderCountryPriceBooks() {
  const container = $("#countryPriceBookList");
  if (!container) return;
  const books = Array.isArray(state.countryPriceBooks)
    ? [...state.countryPriceBooks].sort((first, second) =>
        String(first.callingCode || "").localeCompare(String(second.callingCode || ""))
      )
    : [];
  const catalogItems = [
    ...state.products.map((item) => ({ ...item, itemType: "Producto" })),
    ...state.plans.map((item) => ({ ...item, itemType: "Plan" }))
  ];
  $("#countryPriceBookCount").textContent = `${books.length} país${books.length === 1 ? "" : "es"}`;
  container.innerHTML = books.map((book, index) => `
    <details class="country-price-book" data-price-book-id="${escapeHtml(book.id)}" ${index === 0 ? "open" : ""}>
      <summary>
        <span class="country-prefix">${escapeHtml(book.callingCode)}</span>
        <span class="country-price-title"><strong>${escapeHtml(book.country)}</strong><small>${escapeHtml(book.currency)} · ${escapeHtml(book.symbol)}</small></span>
        <span class="pill ${book.enabled === false ? "red" : "green"}">${book.enabled === false ? "Desactivada" : "Activa"}</span>
        <span class="country-price-chevron" aria-hidden="true">›</span>
      </summary>
      <div class="country-price-body">
        <label class="toggle-row country-price-toggle">
          <input data-price-book-enabled type="checkbox" ${book.enabled === false ? "" : "checked"}>
          <span><strong>Usar precios de ${escapeHtml(book.country)}</strong><small>Se aplican a clientes cuyo número empieza con ${escapeHtml(book.callingCode)}.</small></span>
        </label>
        <div class="country-price-table" role="table" aria-label="Precios de ${escapeHtml(book.country)}">
          <div class="country-price-row country-price-header" role="row">
            <span role="columnheader">Servicio</span><span role="columnheader">Duración</span><span role="columnheader">Precio local exacto</span>
          </div>
          ${catalogItems.map((item) => `
            <label class="country-price-row" role="row">
              <span role="cell"><small>${escapeHtml(item.itemType)}</small><strong>${escapeHtml(item.name)}</strong></span>
              <span role="cell">${escapeHtml(item.period || "")}</span>
              <input role="cell" data-price-item-id="${escapeHtml(item.id)}" type="text" maxlength="160" value="${escapeHtml(book.prices?.[item.id] || "")}" placeholder="${escapeHtml(book.symbol)}0">
            </label>
          `).join("")}
        </div>
      </div>
    </details>
  `).join("");
}

function countryPriceBooksFromForm() {
  return $$(".country-price-book", $("#countryPriceBookList")).map((card) => {
    const original = state.countryPriceBooks.find(
      (book) => String(book.id) === String(card.dataset.priceBookId)
    ) || {};
    const prices = Object.fromEntries(
      $$("[data-price-item-id]", card)
        .map((input) => [input.dataset.priceItemId, input.value.trim()])
        .filter(([, price]) => price)
    );
    return {
      id: original.id,
      country: original.country,
      callingCode: original.callingCode,
      currency: original.currency,
      symbol: original.symbol,
      enabled: $("[data-price-book-enabled]", card).checked,
      prices
    };
  });
}

function knowledgeFromForm() {
  return $$(".knowledge-card", $("#knowledgeList")).map((card) => ({
    id: card.dataset.knowledgeId || undefined,
    title: $("[data-knowledge-title]", card).value.trim(),
    triggers: $("[data-knowledge-triggers]", card).value
      .split(/[\n,]+/)
      .map((value) => value.trim())
      .filter(Boolean),
    answer: $("[data-knowledge-answer]", card).value.trim(),
    enabled: $("[data-knowledge-enabled]", card).checked
  }));
}

function addKnowledgeEntry(entry = {}) {
  state.knowledgeBase = knowledgeFromForm();
  state.knowledgeBase.push({
    id: entry.id || (globalThis.crypto?.randomUUID?.() || `knowledge-${Date.now()}`),
    title: entry.title || "",
    triggers: entry.triggers || [],
    answer: entry.answer || "",
    enabled: entry.enabled !== false
  });
  renderKnowledgeBase();
  const lastCard = $$(".knowledge-card", $("#knowledgeList")).at(-1);
  lastCard?.scrollIntoView({ behavior: "smooth", block: "center" });
  $("[data-knowledge-title]", lastCard)?.focus();
}

async function saveGeminiConfiguration() {
  const apiKey = $("#geminiApiKey").value.trim();
  const body = {
    model: $("#geminiModel").value.trim() || "gemini-3.6-flash",
    enabled: $("#aiReplyEnabled").checked
  };
  if (apiKey) body.apiKey = apiKey;
  const payload = await api("/api/ai/config", { method: "PUT", body });
  $("#geminiApiKey").value = "";
  renderAiStatus(payload.ai);
  return payload.ai;
}

async function saveAiSettings() {
  const button = $("#saveAiButton");
  button.disabled = true;
  button.textContent = "Guardando…";
  try {
    const settingsPayload = await api("/api/settings", {
      method: "PUT",
      body: {
        peruPayment: $("#aiPeruPayment").value,
        internationalPayment: $("#aiInternationalPayment").value,
        aiInstructions: $("#aiInstructions").value,
        knowledgeBase: knowledgeFromForm(),
        countryPriceBooks: countryPriceBooksFromForm()
      }
    });
    state.settings = settingsPayload.settings;
    state.knowledgeBase = settingsPayload.knowledgeBase;
    state.countryPriceBooks = settingsPayload.countryPriceBooks || [];
    renderKnowledgeBase();
    renderCountryPriceBooks();
    await saveGeminiConfiguration();
    showToast("Configuración y entrenamiento de Gemini guardados.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "Guardar configuración";
  }
}

async function testAiConnection() {
  const button = $("#testAiButton");
  button.disabled = true;
  button.textContent = "Probando…";
  try {
    if ($("#geminiApiKey").value.trim()) await saveGeminiConfiguration();
    const result = await api("/api/ai/test", { method: "POST" });
    renderAiStatus({
      ...(state.aiStatus || {}),
      provider: result.provider || state.aiStatus?.provider,
      model: result.model || state.aiStatus?.model,
      lastSuccessAt: result.testedAt,
      lastError: null,
      lastErrorType: null,
      health: "ready"
    });
    showToast(`Conexión correcta con ${result.model || "Gemini"}.`);
  } catch (error) {
    showToast(error.message, true);
    await loadSettings().catch(() => undefined);
  } finally {
    button.disabled = false;
    button.textContent = "Probar conexión";
  }
}

async function deleteGeminiKey() {
  if (!confirm("¿Eliminar la API key guardada? Las respuestas con IA quedarán desactivadas.")) return;
  try {
    const payload = await api("/api/ai/key", { method: "DELETE" });
    $("#geminiApiKey").value = "";
    renderAiStatus(payload.ai);
    showToast("API key de Gemini eliminada.");
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadSettings() {
  const payload = await api("/api/settings");
  state.settings = payload.settings;
  state.products = payload.products;
  state.plans = payload.plans;
  state.knowledgeBase = payload.knowledgeBase || [];
  state.countryPriceBooks = payload.countryPriceBooks || [];
  state.aiStatus = payload.ai || null;
  state.loadedSections.add("settings");
  $("#greeting1").value = payload.settings.greetingMessages[0] || "";
  $("#greeting2").value = payload.settings.greetingMessages[1] || "";
  $("#greeting3").value = payload.settings.greetingMessages[2] || "";
  $("#reminderTemplate").value = payload.settings.reminderTemplate || "";
  $("#chargeTemplate").value = payload.settings.chargeTemplate || "";
  $("#chargeStartTime").value = payload.settings.chargeStartTime || "09:00";
  if ($("#reminderStartTime")) {
    $("#reminderStartTime").value =
      payload.settings.reminderStartTime || payload.settings.chargeStartTime || "09:00";
  }
  $("#afkEnabled").checked = Boolean(payload.settings.afkEnabled);
  $("#afkMessage").value = payload.settings.afkMessage || "";
  renderAfkStatus(payload.settings);
  renderCountryGreetings();
  $("#aiPeruPayment").value = payload.settings.peruPayment || "";
  $("#aiInternationalPayment").value = payload.settings.internationalPayment || "";
  $("#aiInstructions").value = payload.settings.aiInstructions || "";
  renderAiStatus(payload.ai || {});
  renderKnowledgeBase();
  renderCountryPriceBooks();
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
        chargeStartTime: $("#chargeStartTime").value,
        reminderStartTime: $("#reminderStartTime")
          ? $("#reminderStartTime").value
          : $("#chargeStartTime").value
      }
    });
    state.settings = payload.settings;
    renderCountryGreetings();
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
    "quick-reply": "Respuesta rápida",
    ai: "Gemini IA",
    training: "Entrenamiento IA",
    pricing: "Precios por país",
    client: "Cliente",
    authenticator: "Autenticador",
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
  state.loadedSections.add("activity");
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
    if (!confirm("Se cerrará únicamente la sesión de WhatsApp y se generará un QR nuevo. Tus clientes, planes y mensajes no se eliminarán. ¿Continuar?")) return;
    const button = $("#resetWaButton");
    button.disabled = true;
    button.textContent = "Cerrando sesión…";
    try {
      const result = await api("/api/whatsapp/reset", { method: "POST" });
      if (result.status) renderWhatsApp(result.status);
      showToast(result.message || "Sesión cerrada. Esperando QR nuevo.");
      for (const delay of [500, 1500, 3000, 6000]) {
        setTimeout(refreshWhatsAppStatus, delay);
      }
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "Cerrar sesión";
    }
  });
  $("#newClientButton").addEventListener("click", () => openClientDialog());
  $("#newAuthenticatorButton").addEventListener("click", () =>
    openAuthenticatorDialog()
  );
  $$("[data-authenticator-new]").forEach((button) =>
    button.addEventListener("click", () => openAuthenticatorDialog())
  );
  $("#refreshAuthenticatorButton").addEventListener("click", async () => {
    try {
      await loadAuthenticator();
      showToast("Códigos 2FA actualizados.");
    } catch (error) {
      showToast(error.message, true);
    }
  });
  $("#authenticatorSearch").addEventListener("input", renderAuthenticator);
  $("#authenticatorForm").addEventListener("submit", saveAuthenticator);
  $("#authenticatorName").addEventListener("input", () => {
    const commandInput = $("#authenticatorCommand");
    if (
      $("#authenticatorId").value ||
      commandInput.dataset.manual === "true"
    ) {
      return;
    }
    commandInput.value = deriveAuthenticatorCommand(
      $("#authenticatorName").value
    );
  });
  $("#authenticatorCommand").addEventListener("input", () => {
    $("#authenticatorCommand").dataset.manual = "true";
  });
  $$(".authenticator-close").forEach((button) =>
    button.addEventListener("click", () => $("#authenticatorDialog").close())
  );
  $("#toggleAuthenticatorSecret").addEventListener("click", () => {
    const input = $("#authenticatorSecret");
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    $("#toggleAuthenticatorSecret").textContent = showing ? "Mostrar" : "Ocultar";
    $("#toggleAuthenticatorSecret").setAttribute(
      "aria-label",
      showing ? "Mostrar clave secreta" : "Ocultar clave secreta"
    );
  });
  $("#authenticatorGrid").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-auth-action]");
    if (!button) return;
    const account = state.authenticatorAccounts.find(
      (item) => item.id === button.dataset.id
    );
    if (!account) return;

    if (button.dataset.authAction === "copy") {
      try {
        await copyTextToClipboard(account.code);
        showToast(`Código de ${account.service} copiado.`);
      } catch (error) {
        showToast(error.message, true);
      }
      return;
    }

    if (button.dataset.authAction === "copy-command") {
      try {
        await copyTextToClipboard(account.command);
        showToast(`Comando ${account.command} copiado.`);
      } catch (error) {
        showToast(error.message, true);
      }
      return;
    }

    if (button.dataset.authAction === "access") {
      await openAccessDialog(account);
      return;
    }

    if (button.dataset.authAction === "edit") {
      openAuthenticatorDialog(account);
      return;
    }

    if (button.dataset.authAction === "delete") {
      if (
        !confirm(
          `¿Eliminar la cuenta 2FA “${account.name}” de ${account.service}? Esta acción elimina su clave cifrada del Autenticador.`
        )
      ) {
        return;
      }
      try {
        await api(`/api/authenticator/${account.id}`, { method: "DELETE" });
        await loadAuthenticator({ silent: true });
        showToast("Cuenta 2FA eliminada.");
      } catch (error) {
        showToast(error.message, true);
      }
    }
  });
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
  $("#saveAiButton").addEventListener("click", saveAiSettings);
  $("#testAiButton").addEventListener("click", testAiConnection);
  $("#deleteGeminiKeyButton").addEventListener("click", deleteGeminiKey);
  $("#toggleGeminiKeyButton").addEventListener("click", () => {
    const field = $("#geminiApiKey");
    const button = $("#toggleGeminiKeyButton");
    const visible = field.type === "password";
    field.type = visible ? "text" : "password";
    button.textContent = visible ? "Ocultar" : "Mostrar";
    button.setAttribute("aria-pressed", String(visible));
    field.focus();
  });
  $("#addKnowledgeButton").addEventListener("click", () => addKnowledgeEntry());
  $("#countryPriceBookList").addEventListener("change", (event) => {
    if (!event.target.matches("[data-price-book-enabled]")) return;
    const card = event.target.closest(".country-price-book");
    const status = card?.querySelector("summary .pill");
    if (!status) return;
    status.textContent = event.target.checked ? "Activa" : "Desactivada";
    status.className = `pill ${event.target.checked ? "green" : "red"}`;
  });
  $("#knowledgeList").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-knowledge-remove]");
    if (!button) return;
    const cards = $$(".knowledge-card", $("#knowledgeList"));
    const card = button.closest(".knowledge-card");
    const index = cards.indexOf(card);
    state.knowledgeBase = knowledgeFromForm();
    if (index >= 0) state.knowledgeBase.splice(index, 1);
    renderKnowledgeBase();
  });
  $("#knowledgeList").addEventListener("input", (event) => {
    if (!event.target.matches("[data-knowledge-title]")) return;
    const heading = event.target.closest(".knowledge-card")?.querySelector(".knowledge-card-heading strong");
    if (heading) heading.textContent = event.target.value.trim() || "Nueva respuesta";
  });
  $("#newCountryGreetingButton").addEventListener("click", () =>
    openCountryGreetingDialog()
  );
  $$('[data-country-greeting-new]').forEach((button) =>
    button.addEventListener("click", () => openCountryGreetingDialog())
  );
  $("#countryGreetingForm").addEventListener("submit", saveCountryGreeting);
  $$(".country-greeting-close").forEach((button) =>
    button.addEventListener("click", () => $("#countryGreetingDialog").close())
  );
  $("#countryGreetingCountry").addEventListener(
    "input",
    applyCountryGreetingPreset
  );
  $("#countryGreetingCallingCode").addEventListener("blur", () => {
    $("#countryGreetingCallingCode").value = normalizeCallingCodeInput(
      $("#countryGreetingCallingCode").value
    );
  });
  $("#countryGreetingGrid").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-country-greeting-action]");
    if (!button) return;
    const profile = countryGreetings().find(
      (item) => item.id === button.dataset.id
    );
    if (!profile) return;
    if (button.dataset.countryGreetingAction === "edit") {
      openCountryGreetingDialog(profile);
      return;
    }
    if (button.dataset.countryGreetingAction === "delete") {
      await deleteCountryGreeting(profile);
    }
  });
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

  $("#newQuickReplyButton").addEventListener("click", () =>
    openQuickReplyDialog()
  );
  $$('[data-quick-reply-new]').forEach((button) =>
    button.addEventListener("click", () => openQuickReplyDialog())
  );
  $("#refreshQuickRepliesButton").addEventListener("click", async () => {
    try {
      await loadQuickReplies();
      showToast("Respuestas rápidas actualizadas.");
    } catch (error) {
      showToast(error.message, true);
    }
  });
  $("#quickReplySearch").addEventListener("input", renderQuickReplies);
  $("#quickReplyForm").addEventListener("submit", saveQuickReply);
  $("#quickReplyName").addEventListener("input", () => {
    const commandInput = $("#quickReplyCommand");
    if ($("#quickReplyId").value || commandInput.dataset.manual === "true") return;
    commandInput.value = normalizeQuickReplyCommandInput(
      $("#quickReplyName").value
    );
  });
  $("#quickReplyCommand").addEventListener("input", () => {
    $("#quickReplyCommand").dataset.manual = "true";
  });
  $$(".quick-reply-close").forEach((button) =>
    button.addEventListener("click", closeQuickReplyDialog)
  );
  $("#quickReplyImages").addEventListener("change", (event) =>
    addQuickReplyFiles(event.target.files)
  );
  $("#quickReplyPendingImages").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-pending-image-delete]");
    if (!button) return;
    const index = Number(button.dataset.pendingImageDelete);
    const [deleted] = state.quickReplyPendingFiles.splice(index, 1);
    if (deleted?.url) URL.revokeObjectURL(deleted.url);
    renderQuickReplyImages();
  });
  $("#quickReplyExistingImages").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-existing-image-delete]");
    const reply = currentQuickReply();
    if (!button || !reply) return;
    if (!confirm("¿Eliminar esta imagen de la secuencia?")) return;
    button.disabled = true;
    try {
      await api(
        `/api/quick-replies/${encodeURIComponent(reply.id)}/images/${encodeURIComponent(button.dataset.existingImageDelete)}`,
        { method: "DELETE" }
      );
      await loadQuickReplies();
      renderQuickReplyImages();
      const refreshed = currentQuickReply();
      if (refreshed && !refreshed.images.length) {
        $("#quickReplyEnabled").checked = false;
      }
      showToast("Imagen eliminada de la secuencia.");
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
  $("#addQuickReplyTextButton").addEventListener("click", () => {
    const values = quickReplyTextValues();
    if (values.length >= 10) {
      showToast("Puedes agregar hasta 10 mensajes de texto.", true);
      return;
    }
    renderQuickReplyTextRows([...values, ""]);
    $$('textarea[data-quick-reply-text]').at(-1)?.focus();
  });
  $("#quickReplyTexts").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-quick-text-action]");
    if (!button) return;
    const values = quickReplyTextValues();
    const index = Number(button.dataset.index);
    const action = button.dataset.quickTextAction;
    if (action === "remove" && values.length > 1) values.splice(index, 1);
    if (action === "up" && index > 0) {
      [values[index - 1], values[index]] = [values[index], values[index - 1]];
    }
    if (action === "down" && index < values.length - 1) {
      [values[index + 1], values[index]] = [values[index], values[index + 1]];
    }
    renderQuickReplyTextRows(values);
  });
  $("#quickReplyGrid").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-quick-reply-action]");
    if (!button) return;
    const item = state.quickReplies.find((entry) => entry.id === button.dataset.id);
    if (!item) return;
    const action = button.dataset.quickReplyAction;
    if (action === "copy") {
      try {
        await copyTextToClipboard(item.command);
        showToast(`Comando ${item.command} copiado.`);
      } catch (error) {
        showToast(error.message, true);
      }
      return;
    }
    if (action === "edit") {
      openQuickReplyDialog(item);
      return;
    }
    if (action === "delete") {
      if (!confirm(`¿Eliminar la respuesta “${item.name}” y todas sus imágenes?`)) return;
      try {
        await api(`/api/quick-replies/${encodeURIComponent(item.id)}`, {
          method: "DELETE"
        });
        await loadQuickReplies();
        showToast("Respuesta rápida eliminada.");
      } catch (error) {
        showToast(error.message, true);
      }
    }
  });

  $("#newCatalogButton").addEventListener("click", () => openCatalogDialog());
  $$("[data-catalog-new]").forEach((button) =>
    button.addEventListener("click", () => openCatalogDialog())
  );
  $("#refreshCatalogButton").addEventListener("click", async () => {
    try {
      await loadCatalog();
      showToast("Catálogo actualizado.");
    } catch (error) {
      showToast(error.message, true);
    }
  });
  $("#catalogSearch").addEventListener("input", renderCatalog);
  $("#catalogForm").addEventListener("submit", saveCatalogItem);
  $("#catalogName").addEventListener("input", () => {
    const commandInput = $("#catalogCommand");
    if ($("#catalogItemId").value || commandInput.dataset.manual === "true") return;
    commandInput.value = normalizeCommandInput($("#catalogName").value);
  });
  $("#catalogCommand").addEventListener("input", () => {
    $("#catalogCommand").dataset.manual = "true";
  });
  $$(".catalog-close").forEach((button) =>
    button.addEventListener("click", () => $("#catalogDialog").close())
  );
  $("#catalogGrid").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-catalog-action]");
    if (!button) return;
    const item = state.catalog.find((entry) => entry.id === button.dataset.id);
    if (!item) return;
    const action = button.dataset.catalogAction;
    if (action === "copy") {
      try {
        await copyTextToClipboard(item.command);
        showToast(`Comando ${item.command} copiado.`);
      } catch (error) {
        showToast(error.message, true);
      }
      return;
    }
    if (action === "edit") {
      openCatalogDialog(item);
      return;
    }
    if (action === "delete") {
      if (!confirm(`¿Eliminar “${item.name}” del catálogo?`)) return;
      try {
        await api(`/api/catalog/${item.id}`, { method: "DELETE" });
        await loadCatalog();
        showToast("Producto eliminado.");
      } catch (error) {
        showToast(error.message, true);
      }
    }
  });

  $("#accessForm").addEventListener("submit", saveAccess);
  $$(".access-close").forEach((button) =>
    button.addEventListener("click", () => $("#accessDialog").close())
  );
  $("#accessCancelEditButton").addEventListener("click", resetAccessForm);
  $("#accessList").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-access-action]");
    if (!button) return;
    const entry = state.accessEntries.find((item) => item.id === button.dataset.id);
    if (!entry) return;
    if (button.dataset.accessAction === "edit") {
      $("#accessId").value = entry.id;
      $("#accessName").value = entry.name || "";
      $("#accessWhatsapp").value = entry.whatsapp || "";
      $("#accessExpiresAt").value = entry.expiresAt || "";
      $("#accessDailyLimit").value = entry.dailyLimit || "";
      $("#accessNotes").value = entry.notes || "";
      $("#accessActive").checked = entry.active !== false;
      $("#saveAccessButton").textContent = "Guardar cambios";
      $("#accessCancelEditButton").classList.remove("hidden");
      return;
    }
    if (button.dataset.accessAction === "delete") {
      if (!confirm(`¿Quitar el acceso de ${entry.name || entry.whatsapp}?`)) return;
      try {
        await api(`/api/authenticator/access/${entry.id}`, { method: "DELETE" });
        await loadAccess(state.accessAccountId);
        showToast("Acceso revocado.");
      } catch (error) {
        showToast(error.message, true);
      }
    }
  });
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

/* V4.9.3 — mejoras visuales (sin lógica de negocio) */
(() => {
  const toggle = document.getElementById("togglePassword");
  const field = document.getElementById("loginPassword");
  if (toggle && field) {
    toggle.addEventListener("click", () => {
      const show = field.type === "password";
      field.type = show ? "text" : "password";
      toggle.textContent = show ? "Ocultar" : "Mostrar";
      toggle.setAttribute("aria-pressed", String(show));
      toggle.setAttribute("aria-label", show ? "Ocultar contraseña" : "Mostrar contraseña");
      field.focus();
    });
  }
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const sidebar = document.querySelector(".sidebar");
    if (sidebar && sidebar.classList.contains("open")) {
      sidebar.classList.remove("open");
      document.getElementById("sidebarBackdrop")?.classList.remove("visible");
      document.getElementById("mobileMenu")?.setAttribute("aria-expanded", "false");
    }
  });
})();
