"use strict";

const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  WhatsAppService,
  buildConnectionCandidates,
  calculateHumanDelay,
  compatibleBrowserProfile,
  extractMessageBody,
  formatAuthenticatorCodeMessage,
  formatWhatsAppWebVersion,
  getDisconnectStatusCode,
  isSensitiveSignalSessionDump,
  normalizeWhatsAppId,
  parseWhatsAppWebVersion
} = require("../src/whatsapp-service");

const testRuntimeDir = path.resolve("test-runtime");

test.after(() => {
  fs.rmSync(testRuntimeDir, { recursive: true, force: true });
});

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function settleMessageQueue(service) {
  for (let attempt = 0; attempt < 250; attempt += 1) {
    await flush();
    if (service.queues.size === 0) return;
  }
  throw new Error("La cola de mensajes no terminó a tiempo.");
}

function makeStore() {
  const logs = [];
  const conversations = {};
  const processedCommandIds = [];
  return {
    logs,
    data: { conversations, processedCommandIds },
    addLog: (type, message, details) => logs.push({ type, message, details }),
    save: () => undefined,
    getConversation: (chatId) => ({ ...(conversations[chatId] || {}) }),
    updateConversation: (chatId, patch) => {
      conversations[chatId] = {
        ...(conversations[chatId] || {}),
        ...patch
      };
      return { ...conversations[chatId] };
    },
    findClientByWhatsApp: () => null,
    findQuickReplyByCommand: () => null,
    isCommandMessageProcessed: (id) =>
      processedCommandIds.includes(String(id || "")),
    markCommandMessageProcessed: (id) => {
      const value = String(id || "");
      if (!value || processedCommandIds.includes(value)) return false;
      processedCommandIds.unshift(value);
      return true;
    },
    registerClientFromCommand: () => ({
      client: { id: "cliente-comando" },
      created: true,
      duplicate: false
    }),
    getSettings: () => ({
      shortGreeting: "Hola",
      greetingMessages: ["Catálogo", "Planes", "Ayuda"],
      fallbackReply: "No tengo ese dato."
    }),
    getMedia: () => null
  };
}

function makeFakeBaileys({
  registered = false,
  lidPhone = null,
  logoutNeverResolves = false,
  freshAuthAfterFirstLoad = false,
  latestWaVersion = null,
  latestWaVersionError = null
} = {}) {
  const sockets = [];
  const state = { creds: { registered }, keys: {} };
  let authLoads = 0;

  function makeWASocket(config = {}) {
    const ev = new EventEmitter();
    ev.destroy = () => undefined;
    const calls = {
      presence: [],
      sent: [],
      read: [],
      ended: 0,
      loggedOut: 0
    };
    const socket = {
      ev,
      calls,
      config,
      user: { id: "51999888777:12@s.whatsapp.net", name: "Jadrix" },
      signalRepository: {
        lidMapping: {
          getPNForLID: async () => lidPhone
        }
      },
      presenceSubscribe: async () => undefined,
      sendPresenceUpdate: async (type, jid) => calls.presence.push({ type, jid }),
      sendMessage: async (jid, content) => {
        calls.sent.push({ jid, content });
        return { key: { id: "sent-1" } };
      },
      readMessages: async (keys) => calls.read.push(keys),
      end: async () => {
        calls.ended += 1;
      },
      logout: async () => {
        calls.loggedOut += 1;
        if (logoutNeverResolves) {
          return new Promise(() => undefined);
        }
      }
    };
    sockets.push(socket);
    return socket;
  }

  return {
    module: {
      default: makeWASocket,
      Browsers: {
        ubuntu: (name) => ["Ubuntu", name, "1.0"],
        macOS: (name) => ["Mac OS", name, "14.4.1"],
        windows: (name) => ["Windows", name, "10.0.22631"]
      },
      DisconnectReason: {
        loggedOut: 401,
        forbidden: 403,
        connectionLost: 408,
        multideviceMismatch: 411,
        connectionClosed: 428,
        connectionReplaced: 440,
        badSession: 500,
        unavailableService: 503,
        restartRequired: 515
      },
      fetchLatestWaWebVersion: latestWaVersion || latestWaVersionError
        ? async () => {
            if (latestWaVersionError) throw latestWaVersionError;
            return { version: latestWaVersion, isLatest: true };
          }
        : undefined,
      useMultiFileAuthState: async () => {
        authLoads += 1;
        if (freshAuthAfterFirstLoad && authLoads > 1) {
          state.creds.registered = false;
        }
        return {
          state,
          saveCreds: async () => undefined
        };
      },
      jidNormalizedUser: (jid) => jid.replace(/:\d+@/, "@"),
      getContentType: (content) => Object.keys(content || {})[0]
    },
    sockets,
    state
  };
}

