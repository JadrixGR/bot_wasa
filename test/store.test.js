"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { JsonStore } = require("../src/store");
const { addDays, todayInTimeZone } = require("../src/date-utils");

function temporaryDataDir() {
  const directory = path.join(
    __dirname,
    `.tmp-store-${process.pid}-${crypto.randomUUID()}`
  );
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

test("migra datos anteriores sin perder clientes y activa el modo V4.6", () => {
  const directory = temporaryDataDir();
  try {
    fs.writeFileSync(
      path.join(directory, "jadrixservs-v4.json"),
      JSON.stringify({
        version: 4.2,
        settings: {
          greetingMessages: ["mensaje antiguo 1", "mensaje antiguo 2", "mensaje antiguo 3"]
        },
        clients: [
          {
            id: "cliente-existente",
            name: "Cliente existente"
          }
        ],
        conversations: {
          "51911112222@s.whatsapp.net": {
            updatedAt: "2026-07-01T12:00:00.000Z"
          }
        }
      }),
      "utf8"
    );

    const store = new JsonStore(directory);
    assert.equal(store.data.version, 4.6);
    assert.equal(store.data.clients[0].id, "cliente-existente");
    assert.equal(store.data.clients[0].accountReference, "");
    assert.equal(store.data.clients[0].reminderDays, 2);
    assert.equal(store.data.clients[0].autoReminder, true);
    assert.equal(store.data.clients[0].autoCharge, false);
    assert.deepEqual(store.data.processedCommandIds, []);
    assert.equal(store.getSettings().inboundMode, "welcome_once");
    assert.match(
      store.getSettings().welcomeTriggers,
      /Super Combo IA 2026/
    );
    assert.ok(
      store.getSettings().greetingMessages[0].startsWith("🚀 JADRIXSERVS 🚀")
    );
    assert.equal(
      store.getConversation("51911112222@s.whatsapp.net")
        .welcomeSequenceSentAt,
      "2026-07-01T12:00:00.000Z"
    );
    assert.equal(
      store.getConversation("51911112222@s.whatsapp.net")
        .welcomeMessagesSent,
      3
    );
    assert.ok(store.getKnowledgeBase().length >= 14);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("mantiene una copia automática de la base principal", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    store.createClient({
      name: "Cliente respaldado",
      whatsapp: "999 888 777",
      product: "Plan Pro",
      startDate: "2026-07-27",
      expiryDate: "2026-08-27",
      status: "activo"
    });
    store.save();

    const backupPath = path.join(
      directory,
      "jadrixservs-v4.backup.json"
    );
    assert.equal(fs.existsSync(backupPath), true);
    const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
    assert.equal(backup.clients[0].name, "Cliente respaldado");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("recupera los clientes desde la copia automática si la base se daña", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const client = store.createClient({
      name: "Cliente recuperado",
      whatsapp: "999 777 666",
      product: "ChatGPT Pro",
      startDate: "2026-07-27",
      expiryDate: "2026-08-27",
      status: "activo"
    });
    store.save();
    fs.writeFileSync(
      path.join(directory, "jadrixservs-v4.json"),
      "{base dañada",
      "utf8"
    );

    const recovered = new JsonStore(directory);
    assert.equal(recovered.getClient(client.id).name, "Cliente recuperado");
    assert.ok(
      recovered.listLogs().some((log) => log.type === "recovery")
    );
    assert.doesNotThrow(() =>
      JSON.parse(
        fs.readFileSync(
          path.join(directory, "jadrixservs-v4.json"),
          "utf8"
        )
      )
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("un cliente nuevo activa el aviso de 2 días, deja la cobranza apagada y guarda su cuenta", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const client = store.createClient({
      name: "Ana",
      whatsapp: "999 888 777",
      product: "Plan Pro",
      accountReference: "equipo-pro-02",
      price: "S/60",
      startDate: "2026-07-27",
      expiryDate: "2026-08-27",
      status: "activo"
    });

    assert.equal(client.reminderDays, 2);
    assert.equal(client.autoReminder, true);
    assert.equal(client.autoCharge, false);
    assert.equal(client.accountReference, "equipo-pro-02");
    assert.equal(
      store.findClientByWhatsApp(
        "100000000000@lid",
        "51999888777@s.whatsapp.net"
      )?.id,
      client.id
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("guarda y vuelve a cargar respuestas entrenadas editables", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const saved = store.updateKnowledgeBase([
      {
        title: "Pregunta personalizada",
        triggers: ["frase uno", "frase dos"],
        answer: "Respuesta personalizada.",
        enabled: true
      }
    ]);
    assert.equal(saved.length, 1);
    assert.ok(saved[0].id);

    const reloaded = new JsonStore(directory);
    assert.deepEqual(reloaded.getKnowledgeBase(), saved);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("un comando crea al cliente estimad@ con días exactos y automatización segura", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const today = todayInTimeZone("America/Lima");
    const result = store.registerClientFromCommand({
      whatsapp: "51999888777",
      item: { name: "Plan Pro", price: "S/60" },
      days: 30,
      command: "/planpro",
      commandMessageId: "comando-1"
    });

    assert.equal(result.created, true);
    assert.equal(result.duplicate, false);
    assert.equal(result.client.name, "estimad@");
    assert.equal(result.client.whatsapp, "51999888777");
    assert.equal(result.client.product, "Plan Pro");
    assert.equal(result.client.durationDays, 30);
    assert.equal(result.client.startDate, today);
    assert.equal(result.client.expiryDate, addDays(today, 30));
    assert.equal(result.client.autoReminder, true);
    assert.equal(result.client.autoCharge, false);
    assert.equal(result.client.registrationSource, "whatsapp-command");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("repetir el mismo comando renueva sin perder días y un evento duplicado no suma otra vez", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const item = { name: "ChatGPT Pro", price: "S/45" };
    const first = store.registerClientFromCommand({
      whatsapp: "999888777",
      item,
      days: 30,
      command: "/gptpro",
      commandMessageId: "mensaje-1"
    });
    const duplicate = store.registerClientFromCommand({
      whatsapp: "999888777",
      item,
      days: 30,
      command: "/gptpro",
      commandMessageId: "mensaje-1"
    });
    const renewal = store.registerClientFromCommand({
      whatsapp: "999888777",
      item,
      days: 30,
      command: "/gptpro",
      commandMessageId: "mensaje-2"
    });

    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.client.expiryDate, first.client.expiryDate);
    assert.equal(renewal.created, false);
    assert.equal(
      renewal.client.expiryDate,
      addDays(first.client.expiryDate, 30)
    );
    assert.equal(store.listClients().length, 1);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("el mismo número puede comprar otro producto sin mezclar vencimientos", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    store.registerClientFromCommand({
      whatsapp: "999888777",
      item: { name: "Netflix", price: "S/10" },
      days: 30,
      command: "/netflix",
      commandMessageId: "netflix-1"
    });
    store.registerClientFromCommand({
      whatsapp: "999888777",
      item: { name: "HBO", price: "S/7" },
      days: 30,
      command: "/hbo",
      commandMessageId: "hbo-1"
    });

    assert.deepEqual(
      store.listClients().map((client) => client.product).sort(),
      ["HBO", "Netflix"]
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
