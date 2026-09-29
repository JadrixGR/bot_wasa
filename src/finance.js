"use strict";

const crypto = require("node:crypto");
const { parseDateOnly, todayInTimeZone } = require("./date-utils");
const CURRENCIES = ["PEN", "USD", "MXN", "ARS", "EUR", "COP", "CLP", "BOB", "BRL"];
const CATEGORIES = ["Publicidad", "Costo de productos", "Comisiones", "Envíos", "Servicios", "Otros"];

function validDate(value) {
  try { parseDateOnly(value); return value; } catch { return null; }
}

function amountToMinor(value) {
  const text = String(value ?? "").trim();
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(text)) throw new Error("Ingresa un importe positivo con hasta dos decimales, sin separadores de miles.");
  const [whole, fraction = ""] = text.replace(",", ".").split(".");
  const amount = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > 99999999999) throw new Error("El importe debe ser mayor que cero y menor que mil millones.");
  return amount;
}

function priceForLedger(price) {
  const text = String(price || "").trim();
  // A bare $ or number does not establish a currency. Never guess one.
  const match = /^(S\/\.?|PEN|US\$|USD|MX\$|MXN|AR\$|ARS|EUR|€|COP|CLP|BOB|BRL)\s*(\d+(?:[.,]\d{1,2})?)$/i.exec(text);
  if (!match) return { amountMinor: null, currency: "" };
  const aliases = { "S/": "PEN", "S/.": "PEN", "US$": "USD", "MX$": "MXN", "AR$": "ARS", "€": "EUR" };
  try { return { amountMinor: amountToMinor(match[2]), currency: aliases[match[1].toUpperCase()] || match[1].toUpperCase() }; }
  catch { return { amountMinor: null, currency: "" }; }
}

function saleFromClient(client, { source = "registro", date } = {}) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), type: "sale", clientId: client.id,
    date: validDate(date || client.lastPaymentDate || client.startDate),
    ...priceForLedger(client.price), description: String(client.product || "Venta").slice(0, 200),
    category: "Ventas", source, notes: `Precio original: ${client.price || "sin importe"}`,
    voided: false, createdAt: now, updatedAt: now
  };
}

function initialFinance(data) {
  if (data.finance && Array.isArray(data.finance.entries)) return structuredClone(data.finance);
  return { version: 1, startedAt: new Date().toISOString(), entries: (data.clients || [])
    .filter(client => client.status !== "pendiente")
    .map(client => saleFromClient(client, { source: "recuperado" })) };
}

function normalizeEntry(input, previous = null) {
  const type = previous?.type || input.type;
  if (!["sale", "expense"].includes(type)) throw new Error("Selecciona venta o gasto.");
  if (!validDate(input.date)) throw new Error("Ingresa una fecha válida (AAAA-MM-DD).");
  const currency = String(input.currency || "").toUpperCase();
  if (!CURRENCIES.includes(currency)) throw new Error("Selecciona una moneda válida.");
  const description = String(input.description || "").trim().slice(0, 200);
  if (!description) throw new Error("Ingresa el concepto del movimiento.");
  const category = type === "sale" ? "Ventas" : String(input.category || "Otros");
  if (type === "expense" && !CATEGORIES.includes(category)) throw new Error("Selecciona una categoría de gasto válida.");
  const now = new Date().toISOString();
  return { id: previous?.id || crypto.randomUUID(), type, date: input.date,
    amountMinor: amountToMinor(input.amount), currency, description, category,
    notes: String(input.notes || "").trim().slice(0, 1000), clientId: previous?.clientId || null,
    source: previous?.source || "manual", voided: previous?.voided || false,
    createdAt: previous?.createdAt || now, updatedAt: now };
}

function financialReport(finance, { from, to } = {}) {
  const timeZone = process.env.BOT_TIMEZONE || "America/Lima";
  const today = todayInTimeZone(timeZone);
  from = from === undefined ? `${today.slice(0, 7)}-01` : from;
  to = to === undefined ? today : to;
  if (!validDate(from) || !validDate(to)) throw new Error("Selecciona fechas válidas para el reporte.");
  if (from > to) throw new Error("La fecha inicial no puede ser posterior a la final.");
  const entries = finance.entries.filter(e => e.date && e.date >= from && e.date <= to)
    .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  const active = entries.filter(e => !e.voided);
  const totals = new Map();
  for (const entry of active) {
    if (!CURRENCIES.includes(entry.currency) || !Number.isSafeInteger(entry.amountMinor) || entry.amountMinor <= 0) continue;
    if (!totals.has(entry.currency)) totals.set(entry.currency, { currency: entry.currency, salesCount: 0, incomeMinor: 0, expenseMinor: 0, balanceMinor: 0, categories: {} });
    const total = totals.get(entry.currency);
    if (entry.type === "sale") { total.incomeMinor += entry.amountMinor; total.salesCount++; }
    else { total.expenseMinor += entry.amountMinor; total.categories[entry.category] = (total.categories[entry.category] || 0) + entry.amountMinor; }
    total.balanceMinor = total.incomeMinor - total.expenseMinor;
  }
  const needsReview = e => !e.voided && (!validDate(e.date) || !CURRENCIES.includes(e.currency) || !Number.isSafeInteger(e.amountMinor) || e.amountMinor <= 0);
  return { from, to, today, timeZone, startedAt: finance.startedAt,
    salesCount: active.filter(e => e.type === "sale").length,
    expenseCount: active.filter(e => e.type === "expense").length,
    recoveredCount: active.filter(e => e.source === "recuperado").length,
    reviewCount: active.filter(needsReview).length,
    undatedEntries: finance.entries.filter(e => !e.date && !e.voided),
    totals: [...totals.values()].sort((a, b) => a.currency.localeCompare(b.currency)), entries };
}

function reportCsv(report) {
  const cell = value => {
    let text = String(value ?? "");
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows = [
    ["Estado de ingresos y gastos", report.from, report.to, report.timeZone],
    ["Ventas registradas", report.salesCount],
    ["Registros recuperados", report.recoveredCount],
    ["Importes por revisar (excluidos de totales)", report.reviewCount],
    ["Sin fecha (fuera del periodo)", report.undatedEntries.length],
    ["Moneda", "Ventas", "Ingresos", "Gastos", "Resultado"],
    ...report.totals.map(t => [t.currency, t.salesCount, (t.incomeMinor / 100).toFixed(2), (t.expenseMinor / 100).toFixed(2), (t.balanceMinor / 100).toFixed(2)]),
    [], ["Fecha", "Tipo", "Concepto", "Categoría", "Moneda", "Importe", "Estado", "Origen", "Notas"],
    ...report.entries.map(e => [e.date, e.type === "sale" ? "Venta" : "Gasto", e.description, e.category, e.currency, e.amountMinor === null ? "" : (e.amountMinor / 100).toFixed(2), e.voided ? "Anulado" : e.amountMinor === null || !e.currency ? "Revisar" : "Registrado", e.source, e.notes]),
    [], ["Resultado = ingresos menos gastos registrados. Incluye solo los datos disponibles; no reconstruye renovaciones anteriores ni convierte monedas."]
  ];
  return `\uFEFF${rows.map(row => row.map(cell).join(",")).join("\r\n")}`;
}

module.exports = { CURRENCIES, CATEGORIES, amountToMinor, priceForLedger, saleFromClient, initialFinance, normalizeEntry, financialReport, reportCsv };
