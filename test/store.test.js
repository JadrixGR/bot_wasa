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
    assert.equal(store.data.version, 4.92);
    assert.equal(store.data.clients[0].id, "cliente-existente");
    assert.equal(store.data.clients[0].accountReference, "");
    assert.equal(store.data.clients[0].reminderDays, 2);
    assert.equal(store.data.clients[0].autoReminder, true);
    assert.equal(store.data.clients[0].autoCharge, false);
    assert.deepEqual(store.data.authenticatorAccounts, []);
    assert.deepEqual(store.data.processedCommandIds, []);
    assert.equal(store.getSettings().inboundMode, "welcome_once");
    assert.equal(store.getSettings().welcomeRoutingMode, "smart");
    assert.equal(store.getSettings().adGreetings.length, 1);
    assert.equal(
      store.getSettings().adGreetings[0].id,
      "ad-chatgpt-personal-plan-pro"
    );
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
    assert.deepEqual(store.data.aiConfig, {
      provider: "gemini",
      enabled: false,
      model: "gemini-3.6-flash",
      encryptedApiKey: "",
      updatedAt: null
    });
    assert.match(store.getSettings().aiInstructions, /clara, amable y completa/i);
    assert.deepEqual(
      store.getCountryPriceBooks().map((book) => book.callingCode),
      ["+51", "+52", "+54"]
    );
    assert.equal(
      store.getCountryPriceBooks().find((book) => book.callingCode === "+52")
        .prices["chatgpt-pro"],
      "MX$225"
    );
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

