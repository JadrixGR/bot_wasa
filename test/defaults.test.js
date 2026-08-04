"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  products,
  plans,
  knowledgeBase,
  defaultSettings,
  buildGreetingMessages,
  createInitialData
} = require("../src/defaults");

test("el catálogo conserva los 12 productos y precios entrenados", () => {
  assert.deepEqual(
    products.map(({ name, price }) => [name, price]),
    [
      ["Claude Pro", "S/25"],
      ["ChatGPT Pro", "S/45"],
      ["ChatGPT Plus", "S/10"],
      ["ChatGPT Plus Personal", "S/30"],
      ["Gemini Pro", "S/20 mensual · S/50 anual · S/70 por 18 meses"],
      ["SuperGrok", "S/20"],
      ["Perplexity Pro", "S/15"],
      ["Gamma Pro", "S/20"],
      ["CapCut Pro", "S/15"],
      ["Netflix", "S/10"],
      ["HBO", "S/7"],
      ["Crunchyroll", "S/5"]
    ]
  );
});

test("los combos contienen el alcance solicitado", () => {
  const planPro = plans.find((plan) => plan.id === "plan-pro");
  const planPlus = plans.find((plan) => plan.id === "plan-plus");
  assert.equal(planPro.price, "S/60");
  assert.ok(planPro.includes.includes("SuperGrok Heavy"));
  assert.equal(planPlus.price, "S/25");
  assert.ok(planPlus.includes.includes("+1000 cursos de IA"));
});

test("el saludo siempre tiene exactamente tres mensajes en el orden correcto", () => {
  const messages = buildGreetingMessages();
  assert.equal(messages.length, 3);
  assert.ok(messages[0].startsWith("🚀 JADRIXSERVS 🚀"));
  assert.match(messages[0], /Claude Pro/);
  assert.match(messages[0], /Crunchyroll/);
  assert.ok(messages[1].startsWith("💼 COMBOS ESPECIALES - Todo en 1"));
  assert.match(messages[1], /Plan Pro/);
  assert.match(messages[1], /Plan Plus/);
  assert.ok(messages[2].startsWith("✅ `Entrega inmediata`"));
  assert.ok(messages[2].endsWith("JadrixServs 💪"));
});

test("el Super Combo IA 2026 activa la secuencia inicial", () => {
  assert.match(
    defaultSettings.welcomeTriggers,
    /¿Cuál es el precio del Super Combo IA 2026\?/
  );
});

test("la V4.7 usa el modo de bienvenida única", () => {
  assert.equal(createInitialData().version, 4.92);
  assert.deepEqual(createInitialData().authenticatorAccounts, []);
  assert.equal(defaultSettings.inboundMode, "welcome_once");
  assert.match(defaultSettings.reminderTemplate, /vence en 2 días/i);
  assert.equal(defaultSettings.chargeStartTime, "09:00");
  assert.equal(defaultSettings.afkEnabled, false);
  assert.match(defaultSettings.afkMessage, /fuera del horario/i);
  assert.equal(defaultSettings.countryGreetings.length, 1);
  assert.equal(defaultSettings.countryGreetings[0].callingCode, "+51");
  assert.equal(defaultSettings.countryGreetings[0].country, "Perú");
  assert.equal(defaultSettings.countryGreetings[0].messages.length, 3);
  assert.match(defaultSettings.aiInstructions, /respuestas breves/i);
  assert.deepEqual(createInitialData().aiConfig, {
    provider: "gemini",
    enabled: false,
    model: "gemini-3.6-flash",
    encryptedApiKey: "",
    updatedAt: null
  });
});

test("incluye respuestas locales para consultas frecuentes aun sin OpenAI", () => {
  assert.ok(knowledgeBase.length >= 14);
  assert.ok(
    knowledgeBase.some(
      (entry) =>
        entry.id === "early-renewal" &&
        /sin perder días/i.test(entry.answer)
    )
  );
  assert.ok(
    knowledgeBase.some(
      (entry) =>
        entry.id === "payment-peru" &&
        /921 444 991/.test(entry.answer)
    )
  );
});
