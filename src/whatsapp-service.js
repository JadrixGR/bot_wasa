"use strict";

const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");
const { BotEngine } = require("./bot-engine");
const { parseRegistrationCommand } = require("./command-registry");

const BAILEYS_VERSION = "7.0.0-rc13";
const FALLBACK_WA_WEB_VERSIONS = [
  [2, 3000, 1044006379],
  [2, 3000, 1043984129],
  [2, 3000, 1043735639]
];
const SIGNAL_LOG_FILTER_MARKER = Symbol.for(
  "jadrixservs.signal-session-log-filter"
);
const AUTHENTICATOR_SEND_WINDOW = Object.freeze({
  minimumSeconds: 20,
  maximumSeconds: 30,
  safetyMilliseconds: 2000
});

let baileysModulePromise;

function loadBaileys() {
  if (!baileysModulePromise) {
    baileysModulePromise = import("@whiskeysockets/baileys");
  }
  return baileysModulePromise;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withTimeout(promise, milliseconds, message) {
  let timeout;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          const error = new Error(message);
          error.code = "OPERATION_TIMEOUT";
          reject(error);
        }, Math.max(10, Number(milliseconds) || 10));
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeWhatsAppId(value) {
  const raw = String(value || "").trim();
  if (raw.includes("@")) {
    const [localPart, server = ""] = raw.split("@");
    const user = localPart.split(":")[0];
    if (server === "c.us" || server === "s.whatsapp.net") {
      return `${user}@s.whatsapp.net`;
    }
    return raw;
  }

  let digits = raw.replace(/\D/g, "");
  if (digits.length === 9) digits = `51${digits}`;
  if (digits.length < 10) throw new Error("Número de WhatsApp no válido.");
  return `${digits}@s.whatsapp.net`;
}

function calculateHumanDelay(
  text,
  {
    minimum = Number(process.env.HUMAN_DELAY_MIN_MS) || 900,
    maximum = Number(process.env.HUMAN_DELAY_MAX_MS) || 4200,
    random = Math.random
  } = {}
) {
  const min = Math.max(300, minimum);
  const max = Math.max(min, maximum);
  const lengthDelay = Math.min(3000, String(text || "").length * 16);
  const jitter = 180 + Math.floor(random() * 620);
  return Math.min(max, Math.max(min, 500 + lengthDelay + jitter));
}

function createSilentLogger() {
  const logger = {
    level: "silent",
    child: () => logger,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    fatal: () => undefined
  };
  return logger;
}

function isSensitiveSignalSessionDump(args) {
  return Array.isArray(args) && args[0] === "Closing session:";
}

function installSignalSessionLogFilter() {
  if (globalThis.console?.[SIGNAL_LOG_FILTER_MARKER]) return;
  const originalInfo = globalThis.console.info.bind(globalThis.console);
  Object.defineProperty(globalThis.console, SIGNAL_LOG_FILTER_MARKER, {
    value: originalInfo,
    enumerable: false,
    configurable: false
  });
  globalThis.console.info = (...args) => {
    if (isSensitiveSignalSessionDump(args)) return;
    originalInfo(...args);
  };
}

function compatibleBrowserProfile(Browsers) {
  if (typeof Browsers?.macOS === "function") {
    return Browsers.macOS("Chrome");
  }
  return ["Mac OS", "Chrome", "14.4.1"];
}

function parseWhatsAppWebVersion(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value || "")
        .trim()
        .split(/[.,\s]+/);
  if (parts.length !== 3) return null;
  const version = parts.map((part) => Number(part));
  if (
    version.some((part) => !Number.isSafeInteger(part) || part < 0) ||
    version[0] !== 2 ||
    version[1] < 1000 ||
    version[2] < 1
  ) {
    return null;
  }
  return version;
}

function formatWhatsAppWebVersion(version) {
  const parsed = parseWhatsAppWebVersion(version);
  return parsed ? parsed.join(".") : "desconocida";
}

function buildConnectionCandidates({
  Browsers,
  liveVersion,
  overrideVersion
}) {
  const versionInputs = [
    { version: parseWhatsAppWebVersion(overrideVersion), source: "Render" },
    {
      version: parseWhatsAppWebVersion(liveVersion),
      source: "WhatsApp Web"
    },
    ...FALLBACK_WA_WEB_VERSIONS.map((version) => ({
      version,
      source: "respaldo compatible"
    }))
  ];
  const seenVersions = new Set();
  const versions = versionInputs.filter(({ version }) => {
    if (!version) return false;
    const key = version.join(".");
    if (seenVersions.has(key)) return false;
    seenVersions.add(key);
    return true;
  });
  const browserProfiles = [
    {
      browser:
        typeof Browsers?.macOS === "function"
          ? Browsers.macOS("Chrome")
          : compatibleBrowserProfile(Browsers),
      browserLabel: "Mac OS/Chrome"
    },
    {
      browser:
        typeof Browsers?.windows === "function"
          ? Browsers.windows("Chrome")
          : ["Windows", "Chrome", "10.0.22631"],
      browserLabel: "Windows/Chrome"
    }
  ];

  return versions.flatMap(({ version, source }) =>
    browserProfiles.map(({ browser, browserLabel }) => ({
      version: [...version],
      versionSource: source,
      browser: [...browser],
      browserLabel
    }))
  );
}

function getDisconnectStatusCode(error) {
  const candidates = [
    error?.output?.statusCode,
    error?.data?.statusCode,
    error?.statusCode,
    error?.cause?.output?.statusCode,
    error?.cause?.statusCode
  ];
  const value = candidates.find((item) => Number.isFinite(Number(item)));
  return value === undefined ? null : Number(value);
}

function extractPhone(jid) {
  const match = String(jid || "").match(/^(\d+)(?::\d+)?@/);
  return match?.[1] || null;
}

function unwrapMessageContent(message) {
  let content = message || {};
  for (let index = 0; index < 6; index += 1) {
    const nested =
      content.ephemeralMessage?.message ||
      content.viewOnceMessage?.message ||
      content.viewOnceMessageV2?.message ||
      content.viewOnceMessageV2Extension?.message ||
      content.documentWithCaptionMessage?.message ||
      content.editedMessage?.message?.protocolMessage?.editedMessage;
    if (!nested) break;
    content = nested;
  }
  return content;
}

function interactiveReplyText(content) {
  const params = content.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
  if (!params) return "";
  try {
    const parsed = JSON.parse(params);
    return String(
      parsed.title ||
        parsed.name ||
        parsed.id ||
        parsed.selectedRowId ||
        ""
    );
  } catch {
    return "";
  }
}

