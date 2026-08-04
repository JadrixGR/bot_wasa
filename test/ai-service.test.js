"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AiService,
  buildKnowledge,
  buildSystemInstructions,
  buildUserPrompt,
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
  assert.match(knowledge, /México \(\+52\)/);
  assert.match(knowledge, /ChatGPT Pro: MX\$225/);
  assert.match(knowledge, /Argentina \(\+54\)/);
  assert.match(knowledge, /ChatGPT Pro: AR\$18\.000/);
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
  assert.equal(request.max_output_tokens, 1200);
  assert.match(request.instructions, /Responde únicamente lo solicitado/);
  assert.match(request.instructions, /No dejes frases, listas, precios ni explicaciones incompletas/);
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
  assert.equal(body.generationConfig.maxOutputTokens, 1200);
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

test("elige precios mexicanos exactos para +52 y prioriza la memoria relacionada", () => {
  const snapshot = createInitialData();
  const prompt = buildUserPrompt(
    snapshot,
    "¿Cuánto cuesta ChatGPT Pro y tiene soporte?",
    {
      localCountry: "México",
      localCallingCode: "+52",
      localCurrency: "Pesos mexicanos (MXN)"
    }
  );

  assert.match(prompt, /País detectado del cliente: México \(\+52/);
  assert.match(prompt, /ChatGPT Pro: MX\$225/);
  assert.match(prompt, /Plan Pro: MX\$300/);
  assert.doesNotMatch(prompt, /ChatGPT Pro: S\/45/);
  assert.match(prompt, /MEMORIA ENTRENADA MÁS RELEVANTE/);
  assert.match(prompt, /Soporte y garantía/);

  const instructions = buildSystemInstructions(
    snapshot,
    { localCallingCode: "+52", localCountry: "México" },
    "¿Cuánto cuesta ChatGPT Pro y tiene soporte?"
  );
  assert.match(instructions, /ChatGPT Pro: precio local autorizado MX\$225/);
  assert.doesNotMatch(instructions, /ChatGPT Pro: precio S\/45/);
  assert.doesNotMatch(instructions, /AR\$18\.000/);
  assert.doesNotMatch(instructions, /Gemini Pro: precio local autorizado S\//);
});

test("elige precios argentinos exactos para +54 sin mezclar pesos mexicanos", () => {
  const prompt = buildUserPrompt(
    createInitialData(),
    "Precio de Gemini Pro",
    {
      localCountry: "Argentina",
      localCallingCode: "+54",
      localCurrency: "Pesos argentinos (ARS)"
    }
  );

  assert.match(
    prompt,
    /Gemini Pro: AR\$8\.000 mensual · AR\$20\.000 anual · AR\$28\.000 por 18 meses/
  );
  assert.doesNotMatch(prompt, /Gemini Pro: MX\$/);
});

test("la oferta del anuncio queda como contexto prioritario para la IA", () => {
  const prompt = buildUserPrompt(
    createInitialData(),
    "¿Cuánto cuesta el Plan Pro del anuncio?",
    {
      localCountry: "Perú",
      localCallingCode: "+51",
      localCurrency: "Soles peruanos (PEN)",
      welcomeAdGreetingId: "ad-chatgpt-personal-plan-pro"
    }
  );

  assert.match(prompt, /CAMPAÑA DE ORIGEN CONFIRMADA: ChatGPT Personal y Plan Pro/);
  assert.match(prompt, /precios y condiciones.*prioridad/i);
  assert.match(prompt, /Plan Pro — S\/45 al mes/);
  assert.match(prompt, /ChatGPT Personal — S\/30 al mes/);
});

test("si Gemini corta por tokens repite la consulta con más espacio", async () => {
  const store = makeStore();
  const requests = [];
  const ai = new AiService({
    store,
    provider: "gemini",
    geminiApiKey: "AIzaSyClaveDePruebaLarga123456789",
    fetchFn: async (_url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      const retry = requests.length === 2;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          candidates: [{
            finishReason: retry ? "STOP" : "MAX_TOKENS",
            content: { parts: [{ text: retry ? "Respuesta completa con todos los precios." : "Respuesta cortada" }] }
          }]
        })
      };
    }
  });

  const answer = await ai.answer({
    question: "Dame todos los precios",
    conversation: { localCallingCode: "+51", localCountry: "Perú" }
  });

  assert.equal(answer, "Respuesta completa con todos los precios.");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].generationConfig.maxOutputTokens, 1200);
  assert.equal(requests[1].generationConfig.maxOutputTokens, 2000);
  assert.match(
    requests[1].contents[0].parts[0].text,
    /entrega la respuesta completa/i
  );
});
