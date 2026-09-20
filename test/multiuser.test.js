"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { JsonStore } = require("../src/store");
const { AuthenticatorService } = require("../src/authenticator-service");
const { parseRegistrationCommand } = require("../src/command-registry");
const { Accounts } = require("../src/accounts");

test("usuarios independientes conservan la base anterior y aíslan todos los accesos HTTP", async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "jadrix-multiuser-"));
  const originalEnv = { ...process.env };
  Object.assign(process.env, {
    DATA_DIR: directory, MEDIA_DIR: path.join(directory, "media"),
    DISABLE_WHATSAPP: "1", NODE_ENV: "test", COOKIE_SECRET: "test-multiuser-cookie",
    AUTHENTICATOR_ENCRYPTION_KEY: "test-existing-auth-key", GEMINI_ENCRYPTION_KEY: "test-ai-key",
    OPENAI_API_KEY: "", CLAUDE_API_KEY: "", GEMINI_API_KEY: ""
  });
  const legacy = new JsonStore(directory);
  const ownerClient = legacy.createClient({ name: "Cliente existente", whatsapp: "999888777", product: "ChatGPT Plus", startDate: "2026-09-20", expiryDate: "2026-10-20" });
  const auth = new AuthenticatorService({ store: legacy, encryptionKey: process.env.AUTHENTICATOR_ENCRYPTION_KEY });
  const oldAccount = auth.createAccount({ name: "Cuenta conservada", service: "Google", email: "test@example.com", command: "/original", secret: "JBSWY3DPEHPK3PXP" });
  const legacyBytes = fs.readFileSync(legacy.filePath);
  fs.mkdirSync(path.join(directory, "whatsapp-session"));
  const sessionPath = path.join(directory, "whatsapp-session", "legacy-marker");
  fs.writeFileSync(sessionPath, "conservar");
  const { app, accounts, getTenant, shutdownTenants } = require("../src/server");
  // Exercise login without publishing the installation's real password in fixtures.
  const ownerPassword = "owner-test-password";
  const ownerSalt = crypto.randomBytes(16).toString("hex");
  accounts.users[0].passwordHash = `${ownerSalt}:${crypto.scryptSync(ownerPassword, ownerSalt, 64).toString("hex")}`;
  accounts.save();
  const server = await new Promise(resolve => { const handle = app.listen(0, "127.0.0.1", () => resolve(handle)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(url, { cookie = "", method = "GET", body } = {}) {
    const response = await fetch(`${base}${url}`, { method, headers: { cookie, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const payload = response.headers.get("content-type")?.includes("application/json") ? await response.json() : await response.text();
    return { status: response.status, payload, cookie: response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") };
  }
  try {
    await t.test("migración sin mover clientes ni sesión; copia idéntica y propietario persistente", () => {
      assert.deepEqual(fs.readFileSync(`${legacy.filePath}.pre-multiuser`), legacyBytes);
      assert.equal(fs.readFileSync(sessionPath, "utf8"), "conservar");
      assert.equal(accounts.list()[0].username, "JadrixGR");
      assert.equal(accounts.directory(accounts.list()[0]), directory);
      assert.equal(new Accounts(directory).list().length, 1);
      assert.equal(fs.readFileSync(accounts.filePath, "utf8").includes(ownerPassword), false);
    });
    const owner = await request("/api/auth/login", { method: "POST", body: { username: "JadrixGR", password: ownerPassword } });
    assert.equal(owner.status, 200);
    const a = owner.cookie;
    await t.test("sesión antigua y visitante no acceden a los clientes", async () => {
      assert.equal((await request("/api/clients")).status, 401);
      assert.equal((await request("/api/admin/users")).status, 401);
      assert.equal((await request("/api/auth/login", { method: "POST", body: { password: ownerPassword } })).status, 401);
    });
    const created = await request("/api/admin/users", { cookie: a, method: "POST", body: { username: "Login Serv", password: "1834", role: "admin", id: "owner" } });
    assert.equal(created.status, 201);
    assert.equal(created.payload.role, "user");
    assert.notEqual(created.payload.id, "owner");
    const other = await request("/api/auth/login", { method: "POST", body: { username: "Login Serv", password: "1834" } });
    const b = other.cookie;
    assert.equal(other.status, 200);
    await t.test("solo el administrador crea/lista usuarios y no se exponen contraseñas", async () => {
      assert.equal((await request("/api/admin/users", { cookie: b })).status, 403);
      assert.equal((await request("/api/admin/users", { cookie: b, method: "POST", body: { username: "Intruso", password: "1234" } })).status, 403);
      const list = await request("/api/admin/users", { cookie: a });
      assert.equal(list.payload.length, 2);
      assert.equal(JSON.stringify(list.payload).includes("password"), false);
      assert.equal((await request("/api/admin/users", { cookie: a, method: "POST", body: { username: "login serv", password: "5678" } })).status, 400);
    });
    const ownerTenant = getTenant(owner.payload.user);
    const otherTenant = getTenant(other.payload.user);
    await t.test("clientes, WhatsApp, claves e instancias son propios de cada cuenta", async () => {
      assert.equal((await request("/api/clients", { cookie: a })).payload[0].id, ownerClient.id);
      assert.deepEqual((await request("/api/clients?tenantId=owner", { cookie: b })).payload, []);
      assert.notEqual(ownerTenant.whatsapp, otherTenant.whatsapp);
      assert.notEqual(ownerTenant.scheduler, otherTenant.scheduler);
      assert.notEqual(ownerTenant.whatsapp.sessionDir, otherTenant.whatsapp.sessionDir);
      assert.equal(ownerTenant.whatsapp.sessionDir, path.join(directory, "whatsapp-session"));
      assert.notEqual(ownerTenant.ai.encryptionKey, otherTenant.ai.encryptionKey);
      assert.equal(otherTenant.ai.claudeEnvironmentKey, "");
      const originalAccounts = (await request("/api/authenticator", { cookie: a })).payload.accounts;
      assert.equal(originalAccounts[0].id, oldAccount.id);
      assert.equal(originalAccounts[0].available, true);
      assert.match(originalAccounts[0].code, /^\d{6}$/);
      assert.equal((await request("/api/authenticator", { cookie: b })).payload.accounts.length, 0);
    });
    const otherClient = await request("/api/clients", { cookie: b, method: "POST", body: { name: "Cliente de Login Serv", whatsapp: "999888777", product: "Netflix", startDate: "2026-09-20", expiryDate: "2026-11-20", tenantId: "owner" } });
    assert.equal(otherClient.status, 201);
    await t.test("mismo número puede tener registros distintos; no se editan ni eliminan IDs ajenos", async () => {
      assert.equal((await request("/api/clients", { cookie: a })).payload.length, 1);
      assert.equal((await request("/api/clients", { cookie: b })).payload[0].product, "Netflix");
      assert.equal((await request(`/api/clients/${ownerClient.id}`, { cookie: b, method: "PUT", body: { name: "No autorizado" } })).status, 404);
      assert.equal((await request(`/api/clients/${ownerClient.id}`, { cookie: b, method: "DELETE" })).status, 404);
      assert.equal((await request("/api/clients/broadcast/status/owner-job", { cookie: b })).status, 404);
    });
    await t.test("respaldos, CSV y ajustes muestran solo el usuario actual", async () => {
      const backup = (await request("/api/backup/data.json", { cookie: b })).payload;
      assert.equal(backup.clients[0].id, otherClient.payload.id);
      assert.equal(JSON.stringify(backup).includes(ownerClient.id), false);
      assert.equal(JSON.stringify(backup).includes("passwordHash"), false);
      const csv = (await request("/api/export/clients.csv", { cookie: b })).payload;
      assert.match(csv, /Cliente de Login Serv/);
      assert.doesNotMatch(csv, /Cliente existente/);
      await request("/api/settings", { cookie: b, method: "PUT", body: { businessName: "Negocio B" } });
      assert.notEqual(ownerTenant.store.getSettings().businessName, "Negocio B");
      assert.equal(otherTenant.store.getSettings().businessName, "Negocio B");
      backup.media.dicloakAudio = { path: path.join(directory, "media", "owner.ogg") };
      assert.equal((await request("/api/backup/restore", { cookie: b, method: "POST", body: backup })).status, 400);
    });
    await t.test("catálogos simultáneos no cambian los comandos del otro usuario", () => {
      ownerTenant.store.data.products = [{ id: "a", command: "/exclusivoa", name: "Producto A", price: "S/10" }];
      otherTenant.store.data.products = [{ id: "b", command: "/exclusivob", name: "Producto B", price: "S/20" }];
      const aCatalog = ownerTenant.store.snapshot();
      const bCatalog = otherTenant.store.snapshot();
      assert.equal(parseRegistrationCommand("/exclusivoa 30", aCatalog).ok, true);
      assert.equal(parseRegistrationCommand("/exclusivoa 30", bCatalog).ok, false);
      assert.equal(parseRegistrationCommand("/exclusivob 30", bCatalog).ok, true);
      assert.equal(parseRegistrationCommand("/exclusivob 30", aCatalog).ok, false);
    });
    await t.test("reiniciar conserva usuarios y datos; cerrar sesión revoca solo su acceso", async () => {
      const reloaded = new Accounts(directory);
      assert.equal(reloaded.list().length, 2);
      assert.ok(await reloaded.login("Login Serv", "1834"));
      assert.equal(new JsonStore(reloaded.directory(created.payload)).listClients()[0].id, otherClient.payload.id);
      await request("/api/auth/logout", { cookie: b, method: "POST" });
      assert.equal((await request("/api/clients", { cookie: b })).status, 401);
      assert.equal((await request("/api/clients", { cookie: a })).status, 200);
      assert.equal(fs.readFileSync(sessionPath, "utf8"), "conservar");
    });
  } finally {
    await shutdownTenants();
    await new Promise(resolve => server.close(resolve));
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