function extractMessageBody(message) {
  const content = unwrapMessageContent(message);
  return String(
    content.conversation ||
      content.extendedTextMessage?.text ||
      content.imageMessage?.caption ||
      content.videoMessage?.caption ||
      content.documentMessage?.caption ||
      content.buttonsResponseMessage?.selectedDisplayText ||
      content.buttonsResponseMessage?.selectedButtonId ||
      content.listResponseMessage?.title ||
      content.listResponseMessage?.singleSelectReply?.selectedRowId ||
      content.templateButtonReplyMessage?.selectedDisplayText ||
      content.templateButtonReplyMessage?.selectedId ||
      interactiveReplyText(content) ||
      ""
  ).trim();
}

function mimeTypeForExtension(extension) {
  return (
    {
      ".ogg": "audio/ogg; codecs=opus",
      ".opus": "audio/ogg; codecs=opus",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".m4a": "audio/mp4",
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".mp4": "video/mp4"
    }[extension] || "application/octet-stream"
  );
}

function formatAuthenticatorCodeMessage({
  service,
  code,
  secondsRemaining
}) {
  const serviceName =
    String(service || "tu cuenta").replace(/[\r\n*_`~]/g, " ").trim() ||
    "tu cuenta";
  const safeCode = String(code || "").replace(/\D/g, "");
  const validity = Math.max(
    20,
    Math.min(30, Math.floor(Number(secondsRemaining) || 20))
  );
  return [
    `🔐 *Código de ${serviceName}*`,
    "",
    `\`${safeCode}\``,
    "",
    `⏳ Válido por ${validity} segundos.`
  ].join("\n");
}

class WhatsAppService {
  constructor({
    store,
    sessionDir,
    mediaDir,
    ai,
    authenticator = null,
    baileysLoader = loadBaileys,
    qrEncoder = QRCode.toDataURL,
    sleepFn = sleep,
    readyTimeoutMs,
    logoutTimeoutMs,
    qrWaitTimeoutMs
  }) {
    installSignalSessionLogFilter();
    this.store = store;
    this.sessionDir = path.resolve(sessionDir);
    this.mediaDir = path.resolve(mediaDir);
    this.ai = ai;
    this.authenticator = authenticator;
    this.baileysLoader = baileysLoader;
    this.qrEncoder = qrEncoder;
    this.sleepFn = sleepFn;
    this.readyTimeoutMs =
      readyTimeoutMs === undefined
        ? Math.max(
            10000,
            Number(process.env.WHATSAPP_READY_TIMEOUT_MS) || 45000
          )
        : Math.max(10, Number(readyTimeoutMs) || 10);
    this.logoutTimeoutMs =
      logoutTimeoutMs === undefined
        ? Math.max(
            1000,
            Number(process.env.WHATSAPP_LOGOUT_TIMEOUT_MS) || 4000
          )
        : Math.max(10, Number(logoutTimeoutMs) || 10);
    this.qrWaitTimeoutMs =
      qrWaitTimeoutMs === undefined
        ? Math.max(
            5000,
            Number(process.env.WHATSAPP_QR_WAIT_TIMEOUT_MS) || 20000
          )
        : Math.max(10, Number(qrWaitTimeoutMs) || 10);
    this.baileys = null;
    this.socket = null;
    this.authState = null;
    this.engine = null;
    this.queues = new Map();
    this.generation = 0;
    this.initializePromise = null;
    this.restartPromise = null;
    this.resetPromise = null;
    this.resetInProgress = false;
    this.pendingCredsSave = Promise.resolve();
    this.readyWatchdog = null;
    this.qrWatchdog = null;
    this.reconnectTimer = null;
    this.autoRecoveryAttempts = 0;
    this.reconnectAttempts = 0;
    this.connectionCandidates = null;
    this.connectionCandidateIndex = 0;
    this.connectionCompatibilityCycles = 0;
    this.activeConnectionCandidate = null;
    this.status = {
      state: "starting",
      ready: false,
      qrDataUrl: null,
      qrUpdatedAt: null,
      loadingPercent: null,
      loadingMessage: null,
      waState: null,
      phone: null,
      name: null,
      webVersion: `Baileys ${BAILEYS_VERSION} · comprobando WhatsApp Web`,
      protocolVersion: null,
      browserProfile: null,
      transport: "websocket",
      recoveryAttempts: 0,
      reconnectAttempts: 0,
      error: null,
      updatedAt: new Date().toISOString()
    };
    fs.mkdirSync(this.sessionDir, { recursive: true });
    fs.mkdirSync(this.mediaDir, { recursive: true });
  }

  getStatus() {
    return structuredClone(this.status);
  }

  getAiStatus() {
    return this.ai?.getStatus() || { enabled: false, model: null };
  }

  #setStatus(patch) {
    this.status = {
      ...this.status,
      ...patch,
      updatedAt: new Date().toISOString()
    };
  }

  #isCurrent(socket, generation) {
    return this.socket === socket && this.generation === generation;
  }

  #clearReadyWatchdog() {
    if (this.readyWatchdog) clearTimeout(this.readyWatchdog);
    this.readyWatchdog = null;
  }

  #clearQrWatchdog() {
    if (this.qrWatchdog) clearTimeout(this.qrWatchdog);
    this.qrWatchdog = null;
  }

  #clearReconnectTimer() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  async #resolveConnectionCandidates() {
    if (this.connectionCandidates?.length) {
      return this.connectionCandidates;
    }

    let liveVersion = null;
    if (typeof this.baileys?.fetchLatestWaWebVersion === "function") {
      try {
        const options =
          typeof globalThis.AbortSignal?.timeout === "function"
            ? { signal: globalThis.AbortSignal.timeout(5000) }
            : {};
        const result = await withTimeout(
          this.baileys.fetchLatestWaWebVersion(options),
          5500,
          "WhatsApp Web no respondió al consultar su versión"
        );
        if (result?.isLatest) {
          liveVersion = parseWhatsAppWebVersion(result.version);
        }
      } catch (error) {
        this.store.addLog(
          "whatsapp",
          `No se pudo consultar la versión Web en vivo; se usará el respaldo compatible: ${error.message}`
        );
        this.store.save();
      }
    }

    this.connectionCandidates = buildConnectionCandidates({
      Browsers: this.baileys?.Browsers,
      liveVersion,
      overrideVersion: process.env.WHATSAPP_WEB_VERSION
    });
    this.connectionCandidateIndex = Math.min(
      this.connectionCandidateIndex,
      Math.max(0, this.connectionCandidates.length - 1)
    );
    return this.connectionCandidates;
  }

  #advanceConnectionCandidate() {
    if (!this.connectionCandidates?.length) return null;
    this.connectionCandidateIndex += 1;
    if (this.connectionCandidateIndex >= this.connectionCandidates.length) {
      this.connectionCandidateIndex = 0;
      this.connectionCompatibilityCycles += 1;
      this.connectionCandidates = null;
      this.activeConnectionCandidate = null;
      return null;
    }
    return this.connectionCandidates[this.connectionCandidateIndex];
  }

  #scheduleQrWatchdog(socket, generation) {
    if (
      !this.#isCurrent(socket, generation) ||
      this.status.ready ||
      this.authState?.creds?.registered
    ) {
      return;
    }
    if (this.qrWatchdog) return;
    this.qrWatchdog = setTimeout(() => {
      this.qrWatchdog = null;
      if (
        !this.#isCurrent(socket, generation) ||
        this.status.ready ||
        this.status.qrDataUrl ||
        this.authState?.creds?.registered ||
        this.resetInProgress
      ) {
        return;
      }

      const rejected = this.activeConnectionCandidate;
      const next = this.#advanceConnectionCandidate();
      const rejectedLabel = rejected
        ? `WA ${formatWhatsAppWebVersion(rejected.version)} · ${rejected.browserLabel}`
        : "el perfil actual";
      const nextLabel = next
        ? `WA ${formatWhatsAppWebVersion(next.version)} · ${next.browserLabel}`
        : "una versión Web actualizada";
      this.#setStatus({
        state: "reconnecting",
        ready: false,
        loadingPercent: 30,
        loadingMessage: `El QR tardó demasiado; probando ${nextLabel}`,
        waState: "QR_TIMEOUT",
        error: `WhatsApp no entregó el QR con ${rejectedLabel}. El bot cambiará automáticamente de protocolo.`
      });
      this.store.addLog(
        "whatsapp",
        `WhatsApp no entregó el QR con ${rejectedLabel}; probando ${nextLabel}`
      );
      this.store.save();
      this.#restartInternal("rotación automática para obtener el QR").catch(
        (error) => {
          this.#setStatus({
            state: "reconnecting",
            ready: false,
            error: `No se pudo cambiar el perfil para generar el QR: ${error.message}`
          });
          this.#scheduleReconnect(1500, { compatibilityRetry: true });
        }
      );
    }, this.qrWaitTimeoutMs);
    this.qrWatchdog.unref();
  }

  #scheduleReadyWatchdog(socket, generation) {
    if (!this.#isCurrent(socket, generation) || this.status.ready) return;
    this.#clearReadyWatchdog();
    this.readyWatchdog = setTimeout(() => {
      this.#recoverStalledConnection(socket, generation).catch((error) => {
        if (!this.#isCurrent(socket, generation)) return;
        this.#setStatus({
          state: "stalled",
          ready: false,
          error: `La sesión fue aceptada, pero no terminó de abrir: ${error.message}`
        });
      });
    }, this.readyTimeoutMs);
    this.readyWatchdog.unref();
  }

  async #recoverStalledConnection(socket, generation) {
    if (!this.#isCurrent(socket, generation) || this.status.ready) {
      return { recovered: this.status.ready, skipped: true };
    }

    this.#clearReadyWatchdog();
    this.autoRecoveryAttempts += 1;
    this.#setStatus({
      state: "recovering",
      ready: false,
      recoveryAttempts: this.autoRecoveryAttempts,
      error: `La sesión ya fue aceptada. Reintentando la conexión sin borrar tus credenciales (intento ${this.autoRecoveryAttempts})…`
    });
    this.store.addLog(
      "whatsapp",
      `Recuperación posterior al QR (intento ${this.autoRecoveryAttempts})`
    );
    this.store.save();
    try {
      await this.#restartInternal("recuperación posterior al QR");
      return { recovered: false, restarted: true };
    } catch (error) {
      this.#setStatus({
        state: "reconnecting",
        ready: false,
        error: `WhatsApp no abrió todavía: ${error.message}. Se volverá a intentar automáticamente.`
      });
      this.#scheduleReconnect(
        Number(process.env.WHATSAPP_RECONNECT_DELAY_MS) || 3000
      );
      return { recovered: false, retryScheduled: true };
    }
  }

  async initialize({ force = false } = {}) {
    if (process.env.DISABLE_WHATSAPP === "1") {
      this.#setStatus({ state: "disabled", ready: false });
      return;
    }
    if (this.resetInProgress && !force) return;
    if (this.socket) return;
    if (this.initializePromise) return this.initializePromise;

    this.initializePromise = this.#initializeSocket({
      allowDuringReset: force
    });
    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  async #initializeSocket({ allowDuringReset = false } = {}) {
    const generation = ++this.generation;
    this.#setStatus({
      state: "initializing",
      ready: false,
      qrDataUrl: null,
      loadingPercent: 10,
      loadingMessage: "Abriendo conexión segura con WhatsApp",
      phone: null,
      name: null,
      waState: "CONNECTING",
      error: null
    });

    try {
      this.baileys = await this.baileysLoader();
      const {
        default: makeWASocket,
        useMultiFileAuthState
      } = this.baileys;
      const { state, saveCreds } = await useMultiFileAuthState(this.sessionDir);
      if (
        this.generation !== generation ||
        (this.resetInProgress && !allowDuringReset)
      ) {
        return;
      }
      this.authState = state;
      this.#setStatus({
        loadingPercent: 15,
        loadingMessage: "Comprobando compatibilidad con WhatsApp Web"
      });
      const connectionCandidates =
        await this.#resolveConnectionCandidates();
      if (
        this.generation !== generation ||
        (this.resetInProgress && !allowDuringReset)
      ) {
        return;
      }
      const connectionCandidate =
        connectionCandidates[this.connectionCandidateIndex] ||
        connectionCandidates[0];
      this.activeConnectionCandidate = connectionCandidate;
      const protocolVersion = formatWhatsAppWebVersion(
        connectionCandidate.version
      );
      this.#setStatus({
        webVersion: `Baileys ${BAILEYS_VERSION} · WA ${protocolVersion} · ${connectionCandidate.browserLabel}`,
        protocolVersion,
        browserProfile: connectionCandidate.browserLabel,
        loadingPercent: 20,
        loadingMessage: state.creds.registered
          ? "Validando la sesión con el protocolo actualizado"
          : "Solicitando un código QR nuevo"
      });

      const socket = makeWASocket({
        auth: state,
        version: connectionCandidate.version,
        browser: connectionCandidate.browser,
        logger: createSilentLogger(),
        printQRInTerminal: false,
        markOnlineOnConnect: false,
        syncFullHistory: false,
        shouldSyncHistoryMessage: () => false,
        emitOwnEvents: false,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 10000,
        qrTimeout: 60000,
        generateHighQualityLinkPreview: false,
        getMessage: async () => undefined
      });

      this.socket = socket;
      this.engine ||= new BotEngine({
        store: this.store,
        ai: this.ai,
        sendText: (chatId, text, options) => this.sendText(chatId, text, options),
        sendMedia: (chatId, filePath, options) =>
          this.sendMedia(chatId, filePath, options),
        beginTyping: (chatId) => this.beginTyping(chatId)
      });

      socket.ev.on("creds.update", (update) => {
        const saveTask = this.pendingCredsSave
          .catch(() => undefined)
          .then(() => {
            if (!this.#isCurrent(socket, generation) || this.resetInProgress) {
              return;
            }
            return saveCreds();
          });
        this.pendingCredsSave = saveTask;
        saveTask
          .then(() => {
            if (!this.#isCurrent(socket, generation)) return;
            if (state.creds.registered || update?.registered) {
              this.#clearQrWatchdog();
              this.#setStatus({
                state: "authenticated",
                ready: false,
                qrDataUrl: null,
                loadingPercent: 80,
                loadingMessage: "QR aceptado; terminando de abrir la sesión",
                waState: "AUTHENTICATED",
                error: null
              });
              this.#scheduleReadyWatchdog(socket, generation);
            }
          })
          .catch((error) => {
            if (!this.#isCurrent(socket, generation)) return;
            this.#setStatus({
              state: "error",
              ready: false,
              error: `No se pudo guardar la sesión: ${error.message}`
            });
          });
      });

      socket.ev.on("connection.update", (update) => {
        this.#handleConnectionUpdate(socket, generation, update).catch((error) => {
          if (!this.#isCurrent(socket, generation)) return;
          this.#setStatus({
            state: "error",
            ready: false,
            error: `Falló la conexión de WhatsApp: ${error.message}`
          });
          this.store.addLog("error", `WhatsApp: ${error.message}`);
          this.store.save();
        });
      });

      socket.ev.on("messages.upsert", (event) => {
        if (!this.#isCurrent(socket, generation)) return;
        this.#handleMessagesUpsert(socket, event);
      });

      if (state.creds.registered) {
        this.#clearQrWatchdog();
        this.#setStatus({
          state: "authenticated",
          ready: false,
          loadingPercent: 65,
          loadingMessage: "Restaurando la sesión guardada",
          waState: "AUTHENTICATED"
        });
        this.#scheduleReadyWatchdog(socket, generation);
      } else {
        this.#scheduleQrWatchdog(socket, generation);
      }
    } catch (error) {
      if (this.generation !== generation) return;
      this.socket = null;
      this.#setStatus({
        state: "error",
        ready: false,
        error: String(error?.message || error)
      });
      this.store.addLog(
        "error",
        `No se pudo iniciar WhatsApp: ${String(error?.message || error)}`
      );
      this.store.save();
      throw error;
    }
  }

  async #handleConnectionUpdate(socket, generation, update) {
    if (!this.#isCurrent(socket, generation)) return;

    if (update.qr) {
      const qrDataUrl = await this.qrEncoder(update.qr, { width: 420, margin: 2 });
      if (!this.#isCurrent(socket, generation)) return;
      this.autoRecoveryAttempts = 0;
      this.reconnectAttempts = 0;
      this.connectionCompatibilityCycles = 0;
      this.#clearReadyWatchdog();
      this.#clearQrWatchdog();
      this.#setStatus({
        state: "qr",
        ready: false,
        qrDataUrl,
        qrUpdatedAt: new Date().toISOString(),
        loadingPercent: 0,
        loadingMessage: "Escanea el QR desde Dispositivos vinculados",
        waState: "QR",
        recoveryAttempts: 0,
        reconnectAttempts: 0,
        error: null
      });
      this.store.addLog("whatsapp", "Nuevo código QR disponible");
      this.store.save();
    }

    if (update.isNewLogin && !this.status.ready) {
      this.#clearQrWatchdog();
      this.#setStatus({
        state: "authenticated",
        ready: false,
        qrDataUrl: null,
        loadingPercent: 80,
        loadingMessage: "Sesión aceptada; terminando la conexión",
        waState: "AUTHENTICATED",
        error: null
      });
      this.#scheduleReadyWatchdog(socket, generation);
    }

    if (update.connection === "connecting" && !update.qr && !this.status.ready) {
      const registered = Boolean(this.authState?.creds?.registered);
      this.#setStatus({
        state: registered ? "authenticated" : "initializing",
        ready: false,
        loadingPercent: registered ? 70 : 20,
        loadingMessage: registered
          ? "Validando la sesión vinculada"
          : "Esperando el código QR",
        waState: "CONNECTING",
        error: null
      });
      if (!registered) this.#scheduleQrWatchdog(socket, generation);
    }

    if (update.connection === "open") {
      this.#clearReadyWatchdog();
      this.#clearQrWatchdog();
      this.#clearReconnectTimer();
      this.autoRecoveryAttempts = 0;
      this.reconnectAttempts = 0;
      this.connectionCompatibilityCycles = 0;
      const normalizedJid = this.baileys.jidNormalizedUser(
        socket.user?.id || ""
      );
      this.#setStatus({
        state: "ready",
        ready: true,
        qrDataUrl: null,
        loadingPercent: 100,
        loadingMessage: "WhatsApp conectado",
        waState: "CONNECTED",
        phone: extractPhone(normalizedJid),
        name: socket.user?.name || null,
        recoveryAttempts: 0,
        reconnectAttempts: 0,
        error: null
      });
      await socket.sendPresenceUpdate("unavailable").catch(() => undefined);
      this.store.addLog(
        "whatsapp",
        `WhatsApp conectado${extractPhone(normalizedJid) ? `: ${extractPhone(normalizedJid)}` : ""}`
      );
      this.store.save();
    }

    if (update.connection === "close") {
      await this.#handleConnectionClose(
        socket,
        generation,
        update.lastDisconnect?.error
      );
    }
  }

  async #handleConnectionClose(socket, generation, error) {
    if (!this.#isCurrent(socket, generation)) return;
    this.#clearReadyWatchdog();
    this.#clearQrWatchdog();
    const statusCode = getDisconnectStatusCode(error);
    const { DisconnectReason } = this.baileys;
    const detail = String(error?.message || "Conexión cerrada");

    this.store.addLog("whatsapp", `Conexión cerrada (${statusCode || "sin código"})`, {
      statusCode,
      detail
    });
    this.store.save();

    const fatalCodes = new Set([
      DisconnectReason.loggedOut,
      DisconnectReason.badSession,
      DisconnectReason.multideviceMismatch,
      DisconnectReason.forbidden
    ]);

    if (fatalCodes.has(statusCode)) {
      this.#setStatus({
        state: "auth_failure",
        ready: false,
        qrDataUrl: null,
        loadingPercent: null,
        loadingMessage: null,
        waState: String(statusCode || "AUTH_FAILURE"),
        phone: null,
        name: null,
        error:
          "La sesión guardada ya no es válida. Pulsa “Cerrar sesión”, elimina el dispositivo en tu celular y escanea un QR nuevo."
      });
      return;
    }

    if (statusCode === DisconnectReason.connectionReplaced) {
      this.#setStatus({
        state: "disconnected",
        ready: false,
        phone: null,
        waState: "CONNECTION_REPLACED",
        error:
          "WhatsApp reemplazó esta conexión por otra sesión. Cierra la otra sesión o pulsa “Cerrar sesión” para vincular nuevamente."
      });
      return;
    }

    const restartRequired = statusCode === DisconnectReason.restartRequired;
    const rejectedClientProfile = statusCode === 405;
    const rejectedCandidate = rejectedClientProfile
      ? this.activeConnectionCandidate
      : null;
    const nextCandidate = rejectedClientProfile
      ? this.#advanceConnectionCandidate()
      : null;
    const rejectedProtocol = rejectedCandidate
      ? formatWhatsAppWebVersion(rejectedCandidate.version)
      : "desconocido";
    const nextCandidateLabel = nextCandidate
      ? `WA ${formatWhatsAppWebVersion(nextCandidate.version)} · ${nextCandidate.browserLabel}`
      : "una versión Web recién consultada";
    const reconnectPresentation = restartRequired
      ? {
          loadingPercent: 85,
          loadingMessage: "QR aceptado; reiniciando para completar el vínculo",
          error: null
        }
      : rejectedClientProfile
        ? {
            loadingPercent: 35,
            loadingMessage: `405 detectado; probando ${nextCandidateLabel}`,
            error:
              `WhatsApp rechazó el protocolo WA ${rejectedProtocol} (405) antes del QR. El bot está cambiándolo automáticamente sin tocar tus clientes.`
          }
        : {
            loadingPercent: null,
            loadingMessage: "Reconectando con WhatsApp",
            error: "La conexión se interrumpió. Reintentando automáticamente…"
          };
    this.#setStatus({
      state: "reconnecting",
      ready: false,
      qrDataUrl: null,
      waState: String(statusCode || "CLOSED"),
      phone: null,
      ...reconnectPresentation
    });
    const compatibilityDelay = Math.min(
      30000,
      1000 * 2 ** Math.min(this.connectionCompatibilityCycles, 5)
    );
    this.#scheduleReconnect(
      rejectedClientProfile
        ? compatibilityDelay
        : restartRequired
          ? 1000
          : Number(process.env.WHATSAPP_RECONNECT_DELAY_MS) || 3000,
      { compatibilityRetry: rejectedClientProfile }
    );
  }

  #scheduleReconnect(delayMs, { compatibilityRetry = false } = {}) {
    if (this.resetInProgress || this.reconnectTimer || this.restartPromise) {
      return;
    }
    this.reconnectAttempts += 1;
    const exponentialDelay = Math.min(
      60000,
      1000 * 2 ** Math.min(this.reconnectAttempts - 1, 6)
    );
    const scheduledDelay = compatibilityRetry
      ? Math.max(250, Number(delayMs) || 1000)
      : Math.max(100, Number(delayMs) || 0, exponentialDelay);
    const preservingConnectionGuidance =
      this.status.loadingPercent === 85 || this.status.waState === "405";
    this.#setStatus({
      state: "reconnecting",
      ready: false,
      reconnectAttempts: this.reconnectAttempts,
      loadingMessage: preservingConnectionGuidance
        ? this.status.loadingMessage
        : `Reconexión automática ${this.reconnectAttempts}`,
      error: preservingConnectionGuidance
        ? this.status.error
        : `La conexión se interrumpió. Nuevo intento automático en ${Math.ceil(scheduledDelay / 1000)} segundos.`
    });
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.resetInProgress) return;
      this.#restartInternal("reconexión automática").catch((error) => {
        this.#setStatus({
          state: "reconnecting",
          ready: false,
          error: `No se pudo reconectar: ${error.message}. Se volverá a intentar automáticamente.`
        });
        this.#scheduleReconnect(
          Number(process.env.WHATSAPP_RECONNECT_DELAY_MS) || 3000
        );
      });
    }, scheduledDelay);
    this.reconnectTimer.unref();
  }

  #handleMessagesUpsert(socket, event) {
    if (event?.requestId) {
      this.store.addLog(
        "security",
        "Se descartó una sincronización solicitada para evitar mensajes históricos falsos."
      );
      this.store.save();
      return;
    }
    if (event?.type !== "notify" || !Array.isArray(event.messages)) return;

    for (const message of event.messages) {
      const chatId = message?.key?.remoteJid;
      const ownerCommand =
        Boolean(message?.key?.fromMe) &&
        extractMessageBody(message.message).startsWith("/");
      if (
        !chatId ||
        (message.key.fromMe && !ownerCommand) ||
        chatId === "status@broadcast" ||
        chatId.endsWith("@g.us") ||
        chatId.endsWith("@broadcast") ||
        chatId.endsWith("@newsletter")
      ) {
        continue;
      }

      const alternateChatId = message?.key?.remoteJidAlt || "";
      const queueId =
        [chatId, alternateChatId].find((id) =>
          String(id).endsWith("@s.whatsapp.net")
        ) || chatId;
      const previous = this.queues.get(queueId) || Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(() => this.#handleMessage(socket, message))
        .catch((error) => {
          this.store.addLog("error", `Error respondiendo a ${chatId}: ${error.message}`, {
            chatId
          });
          this.store.save();
        })
        .finally(() => {
          if (this.queues.get(queueId) === next) this.queues.delete(queueId);
        });
      this.queues.set(queueId, next);
    }
  }

  async #handleMessage(socket, message) {
    if (message.key.fromMe) {
      await this.#handleOwnerCommand(socket, message);
      return;
    }

    if (await this.#handleClientAuthenticatorCommand(socket, message)) return;

    const chatId = message.key.remoteJid;
    const content = unwrapMessageContent(message.message);
    const type = this.baileys.getContentType(content) || "";
    const hasMedia = new Set([
      "imageMessage",
      "videoMessage",
      "audioMessage",
      "documentMessage",
      "stickerMessage"
    ]).has(type);
    const body = extractMessageBody(message.message);
    if (!body && !hasMedia) return;

    const fromName = String(message.pushName || "");
    this.store.addLog("incoming", `Mensaje de ${fromName || chatId}`, {
      chatId,
      preview: body.slice(0, 180)
    });
    this.store.save();

    const customerPhone = await this.#resolveCustomerPhone(socket, message);

    const result = await this.engine.handleIncoming({
      chatId,
      alternateChatId: message.key.remoteJidAlt || "",
      customerPhone: customerPhone || "",
      body,
      hasMedia,
      mediaType: type.replace(/Message$/, ""),
      fromName
    });

    if (
      Number(result?.messages || 0) > 0 &&
      ["welcome-sequence", "welcome-resumed"].includes(result?.action)
    ) {
      await socket.readMessages([message.key]).catch(() => undefined);
    }
  }

  async #resolveCustomerPhone(socket, message) {
    const candidates = [
      message.key.remoteJidAlt,
      message.key.remoteJid
    ].filter(Boolean);
    const phoneJid = candidates.find((jid) =>
      /@(s\.whatsapp\.net|c\.us)$/.test(String(jid))
    );
    if (phoneJid) return extractPhone(phoneJid);

    const lid = candidates.find((jid) => String(jid).endsWith("@lid"));
    if (!lid) return null;
    const mapped = await socket.signalRepository?.lidMapping
      ?.getPNForLID(lid)
      .catch(() => null);
    return extractPhone(mapped);
  }

  async #handleClientAuthenticatorCommand(socket, message) {
    const body = extractMessageBody(message.message).trim();
    if (!/^\/[a-z0-9][a-z0-9_-]{1,31}$/i.test(body)) return false;

    const account = this.authenticator?.findAccountByCommand(body);
    if (!account) return false;

    const chatId = message.key.remoteJid;
    const target = normalizeWhatsAppId(chatId);
    const phone =
      (await this.#resolveCustomerPhone(socket, message)) ||
      extractPhone(chatId);
    const check = this.store.checkAuthenticatorAccess?.(account.id, phone) || {
      allowed: false,
      reason: "sin-autorizacion",
      entry: null
    };

    if (!check.allowed) {
      const reasons = {
        "sin-autorizacion": null,
        inactivo: "Tu acceso a este código 2FA está desactivado. Escríbenos para reactivarlo.",
        vencido: "Tu acceso a este código 2FA venció. Renueva para seguir solicitándolo.",
        "limite-diario": "Ya alcanzaste tu límite de códigos 2FA por hoy. Vuelve a intentarlo mañana."
      };
      const reply = reasons[check.reason];
      this.store.addLog(
        "authenticator",
        `Solicitud 2FA rechazada (${check.reason}) para ${phone || target} con ${account.command}`,
        { command: account.command, authenticatorId: account.id, chatId: target }
      );
      this.store.save();
      if (reply) {
        await this.sendText(target, reply).catch(() => undefined);
        return true;
      }
      return false;
    }

    const commandMessageId = String(message.key.id || "");
    if (
      commandMessageId &&
      this.store.isCommandMessageProcessed?.(commandMessageId)
    ) {
      return true;
    }

    try {
      let fresh = await this.authenticator.getFreshCodeByCommand(
        account.command,
        AUTHENTICATOR_SEND_WINDOW
      );
      if (!fresh) return true;

      const stopTyping = await this.beginTyping(target);
      await this.sleepFn(350);
      await stopTyping();

      fresh = await this.authenticator.getFreshCodeByCommand(
        account.command,
        AUTHENTICATOR_SEND_WINDOW
      );
      if (!fresh) return true;

      await socket.sendMessage(target, {
        text: formatAuthenticatorCodeMessage(fresh)
      });
      if (commandMessageId) {
        this.store.markCommandMessageProcessed?.(commandMessageId);
      }
      this.store.registerAuthenticatorAccessUsage?.(check.entry.id);
      this.store.addLog(
        "authenticator",
        `Código 2FA entregado al cliente ${check.entry.name || phone} con ${fresh.command} · ${fresh.service}`,
        {
          command: fresh.command,
          authenticatorId: fresh.id,
          accessId: check.entry.id,
          chatId: target,
          secondsRemaining: fresh.secondsRemaining
        }
      );
      this.store.save();
    } catch (error) {
      this.store.addLog(
        "authenticator",
        `No se envió ${account.command} al cliente ${phone || target}: ${error.message}`,
        { command: account.command, authenticatorId: account.id, chatId: target }
      );
      this.store.save();
    }
    return true;
  }

  async #handleOwnerCommand(socket, message) {
    const body = extractMessageBody(message.message);
    const quickReply = this.store.findQuickReplyByCommand?.(body);
    if (quickReply) {
      await this.#handleOwnerQuickReply(message, quickReply);
      return;
    }
    const authenticatorAccount =
      /^\/[a-z0-9][a-z0-9_-]{1,31}$/i.test(body)
        ? this.authenticator?.findAccountByCommand(body)
        : null;
    if (authenticatorAccount) {
      await this.#handleOwnerAuthenticatorCommand(
        socket,
        message,
        authenticatorAccount
      );
      return;
    }

    const parsed = parseRegistrationCommand(body);
    if (!parsed.isCommand) return;

    if (!parsed.ok) {
      this.store.addLog(
        "command",
        `Comando no aplicado: ${parsed.error}`,
        { commandText: body.slice(0, 120) }
      );
      this.store.save();
      return;
    }

    const whatsapp = await this.#resolveCustomerPhone(socket, message);
    if (!whatsapp) {
      this.store.addLog(
        "command",
        `No se pudo aplicar ${parsed.command}: WhatsApp no entregó el número del cliente.`,
        { chatId: message.key.remoteJid }
      );
      this.store.save();
      return;
    }

    const result = this.store.registerClientFromCommand({
      whatsapp,
      item: parsed.item,
      days: parsed.days,
      command: parsed.command,
      commandMessageId: message.key.id || ""
    });
    if (result.duplicate) {
      this.store.addLog(
        "command",
        `Comando duplicado ignorado: ${parsed.command}`,
        { commandMessageId: message.key.id || "" }
      );
      this.store.save();
    }
  }

  async #handleOwnerQuickReply(message, reply) {
    const commandMessageId = String(message.key.id || "");
    const target = normalizeWhatsAppId(message.key.remoteJid);

    if (!reply.enabled || !reply.images?.length || !reply.texts?.length) {
      this.store.addLog(
        "quick-reply",
        `Respuesta rápida no enviada porque está incompleta o inactiva: ${reply.command}`,
        { quickReplyId: reply.id, command: reply.command, chatId: target }
      );
      this.store.save();
      return;
    }
    if (
      commandMessageId &&
      this.store.isCommandMessageProcessed?.(commandMessageId)
    ) {
      return;
    }

    if (commandMessageId) {
      this.store.markCommandMessageProcessed?.(commandMessageId);
    }
    try {
      const lastImageIndex = reply.images.length - 1;
      for (let index = 0; index < reply.images.length; index += 1) {
        const image = reply.images[index];
        await this.sendMedia(target, image.path, {
          caption: index === lastImageIndex ? reply.texts[0] : undefined
        });
      }
      for (const text of reply.texts.slice(1)) {
        await this.sendText(target, text);
      }
      this.store.addLog(
        "quick-reply",
        `Respuesta rápida enviada: ${reply.name} (${reply.command})`,
        {
          quickReplyId: reply.id,
          command: reply.command,
          chatId: target,
          images: reply.images.length,
          texts: reply.texts.length
        }
      );
      this.store.save();
    } catch (error) {
      this.store.addLog(
        "quick-reply",
        `No se completó ${reply.command}: ${error.message}`,
        {
          quickReplyId: reply.id,
          command: reply.command,
          chatId: target
        }
      );
      this.store.save();
    }
  }

  async #handleOwnerAuthenticatorCommand(socket, message, account) {
    const commandMessageId = String(message.key.id || "");
    const target = normalizeWhatsAppId(message.key.remoteJid);

    if (
      commandMessageId &&
      this.store.isCommandMessageProcessed?.(commandMessageId)
    ) {
      this.store.addLog(
        "authenticator",
        `Comando 2FA duplicado ignorado: ${account.command}`,
        {
          command: account.command,
          authenticatorId: account.id,
          chatId: target,
          commandMessageId
        }
      );
      this.store.save();
      return;
    }

    try {
      let fresh = await this.authenticator.getFreshCodeByCommand(
        account.command,
        AUTHENTICATOR_SEND_WINDOW
      );
      if (!fresh) return;

      const stopTyping = await this.beginTyping(target);
      await this.sleepFn(350);
      await stopTyping();

      fresh = await this.authenticator.getFreshCodeByCommand(
        account.command,
        AUTHENTICATOR_SEND_WINDOW
      );
      if (!fresh) return;

      await socket.sendMessage(target, {
        text: formatAuthenticatorCodeMessage(fresh)
      });
      if (commandMessageId) {
        this.store.markCommandMessageProcessed?.(commandMessageId);
      }
      this.store.addLog(
        "authenticator",
        `Código 2FA enviado con ${fresh.command} · ${fresh.service} · ${fresh.secondsRemaining} s de vigencia`,
        {
          command: fresh.command,
          authenticatorId: fresh.id,
          chatId: target,
          secondsRemaining: fresh.secondsRemaining,
          waitedMilliseconds: fresh.waitedMilliseconds
        }
      );
      this.store.save();
    } catch (error) {
      this.store.addLog(
        "authenticator",
        `No se envió ${account.command}: ${error.message}`,
        {
          command: account.command,
          authenticatorId: account.id,
          chatId: target,
          errorCode: error.code || null
        }
      );
      this.store.save();
    }
  }

  async beginTyping(chatId, { recording = false } = {}) {
    if (!this.status.ready || !this.socket) return async () => undefined;
    const socket = this.socket;
    const target = normalizeWhatsAppId(chatId);
    try {
      await socket.presenceSubscribe(target).catch(() => undefined);
      await socket.sendPresenceUpdate(recording ? "recording" : "composing", target);
      return async () => {
        if (this.socket !== socket) return;
        await socket.sendPresenceUpdate("paused", target).catch(() => undefined);
      };
    } catch {
      return async () => undefined;
    }
  }

  async sendText(chatId, text, { typingAlreadyStarted = false } = {}) {
    if (!this.status.ready || !this.socket) {
      throw new Error("WhatsApp todavía no está conectado.");
    }
    const socket = this.socket;
    const target = normalizeWhatsAppId(chatId);
    const stopTyping = typingAlreadyStarted
      ? async () => undefined
      : await this.beginTyping(target);
    await this.sleepFn(calculateHumanDelay(text));
    await stopTyping();
    const result = await socket.sendMessage(target, { text: String(text) });
    this.store.addLog("outgoing", `Mensaje enviado a ${target}`, {
      chatId: target,
      preview: String(text).slice(0, 180)
    });
    this.store.save();
    return result;
  }

  async sendMedia(chatId, filePath, options = {}) {
    if (!this.status.ready || !this.socket) {
      throw new Error("WhatsApp todavía no está conectado.");
    }
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) throw new Error("El archivo solicitado no existe.");

    const socket = this.socket;
    const target = normalizeWhatsAppId(chatId);
    const extension = path.extname(resolved).toLowerCase();
    const mimeType = mimeTypeForExtension(extension);
    const buffer = await fs.promises.readFile(resolved);
    const stopState = await this.beginTyping(target, {
      recording: Boolean(options.asVoice)
    });
    await this.sleepFn(options.asVoice ? 1800 : 1000);
    await stopState();

    let content;
    if (options.asVoice || mimeType.startsWith("audio/")) {
      content = {
        audio: buffer,
        mimetype: mimeType,
        ptt: Boolean(options.asVoice)
      };
    } else if (mimeType.startsWith("image/")) {
      content = { image: buffer, caption: options.caption || undefined };
    } else if (mimeType.startsWith("video/")) {
      content = { video: buffer, caption: options.caption || undefined };
    } else {
      content = {
        document: buffer,
        mimetype: mimeType,
        fileName: path.basename(resolved),
        caption: options.caption || undefined
      };
    }

    const result = await socket.sendMessage(target, content);
    this.store.addLog("outgoing", `Archivo enviado a ${target}`, {
      chatId: target,
      fileName: path.basename(resolved)
    });
    this.store.save();
    return result;
  }

  async #stopSocket({ logout = false } = {}) {
    this.#clearReadyWatchdog();
    this.#clearQrWatchdog();
    this.#clearReconnectTimer();
    const socket = this.socket;
    this.socket = null;
    this.authState = null;
    this.generation += 1;
    if (!socket) {
      return { hadSocket: false, remoteLogoutCompleted: false };
    }

    let remoteLogoutCompleted = false;
    try {
      socket.ev?.removeAllListeners?.();
      if (logout) {
        await withTimeout(
          socket.logout("Sesión cerrada desde JadrixServs"),
          this.logoutTimeoutMs,
          "WhatsApp no confirmó el cierre remoto a tiempo"
        );
        remoteLogoutCompleted = true;
      } else {
        await withTimeout(
          socket.end(new Error("Reinicio solicitado por JadrixServs")),
          this.logoutTimeoutMs,
          "El socket de WhatsApp no se cerró a tiempo"
        );
      }
    } catch {
      try {
        await withTimeout(
          socket.end(undefined),
          Math.min(this.logoutTimeoutMs, 1500),
          "El socket de WhatsApp continuó sin responder"
        );
      } catch {
        // El socket ya estaba cerrado.
      }
    } finally {
      socket.ev?.destroy?.();
    }
    return { hadSocket: true, remoteLogoutCompleted };
  }

  async #restartInternal(reason) {
    if (this.resetInProgress) {
      return this.resetPromise;
    }
    if (this.restartPromise) return this.restartPromise;
    this.restartPromise = (async () => {
      await this.pendingCredsSave.catch(() => undefined);
      await this.#stopSocket();
      await this.sleepFn(800);
      this.#setStatus({
        state: "restarting",
        ready: false,
        qrDataUrl: null,
        phone: null,
        name: null,
        error: `Reiniciando WhatsApp: ${reason}.`
      });
      await this.initialize();
    })();
    try {
      await this.restartPromise;
    } finally {
      this.restartPromise = null;
    }
  }

  async restart() {
    this.autoRecoveryAttempts = 0;
    this.reconnectAttempts = 0;
    return this.#restartInternal("solicitud manual");
  }

  async forceReadyProbe() {
    if (this.status.ready) return { recovered: true, alreadyReady: true };
    if (!this.socket) throw new Error("WhatsApp todavía no está iniciado.");
    if (this.status.state === "qr") {
      throw new Error("Primero escanea el código QR con tu celular.");
    }
    this.#setStatus({
      state: "recovering",
      ready: false,
      error: "Reabriendo la sesión vinculada…"
    });
    await this.#restartInternal("conexión forzada desde el panel");
    return { recovered: false, restarted: true };
  }

  async resetSession() {
    if (this.resetPromise) return this.resetPromise;

    this.resetInProgress = true;
    const activeRestart = this.restartPromise;
    const activeInitialization = this.initializePromise;
    this.resetPromise = (async () => {
      this.autoRecoveryAttempts = 0;
      this.reconnectAttempts = 0;
      this.#clearReadyWatchdog();
      this.#clearReconnectTimer();
      this.#setStatus({
        state: "resetting",
        ready: false,
        qrDataUrl: null,
        qrUpdatedAt: null,
        loadingPercent: 10,
        loadingMessage: "Cerrando la sesión anterior",
        waState: "RESETTING",
        phone: null,
        name: null,
        recoveryAttempts: 0,
        reconnectAttempts: 0,
        error: null
      });

      const stopResult = await this.#stopSocket({ logout: true });
      await this.pendingCredsSave.catch(() => undefined);
      this.pendingCredsSave = Promise.resolve();
      await activeRestart?.catch(() => undefined);
      await activeInitialization?.catch(() => undefined);

      if (this.socket) {
        await this.#stopSocket();
      }

      await fs.promises.rm(this.sessionDir, {
        recursive: true,
        force: true
      });
      await fs.promises.mkdir(this.sessionDir, { recursive: true });
      const remainingSessionFiles = await fs.promises.readdir(this.sessionDir);
      if (remainingSessionFiles.length > 0) {
        throw new Error(
          "No se pudieron eliminar por completo las credenciales anteriores."
        );
      }

      this.connectionCandidates = null;
      this.connectionCandidateIndex = 0;
      this.connectionCompatibilityCycles = 0;
      this.activeConnectionCandidate = null;
      this.#setStatus({
        state: "reset",
        ready: false,
        qrDataUrl: null,
        qrUpdatedAt: null,
        loadingPercent: 25,
        loadingMessage: "Credenciales eliminadas; solicitando un QR nuevo",
        waState: "RESET",
        phone: null,
        name: null,
        recoveryAttempts: 0,
        reconnectAttempts: 0,
        error: null
      });
      this.store.addLog(
        "whatsapp",
        stopResult.remoteLogoutCompleted
          ? "Sesión cerrada en WhatsApp y credenciales eliminadas; solicitando QR nuevo"
          : "WhatsApp no confirmó el cierre remoto, pero las credenciales locales fueron eliminadas; solicitando QR nuevo"
      );
      this.store.save();

      await this.initialize({ force: true });
      return {
        reset: true,
        remoteLogoutCompleted: stopResult.remoteLogoutCompleted,
        status: this.getStatus()
      };
    })();

    try {
      return await this.resetPromise;
    } catch (error) {
      this.#setStatus({
        state: "error",
        ready: false,
        qrDataUrl: null,
        loadingPercent: null,
        loadingMessage: null,
        waState: "RESET_ERROR",
        error: `No se pudo preparar una sesión nueva: ${error.message}`
      });
      this.store.addLog(
        "error",
        `No se pudo restablecer WhatsApp: ${error.message}`
      );
      this.store.save();
      throw error;
    } finally {
      this.resetInProgress = false;
      this.resetPromise = null;
    }
  }

  async shutdown() {
    await this.pendingCredsSave.catch(() => undefined);
    await this.#stopSocket();
    this.#clearQrWatchdog();
    this.#setStatus({
      state: "stopped",
      ready: false,
      qrDataUrl: null,
      phone: null,
      name: null,
      error: null
    });
  }
}

module.exports = {
  WhatsAppService,
  buildConnectionCandidates,
  normalizeWhatsAppId,
  calculateHumanDelay,
  compatibleBrowserProfile,
  extractMessageBody,
  formatAuthenticatorCodeMessage,
  formatWhatsAppWebVersion,
  getDisconnectStatusCode,
  isSensitiveSignalSessionDump,
  parseWhatsAppWebVersion
};
