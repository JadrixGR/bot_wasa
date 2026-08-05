"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const helmet = require("helmet");
const cookieSession = require("cookie-session");
const { version: appVersion } = require("../package.json");
const {
  JsonStore,
  clientWhatsAppTarget,
  normalizeWhatsAppDigits,
  normalizeWhatsAppIdentity
} = require("./store");
const { AiService } = require("./ai-service");
const { AuthenticatorService } = require("./authenticator-service");
const { WhatsAppService } = require("./whatsapp-service");
const { ReminderScheduler, fillTemplate } = require("./scheduler");
const {
  daysBetween,
  todayInTimeZone,
  minutesInTimeZone,
  timeToMinutes
} = require("./date-utils");

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, "data"));
const mediaDir = path.resolve(process.env.MEDIA_DIR || path.join(dataDir, "media"));
const sessionDir = path.join(dataDir, "whatsapp-session");
const port = Number(process.env.PORT) || 3000;
const adminPassword = process.env.ADMIN_PASSWORD || "Jadrix2026!";
const cookieSecret = process.env.COOKIE_SECRET || "cambia-este-secreto-jadrixservs-v4";
const dedicatedAuthenticatorKeyConfigured = Boolean(
  process.env.AUTHENTICATOR_ENCRYPTION_KEY
);
const authenticatorEncryptionKey =
  process.env.AUTHENTICATOR_ENCRYPTION_KEY || cookieSecret;
const dedicatedGeminiEncryptionKeyConfigured = Boolean(
  process.env.GEMINI_ENCRYPTION_KEY
);
const geminiEncryptionKey =
  process.env.GEMINI_ENCRYPTION_KEY || authenticatorEncryptionKey;
const persistentDiskConfigured =
  dataDir === "/data" || dataDir.startsWith(`/data${path.sep}`);

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(mediaDir, { recursive: true });

const store = new JsonStore(dataDir);
const ai = new AiService({ store, encryptionKey: geminiEncryptionKey });
const authenticator = new AuthenticatorService({
  store,
  encryptionKey: authenticatorEncryptionKey
});
const whatsapp = new WhatsAppService({
  store,
  sessionDir,
  mediaDir,
  ai,
  authenticator
});
const scheduler = new ReminderScheduler({
  store,
  whatsapp,
  timeZone: process.env.BOT_TIMEZONE || "America/Lima",
  intervalMinutes: process.env.REMINDER_CHECK_MINUTES || 15
});

const app = express();
app.set("trust proxy", 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", "blob:"]
      }
    }
  })
);
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: false }));
app.use(
  cookieSession({
    name: "jadrix_v4_session",
    keys: [cookieSecret],
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    httpOnly: true
  })
);

function requireAuth(req, res, next) {
  if (req.session?.authenticated) return next();
  return res.status(401).json({ error: "Inicia sesión para continuar." });
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function noStore(_req, res, next) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  next();
}

function clientForPanel(client) {
  let daysRemaining = null;
  try {
    daysRemaining = daysBetween(
      todayInTimeZone(process.env.BOT_TIMEZONE || "America/Lima"),
      client.expiryDate
    );
  } catch {
    // Una fecha inválida se muestra sin cálculo y puede corregirse desde Editar.
  }
  return { ...client, daysRemaining };
}

