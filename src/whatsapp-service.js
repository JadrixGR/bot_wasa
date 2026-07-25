"use strict";

const fs = require("node:fs");
const path = require("node:path");
const QRCode = require("qrcode");
const { Client, LocalAuth, MessageMedia } = require("whatsapp-web.js");
const { BotEngine } = require("./bot-engine");

function normalizeWhatsAppId(value) {
  if (String(value).includes("@")) return String(value);
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 9) digits = `51${digits}`;
  if (digits.length < 10) throw new Error("Número de WhatsApp no válido.");
  return `${digits}@c.us`;
}

class WhatsAppService {
  constructor({ store, sessionDir, mediaDir }) {
    this.store = store;
    this.sessionDir = path.resolve(sessionDir);
    this.mediaDir = path.resolve(mediaDir);
    this.client = null;
    this.engine = null;
    this.queues = new Map();
    this.status = {
      state: "starting",
      ready: false,
      qrDataUrl: null,
      qrUpdatedAt: null,
      phone: null,
      name: null,
      error: null,
      updatedAt: new Date().toISOString()
    };
    fs.mkdirSync(this.sessionDir, { recursive: true });
    fs.mkdirSync(this.mediaDir, { recursive: true });
  }

  getStatus() {
    return structuredClone(this.status);
  }

  #setStatus(patch) {
    this.status = {
      ...this.status,
      ...patch,
      updatedAt: new Date().toISOString()
    };
  }

  async initialize() {
    if (process.env.DISABLE_WHATSAPP === "1") {
      this.#setStatus({ state: "disabled", ready: false });
      return;
    }
    if (this.client) return;

    const executablePath =
      process.env.CHROME_BIN ||
      (fs.existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);

    this.client = new Client({
      authStrategy: new LocalAuth({
        clientId: "jadrixservs-v4",
        dataPath: this.sessionDir
      }),
      puppeteer: {
        headless: true,
        executablePath,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-zygote"
        ]
      }
    });

    this.engine = new BotEngine({
      store: this.store,
      greetingCooldownHours: process.env.GREETING_COOLDOWN_HOURS || 24,
      sendText: (chatId, text) => this.sendText(chatId, text),
      sendMedia: (chatId, filePath, options) => this.sendMedia(chatId, filePath, options)
    });

    this.client.on("qr", async (qr) => {
      try {
        const qrDataUrl = await QRCode.toDataURL(qr, { width: 420, margin: 2 });
        this.#setStatus({
          state: "qr",
          ready: false,
          qrDataUrl,
          qrUpdatedAt: new Date().toISOString(),
          error: null
        });
        this.store.addLog("whatsapp", "Nuevo código QR disponible");
        this.store.save();
      } catch (error) {
        this.#setStatus({ state: "error", error: error.message });
      }
    });

    this.client.on("authenticated", () => {
      this.#setStatus({ state: "authenticated", error: null });
    });

    this.client.on("ready", () => {
      const info = this.client.info;
      this.#setStatus({
        state: "ready",
        ready: true,
        qrDataUrl: null,
        phone: info?.wid?.user || null,
        name: info?.pushname || null,
        error: null
      });
      this.store.addLog("whatsapp", `WhatsApp conectado${info?.wid?.user ? `: ${info.wid.user}` : ""}`);
      this.store.save();
    });

    this.client.on("auth_failure", (message) => {
      this.#setStatus({
        state: "auth_failure",
        ready: false,
        error: String(message || "Falló la autenticación")
      });
      this.store.addLog("error", `Falló la autenticación: ${message}`);
      this.store.save();
    });

    this.client.on("disconnected", (reason) => {
      this.#setStatus({
        state: "disconnected",
        ready: false,
        phone: null,
        error: String(reason || "WhatsApp desconectado")
      });
      this.store.addLog("whatsapp", `WhatsApp desconectado: ${reason}`);
      this.store.save();
    });

    this.client.on("message", (message) => {
      const chatId = message.from;
      const previous = this.queues.get(chatId) || Promise.resolve();
      const next = previous
        .catch(() => undefined)
        .then(() => this.#handleMessage(message))
        .catch((error) => {
          this.store.addLog("error", `Error respondiendo a ${chatId}: ${error.message}`, { chatId });
          this.store.save();
        })
        .finally(() => {
          if (this.queues.get(chatId) === next) this.queues.delete(chatId);
        });
      this.queues.set(chatId, next);
    });

    this.#setStatus({ state: "initializing", ready: false, error: null });
    try {
      await this.client.initialize();
    } catch (error) {
      this.#setStatus({ state: "error", ready: false, error: error.message });
      this.store.addLog("error", `No se pudo iniciar WhatsApp: ${error.message}`);
      this.store.save();
      this.client = null;
      throw error;
    }
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

  async sendText(chatId, text) {
    if (!this.status.ready || !this.client) {
      throw new Error("WhatsApp todavía no está conectado.");
    }
    const target = normalizeWhatsAppId(chatId);
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
    return this.client.sendMessage(target, media, {
      caption: options.caption || undefined,
      sendAudioAsVoice: Boolean(options.asVoice)
    });
  }

  async restart() {
    if (this.client) {
      try {
        await this.client.destroy();
      } catch {
        // El proceso puede reiniciarse aunque Chromium ya se haya cerrado.
      }
      this.client = null;
    }
    this.#setStatus({
      state: "restarting",
      ready: false,
      qrDataUrl: null,
      phone: null,
      error: null
    });
    await this.initialize();
  }

  async resetSession() {
    if (this.client) {
      try {
        await this.client.logout();
      } catch {
        try {
          await this.client.destroy();
        } catch {
          // Continúa para limpiar la sesión local.
        }
      }
      this.client = null;
    }

    const sessionPath = path.join(this.sessionDir, "session-jadrixservs-v4");
    if (fs.existsSync(sessionPath)) {
      fs.rmSync(sessionPath, { recursive: true, force: true });
    }
    this.#setStatus({
      state: "reset",
      ready: false,
      qrDataUrl: null,
      phone: null,
      name: null,
      error: null
    });
    this.store.addLog("whatsapp", "Sesión de WhatsApp cerrada; se solicitará un QR nuevo");
    this.store.save();
    await this.initialize();
  }
}

module.exports = { WhatsAppService, normalizeWhatsAppId };
