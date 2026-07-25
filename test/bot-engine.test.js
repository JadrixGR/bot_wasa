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
  assert.equal(result.action, "renewal");
  assert.match(sent[0].text, /vence el 26 y pagas el 23/);
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