function isStoredMediaPath(filePath) {
  if (!filePath) return false;
  const relative = path.relative(mediaDir, path.resolve(filePath));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function removeStoredMedia(filePath) {
  if (isStoredMediaPath(filePath) && fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}

function quickReplyForPanel(reply) {
  return {
    ...reply,
    images: (reply.images || []).map(({ path: _privatePath, ...image }) => ({
      ...image,
      url: `/api/quick-replies/${encodeURIComponent(reply.id)}/images/${encodeURIComponent(image.id)}`
    }))
  };
}

function welcomeSequenceForPanel(sequence, scope, profileId) {
  return (Array.isArray(sequence) ? sequence : []).map((message) => ({
    ...message,
    image: message.image
      ? {
          ...Object.fromEntries(
            Object.entries(message.image).filter(([key]) => key !== "path")
          ),
          url: `/api/welcome-images/${encodeURIComponent(scope)}/${encodeURIComponent(profileId || "general")}/${encodeURIComponent(message.id)}`
        }
      : null
  }));
}

function settingsForPanel(settings) {
  const panelSettings = structuredClone(settings);
  panelSettings.greetingSequence = welcomeSequenceForPanel(
    settings.greetingSequence,
    "general",
    "general"
  );
  panelSettings.countryGreetings = (settings.countryGreetings || []).map(
    (profile) => ({
      ...profile,
      sequence: welcomeSequenceForPanel(
        profile.sequence,
        "country",
        profile.id
      )
    })
  );
  panelSettings.adGreetings = (settings.adGreetings || []).map((profile) => ({
    ...profile,
    sequence: welcomeSequenceForPanel(profile.sequence, "ad", profile.id)
  }));
  return panelSettings;
}

function welcomeImagePaths(settings) {
  const sequences = [
    settings?.greetingSequence,
    ...(settings?.countryGreetings || []).map((profile) => profile.sequence),
    ...(settings?.adGreetings || []).map((profile) => profile.sequence)
  ];
  return new Set(
    sequences
      .flatMap((sequence) => (Array.isArray(sequence) ? sequence : []))
      .map((message) => message?.image?.path)
      .filter(Boolean)
      .map((filePath) => path.resolve(filePath))
  );
}

function validWelcomeScope(value) {
  const scope = String(value || "").toLowerCase();
  return new Set(["general", "country", "ad"]).has(scope) ? scope : null;
}

function validateQuickReplyImage(buffer, extension) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (extension === ".png") {
    return buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    );
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (extension === ".webp") {
    return (
      buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    version: appVersion,
    whatsapp: whatsapp.getStatus().state,
    ai: whatsapp.getAiStatus(),
    authenticator: {
      encryptedAtRest: true,
      dedicatedKeyConfigured: dedicatedAuthenticatorKeyConfigured
    },
    storage: {
      persistentDiskConfigured,
      automaticBackup: true
    },
    time: new Date().toISOString()
  });
});

app.get("/api/auth/session", (req, res) => {
  res.json({
    authenticated: Boolean(req.session?.authenticated),
    usingDefaultPassword: !process.env.ADMIN_PASSWORD
  });
});

app.post("/api/auth/login", (req, res) => {
  if (String(req.body.password || "") !== adminPassword) {
    return res.status(401).json({ error: "Contraseña incorrecta." });
  }
  req.session.authenticated = true;
  return res.json({ ok: true });
});

