"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { JsonStore } = require("../src/store");
const { amountToMinor, priceForLedger, financialReport, reportCsv } = require("../src/finance");

function storeFor(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "jadrix-finance-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new JsonStore(dir);
}
const client = { name: "Prueba", whatsapp: "999888777", product: "Producto", price: "S/30.10", startDate: "2026-09-01", expiryDate: "2026-10-01" };
const range = { from: "2026-09-01", to: "2026-09-30" };

test("importes exactos y monedas explícitas, sin adivinar precios ambiguos", () => {
  assert.equal(amountToMinor("30,10"), 3010);
  assert.equal(amountToMinor("0.29"), 29);
  for (const amount of ["", "-1", "1e3", "0", "1,000", "NaN", "1000000000"]) assert.throws(() => amountToMinor(amount));
  assert.deepEqual(priceForLedger("S/ 30.10"), { currency: "PEN", amountMinor: 3010 });
  assert.deepEqual(priceForLedger("MX$ 500"), { currency: "MXN", amountMinor: 50000 });
  for (const price of ["$30", "30", "S/20 o S/30", "S/1,000", "Gratis"]) assert.equal(priceForLedger(price).amountMinor, null);
});

test("ventas y renovaciones conservan el historial al editar, archivar y eliminar clientes", t => {
  const store = storeFor(t);
  const c = store.createClient(client);
  store.renewClient(c.id, { paymentDate: "2026-09-30", price: "S/50" });
  store.updateClient(c.id, { price: "S/999" });
  store.archiveClient(c.id);
  store.deleteClient(c.id);
  const report = store.financialReport(range);
  assert.equal(report.salesCount, 2);
  assert.equal(report.totals[0].incomeMinor, 8010);
  assert.equal(report.entries[0].date, "2026-09-30");
  assert.equal(new JsonStore(store.dataDir).financialReport(range).salesCount, 2);
  const backup = store.snapshot();
  store.restoreSnapshot(backup);
  assert.equal(store.financialReport(range).salesCount, 2);
});

test("pendientes solo generan venta al activarse y no duplican por ediciones", t => {
  const store = storeFor(t);
  const c = store.createClient({ ...client, status: "pendiente" });
  assert.equal(store.snapshot().finance.entries.length, 0);
  store.updateClient(c.id, { status: "activo", lastPaymentDate: "2026-09-05" });
  store.updateClient(c.id, { status: "pendiente" });
  store.updateClient(c.id, { status: "activo" });
  assert.equal(store.financialReport(range).salesCount, 1);
  const pendingRenewal = store.createClient({ ...client, status: "pendiente" });
  store.renewClient(pendingRenewal.id, { paymentDate: "2026-09-05" });
  assert.equal(store.financialReport(range).salesCount, 2);
});

test("gastos por categoría, monedas separadas, límites inclusivos y anulación reversible", t => {
  const store = storeFor(t);
  store.createClient(client);
  store.createClient({ ...client, price: "USD 10", startDate: "2026-09-30" });
  store.createClient({ ...client, startDate: "2026-08-31" });
  store.createClient({ ...client, startDate: "2026-10-01" });
  const expense = store.saveFinancialEntry({ type: "expense", date: "2026-09-30", currency: "PEN", amount: "10.20", category: "Publicidad", description: "Meta" });
  let report = store.financialReport(range);
  assert.equal(report.salesCount, 2);
  assert.deepEqual(report.totals.map(t => [t.currency, t.incomeMinor, t.expenseMinor, t.balanceMinor]), [["PEN", 3010, 1020, 1990], ["USD", 1000, 0, 1000]]);
  assert.equal(report.totals[0].categories.Publicidad, 1020);
  store.setFinancialEntryVoided(expense.id, true);
  assert.equal(store.financialReport(range).totals[0].expenseMinor, 0);
  store.setFinancialEntryVoided(expense.id, false);
  store.saveFinancialEntry({ ...expense, amount: "40", description: "Meta corregido" }, expense.id);
  assert.equal(store.financialReport(range).totals[0].balanceMinor, -990);
  assert.throws(() => store.financialReport({ from: "2026-02-30", to: range.to }));
  assert.throws(() => store.financialReport({ from: range.to, to: range.from }));
  assert.throws(() => store.financialReport({ from: [], to: range.to }));
  assert.throws(() => store.saveFinancialEntry({ type: "expense", date: "2026-09-30", amount: "-1", currency: "PEN", description: "Error" }));
  assert.throws(() => store.setFinancialEntryVoided(expense.id, "false"));
  assert.throws(() => store.saveFinancialEntry({}, "ajeno"), /no encontrado/);
});

test("migración recupera solo la última compra, conserva incertidumbre y no duplica al reiniciar", t => {
  const store = storeFor(t);
  const snapshot = store.snapshot();
  delete snapshot.finance;
  snapshot.clients = [
    { ...client, id: "old", price: "$30", lastPaymentDate: "2026-09-20" },
    { ...client, id: "bad-date", startDate: "fecha desconocida" },
    { ...client, id: "pending", status: "pendiente" }
  ];
  store.restoreSnapshot(snapshot);
  let report = store.financialReport(range);
  assert.equal(report.salesCount, 1);
  assert.equal(report.recoveredCount, 1);
  assert.equal(report.reviewCount, 1);
  assert.equal(report.undatedEntries.length, 1);
  assert.deepEqual(report.totals, []);
  const old = report.entries[0];
  store.saveFinancialEntry({ ...old, amount: "30", currency: "PEN" }, old.id);
  const undated = report.undatedEntries[0];
  store.saveFinancialEntry({ ...undated, date: "2026-09-21", amount: "10", currency: "PEN" }, undated.id);
  report = new JsonStore(store.dataDir).financialReport(range);
  assert.equal(report.salesCount, 2);
  assert.equal(report.totals[0].incomeMinor, 4000);
  assert.equal(report.reviewCount, 0);
});

test("CSV contiene resumen y detalle, y neutraliza fórmulas de hojas de cálculo", t => {
  const store = storeFor(t);
  store.saveFinancialEntry({ type: "sale", date: range.from, currency: "PEN", amount: "10", description: '=HYPERLINK("test")', notes: "+1+1" });
  const csv = reportCsv(store.financialReport(range));
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /Ingresos/);
  assert.match(csv, /'\=HYPERLINK/);
  assert.match(csv, /'\+1\+1/);
  assert.equal(financialReport({ entries: [] }, range).salesCount, 0);
});