function makeService(fake, options = {}) {
  return new WhatsAppService({
    store: options.store || makeStore(),
    sessionDir:
      options.sessionDir || path.join(testRuntimeDir, "whatsapp-session"),
    mediaDir: options.mediaDir || path.join(testRuntimeDir, "media"),
    ai: null,
    authenticator: options.authenticator || null,
    baileysLoader: async () => fake.module,
    qrEncoder: async (value) => `data:image/png;base64,${value}`,
    sleepFn: async () => undefined,
    readyTimeoutMs: options.readyTimeoutMs,
    logoutTimeoutMs: options.logoutTimeoutMs,
    qrWaitTimeoutMs: options.qrWaitTimeoutMs
  });
}

test("la demora humana crece con el texto y respeta sus límites", () => {
  const short = calculateHumanDelay("Hola", {
    minimum: 900,
    maximum: 4200,
    random: () => 0
  });
  const long = calculateHumanDelay("x".repeat(300), {
    minimum: 900,
    maximum: 4200,
    random: () => 0
  });
  assert.equal(short, 900);
  assert.ok(long > short);
  assert.ok(long <= 4200);
});

test("normaliza números para el identificador WebSocket de WhatsApp", () => {
  assert.equal(
    normalizeWhatsAppId("999 888 777"),
    "51999888777@s.whatsapp.net"
  );
  assert.equal(
    normalizeWhatsAppId("51999888777"),
    "51999888777@s.whatsapp.net"
  );
  assert.equal(
    normalizeWhatsAppId("51999888777:12@s.whatsapp.net"),
    "51999888777@s.whatsapp.net"
  );
});

test("extrae texto aunque WhatsApp lo envíe como mensaje efímero", () => {
  assert.equal(
    extractMessageBody({
      ephemeralMessage: {
        message: { extendedTextMessage: { text: "¿Cuánto cuesta Claude?" } }
      }
    }),
    "¿Cuánto cuesta Claude?"
  );
});

test("formatea el código 2FA sin incluir el correo ni datos innecesarios", () => {
  const message = formatAuthenticatorCodeMessage({
    service: "ChatGPT Plus",
    email: "privado@correo.test",
    code: "177525",
    secondsRemaining: 27
  });
  assert.match(message, /Código de ChatGPT Plus/);
  assert.match(message, /177525/);
  assert.match(message, /27 segundos/);
  assert.doesNotMatch(message, /privado@correo\.test/);
});

test("lee el código de desconexión que entrega WhatsApp", () => {
  assert.equal(
    getDisconnectStatusCode({ output: { statusCode: 515 } }),
    515
  );
  assert.equal(getDisconnectStatusCode(new Error("sin código")), null);
});

test("usa el perfil Mac OS con Chrome compatible con WhatsApp", async () => {
  const fake = makeFakeBaileys({ registered: true });
  const service = makeService(fake);
  await service.initialize();

  assert.deepEqual(
    compatibleBrowserProfile(fake.module.Browsers),
    ["Mac OS", "Chrome", "14.4.1"]
  );
  assert.deepEqual(
    fake.sockets[0].config.browser,
    ["Mac OS", "Chrome", "14.4.1"]
  );
});

test("valida la versión de WhatsApp Web y crea perfiles alternativos", () => {
  const fake = makeFakeBaileys();
  assert.deepEqual(
    parseWhatsAppWebVersion("2,3000,1044006379"),
    [2, 3000, 1044006379]
  );
  assert.deepEqual(
    parseWhatsAppWebVersion([2, 3000, 1044006379]),
    [2, 3000, 1044006379]
  );
  assert.equal(parseWhatsAppWebVersion("versión inválida"), null);
  assert.equal(
    formatWhatsAppWebVersion([2, 3000, 1044006379]),
    "2.3000.1044006379"
  );

  const candidates = buildConnectionCandidates({
    Browsers: fake.module.Browsers,
    liveVersion: [2, 3000, 1044006379]
  });
  assert.deepEqual(candidates[0].version, [2, 3000, 1044006379]);
  assert.equal(candidates[0].browserLabel, "Mac OS/Chrome");
  assert.deepEqual(candidates[1].version, [2, 3000, 1044006379]);
  assert.equal(candidates[1].browserLabel, "Windows/Chrome");
});