app.post("/api/auth/logout", requireAuth, (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get("/api/authenticator", requireAuth, noStore, (_req, res) => {
  res.json({
    accounts: authenticator.listAccounts(),
    security: {
      encryptedAtRest: true,
      dedicatedKeyConfigured: dedicatedAuthenticatorKeyConfigured
    },
    generatedAt: new Date().toISOString()
  });
});

app.post("/api/authenticator", requireAuth, noStore, (req, res) => {
  res.status(201).json(authenticator.createAccount(req.body));
});

app.put("/api/authenticator/:id", requireAuth, noStore, (req, res) => {
  res.json(authenticator.updateAccount(req.params.id, req.body));
});

app.delete("/api/authenticator/:id", requireAuth, noStore, (req, res) => {
  res.json({
    ok: true,
    account: authenticator.deleteAccount(req.params.id)
  });
});

app.get("/api/authenticator/access", requireAuth, noStore, (req, res) => {
  res.json({ access: store.listAuthenticatorAccess(req.query.accountId || null) });
});

app.post(
  "/api/authenticator/:id/access",
  requireAuth,
  noStore,
  (req, res) => {
    res.status(201).json(store.createAuthenticatorAccess(req.params.id, req.body));
  }
);

app.put("/api/authenticator/access/:accessId", requireAuth, noStore, (req, res) => {
  res.json(store.updateAuthenticatorAccess(req.params.accessId, req.body));
});

app.delete("/api/authenticator/access/:accessId", requireAuth, noStore, (req, res) => {
  res.json({ ok: true, access: store.deleteAuthenticatorAccess(req.params.accessId) });
});

app.get("/api/catalog", requireAuth, noStore, (_req, res) => {
  res.json({ items: store.listCatalog() });
});

app.post("/api/catalog", requireAuth, noStore, (req, res) => {
  res.status(201).json(store.createCatalogItem(req.body));
});

app.put("/api/catalog/:id", requireAuth, noStore, (req, res) => {
  res.json(store.updateCatalogItem(req.params.id, req.body));
});

app.delete("/api/catalog/:id", requireAuth, noStore, (req, res) => {
  res.json({ ok: true, item: store.deleteCatalogItem(req.params.id) });
});

app.get("/api/quick-replies", requireAuth, noStore, (_req, res) => {
  res.json({ items: store.listQuickReplies().map(quickReplyForPanel) });
});

app.post("/api/quick-replies", requireAuth, noStore, (req, res) => {
  res.status(201).json(quickReplyForPanel(store.createQuickReply(req.body)));
});

app.put("/api/quick-replies/:id", requireAuth, noStore, (req, res) => {
  res.json(
    quickReplyForPanel(store.updateQuickReply(req.params.id, req.body))
  );
});

app.delete("/api/quick-replies/:id", requireAuth, noStore, (req, res) => {
  const deleted = store.deleteQuickReply(req.params.id);
  for (const image of deleted.images || []) removeStoredMedia(image.path);
  res.json({ ok: true, item: quickReplyForPanel(deleted) });
});

app.get(
  "/api/quick-replies/:id/images/:imageId",
  requireAuth,
  noStore,
  (req, res) => {
    const reply = store.getQuickReply(req.params.id);
    const image = reply?.images?.find(
      (entry) => entry.id === String(req.params.imageId || "")
    );
    if (!image || !isStoredMediaPath(image.path) || !fs.existsSync(image.path)) {
      return res.status(404).json({ error: "Imagen no encontrada." });
    }
    res.type(image.mimetype || path.extname(image.path));
    return res.sendFile(path.resolve(image.path));
  }
);

app.post(
  "/api/quick-replies/:id/images",
  requireAuth,
  noStore,
  express.raw({ type: "application/octet-stream", limit: "8mb" }),
  (req, res) => {
    if (!store.getQuickReply(req.params.id)) {
      return res.status(404).json({ error: "Respuesta rápida no encontrada." });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "Selecciona una imagen." });
    }
    if (req.body.length > 8 * 1024 * 1024) {
      return res.status(413).json({ error: "La imagen supera el límite de 8 MB." });
    }

    let originalName = "";
    try {
      originalName = decodeURIComponent(String(req.get("X-File-Name") || ""));
    } catch {
      return res.status(400).json({ error: "El nombre de la imagen no es válido." });
    }
    originalName = path.basename(originalName).slice(0, 180);
    const extension = path.extname(originalName).toLowerCase();
    const mimeByExtension = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp"
    };
    if (!mimeByExtension[extension] || !validateQuickReplyImage(req.body, extension)) {
      return res.status(400).json({
        error: "La imagen no es válida. Usa un archivo PNG, JPG, JPEG o WEBP real."
      });
    }

    const filePath = path.join(
      mediaDir,
      `quick-reply-${req.params.id}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${extension}`
    );
    fs.writeFileSync(filePath, req.body);
    try {
      const image = store.addQuickReplyImage(req.params.id, {
        id: crypto.randomUUID(),
        path: path.resolve(filePath),
        originalName,
        mimetype: mimeByExtension[extension],
        size: req.body.length,
        uploadedAt: new Date().toISOString()
      });
      const reply = store.getQuickReply(req.params.id);
      return res.status(201).json(
        quickReplyForPanel(reply).images.find((entry) => entry.id === image.id)
      );
    } catch (error) {
      removeStoredMedia(filePath);
      throw error;
    }
  }
);

