"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { reminderActionFor, fillTemplate } = require("../src/scheduler");

const baseClient = {
  id: "1",
  name: "Ana",
  product: "Claude Pro",
  price: "S/25",
  expiryDate: "2026-07-26",
  status: "activo",
  archived: false,
  reminderDays: 2,
  autoReminder: true,
  autoCharge: false,
  lastReminderKey: null,
  lastChargeKey: null
};

test("activa el recordatorio exactamente dos días antes", () => {
  assert.deepEqual(reminderActionFor(baseClient, "2026-07-24"), {
    type: "reminder",
    key: "2026-07-26:reminder:2",
    remaining: 2
  });
  assert.equal(reminderActionFor(baseClient, "2026-07-23"), null);
});

test("no repite un recordatorio ya enviado", () => {
  const client = { ...baseClient, lastReminderKey: "2026-07-26:reminder:2" };
  assert.equal(reminderActionFor(client, "2026-07-24"), null);
});

test("el cobro automático está separado y puede quedar desactivado", () => {
  assert.equal(reminderActionFor(baseClient, "2026-07-26"), null);
  assert.equal(reminderActionFor({ ...baseClient, autoCharge: true }, "2026-07-26").type, "charge");
});

test("reemplaza las variables del mensaje", () => {
  assert.equal(
    fillTemplate("Hola {nombre}: {producto} vence {fecha}, {precio}.", baseClient),
    "Hola Ana: Claude Pro vence 2026-07-26, S/25."
  );
});
