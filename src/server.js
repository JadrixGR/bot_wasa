"use strict";

const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const helmet = require("helmet");
const cookieSession = require("cookie-session");
const { JsonStore } = require("./store");
const { AiService } = require("./ai-service");
const { WhatsAppService } = require("./whatsapp-service");
const { ReminderScheduler } = require("./scheduler");
const { daysBetween, todayInTimeZone } = require("./date-utils");

const rootDir = path.resolve(__dirname, "..");
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, "data"));
const mediaDir = path.resolve(process.env.MEDIA_DIR || path.join(dataDir, "media"));
const sessionDir = path.join(dataDir, "whatsapp-session");
const port = Number(process.env.PORT) || 3000;
const adminPassword = process.env.ADMIN_PASSWORD || "Jadrix2026!";
const cookieSecret = process.env.COOKIE_SECRET || "cambia-este-secreto-jadrixservs-v4";

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(mediaDir, { recursive: true });

const store = new JsonStore(dataDir);
const ai = new AiService({ store });
const whatsapp = new WhatsAppService({ store, sessionDir, mediaDir, ai });
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
        "img-src": ["'self'", "data:"]
      }
    }
  })
);
app.use(express.json({ limit: "1mb" }));
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

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    version: "4.1",
    whatsapp: whatsapp.getStatus().state,
    ai: whatsapp.getAiStatus(),
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

app.get("/api/dashboard", requireAuth, (req, res) => {
  const clients = store.listClients();
  const today = todayInTimeZone(process.env.BOT_TIMEZONE || "America/Lima");
  const dueSoon = clients.filter((client) => {
    const days = daysBetween(today, client.expiryDate);
    return days >= 0 && days <= 2;
  }).length;
  const expired = clients.filter((client) => daysBetween(today, client.expiryDate) < 0).length;
  const pausedChats = Object.values(store.data.conversations).filter((item) => item.paused).length;
  res.json({
    whatsapp: whatsapp.getStatus(),
    stats: {
      active: clients.filter((client) => client.status === "activo").length,
      dueSoon,
      expired,
      pausedChats,
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
    res.json({ ok: true, message: "Sesión cerrada. Aparecerá un QR nuevo." });
    whatsapp.resetSession().catch((error) => {
      store.addLog("error", `No se pudo restablecer la sesión: ${error.message}`);
      store.save();
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
  res.json(store.listClients({ includeArchived: req.query.archived === "1" }));
});

app.post("/api/clients", requireAuth, (req, res) => {
  res.status(201).json(store.createClient(req.body));
});

app.put("/api/clients/:id", requireAuth, (req, res) => {
  res.json(store.updateClient(req.params.id, req.body));
});

app.post("/api/clients/:id/archive", requireAuth, (req, res) => {
  res.json(store.archiveClient(req.params.id));
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
    const message = settings.reminderTemplate
      .replaceAll("{nombre}", client.name)
      .replaceAll("{producto}", client.product)
      .replaceAll("{precio}", client.price)
      .replaceAll("{fecha}", client.expiryDate);
    await whatsapp.sendText(client.whatsapp, message);
    store.addLog("reminder", `Recordatorio manual enviado a ${client.name}`, {
      clientId: client.id
    });
    store.save();
    return res.json({ ok: true });
  })
);

app.get("/api/settings", requireAuth, (_req, res) => {
  res.json({
    settings: store.getSettings(),
    products: store.snapshot().products,
    plans: store.snapshot().plans,
    media: store.snapshot().media,
    ai: whatsapp.getAiStatus()
  });
});

app.put("/api/settings", requireAuth, (req, res) => {
  res.json(store.updateSettings(req.body));
});

app.post(
  "/api/ai/test",
  requireAuth,
  asyncRoute(async (_req, res) => {
    res.json(await ai.testConnection());
  })
);

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
    "producto",
    "precio",
    "metodo_pago",
    "fecha_activacion",
    "fecha_vencimiento",
    "estado",
    "recordatorio_dias",
    "recordatorio_automatico",
    "cobro_automatico",
    "notas"
  ];
  const escapeCsv = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const rows = store.listClients({ includeArchived: true }).map((client) =>
    [
      client.name,
      client.whatsapp,
      client.product,
      client.price,
      client.paymentMethod,
      client.startDate,
      client.expiryDate,
      client.status,
      client.reminderDays,
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

app.use(express.static(path.join(rootDir, "public"), { index: "index.html" }));

app.use((error, _req, res, _next) => {
  const status = error.status || (error.message?.includes("no encontrado") ? 404 : 400);
  store.addLog("error", error.message || "Error desconocido");
  store.save();
  res.status(status).json({ error: error.message || "Ocurrió un error." });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`JadrixServs V4 disponible en el puerto ${port}`);
  if (!process.env.ADMIN_PASSWORD) {
    console.warn("ADMIN_PASSWORD no está configurada. Se está usando la clave local predeterminada.");
  }
  scheduler.start();
  whatsapp.initialize().catch((error) => {
    console.error("WhatsApp no pudo iniciar:", error.message);
  });
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 8000).unref();
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

module.exports = { app, store, whatsapp, scheduler };