app.delete(
  "/api/quick-replies/:id/images/:imageId",
  requireAuth,
  noStore,
  (req, res) => {
    const deleted = store.deleteQuickReplyImage(
      req.params.id,
      req.params.imageId
    );
    removeStoredMedia(deleted.path);
    res.json({ ok: true });
  }
);

app.get("/api/dashboard", requireAuth, (req, res) => {
  const clients = store.listClients();
  const activeClients = clients.filter((client) => client.status === "activo");
  const today = todayInTimeZone(process.env.BOT_TIMEZONE || "America/Lima");
  const dueSoon = activeClients.filter((client) => {
    const days = daysBetween(today, client.expiryDate);
    return days === 2;
  }).length;
  const dueToday = activeClients.filter(
    (client) => daysBetween(today, client.expiryDate) === 0
  ).length;
  const expired = activeClients.filter(
    (client) => daysBetween(today, client.expiryDate) < 0
  ).length;
  res.json({
    whatsapp: whatsapp.getStatus(),
    storage: {
      persistentDiskConfigured,
      automaticBackup: true
    },
    stats: {
      active: activeClients.length,
      dueSoon,
      dueToday,
      expired,
      total: clients.length
    },
    recentLogs: store.listLogs(8)
  });
});

app.get("/api/whatsapp/status", requireAuth, (_req, res) => {
  res.json(whatsapp.getStatus());
});

app.post(
  "/api/whatsapp/restart",
  requireAuth,
  asyncRoute(async (_req, res) => {
    res.json({ ok: true, message: "WhatsApp se está reiniciando." });
    whatsapp.restart().catch((error) => {
      store.addLog("error", `No se pudo reiniciar WhatsApp: ${error.message}`);
      store.save();
    });
  })
);

app.post(
  "/api/whatsapp/reset",
  requireAuth,
  asyncRoute(async (_req, res) => {
    const result = await whatsapp.resetSession();
    res.json({
      ok: true,
      message: result.remoteLogoutCompleted
        ? "Sesión cerrada. Estamos generando un QR nuevo."
        : "Credenciales anteriores eliminadas. Estamos generando un QR nuevo.",
      ...result
    });
  })
);

app.post(
  "/api/whatsapp/recover",
  requireAuth,
  asyncRoute(async (_req, res) => {
    const result = await whatsapp.forceReadyProbe();
    res.json({ ok: true, ...result });
  })
);

app.get("/api/clients", requireAuth, (req, res) => {
  res.json(
    store
      .listClients({ includeArchived: req.query.archived === "1" })
      .map(clientForPanel)
  );
});

app.get("/api/clients/lookup", requireAuth, (req, res) => {
  const requestedIdentity = String(req.query.identity || req.query.phone || "").trim();
  const identity = normalizeWhatsAppIdentity(requestedIdentity);
  if (!identity.whatsapp) {
    return res.status(400).json({
      error: "Ingresa un número o @usuario de WhatsApp válido para realizar la búsqueda."
    });
  }
  return res.json({
    phone: identity.whatsappPhone,
    identity: identity.whatsapp,
    clients: store.findClientsByWhatsApp(identity).map(clientForPanel)
  });
});

app.post(
  "/api/clients",
  requireAuth,
  asyncRoute(async (req, res) => {
    const identity = await whatsapp.resolveIdentity(req.body);
    res.status(201).json(store.createClient({ ...req.body, ...identity }));
  })
);

app.put(
  "/api/clients/:id",
  requireAuth,
  asyncRoute(async (req, res) => {
    const identity = req.body.whatsapp === undefined
      ? {}
      : await whatsapp.resolveIdentity(req.body);
    res.json(store.updateClient(req.params.id, { ...req.body, ...identity }));
  })
);

