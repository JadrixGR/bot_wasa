"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { products, plans, buildGreetingMessages } = require("../src/defaults");

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
  assert.match(messages[0], /Claude Pro/);
  assert.match(messages[0], /Crunchyroll/);
  assert.match(messages[1], /Plan Pro/);
  assert.match(messages[1], /Plan Plus/);
  assert.match(messages[2], /Entrega inmediata/);
  assert.match(messages[2], /JadrixServs/);
});