test("usa la versión Web obtenida en vivo antes de solicitar el QR", async () => {
  const fake = makeFakeBaileys({
    latestWaVersion: [2, 3000, 1044006379]
  });
  const service = makeService(fake);
  await service.initialize();

  assert.deepEqual(
    fake.sockets[0].config.version,
    [2, 3000, 1044006379]
  );
  assert.match(service.getStatus().webVersion, /2\.3000\.1044006379/);
  await service.shutdown();
});

test("usa una revisión reciente de respaldo si la consulta en vivo falla", async () => {
  const fake = makeFakeBaileys({
    latestWaVersionError: new Error("consulta bloqueada")
  });
  const service = makeService(fake);
  await service.initialize();

  assert.deepEqual(
    fake.sockets[0].config.version,
    [2, 3000, 1044006379]
  );
  assert.ok(
    service.store.logs.some((item) =>
      item.message.includes("respaldo compatible")
    )
  );
  await service.shutdown();
});

test("identifica únicamente el volcado sensible Closing session", () => {
  assert.equal(
    isSensitiveSignalSessionDump(["Closing session:", { privateKey: "oculta" }]),
    true
  );
  assert.equal(
    isSensitiveSignalSessionDump(["WhatsApp conectado", { phone: "51999" }]),
    false
  );
});

test("el QR aceptado termina en estado conectado", async () => {
  const fake = makeFakeBaileys();
  const service = makeService(fake);
  await service.initialize();
  const socket = fake.sockets[0];

  socket.ev.emit("connection.update", {
    connection: "connecting",
    qr: "codigo-qr"
  });
  await flush();
  assert.equal(service.getStatus().state, "qr");
  assert.match(service.getStatus().qrDataUrl, /codigo-qr/);

  fake.state.creds.registered = true;
  socket.ev.emit("creds.update", { registered: true });
  await flush();
  assert.equal(service.getStatus().state, "authenticated");
  assert.equal(service.getStatus().qrDataUrl, null);

  socket.ev.emit("connection.update", { connection: "open" });
  await flush();
  assert.equal(service.getStatus().state, "ready");
  assert.equal(service.getStatus().ready, true);
  assert.equal(service.getStatus().phone, "51999888777");
});

test("el reinicio requerido después del QR abre un socket nuevo y termina conectado", async () => {
  const fake = makeFakeBaileys({ registered: true });
  const service = makeService(fake);
  await service.initialize();
  const firstSocket = fake.sockets[0];
  firstSocket.ev.emit("connection.update", {
    connection: "close",
    lastDisconnect: { error: { output: { statusCode: 515 } } }
  });
  await flush();
  assert.equal(service.getStatus().state, "reconnecting");
  assert.equal(service.getStatus().loadingPercent, 85);
  assert.equal(service.getStatus().error, null);

  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(firstSocket.calls.ended, 1);
  assert.equal(fake.sockets.length, 2);
  const secondSocket = fake.sockets[1];
  secondSocket.ev.emit("connection.update", { connection: "open" });
  await flush();
  assert.equal(service.getStatus().state, "ready");
  assert.equal(service.getStatus().ready, true);
});

test("el error 405 aplica el perfil compatible y conserva la sesión", async () => {
  const fake = makeFakeBaileys({
    registered: true,
    latestWaVersion: [2, 3000, 1044006379]
  });
  const service = makeService(fake, {
    sessionDir: path.join(testRuntimeDir, "error-405-session"),
    mediaDir: path.join(testRuntimeDir, "error-405-media")
  });
  await service.initialize();
  const firstSocket = fake.sockets[0];

  firstSocket.ev.emit("connection.update", {
    connection: "close",
    lastDisconnect: {
      error: {
        message: "Connection Failure",
        output: { statusCode: 405 }
      }
    }
  });
  await flush();

  assert.equal(service.getStatus().state, "reconnecting");
  assert.equal(service.getStatus().waState, "405");
  assert.match(service.getStatus().loadingMessage, /Windows\/Chrome/i);
  assert.match(service.getStatus().error, /sin tocar tus clientes/i);
  assert.equal(fake.state.creds.registered, true);

  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(firstSocket.calls.loggedOut, 0);
  assert.equal(firstSocket.calls.ended, 1);
  assert.equal(fake.sockets.length, 2);
  assert.deepEqual(
    fake.sockets[1].config.version,
    [2, 3000, 1044006379]
  );
  assert.deepEqual(
    fake.sockets[1].config.browser,
    ["Windows", "Chrome", "10.0.22631"]
  );
  await service.shutdown();
});