app.post("/api/clients/:id/archive", requireAuth, (req, res) => {
  res.json(store.archiveClient(req.params.id));
});

app.delete("/api/clients/by-phone/:phone", requireAuth, (req, res) => {
  const deleted = store.deleteClientsByWhatsApp(req.params.phone);
  res.json({
    ok: true,
    deleted: deleted.length,
    phone: normalizeWhatsAppDigits(req.params.phone),
    identity: normalizeWhatsAppIdentity(req.params.phone).whatsapp
  });
});

app.delete("/api/clients/:id", requireAuth, (req, res) => {
  res.json({ ok: true, client: store.deleteClient(req.params.id) });
});

app.post("/api/clients/:id/renew", requireAuth, (req, res) => {
  res.json(store.renewClient(req.params.id, req.body));
});

app.post(
  "/api/clients/:id/reminder",
  requireAuth,
  asyncRoute(async (req, res) => {
    const client = store.getClient(req.params.id);
    if (!client) return res.status(404).json({ error: "Cliente no encontrado." });
    const settings = store.getSettings();
    const message = fillTemplate(settings.reminderTemplate, client);
    await whatsapp.sendText(clientWhatsAppTarget(client), message);
    store.updateClient(client.id, {
      lastReminderKey: `${client.expiryDate}:reminder:2`
    });
    store.addLog("reminder", `Recordatorio manual enviado a ${client.name}`, {
      clientId: client.id
    });
    store.save();
    return res.json({ ok: true });
  })
);

app.post(
  "/api/clients/:id/charge",
  requireAuth,
  asyncRoute(async (req, res) => {
    const client = store.getClient(req.params.id);
    if (!client) return res.status(404).json({ error: "Cliente no encontrado." });
    const message = fillTemplate(store.getSettings().chargeTemplate, client);
    await whatsapp.sendText(clientWhatsAppTarget(client), message);
    store.updateClient(client.id, {
      lastChargeKey: `${client.expiryDate}:charge`
    });
    store.addLog("charge", `Cobranza manual enviada a ${client.name}`, {
      clientId: client.id
    });
    store.save();
    return res.json({ ok: true });
  })
);

app.post(
  "/api/clients/charge-due-today",
  requireAuth,
  asyncRoute(async (_req, res) => {
    if (!whatsapp.getStatus().ready) {
      return res.status(409).json({
        error: "WhatsApp debe estar conectado antes de enviar las cobranzas."
      });
    }

    const timeZone = process.env.BOT_TIMEZONE || "America/Lima";
    const settings = store.getSettings();
    const chargeStartTime = settings.chargeStartTime || "09:00";
    const currentMinutes = minutesInTimeZone(timeZone);
    if (currentMinutes < timeToMinutes(chargeStartTime)) {
      return res.status(400).json({
        error: `Las cobranzas del día se habilitan desde las ${chargeStartTime}.`
      });
    }

    const today = todayInTimeZone(timeZone);
    const dueToday = store.listClients().filter(
      (client) =>
        !client.archived &&
        client.status === "activo" &&
        client.expiryDate === today
    );
    const pending = dueToday.filter(
      (client) => client.lastChargeKey !== `${client.expiryDate}:charge`
    );
    const errors = [];
    let sent = 0;

    for (const client of pending) {
      try {
        await whatsapp.sendText(
          clientWhatsAppTarget(client),
          fillTemplate(settings.chargeTemplate, client)
        );
        store.updateClient(client.id, {
          lastChargeKey: `${client.expiryDate}:charge`
        });
        store.addLog("charge", `Cobranza del día enviada a ${client.name}`, {
          clientId: client.id,
          batch: true
        });
        store.save();
        sent += 1;
      } catch (error) {
        errors.push({
          clientId: client.id,
          name: client.name,
          message: error.message
        });
      }
    }

    return res.json({
      ok: errors.length === 0,
      date: today,
      chargeStartTime,
      totalDue: dueToday.length,
      pending: pending.length,
      alreadyCharged: dueToday.length - pending.length,
      sent,
      errors
    });
  })
);

