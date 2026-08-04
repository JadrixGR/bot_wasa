"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AiService,
  buildKnowledge,
  compactAnswer,
  classifyOpenAIError,
  classifyGeminiError,
  decryptGeminiApiKey,
  encryptGeminiApiKey
} = require("../src/ai-service");
const { createInitialData } = require("../src/defaults");

function makeStore() {
  const data = createInitialData();
  return {
    data,
    logs: [],
    snapshot: () => structuredClone(data),
    addLog(type, message, metadata) {
      this.logs.push({ type, message, metadata });
    },
    save: () => undefined
  };
}

test("el conocimiento de IA contiene precios y reglas entrenadas", () => {
  const knowledge = buildKnowledge(createInitialData());
  assert.match(knowledge, /Claude Pro: precio S\/25/);
  assert.match(knowledge, /Binance ID/);
  assert.match(knowledge, /no pierde días/i);
  assert.match(knowledge, /no solicites contraseñas/i);
  assert.match(knowledge, /RESPUESTAS ENTRENADAS/);
  assert.match(knowledge, /Elegir entre ChatGPT y Gemini/);
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
  assert.equal(request.max_output_tokens, 300);
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

test("identifica el 429 por cuota como falta de saldo y no como clave inválida", () => {
  const result = classifyOpenAIError({
    status: 429,
    code: "insufficient_quota",
    message: "You exceeded your current quota, please check your plan and billing details."
  });
  assert.equal(result.code, "quota");
  assert.equal(result.status, 429);
  assert.match(result.message, /no tiene saldo|límite de gasto/i);
  assert.match(result.message, /respuestas entrenadas/i);
});

test("la prueba de OpenAI devuelve un diagnóstico amigable cuando falta saldo", async () => {
  const fakeClient = {
    responses: {
      create: async () => {
        const error = new Error(
          "You exceeded your current quota, please check your plan and billing details."
        );
        error.status = 429;
        error.code = "insufficient_quota";
        throw error;
      }
    }
  };
  const ai = new AiService({
    store: makeStore(),
    client: fakeClient,
    model: "gpt-test"
  });

  await assert.rejects(
    ai.testConnection(),
    (error) =>
      error.code === "quota" &&
      error.status === 429 &&
      /Agrega créditos/i.test(error.message)
  );
  assert.equal(ai.getStatus().health, "quota");
  assert.doesNotMatch(ai.getStatus().lastError, /You exceeded/i);
});

test("cifra la API key de Gemini y rechaza una clave de cifrado distinta", () => {
  const secret = "AIzaSyClaveDePruebaLarga123456789";
  const encrypted = encryptGeminiApiKey(secret, "clave-estable-uno");
  assert.doesNotMatch(encrypted, new RegExp(secret));
  assert.equal(decryptGeminiApiKey(encrypted, "clave-estable-uno"), secret);
  assert.throws(
    () => decryptGeminiApiKey(encrypted, "clave-estable-dos"),
    /no puede descifrarse/i
  );
});

test("guarda Gemini cifrado, no devuelve la clave al panel y permite activarlo", () => {
  const store = makeStore();
  const secret = "AIzaSyClaveDePruebaLarga123456789";
  const ai = new AiService({
    store,
    provider: "gemini",
    geminiApiKey: "",
    encryptionKey: "clave-estable"
  });
  const status = ai.configureGemini({
    apiKey: secret,
    model: "gemini-3.6-flash",
    enabled: true
  });

  assert.equal(status.replyEnabled, true);
  assert.equal(status.keySource, "panel_encrypted");
  assert.equal(status.encryptedAtRest, true);
  assert.doesNotMatch(JSON.stringify(status), new RegExp(secret));
  assert.doesNotMatch(store.data.aiConfig.encryptedApiKey, new RegExp(secret));
  assert.equal(store.data.aiConfig.provider, "gemini");
  assert.equal(store.logs.at(-1).type, "ai");
});

test("Gemini recibe la clave solo por cabecera y usa el entrenamiento del negocio", async () => {
  const store = makeStore();
  const secret = "AIzaSyClaveDePruebaLarga123456789";
  let capturedUrl = "";
  let capturedOptions = null;
  const ai = new AiService({
    store,
    provider: "gemini",
    geminiApiKey: "",
    encryptionKey: "clave-estable",
    fetchFn: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          candidates: [{ content: { parts: [{ text: "Puedes pagar con Yape al número confirmado." }] } }]
        })
      };
    }
  });
  ai.configureGemini({ apiKey: secret, enabled: true });

  const answer = await ai.answer({
    question: "¿Cómo puedo pagar?",
    conversation: {
      welcomeCountry: "Perú",
      welcomeCallingCode: "+51",
      welcomeCurrency: "PEN"
    }
  });
  const body = JSON.parse(capturedOptions.body);

  assert.equal(answer, "Puedes pagar con Yape al número confirmado.");
  assert.match(capturedUrl, /gemini-3\.6-flash:generateContent$/);
  assert.doesNotMatch(capturedUrl, new RegExp(secret));
  assert.equal(capturedOptions.headers["x-goog-api-key"], secret);
  assert.doesNotMatch(capturedOptions.body, new RegExp(secret));
  assert.match(body.system_instruction.parts[0].text, /PAGOS CONFIRMADOS/);
  assert.match(body.system_instruction.parts[0].text, /RESPUESTAS ENTRENADAS/);
  assert.match(body.contents[0].parts[0].text, /País detectado del cliente: Perú \(\+51, PEN\)/);
  assert.equal(body.generationConfig.maxOutputTokens, 300);
  assert.equal(body.generationConfig.temperature, undefined);
});

test("clasifica una clave inválida de Gemini sin exponer el mensaje del proveedor", () => {
  const result = classifyGeminiError({
    status: 400,
    code: "API_KEY_INVALID",
    message: "API key not valid. Please pass a valid API key."
  });
  assert.equal(result.code, "invalid_key");
  assert.equal(result.status, 401);
  assert.match(result.message, /clave de Gemini no es válida/i);
  assert.doesNotMatch(result.message, /Please pass/);
});

test("no activa respuestas de Gemini si todavía no existe una API key", () => {
  const ai = new AiService({
    store: makeStore(),
    provider: "gemini",
    geminiApiKey: "",
    encryptionKey: "clave-estable"
  });
  assert.throws(
    () => ai.configureGemini({ enabled: true }),
    /Guarda una API key de Gemini/i
  );
});