test("si CONNECTING no entrega QR, cambia de perfil automáticamente", async () => {
  const fake = makeFakeBaileys({
    latestWaVersion: [2, 3000, 1044006379]
  });
  const service = makeService(fake, {
    sessionDir: path.join(testRuntimeDir, "qr-watchdog-session"),
    mediaDir: path.join(testRuntimeDir, "qr-watchdog-media"),
    qrWaitTimeoutMs: 15
  });
  await service.initialize();

  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (fake.sockets.length >= 2) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.ok(fake.sockets.length >= 2);
  assert.deepEqual(
    fake.sockets[1].config.browser,
    ["Windows", "Chrome", "10.0.22631"]
  );
  assert.ok(
    service.store.logs.some((item) =>
      item.message.includes("no entregó el QR")
    )
  );
  await service.shutdown();
});

test("Forzar conexión reabre el socket sin borrar las credenciales", async () => {
  const fake = makeFakeBaileys({ registered: true });
  const service = makeService(fake);
  await service.initialize();
  const firstSocket = fake.sockets[0];
  const result = await service.forceReadyProbe();

  assert.equal(result.restarted, true);
  assert.equal(firstSocket.calls.ended, 1);
  assert.equal(firstSocket.calls.loggedOut, 0);
  assert.equal(fake.sockets.length, 2);
  assert.equal(fake.state.creds.registered, true);
});

test("Cerrar sesión no se bloquea si logout no responde y genera un QR nuevo", async () => {
  const dataDir = path.join(testRuntimeDir, "reset-hanging-data");
  const sessionDir = path.join(dataDir, "whatsapp-session");
  const databasePath = path.join(dataDir, "jadrixservs-v4.json");
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(databasePath, '{"clientes":["conservar"]}');
  fs.writeFileSync(
    path.join(sessionDir, "creds.json"),
    JSON.stringify({ registered: true })
  );
  const fake = makeFakeBaileys({
    registered: true,
    logoutNeverResolves: true,
    freshAuthAfterFirstLoad: true
  });
  const service = makeService(fake, {
    sessionDir,
    mediaDir: path.join(testRuntimeDir, "reset-hanging-media"),
    logoutTimeoutMs: 20
  });
  await service.initialize();
  const firstSocket = fake.sockets[0];

  const result = await service.resetSession();

  assert.equal(result.reset, true);
  assert.equal(result.remoteLogoutCompleted, false);
  assert.equal(firstSocket.calls.loggedOut, 1);
  assert.equal(firstSocket.calls.ended, 1);
  assert.deepEqual(fs.readdirSync(sessionDir), []);
  assert.equal(
    fs.readFileSync(databasePath, "utf8"),
    '{"clientes":["conservar"]}'
  );
  assert.equal(fake.sockets.length, 2);

  fake.sockets[1].ev.emit("connection.update", {
    connection: "connecting",
    qr: "qr-despues-del-cierre"
  });
  await flush();

  assert.equal(service.getStatus().state, "qr");
  assert.match(service.getStatus().qrDataUrl, /qr-despues-del-cierre/);
  await service.shutdown();
});

test("la recuperación de una sesión vinculada continúa después de dos intentos", async () => {
  const fake = makeFakeBaileys({ registered: true });
  const service = makeService(fake, {
    sessionDir: path.join(testRuntimeDir, "unlimited-recovery-session"),
    mediaDir: path.join(testRuntimeDir, "unlimited-recovery-media"),
    readyTimeoutMs: 15
  });
  await service.initialize();

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (service.getStatus().recoveryAttempts >= 3) break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.ok(service.getStatus().recoveryAttempts >= 3);
  assert.ok(fake.sockets.length >= 4);
  assert.notEqual(service.getStatus().state, "stalled");
  await service.shutdown();
});

