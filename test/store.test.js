"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { JsonStore } = require("../src/store");
const { createInitialData } = require("../src/defaults");
const { addDays, todayInTimeZone } = require("../src/date-utils");

function temporaryDataDir() {
  const directory = path.join(
    __dirname,
    `.tmp-store-${process.pid}-${crypto.randomUUID()}`
  );
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

test("migra datos anteriores sin perder clientes y activa el modo V4.7", () => {
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
    assert.equal(store.data.version, 4.7);
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

test("buscar por celular devuelve todos los servicios del mismo cliente", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const today = todayInTimeZone("America/Lima");
    for (const product of ["Netflix", "HBO"]) {
      store.createClient({
        name: "Ana",
        whatsapp: "999888777",
        product,
        price: "S/10",
        startDate: today,
        expiryDate: addDays(today, 30),
        autoReminder: true,
        autoCharge: false
      });
    }

    const matches = store.findClientsByWhatsApp("999888777");
    assert.equal(matches.length, 2);
    assert.deepEqual(matches.map((client) => client.product).sort(), ["HBO", "Netflix"]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("cada nueva activación AFK crea una sesión distinta sin perder la configuración", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const first = store.updateSettings({
      afkEnabled: true,
      afkMessage: "Volvemos a las 9 AM."
    });
    store.updateSettings({ afkEnabled: false });
    const second = store.updateSettings({ afkEnabled: true });

    assert.equal(second.afkEnabled, true);
    assert.equal(second.afkMessage, "Volvemos a las 9 AM.");
    assert.notEqual(first.afkSessionId, second.afkSessionId);
    assert.equal(second.chargeStartTime, "09:00");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("restaura un respaldo JSON y conserva la versión de datos actual", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const snapshot = createInitialData();
    snapshot.version = 4.6;
    snapshot.clients.push({
      id: "restaurado-1",
      name: "Cliente restaurado",
      whatsapp: "51912345678",
      product: "Plan Pro",
      price: "S/60",
      startDate: "2026-07-01",
      expiryDate: "2026-07-31",
      termMonths: 1,
      status: "activo",
      reminderDays: 2,
      autoReminder: true,
      autoCharge: false,
      archived: false,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    });

    const result = store.restoreSnapshot(snapshot);

    assert.equal(result.clients, 1);
    assert.equal(result.version, 4.7);
    assert.equal(store.listClients()[0].name, "Cliente restaurado");
    assert.ok(fs.existsSync(path.join(directory, "jadrixservs-v4.backup.json")));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test("limita a dos compras nuevas por número sin borrar las existentes", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const base = {
      name: "estimad@",
      whatsapp: "999888777",
      startDate: "2026-07-28",
      expiryDate: "2026-08-27",
      status: "activo"
    };
    store.createClient({ ...base, product: "ChatGPT Plus" });
    store.createClient({ ...base, product: "Netflix" });
    assert.equal(store.findClientsByWhatsApp("51999888777").length, 2);
    assert.throws(
      () => store.createClient({ ...base, product: "HBO" }),
      /2 compras registradas/
    );
    assert.equal(store.findClientsByWhatsApp("999888777").length, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("elimina un registro sin borrar la segunda compra del mismo número", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const first = store.createClient({
      name: "estimad@",
      whatsapp: "999888777",
      product: "ChatGPT Plus",
      startDate: "2026-07-28",
      expiryDate: "2026-08-27",
      status: "activo"
    });
    store.createClient({
      name: "estimad@",
      whatsapp: "999888777",
      product: "Netflix",
      startDate: "2026-07-28",
      expiryDate: "2026-08-27",
      status: "activo"
    });
    store.deleteClient(first.id);
    const remaining = store.findClientsByWhatsApp("999888777");
    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].product, "Netflix");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("elimina por completo todas las compras del mismo número", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const base = {
      name: "estimad@",
      whatsapp: "999888777",
      startDate: "2026-07-28",
      expiryDate: "2026-08-27",
      status: "activo"
    };
    store.createClient({ ...base, product: "ChatGPT Plus" });
    store.createClient({ ...base, product: "Netflix" });
    const deleted = store.deleteClientsByWhatsApp("51999888777");
    assert.equal(deleted.length, 2);
    assert.equal(store.findClientsByWhatsApp("999888777").length, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test("crea una copia previa a V4.7.1 sin alterar los clientes existentes", () => {
  const directory = temporaryDataDir();
  try {
    const existing = createInitialData();
    existing.clients.push({
      id: "cliente-previo",
      name: "Cliente previo",
      whatsapp: "51999888777",
      product: "Netflix",
      price: "S/10",
      paymentMethod: "Yape",
      accountReference: "perfil-1",
      startDate: "2026-07-01",
      expiryDate: "2026-08-01",
      termMonths: 1,
      durationDays: 30,
      status: "activo",
      reminderDays: 2,
      autoReminder: true,
      autoCharge: false,
      notes: "",
      archived: false,
      lastPaymentDate: null,
      lastReminderKey: null,
      lastChargeKey: null,
      registrationSource: "",
      lastCommand: "",
      lastCommandMessageId: "",
      lastCommandAt: null,
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    });
    const mainPath = path.join(directory, "jadrixservs-v4.json");
    fs.writeFileSync(mainPath, JSON.stringify(existing), "utf8");

    const store = new JsonStore(directory);
    const preUpdatePath = path.join(
      directory,
      "jadrixservs-v4.pre-v4.7.1.json"
    );
    assert.equal(fs.existsSync(preUpdatePath), true);
    assert.equal(store.listClients().length, 1);
    assert.equal(store.listClients()[0].id, "cliente-previo");
    const backup = JSON.parse(fs.readFileSync(preUpdatePath, "utf8"));
    assert.equal(backup.clients[0].id, "cliente-previo");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
