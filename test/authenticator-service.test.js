"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { JsonStore } = require("../src/store");
const {
  AuthenticatorService,
  decryptSecret,
  deriveAuthenticatorCommand,
  deriveEncryptionKey,
  encryptSecret,
  generateTotp,
  normalizeAuthenticatorCommand,
  normalizeBase32Secret,
  parseTotpSecret
} = require("../src/authenticator-service");

function temporaryDataDir() {
  const directory = path.join(
    __dirname,
    `.tmp-authenticator-${process.pid}-${crypto.randomUUID()}`
  );
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

test("genera el vector oficial TOTP SHA1 de RFC 6238", () => {
  const result = generateTotp(
    "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    {
      timestamp: 59_000,
      digits: 8,
      period: 30,
      algorithm: "SHA1"
    }
  );

  assert.equal(result.code, "94287082");
  assert.equal(result.secondsRemaining, 1);
  assert.equal(result.digits, 8);
});

test("acepta una clave Base32 y un enlace otpauth TOTP", () => {
  assert.equal(
    normalizeBase32Secret("jbsw y3dp-ehpk3pxp"),
    "JBSWY3DPEHPK3PXP"
  );
  assert.deepEqual(
    parseTotpSecret(
      "otpauth://totp/JadrixServs:cuenta?secret=JBSWY3DPEHPK3PXP&algorithm=SHA256&digits=8&period=60"
    ),
    {
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "SHA256",
      digits: 8,
      period: 60
    }
  );
});

test("crea comandos privados normalizados a partir del nombre de la cuenta", () => {
  assert.equal(deriveAuthenticatorCommand("GPT01"), "/gpt01");
  assert.equal(deriveAuthenticatorCommand("Grok 01"), "/grok01");
  assert.equal(normalizeAuthenticatorCommand("GPT_02"), "/gpt_02");
  assert.throws(
    () => normalizeAuthenticatorCommand("/x"),
    /entre 2 y 32/i
  );
});

test("rechaza códigos temporales y enlaces que no sean TOTP", () => {
  assert.throws(() => parseTotpSecret("123456"), /Base32|válida/i);
  assert.throws(
    () =>
      parseTotpSecret(
        "otpauth://hotp/JadrixServs?secret=JBSWY3DPEHPK3PXP&counter=1"
      ),
    /TOTP/i
  );
});

test("cifra y autentica la clave secreta con AES-256-GCM", () => {
  const key = deriveEncryptionKey("clave-muy-larga-de-prueba");
  const encrypted = encryptSecret("JBSWY3DPEHPK3PXP", key);

  assert.match(encrypted, /^v1\./);
  assert.doesNotMatch(encrypted, /JBSWY3DPEHPK3PXP/);
  assert.equal(decryptSecret(encrypted, key), "JBSWY3DPEHPK3PXP");
  assert.throws(() =>
    decryptSecret(
      encrypted,
      deriveEncryptionKey("otra-clave-que-no-corresponde")
    )
  );
});

