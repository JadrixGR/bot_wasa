"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createInitialData, defaultSettings } = require("./defaults");
const {
  addDays,
  calculateRenewal,
  compareDateOnly,
  todayInTimeZone
} = require("./date-utils");

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
    this.backupFilePath = path.join(
      this.dataDir,
      "jadrixservs-v4.backup.json"
    );
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.data = this.#load();
  }

  #load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const { data, isUpgrade } = this.#readAndMigrate(this.filePath);
        if (isUpgrade) this.#write(data);
        return data;
      } catch {
        const corruptCopy = `${this.filePath}.corrupt-${Date.now()}`;
        fs.copyFileSync(this.filePath, corruptCopy);
      }
    }

    if (fs.existsSync(this.backupFilePath)) {
      try {
        const { data } = this.#readAndMigrate(this.backupFilePath);
        data.logs.unshift({
          id: crypto.randomUUID(),
          type: "recovery",
          message:
            "La base principal no se pudo leer y fue recuperada desde la copia automática.",
          metadata: {},
          createdAt: new Date().toISOString()
        });
        data.logs = data.logs.slice(0, 1000);
        this.#write(data, { backupCurrent: false });
        return data;
      } catch {
        // La copia automática tampoco era legible; se inicia una base nueva.
      }
    }

    const initial = createInitialData();
    this.#write(initial, { backupCurrent: false });
    return initial;
  }

  #readAndMigrate(filePath) {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("La base de datos no contiene un objeto válido.");
    }
    const initial = createInitialData();
    const isPreTrainingVersion = Number(parsed.version || 0) < 4.3;
    const isUpgrade = Number(parsed.version || 0) < initial.version;
    const migratedAt = new Date().toISOString();
    const previousConversations =
      parsed.conversations && typeof parsed.conversations === "object"
        ? parsed.conversations
        : {};
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
            autoCharge: Boolean(client.autoCharge),
            durationDays:
              Number.isInteger(Number(client.durationDays)) &&
              Number(client.durationDays) > 0
                ? Number(client.durationDays)
                : null
          }))
        : [],
      processedCommandIds: Array.isArray(parsed.processedCommandIds)
        ? parsed.processedCommandIds.slice(0, 500).map(String)
        : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      conversations: Object.fromEntries(
        Object.entries(previousConversations).map(([chatId, value]) => {
          const conversation = value && typeof value === "object" ? value : {};
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
    migrated.settings.afkEnabled = Boolean(migrated.settings.afkEnabled);
    migrated.settings.afkMessage =
      String(migrated.settings.afkMessage || defaultSettings.afkMessage).trim() ||
      defaultSettings.afkMessage;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(migrated.settings.chargeStartTime || ""))) {
      migrated.settings.chargeStartTime = defaultSettings.chargeStartTime;
    }
    if (migrated.settings.afkEnabled && !migrated.settings.afkSessionId) {
      migrated.settings.afkSessionId = crypto.randomUUID();
    }
    return { data: migrated, isUpgrade };
  }

  #write(data, { backupCurrent = true } = {}) {
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, "utf8");

    if (backupCurrent && fs.existsSync(this.filePath)) {
      try {
        JSON.parse(fs.readFileSync(this.filePath, "utf8"));
        const backupTemporary = `${this.backupFilePath}.tmp`;
        fs.copyFileSync(this.filePath, backupTemporary);
        fs.renameSync(backupTemporary, this.backupFilePath);
      } catch {
        // Nunca se reemplaza una copia válida con una base principal dañada.
      }
    }

    fs.renameSync(temporary, this.filePath);
  }

  save() {
    this.#write(this.data);
  }

  snapshot() {
    return structuredClone(this.data);
  }

  restoreSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
      throw new Error("El respaldo JSON no tiene un formato válido.");
    }
    if (!Array.isArray(snapshot.clients)) {
      throw new Error("El respaldo no contiene una lista válida de clientes.");
    }

    const temporaryImport = path.join(
      this.dataDir,
      `jadrixservs-import-${Date.now()}-${crypto.randomUUID()}.json`
    );
    try {
      fs.writeFileSync(
        temporaryImport,
        `${JSON.stringify(snapshot, null, 2)}
`,
        "utf8"
      );
      const { data } = this.#readAndMigrate(temporaryImport);
      data.media = Object.fromEntries(
        Object.entries(data.media || {}).map(([kind, metadata]) => [
          kind,
          metadata?.path && fs.existsSync(metadata.path) ? metadata : null
        ])
      );
      data.logs.unshift({
        id: crypto.randomUUID(),
        type: "recovery",
        message: `Respaldo restaurado desde el panel: ${data.clients.length} clientes`,
        metadata: {},
        createdAt: new Date().toISOString()
      });
      data.logs = data.logs.slice(0, 1000);
      this.#write(data);
      this.data = data;
      return {
        clients: data.clients.length,
        conversations: Object.keys(data.conversations || {}).length,
        version: data.version
      };
    } finally {
      fs.rmSync(temporaryImport, { force: true });
    }
  }

  getSettings() {
    return structuredClone(this.data.settings);
  }

  updateSettings(patch) {
    const previousAfkEnabled = Boolean(this.data.settings.afkEnabled);
    const previousAfkMessage = String(this.data.settings.afkMessage || "");
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
      "chargeStartTime",
      "afkEnabled",
      "afkMessage",
      "greetingMessages"
    ];

    for (const key of allowed) {
      if (patch[key] === undefined) continue;

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
        continue;
      }

      if (key === "afkEnabled") {
        this.data.settings.afkEnabled = Boolean(patch[key]);
        continue;
      }

      if (key === "chargeStartTime") {
        const value = String(patch[key] || "").trim();
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
          throw new Error("La hora de cobranza debe tener el formato HH:MM.");
        }
        this.data.settings.chargeStartTime = value;
        continue;
      }

      const value = String(patch[key] || "").trim();
      if (key === "afkMessage" && !value) {
        throw new Error("El mensaje AFK no puede estar vacío.");
      }
      this.data.settings[key] = value;
    }

    if (this.data.settings.afkEnabled && !this.data.settings.afkMessage) {
      throw new Error("Escribe el mensaje que se enviará durante el modo AFK.");
    }

    const afkWasActivated =
      !previousAfkEnabled && Boolean(this.data.settings.afkEnabled);
    const activeMessageChanged =
      Boolean(this.data.settings.afkEnabled) &&
      previousAfkMessage !== String(this.data.settings.afkMessage || "");
    if (afkWasActivated || activeMessageChanged || !this.data.settings.afkSessionId) {
      this.data.settings.afkSessionId = crypto.randomUUID();
    }

    if (patch.afkEnabled !== undefined || patch.afkMessage !== undefined) {
      this.addLog(
        "afk",
        this.data.settings.afkEnabled
          ? "Modo AFK activado o actualizado"
          : "Modo AFK desactivado"
      );
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

  findClientsByWhatsApp(...values) {
    const candidates = new Set(values.map(normalizeWhatsAppDigits).filter(Boolean));
    if (!candidates.size) return [];
    return structuredClone(
      this.data.clients
        .filter(
          (client) =>
            !client.archived &&
            candidates.has(normalizeWhatsAppDigits(client.whatsapp))
        )
        .sort((a, b) => String(a.expiryDate || "").localeCompare(String(b.expiryDate || "")))
    );
  }

  findClientByWhatsApp(...values) {
    return this.findClientsByWhatsApp(...values)[0] || null;
  }

  findClientByWhatsAppAndProduct(whatsapp, product) {
    const digits = normalizeWhatsAppDigits(whatsapp);
    const wantedProduct = String(product || "").trim().toLowerCase();
    if (!digits || !wantedProduct) return null;
    return (
      this.data.clients.find(
        (client) =>
          !client.archived &&
          normalizeWhatsAppDigits(client.whatsapp) === digits &&
          String(client.product || "").trim().toLowerCase() === wantedProduct
      ) || null
    );
  }

  registerClientFromCommand({
    whatsapp,
    item,
    days,
    command,
    commandMessageId = ""
  }) {
    const durationDays = Number(days);
    if (!Number.isSafeInteger(durationDays) || durationDays < 1 || durationDays > 3650) {
      throw new Error("Los días deben ser un número entero entre 1 y 3650.");
    }
    if (!item?.name) throw new Error("El comando no tiene un producto asociado.");

    this.data.processedCommandIds ||= [];
    if (
      commandMessageId &&
      this.data.processedCommandIds.includes(commandMessageId)
    ) {
      const duplicate = this.findClientByWhatsAppAndProduct(
        whatsapp,
        item.name
      );
      return {
        client: duplicate ? structuredClone(duplicate) : null,
        created: false,
        duplicate: true
      };
    }

    if (commandMessageId) {
      const duplicate = this.data.clients.find(
        (client) => client.lastCommandMessageId === commandMessageId
      );
      if (duplicate) {
        return {
          client: structuredClone(duplicate),
          created: false,
          duplicate: true
        };
      }
    }

    const today = todayInTimeZone(
      process.env.BOT_TIMEZONE || "America/Lima"
    );
    const existing = this.findClientByWhatsAppAndProduct(
      whatsapp,
      item.name
    );
    const commandFields = {
      product: item.name,
      price: item.price || "",
      durationDays,
      termMonths: Math.max(1, Math.round(durationDays / 30)),
      status: "activo",
      registrationSource: "whatsapp-command",
      lastCommand: `${command} ${durationDays}`,
      lastCommandMessageId: String(commandMessageId || ""),
      lastCommandAt: new Date().toISOString(),
      lastPaymentDate: today,
      lastReminderKey: null,
      lastChargeKey: null
    };

    let client;
    let created;
    if (existing) {
      let periodStart = today;
      try {
        if (
          existing.expiryDate &&
          compareDateOnly(existing.expiryDate, today) >= 0
        ) {
          periodStart = existing.expiryDate;
        }
      } catch {
        periodStart = today;
      }
      client = this.updateClient(existing.id, {
        ...commandFields,
        startDate: periodStart,
        expiryDate: addDays(periodStart, durationDays)
      });
      created = false;
    } else {
      client = this.createClient({
        ...commandFields,
        name: "estimad@",
        whatsapp: normalizeWhatsAppDigits(whatsapp),
        accountReference: "",
        paymentMethod: "",
        startDate: today,
        expiryDate: addDays(today, durationDays),
        autoReminder: true,
        autoCharge: false,
        notes: `Registrado con ${command} ${durationDays}.`
      });
      created = true;
    }

    this.addLog(
      "command",
      `${created ? "Cliente registrado" : "Servicio renovado"} con ${command}: ${client.whatsapp} · ${client.product} · ${durationDays} días · vence ${client.expiryDate}`,
      { clientId: client.id, command, durationDays }
    );
    if (commandMessageId) {
      this.data.processedCommandIds.unshift(commandMessageId);
      this.data.processedCommandIds = [
        ...new Set(this.data.processedCommandIds)
      ].slice(0, 500);
    }
    this.save();
    return { client, created, duplicate: false };
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
      lastChargeKey: null,
      durationDays: null
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
      durationDays:
        Number.isInteger(Number(input.durationDays)) &&
        Number(input.durationDays) > 0
          ? Number(input.durationDays)
          : null,
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
      registrationSource: String(input.registrationSource || ""),
      lastCommand: String(input.lastCommand || ""),
      lastCommandMessageId: String(input.lastCommandMessageId || ""),
      lastCommandAt: input.lastCommandAt || null,
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
