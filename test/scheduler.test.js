"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ReminderScheduler,
  reminderActionFor,
  fillTemplate
} = require("../src/scheduler");

const baseClient = {
  id: "1",
  name: "Ana",
  product: "Claude Pro",
  accountReference: "claude-equipo-04",
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
  assert.equal(
    reminderActionFor({ ...baseClient, reminderDays: 1 }, "2026-07-25"),
    null
  );
});

test("no repite un recordatorio ya enviado", () => {
  const client = { ...baseClient, lastReminderKey: "2026-07-26:reminder:2" };
  assert.equal(reminderActionFor(client, "2026-07-24"), null);
});

test("el cobro automático está separado y puede quedar desactivado", () => {
  assert.equal(reminderActionFor(baseClient, "2026-07-26"), null);
  assert.equal(reminderActionFor({ ...baseClient, autoCharge: true }, "2026-07-26").type, "charge");
  assert.equal(
    reminderActionFor(
      {
        ...baseClient,
        autoCharge: true,
        lastChargeKey: "2026-07-26:charge"
      },
      "2026-07-26"
    ),
    null
  );
});

test("reemplaza las variables del mensaje", () => {
  assert.equal(
    fillTemplate(
      "Hola {nombre}: {producto}, cuenta {cuenta}, vence {fecha}, {precio}.",
      baseClient
    ),
    "Hola Ana: Claude Pro, cuenta claude-equipo-04, vence 26/07/2026, S/25."
  );
});

test("el programador envía solo el recordatorio y la cobranza que corresponden", async () => {
  const clients = [
    { ...baseClient, id: "recordatorio", whatsapp: "51911111111" },
    {
      ...baseClient,
      id: "cobranza",
      whatsapp: "51922222222",
      expiryDate: "2026-07-24",
      autoReminder: true,
      autoCharge: true
    },
    {
      ...baseClient,
      id: "sin-cobranza",
      whatsapp: "51933333333",
      expiryDate: "2026-07-24",
      autoCharge: false
    }
  ];
  const sent = [];
  const logs = [];
  const store = {
    listClients: () => clients.map((client) => ({ ...client })),
    getSettings: () => ({
      reminderTemplate: "Aviso para {nombre}: {producto} vence {fecha}.",
      chargeTemplate: "Cobro para {nombre}: {precio}."
    }),
    updateClient: (id, patch) => Object.assign(
      clients.find((client) => client.id === id),
      patch
    ),
    addLog: (type, message) => logs.push({ type, message }),
    save: () => undefined
  };
  const whatsapp = {
    getStatus: () => ({ ready: true }),
    sendText: async (number, message) => sent.push({ number, message })
  };
  const scheduler = new ReminderScheduler({
    store,
    whatsapp,
    timeZone: "America/Lima",
    todayFn: () => "2026-07-24",
    minutesFn: () => 10 * 60
  });
  const result = await scheduler.runOnce();

  assert.equal(result.sent, 2);
  assert.deepEqual(
    sent.map((item) => item.number),
    ["51911111111", "51922222222"]
  );
  assert.match(sent[0].message, /26\/07\/2026/);
  assert.match(sent[1].message, /S\/25/);
  assert.equal(clients[0].lastReminderKey, "2026-07-26:reminder:2");
  assert.equal(clients[1].lastChargeKey, "2026-07-24:charge");
  assert.deepEqual(logs.map((item) => item.type), ["reminder", "charge"]);
});

