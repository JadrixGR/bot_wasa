"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createInitialData, defaultSettings } = require("./defaults");
const { calculateRenewal, todayInTimeZone } = require("./date-utils");

function normalizeWhatsAppDigits(value) {
  const localPart = String(value || "")
    .split("@")[0]
    .split(":")[0];
  let digits = localPart.replace(/\D/g, "");
  if (digits.length === 9) digits = `51${digits}`;
  return digits;
}

class JsonStore {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.filePath = path.join(this.dataDir, "jadrixservs-v4.json");
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.data = this.#load();
  }

  #load() {
    if (!fs.existsSync(this.filePath)) {
      const initial = createInitialData();
      this.#write(initial);
      return initial;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      const initial = createInitialData();
      const isPreTrainingVersion = Number(parsed.version || 0) < 4.3;
      const isUpgrade = Number(parsed.version || 0) < initial.version;
      const migratedAt = new Date().toISOString();
      const previousConversations = parsed.conversations || {};
      const migrated = {
        ...initial,
        ...parsed,
        version: initial.version,
        settings: {
          ...defaultSettings,
          ...(parsed.settings || {}),
          ...(isPreTrainingVersion
            ? {
                welcomeTriggers: defaultSettings.welcomeTriggers,
                greetingMessages: structuredClone(defaultSettings.greetingMessages)
              }
            : {}),
          inboundMode: "welcome_once"
        },
        media: { ...initial.media, ...(parsed.media || {}) },
        knowledgeBase: Array.isArray(parsed.knowledgeBase)
          ? parsed.knowledgeBase
          : initial.knowledgeBase,
        clients: Array.isArray(parsed.clients)
          ? parsed.clients.map((client) => ({
              ...client,
              accountReference: String(client.accountReference || ""),
              reminderDays: 2,
              autoReminder:
                client.autoReminder === undefined
                  ? true
                  : Boolean(client.autoReminder),
              autoCharge: Boolean(client.autoCharge)
            }))
          : [],
        logs: Array.isArray(parsed.logs) ? parsed.logs : [],
        conversations: Object.fromEntries(
          Object.entries(previousConversations).map(([chatId, value]) => {
            const conversation =
              value && typeof value === "object" ? value : {};
            return [
              chatId,
              isUpgrade && !conversation.welcomeSequenceSentAt
                ? {
                    ...conversation,
                    welcomeMessagesSent: 3,
                    welcomeSequenceSentAt:
                      conversation.lastInboundAt ||
                      conversation.updatedAt ||
                      migratedAt
                  }
                : conversation
            ];
          })
        )
      };
      if (isUpgrade) this.#write(migrated);
      return migrated;
    } catch (error) {
      const backup = `${this.filePath}.corrupt-${Date.now()}`;
      fs.copyFileSync(this.filePath, backup);
      const initial = createInitialData();
      this.#write(initial);
      return initial;
    }
  }

  #write(data) {
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, this.filePath);
  }

  save() {
    this.#write(this.data);
  }

  snapshot() {
    return structuredClone(this.data);
  }

  getSettings() {
    return structuredClone(this.data.settings);
  }

  updateSettings(patch) {
    const allowed = [
      "businessName",
      "inboundMode",
      "shortGreeting",
      "welcomeTriggers",
      "peruPayment",
      "internationalPayment",
      "receiptReply",
      "humanReply",
      "fallbackReply",
      "reminderTemplate",
      "chargeTemplate",
      "greetingMessages"
    ];
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        if (key === "greetingMessages") {
          if (!Array.isArray(patch[key]) || patch[key].length !== 3) {
            throw new Error("El saludo debe contener exactamente 3 mensajes.");
          }
          const messages = patch[key].map((message) =>
            String(message || "").trim()
          );
          if (messages.some((message) => !message)) {
            throw new Error("Los 3 mensajes de bienvenida son obligatorios.");
          }
          this.data.settings[key] = messages;
        } else {
          this.data.settings[key] = String(patch[key]);
        }
      }
    }
    this.save();
    return this.getSettings();
  }

  getKnowledgeBase() {
    return structuredClone(this.data.knowledgeBase || []);
  }

  updateKnowledgeBase(entries) {
    if (!Array.isArray(entries)) {
      throw new Error("El entrenamiento debe ser una lista de respuestas.");
    }
    if (entries.length > 200) {
      throw new Error("El entrenamiento admite hasta 200 respuestas.");
    }

    this.data.knowledgeBase = entries.map((entry) => {
      const title = String(entry?.title || "").trim().slice(0, 120);
      const answer = String(entry?.answer || "").trim().slice(0, 3000);
      const rawTriggers = Array.isArray(entry?.triggers)
        ? entry.triggers
        : String(entry?.triggers || "").split(",");
      const triggers = [...new Set(
        rawTriggers
          .map((trigger) => String(trigger || "").trim().slice(0, 160))
          .filter(Boolean)
      )].slice(0, 20);

      if (!title) throw new Error("Cada respuesta entrenada necesita un nombre.");
      if (!triggers.length) {
        throw new Error(`Agrega al menos una frase de activación para “${title}”.`);
      }
      if (!answer) throw new Error(`Agrega la respuesta para “${title}”.`);

      return {
        id: String(entry?.id || crypto.randomUUID()),
        title,
        triggers,
        answer,
        enabled: entry?.enabled !== false
      };
    });
    this.addLog(
      "training",
      `Entrenamiento actualizado: ${this.data.knowledgeBase.length} respuestas`
    );
    this.save();
    return this.getKnowledgeBase();
  }

  listClients({ includeArchived = false } = {}) {
    return structuredClone(
      this.data.clients
        .filter((client) => includeArchived || !client.archived)
        .sort((a, b) => String(a.expiryDate || "").localeCompare(String(b.expiryDate || "")))
    );
  }

  getClient(id) {
    return this.data.clients.find((client) => client.id === id) || null;
  }

  findClientByWhatsApp(...values) {
    const candidates = new Set(values.map(normalizeWhatsAppDigits).filter(Boolean));
    if (!candidates.size) return null;
    return (
      this.data.clients.find(
        (client) =>
          !client.archived &&
          candidates.has(normalizeWhatsAppDigits(client.whatsapp))
      ) || null
    );
  }

  createClient(input) {
    const now = new Date().toISOString();
    const client = this.#normalizeClient({
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
      archived: false,
      lastReminderKey: null,
      lastChargeKey: null,
      ...input,
      autoReminder: input.autoReminder === undefined ? true : input.autoReminder,
      autoCharge: input.autoCharge === undefined ? false : input.autoCharge
    });
    this.data.clients.push(client);
    this.addLog("client", `Cliente registrado: ${client.name}`, { clientId: client.id });
    this.save();
    return structuredClone(client);
  }

  updateClient(id, input) {
    const index = this.data.clients.findIndex((client) => client.id === id);
    if (index === -1) throw new Error("Cliente no encontrado.");
    const updated = this.#normalizeClient({
      ...this.data.clients[index],
      ...input,
      id,
      updatedAt: new Date().toISOString()
    });
    this.data.clients[index] = updated;
    this.addLog("client", `Cliente actualizado: ${updated.name}`, { clientId: id });
    this.save();
    return structuredClone(updated);
  }

  archiveClient(id) {
    return this.updateClient(id, { archived: true, status: "archivado" });
  }

  renewClient(
    id,
    { paymentDate, termMonths = 1, price, paymentMethod, accountReference, notes }
  ) {
    const client = this.getClient(id);
    if (!client) throw new Error("Cliente no encontrado.");
    const paidOn = paymentDate || todayInTimeZone(process.env.BOT_TIMEZONE || "America/Lima");
    const period = calculateRenewal(client.expiryDate, paidOn, termMonths);
    return this.updateClient(id, {
      startDate: period.startDate,
      expiryDate: period.expiryDate,
      termMonths: Math.max(1, Number(termMonths) || 1),
      price: price ?? client.price,
      paymentMethod: paymentMethod ?? client.paymentMethod,
      accountReference: accountReference ?? client.accountReference,
      notes: notes ?? client.notes,
      status: "activo",
      lastPaymentDate: paidOn,
      lastReminderKey: null,
      lastChargeKey: null
    });
  }

  #normalizeClient(input) {
    const name = String(input.name || "").trim();
    const whatsapp = String(input.whatsapp || "").replace(/[^\d+]/g, "");
    const product = String(input.product || "").trim();
    if (!name) throw new Error("Ingresa el nombre del cliente.");
    if (whatsapp.replace(/\D/g, "").length < 9) {
      throw new Error("Ingresa un número de WhatsApp válido.");
    }
    if (!product) throw new Error("Selecciona o escribe un producto.");
    if (!input.startDate || !input.expiryDate) {
      throw new Error("Ingresa la fecha de activación y de vencimiento.");
    }

    return {
      id: input.id,
      name,
      whatsapp,
      product,
      price: String(input.price || "").trim(),
      paymentMethod: String(input.paymentMethod || "").trim(),
      accountReference: String(input.accountReference || "").trim().slice(0, 240),
      startDate: String(input.startDate),
      expiryDate: String(input.expiryDate),
      termMonths: Math.max(1, Number(input.termMonths) || 1),
      status: ["activo", "pendiente", "vencido", "pausado", "archivado"].includes(input.status)
        ? input.status
        : "activo",
      reminderDays: 2,
      autoReminder: Boolean(input.autoReminder),
      autoCharge: Boolean(input.autoCharge),
      notes: String(input.notes || ""),
      archived: Boolean(input.archived),
      lastPaymentDate: input.lastPaymentDate || null,
      lastReminderKey: input.lastReminderKey || null,
      lastChargeKey: input.lastChargeKey || null,
      createdAt: input.createdAt || new Date().toISOString(),
      updatedAt: input.updatedAt || new Date().toISOString()
    };
  }

  getConversation(chatId) {
    return structuredClone(this.data.conversations[chatId] || {});
  }

  updateConversation(chatId, patch) {
    this.data.conversations[chatId] = {
      ...(this.data.conversations[chatId] || {}),
      ...patch,
      updatedAt: new Date().toISOString()
    };
    this.save();
    return this.getConversation(chatId);
  }

  getMedia(kind) {
    return this.data.media[kind] || null;
  }

  setMedia(kind, metadata) {
    if (!["dicloakAudio", "catalogPdf"].includes(kind)) {
      throw new Error("Tipo de archivo no permitido.");
    }
    this.data.media[kind] = metadata;
    this.addLog("media", `${kind} actualizado`);
    this.save();
    return structuredClone(metadata);
  }

  clearMedia(kind) {
    if (!["dicloakAudio", "catalogPdf"].includes(kind)) {
      throw new Error("Tipo de archivo no permitido.");
    }
    const old = this.data.media[kind];
    this.data.media[kind] = null;
    this.save();
    return old;
  }

  addLog(type, message, metadata = {}) {
    this.data.logs.unshift({
      id: crypto.randomUUID(),
      type,
      message,
      metadata,
      createdAt: new Date().toISOString()
    });
    this.data.logs = this.data.logs.slice(0, 1000);
  }

  listLogs(limit = 100) {
    return structuredClone(this.data.logs.slice(0, Math.min(500, Number(limit) || 100)));
  }
}

module.exports = { JsonStore, normalizeWhatsAppDigits };