test("descarta sincronizaciones solicitadas y no las trata como mensajes nuevos", async () => {
  const fake = makeFakeBaileys({ registered: true });
  const service = makeService(fake);
  await service.initialize();
  const socket = fake.sockets[0];
  socket.ev.emit("messages.upsert", {
    type: "notify",
    requestId: "history-request",
    messages: [
      {
        key: { remoteJid: "51999888777@s.whatsapp.net", fromMe: false },
        message: { conversation: "Mensaje inyectado" }
      }
    ]
  });
  await flush();

  assert.equal(socket.calls.read.length, 0);
  assert.equal(socket.calls.sent.length, 0);
  assert.ok(service.store.logs.some((item) => item.type === "security"));
});

test("un mensaje entrante real envía la bienvenida una sola vez en tres mensajes", async () => {
  const fake = makeFakeBaileys({ registered: true });
  const service = makeService(fake, {
    sessionDir: path.join(testRuntimeDir, "incoming-session"),
    mediaDir: path.join(testRuntimeDir, "incoming-media")
  });
  await service.initialize();
  const socket = fake.sockets[0];
  socket.ev.emit("connection.update", { connection: "open" });
  await flush();

  const key = {
    remoteJid: "100000000000@lid",
    remoteJidAlt: "51911112222@s.whatsapp.net",
    fromMe: false
  };
  socket.ev.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key,
        pushName: "Ana",
        message: { conversation: "Hola, vi su anuncio" }
      }
    ]
  });
  socket.ev.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: {
          remoteJid: key.remoteJidAlt,
          remoteJidAlt: key.remoteJid,
          fromMe: false
        },
        pushName: "Ana",
        message: { conversation: "¿Qué incluye?" }
      }
    ]
  });
  await settleMessageQueue(service);

  assert.deepEqual(
    socket.calls.sent.map((item) => item.content.text),
    ["Catálogo", "Planes", "Ayuda"]
  );
  assert.equal(
    socket.calls.presence.filter((item) => item.type === "composing").length,
    3
  );
  assert.equal(socket.calls.read.length, 1);
  assert.equal(socket.calls.sent.length, 3);
});

test("la respuesta de un cliente registrado queda sin leer y no activa la bienvenida", async () => {
  const fake = makeFakeBaileys({ registered: true });
  const store = makeStore();
  let identifiers = [];
  store.findClientByWhatsApp = (...values) => {
    identifiers = values;
    return { id: "cliente-1" };
  };
  const service = makeService(fake, {
    store,
    sessionDir: path.join(testRuntimeDir, "registered-session"),
    mediaDir: path.join(testRuntimeDir, "registered-media")
  });
  await service.initialize();
  const socket = fake.sockets[0];
  socket.ev.emit("connection.update", { connection: "open" });
  await flush();

  socket.ev.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: {
          remoteJid: "200000000000@lid",
          remoteJidAlt: "51933334444@s.whatsapp.net",
          fromMe: false
        },
        message: { conversation: "Sí, voy a renovar" }
      }
    ]
  });
  await settleMessageQueue(service);

  assert.deepEqual(identifiers, [
    "200000000000@lid",
    "51933334444@s.whatsapp.net"
  ]);
  assert.equal(socket.calls.read.length, 0);
  assert.equal(socket.calls.sent.length, 0);
  assert.equal(
    store.data.conversations["200000000000@lid"].registeredClientId,
    "cliente-1"
  );
});

test("un comando enviado por el propietario registra el número alternativo sin responder al chat", async () => {
  const fake = makeFakeBaileys({ registered: true });
  const store = makeStore();
  const registrations = [];
  store.registerClientFromCommand = (payload) => {
    registrations.push(payload);
    return {
      client: { id: "cliente-plan-pro" },
      created: true,
      duplicate: false
    };
  };
  const service = makeService(fake, {
    store,
    sessionDir: path.join(testRuntimeDir, "owner-command-session"),
    mediaDir: path.join(testRuntimeDir, "owner-command-media")
  });
  await service.initialize();
  const socket = fake.sockets[0];

  socket.ev.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: {
          id: "owner-command-1",
          remoteJid: "300000000000@lid",
          remoteJidAlt: "51955556666@s.whatsapp.net",
          fromMe: true
        },
        message: { conversation: "/planpro 30" }
      }
    ]
  });
  await settleMessageQueue(service);

  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].whatsapp, "51955556666");
  assert.equal(registrations[0].item.name, "Plan Pro");
  assert.equal(registrations[0].days, 30);
  assert.equal(registrations[0].command, "/planpro");
  assert.equal(registrations[0].commandMessageId, "owner-command-1");
  assert.equal(socket.calls.sent.length, 0);
  assert.equal(socket.calls.read.length, 0);
});