test("guarda cuentas cifradas y nunca devuelve la clave ni el texto cifrado al panel", () => {
  const directory = temporaryDataDir();
  try {
    const fixedTime = Date.parse("2026-07-28T12:00:05.000Z");
    const store = new JsonStore(directory);
    const service = new AuthenticatorService({
      store,
      encryptionKey: "clave-estable-de-render-para-pruebas",
      clock: () => fixedTime
    });
    const created = service.createAccount({
      name: "Cuenta principal",
      service: "Google",
      email: "admin@jadrixservs.test",
      secret: "JBSWY3DPEHPK3PXP"
    });

    assert.equal(created.available, true);
    assert.equal(created.command, "/cuentaprincipal");
    assert.match(created.code, /^\d{6}$/);
    assert.equal(created.secretConfigured, true);
    assert.equal("secret" in created, false);
    assert.equal("encryptedSecret" in created, false);

    const persistedText = fs.readFileSync(
      path.join(directory, "jadrixservs-v4.json"),
      "utf8"
    );
    assert.doesNotMatch(persistedText, /JBSWY3DPEHPK3PXP/);
    const persisted = JSON.parse(persistedText);
    assert.match(
      persisted.authenticatorAccounts[0].encryptedSecret,
      /^v1\./
    );

    const listed = service.listAccounts();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].code, created.code);
    assert.equal("encryptedSecret" in listed[0], false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("editar sin nueva clave conserva el secreto y permite reemplazarlo después", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const service = new AuthenticatorService({
      store,
      encryptionKey: "clave-estable",
      clock: () => 59_000
    });
    const created = service.createAccount({
      name: "Personal",
      service: "Servicio A",
      email: "uno@correo.test",
      secret: "JBSWY3DPEHPK3PXP"
    });
    const encryptedBefore =
      store.getAuthenticatorAccount(created.id).encryptedSecret;

    const edited = service.updateAccount(created.id, {
      name: "Trabajo",
      service: "Servicio A",
      email: "dos@correo.test",
      secret: ""
    });
    assert.equal(edited.name, "Trabajo");
    assert.equal(
      store.getAuthenticatorAccount(created.id).encryptedSecret,
      encryptedBefore
    );

    service.updateAccount(created.id, {
      name: "Trabajo",
      service: "Servicio A",
      email: "dos@correo.test",
      secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    });
    assert.notEqual(
      store.getAuthenticatorAccount(created.id).encryptedSecret,
      encryptedBefore
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("una clave de cifrado cambiada no expone datos y marca la cuenta como no disponible", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const original = new AuthenticatorService({
      store,
      encryptionKey: "clave-original"
    });
    original.createAccount({
      name: "Cuenta",
      service: "Google",
      email: "cuenta@correo.test",
      secret: "JBSWY3DPEHPK3PXP"
    });

    const reopened = new AuthenticatorService({
      store: new JsonStore(directory),
      encryptionKey: "clave-distinta"
    });
    const [account] = reopened.listAccounts();
    assert.equal(account.available, false);
    assert.equal(account.code, null);
    assert.match(account.error, /clave de cifrado/i);
    assert.equal("encryptedSecret" in account, false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("elimina únicamente la cuenta seleccionada del Autenticador", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const service = new AuthenticatorService({
      store,
      encryptionKey: "clave-estable"
    });
    const first = service.createAccount({
      name: "Primera",
      service: "Google",
      email: "uno@correo.test",
      secret: "JBSWY3DPEHPK3PXP"
    });
    service.createAccount({
      name: "Segunda",
      service: "GitHub",
      email: "dos@correo.test",
      secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
    });

    service.deleteAccount(first.id);
    assert.equal(service.listAccounts().length, 1);
    assert.equal(store.listClients().length, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("agrega el Autenticador a una base V4.7 existente sin perder clientes", () => {
  const directory = temporaryDataDir();
  try {
    const original = new JsonStore(directory);
    const client = original.createClient({
      name: "Cliente existente",
      whatsapp: "999888777",
      product: "Plan Pro",
      startDate: "2026-07-01",
      expiryDate: "2026-08-01",
      status: "activo"
    });
    const legacySnapshot = original.snapshot();
    delete legacySnapshot.authenticatorAccounts;
    fs.writeFileSync(
      path.join(directory, "jadrixservs-v4.json"),
      `${JSON.stringify(legacySnapshot, null, 2)}\n`,
      "utf8"
    );

    const upgraded = new JsonStore(directory);
    const service = new AuthenticatorService({
      store: upgraded,
      encryptionKey: "clave-estable"
    });
    service.createAccount({
      name: "Cuenta nueva",
      service: "Google",
      email: "cuenta@correo.test",
      secret: "JBSWY3DPEHPK3PXP"
    });

    const reloaded = new JsonStore(directory);
    assert.equal(reloaded.getClient(client.id).name, "Cliente existente");
    assert.equal(reloaded.listAuthenticatorAccounts().length, 1);
    assert.equal(reloaded.data.version, 4.7);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("restaura las cuentas cifradas si se conserva la misma clave de Render", () => {
  const sourceDirectory = temporaryDataDir();
  const targetDirectory = temporaryDataDir();
  try {
    const sourceStore = new JsonStore(sourceDirectory);
    const sourceService = new AuthenticatorService({
      store: sourceStore,
      encryptionKey: "clave-de-render-conservada",
      clock: () => 59_000
    });
    sourceService.createAccount({
      name: "Cuenta respaldada",
      service: "GitHub",
      email: "respaldo@correo.test",
      secret: "JBSWY3DPEHPK3PXP"
    });

    const targetStore = new JsonStore(targetDirectory);
    targetStore.restoreSnapshot(sourceStore.snapshot());
    const targetService = new AuthenticatorService({
      store: targetStore,
      encryptionKey: "clave-de-render-conservada",
      clock: () => 59_000
    });

    const [restored] = targetService.listAccounts();
    assert.equal(restored.name, "Cuenta respaldada");
    assert.equal(restored.available, true);
    assert.match(restored.code, /^\d{6}$/);
  } finally {
    fs.rmSync(sourceDirectory, { recursive: true, force: true });
    fs.rmSync(targetDirectory, { recursive: true, force: true });
  }
});

test("migra cuentas 2FA existentes a comandos únicos sin perder clientes ni claves", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const service = new AuthenticatorService({
      store,
      encryptionKey: "clave-estable-migracion"
    });
    service.createAccount({
      name: "GPT01",
      service: "ChatGPT Plus",
      email: "uno@correo.test",
      secret: "JBSWY3DPEHPK3PXP"
    });
    service.createAccount({
      name: "GPT02",
      service: "ChatGPT Plus",
      email: "dos@correo.test",
      secret: "JBSWY3DPEHPK3PXP"
    });
    service.createAccount({
      name: "GROK01",
      service: "Super Grok",
      email: "tres@correo.test",
      secret: "JBSWY3DPEHPK3PXP"
    });
    const client = store.createClient({
      name: "Cliente conservado",
      whatsapp: "999888777",
      product: "Plan Pro",
      startDate: "2026-07-01",
      expiryDate: "2026-08-01",
      status: "activo"
    });
    const legacy = store.snapshot();
    legacy.authenticatorAccounts = legacy.authenticatorAccounts.map(
      ({ command: _command, ...account }) => account
    );
    fs.writeFileSync(
      path.join(directory, "jadrixservs-v4.json"),
      `${JSON.stringify(legacy, null, 2)}\n`,
      "utf8"
    );

    const reloaded = new JsonStore(directory);
    assert.deepEqual(
      reloaded
        .listAuthenticatorAccounts()
        .map((account) => account.command)
        .sort(),
      ["/gpt01", "/gpt02", "/grok01"]
    );
    assert.equal(reloaded.getClient(client.id).name, "Cliente conservado");
    assert.match(
      reloaded.listAuthenticatorAccounts()[0].encryptedSecret,
      /^v1\./
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("impide comandos 2FA duplicados o reservados para registrar clientes", () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const service = new AuthenticatorService({
      store,
      encryptionKey: "clave-estable-comandos"
    });
    service.createAccount({
      name: "GPT01",
      service: "ChatGPT Plus",
      email: "uno@correo.test",
      command: "/gpt01",
      secret: "JBSWY3DPEHPK3PXP"
    });

    assert.throws(
      () =>
        service.createAccount({
          name: "GPT alterno",
          service: "ChatGPT Plus",
          email: "dos@correo.test",
          command: "/GPT01",
          secret: "JBSWY3DPEHPK3PXP"
        }),
      /ya pertenece/i
    );
    assert.throws(
      () =>
        service.createAccount({
          name: "Cuenta de producto",
          service: "ChatGPT Pro",
          email: "tres@correo.test",
          command: "/gptpro",
          secret: "JBSWY3DPEHPK3PXP"
        }),
      /reservado/i
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("entrega de inmediato un código que conserva entre 20 y 30 segundos", async () => {
  const directory = temporaryDataDir();
  try {
    let now = 5_000;
    const waits = [];
    const store = new JsonStore(directory);
    const service = new AuthenticatorService({
      store,
      encryptionKey: "clave-estable-ventana",
      clock: () => now,
      sleepFn: async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      }
    });
    service.createAccount({
      name: "GPT01",
      service: "ChatGPT Plus",
      email: "cuenta@correo.test",
      secret: "JBSWY3DPEHPK3PXP"
    });

    const fresh = await service.getFreshCodeByCommand("/GPT01");
    assert.equal(fresh.command, "/gpt01");
    assert.ok(fresh.secondsRemaining >= 20);
    assert.ok(fresh.secondsRemaining <= 30);
    assert.deepEqual(waits, []);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("espera el siguiente código cuando al actual le quedan menos de 20 segundos", async () => {
  const directory = temporaryDataDir();
  try {
    let now = 25_000;
    const waits = [];
    const store = new JsonStore(directory);
    const service = new AuthenticatorService({
      store,
      encryptionKey: "clave-estable-espera",
      clock: () => now,
      sleepFn: async (milliseconds) => {
        waits.push(milliseconds);
        now += milliseconds;
      }
    });
    service.createAccount({
      name: "GPT01",
      service: "ChatGPT Plus",
      email: "cuenta@correo.test",
      secret: "JBSWY3DPEHPK3PXP"
    });

    const fresh = await service.getFreshCodeByCommand("/gpt01");
    assert.ok(waits.length >= 1);
    assert.ok(fresh.waitedMilliseconds >= 5_000);
    assert.ok(fresh.secondsRemaining >= 20);
    assert.ok(fresh.secondsRemaining <= 30);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("no envía cuentas cuyo periodo no puede garantizar 20 segundos útiles", async () => {
  const directory = temporaryDataDir();
  try {
    const store = new JsonStore(directory);
    const service = new AuthenticatorService({
      store,
      encryptionKey: "clave-estable-periodo",
      clock: () => 1_000,
      sleepFn: async () => undefined
    });
    service.createAccount({
      name: "Código corto",
      service: "Servicio de prueba",
      email: "cuenta@correo.test",
      secret:
        "otpauth://totp/Prueba?secret=JBSWY3DPEHPK3PXP&period=15"
    });

    await assert.rejects(
      service.getFreshCodeByCommand("/codigocorto"),
      (error) => error.code === "AUTHENTICATOR_WINDOW_UNAVAILABLE"
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
