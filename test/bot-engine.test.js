"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  BotEngine,
  normalizeText,
  resolveCountryPriceBook,
  resolveWelcomeProfile
} = require("../src/bot-engine");
const { createInitialData } = require("../src/defaults");

function makeHarness(conversation = {}, registeredClient = null, ai = null) {
  const data = createInitialData();
  const sent = [];
  const logs = [];
  const conversations = {
    "51900000000@s.whatsapp.net": conversation
  };
  const store = {
    data,
    getConversation: (chatId) => ({ ...(conversations[chatId] || {}) }),
    updateConversation: (chatId, patch) => {
      conversations[chatId] ||= {};
      return Object.assign(conversations[chatId], patch);
    },
    getSettings: () => structuredClone(data.settings),
    findClientByWhatsApp: () => registeredClient,
    addLog: (type, message, metadata) =>
      logs.push({ type, message, metadata }),
    save: () => undefined
  };
  const engine = new BotEngine({
    store,
    ai,
    sendText: async (_chatId, text) => sent.push(text)
  });
  return { engine, sent, logs, conversation, conversations, data };
}

test("normaliza acentos y signos", () => {
  assert.equal(normalizeText("¡RENOVACIÓN, por favor!"), "renovacion por favor");
});

test("el primer mensaje de cualquier contacto nuevo recibe exactamente la secuencia de tres mensajes", async () => {
  const { engine, sent, conversation } = makeHarness();
  const result = await engine.handleIncoming({
    chatId: "51900000000@s.whatsapp.net",
    body: "Hola, vi su anuncio",
    fromName: "Ana"
  });

  assert.equal(result.action, "welcome-sequence");
  assert.equal(result.messages, 3);
  assert.equal(sent.length, 3);
  assert.ok(sent[0].startsWith("🚀 JADRIXSERVS 🚀"));
  assert.ok(sent[1].startsWith("💼 COMBOS ESPECIALES - Todo en 1"));
  assert.ok(sent[2].startsWith("✅ `Entrega inmediata`"));
  assert.equal(conversation.welcomeMessagesSent, 3);
  assert.ok(conversation.welcomeSequenceSentAt);
});

test("después de la bienvenida no vuelve a responder mensajes entrantes", async () => {
  const conversation = {};
  const { engine, sent } = makeHarness(conversation);

  await engine.handleIncoming({
    chatId: "51900000000@s.whatsapp.net",
    body: "¿Cuál es el precio del Super Combo IA 2026?"
  });
  const second = await engine.handleIncoming({
    chatId: "51900000000@s.whatsapp.net",
    body: "Quiero ChatGPT Pro"
  });

  assert.equal(second.action, "welcome-already-sent");
  assert.equal(sent.length, 3);
});

test("la IA responde desde el segundo mensaje y conserva primero la bienvenida", async () => {
  const calls = [];
  const ai = {
    isReplyEnabled: () => true,
    answer: async (payload) => {
      calls.push(payload);
      return "Claro, ChatGPT Pro está disponible.";
    },
    getStatus: () => ({ provider: "gemini" })
  };
  const { engine, sent, logs } = makeHarness({}, null, ai);

  const first = await engine.handleIncoming({
    chatId: "51900000000@s.whatsapp.net",
    body: "Hola",
    messageId: "mensaje-1"
  });
  const second = await engine.handleIncoming({
    chatId: "51900000000@s.whatsapp.net",
    body: "¿Tienen ChatGPT Pro?",
    messageId: "mensaje-2"
  });

  assert.equal(first.action, "welcome-sequence");
  assert.equal(second.action, "ai-reply");
  assert.equal(sent.length, 4);
  assert.equal(sent.at(-1), "Claro, ChatGPT Pro está disponible.");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].conversation.welcomeCountry, "Perú");
  assert.equal(calls[0].conversation.welcomeCallingCode, "+51");
  assert.ok(logs.some((log) => log.type === "ai"));
});