test("una respuesta rápida envía todas las imágenes y luego los textos una sola vez", async () => {
  const fake = makeFakeBaileys({ registered: true });
  const store = makeStore();
  const mediaDirectory = path.join(testRuntimeDir, "quick-reply-media");
  fs.mkdirSync(mediaDirectory, { recursive: true });
  const firstImage = path.join(mediaDirectory, "primera.png");
  const secondImage = path.join(mediaDirectory, "segunda.jpg");
  fs.writeFileSync(firstImage, Buffer.from("primera"));
  fs.writeFileSync(secondImage, Buffer.from("segunda"));
  const reply = {
    id: "respuesta-diferencia",
    name: "Diferencia",
    command: "/diferencia",
    enabled: true,
    images: [
      { id: "imagen-1", path: firstImage },
      { id: "imagen-2", path: secondImage }
    ],
    texts: ["Primer texto", "Segundo texto"]
  };
  store.findQuickReplyByCommand = (value) =>
    String(value).trim().toLowerCase() === reply.command ? reply : null;
  const service = makeService(fake, {
    store,
    sessionDir: path.join(testRuntimeDir, "quick-reply-session"),
    mediaDir: mediaDirectory
  });
  await service.initialize();
  const socket = fake.sockets[0];
  socket.ev.emit("connection.update", { connection: "open" });
  await flush();

  const event = {
    type: "notify",
    messages: [
      {
        key: {
          id: "quick-reply-command-1",
          remoteJid: "51955556666@s.whatsapp.net",
          fromMe: true
        },
        message: { conversation: "/DIFERENCIA" }
      }
    ]
  };
  socket.ev.emit("messages.upsert", event);
  await settleMessageQueue(service);

  assert.deepEqual(
    socket.calls.sent.map((entry) => Object.keys(entry.content)[0]),
    ["image", "image", "text", "text"]
  );
  assert.equal(socket.calls.sent[2].content.text, "Primer texto");
  assert.equal(socket.calls.sent[3].content.text, "Segundo texto");
  assert.equal(store.isCommandMessageProcessed("quick-reply-command-1"), true);
  assert.ok(
    store.logs.some(
      (entry) =>
        entry.type === "quick-reply" &&
        entry.message.includes("Respuesta rápida enviada")
    )
  );

  socket.ev.emit("messages.upsert", event);
  await settleMessageQueue(service);
  assert.equal(socket.calls.sent.length, 4);
});

test("un cliente no puede ejecutar una respuesta rápida privada", async () => {
  const fake = makeFakeBaileys({ registered: true });
  const store = makeStore();
  let quickReplyLookups = 0;
  store.findQuickReplyByCommand = () => {
    quickReplyLookups += 1;
    return {
      id: "privada",
      command: "/diferencia",
      enabled: true,
      images: [{ path: "no-debe-enviarse.png" }],
      texts: ["No debe enviarse"]
    };
  };
  store.findClientByWhatsApp = () => ({ id: "cliente-registrado" });
  const service = makeService(fake, {
    store,
    sessionDir: path.join(testRuntimeDir, "client-quick-reply-session"),
    mediaDir: path.join(testRuntimeDir, "client-quick-reply-media")
  });
  await service.initialize();
  const socket = fake.sockets[0];
  socket.ev.emit("connection.update", { connection: "open" });
  await flush();

  socket.ev.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: {
          id: "client-quick-reply-command",
          remoteJid: "51933334444@s.whatsapp.net",
          fromMe: false
        },
        message: { conversation: "/diferencia" }
      }
    ]
  });
  await settleMessageQueue(service);

  assert.equal(quickReplyLookups, 0);
  assert.equal(socket.calls.sent.length, 0);
  assert.equal(store.isCommandMessageProcessed("client-quick-reply-command"), false);
});

