"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { AiService, buildKnowledge, compactAnswer } = require("../src/ai-service");
const { createInitialData } = require("../src/defaults");

function makeStore() {
  const data = createInitialData();
  return {
    snapshot: () => structuredClone(data)
  };
}

test("el conocimiento de IA contiene precios y reglas entrenadas", () => {
  const knowledge = buildKnowledge(createInitialData());
  assert.match(knowledge, /Claude Pro: precio S\/25/);
  assert.match(knowledge, /Binance ID/);
  assert.match(knowledge, /no pierde días/i);
  assert.match(knowledge, /no solicites contraseñas/i);
});

test("la IA usa Responses API, no guarda la respuesta y limita la salida", async () => {
  let request = null;
  const fakeClient = {
    responses: {
      create: async (payload) => {
        request = payload;
        return { output_text: "Respuesta corta y confirmada." };
      }
    }
  };
  const ai = new AiService({
    store: makeStore(),
    client: fakeClient,
    model: "gpt-test"
  });
  const answer = await ai.answer({
    question: "¿Tienen soporte?",
    conversation: { recentUserMessages: ["Hola", "¿Tienen soporte?"] }
  });
  assert.equal(answer, "Respuesta corta y confirmada.");
  assert.equal(request.model, "gpt-test");
  assert.equal(request.store, false);
  assert.match(request.instructions, /Responde únicamente la pregunta actual/);
  assert.doesNotMatch(
    request.input[0].content[0].text,
    /Preguntas anteriores del mismo cliente:.*Tienen soporte/
  );
});

test("compacta respuestas demasiado extensas", () => {
  const answer = compactAnswer(`${"Una frase útil. ".repeat(100)}`, 120);
  assert.ok(answer.length <= 121);
  assert.match(answer, /…$/);
});
