"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { BotEngine, normalizeText } = require("../src/bot-engine");
const { createInitialData } = require("../src/defaults");

function makeHarness(conversation = { greetedAt: new Date().toISOString() }) {
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
    sendText: async (_chatId, text) => sent.push({ type: "text", text }),
    sendMedia: async (_chatId, filePath) => sent.push({ type: "media", filePath })
  });
  return { engine, sent, conversation };
}

test("normaliza acentos y signos", () => {
  assert.equal(normalizeText("¡RENOVACIÓN, por favor!"), "renovacion por favor");
});

test("responde con todos los detalles de ChatGPT Pro", async () => {
  const { engine, sent } = makeHarness();
  const result = await engine.handleIncoming({ chatId: "51900000000@c.us", body: "Quiero ChatGPT Pro" });
  assert.equal(result.action, "product");
  assert.match(sent[0].text, /S\/45/);
  assert.match(sent[0].text, /DICloak/);
  assert.match(sent[0].text, /celular/);
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
