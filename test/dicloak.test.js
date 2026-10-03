"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { JsonStore } = require("../src/store");
const { Dicloak } = require("../src/dicloak");
const { Accounts } = require("../src/accounts");
const range = { from: "2026-10-01", to: "2026-10-31" };
const client = { name: "Cliente privado", whatsapp: "999888777", product: "Chat gpt pro", startDate: "2026-10-03", expiryDate: "2026-11-03" };
const hash = password => { const salt = crypto.randomBytes(16).toString("hex"); return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`; };

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dicloak-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const rules = new Dicloak(dir);
  const store = new JsonStore(dir, { dicloakRules: () => rules.rules() });
  return { dir, rules, store };
}

test("los tres productos registran cobro, ganancia y un gasto vinculado sin doble descuento", t => {
  const { store } = fixture(t);
  for (const product of ["Chat gpt pro", "Plan Pro", "PLAN MAX"]) store.createClient({ ...client, product });
  store.createClient({ ...client, product: "Netflix", price: "S/10" });
  const report = store.financialReport(range);
  const total = report.totals[0];
  assert.equal(total.incomeMinor, 16500);
  assert.equal(total.dicloakMinor, 7000);
  assert.equal(total.expenseMinor, 7000);
  assert.equal(total.balanceMinor, 9500);
  assert.equal(total.netSalesMinor, 9500);
  assert.equal(report.expenseCount, 3);
  assert.deepEqual(report.entries.filter(e => e.dicloak).map(e => e.amountMinor - e.dicloak.amountMinor).sort(), [2500, 3000, 3000]);
  assert.equal(store.listCatalog().find(p => p.id === "plan-pro").price, "S/50.00");
});

test("pendientes, renovaciones, ediciones y reinicios no duplican aportes ni reescriben ventas anteriores", t => {
  const { dir, store, rules } = fixture(t);
  const pending = store.createClient({ ...client, status: "pendiente" });
  assert.equal(store.financialReport(range).expenseCount, 0);
  store.updateClient(pending.id, { status: "activo", lastPaymentDate: "2026-10-03" });
  const original = store.financialReport(range).entries.find(e => e.type === "sale");
  rules.saveRule({ name: "ChatGPT Pro", price: "55", contribution: "22.25" }, "chatgpt-pro");
  store.syncDicloakCatalog();
  store.updateClient(pending.id, { notes: "Cambio sin venta" });
  store.saveFinancialEntry({ ...original, amount: "46", notes: "Corrección" }, original.id);
  assert.equal(store.financialReport(range).totals[0].dicloakMinor, 2000);
  store.renewClient(pending.id, { paymentDate: "2026-10-04", price: "S/55" });
  assert.equal(store.financialReport(range).totals[0].dicloakMinor, 4225);
  store.setFinancialEntryVoided(original.id, true);
  assert.equal(store.financialReport(range).totals[0].dicloakMinor, 2225);
  store.setFinancialEntryVoided(original.id, false);
  store.setFinancialEntryVoided(original.id, false);
  assert.equal(store.financialReport(range).expenseCount, 2);
  assert.throws(() => store.setFinancialEntryVoided(`dicloak:${original.id}`, true), /venta vinculada/);
  assert.throws(() => store.saveFinancialEntry({ amount: "1" }, `dicloak:${original.id}`), /venta vinculada/);
  const reload = new JsonStore(dir, { dicloakRules: () => new Dicloak(dir).rules() });
  assert.equal(reload.financialReport(range).totals[0].dicloakMinor, 4225);
  const backup = reload.snapshot();
  reload.restoreSnapshot(backup);
  assert.equal(reload.financialReport(range).expenseCount, 2);
});

test("no aplica cargos retroactivos, a otras monedas o a productos desactivados", t => {
  const { dir, rules } = fixture(t);
  const legacy = new JsonStore(dir);
  legacy.createClient({ ...client, price: "S/45" });
  const store = new JsonStore(dir, { dicloakRules: () => rules.rules() });
  store.createClient({ ...client, price: "USD 45" });
  store.createClient({ ...client, product: "HBO Max", price: "S/7" });
  rules.saveRule({ name: "ChatGPT Pro", price: "45", contribution: "20", enabled: false }, "chatgpt-pro");
  store.createClient({ ...client, price: "S/45" });
  assert.equal(store.financialReport(range).expenseCount, 0);
  rules.saveRule({ name: "ChatGPT Pro", price: "45", contribution: "20" }, "chatgpt-pro");
  for (const sale of store.financialReport(range).entries) store.saveFinancialEntry({ ...sale, amount: String(sale.amountMinor / 100) }, sale.id);
  assert.equal(store.financialReport(range).expenseCount, 0);
});

test("productos agregados y ventas manuales guardan importes exactos y validan reglas", t => {
  const { rules, store } = fixture(t);
  rules.saveRule({ name: "Nuevo producto", aliases: "producto nuevo", price: "19.90", contribution: "5.25" });
  store.syncDicloakCatalog();
  assert.ok(store.listCatalog().some(p => p.name === "Nuevo producto"));
  const sale = store.saveFinancialEntry({ type: "sale", description: "producto nuevo", amount: "19.90", currency: "PEN", date: "2026-10-10" });
  assert.equal(sale.dicloak.amountMinor, 525);
  assert.equal(store.financialReport(range).totals[0].balanceMinor, 1465);
  const edited = store.saveFinancialEntry({ ...sale, amount: "19.90", description: "Netflix" }, sale.id);
  assert.equal(edited.dicloak, null);
  assert.equal(store.financialReport(range).expenseCount, 0);
  assert.throws(() => rules.saveRule({ name: "Chat GPT Pro", price: "45", contribution: "20" }), /ya tiene/);
  assert.throws(() => rules.saveRule({ name: "Otro", price: "5", contribution: "6" }), /superar/);
  assert.throws(() => rules.saveRule({ name: "Otro", price: "5", contribution: "-1" }));
});

test("cuenta y resumen comparten solo aportes: tres vendedores, permisos HTTP y persistencia", async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dicloak-http-"));
  const originalEnv = { ...process.env };
  Object.assign(process.env, { DATA_DIR: dir, MEDIA_DIR: path.join(dir, "media"), DISABLE_WHATSAPP: "1", NODE_ENV: "test",
    COOKIE_SECRET: "dicloak-test-cookie", DICLOAK_PASSWORD_HASH: hash("dicloak-fixture") });
  const { app, accounts, getTenant, shutdownTenants } = require("../src/server");
  accounts.users[0].passwordHash = hash("owner-fixture");
  accounts.save();
  await accounts.create({ username: "Vendedor dos", password: "seller-fixture" });
  await accounts.create({ username: "Vendedor tres", password: "seller-fixture" });
  const server = await new Promise(resolve => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (url, cookie = "", method = "GET", body) => {
    const response = await fetch(base + url, { method, headers: { cookie, "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json(), cookie: response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ") };
  };
  const login = async (username, password) => (await request("/api/auth/login", "", "POST", { username, password })).cookie;
  try {
    const owner = await login("JadrixGR", "owner-fixture"), seller = await login("Vendedor dos", "seller-fixture"), reader = await login("Dicloak", "dicloak-fixture");
    assert.ok(reader);
    for (const user of accounts.list().filter(u => u.role !== "dicloak")) getTenant(user).store.createClient({ ...client, price: "S/45" });
    const query = "?from=2026-10-01&to=2026-10-31";
    assert.equal((await request(`/api/dicloak${query}`)).status, 401);
    const global = await request(`/api/dicloak${query}`, reader);
    assert.equal(global.body.totalMinor, 6000);
    assert.equal(global.body.byUser.length, 3);
    assert.equal(global.body.canEdit, false);
    assert.equal(JSON.stringify(global.body).includes("Cliente privado"), false);
    assert.equal(JSON.stringify(global.body).includes("999888777"), false);
    assert.equal((await request(`/api/dicloak${query}&tenantId=owner`, seller)).body.totalMinor, 2000);
    assert.equal((await request(`/api/dicloak${query}`, owner)).body.totalMinor, 6000);
    for (const url of ["/api/clients", "/api/settings", "/api/whatsapp/status", "/api/finance", "/api/authenticator", "/api/backup/data.json", "/api/admin/users"]) assert.equal((await request(url, reader)).status, 403, url);
    for (const cookie of [seller, reader]) assert.equal((await request("/api/dicloak/rules", cookie, "POST", { name: "Intruso", price: "10", contribution: "2" })).status, 403);
    assert.equal((await request("/api/dicloak/rules/plan-pro", owner, "PUT", { name: "Plan Pro", price: "52", contribution: "21" })).status, 200);
    for (const user of accounts.list().filter(u => u.role !== "dicloak")) assert.equal(getTenant(user).store.listCatalog().find(p => p.id === "plan-pro").price, "S/52.00");
    assert.equal((await request("/api/dicloak?from=bad&to=2026-10-31", reader)).status, 400);
    const reload = new Accounts(dir);
    reload.ensureDicloak(hash("must-not-replace"));
    assert.equal(reload.list().length, 4);
    assert.ok(await reload.login("Dicloak", "dicloak-fixture"));
    assert.equal(await reload.login("Dicloak", "must-not-replace"), null);
    assert.equal(fs.readFileSync(reload.filePath, "utf8").includes("dicloak-fixture"), false);
  } finally {
    await shutdownTenants();
    await new Promise(resolve => server.close(resolve));
    for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
    Object.assign(process.env, originalEnv);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
