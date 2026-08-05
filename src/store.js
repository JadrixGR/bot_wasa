"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { createInitialData, defaultSettings } = require("./defaults");
const {
  commandForItem,
  configureCatalogSource,
  deriveRegistrationCommand,
  normalizeRegistrationCommand,
  reservedRegistrationCommands
} = require("./command-registry");
const {
  deriveAuthenticatorCommand,
  normalizeAuthenticatorCommand
} = require("./authenticator-service");
const {
  addDays,
  calculateRenewal,
  compareDateOnly,
  todayInTimeZone
} = require("./date-utils");

const MAX_PURCHASES_PER_PHONE = 2;
const CATALOG_VERSION = 4.92;
const MAX_QUICK_REPLIES = 50;
const MAX_QUICK_REPLY_IMAGES = 6;
const MAX_QUICK_REPLY_TEXTS = 10;
const MAX_COUNTRY_GREETINGS = 80;
const MAX_COUNTRY_PRICE_BOOKS = 80;
const MAX_AD_GREETINGS = 50;
const MAX_WELCOME_MESSAGES = 20;

function uniqueAuthenticatorCommand(baseCommand, usedCommands) {
  if (!usedCommands.has(baseCommand)) return baseCommand;
  const body = baseCommand.slice(1);
  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const suffixText = String(suffix);
    const candidate = `/${body.slice(0, 32 - suffixText.length)}${suffixText}`;
    if (!usedCommands.has(candidate)) return candidate;
  }
  throw new Error("No se pudo crear un comando 2FA único.");
}

function migrateAuthenticatorCommands(accounts) {
  const usedCommands = reservedRegistrationCommands();
  let changed = false;
  const migratedAccounts = accounts.map((account, index) => {
    let desiredCommand;
    try {
      desiredCommand = normalizeAuthenticatorCommand(account.command);
    } catch {
      desiredCommand = deriveAuthenticatorCommand(
        account.name || account.service || `cuenta2fa${index + 1}`
      );
    }
    const command = uniqueAuthenticatorCommand(
      desiredCommand,
      usedCommands
    );
    usedCommands.add(command);
    if (account.command !== command) changed = true;
    return { ...account, command };
  });
  return { accounts: migratedAccounts, changed };
}

function normalizeCatalogItem(item, itemType, usedCommands) {
  const base = item && typeof item === "object" ? item : {};
  const name = String(base.name || "").trim();
  const id =
    String(base.id || "").trim() ||
    deriveRegistrationCommand(name).replace("/", "") ||
    crypto.randomUUID();
  const aliases = Array.isArray(base.aliases)
    ? base.aliases.map((alias) => String(alias || "").trim()).filter(Boolean)
    : [];
  const includes = Array.isArray(base.includes)
    ? base.includes.map((entry) => String(entry || "").trim()).filter(Boolean)
    : [];
  const pricingTiers = Array.isArray(base.pricingTiers)
    ? base.pricingTiers
        .map((tier) => ({
          minDays: Number(tier?.minDays) || 0,
          price: String(tier?.price || "").trim()
        }))
        .filter((tier) => tier.price)
    : [];

  let command = commandForItem({ ...base, id }, itemType);
  if (usedCommands) {
    if (usedCommands.has(command)) {
      const body = command.slice(1);
      for (let suffix = 2; suffix < 1000; suffix += 1) {
        const candidate = `/${body}${suffix}`;
        if (!usedCommands.has(candidate)) {
          command = candidate;
          break;
        }
      }
    }
    usedCommands.add(command);
  }

  const normalized = {
    ...base,
    id,
    name: name.slice(0, 120),
    price: String(base.price || "").trim().slice(0, 120),
    period: String(base.period || "").trim().slice(0, 120),
    aliases,
    details: String(base.details || "").trim().slice(0, 900),
    command,
    commandEnabled: base.commandEnabled !== false
  };
  if (itemType === "plan" || includes.length) normalized.includes = includes;
  if (pricingTiers.length) normalized.pricingTiers = pricingTiers;
  return normalized;
}

function migrateCatalog(parsed, initial) {
  const alreadyMigrated = Number(parsed.catalogVersion || 0) >= CATALOG_VERSION;
  const usedCommands = new Set();
  const mergeWithDefaults = (savedItems, defaultItems, itemType) => {
    const saved = Array.isArray(savedItems) ? savedItems : null;
    const source = saved ? [...saved] : structuredClone(defaultItems);
    if (saved && !alreadyMigrated) {
      const savedIds = new Set(
        saved.map((item) => String(item?.id || "").trim())
      );
      for (const fallback of defaultItems) {
        if (!savedIds.has(String(fallback.id))) source.push(structuredClone(fallback));
      }
    }
    return source
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => normalizeCatalogItem(item, itemType, usedCommands))
      .filter((item) => item.name);
  };

  return {
    products: mergeWithDefaults(parsed.products, initial.products, "product"),
    plans: mergeWithDefaults(parsed.plans, initial.plans, "plan")
  };
}

function normalizeAuthenticatorAccessEntry(entry) {
  const base = entry && typeof entry === "object" ? entry : {};
  const whatsapp = normalizeWhatsAppDigits(base.whatsapp);
  return {
    id: String(base.id || crypto.randomUUID()),
    accountId: String(base.accountId || ""),
    name: String(base.name || "").trim().slice(0, 120),
    whatsapp,
    active: base.active !== false,
    expiresAt: String(base.expiresAt || "").trim() || null,
    dailyLimit:
      Number.isSafeInteger(Number(base.dailyLimit)) && Number(base.dailyLimit) > 0
        ? Number(base.dailyLimit)
        : 0,
    usageDate: String(base.usageDate || "") || null,
    usedToday: Number(base.usedToday) || 0,
    totalSent: Number(base.totalSent) || 0,
    lastSentAt: base.lastSentAt || null,
    notes: String(base.notes || "").trim().slice(0, 300),
    createdAt: base.createdAt || new Date().toISOString(),
    updatedAt: base.updatedAt || new Date().toISOString()
  };
}

function normalizeQuickReplyCommand(value) {
  try {
    return normalizeAuthenticatorCommand(value);
  } catch {
    throw new Error(
      "El comando rápido debe empezar con / y contener entre 2 y 32 letras, números, guiones o guiones bajos. Ejemplo: /diferencia."
    );
  }
}

function normalizeQuickReplyImage(image) {
  const source = image && typeof image === "object" ? image : {};
  const filePath = String(source.path || "").trim();
  if (!filePath) return null;
  return {
    id: String(source.id || crypto.randomUUID()),
    path: filePath,
    originalName: String(source.originalName || "imagen").trim().slice(0, 180),
    mimetype: String(source.mimetype || "application/octet-stream").slice(0, 120),
    size: Math.max(0, Number(source.size) || 0),
    uploadedAt: source.uploadedAt || new Date().toISOString()
  };
}

function normalizeWelcomeSequence(
  input,
  { previousSequence = [], label = "La bienvenida" } = {}
) {
  const source = Array.isArray(input) ? input : [];
  if (!source.length || source.length > MAX_WELCOME_MESSAGES) {
    throw new Error(
      `${label} debe contener entre 1 y ${MAX_WELCOME_MESSAGES} mensajes.`
    );
  }

  const previousByMessageId = new Map(
    (Array.isArray(previousSequence) ? previousSequence : []).map((item) => [
      String(item?.id || ""),
      item
    ])
  );
  const usedIds = new Set();
  return source.map((entry, index) => {
    const objectEntry =
      entry && typeof entry === "object" && !Array.isArray(entry)
        ? entry
        : { text: entry };
    const id = String(objectEntry.id || crypto.randomUUID()).slice(0, 120);
    const text = String(objectEntry.text ?? entry ?? "").trim();
    if (!text) throw new Error(`${label}: el mensaje ${index + 1} está vacío.`);
    if (usedIds.has(id)) {
      throw new Error(`${label} contiene dos mensajes con el mismo identificador.`);
    }
    usedIds.add(id);

    const previous = previousByMessageId.get(id);
    let image = null;
    if (Object.prototype.hasOwnProperty.call(objectEntry, "image")) {
      if (objectEntry.image) {
        image = normalizeQuickReplyImage(objectEntry.image);
        if (!image?.path && previous?.image) {
          const requestedImageId = String(objectEntry.image.id || "");
          if (!requestedImageId || requestedImageId === String(previous.image.id)) {
            image = normalizeQuickReplyImage(previous.image);
          }
        }
      }
    } else if (previous?.image) {
      image = normalizeQuickReplyImage(previous.image);
    }

    return {
      id,
      text: text.slice(0, 4096),
      image
    };
  });
}