test("el propietario envía un código 2FA con su comando y vigencia segura", async () => {
  const fake = makeFakeBaileys({ registered: true });
  const store = makeStore();
  const account = {
    id: "auth-gpt01",
    name: "GPT01",
    service: "ChatGPT Plus",
    email: "privado@correo.test",
    command: "/gpt01"
  };
  let requests = 0;
  const requestedWindows = [];
  const authenticator = {
    findAccountByCommand: (command) =>
      String(command).toLowerCase() === "/gpt01" ? account : null,
    getFreshCodeByCommand: async (_command, options) => {
      requests += 1;
      requestedWindows.push(options);
      return {
        ...account,
        code: "177525",
        secondsRemaining: 26,
        waitedMilliseconds: 0
      };
    }
  };
  const service = makeService(fake, {
    store,
    authenticator,
    sessionDir: path.join(testRuntimeDir, "owner-2fa-session"),
    mediaDir: path.join(testRuntimeDir, "owner-2fa-media")
  });
  await service.initialize();
  const socket = fake.sockets[0];
  socket.ev.emit("connection.update", { connection: "open" });
  await flush();

  socket.ev.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: {
          id: "owner-2fa-1",
          remoteJid: "51955556666@s.whatsapp.net",
          fromMe: true
        },
        message: { conversation: "/GPT01" }
      }
    ]
  });
  await settleMessageQueue(service);

  assert.equal(requests, 2);
  assert.ok(
    requestedWindows.every(
      (window) =>
        window.minimumSeconds === 20 &&
        window.maximumSeconds === 30 &&
        window.safetyMilliseconds === 2000
    )
  );
  assert.equal(socket.calls.sent.length, 1);
  assert.match(socket.calls.sent[0].content.text, /177525/);
  assert.match(socket.calls.sent[0].content.text, /26 segundos/);
  assert.doesNotMatch(socket.calls.sent[0].content.text, /privado@correo/);
  assert.deepEqual(
    socket.calls.presence.map((item) => item.type),
    ["unavailable", "composing", "paused"]
  );
  assert.equal(store.isCommandMessageProcessed("owner-2fa-1"), true);
  assert.doesNotMatch(JSON.stringify(store.logs), /177525/);
});

test("un evento repetido no vuelve a enviar el mismo código 2FA", async () => {
  const fake = makeFakeBaileys({ registered: true });
  const store = makeStore();
  const account = {
    id: "auth-gpt01",
    name: "GPT01",
    service: "ChatGPT Plus",
    command: "/gpt01"
  };
  const authenticator = {
    findAccountByCommand: () => account,
    getFreshCodeByCommand: async () => ({
      ...account,
      code: "794522",
      secondsRemaining: 25,
      waitedMilliseconds: 0
    })
  };
  const service = makeService(fake, {
    store,
    authenticator,
    sessionDir: path.join(testRuntimeDir, "duplicate-2fa-session"),
    mediaDir: path.join(testRuntimeDir, "duplicate-2fa-media")
  });
  await service.initialize();
  const socket = fake.sockets[0];
  socket.ev.emit("connection.update", { connection: "open" });
  await flush();
  const message = {
    key: {
      id: "owner-2fa-repeated",
      remoteJid: "51955556666@s.whatsapp.net",
      fromMe: true
    },
    message: { conversation: "/gpt01" }
  };

  socket.ev.emit("messages.upsert", {
    type: "notify",
    messages: [message]
  });
  await settleMessageQueue(service);
  socket.ev.emit("messages.upsert", {
    type: "notify",
    messages: [message]
  });
  await settleMessageQueue(service);

  assert.equal(socket.calls.sent.length, 1);
  assert.match(
    store.logs.at(-1).message,
    /duplicado ignorado/i
  );
});

test("un cliente no puede solicitar un código 2FA con el comando privado", async () => {
  const fake = makeFakeBaileys({ registered: true });
  const store = makeStore();
  let requestedCodes = 0;
  const authenticator = {
    findAccountByCommand: () => ({
      id: "auth-gpt01",
      command: "/gpt01"
    }),
    getFreshCodeByCommand: async () => {
      requestedCodes += 1;
      return null;
    }
  };
  const service = makeService(fake, {
    store,
    authenticator,
    sessionDir: path.join(testRuntimeDir, "customer-2fa-session"),
    mediaDir: path.join(testRuntimeDir, "customer-2fa-media")
  });
  await service.initialize();
  const socket = fake.sockets[0];
  socket.ev.emit("connection.update", { connection: "open" });
  await flush();

  socket.ev.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: {
          id: "customer-2fa-1",
          remoteJid: "51977778888@s.whatsapp.net",
          fromMe: false
        },
        message: { conversation: "/gpt01" }
      }
    ]
  });
  await settleMessageQueue(service);

  assert.equal(requestedCodes, 0);
  assert.deepEqual(
    socket.calls.sent.map((item) => item.content.text),
    ["Catálogo", "Planes", "Ayuda"]
  );
});

