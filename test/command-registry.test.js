"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  getCommandCatalog,
  parseRegistrationCommand
} = require("../src/command-registry");

test("cada producto y plan tiene un comando único", () => {
  const catalog = getCommandCatalog();
  assert.equal(catalog.length, 14);
  assert.equal(new Set(catalog.map((item) => item.command)).size, 14);
  assert.deepEqual(
    catalog.map((item) => item.command),
    [
      "/claudepro",
      "/gptpro",
      "/gptplus",
      "/gptpersonal",
      "/geminipro",
      "/supergrok",
      "/perplexitypro",
      "/gammapro",
      "/capcutpro",
      "/netflix",
      "/hbo",
      "/crunchyroll",
      "/planpro",
      "/planplus"
    ]
  );
});

test("reconoce el comando sin distinguir mayúsculas y conserva los días", () => {
  const parsed = parseRegistrationCommand("  /PlanPro   30 ");
  assert.equal(parsed.ok, true);
  assert.equal(parsed.command, "/planpro");
  assert.equal(parsed.days, 30);
  assert.equal(parsed.item.name, "Plan Pro");
  assert.equal(parsed.item.price, "S/60");
});

test("selecciona el precio de Gemini según la duración conocida", () => {
  assert.equal(parseRegistrationCommand("/geminipro 30").item.price, "S/20");
  assert.equal(parseRegistrationCommand("/geminipro 365").item.price, "S/50");
  assert.equal(parseRegistrationCommand("/geminipro 548").item.price, "S/70");
});

test("rechaza comandos desconocidos o días inválidos", () => {
  assert.equal(parseRegistrationCommand("hola").isCommand, false);
  assert.match(
    parseRegistrationCommand("/inventado 30").error,
    /no existe/i
  );
  assert.match(parseRegistrationCommand("/planpro").error, /días/i);
  assert.match(parseRegistrationCommand("/planpro 0").error, /entre 1 y 3650/i);
  assert.match(parseRegistrationCommand("/planpro 30 extra").error, /formato/i);
});

test("el archivo TXT contiene todos los comandos del catálogo", () => {
  const guide = fs.readFileSync(
    path.resolve("public/COMANDOS-WHATSAPP-V4.8.txt"),
    "utf8"
  );
  for (const item of getCommandCatalog()) {
    assert.match(guide, new RegExp(`^\\s*${item.command}\\s`, "m"));
  }
});
