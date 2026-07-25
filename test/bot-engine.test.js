"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BotEngine, normalizeText } = require("../src/bot-engine");
const { createInitialData } = require("../src/defaults");

function makeHarness(conversation = {}, ai = null) {
  const data = createInitialData();
  const sent = [];
  const store = {
    data,
    getConversation: () => ({ ...conversation }),
    updateConversation: (_chatId, patch) => Object.assign(conversation, patch),
    getSettings: () => structuredClone(data.settings),
    getKnowledgeBase: () => structuredClone(data.knowledgeBase),
    getMedia: (kind) => data.media[kind],
    addLog: () => undefined,
    save: () => undefined
  };
  const engine = new BotEngine({
    store,
    ai,
    sendText: async (_chatId, text) => sent.push({ type: "text", text }),
    sendMedia: async (_chatId, filePath) => sent.push({ type: "media", filePath }),
    beginTyping: async () => {
      sent.push({ type: "typing" });
      return async () => sent.push({ type: "typing-stop" });
    }
  });
  return { engine, sent, conversation };
}

test("normaliza acentos y signos", () => {
  assert.equal(normalizeText("¡RENOVACIÓN, por favor!"), "renovacion por favor");
});

test("un saludo recibe una sola respuesta corta, sin catálogo", async () => {
  const { engine, sent } = makeHarness();
  const result = await engine.handleIncoming({
    chatId: "51900000000@c.us",
    body: "Hola"
  });
  assert.equal(result.action, "greeting");
  assert.equal(sent.length, 1);
  assert.doesNotMatch(sent[0].text, /Claude Pro/);
  assert.doesNotMatch(sent[0].text, /Plan Pro/);
});

test("la consulta del Super Combo IA 2026 envía exactamente los tres mensajes separados", async () => {
  const { engine, sent } = makeHarness();
  const result = await engine.handleIncoming({
    chatId: "51900000000@c.us",
    body: "¿Cuál es el precio del Super Combo IA 2026?"
  });
  const texts = sent.filter((item) => item.type === "text");
  assert.equal(result.action, "welcome-sequence");
  assert.equal(result.messages, 3);
  assert.equal(texts.length, 3);
  assert.ok(texts[0].text.startsWith("🚀 JADRIXSERVS 🚀"));
  assert.ok(texts[1].text.startsWith("💼 COMBOS ESPECIALES - Todo en 1"));
  assert.ok(texts[2].text.startsWith("✅ `Entrega inmediata`"));
  assert.ok(texts[2].text.endsWith("JadrixServs 💪"));
});

test("responde con todos los detalles de ChatGPT Pro", async () => {
  const { engine, sent } = makeHarness();
  const result = await engine.handleIncoming({ chatId: "51900000000@c.us", body: "Quiero ChatGPT Pro" });
  assert.equal(result.action, "product");
  assert.match(sent[0].text, /S\/45/);
  assert.match(sent[0].text, /DICloak/);
  assert.match(sent[0].text, /celular/);
});

test("si preguntan solo el precio, responde solo precio y duración", async () => {
  const { engine, sent } = makeHarness();
  await engine.handleIncoming({
    chatId: "51900000000@c.us",
    body: "¿Cuánto cuesta Claude Pro?"
  });
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /S\/25/);
  assert.doesNotMatch(sent[0].text, /otros usuarios/i);
  assert.doesNotMatch(sent[0].text, /pagar/i);
});

test("distingue ChatGPT Plus Personal de ChatGPT Plus", async () => {
  const { engine, sent } = makeHarness();
  const result = await engine.handleIncoming({
    chatId: "51900000000@c.us",
    body: "Quiero ChatGPT Plus Personal"
  });
  assert.equal(result.id, "chatgpt-plus-personal");
  assert.match(sent[0].text, /S\/30/);
});

test("explica que la renovación anticipada no pierde días", async () => {
  const { engine, sent } = makeHarness();
  const result = await engine.handleIncoming({ chatId: "51900000000@c.us", body: "¿Puedo renovar antes?" });
  assert.equal(result.action, "trained");
  assert.match(sent[0].text, /sin perder días/i);
  assert.match(sent[0].text, /fecha de vencimiento actual/i);
});