app.get("/api/settings", requireAuth, (_req, res) => {
  res.json({
    settings: settingsForPanel(store.getSettings()),
    products: store.snapshot().products,
    plans: store.snapshot().plans,
    countryPriceBooks: store.getCountryPriceBooks(),
    knowledgeBase: store.getKnowledgeBase(),
    media: store.snapshot().media,
    ai: whatsapp.getAiStatus()
  });
});

app.put("/api/settings", requireAuth, (req, res) => {
  const previous = store.snapshot();
  try {
    const settings = store.updateSettings(req.body);
    const knowledgeBase =
      req.body.knowledgeBase === undefined
        ? store.getKnowledgeBase()
        : store.updateKnowledgeBase(req.body.knowledgeBase);
    const countryPriceBooks =
      req.body.countryPriceBooks === undefined
        ? store.getCountryPriceBooks()
        : store.updateCountryPriceBooks(req.body.countryPriceBooks);
    const activeWelcomeImages = welcomeImagePaths(store.getSettings());
    for (const oldPath of welcomeImagePaths(previous.settings)) {
      if (!activeWelcomeImages.has(oldPath)) removeStoredMedia(oldPath);
    }
    res.json({
      settings: settingsForPanel(settings),
      knowledgeBase,
      countryPriceBooks
    });
  } catch (error) {
    store.data = previous;
    store.save();
    throw error;
  }
});

app.get(
  "/api/welcome-images/:scope/:profileId/:messageId",
  requireAuth,
  noStore,
  (req, res) => {
    const scope = validWelcomeScope(req.params.scope);
    if (!scope) {
      return res.status(400).json({ error: "Tipo de bienvenida no permitido." });
    }
    const message = store.getWelcomeMessage(
      scope,
      req.params.profileId,
      req.params.messageId
    );
    const image = message?.image;
    if (!image || !isStoredMediaPath(image.path) || !fs.existsSync(image.path)) {
      return res.status(404).json({ error: "Imagen no encontrada." });
    }
    res.type(image.mimetype || path.extname(image.path));
    return res.sendFile(path.resolve(image.path));
  }
);

app.post(
  "/api/welcome-images/:scope/:profileId/:messageId",
  requireAuth,
  noStore,
  express.raw({ type: "application/octet-stream", limit: "8mb" }),
  (req, res) => {
    const scope = validWelcomeScope(req.params.scope);
    if (!scope) {
      return res.status(400).json({ error: "Tipo de bienvenida no permitido." });
    }
    const message = store.getWelcomeMessage(
      scope,
      req.params.profileId,
      req.params.messageId
    );
    if (!message) {
      return res.status(404).json({ error: "Mensaje de bienvenida no encontrado." });
    }
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "Selecciona una imagen." });
    }
    if (req.body.length > 8 * 1024 * 1024) {
      return res.status(413).json({ error: "La imagen supera el límite de 8 MB." });
    }

    let originalName = "";
    try {
      originalName = decodeURIComponent(String(req.get("X-File-Name") || ""));
    } catch {
      return res.status(400).json({ error: "El nombre de la imagen no es válido." });
    }
    originalName = path.basename(originalName).slice(0, 180);
    const extension = path.extname(originalName).toLowerCase();
    const mimeByExtension = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp"
    };
    if (!mimeByExtension[extension] || !validateQuickReplyImage(req.body, extension)) {
      return res.status(400).json({
        error: "La imagen no es válida. Usa un archivo PNG, JPG, JPEG o WEBP real."
      });
    }

    const filePath = path.join(
      mediaDir,
      `welcome-${scope}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${extension}`
    );
    fs.writeFileSync(filePath, req.body);
    try {
      const result = store.setWelcomeMessageImage(
        scope,
        req.params.profileId,
        req.params.messageId,
        {
          id: crypto.randomUUID(),
          path: path.resolve(filePath),
          originalName,
          mimetype: mimeByExtension[extension],
          size: req.body.length,
          uploadedAt: new Date().toISOString()
        }
      );
      if (result.previous?.path) removeStoredMedia(result.previous.path);
      const refreshed = store.getWelcomeMessage(
        scope,
        req.params.profileId,
        req.params.messageId
      );
      const [panelMessage] = welcomeSequenceForPanel(
        [refreshed],
        scope,
        req.params.profileId
      );
      return res.status(201).json(panelMessage.image);
    } catch (error) {
      removeStoredMedia(filePath);
      throw error;
    }
  }
);