function sequenceSource(source, previousSequence = []) {
  if (Array.isArray(source?.sequence)) return source.sequence;
  if (Array.isArray(source?.messages)) {
    return source.messages.map((text, index) => ({
      id: previousSequence[index]?.id || crypto.randomUUID(),
      text,
      ...(previousSequence[index]?.image
        ? { image: previousSequence[index].image }
        : {})
    }));
  }
  return [];
}

function normalizeQuickReplyRecord(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const name = String(source.name || "").trim();
  const command = normalizeQuickReplyCommand(source.command);
  const texts = (Array.isArray(source.texts) ? source.texts : [])
    .map((text) => String(text || "").trim())
    .filter(Boolean)
    .slice(0, MAX_QUICK_REPLY_TEXTS)
    .map((text) => text.slice(0, 4096));
  const images = (Array.isArray(source.images) ? source.images : [])
    .map(normalizeQuickReplyImage)
    .filter(Boolean)
    .slice(0, MAX_QUICK_REPLY_IMAGES);

  if (!name) throw new Error("Ingresa un nombre para la respuesta rápida.");
  if (!texts.length) throw new Error("Agrega al menos un mensaje de texto.");

  return {
    id: String(source.id || crypto.randomUUID()),
    name: name.slice(0, 120),
    command,
    enabled: source.enabled !== false,
    images,
    texts,
    createdAt: source.createdAt || new Date().toISOString(),
    updatedAt: source.updatedAt || new Date().toISOString()
  };
}

function normalizeCountryCallingCode(value) {
  const digits = String(value || "").replace(/\D/g, "").slice(0, 6);
  if (!digits) {
    throw new Error("Ingresa un prefijo internacional, por ejemplo +51 o +54.");
  }
  return `+${digits}`;
}

function normalizeCountryGreetingProfile(input = {}, previousProfile = null) {
  const source = input && typeof input === "object" ? input : {};
  const country = String(source.country || "").trim();
  const callingCode = normalizeCountryCallingCode(source.callingCode);
  const currency = String(source.currency || "").trim();

  if (!country) throw new Error("Ingresa el nombre del país.");
  if (!currency) {
    throw new Error("Ingresa la moneda que usarás en esta bienvenida.");
  }
  const sequence = normalizeWelcomeSequence(
    sequenceSource(source, previousProfile?.sequence),
    {
      previousSequence: previousProfile?.sequence,
      label: `La bienvenida de ${country}`
    }
  );

  return {
    id: String(source.id || crypto.randomUUID()),
    country: country.slice(0, 80),
    callingCode,
    currency: currency.slice(0, 40),
    enabled: source.enabled !== false,
    messages: sequence.map((message) => message.text),
    sequence,
    createdAt: source.createdAt || new Date().toISOString(),
    updatedAt: source.updatedAt || new Date().toISOString()
  };
}

function normalizeCountryGreetings(profiles, previousProfiles = []) {
  if (!Array.isArray(profiles)) {
    throw new Error("La configuración de bienvenidas por país no es válida.");
  }
  if (profiles.length > MAX_COUNTRY_GREETINGS) {
    throw new Error(
      `Puedes configurar como máximo ${MAX_COUNTRY_GREETINGS} países.`
    );
  }
  const usedCodes = new Set();
  return profiles.map((profile) => {
    const previous = (Array.isArray(previousProfiles) ? previousProfiles : []).find(
      (entry) => String(entry?.id || "") === String(profile?.id || "")
    );
    const normalized = normalizeCountryGreetingProfile(profile, previous);
    if (usedCodes.has(normalized.callingCode)) {
      throw new Error(
        `El prefijo ${normalized.callingCode} está repetido. Cada perfil debe usar uno diferente.`
      );
    }
    usedCodes.add(normalized.callingCode);
    return normalized;
  });
}

function normalizeAdGreetingProfile(input = {}, previousProfile = null) {
  const source = input && typeof input === "object" ? input : {};
  const name = String(source.name || "").trim();
  const usedTerms = new Set();
  const matchTerms = (Array.isArray(source.matchTerms) ? source.matchTerms : [])
    .map((term) => String(term || "").trim())
    .filter((term) => {
      const key = term.toLowerCase();
      if (!term || usedTerms.has(key)) return false;
      usedTerms.add(key);
      return true;
    })
    .slice(0, 30)
    .map((term) => term.slice(0, 500));

  if (!name) throw new Error("Ingresa un nombre para la bienvenida del anuncio.");
  if (!matchTerms.length) {
    throw new Error(
      `Agrega al menos una frase o identificador para reconocer el anuncio ${name}.`
    );
  }
  const sequence = normalizeWelcomeSequence(
    sequenceSource(source, previousProfile?.sequence),
    {
      previousSequence: previousProfile?.sequence,
      label: `La bienvenida del anuncio ${name}`
    }
  );

  return {
    id: String(source.id || crypto.randomUUID()),
    name: name.slice(0, 120),
    enabled: source.enabled !== false,
    matchTerms,
    messages: sequence.map((message) => message.text),
    sequence,
    createdAt: source.createdAt || new Date().toISOString(),
    updatedAt: source.updatedAt || new Date().toISOString()
  };
}

function normalizeAdGreetings(profiles, previousProfiles = []) {
  if (!Array.isArray(profiles)) {
    throw new Error("La configuración de bienvenidas por anuncio no es válida.");
  }
  if (profiles.length > MAX_AD_GREETINGS) {
    throw new Error(
      `Puedes configurar como máximo ${MAX_AD_GREETINGS} anuncios.`
    );
  }
  const usedIds = new Set();
  return profiles.map((profile) => {
    const previous = (Array.isArray(previousProfiles) ? previousProfiles : []).find(
      (entry) => String(entry?.id || "") === String(profile?.id || "")
    );
    const normalized = normalizeAdGreetingProfile(profile, previous);
    if (usedIds.has(normalized.id)) {
      throw new Error("Hay dos bienvenidas de anuncio con el mismo identificador.");
    }
    usedIds.add(normalized.id);
    return normalized;
  });
}

function normalizeCountryPriceBook(input = {}, validItemIds = new Set()) {
  const source = input && typeof input === "object" ? input : {};
  const country = String(source.country || "").trim();
  const callingCode = normalizeCountryCallingCode(source.callingCode);
  const currency = String(source.currency || "").trim();
  const symbol = String(source.symbol || "").trim();
  const sourcePrices =
    source.prices && typeof source.prices === "object" && !Array.isArray(source.prices)
      ? source.prices
      : {};
  const prices = Object.fromEntries(
    [...validItemIds]
      .map((itemId) => [
        itemId,
        String(sourcePrices[itemId] || "").trim().slice(0, 160)
      ])
      .filter(([, price]) => price)
  );

  if (!country) throw new Error("Cada tabla de precios necesita un país.");
  if (!currency) throw new Error(`Indica la moneda de ${country}.`);
  if (!symbol) throw new Error(`Indica el símbolo monetario de ${country}.`);
  if (!Object.keys(prices).length) {
    throw new Error(`Agrega al menos un precio local para ${country}.`);
  }

  return {
    id: String(source.id || crypto.randomUUID()),
    country: country.slice(0, 80),
    callingCode,
    currency: currency.slice(0, 80),
    symbol: symbol.slice(0, 20),
    enabled: source.enabled !== false,
    prices,
    updatedAt: source.updatedAt || new Date().toISOString()
  };
}

