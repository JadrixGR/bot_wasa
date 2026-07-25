"use strict";

const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const { BotEngine } = require("./bot-engine");

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function normalizeWhatsAppId(value) {
  if (String(value).includes("@")) return String(value);
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 9) digits = `51${digits}`;
  if (digits.length < 10) throw new Error("Número de WhatsApp no válido.");
  return `${digits}@c.us`;
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

class WhatsAppService {
  constructor({ store, sessionDir, mediaDir, ai }) {
    this.store = store;
    this.sessionDir = path.resolve(sessionDir);
    this.mediaDir = path.resolve(mediaDir);
    this.ai = ai;
    this.client = null;
    this.engine = null;
    this.queues = new Map();
    this.generation = 0;
    this.initializePromise = null;
    this.restartPromise = null;
    this.readyWatchdog = null;
    this.reconnectTimer = null;
    this.autoRecoveryAttempts = 0;
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
      webVersion: null,
      recoveryAttempts: 0,
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

  #isCurrent(client, generation) {
    return this.client === client && this.generation === generation;
  }

  #clearReadyWatchdog() {
    if (this.readyWatchdog) clearTimeout(this.readyWatchdog);
    this.readyWatchdog = null;
  }

  #scheduleReadyWatchdog(client, generation, delayMs) {
    if (!this.#isCurrent(client, generation) || this.status.ready) return;
    this.#clearReadyWatchdog();
    const configured = Number(process.env.WHATSAPP_READY_TIMEOUT_MS) || 60000;
    this.readyWatchdog = setTimeout(
      () => {
        this.#recoverStalledConnection(client, generation).catch((error) => {
          if (!this.#isCurrent(client, generation)) return;
          this.#setStatus({
            state: "stalled",
            ready: false,
            error: `WhatsApp quedó vinculado, pero no terminó de iniciar: ${error.message}`
          });
        });
      },
      Math.max(10000, delayMs || configured)
    );
    this.readyWatchdog.unref();
  }

  async #collectDiagnostics(client) {
    const result = {
      browserConnected: Boolean(
        client?.pupBrowser?.isConnected?.() || client?.pupBrowser?.connected
      ),
      pageClosed: true,
      socketState: null,
      hasSynced: null,
      hasWWebJS: false,
      webVersion: null
    };
    try {
      if (!client?.pupPage || client.pupPage.isClosed()) return result;
      return {
        ...result,
        pageClosed: false,
        ...(await client.pupPage.evaluate(() => {
          let socket = null;
          try {
            socket = window.require("WAWebSocketModel").Socket;
          } catch {
            socket = null;
          }
          return {
            socketState: socket?.state || null,
            hasSynced: Boolean(socket?.hasSynced),
            hasWWebJS: typeof window.WWebJS !== "undefined",
            webVersion: window.Debug?.VERSION || null
          };
        }))
      };
    } catch (error) {
      return { ...result, diagnosticError: error.message };
    }
  }

  async #recoverStalledConnection(client, generation, { manual = false } = {}) {
    if (!this.#isCurrent(client, generation) || this.status.ready) {
      return { recovered: this.status.ready, skipped: true };
    }
    if (!manual && !["authenticated", "loading", "recovering"].includes(this.status.state)) {
      return { recovered: false, skipped: true };
    }

    this.#clearReadyWatchdog();
    const diagnostics = await this.#collectDiagnostics(client);
    this.#setStatus({
      state: "recovering",
      ready: false,
      waState: diagnostics.socketState || this.status.waState,
      webVersion: diagnostics.webVersion || this.status.webVersion,
      error: "La sesión fue vinculada. Estamos completando la carga automáticamente…"
    });
    this.store.addLog("whatsapp", "Recuperando conexión detenida después del QR", diagnostics);
    this.store.save();

    let forcedSync = false;
    try {
      if (
        !diagnostics.pageClosed &&
        ["CONNECTED", "OPENING"].includes(diagnostics.socketState)
      ) {
        forcedSync = await client.pupPage.evaluate(() => {
          if (typeof window.onAppStateHasSyncedEvent !== "function") return false;
          void window.onAppStateHasSyncedEvent();
          return true;
        });
      }
    } catch (error) {
      this.store.addLog("error", `No se pudo completar la sincronización: ${error.message}`);
      this.store.save();
    }

    if (forcedSync) {
      await sleep(12000);
      if (!this.#isCurrent(client, generation) || this.status.ready) {
        return { recovered: this.status.ready, forcedSync: true };
      }
    }

    if (this.autoRecoveryAttempts < 1) {
      this.autoRecoveryAttempts += 1;
      this.#setStatus({
        state: "restarting",
        recoveryAttempts: this.autoRecoveryAttempts,
        error: "La primera carga no terminó. Reiniciando una vez sin borrar la sesión…"
      });
      await this.#restartInternal("recuperación posterior al QR");
      return { recovered: false, restarted: true };
    }

    this.#setStatus({
      state: "stalled",
      ready: false,
      recoveryAttempts: this.autoRecoveryAttempts,
      error:
        "El celular vinculó la sesión, pero WhatsApp Web no terminó de cargar. Pulsa “Forzar conexión”; si continúa igual, usa “Cerrar sesión” y escanea un QR nuevo."
    });
    return { recovered: false, stalled: true };
  }

  async initialize() {
    if (process.env.DISABLE_WHATSAPP === "1") {
      this.#setStatus({ state: "disabled", ready: false });
      return;
    }
    if (this.client) return;
    if (this.initializePromise) return this.initializePromise;

    this.initializePromise = this.#initializeClient();
    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  async #initializeClient() {
    const generation = ++this.generation;
    const executablePath =
      process.env.CHROME_BIN ||
      (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);

    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: "jadrixservs-v4",
        dataPath: this.sessionDir
      }),
      authTimeoutMs: 120000,
      qrMaxRetries: 8,
      takeoverOnConflict: true,
      takeoverTimeoutMs: 10000,
      deviceName: "JadrixServs Bot",
      browserName: "Chrome",
      userAgent:
        process.env.WHATSAPP_USER_AGENT ||
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36",
      puppeteer: {
        headless: true,
        executablePath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-background-networking",
          "--disable-background-timer-throttling",
          "--disable-renderer-backgrounding"
        ]
      }
    });

    this.client = client;
    this.engine = new BotEngine({
      store: this.store,
      ai: this.ai,
      sendText: (chatId, text, options) => this.sendText(chatId, text, options),
      sendMedia: (chatId, filePath, options) =>
        this.sendMedia(chatId, filePath, options),
      beginTyping: (chatId) => this.beginTyping(chatId)
    });

    client.on("qr", async (qr) => {
      if (!this.#isCurrent(client, generation)) return;
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, { width: 420, margin: 2 });
        this.autoRecoveryAttempts = 0;
        this.#clearReadyWatchdog();
        this.#setStatus({
          state: "qr",
          ready: false,
          qrDataUrl,
          qrUpdatedAt: new Date().toISOString(),
          loadingPercent: null,
          loadingMessage: null,
          recoveryAttempts: 0,
          error: null
        });
        this.store.addLog("whatsapp", "Nuevo código QR disponible");
        this.store.save();
      } catch (error) {
        this.#setStatus({ state: "error", error: error.message });
      }
    });

    client.on("loading_screen", (percent, message) => {
      if (!this.#isCurrent(client, generation) || this.status.ready) return;
      const numericPercent = Number(percent);
      this.#setStatus({
        state: "loading",
        ready: false,
        qrDataUrl: null,
        loadingPercent: Number.isFinite(numericPercent) ? numericPercent : null,
        loadingMessage: String(message || "WhatsApp"),
        error: null
      });
      if (numericPercent >= 95) {
        this.#scheduleReadyWatchdog(client, generation, 35000);
      }
    });

    client.on("authenticated", () => {
      if (!this.#isCurrent(client, generation)) return;
      this.#setStatus({
        state: "authenticated",
        ready: false,
        qrDataUrl: null,
        error: null
      });
      this.store.addLog("whatsapp", "QR aceptado; sincronizando WhatsApp Web");
      this.store.save();
      this.#scheduleReadyWatchdog(client, generation);
    });

    client.on("change_state", (state) => {
      if (!this.#isCurrent(client, generation)) return;
      this.#setStatus({ waState: String(state || "") });
    });

    client.on("ready", async () => {
      if (!this.#isCurrent(client, generation)) return;
      this.#clearReadyWatchdog();
      this.autoRecoveryAttempts = 0;
      const diagnostics = await this.#collectDiagnostics(client);
      const info = client.info;
      this.#setStatus({
        state: "ready",
        ready: true,
        qrDataUrl: null,
        loadingPercent: 100,
        waState: diagnostics.socketState || "CONNECTED",
        webVersion: diagnostics.webVersion,
        phone: info?.wid?.user || null,
        name: info?.pushname || null,
        recoveryAttempts: 0,
        error: null
      });
      this.store.addLog(
        "whatsapp",
        `WhatsApp conectado${info?.wid?.user ? `: ${info.wid.user}` : ""}`
      );
      this.store.save();
    });

    client.on("auth_failure", (message) => {
      if (!this.#isCurrent(client, generation)) return;
      this.#clearReadyWatchdog();
      this.#setStatus({
        state: "auth_failure",
        ready: false,
        error: String(message || "Falló la autenticación")
      });
      this.store.addLog("error", `Falló la autenticación: ${message}`);
      this.store.save();
    });

    client.on("disconnected", (reason) => {
      if (!this.#isCurrent(client, generation)) return;
      this.#clearReadyWatchdog();
      this.#setStatus({
        state: "disconnected",
        ready: false,
        phone: null,
        waState: String(reason || ""),
        error: String(reason || "WhatsApp desconectado")
      });
      this.store.addLog("whatsapp", `WhatsApp desconectado: ${reason}`);
      this.store.save();
      if (String(reason) !== "LOGOUT") this.#scheduleReconnect();
    });

    client.on("message", (message) => {
      if (!this.#isCurrent(client, generation)) return;
      const chatId = message.from;
      const previous = this.queues.get(chatId) || Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(() => this.#handleMessage(message))
        .catch((error) => {
          this.store.addLog("error", `Error respondiendo a ${chatId}: ${error.message}`, {
            chatId
          });
          this.store.save();
        })
        .finally(() => {
          if (this.queues.get(chatId) === next) this.queues.delete(chatId);
        });
      this.queues.set(chatId, next);
    });

    this.#setStatus({
      state: "initializing",
      ready: false,
      qrDataUrl: null,
      loadingPercent: null,
      loadingMessage: null,
      phone: null,
      error: null
    });

    try {
      await client.initialize();
      if (this.#isCurrent(client, generation) && client.pupPage) {
        client.pupPage.on("pageerror", (error) => {
          if (!this.#isCurrent(client, generation)) return;
          this.store.addLog("browser", `WhatsApp Web: ${error.message}`);
          this.store.save();
        });
        client.pupPage.on("close", () => {
          if (!this.#isCurrent(client, generation) || this.status.state === "restarting") {
            return;
          }
          this.#setStatus({
            state: "disconnected",
            ready: false,
            error: "El navegador de WhatsApp Web se cerró inesperadamente."
          });
          this.#scheduleReconnect();
        });
      }
    } catch (error) {
      if (!this.#isCurrent(client, generation)) return;
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
      this.client = null;
      throw error;
    }
  }

  #scheduleReconnect() {
    if (this.reconnectTimer || this.restartPromise) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.#restartInternal("reconexión automática").catch((error) => {
        this.#setStatus({
          state: "error",
          ready: false,
          error: `No se pudo reconectar: ${error.message}`
        });
      });
    }, 8000);
    this.reconnectTimer.unref();
  }

  async #handleMessage(message) {
    if (
      message.fromMe ||
      message.from === "status@broadcast" ||
      message.from.endsWith("@g.us") ||
      message.type === "e2e_notification"
    ) {
      return;
    }

    let fromName = "";
    try {
      const contact = await message.getContact();
      fromName = contact.pushname || contact.name || "";
    } catch {
      fromName = "";
    }

    this.store.addLog("incoming", `Mensaje de ${fromName || message.from}`, {
      chatId: message.from,
      preview: String(message.body || "").slice(0, 180)
    });
    this.store.save();

    await this.engine.handleIncoming({
      chatId: message.from,
      body: message.body,
      hasMedia: message.hasMedia,
      mediaType: message.type,
      fromName
    });
  }

  async beginTyping(chatId, { recording = false } = {}) {
    if (!this.status.ready || !this.client) return async () => undefined;
    const target = normalizeWhatsAppId(chatId);
    try {
      const chat = await this.client.getChatById(target);
      await chat.sendSeen().catch(() => undefined);
      if (recording) await chat.sendStateRecording();
      else await chat.sendStateTyping();
      return async () => {
        await chat.clearState().catch(() => undefined);
      };
    } catch {
      return async () => undefined;
    }
  }

  async sendText(chatId, text) {
    if (!this.status.ready || !this.client) {
      throw new Error("WhatsApp todavía no está conectado.");
    }
    const target = normalizeWhatsAppId(chatId);
    const stopTyping = await this.beginTyping(target);
    await sleep(calculateHumanDelay(text));
    await stopTyping();
    const result = await this.client.sendMessage(target, String(text));
    this.store.addLog("outgoing", `Mensaje enviado a ${target}`, {
      chatId: target,
      preview: String(text).slice(0, 180)
    });
    this.store.save();
    return result;
  }

  async sendMedia(chatId, filePath, options = {}) {
    if (!this.status.ready || !this.client) {
      throw new Error("WhatsApp todavía no está conectado.");
    }
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) throw new Error("El archivo solicitado no existe.");
    const media = MessageMedia.fromFilePath(resolved);
    const target = normalizeWhatsAppId(chatId);
    const stopState = await this.beginTyping(target, {
      recording: Boolean(options.asVoice)
    });
    await sleep(options.asVoice ? 1800 : 1000);
    await stopState();
    return this.client.sendMessage(target, media, {
      caption: options.caption || undefined,
      sendAudioAsVoice: Boolean(options.asVoice)
    });
  }

  async #stopClient({ logout = false } = {}) {
    this.#clearReadyWatchdog();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const client = this.client;
    this.client = null;
    this.generation += 1;
    if (!client) return;
    try {
      if (logout) await client.logout();
      else await client.destroy();
    } catch {
      try {
        await client.destroy();
      } catch {
        // El proceso continúa aunque Chromium ya estuviera cerrado.
      }
    }
  }

  async #restartInternal(reason) {
    if (this.restartPromise) return this.restartPromise;
    this.restartPromise = (async () => {
      await this.#stopClient();
      await sleep(1500);
      this.#setStatus({
        state: "restarting",
        ready: false,
        qrDataUrl: null,
        phone: null,
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
    return this.#restartInternal("solicitud manual");
  }

  async forceReadyProbe() {
    if (!this.client) throw new Error("WhatsApp todavía no está iniciado.");
    if (this.status.ready) return { recovered: true, alreadyReady: true };
    if (this.status.state === "qr") {
      throw new Error("Primero escanea el código QR con tu celular.");
    }
    return this.#recoverStalledConnection(this.client, this.generation, {
      manual: true
    });
  }

  async resetSession() {
    this.autoRecoveryAttempts = 0;
    await this.#stopClient({ logout: true });
    const sessionPath = path.join(this.sessionDir, "session-jadrixservs-v4");
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
    this.#setStatus({
      state: "reset",
      ready: false,
      qrDataUrl: null,
      loadingPercent: null,
      waState: null,
      phone: null,
      name: null,
      recoveryAttempts: 0,
      error: null
    });
    this.store.addLog(
      "whatsapp",
      "Sesión de WhatsApp cerrada; se solicitará un QR nuevo"
    );
    this.store.save();
    await this.initialize();
  }
}

module.exports = {
  WhatsAppService,
  normalizeWhatsAppId,
  calculateHumanDelay
};