test("un cliente no puede registrarse a sí mismo con un comando", async () => {
  const fake = makeFakeBaileys({ registered: true });
  const store = makeStore();
  let registrations = 0;
  store.registerClientFromCommand = () => {
    registrations += 1;
    return {
      client: { id: "no-debe-crearse" },
      created: true,
      duplicate: false
    };
  };
  const service = makeService(fake, {
    store,
    sessionDir: path.join(testRuntimeDir, "customer-command-session"),
    mediaDir: path.join(testRuntimeDir, "customer-command-media")
  });
  await service.initialize();
  const socket = fake.sockets[0];
  socket.ev.emit("connection.update", { connection: "open" });
  await flush();

  socket.ev.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: {
          id: "customer-command-1",
          remoteJid: "51977778888@s.whatsapp.net",
          fromMe: false
        },
        message: { conversation: "/planpro 3650" }
      }
    ]
  });
  await settleMessageQueue(service);

  assert.equal(registrations, 0);
  assert.deepEqual(
    socket.calls.sent.map((item) => item.content.text),
    ["Catálogo", "Planes", "Ayuda"]
  );
});

test("resuelve el número desde el mapa LID si WhatsApp no entrega remoteJidAlt", async () => {
  const fake = makeFakeBaileys({
    registered: true,
    lidPhone: "51944445555@s.whatsapp.net"
  });
  const store = makeStore();
  let registration;
  store.registerClientFromCommand = (payload) => {
    registration = payload;
    return {
      client: { id: "cliente-hbo" },
      created: true,
      duplicate: false
    };
  };
  const service = makeService(fake, {
    store,
    sessionDir: path.join(testRuntimeDir, "lid-command-session"),
    mediaDir: path.join(testRuntimeDir, "lid-command-media")
  });
  await service.initialize();
  const socket = fake.sockets[0];

  socket.ev.emit("messages.upsert", {
    type: "notify",
    messages: [
      {
        key: {
          id: "owner-command-lid",
          remoteJid: "400000000000@lid",
          fromMe: true
        },
        message: { conversation: "/hbo 30" }
      }
    ]
  });
  await settleMessageQueue(service);

  assert.equal(registration.whatsapp, "51944445555");
  assert.equal(registration.item.name, "HBO");
});

test("envía escribiendo, pausa y luego un solo mensaje", async () => {
  const fake = makeFakeBaileys({ registered: true });
  const service = makeService(fake);
  await service.initialize();
  const socket = fake.sockets[0];
  socket.ev.emit("connection.update", { connection: "open" });
  await flush();

  await service.sendText("999888777", "Respuesta breve.");
  assert.deepEqual(
    socket.calls.presence.map((item) => item.type),
    ["unavailable", "composing", "paused"]
  );
  assert.equal(socket.calls.sent.length, 1);
  assert.deepEqual(socket.calls.sent[0].content, { text: "Respuesta breve." });
});

test("tres respuestas consecutivas simulan escritura y se envían por separado", async () => {
  const fake = makeFakeBaileys({ registered: true });
  const service = makeService(fake, {
    sessionDir: path.join(testRuntimeDir, "sequence-session"),
    mediaDir: path.join(testRuntimeDir, "sequence-media")
  });
  await service.initialize();
  const socket = fake.sockets[0];
  socket.ev.emit("connection.update", { connection: "open" });
  await flush();

  await service.sendText("999888777", "Mensaje 1");
  await service.sendText("999888777", "Mensaje 2");
  await service.sendText("999888777", "Mensaje 3");

  assert.deepEqual(
    socket.calls.sent.map((item) => item.content.text),
    ["Mensaje 1", "Mensaje 2", "Mensaje 3"]
  );
  assert.equal(
    socket.calls.presence.filter((item) => item.type === "composing").length,
    3
  );
  assert.equal(
    socket.calls.presence.filter((item) => item.type === "paused").length,
    3
  );
});
