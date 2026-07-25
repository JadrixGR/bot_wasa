"use strict";

const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  WhatsAppService,
  calculateHumanDelay,
  extractMessageBody,
  getDisconnectStatusCode,
  normalizeWhatsAppId
} = require("../src/whatsapp-service");

const testRuntimeDir = path.resolve("test-runtime");

test.after(() => {
  fs.rmSync(testRuntimeDir, { recursive: true, force: true });
});

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeStore() {
  const logs = [];
  return {
    logs,
    data: { conversations: {} },
    addLog: (type, message, details) => logs.push({ type, message, details }),
    save: () => undefined,
    getConversation: () => ({}),
    updateConversation: (_chatId, patch) => patch,
    getSettings: () => ({
      shortGreeting: "Hola",
      greetingMessages: ["Catálogo", "Planes", "Ayuda"],
      fallbackReply: "No tengo ese dato."
    }),
    getMedia: () => null
  };
}

function makeFakeBaileys({ registered = false } = {}) {
  const sockets = [];
  const state = { creds: { registered }, keys: {} };

  function makeWASocket() {
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
      user: { id: "51999888777:12@s.whatsapp.net", name: "Jadrix" },
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
      }
    };
    sockets.push(socket);
    return socket;
  }

  return {
    module: {
      default: makeWASocket,
      Browsers: { ubuntu: (name) => ["Ubuntu", name, "1.0"] },
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
      useMultiFileAuthState: async () => ({
        state,
        saveCreds: async () => undefined
      }),
      jidNormalizedUser: (jid) => jid.replace(/:\d+@/, "@"),
      getContentType: (content) => Object.keys(content || {})[0]
    },
    sockets,
    state
  };
}

function makeService(fake, options = {}) {
  return new WhatsAppService({
    store: makeStore(),
    sessionDir:
      options.sessionDir || path.join(testRuntimeDir, "whatsapp-session"),
    mediaDir: options.mediaDir || path.join(testRuntimeDir, "media"),
    ai: null,
    baileysLoader: async () => fake.module,
    qrEncoder: async (value) => `data:image/png;base64,${value}`,
    sleepFn: async () => undefined
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

test("lee el código de desconexión que entrega WhatsApp", () => {
  assert.equal(
    getDisconnectStatusCode({ output: { statusCode: 515 } }),
    515
  );
  assert.equal(getDisconnectStatusCode(new Error("sin código")), null);
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
