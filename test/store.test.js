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

test("migra los datos V4.2 sin perder clientes e instala la secuencia y el entrenamiento V4.3", () => {
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
        ]
      }),
      "utf8"
    );

    const store = new JsonStore(directory);
    assert.equal(store.data.version, 4.3);
    assert.equal(store.data.clients[0].id, "cliente-existente");
    assert.match(
      store.getSettings().welcomeTriggers,
      /Super Combo IA 2026/
    );
    assert.ok(
      store.getSettings().greetingMessages[0].startsWith("🚀 JADRIXSERVS 🚀")
    );
    assert.ok(store.getKnowledgeBase().length >= 14);
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