app.delete(
  "/api/welcome-images/:scope/:profileId/:messageId",
  requireAuth,
  noStore,
  (req, res) => {
    const scope = validWelcomeScope(req.params.scope);
    if (!scope) {
      return res.status(400).json({ error: "Tipo de bienvenida no permitido." });
    }
    const deleted = store.deleteWelcomeMessageImage(
      scope,
      req.params.profileId,
      req.params.messageId
    );
    removeStoredMedia(deleted.path);
    res.json({ ok: true });
  }
);

app.post(
  "/api/ai/test",
  requireAuth,
  asyncRoute(async (_req, res) => {
    res.json(await ai.testConnection());
  })
);

app.put("/api/ai/config", requireAuth, (req, res) => {
  res.json({ ai: ai.configureGemini(req.body) });
});

app.delete("/api/ai/key", requireAuth, (_req, res) => {
  res.json({ ai: ai.clearGeminiApiKey() });
});

const allowedMedia = {
  dicloakAudio: {
    extensions: new Set([".ogg", ".opus", ".mp3", ".wav", ".m4a"]),
    maxSize: 20 * 1024 * 1024
  },
  catalogPdf: {
    extensions: new Set([".pdf"]),
    maxSize: 20 * 1024 * 1024
  }
};

app.post(
  "/api/media/:kind",
  requireAuth,
  express.raw({ type: "application/octet-stream", limit: "20mb" }),
  (req, res) => {
    const rule = allowedMedia[req.params.kind];
    if (!rule) return res.status(400).json({ error: "Tipo de archivo no permitido." });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: "Selecciona un archivo." });
    }
    if (req.body.length > rule.maxSize) {
      return res.status(413).json({ error: "El archivo supera el límite de 20 MB." });
    }

    let originalName = "";
    try {
      originalName = decodeURIComponent(String(req.get("X-File-Name") || ""));
    } catch {
      return res.status(400).json({ error: "El nombre del archivo no es válido." });
    }
    originalName = path.basename(originalName).slice(0, 180);
    const extension = path.extname(originalName).toLowerCase();
    if (!originalName || !rule.extensions.has(extension)) {
      return res.status(400).json({ error: "Formato de archivo no permitido." });
    }

    const filePath = path.join(mediaDir, `${req.params.kind}-${Date.now()}${extension}`);
    fs.writeFileSync(filePath, req.body);
    const previous = store.getMedia(req.params.kind);
    const metadata = {
      path: path.resolve(filePath),
      originalName,
      mimetype: req.get("X-File-Type") || "application/octet-stream",
      size: req.body.length,
      uploadedAt: new Date().toISOString()
    };
    store.setMedia(req.params.kind, metadata);
    if (previous?.path && path.resolve(previous.path).startsWith(mediaDir) && fs.existsSync(previous.path)) {
      fs.rmSync(previous.path, { force: true });
    }
    return res.status(201).json(metadata);
  }
);

app.get("/api/conversations", requireAuth, (_req, res) => {
  const items = Object.entries(store.data.conversations)
    .map(([chatId, value]) => ({ chatId, ...value }))
    .filter((item) => item.paused)
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  res.json(items);
});