test("cobra por separado dos compras del mismo número en sus propias fechas", async () => {
  const clients = [
    {
      ...baseClient,
      id: "compra-2-agosto",
      whatsapp: "51911111111",
      product: "ChatGPT Pro",
      expiryDate: "2026-08-02",
      autoReminder: false,
      autoCharge: true
    },
    {
      ...baseClient,
      id: "compra-5-agosto",
      whatsapp: "51911111111",
      product: "ChatGPT Pro",
      expiryDate: "2026-08-05",
      autoReminder: false,
      autoCharge: true
    }
  ];
  const sent = [];
  let currentDate = "2026-08-02";
  const store = {
    listClients: () => clients.map((client) => ({ ...client })),
    getSettings: () => ({
      reminderTemplate: "Aviso {producto}",
      chargeTemplate: "Cobro {producto} · {fecha}",
      chargeStartTime: "09:00"
    }),
    updateClient: (id, patch) => Object.assign(
      clients.find((client) => client.id === id),
      patch
    ),
    addLog: () => undefined,
    save: () => undefined
  };
  const scheduler = new ReminderScheduler({
    store,
    whatsapp: {
      getStatus: () => ({ ready: true }),
      sendText: async (number, message) => sent.push({ number, message })
    },
    todayFn: () => currentDate,
    minutesFn: () => 9 * 60
  });

  const firstDay = await scheduler.runOnce();
  currentDate = "2026-08-05";
  const secondDay = await scheduler.runOnce();

  assert.equal(firstDay.sent, 1);
  assert.equal(secondDay.sent, 1);
  assert.deepEqual(sent, [
    { number: "51911111111", message: "Cobro ChatGPT Pro · 02/08/2026" },
    { number: "51911111111", message: "Cobro ChatGPT Pro · 05/08/2026" }
  ]);
  assert.equal(clients[0].lastChargeKey, "2026-08-02:charge");
  assert.equal(clients[1].lastChargeKey, "2026-08-05:charge");
});


test("no envía cobranzas ni recordatorios antes de las 9 AM", async () => {
  const clients = [
    {
      ...baseClient,
      id: "recordatorio-temprano",
      whatsapp: "51911111111"
    },
    {
      ...baseClient,
      id: "cobro-temprano",
      whatsapp: "51922222222",
      expiryDate: "2026-07-24",
      autoCharge: true
    }
  ];
  const sent = [];
  const store = {
    listClients: () => clients.map((client) => ({ ...client })),
    getSettings: () => ({
      reminderTemplate: "Aviso {nombre}",
      chargeTemplate: "Cobro {nombre}",
      chargeStartTime: "09:00"
    }),
    updateClient: () => undefined,
    addLog: () => undefined,
    save: () => undefined
  };
  const whatsapp = {
    getStatus: () => ({ ready: true }),
    sendText: async (number, message) => sent.push({ number, message })
  };
  const scheduler = new ReminderScheduler({
    store,
    whatsapp,
    todayFn: () => "2026-07-24",
    minutesFn: () => 8 * 60 + 59
  });

  const result = await scheduler.runOnce();

  assert.equal(result.chargeWindowOpen, false);
  assert.equal(result.reminderWindowOpen, false);
  assert.equal(result.sent, 0);
  assert.equal(sent.length, 0);
});

test("envía recordatorios y cobranzas desde la hora configurada", async () => {
  const clients = [
    { ...baseClient, id: "recordatorio-9am", whatsapp: "51911111111" }
  ];
  const sent = [];
  const store = {
    listClients: () => clients.map((client) => ({ ...client })),
    getSettings: () => ({
      reminderTemplate: "Aviso {nombre}",
      chargeTemplate: "Cobro {nombre}",
      chargeStartTime: "09:00",
      reminderStartTime: "09:00"
    }),
    updateClient: () => undefined,
    addLog: () => undefined,
    save: () => undefined
  };
  const whatsapp = {
    getStatus: () => ({ ready: true }),
    sendText: async (number, message) => sent.push({ number, message })
  };
  const scheduler = new ReminderScheduler({
    store,
    whatsapp,
    todayFn: () => "2026-07-24",
    minutesFn: () => 9 * 60
  });

  const result = await scheduler.runOnce();
  assert.equal(result.reminderWindowOpen, true);
  assert.equal(result.sent, 1);
  assert.equal(sent[0].number, "51911111111");
});