test("usa el entrenamiento local sin llamar a OpenAI", async () => {
  let aiCalls = 0;
  const fakeAi = {
    getStatus: () => ({ enabled: true, model: "test" }),
    answer: async () => {
      aiCalls += 1;
      return "No debería usarse.";
    }
  };
  const { engine, sent } = makeHarness({}, fakeAi);
  const result = await engine.handleIncoming({
    chatId: "51900000000@c.us",
    body: "¿Cuál es mejor ChatGPT o Gemini?"
  });
  assert.equal(result.action, "trained");
  assert.equal(aiCalls, 0);
  assert.equal(sent.filter((item) => item.type === "text").length, 1);
  assert.match(sent[0].text, /uso general te recomiendo ChatGPT/i);
});

test("una pregunta por combo personalizado recibe solo la respuesta entrenada", async () => {
  const { engine, sent } = makeHarness();
  const result = await engine.handleIncoming({
    chatId: "51900000000@c.us",
    body: "¿Puedo armar mi combo personalizado?"
  });
  assert.equal(result.action, "trained");
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /indícame qué servicios/i);
  assert.doesNotMatch(sent[0].text, /Plan Pro/i);
});

test("recuerda el producto para responder una pregunta corta de seguimiento", async () => {
  const conversation = {};
  const { engine, sent } = makeHarness(conversation);
  await engine.handleIncoming({
    chatId: "51900000000@c.us",
    body: "Quiero Claude Pro"
  });
  const result = await engine.handleIncoming({
    chatId: "51900000000@c.us",
    body: "¿Funciona en celular?"
  });
  assert.equal(result.action, "product-followup");
  assert.equal(result.id, "claude-pro");
  assert.match(sent.at(-1).text, /celular.*laptop/i);
});

test("al pedir asesor pausa las respuestas automáticas", async () => {
  const { engine, conversation } = makeHarness();
  const result = await engine.handleIncoming({ chatId: "51900000000@c.us", body: "Quiero un asesor" });
  assert.equal(result.action, "human");
  assert.equal(conversation.paused, true);
});

test("al preguntar cómo pagar, primero pregunta el país y no envía ambos bloques", async () => {
  const { engine, sent } = makeHarness();
  const result = await engine.handleIncoming({
    chatId: "51900000000@c.us",
    body: "¿Cómo puedo pagar?"
  });
  assert.equal(result.action, "payment-country");
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Perú o desde otro país/);
  assert.doesNotMatch(sent[0].text, /921/);
  assert.doesNotMatch(sent[0].text, /1205380212/);
});

test("si responde Perú tras la pregunta de pago, envía solo el método local", async () => {
  const { engine, sent } = makeHarness({ paymentCountryRequested: true });
  const result = await engine.handleIncoming({
    chatId: "51900000000@c.us",
    body: "Perú"
  });
  assert.equal(result.action, "peru-payment");
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /Yape/);
  assert.doesNotMatch(sent[0].text, /Binance/i);
});

test("al pedir precios envía únicamente el catálogo solicitado", async () => {
  const { engine, sent } = makeHarness();
  const result = await engine.handleIncoming({
    chatId: "51900000000@c.us",
    body: "Precios"
  });
  assert.equal(result.action, "catalog");
  assert.equal(sent.length, 1);
  assert.match(sent[0].text, /ChatGPT Pro/);
});

test("usa OpenAI solo como respaldo para una pregunta no prevista", async () => {
  const fakeAi = {
    getStatus: () => ({ enabled: true, model: "test" }),
    answer: async () => "La respuesta breve basada en el entrenamiento."
  };
  const { engine, sent } = makeHarness({}, fakeAi);
  const result = await engine.handleIncoming({
    chatId: "51900000000@c.us",
    body: "¿Puedo usarlo durante un viaje?"
  });
  assert.equal(result.action, "ai");
  assert.equal(sent.filter((item) => item.type === "text").length, 1);
  assert.match(sent.find((item) => item.type === "text").text, /respuesta breve/);
  assert.equal(sent[0].type, "typing");
});

test("si OpenAI no tiene saldo, responde con el fallback local y no expone el error 429", async () => {
  const fakeAi = {
    getStatus: () => ({ enabled: true, model: "test" }),
    answer: async () => {
      const error = new Error("La cuenta de API no tiene saldo.");
      error.code = "quota";
      throw error;
    }
  };
  const { engine, sent } = makeHarness({}, fakeAi);
  const result = await engine.handleIncoming({
    chatId: "51900000000@c.us",
    body: "¿Tienen una promoción para estudiantes?"
  });
  assert.equal(result.action, "fallback");
  const reply = sent.filter((item) => item.type === "text").at(-1).text;
  assert.doesNotMatch(reply, /429|quota|billing/i);
  assert.match(reply, /asesor de JadrixServs/i);
});
