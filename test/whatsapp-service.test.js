"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  calculateHumanDelay,
  normalizeWhatsAppId
} = require("../src/whatsapp-service");

test("la demora humana crece con el texto y respeta sus límites", () => {
  const short = calculateHumanDelay("Hola", {
    minimum: 900,
    maximum: 4200,
    random: () => 0
  });
  const long = calculateHumanDelay("x".repeat(300), {
    minimum: 900,
    maximum: 4200,
    random: () => 0
  });
  assert.equal(short, 900);
  assert.ok(long > short);
  assert.ok(long <= 4200);
});

test("normaliza números peruanos para WhatsApp", () => {
  assert.equal(normalizeWhatsAppId("999 888 777"), "51999888777@c.us");
  assert.equal(normalizeWhatsAppId("51999888777"), "51999888777@c.us");
});