test("guarda y recarga bienvenidas editables por país", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const settings = store.updateSettings({
      countryGreetings: [
        {
          id: "peru-51",
          country: "Perú",
          callingCode: "51",
          currency: "PEN (S/)",
          enabled: true,
          messages: ["Perú catálogo", "Perú combos", "Perú soporte"]
        },
        {
          id: "argentina-54",
          country: "Argentina",
          callingCode: "+54",
          currency: "ARS ($)",
          enabled: false,
          messages: ["Argentina catálogo", "Argentina combos", "Argentina soporte"]
        }
      ]
    });

    assert.equal(settings.countryGreetings[0].callingCode, "+51");
    assert.equal(settings.countryGreetings[1].enabled, false);
    const reloaded = new JsonStore(directory).getSettings();
    assert.deepEqual(
      reloaded.countryGreetings.map(({ country, callingCode, currency, enabled, messages }) => ({
        country,
        callingCode,
        currency,
        enabled,
        messages
      })),
      settings.countryGreetings.map(({ country, callingCode, currency, enabled, messages }) => ({
        country,
        callingCode,
        currency,
        enabled,
        messages
      }))
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("guarda bienvenidas por anuncio y permite activar el modo general", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const settings = store.updateSettings({
      welcomeRoutingMode: "general",
      adGreetings: [
        {
          id: "anuncio-streaming",
          name: "Streaming agosto",
          enabled: true,
          matchTerms: ["PROMOCIÓN STREAMING AGOSTO", "meta-ad-7788"],
          messages: ["Streaming 1", "Streaming 2", "Streaming 3"]
        }
      ]
    });

    assert.equal(settings.welcomeRoutingMode, "general");
    assert.equal(settings.adGreetings[0].matchTerms.length, 2);
    assert.deepEqual(settings.adGreetings[0].messages, [
      "Streaming 1",
      "Streaming 2",
      "Streaming 3"
    ]);

    const reloaded = new JsonStore(directory).getSettings();
    assert.equal(reloaded.welcomeRoutingMode, "general");
    assert.equal(reloaded.adGreetings[0].name, "Streaming agosto");
    assert.deepEqual(reloaded.adGreetings[0].messages, [
      "Streaming 1",
      "Streaming 2",
      "Streaming 3"
    ]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("acepta secuencias variables y rechaza anuncios sin identificadores o mensajes", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    assert.throws(
      () =>
        store.updateSettings({
          adGreetings: [
            {
              name: "Sin coincidencia",
              matchTerms: [],
              messages: ["uno", "dos", "tres"]
            }
          ]
        }),
      /al menos una frase o identificador/i
    );
    assert.throws(
      () =>
        store.updateSettings({
          adGreetings: [
            {
              name: "Incompleto",
              matchTerms: ["anuncio único"],
              messages: []
            }
          ]
        }),
      /entre 1 y 20 mensajes/i
    );
    const settings = store.updateSettings({
      adGreetings: [
        {
          id: "anuncio-dos-mensajes",
          name: "Dos mensajes",
          matchTerms: ["promoción dos mensajes"],
          messages: ["uno", "dos"]
        }
      ]
    });
    assert.deepEqual(settings.adGreetings[0].messages, ["uno", "dos"]);
    assert.equal(settings.adGreetings[0].sequence.length, 2);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("rechaza prefijos repetidos y perfiles sin mensajes", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    assert.throws(
      () =>
        store.updateSettings({
          countryGreetings: [
            {
              country: "Perú",
              callingCode: "+51",
              currency: "PEN",
              messages: ["uno", "dos", "tres"]
            },
            {
              country: "Duplicado",
              callingCode: "51",
              currency: "PEN",
              messages: ["uno", "dos", "tres"]
            }
          ]
        }),
      /prefijo \+51 está repetido/i
    );
    assert.throws(
      () =>
        store.updateSettings({
          countryGreetings: [
            {
              country: "Argentina",
              callingCode: "+54",
              currency: "ARS",
              messages: []
            }
          ]
        }),
      /entre 1 y 20 mensajes/i
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("una instalación existente conserva sus tres mensajes dentro del perfil de Perú", () => {
  const directory = temporaryDataDir();
  try {
    const initial = createInitialData();
    delete initial.settings.countryGreetings;
    delete initial.settings.greetingSequence;
    initial.settings.greetingMessages = [
      "catálogo peruano anterior",
      "combos peruanos anteriores",
      "soporte peruano anterior"
    ];
    fs.writeFileSync(
      path.join(directory, "jadrixservs-v4.json"),
      JSON.stringify(initial),
      "utf8"
    );

    const settings = new JsonStore(directory).getSettings();
    assert.equal(settings.countryGreetings.length, 3);
    assert.equal(settings.countryGreetings[0].country, "Perú");
    assert.equal(settings.countryGreetings[0].callingCode, "+51");
    assert.deepEqual(
      settings.countryGreetings[0].messages,
      initial.settings.greetingMessages
    );
    assert.deepEqual(
      settings.countryGreetings.map((profile) => profile.callingCode),
      ["+51", "+52", "+54"]
    );
    const persisted = JSON.parse(
      fs.readFileSync(path.join(directory, "jadrixservs-v4.json"), "utf8")
    );
    assert.equal(persisted.settings.countryGreetings[0].callingCode, "+51");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("guarda, reemplaza y elimina una imagen opcional de bienvenida", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const settings = store.updateSettings({
      greetingSequence: [
        { id: "general-flex-1", text: "Primer mensaje", image: null },
        { id: "general-flex-2", text: "Segundo mensaje", image: null },
        { id: "general-flex-3", text: "Tercer mensaje", image: null },
        { id: "general-flex-4", text: "Cuarto mensaje", image: null }
      ]
    });
    assert.equal(settings.greetingSequence.length, 4);
    assert.deepEqual(settings.greetingMessages, [
      "Primer mensaje",
      "Segundo mensaje",
      "Tercer mensaje",
      "Cuarto mensaje"
    ]);

    const first = store.setWelcomeMessageImage(
      "general",
      "general",
      "general-flex-1",
      {
        id: "welcome-image-1",
        path: path.join(directory, "welcome-1.png"),
        originalName: "promocion.png",
        mimetype: "image/png",
        size: 120
      }
    );
    assert.equal(first.previous, null);
    assert.equal(first.image.originalName, "promocion.png");

    const panelLikeSequence = store.getSettings().greetingSequence.map(
      (message) => ({
        id: message.id,
        text: message.text,
        image: message.image
          ? {
              id: message.image.id,
              originalName: message.image.originalName,
              size: message.image.size
            }
          : null
      })
    );
    store.updateSettings({ greetingSequence: panelLikeSequence });
    assert.equal(
      store.getWelcomeMessage("general", "general", "general-flex-1").image.path,
      path.join(directory, "welcome-1.png")
    );

    const deleted = store.deleteWelcomeMessageImage(
      "general",
      "general",
      "general-flex-1"
    );
    assert.equal(deleted.id, "welcome-image-1");
    assert.equal(
      store.getWelcomeMessage("general", "general", "general-flex-1").image,
      null
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

test("guarda precios locales editables en data y los conserva al reiniciar", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const books = store.getCountryPriceBooks();
    const mexico = books.find((book) => book.callingCode === "+52");
    mexico.prices["chatgpt-pro"] = "MX$239";
    mexico.prices["plan-pro"] = "MX$319";

    const saved = store.updateCountryPriceBooks(books);
    assert.equal(
      saved.find((book) => book.callingCode === "+52").prices["chatgpt-pro"],
      "MX$239"
    );

    const reloaded = new JsonStore(directory);
    const persistedMexico = reloaded
      .getCountryPriceBooks()
      .find((book) => book.callingCode === "+52");
    assert.equal(persistedMexico.prices["chatgpt-pro"], "MX$239");
    assert.equal(persistedMexico.prices["plan-pro"], "MX$319");
    assert.ok(
      reloaded.data.logs.some((log) => log.type === "pricing")
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("crea respuestas rápidas con varias imágenes y textos en orden", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const created = store.createQuickReply({
      name: "Diferencia entre planes",
      command: "/diferencia",
      enabled: true,
      texts: ["Primer texto", "Segundo texto"]
    });

    assert.equal(created.enabled, false);
    assert.deepEqual(created.images, []);
    store.addQuickReplyImage(created.id, {
      id: "imagen-1",
      path: path.join(directory, "primera.png"),
      originalName: "primera.png",
      mimetype: "image/png",
      size: 100
    });
    store.addQuickReplyImage(created.id, {
      id: "imagen-2",
      path: path.join(directory, "segunda.jpg"),
      originalName: "segunda.jpg",
      mimetype: "image/jpeg",
      size: 200
    });
    const active = store.updateQuickReply(created.id, {
      enabled: true,
      texts: ["Primer texto", "Segundo texto"]
    });

    assert.equal(active.enabled, true);
    assert.deepEqual(active.images.map((image) => image.id), ["imagen-1", "imagen-2"]);
    assert.deepEqual(active.texts, ["Primer texto", "Segundo texto"]);
    assert.equal(store.findQuickReplyByCommand(" /DIFERENCIA ").id, created.id);
    assert.throws(
      () =>
        store.createQuickReply({
          name: "Duplicada",
          command: "/diferencia",
          texts: ["Texto"]
        }),
      /ya pertenece a la respuesta rápida/
    );
    assert.throws(
      () =>
        store.createQuickReply({
          name: "Conflicto catálogo",
          command: "/claudepro",
          texts: ["Texto"]
        }),
      /ya registra el producto/
    );

    const reloaded = new JsonStore(directory);
    assert.deepEqual(
      reloaded.getQuickReply(created.id).images.map((image) => image.id),
      ["imagen-1", "imagen-2"]
    );
    reloaded.deleteQuickReplyImage(created.id, "imagen-1");
    const lastImage = reloaded.deleteQuickReplyImage(created.id, "imagen-2");
    assert.equal(lastImage.id, "imagen-2");
    assert.equal(reloaded.getQuickReply(created.id).enabled, false);
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

test("cada comando nuevo crea una compra independiente aunque repita el producto", () => {
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
    const secondPurchase = store.registerClientFromCommand({
      whatsapp: "999888777",
      item,
      days: 30,
      command: "/gptpro",
      commandMessageId: "mensaje-2"
    });

    assert.equal(duplicate.duplicate, true);
    assert.equal(duplicate.client.id, first.client.id);
    assert.equal(duplicate.client.expiryDate, first.client.expiryDate);
    assert.equal(secondPurchase.created, true);
    assert.notEqual(secondPurchase.client.id, first.client.id);
    assert.equal(secondPurchase.client.product, first.client.product);
    assert.equal(secondPurchase.client.startDate, first.client.startDate);
    assert.equal(secondPurchase.client.expiryDate, first.client.expiryDate);
    assert.equal(store.listClients().length, 2);
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
    assert.equal(result.version, 4.92);
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


test("crea una copia previa a V4.7.2 sin alterar los clientes existentes", () => {
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
      "jadrixservs-v4.pre-v4.7.2.json"
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