function normalizeCountryPriceBooks(books, products = [], plans = []) {
  if (!Array.isArray(books)) {
    throw new Error("La configuración de precios por país no es válida.");
  }
  if (books.length > MAX_COUNTRY_PRICE_BOOKS) {
    throw new Error(
      `Puedes configurar como máximo ${MAX_COUNTRY_PRICE_BOOKS} tablas de precios.`
    );
  }
  const validItemIds = new Set(
    [...products, ...plans].map((item) => String(item?.id || "")).filter(Boolean)
  );
  const usedCodes = new Set();
  return books.map((book) => {
    const normalized = normalizeCountryPriceBook(book, validItemIds);
    if (usedCodes.has(normalized.callingCode)) {
      throw new Error(
        `El prefijo ${normalized.callingCode} está repetido en las tablas de precios.`
      );
    }
    usedCodes.add(normalized.callingCode);
    return normalized;
  });
}

function normalizeWhatsAppDigits(value) {
  const raw = String(value || "").trim();
  const server = raw.includes("@") ? raw.split("@").pop().toLowerCase() : "";
  if (server && !["s.whatsapp.net", "c.us"].includes(server)) return "";
  const localPart = raw.split("@")[0].split(":")[0];
  let digits = localPart.replace(/\D/g, "");
  if (digits.length === 9) digits = `51${digits}`;
  return digits;
}

function normalizeWhatsAppUsername(value, { allowBare = false } = {}) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || (raw.includes("@") && !raw.startsWith("@"))) return "";
  if (!allowBare && !raw.startsWith("@")) return "";
  const username = raw.replace(/^@+/, "");
  if (!/^[a-z0-9._-]{2,100}$/.test(username)) return "";
  return `@${username}`;
}

function normalizeWhatsAppChatId(value) {
  const raw = String(value || "").trim().toLowerCase();
  const match = raw.match(/^([^@]+)@(s\.whatsapp\.net|c\.us|lid|hosted\.lid)$/);
  if (!match) return "";
  const user = match[1].split(":")[0];
  if (!user) return "";
  const server = match[2] === "c.us" ? "s.whatsapp.net" : match[2];
  return `${user}@${server}`;
}

function normalizeWhatsAppIdentity(input) {
  const source = input && typeof input === "object" ? input : { whatsapp: input };
  const direct = String(source.whatsapp || "").trim();
  const whatsappChatId =
    normalizeWhatsAppChatId(source.whatsappChatId) ||
    normalizeWhatsAppChatId(direct);
  const phoneCandidate =
    normalizeWhatsAppDigits(source.whatsappPhone) ||
    normalizeWhatsAppDigits(direct) ||
    normalizeWhatsAppDigits(whatsappChatId);
  const whatsappPhone =
    phoneCandidate.length >= 10 && phoneCandidate.length <= 15
      ? phoneCandidate
      : "";
  const whatsappUsername =
    normalizeWhatsAppUsername(source.whatsappUsername, { allowBare: true }) ||
    normalizeWhatsAppUsername(direct);
  return {
    whatsapp: whatsappPhone || whatsappUsername || whatsappChatId,
    whatsappPhone,
    whatsappUsername,
    whatsappChatId
  };
}

function whatsappIdentityKeys(...values) {
  const keys = new Set();
  for (const value of values.flat(Infinity)) {
    const identity = normalizeWhatsAppIdentity(value);
    if (identity.whatsappPhone) keys.add(`phone:${identity.whatsappPhone}`);
    if (identity.whatsappUsername) {
      keys.add(`username:${identity.whatsappUsername.slice(1)}`);
    }
    if (identity.whatsappChatId) keys.add(`chat:${identity.whatsappChatId}`);
  }
  return keys;
}

function identitiesOverlap(left, right) {
  const leftKeys = whatsappIdentityKeys(left);
  const rightKeys = whatsappIdentityKeys(right);
  return [...leftKeys].some((key) => rightKeys.has(key));
}

function clientWhatsAppTarget(client) {
  const identity = normalizeWhatsAppIdentity(client);
  return (
    identity.whatsappChatId ||
    identity.whatsappPhone ||
    identity.whatsappUsername ||
    identity.whatsapp
  );
}

