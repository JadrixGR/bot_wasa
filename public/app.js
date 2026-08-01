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
  accessEntries: [],
  accessAccountId: null,
  authenticatorSecurity: null,
  activeSection: "dashboard",
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
    catalog: "Catálogo y comandos",
    authenticator: "Autenticador",
    activity: "Actividad"
  };
  $("#pageTitle").textContent = titles[section] || "JadrixServs";
  setSidebarOpen(false);
  window.scrollTo({
    top: 0,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"
  });
  if (section === "clients") loadClients();
  if (section === "catalog") {
    loadCatalog().catch((error) => showToast(error.message, true));
  }
  if (section === "activity") loadLogs();
  if (section === "messages" || section === "afk") loadSettings();
  if (section === "authenticator") {
    loadAuthenticator().catch((error) => showToast(error.message, true));
  } else {
    clearInterval(state.authenticatorTicker);
  }
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
  if ($("#reminderStartTime")) {
    $("#reminderStartTime").value =
      payload.settings.reminderStartTime || payload.settings.chargeStartTime || "09:00";
  }
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
        chargeStartTime: $("#chargeStartTime").value,
        reminderStartTime: $("#reminderStartTime")
          ? $("#reminderStartTime").value
          : $("#chargeStartTime").value
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