test("la IA responde a un cliente registrado y detecta su país por el número", async () => {
  let receivedConversation = null;
  const ai = {
    isReplyEnabled: () => true,
    answer: async ({ conversation }) => {
      receivedConversation = conversation;
      return "Te indico el medio de pago para Perú.";
    },
    getStatus: () => ({ provider: "gemini" })
  };
  const client = { id: "cliente-1", name: "Ana", whatsapp: "51900000000" };
  const { engine, sent } = makeHarness({}, client, ai);
  const result = await engine.handleIncoming({
    chatId: "51900000000@s.whatsapp.net",
    body: "¿Cómo pago?"
  });

  assert.equal(result.action, "ai-reply");
  assert.equal(sent.length, 1);
  assert.equal(receivedConversation.welcomeCountry, "Perú");
  assert.equal(receivedConversation.welcomeCurrency, "PEN (S/)");
  assert.equal(receivedConversation.localCallingCode, "+51");
  assert.equal(receivedConversation.localCurrency, "Soles peruanos (PEN)");
});

test("detecta la tabla de pesos mexicanos y argentinos por prefijo", () => {
  const data = createInitialData();
  const mexico = resolveCountryPriceBook(data, {
    chatId: "5215512345678@s.whatsapp.net"
  });
  const argentina = resolveCountryPriceBook(data, {
    chatId: "5491112345678@s.whatsapp.net"
  });

  assert.equal(mexico.book.callingCode, "+52");
  assert.equal(mexico.book.prices["chatgpt-pro"], "MX$225");
  assert.equal(argentina.book.callingCode, "+54");
  assert.equal(argentina.book.prices["chatgpt-pro"], "AR$18.000");
});

test("si Gemini falla no envía texto inventado y deja el mensaje para atención manual", async () => {
  const providerError = new Error("Gemini temporalmente no disponible");
  providerError.code = "connection";
  const ai = {
    isReplyEnabled: () => true,
    answer: async () => { throw providerError; },
    getStatus: () => ({ provider: "gemini" })
  };
  const { engine, sent, logs } = makeHarness(
    { welcomeSequenceSentAt: new Date().toISOString(), welcomeMessagesSent: 3 },
    null,
    ai
  );
  const result = await engine.handleIncoming({
    chatId: "51900000000@s.whatsapp.net",
    body: "¿Tienen soporte?"
  });

  assert.equal(result.action, "ai-error");
  assert.equal(result.errorCode, "connection");
  assert.equal(sent.length, 0);
  assert.ok(logs.some((log) => log.type === "ai" && /no respondió/i.test(log.message)));
});

test("un evento repetido no provoca dos respuestas de Gemini", async () => {
  let calls = 0;
  const ai = {
    isReplyEnabled: () => true,
    answer: async () => {
      calls += 1;
      return "Respuesta única.";
    },
    getStatus: () => ({ provider: "gemini" })
  };
  const { engine, sent } = makeHarness(
    { welcomeSequenceSentAt: new Date().toISOString(), welcomeMessagesSent: 3 },
    null,
    ai
  );
  const message = {
    chatId: "51900000000@s.whatsapp.net",
    body: "¿Precio?",
    messageId: "wa-mensaje-repetido"
  };
  const first = await engine.handleIncoming(message);
  const duplicate = await engine.handleIncoming(message);

  assert.equal(first.action, "ai-reply");
  assert.equal(duplicate.action, "duplicate-inbound");
  assert.equal(calls, 1);
  assert.deepEqual(sent, ["Respuesta única."]);
});

test("la bienvenida no se repite si WhatsApp alterna entre LID y número", async () => {
  const { engine, sent, conversations } = makeHarness();
  await engine.handleIncoming({
    chatId: "100000000000@lid",
    alternateChatId: "51900000000@s.whatsapp.net",
    body: "Hola"
  });
  const second = await engine.handleIncoming({
    chatId: "51900000000@s.whatsapp.net",
    alternateChatId: "100000000000@lid",
    body: "¿Siguen disponibles?"
  });

  assert.equal(second.action, "welcome-already-sent");
  assert.equal(sent.length, 3);
  assert.ok(conversations["100000000000@lid"].welcomeSequenceSentAt);
  assert.ok(
    conversations["51900000000@s.whatsapp.net"].welcomeSequenceSentAt
  );
});

