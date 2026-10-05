"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { amountToMinor, financialReport } = require("./finance");

const productKey = value => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const DEFAULT_RULES = [
  { id: "chatgpt-pro", name: "ChatGPT Pro", aliases: ["Chat gpt pro", "gpt pro", "pro de chatgpt"], priceMinor: 4500, contributionMinor: 2000, itemType: "product", command: "/gptpro", enabled: true },
  { id: "plan-pro", name: "Plan Pro", aliases: ["combo pro"], priceMinor: 5000, contributionMinor: 2000, itemType: "plan", command: "/planpro", enabled: true },
  { id: "plan-max", name: "Plan Max", aliases: ["combo max"], priceMinor: 6000, contributionMinor: 3000, itemType: "plan", command: "/planmax", enabled: true }
];

function matchingRule(rules, name) {
  const key = productKey(name);
  return key ? rules.find(rule => [rule.name, ...(rule.aliases || [])].some(name => productKey(name) === key)) : undefined;
}

function allocateSale(entry, rules, previous = null) {
  // Preserve the cost agreed on the original sale, including an explicit zero.
  const sameProduct = previous && productKey(previous.description) === productKey(entry.description);
  if (sameProduct && previous.currency === entry.currency) return { ...entry, dicloak: previous.dicloak || null };
  const rule = matchingRule(rules, entry.description);
  return { ...entry, dicloak: rule?.enabled && entry.currency === "PEN" && Number.isSafeInteger(entry.amountMinor)
    ? { ruleId: rule.id, product: rule.name, amountMinor: rule.contributionMinor } : null };
}

function syncContribution(entries, sale) {
  const id = `dicloak:${sale.id}`;
  const index = entries.findIndex(entry => entry.id === id);
  if (!sale.dicloak?.amountMinor) {
    if (index >= 0) entries.splice(index, 1);
    return;
  }
  const expense = { id, type: "expense", saleId: sale.id, date: sale.date, currency: "PEN",
    amountMinor: sale.dicloak.amountMinor, description: `Pago a Dicloak · ${sale.dicloak.product}`,
    category: "Pago a Dicloak", source: "dicloak", notes: "Generado automáticamente por la venta vinculada.",
    voided: sale.voided, createdAt: sale.createdAt, updatedAt: sale.updatedAt };
  if (index >= 0) entries[index] = expense;
  else entries.push(expense);
}

class Dicloak {
  constructor(dataDir) {
    this.filePath = path.join(dataDir, "dicloak.json");
    this.data = fs.existsSync(this.filePath) ? JSON.parse(fs.readFileSync(this.filePath, "utf8"))
      : { version: 1, startedAt: new Date().toISOString(), rules: structuredClone(DEFAULT_RULES) };
    if (!Array.isArray(this.data.rules)) throw new Error("La configuración de Dicloak no es válida.");
    if (!fs.existsSync(this.filePath)) this.save(this.data);
  }

  save(data) {
    fs.writeFileSync(`${this.filePath}.tmp`, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(`${this.filePath}.tmp`, this.filePath);
    this.data = data;
  }

  rules() { return structuredClone(this.data.rules); }

  saveRule(input, id = null) {
    const previous = id ? this.data.rules.find(rule => rule.id === id) : null;
    if (id && !previous) throw new Error("Producto de Dicloak no encontrado.");
    const name = String(input.name || "").trim();
    if (!name || name.length > 100) throw new Error("Ingresa un producto de hasta 100 caracteres.");
    const aliases = [...new Set([...(input.aliases === undefined ? previous?.aliases || [] : String(input.aliases || "").split(",").map(x => x.trim()).filter(Boolean)),
      ...(previous && previous.name !== name ? [previous.name] : [])])];
    if (aliases.length > 30 || aliases.some(x => x.length > 100)) throw new Error("Usa hasta 30 nombres alternativos de 100 caracteres.");
    const keys = [name, ...aliases].map(productKey);
    if (keys.some(key => !key)) throw new Error("El nombre debe contener letras o números.");
    if (this.data.rules.some(rule => rule.id !== id && [rule.name, ...rule.aliases].some(x => keys.includes(productKey(x))))) {
      throw new Error("Ese producto o nombre alternativo ya tiene un aporte configurado.");
    }
    const priceMinor = amountToMinor(input.price);
    const contributionMinor = amountToMinor(input.contribution);
    if (contributionMinor > priceMinor) throw new Error("El aporte no puede superar el precio del producto.");
    const rule = { id: previous?.id || crypto.randomUUID(), name, aliases, priceMinor, contributionMinor,
      itemType: previous?.itemType || (input.itemType === "plan" ? "plan" : "product"),
      command: previous?.command || `/d${crypto.randomBytes(5).toString("hex")}`,
      enabled: input.enabled !== false, updatedAt: new Date().toISOString() };
    const data = structuredClone(this.data);
    if (previous) data.rules[data.rules.findIndex(r => r.id === id)] = rule;
    else data.rules.push(rule);
    this.save(data);
    return structuredClone(rule);
  }

  report(users, getStore, filters) {
    const period = financialReport({ entries: [] }, filters);
    const entries = [], byUser = [];
    for (const user of users) {
      const store = getStore(user);
      const clients = store.financialClients();
      const sales = store.data.finance.entries.filter(e => e.type === "sale" && !e.voided && e.dicloak?.amountMinor && e.currency === "PEN" && e.date >= period.from && e.date <= period.to);
      const total = sales.reduce((sum, e) => sum + e.dicloak.amountMinor, 0);
      byUser.push({ userId: user.id, username: user.username, salesCount: sales.length, amountMinor: total });
      for (const sale of sales) {
        const client = clients.get(sale.clientId);
        entries.push({ id: `${user.id}:${sale.id}`, date: sale.date, username: user.username,
          client: client || null,
          product: sale.dicloak.product, amountMinor: sale.dicloak.amountMinor });
      }
    }
    entries.sort((a, b) => b.date.localeCompare(a.date) || a.username.localeCompare(b.username));
    return { from: period.from, to: period.to, today: period.today, timeZone: period.timeZone,
      startedAt: this.data.startedAt, currency: "PEN", totalMinor: byUser.reduce((sum, u) => sum + u.amountMinor, 0),
      salesCount: entries.length, byUser, entries };
  }
}

module.exports = { Dicloak, matchingRule, allocateSale, syncContribution, productKey };