class JsonStore {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir);
    this.filePath = path.join(this.dataDir, "jadrixservs-v4.json");
    this.backupFilePath = path.join(
      this.dataDir,
      "jadrixservs-v4.backup.json"
    );
    this.preUpdateBackupFilePath = path.join(
      this.dataDir,
      "jadrixservs-v4.pre-v4.7.2.json"
    );
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.#createPreUpdateBackup();
    configureCatalogSource(() => ({
      products: this.data?.products,
      plans: this.data?.plans
    }));
    this.data = this.#load();
  }


  #createPreUpdateBackup() {
    if (
      !fs.existsSync(this.filePath) ||
      fs.existsSync(this.preUpdateBackupFilePath)
    ) {
      return;
    }
    try {
      JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      fs.copyFileSync(this.filePath, this.preUpdateBackupFilePath);
    } catch {
      // No se crea una copia permanente desde una base ilegible.
    }
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
    const isVersionUpgrade = Number(parsed.version || 0) < initial.version;
    const migratedAt = new Date().toISOString();
    const previousConversations =
      parsed.conversations && typeof parsed.conversations === "object"
        ? parsed.conversations
        : {};
    const normalizedAuthenticatorAccounts = Array.isArray(
      parsed.authenticatorAccounts
    )
      ? parsed.authenticatorAccounts
          .filter(
            (account) =>
              account &&
              typeof account === "object" &&
              !Array.isArray(account)
          )
          .map((account) => ({
            ...account,
            name: String(account.name || "").trim(),
            service: String(account.service || "").trim(),
            email: String(account.email || "").trim(),
            encryptedSecret: String(account.encryptedSecret || ""),
            algorithm: String(account.algorithm || "SHA1").toUpperCase(),
            digits: Number(account.digits) || 6,
            period: Number(account.period) || 30
          }))
      : [];
    const authenticatorMigration = migrateAuthenticatorCommands(
      normalizedAuthenticatorAccounts
    );
    const catalogMigration = migrateCatalog(parsed, initial);
    const countryPriceBooksMigrated = !Array.isArray(parsed.countryPriceBooks);
    const adGreetingsMigrated = !Array.isArray(parsed.settings?.adGreetings);
    const welcomeSequencesMigrated =
      !Array.isArray(parsed.settings?.greetingSequence) ||
      (Array.isArray(parsed.settings?.countryGreetings) &&
        parsed.settings.countryGreetings.some(
          (profile) => !Array.isArray(profile?.sequence)
        )) ||
      (Array.isArray(parsed.settings?.adGreetings) &&
        parsed.settings.adGreetings.some(
          (profile) => !Array.isArray(profile?.sequence)
        ));
    const welcomeRoutingMigrated = !["smart", "general"].includes(
      String(parsed.settings?.welcomeRoutingMode || "")
    );
    let normalizedCountryPriceBooks;
    try {
      normalizedCountryPriceBooks = normalizeCountryPriceBooks(
        countryPriceBooksMigrated
          ? initial.countryPriceBooks
          : parsed.countryPriceBooks,
        catalogMigration.products,
        catalogMigration.plans
      );
    } catch {
      normalizedCountryPriceBooks = normalizeCountryPriceBooks(
        initial.countryPriceBooks,
        catalogMigration.products,
        catalogMigration.plans
      );
    }
    const normalizedAuthenticatorAccess = Array.isArray(
      parsed.authenticatorAccess
    )
      ? parsed.authenticatorAccess
          .map((entry) => normalizeAuthenticatorAccessEntry(entry))
          .filter((entry) => entry.accountId && entry.whatsapp)
      : [];
    const normalizedQuickReplies = (Array.isArray(parsed.quickReplies)
      ? parsed.quickReplies
      : []
    )
      .map((reply) => {
        try {
          return normalizeQuickReplyRecord(reply);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .slice(0, MAX_QUICK_REPLIES);
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
      countryPriceBooks: normalizedCountryPriceBooks,
      aiConfig: {
        ...initial.aiConfig,
        ...(parsed.aiConfig && typeof parsed.aiConfig === "object"
          ? parsed.aiConfig
          : {}),
        provider: "gemini",
        enabled: Boolean(parsed.aiConfig?.enabled),
        model: String(
          parsed.aiConfig?.model || initial.aiConfig.model
        ).slice(0, 80),
        encryptedApiKey: String(parsed.aiConfig?.encryptedApiKey || ""),
        updatedAt: parsed.aiConfig?.updatedAt || null
      },
      clients: Array.isArray(parsed.clients)
        ? parsed.clients.map((client) => ({
            ...client,
            ...normalizeWhatsAppIdentity(client),
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
      authenticatorAccounts: authenticatorMigration.accounts,
      authenticatorAccess: normalizedAuthenticatorAccess,
      quickReplies: normalizedQuickReplies,
      products: catalogMigration.products,
      plans: catalogMigration.plans,
      catalogVersion: CATALOG_VERSION,
      processedCommandIds: Array.isArray(parsed.processedCommandIds)
        ? parsed.processedCommandIds.slice(0, 500).map(String)
        : [],
      logs: Array.isArray(parsed.logs) ? parsed.logs : [],
      conversations: Object.fromEntries(
        Object.entries(previousConversations).map(([chatId, value]) => {
          const conversation = value && typeof value === "object" ? value : {};
          return [
            chatId,
            isVersionUpgrade && !conversation.welcomeSequenceSentAt
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
    const legacyGreetingMessages = Array.isArray(migrated.settings.greetingMessages)
      ? migrated.settings.greetingMessages
      : structuredClone(defaultSettings.greetingMessages);
    migrated.settings.greetingSequence = normalizeWelcomeSequence(
      Array.isArray(parsed.settings?.greetingSequence)
        ? parsed.settings.greetingSequence
        : legacyGreetingMessages,
      { label: "La bienvenida general" }
    );
    migrated.settings.greetingMessages = migrated.settings.greetingSequence.map(
      (message) => message.text
    );
    const countryGreetingsMigrated = !Array.isArray(
      parsed.settings?.countryGreetings
    );
    const aiConfigMigrated = !(
      parsed.aiConfig &&
      typeof parsed.aiConfig === "object" &&
      !Array.isArray(parsed.aiConfig)
    );
    if (!countryGreetingsMigrated) {
      migrated.settings.countryGreetings = parsed.settings.countryGreetings
        .map((profile) => {
          try {
            return normalizeCountryGreetingProfile(profile);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .filter(
          (profile, index, profiles) =>
            profiles.findIndex(
              (candidate) => candidate.callingCode === profile.callingCode
            ) === index
        )
        .slice(0, MAX_COUNTRY_GREETINGS);
      if (countryPriceBooksMigrated) {
        const existingCodes = new Set(
          migrated.settings.countryGreetings.map((profile) => profile.callingCode)
        );
        for (const defaultProfile of defaultSettings.countryGreetings) {
          if (existingCodes.has(defaultProfile.callingCode)) continue;
          migrated.settings.countryGreetings.push(
            normalizeCountryGreetingProfile(defaultProfile)
          );
          existingCodes.add(defaultProfile.callingCode);
        }
      }
    } else {
      migrated.settings.countryGreetings = [
        normalizeCountryGreetingProfile({
          ...defaultSettings.countryGreetings[0],
          messages: legacyGreetingMessages,
          sequence: legacyGreetingMessages
        }),
        ...defaultSettings.countryGreetings
          .slice(1)
          .map((profile) => normalizeCountryGreetingProfile(profile))
      ];
    }
    if (adGreetingsMigrated) {
      migrated.settings.adGreetings = normalizeAdGreetings(
        defaultSettings.adGreetings
      );
    } else {
      migrated.settings.adGreetings = parsed.settings.adGreetings
        .map((profile) => {
          try {
            return normalizeAdGreetingProfile(profile);
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .filter(
          (profile, index, profiles) =>
            profiles.findIndex((candidate) => candidate.id === profile.id) ===
            index
        )
        .slice(0, MAX_AD_GREETINGS);
    }
    migrated.settings.welcomeRoutingMode =
      parsed.settings?.welcomeRoutingMode === "general" ? "general" : "smart";
    migrated.settings.afkEnabled = Boolean(migrated.settings.afkEnabled);
    migrated.settings.afkMessage =
      String(migrated.settings.afkMessage || defaultSettings.afkMessage).trim() ||
      defaultSettings.afkMessage;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(migrated.settings.chargeStartTime || ""))) {
      migrated.settings.chargeStartTime = defaultSettings.chargeStartTime;
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(migrated.settings.reminderStartTime || ""))) {
      migrated.settings.reminderStartTime =
        migrated.settings.chargeStartTime || defaultSettings.reminderStartTime;
    }
    if (migrated.settings.afkEnabled && !migrated.settings.afkSessionId) {
      migrated.settings.afkSessionId = crypto.randomUUID();
    }
    return {
      data: migrated,
      isUpgrade:
        isVersionUpgrade ||
        authenticatorMigration.changed ||
        countryGreetingsMigrated ||
        countryPriceBooksMigrated ||
        adGreetingsMigrated ||
        welcomeSequencesMigrated ||
        welcomeRoutingMigrated ||
        aiConfigMigrated
    };
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
      data.quickReplies = (data.quickReplies || []).map((reply) => ({
        ...reply,
        images: (reply.images || []).filter(
          (image) => image?.path && fs.existsSync(image.path)
        )
      }));
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
    const greetingPatch =
      patch.greetingSequence !== undefined
        ? patch.greetingSequence
        : patch.greetingMessages !== undefined
          ? (Array.isArray(patch.greetingMessages)
              ? patch.greetingMessages.map((text, index) => ({
                  id:
                    this.data.settings.greetingSequence?.[index]?.id ||
                    crypto.randomUUID(),
                  text,
                  ...(this.data.settings.greetingSequence?.[index]?.image
                    ? {
                        image:
                          this.data.settings.greetingSequence[index].image
                      }
                    : {})
                }))
              : patch.greetingMessages)
          : undefined;
    if (greetingPatch !== undefined) {
      const sequence = normalizeWelcomeSequence(greetingPatch, {
        previousSequence: this.data.settings.greetingSequence,
        label: "La bienvenida general"
      });
      this.data.settings.greetingSequence = sequence;
      this.data.settings.greetingMessages = sequence.map(
        (message) => message.text
      );
    }
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
      "aiInstructions",
      "reminderTemplate",
      "chargeTemplate",
      "chargeStartTime",
      "reminderStartTime",
      "afkEnabled",
      "afkMessage",
      "countryGreetings",
      "welcomeRoutingMode",
      "adGreetings"
    ];

    for (const key of allowed) {
      if (patch[key] === undefined) continue;

      if (key === "countryGreetings") {
        this.data.settings.countryGreetings = normalizeCountryGreetings(
          patch[key],
          this.data.settings.countryGreetings
        );
        continue;
      }

      if (key === "adGreetings") {
        this.data.settings.adGreetings = normalizeAdGreetings(
          patch[key],
          this.data.settings.adGreetings
        );
        continue;
      }

      if (key === "welcomeRoutingMode") {
        const mode = String(patch[key] || "").trim();
        if (!new Set(["smart", "general"]).has(mode)) {
          throw new Error("El modo de bienvenida no es válido.");
        }
        this.data.settings.welcomeRoutingMode = mode;
        continue;
      }

      if (key === "afkEnabled") {
        this.data.settings.afkEnabled = Boolean(patch[key]);
        continue;
      }

      if (key === "chargeStartTime" || key === "reminderStartTime") {
        const value = String(patch[key] || "").trim();
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
          throw new Error("La hora de envío debe tener el formato HH:MM.");
        }
        this.data.settings[key] = value;
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

  getCountryPriceBooks() {
    return structuredClone(this.data.countryPriceBooks || []);
  }

  updateCountryPriceBooks(books) {
    this.data.countryPriceBooks = normalizeCountryPriceBooks(
      books,
      this.data.products,
      this.data.plans
    ).map((book) => ({ ...book, updatedAt: new Date().toISOString() }));
    this.addLog(
      "pricing",
      `Precios locales actualizados: ${this.data.countryPriceBooks.length} países`
    );
    this.save();
    return this.getCountryPriceBooks();
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

  listAuthenticatorAccounts() {
    return structuredClone(
      (this.data.authenticatorAccounts || [])
        .slice()
        .sort((a, b) => {
          const serviceOrder = String(a.service || "").localeCompare(
            String(b.service || ""),
            "es",
            { sensitivity: "base" }
          );
          return (
            serviceOrder ||
            String(a.name || "").localeCompare(String(b.name || ""), "es", {
              sensitivity: "base"
            })
          );
        })
    );
  }

  getAuthenticatorAccount(id) {
    const account = (this.data.authenticatorAccounts || []).find(
      (item) => item.id === id
    );
    return account ? structuredClone(account) : null;
  }

  findAuthenticatorAccountByCommand(value) {
    let command;
    try {
      command = normalizeAuthenticatorCommand(value);
    } catch {
      return null;
    }
    const account = (this.data.authenticatorAccounts || []).find(
      (item) => item.command === command
    );
    return account ? structuredClone(account) : null;
  }

  isCommandMessageProcessed(value) {
    const commandMessageId = String(value || "");
    return Boolean(
      commandMessageId &&
      (this.data.processedCommandIds || []).includes(commandMessageId)
    );
  }

  markCommandMessageProcessed(value) {
    const commandMessageId = String(value || "");
    if (!commandMessageId) return false;
    this.data.processedCommandIds ||= [];
    if (this.data.processedCommandIds.includes(commandMessageId)) {
      return false;
    }
    this.data.processedCommandIds.unshift(commandMessageId);
    this.data.processedCommandIds = [
      ...new Set(this.data.processedCommandIds)
    ].slice(0, 500);
    this.save();
    return true;
  }

  createAuthenticatorAccount(input) {
    this.data.authenticatorAccounts ||= [];
    const now = new Date().toISOString();
    const account = this.#normalizeAuthenticatorAccount({
      ...input,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now
    });
    this.#assertAuthenticatorCommandAvailable(account.command);
    this.data.authenticatorAccounts.push(account);
    this.addLog(
      "authenticator",
      `Cuenta 2FA agregada: ${account.service} · ${account.name}`,
      { authenticatorId: account.id }
    );
    this.save();
    return structuredClone(account);
  }

  updateAuthenticatorAccount(id, input) {
    this.data.authenticatorAccounts ||= [];
    const index = this.data.authenticatorAccounts.findIndex(
      (account) => account.id === id
    );
    if (index === -1) {
      throw new Error("Cuenta del Autenticador no encontrada.");
    }

    const current = this.data.authenticatorAccounts[index];
    const updated = this.#normalizeAuthenticatorAccount({
      ...current,
      ...input,
      id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    });
    this.#assertAuthenticatorCommandAvailable(updated.command, id);
    this.data.authenticatorAccounts[index] = updated;
    this.addLog(
      "authenticator",
      `Cuenta 2FA actualizada: ${updated.service} · ${updated.name}`,
      { authenticatorId: id }
    );
    this.save();
    return structuredClone(updated);
  }

  deleteAuthenticatorAccount(id) {
    this.data.authenticatorAccounts ||= [];
    const index = this.data.authenticatorAccounts.findIndex(
      (account) => account.id === id
    );
    if (index === -1) {
      throw new Error("Cuenta del Autenticador no encontrada.");
    }
    const [deleted] = this.data.authenticatorAccounts.splice(index, 1);
    this.addLog(
      "authenticator",
      `Cuenta 2FA eliminada: ${deleted.service} · ${deleted.name}`,
      { authenticatorId: id }
    );
    this.save();
    return structuredClone(deleted);
  }

  #normalizeAuthenticatorAccount(input) {
    const name = String(input.name || "").trim();
    const service = String(input.service || "").trim();
    const email = String(input.email || "").trim();
    const encryptedSecret = String(input.encryptedSecret || "");
    const command = normalizeAuthenticatorCommand(
      input.command || deriveAuthenticatorCommand(name)
    );
    const algorithm = String(input.algorithm || "SHA1").toUpperCase();
    const digits = Number(input.digits || 6);
    const period = Number(input.period || 30);

    if (!name) throw new Error("Ingresa el nombre de la cuenta 2FA.");
    if (!service) throw new Error("Ingresa el servicio de la cuenta 2FA.");
    if (!email) throw new Error("Ingresa el correo o usuario de la cuenta 2FA.");
    if (!encryptedSecret) throw new Error("La cuenta 2FA no tiene una clave cifrada.");
    if (!["SHA1", "SHA256", "SHA512"].includes(algorithm)) {
      throw new Error("El algoritmo de la cuenta 2FA no es compatible.");
    }
    if (!Number.isSafeInteger(digits) || digits < 6 || digits > 8) {
      throw new Error("La cantidad de dígitos de la cuenta 2FA no es válida.");
    }
    if (!Number.isSafeInteger(period) || period < 15 || period > 120) {
      throw new Error("El intervalo de la cuenta 2FA no es válido.");
    }

    return {
      id: String(input.id),
      name: name.slice(0, 120),
      service: service.slice(0, 120),
      email: email.slice(0, 240),
      command,
      encryptedSecret,
      algorithm,
      digits,
      period,
      createdAt: input.createdAt || new Date().toISOString(),
      updatedAt: input.updatedAt || new Date().toISOString()
    };
  }

  #assertAuthenticatorCommandAvailable(command, exceptId = null) {
    if (reservedRegistrationCommands().has(command)) {
      throw new Error(
        `El comando ${command} ya está reservado para registrar clientes. Elige otro, por ejemplo ${command}01.`
      );
    }
    const duplicate = (this.data.authenticatorAccounts || []).find(
      (account) =>
        account.id !== exceptId &&
        String(account.command || "").toLowerCase() === command
    );
    if (duplicate) {
      throw new Error(
        `El comando ${command} ya pertenece a la cuenta 2FA “${duplicate.name}”.`
      );
    }
    const quickReplyDuplicate = (this.data.quickReplies || []).find(
      (reply) => String(reply.command || "").toLowerCase() === command
    );
    if (quickReplyDuplicate) {
      throw new Error(
        `El comando ${command} ya pertenece a la respuesta rápida “${quickReplyDuplicate.name}”.`
      );
    }
  }

  // ─── Catálogo y comandos ─────────────────────────────────────────────
  // Respuestas rápidas editables: las imágenes conservan su orden de carga y
  // los textos su orden en el editor para garantizar un envío determinista.
  listQuickReplies() {
    return structuredClone(this.data.quickReplies || []);
  }

  getQuickReply(id) {
    return (
      this.listQuickReplies().find((reply) => reply.id === String(id || "")) ||
      null
    );
  }

  findQuickReplyByCommand(value) {
    let command;
    try {
      command = normalizeQuickReplyCommand(value);
    } catch {
      return null;
    }
    return (
      this.listQuickReplies().find((reply) => reply.command === command) || null
    );
  }

  #assertQuickReplyCommandAvailable(command, exceptId = null) {
    const catalogDuplicate = this.listCatalog().find(
      (item) => item.command === command
    );
    if (catalogDuplicate) {
      throw new Error(
        `El comando ${command} ya registra el producto “${catalogDuplicate.name}”. Elige otro.`
      );
    }
    const authenticatorDuplicate = (this.data.authenticatorAccounts || []).find(
      (account) => String(account.command || "").toLowerCase() === command
    );
    if (authenticatorDuplicate) {
      throw new Error(
        `El comando ${command} ya pertenece a la cuenta 2FA “${authenticatorDuplicate.name}”.`
      );
    }
    const quickReplyDuplicate = (this.data.quickReplies || []).find(
      (reply) => reply.id !== exceptId && reply.command === command
    );
    if (quickReplyDuplicate) {
      throw new Error(
        `El comando ${command} ya pertenece a la respuesta rápida “${quickReplyDuplicate.name}”.`
      );
    }
  }

  createQuickReply(input = {}) {
    this.data.quickReplies ||= [];
    if (this.data.quickReplies.length >= MAX_QUICK_REPLIES) {
      throw new Error(
        `Puedes guardar como máximo ${MAX_QUICK_REPLIES} respuestas rápidas.`
      );
    }
    const now = new Date().toISOString();
    const reply = normalizeQuickReplyRecord({
      ...input,
      id: crypto.randomUUID(),
      enabled: false,
      images: [],
      createdAt: now,
      updatedAt: now
    });
    this.#assertQuickReplyCommandAvailable(reply.command);
    this.data.quickReplies.push(reply);
    this.addLog(
      "quick-reply",
      `Respuesta rápida creada: ${reply.name} (${reply.command})`,
      { quickReplyId: reply.id }
    );
    this.save();
    return structuredClone(reply);
  }

  updateQuickReply(id, input = {}) {
    this.data.quickReplies ||= [];
    const index = this.data.quickReplies.findIndex(
      (reply) => reply.id === String(id || "")
    );
    if (index === -1) throw new Error("Respuesta rápida no encontrada.");
    const current = this.data.quickReplies[index];
    const updated = normalizeQuickReplyRecord({
      ...current,
      ...input,
      id: current.id,
      images: current.images,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    });
    if (updated.enabled && !updated.images.length) {
      throw new Error("Carga al menos una imagen antes de activar la respuesta rápida.");
    }
    this.#assertQuickReplyCommandAvailable(updated.command, current.id);
    this.data.quickReplies[index] = updated;
    this.addLog(
      "quick-reply",
      `Respuesta rápida actualizada: ${updated.name} (${updated.command})`,
      { quickReplyId: updated.id }
    );
    this.save();
    return structuredClone(updated);
  }

  deleteQuickReply(id) {
    this.data.quickReplies ||= [];
    const index = this.data.quickReplies.findIndex(
      (reply) => reply.id === String(id || "")
    );
    if (index === -1) throw new Error("Respuesta rápida no encontrada.");
    const [deleted] = this.data.quickReplies.splice(index, 1);
    this.addLog(
      "quick-reply",
      `Respuesta rápida eliminada: ${deleted.name} (${deleted.command})`,
      { quickReplyId: deleted.id }
    );
    this.save();
    return structuredClone(deleted);
  }

  addQuickReplyImage(id, image) {
    this.data.quickReplies ||= [];
    const reply = this.data.quickReplies.find(
      (entry) => entry.id === String(id || "")
    );
    if (!reply) throw new Error("Respuesta rápida no encontrada.");
    reply.images ||= [];
    if (reply.images.length >= MAX_QUICK_REPLY_IMAGES) {
      throw new Error(
        `Cada respuesta rápida admite hasta ${MAX_QUICK_REPLY_IMAGES} imágenes.`
      );
    }
    const normalized = normalizeQuickReplyImage(image);
    if (!normalized) throw new Error("La imagen cargada no es válida.");
    reply.images.push(normalized);
    reply.updatedAt = new Date().toISOString();
    this.addLog(
      "quick-reply",
      `Imagen agregada a ${reply.name}: ${normalized.originalName}`,
      { quickReplyId: reply.id, imageId: normalized.id }
    );
    this.save();
    return structuredClone(normalized);
  }

  deleteQuickReplyImage(id, imageId) {
    this.data.quickReplies ||= [];
    const reply = this.data.quickReplies.find(
      (entry) => entry.id === String(id || "")
    );
    if (!reply) throw new Error("Respuesta rápida no encontrada.");
    reply.images ||= [];
    const index = reply.images.findIndex(
      (image) => image.id === String(imageId || "")
    );
    if (index === -1) throw new Error("Imagen no encontrada.");
    const [deleted] = reply.images.splice(index, 1);
    if (!reply.images.length) reply.enabled = false;
    reply.updatedAt = new Date().toISOString();
    this.addLog(
      "quick-reply",
      `Imagen eliminada de ${reply.name}: ${deleted.originalName}`,
      { quickReplyId: reply.id, imageId: deleted.id }
    );
    this.save();
    return structuredClone(deleted);
  }

  getWelcomeMessage(scope, profileId, messageId) {
    const normalizedScope = String(scope || "").toLowerCase();
    let sequence;
    if (normalizedScope === "general") {
      sequence = this.data.settings.greetingSequence;
    } else if (normalizedScope === "country") {
      sequence = this.data.settings.countryGreetings?.find(
        (profile) => String(profile.id) === String(profileId || "")
      )?.sequence;
    } else if (normalizedScope === "ad") {
      sequence = this.data.settings.adGreetings?.find(
        (profile) => String(profile.id) === String(profileId || "")
      )?.sequence;
    } else {
      throw new Error("Tipo de bienvenida no permitido.");
    }
    const message = (Array.isArray(sequence) ? sequence : []).find(
      (entry) => String(entry.id) === String(messageId || "")
    );
    return message ? structuredClone(message) : null;
  }

  setWelcomeMessageImage(scope, profileId, messageId, image) {
    const normalizedScope = String(scope || "").toLowerCase();
    let sequence;
    let targetName = "general";
    if (normalizedScope === "general") {
      sequence = this.data.settings.greetingSequence;
    } else if (normalizedScope === "country") {
      const profile = this.data.settings.countryGreetings?.find(
        (entry) => String(entry.id) === String(profileId || "")
      );
      sequence = profile?.sequence;
      targetName = profile?.country || "país";
    } else if (normalizedScope === "ad") {
      const profile = this.data.settings.adGreetings?.find(
        (entry) => String(entry.id) === String(profileId || "")
      );
      sequence = profile?.sequence;
      targetName = profile?.name || "anuncio";
    } else {
      throw new Error("Tipo de bienvenida no permitido.");
    }
    const message = (Array.isArray(sequence) ? sequence : []).find(
      (entry) => String(entry.id) === String(messageId || "")
    );
    if (!message) throw new Error("Mensaje de bienvenida no encontrado.");
    const normalized = normalizeQuickReplyImage(image);
    if (!normalized) throw new Error("La imagen cargada no es válida.");
    const previous = message.image ? structuredClone(message.image) : null;
    message.image = normalized;
    this.addLog(
      "welcome-media",
      `Imagen agregada a la bienvenida de ${targetName}: ${normalized.originalName}`,
      { scope: normalizedScope, profileId: profileId || null, messageId: message.id }
    );
    this.save();
    return { image: structuredClone(normalized), previous };
  }

  deleteWelcomeMessageImage(scope, profileId, messageId) {
    const message = this.getWelcomeMessage(scope, profileId, messageId);
    if (!message) throw new Error("Mensaje de bienvenida no encontrado.");
    if (!message.image) throw new Error("Este mensaje no tiene una imagen.");

    const normalizedScope = String(scope || "").toLowerCase();
    let sequence;
    if (normalizedScope === "general") {
      sequence = this.data.settings.greetingSequence;
    } else if (normalizedScope === "country") {
      sequence = this.data.settings.countryGreetings.find(
        (profile) => String(profile.id) === String(profileId || "")
      )?.sequence;
    } else if (normalizedScope === "ad") {
      sequence = this.data.settings.adGreetings.find(
        (profile) => String(profile.id) === String(profileId || "")
      )?.sequence;
    }
    const stored = sequence.find(
      (entry) => String(entry.id) === String(messageId || "")
    );
    const deleted = stored.image;
    stored.image = null;
    this.addLog("welcome-media", "Imagen eliminada de una bienvenida", {
      scope: normalizedScope,
      profileId: profileId || null,
      messageId: stored.id
    });
    this.save();
    return structuredClone(deleted);
  }

  listCatalog() {
    const map = (items, itemType) =>
      (Array.isArray(items) ? items : []).map((item) => ({
        ...structuredClone(item),
        itemType,
        command: commandForItem(item, itemType),
        commandEnabled: item.commandEnabled !== false
      }));
    return [
      ...map(this.data.products, "product"),
      ...map(this.data.plans, "plan")
    ];
  }

  getCatalogItem(id) {
    return this.listCatalog().find((item) => item.id === id) || null;
  }

  #catalogBucket(itemType) {
    if (itemType === "plan") {
      this.data.plans ||= [];
      return this.data.plans;
    }
    this.data.products ||= [];
    return this.data.products;
  }

  #assertCatalogCommandAvailable(command, exceptId = null) {
    const duplicate = this.listCatalog().find(
      (item) => item.id !== exceptId && item.command === command
    );
    if (duplicate) {
      throw new Error(
        `El comando ${command} ya pertenece a “${duplicate.name}”. Elige otro.`
      );
    }
    const authenticatorDuplicate = (this.data.authenticatorAccounts || []).find(
      (account) => String(account.command || "").toLowerCase() === command
    );
    if (authenticatorDuplicate) {
      throw new Error(
        `El comando ${command} ya pertenece a la cuenta 2FA “${authenticatorDuplicate.name}”.`
      );
    }
    const quickReplyDuplicate = (this.data.quickReplies || []).find(
      (reply) => String(reply.command || "").toLowerCase() === command
    );
    if (quickReplyDuplicate) {
      throw new Error(
        `El comando ${command} ya pertenece a la respuesta rápida “${quickReplyDuplicate.name}”.`
      );
    }
  }

  createCatalogItem(input = {}) {
    const itemType = input.itemType === "plan" ? "plan" : "product";
    const candidate = normalizeCatalogItem(
      { ...input, id: input.id || "" },
      itemType,
      null
    );
    if (!candidate.name) throw new Error("Ingresa el nombre del producto.");
    if (!candidate.command) {
      throw new Error("Ingresa un comando válido, por ejemplo /claudepro.");
    }
    if (this.getCatalogItem(candidate.id)) {
      candidate.id = `${candidate.id}-${crypto.randomUUID().slice(0, 6)}`;
    }
    this.#assertCatalogCommandAvailable(candidate.command);
    delete candidate.itemType;
    this.#catalogBucket(itemType).push(candidate);
    this.addLog(
      "catalog",
      `Producto agregado al catálogo: ${candidate.name} (${candidate.command})`,
      { itemId: candidate.id }
    );
    this.save();
    return { ...structuredClone(candidate), itemType };
  }

  updateCatalogItem(id, input = {}) {
    const current = this.getCatalogItem(id);
    if (!current) throw new Error("Producto del catálogo no encontrado.");
    const nextType =
      input.itemType === "plan" || input.itemType === "product"
        ? input.itemType
        : current.itemType;
    const merged = normalizeCatalogItem(
      { ...current, ...input, id },
      nextType,
      null
    );
    if (!merged.name) throw new Error("Ingresa el nombre del producto.");
    if (!merged.command) {
      throw new Error("Ingresa un comando válido, por ejemplo /claudepro.");
    }
    this.#assertCatalogCommandAvailable(merged.command, id);
    delete merged.itemType;

    const removeFrom = this.#catalogBucket(current.itemType);
    const index = removeFrom.findIndex((item) => item.id === id);
    if (index !== -1) removeFrom.splice(index, 1);
    if (nextType === current.itemType && index !== -1) {
      this.#catalogBucket(nextType).splice(index, 0, merged);
    } else {
      this.#catalogBucket(nextType).push(merged);
    }
    this.addLog(
      "catalog",
      `Catálogo actualizado: ${merged.name} (${merged.command})`,
      { itemId: id }
    );
    this.save();
    return { ...structuredClone(merged), itemType: nextType };
  }

  deleteCatalogItem(id) {
    const current = this.getCatalogItem(id);
    if (!current) throw new Error("Producto del catálogo no encontrado.");
    const bucket = this.#catalogBucket(current.itemType);
    const index = bucket.findIndex((item) => item.id === id);
    if (index !== -1) bucket.splice(index, 1);
    this.addLog("catalog", `Producto eliminado del catálogo: ${current.name}`, {
      itemId: id
    });
    this.save();
    return current;
  }

  // ─── Accesos 2FA de clientes ─────────────────────────────────────────
  listAuthenticatorAccess(accountId = null) {
    this.data.authenticatorAccess ||= [];
    return structuredClone(
      this.data.authenticatorAccess.filter(
        (entry) => !accountId || entry.accountId === accountId
      )
    );
  }

  createAuthenticatorAccess(accountId, input = {}) {
    this.data.authenticatorAccess ||= [];
    const account = (this.data.authenticatorAccounts || []).find(
      (item) => item.id === accountId
    );
    if (!account) throw new Error("Cuenta del Autenticador no encontrada.");
    const entry = normalizeAuthenticatorAccessEntry({
      ...input,
      accountId,
      id: crypto.randomUUID(),
      usedToday: 0,
      totalSent: 0,
      usageDate: null,
      lastSentAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    if (!entry.whatsapp) {
      throw new Error("Ingresa el número de WhatsApp del cliente autorizado.");
    }
    const duplicate = this.data.authenticatorAccess.find(
      (item) => item.accountId === accountId && item.whatsapp === entry.whatsapp
    );
    if (duplicate) {
      throw new Error("Ese número ya está autorizado en esta cuenta 2FA.");
    }
    this.data.authenticatorAccess.push(entry);
    this.addLog(
      "authenticator",
      `Acceso 2FA autorizado: ${entry.name || entry.whatsapp} → ${account.command}`,
      { authenticatorId: accountId, accessId: entry.id }
    );
    this.save();
    return structuredClone(entry);
  }

  updateAuthenticatorAccess(id, input = {}) {
    this.data.authenticatorAccess ||= [];
    const index = this.data.authenticatorAccess.findIndex(
      (entry) => entry.id === id
    );
    if (index === -1) throw new Error("Acceso 2FA no encontrado.");
    const current = this.data.authenticatorAccess[index];
    const updated = normalizeAuthenticatorAccessEntry({
      ...current,
      ...input,
      id,
      accountId: current.accountId,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString()
    });
    if (!updated.whatsapp) {
      throw new Error("Ingresa el número de WhatsApp del cliente autorizado.");
    }
    this.data.authenticatorAccess[index] = updated;
    this.addLog(
      "authenticator",
      `Acceso 2FA actualizado: ${updated.name || updated.whatsapp}`,
      { authenticatorId: updated.accountId, accessId: id }
    );
    this.save();
    return structuredClone(updated);
  }

  deleteAuthenticatorAccess(id) {
    this.data.authenticatorAccess ||= [];
    const index = this.data.authenticatorAccess.findIndex(
      (entry) => entry.id === id
    );
    if (index === -1) throw new Error("Acceso 2FA no encontrado.");
    const [deleted] = this.data.authenticatorAccess.splice(index, 1);
    this.addLog(
      "authenticator",
      `Acceso 2FA revocado: ${deleted.name || deleted.whatsapp}`,
      { authenticatorId: deleted.accountId, accessId: id }
    );
    this.save();
    return structuredClone(deleted);
  }

  findAuthenticatorAccess(accountId, ...phones) {
    this.data.authenticatorAccess ||= [];
    const candidates = new Set(
      phones.map(normalizeWhatsAppDigits).filter(Boolean)
    );
    if (!candidates.size) return null;
    const entry = this.data.authenticatorAccess.find(
      (item) => item.accountId === accountId && candidates.has(item.whatsapp)
    );
    return entry ? structuredClone(entry) : null;
  }

  checkAuthenticatorAccess(accountId, ...phones) {
    const entry = this.findAuthenticatorAccess(accountId, ...phones);
    if (!entry) return { allowed: false, reason: "sin-autorizacion", entry: null };
    if (!entry.active) return { allowed: false, reason: "inactivo", entry };
    const today = todayInTimeZone(process.env.BOT_TIMEZONE || "America/Lima");
    if (entry.expiresAt && compareDateOnly(entry.expiresAt, today) < 0) {
      return { allowed: false, reason: "vencido", entry };
    }
    if (entry.dailyLimit > 0) {
      const used = entry.usageDate === today ? entry.usedToday : 0;
      if (used >= entry.dailyLimit) {
        return { allowed: false, reason: "limite-diario", entry };
      }
    }
    return { allowed: true, reason: "ok", entry };
  }

  registerAuthenticatorAccessUsage(id) {
    this.data.authenticatorAccess ||= [];
    const entry = this.data.authenticatorAccess.find((item) => item.id === id);
    if (!entry) return null;
    const today = todayInTimeZone(process.env.BOT_TIMEZONE || "America/Lima");
    entry.usedToday = entry.usageDate === today ? Number(entry.usedToday || 0) + 1 : 1;
    entry.usageDate = today;
    entry.totalSent = Number(entry.totalSent || 0) + 1;
    entry.lastSentAt = new Date().toISOString();
    entry.updatedAt = entry.lastSentAt;
    this.save();
    return structuredClone(entry);
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

  enrichClientsWithWhatsAppIdentity(value) {
    const identity = normalizeWhatsAppIdentity(value);
    if (!identity.whatsapp) return 0;
    let changed = 0;
    for (const client of this.data.clients) {
      if (!identitiesOverlap(client, identity)) continue;
      const merged = normalizeWhatsAppIdentity({
        ...client,
        whatsappPhone: identity.whatsappPhone || client.whatsappPhone,
        whatsappUsername: identity.whatsappUsername || client.whatsappUsername,
        whatsappChatId: identity.whatsappChatId || client.whatsappChatId
      });
      if (
        merged.whatsapp === client.whatsapp &&
        merged.whatsappPhone === client.whatsappPhone &&
        merged.whatsappUsername === client.whatsappUsername &&
        merged.whatsappChatId === client.whatsappChatId
      ) {
        continue;
      }
      Object.assign(client, merged, { updatedAt: new Date().toISOString() });
      changed += 1;
    }
    if (changed) this.save();
    return changed;
  }

  findClientsByWhatsApp(...values) {
    const candidates = whatsappIdentityKeys(...values);
    if (!candidates.size) return [];
    return structuredClone(
      this.data.clients
        .filter(
          (client) =>
            !client.archived &&
            [...whatsappIdentityKeys(client)].some((key) => candidates.has(key))
        )
        .sort((a, b) => String(a.expiryDate || "").localeCompare(String(b.expiryDate || "")))
    );
  }

  findClientByWhatsApp(...values) {
    return this.findClientsByWhatsApp(...values)[0] || null;
  }

  findClientByWhatsAppAndProduct(whatsapp, product) {
    const identity = whatsappIdentityKeys(whatsapp);
    const wantedProduct = String(product || "").trim().toLowerCase();
    if (!identity.size || !wantedProduct) return null;
    return (
      this.data.clients.find(
        (client) =>
          !client.archived &&
          [...whatsappIdentityKeys(client)].some((key) => identity.has(key)) &&
          String(client.product || "").trim().toLowerCase() === wantedProduct
      ) || null
    );
  }

  registerClientFromCommand({
    whatsapp,
    whatsappPhone = "",
    whatsappUsername = "",
    whatsappChatId = "",
    name = "estimad@",
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
      const duplicate = this.data.clients.find(
        (client) => client.lastCommandMessageId === commandMessageId
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

    const client = this.createClient({
      ...commandFields,
      name: String(name || "").trim() || "estimad@",
      whatsapp,
      whatsappPhone,
      whatsappUsername,
      whatsappChatId,
      accountReference: "",
      paymentMethod: "",
      startDate: today,
      expiryDate: addDays(today, durationDays),
      autoReminder: true,
      autoCharge: false,
      notes: `Compra independiente registrada con ${command} ${durationDays}.`
    });

    this.addLog(
      "command",
      `Compra registrada con ${command}: ${client.whatsapp} · ${client.product} · ${durationDays} días · vence ${client.expiryDate}`,
      { clientId: client.id, command, durationDays }
    );
    if (commandMessageId) {
      this.data.processedCommandIds.unshift(commandMessageId);
      this.data.processedCommandIds = [
        ...new Set(this.data.processedCommandIds)
      ].slice(0, 500);
    }
    this.save();
    return { client, created: true, duplicate: false };
  }

  createClient(input) {
    const identity = normalizeWhatsAppIdentity(input);
    const purchases = this.data.clients.filter(
      (client) =>
        !client.archived &&
        identitiesOverlap(client, identity)
    );
    if (identity.whatsapp && purchases.length >= MAX_PURCHASES_PER_PHONE) {
      throw new Error(
        `Este número ya tiene ${MAX_PURCHASES_PER_PHONE} compras registradas. Elimina un registro o renueva uno de los servicios existentes.`
      );
    }

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

    const current = this.data.clients[index];
    const whatsappChanged =
      input.whatsapp !== undefined &&
      String(input.whatsapp || "").trim() !== String(current.whatsapp || "").trim();
    const identityInput = whatsappChanged
      ? {
          ...input,
          whatsappPhone: input.whatsappPhone || "",
          whatsappUsername: input.whatsappUsername || "",
          whatsappChatId: input.whatsappChatId || ""
        }
      : {
          ...current,
          ...input,
          whatsappPhone: input.whatsappPhone || current.whatsappPhone || "",
          whatsappUsername:
            input.whatsappUsername || current.whatsappUsername || "",
          whatsappChatId: input.whatsappChatId || current.whatsappChatId || ""
        };
    const currentIdentity = whatsappIdentityKeys(current);
    const targetIdentity = whatsappIdentityKeys(identityInput);
    const sameIdentity = [...targetIdentity].some((key) => currentIdentity.has(key));
    if (targetIdentity.size && !sameIdentity) {
      const targetPurchases = this.data.clients.filter(
        (client) =>
          client.id !== id &&
          !client.archived &&
          identitiesOverlap(client, identityInput)
      );
      if (targetPurchases.length >= MAX_PURCHASES_PER_PHONE) {
        throw new Error(
          `Ese número ya tiene ${MAX_PURCHASES_PER_PHONE} compras registradas.`
        );
      }
    }

    const updated = this.#normalizeClient({
      ...current,
      ...identityInput,
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

  deleteClient(id) {
    const index = this.data.clients.findIndex((client) => client.id === id);
    if (index === -1) throw new Error("Cliente no encontrado.");
    const [deleted] = this.data.clients.splice(index, 1);
    this.addLog(
      "client-delete",
      `Registro eliminado: ${deleted.whatsapp} · ${deleted.product}`,
      { clientId: deleted.id, whatsapp: deleted.whatsapp, product: deleted.product }
    );
    this.save();
    return structuredClone(deleted);
  }

  deleteClientsByWhatsApp(whatsapp) {
    const identity = whatsappIdentityKeys(whatsapp);
    if (!identity.size) {
      throw new Error("Ingresa un número o @usuario de WhatsApp válido.");
    }
    const deleted = this.data.clients.filter(
      (client) => [...whatsappIdentityKeys(client)].some((key) => identity.has(key))
    );
    if (!deleted.length) throw new Error("No encontramos registros para ese contacto.");
    const deletedIds = new Set(deleted.map((client) => client.id));
    this.data.clients = this.data.clients.filter(
      (client) => !deletedIds.has(client.id)
    );
    this.addLog(
      "client-delete",
      `Cliente eliminado por completo: ${whatsapp} · ${deleted.length} registro(s)`,
      { whatsapp: String(whatsapp), count: deleted.length, clientIds: [...deletedIds] }
    );
    this.save();
    return structuredClone(deleted);
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
    const identity = normalizeWhatsAppIdentity(input);
    const product = String(input.product || "").trim();
    if (!name) throw new Error("Ingresa el nombre del cliente.");
    if (!identity.whatsapp) {
      throw new Error("Ingresa un número o @usuario de WhatsApp válido.");
    }
    if (!product) throw new Error("Selecciona o escribe un producto.");
    if (!input.startDate || !input.expiryDate) {
      throw new Error("Ingresa la fecha de activación y de vencimiento.");
    }

    return {
      id: input.id,
      name,
      ...identity,
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

module.exports = {
  JsonStore,
  normalizeWhatsAppDigits,
  normalizeWhatsAppUsername,
  normalizeWhatsAppChatId,
  normalizeWhatsAppIdentity,
  whatsappIdentityKeys,
  clientWhatsAppTarget,
  MAX_PURCHASES_PER_PHONE
};