test("un cliente registrado no recibe la bienvenida al responder un recordatorio", async () => {
  const client = {
    id: "cliente-1",
    name: "Ana",
    whatsapp: "51900000000"
  };
  const { engine, sent, conversation } = makeHarness({}, client);
  const result = await engine.handleIncoming({
    chatId: "100000000000@lid",
    alternateChatId: "51900000000@s.whatsapp.net",
    body: "Sí, mañana renuevo"
  });

  assert.equal(result.action, "registered-client");
  assert.equal(result.clientId, "cliente-1");
  assert.equal(sent.length, 0);
  assert.equal(conversation.registeredClientId, "cliente-1");
});

test("si la conexión se corta durante la bienvenida, continúa con los mensajes pendientes", async () => {
  const conversation = { welcomeMessagesSent: 1 };
  const { engine, sent } = makeHarness(conversation);
  const result = await engine.handleIncoming({
    chatId: "51900000000@s.whatsapp.net",
    body: "Hola nuevamente"
  });

  assert.equal(result.action, "welcome-resumed");
  assert.equal(result.messages, 2);
  assert.equal(sent.length, 2);
  assert.ok(sent[0].startsWith("💼 COMBOS ESPECIALES - Todo en 1"));
  assert.ok(sent[1].startsWith("✅ `Entrega inmediata`"));
});

test("un archivo como primer contacto también recibe únicamente los tres mensajes iniciales", async () => {
  const { engine, sent, conversation } = makeHarness();
  const result = await engine.handleIncoming({
    chatId: "51900000000@s.whatsapp.net",
    hasMedia: true,
    body: ""
  });

  assert.equal(result.action, "welcome-sequence");
  assert.equal(sent.length, 3);
  assert.equal(conversation.lastInboundHadMedia, true);
});


test("el modo AFK responde una sola vez por contacto durante cada activación", async () => {
  const { engine, sent, data, conversation } = makeHarness();
  data.settings.afkEnabled = true;
  data.settings.afkMessage = "Estamos fuera del horario de atención.";
  data.settings.afkSessionId = "afk-1";

  const first = await engine.handleIncoming({
    chatId: "51900000000@s.whatsapp.net",
    body: "Hola",
    fromName: "Ana"
  });
  const second = await engine.handleIncoming({
    chatId: "51900000000@s.whatsapp.net",
    body: "¿Me ayudan?",
    fromName: "Ana"
  });

  assert.equal(first.action, "afk-reply");
  assert.equal(second.action, "afk-already-sent");
  assert.deepEqual(sent, ["Estamos fuera del horario de atención."]);
  assert.equal(conversation.lastAfkSessionId, "afk-1");
  assert.equal(conversation.welcomeSequenceSentAt, undefined);
});

test("el modo AFK también informa a un cliente registrado", async () => {
  const client = { id: "cliente-afk", name: "Ana", whatsapp: "51900000000" };
  const { engine, sent, data } = makeHarness({}, client);
  data.settings.afkEnabled = true;
  data.settings.afkMessage = "Volvemos mañana a las 9 AM.";
  data.settings.afkSessionId = "afk-2";

  const result = await engine.handleIncoming({
    chatId: "51900000000@s.whatsapp.net",
    body: "Quiero renovar"
  });

  assert.equal(result.action, "afk-reply");
  assert.equal(result.clientId, "cliente-afk");
  assert.deepEqual(sent, ["Volvemos mañana a las 9 AM."]);
});

test("selecciona la bienvenida de Argentina para un número +54", async () => {
  const { engine, sent, data, conversations } = makeHarness();
  data.settings.countryGreetings.push({
    id: "argentina-54",
    country: "Argentina",
    callingCode: "+54",
    currency: "ARS ($)",
    enabled: true,
    messages: ["ARG catálogo", "ARG combos", "ARG soporte"]
  });

  const result = await engine.handleIncoming({
    chatId: "5491122334455@s.whatsapp.net",
    customerPhone: "5491122334455",
    body: "Hola"
  });

  assert.deepEqual(sent, ["ARG catálogo", "ARG combos", "ARG soporte"]);
  assert.equal(result.country, "Argentina");
  assert.equal(result.callingCode, "+54");
  assert.equal(result.usedFallback, false);
  assert.equal(
    conversations["5491122334455@s.whatsapp.net"].welcomeCountryGreetingId,
    "argentina-54"
  );
});

