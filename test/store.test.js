"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { JsonStore } = require("../src/store");

function temporaryDataDir() {
  const directory = path.join(
    __dirname,
    `.tmp-store-${process.pid}-${crypto.randomUUID()}`
  );
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

test("migra datos anteriores sin perder clientes y activa el modo V4.4", () => {
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
    assert.equal(store.data.version, 4.4);
    assert.equal(store.data.clients[0].id, "cliente-existente");
    assert.equal(store.data.clients[0].accountReference, "");
    assert.equal(store.data.clients[0].reminderDays, 2);
    assert.equal(store.data.clients[0].autoReminder, true);
    assert.equal(store.data.clients[0].autoCharge, false);
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