app.post("/api/conversations/:chatId/resume", requireAuth, (req, res) => {
  res.json(store.updateConversation(req.params.chatId, {
    paused: false,
    resumedAt: new Date().toISOString()
  }));
});

app.get("/api/logs", requireAuth, (req, res) => {
  res.json(store.listLogs(req.query.limit));
});

app.post(
  "/api/scheduler/run",
  requireAuth,
  asyncRoute(async (_req, res) => {
    res.json(await scheduler.runOnce());
  })
);

app.get("/api/export/clients.csv", requireAuth, (_req, res) => {
  const columns = [
    "nombre",
    "whatsapp",
    "usuario_whatsapp",
    "id_chat_whatsapp",
    "producto",
    "cuenta_asociada",
    "precio",
    "metodo_pago",
    "fecha_activacion",
    "fecha_vencimiento",
    "estado",
    "recordatorio_dias",
    "duracion_dias",
    "recordatorio_automatico",
    "cobro_automatico",
    "notas"
  ];
  const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = store.listClients({ includeArchived: true }).map((client) =>
    [
      client.name,
      client.whatsapp,
      client.whatsappUsername,
      client.whatsappChatId,
      client.product,
      client.accountReference,
      client.price,
      client.paymentMethod,
      client.startDate,
      client.expiryDate,
      client.status,
      client.reminderDays,
      client.durationDays,
      client.autoReminder ? "sí" : "no",
      client.autoCharge ? "sí" : "no",
      client.notes
    ].map(escapeCsv)
  );
  const csv = [columns.map(escapeCsv), ...rows].map((row) => row.join(",")).join("\r\n");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="clientes-jadrixservs.csv"');
  res.send(`\uFEFF${csv}`);
});

app.get("/api/backup/data.json", requireAuth, (_req, res) => {
  const date = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="respaldo-jadrixservs-${date}.json"`
  );
  res.setHeader("Cache-Control", "no-store");
  res.send(`${JSON.stringify(store.snapshot(), null, 2)}\n`);
});

app.post("/api/backup/restore", requireAuth, (req, res) => {
  const result = store.restoreSnapshot(req.body);
  res.json({ ok: true, ...result });
});

app.use(express.static(path.join(rootDir, "public"), { index: "index.html" }));

app.use((error, _req, res, _next) => {
  const status = error.status || (error.message?.includes("no encontrado") ? 404 : 400);
  store.addLog("error", error.message || "Error desconocido");
  store.save();
  res.status(status).json({
    error: error.message || "Ocurrió un error.",
    ...(error.code ? { code: error.code } : {})
  });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`JadrixServs V${appVersion} disponible en el puerto ${port}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn("ADMIN_PASSWORD no está configurada. Se está usando la clave local predeterminada.");
  }
  if (process.env.NODE_ENV === "production" && !persistentDiskConfigured) {
    console.warn(
      "DATA_DIR no apunta a /data. La sesión de WhatsApp y los clientes podrían perderse al reiniciar Render."
    );
  }
  if (!dedicatedAuthenticatorKeyConfigured) {
    console.warn(
      "AUTHENTICATOR_ENCRYPTION_KEY no está configurada; las claves 2FA se cifrarán usando COOKIE_SECRET."
    );
  }
  if (!dedicatedGeminiEncryptionKeyConfigured) {
    console.warn(
      "GEMINI_ENCRYPTION_KEY no está configurada; la API key de Gemini se cifrará usando AUTHENTICATOR_ENCRYPTION_KEY o COOKIE_SECRET."
    );
  }
  scheduler.start();
  whatsapp.initialize().catch((error) => {
    console.error("WhatsApp no pudo iniciar:", error.message);
  });
});

let shuttingDown = false;

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  scheduler.stop();
  const forcedExit = setTimeout(() => process.exit(1), 8000);
  forcedExit.unref();
  await whatsapp.shutdown().catch(() => undefined);
  server.close(() => {
    clearTimeout(forcedExit);
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

module.exports = { app, store, whatsapp, scheduler, authenticator, ai };