test("usa el número alternativo cuando WhatsApp entrega un chat LID", async () => {
  const { engine, sent, data, conversations } = makeHarness();
  data.settings.countryGreetings[0].messages = [
    "PER catálogo",
    "PER combos",
    "PER soporte"
  ];

  const result = await engine.handleIncoming({
    chatId: "100000000123@lid",
    alternateChatId: "51987654321@s.whatsapp.net",
    body: "Hola"
  });

  assert.deepEqual(sent, ["PER catálogo", "PER combos", "PER soporte"]);
  assert.equal(result.country, "Perú");
  assert.equal(
    conversations["100000000123@lid"].welcomeCallingCode,
    "+51"
  );
});

test("usa la bienvenida predeterminada si no existe un país coincidente", async () => {
  const { engine, sent, data } = makeHarness();
  data.settings.greetingMessages = [
    "GENERAL catálogo",
    "GENERAL combos",
    "GENERAL soporte"
  ];

  const result = await engine.handleIncoming({
    chatId: "34600111222@s.whatsapp.net",
    customerPhone: "34600111222",
    body: "Hola"
  });

  assert.deepEqual(sent, [
    "GENERAL catálogo",
    "GENERAL combos",
    "GENERAL soporte"
  ]);
  assert.equal(result.country, null);
  assert.equal(result.usedFallback, true);
});

test("prefiere el prefijo internacional más específico", () => {
  const result = resolveWelcomeProfile(
    {
      greetingMessages: ["general 1", "general 2", "general 3"],
      countryGreetings: [
        {
          id: "usa-1",
          country: "Estados Unidos",
          callingCode: "+1",
          enabled: true,
          messages: ["USA 1", "USA 2", "USA 3"]
        },
        {
          id: "do-1809",
          country: "República Dominicana",
          callingCode: "+1809",
          enabled: true,
          messages: ["DO 1", "DO 2", "DO 3"]
        }
      ]
    },
    { customerPhone: "18095550199" }
  );

  assert.equal(result.profile.id, "do-1809");
  assert.deepEqual(result.messages, ["DO 1", "DO 2", "DO 3"]);
});

test("un país desactivado cae en la bienvenida predeterminada", () => {
  const result = resolveWelcomeProfile(
    {
      greetingMessages: ["general 1", "general 2", "general 3"],
      countryGreetings: [
        {
          id: "argentina-54",
          country: "Argentina",
          callingCode: "+54",
          enabled: false,
          messages: ["ARG 1", "ARG 2", "ARG 3"]
        }
      ]
    },
    { customerPhone: "5491122334455" }
  );

  assert.equal(result.profile, null);
  assert.deepEqual(result.messages, ["general 1", "general 2", "general 3"]);
});

test("ignora un identificador LID alternativo si el chat contiene el número real", () => {
  const result = resolveWelcomeProfile(
    {
      greetingMessages: ["general 1", "general 2", "general 3"],
      countryGreetings: [
        {
          id: "peru-51",
          country: "Perú",
          callingCode: "+51",
          enabled: true,
          messages: ["PER 1", "PER 2", "PER 3"]
        }
      ]
    },
    {
      alternateChatId: "100000000000@lid",
      chatId: "51987654321@s.whatsapp.net"
    }
  );

  assert.equal(result.profile.id, "peru-51");
  assert.deepEqual(result.messages, ["PER 1", "PER 2", "PER 3"]);
});

test("al reanudar conserva el país elegido aunque el número coincida con otro", async () => {
  const conversation = {
    welcomeMessagesSent: 1,
    welcomeCountryGreetingId: "argentina-54"
  };
  const { engine, sent, data } = makeHarness(conversation);
  data.settings.countryGreetings.push({
    id: "argentina-54",
    country: "Argentina",
    callingCode: "+54",
    currency: "ARS ($)",
    enabled: true,
    messages: ["ARG 1", "ARG 2", "ARG 3"]
  });

  const result = await engine.handleIncoming({
    chatId: "51900000000@s.whatsapp.net",
    customerPhone: "51900000000",
    body: "Continúa"
  });

  assert.deepEqual(sent, ["ARG 2", "ARG 3"]);
  assert.equal(result.country, "Argentina");
  assert.equal(result.action, "welcome-resumed");
});
