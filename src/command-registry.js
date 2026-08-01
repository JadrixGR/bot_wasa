"use strict";

const { products: defaultProducts, plans: defaultPlans } = require("./defaults");

// Comandos históricos de JadrixServs. Se usan como base cuando un producto
// guardado en /data todavía no tiene su comando propio.
const baseCommandDefinitions = Object.freeze([
  { command: "/claudepro", itemId: "claude-pro", itemType: "product" },
  { command: "/gptpro", itemId: "chatgpt-pro", itemType: "product" },
  { command: "/gptplus", itemId: "chatgpt-plus", itemType: "product" },
  {
    command: "/gptpersonal",
    itemId: "chatgpt-plus-personal",
    itemType: "product"
  },
  { command: "/geminipro", itemId: "gemini-pro", itemType: "product" },
  { command: "/supergrok", itemId: "supergrok", itemType: "product" },
  {
    command: "/perplexitypro",
    itemId: "perplexity-pro",
    itemType: "product"
  },
  { command: "/gammapro", itemId: "gamma-pro", itemType: "product" },
  { command: "/capcutpro", itemId: "capcut-pro", itemType: "product" },
  { command: "/netflix", itemId: "netflix", itemType: "product" },
  { command: "/hbo", itemId: "hbo", itemType: "product" },
  { command: "/crunchyroll", itemId: "crunchyroll", itemType: "product" },
  { command: "/planpro", itemId: "plan-pro", itemType: "plan" },
  { command: "/planplus", itemId: "plan-plus", itemType: "plan" }
]);

const baseCommandByItemId = new Map(
  baseCommandDefinitions.map(({ command, itemId }) => [itemId, command])
);

let catalogProvider = null;

function configureCatalogSource(provider) {
  catalogProvider = typeof provider === "function" ? provider : null;
}

function normalizeRegistrationCommand(value) {
  const raw = String(value || "").trim().toLowerCase();
  const body = raw.startsWith("/") ? raw.slice(1) : raw;
  const clean = body.replace(/[^a-z0-9]/g, "");
  return clean ? `/${clean.slice(0, 32)}` : "";
}

function deriveRegistrationCommand(value) {
  return normalizeRegistrationCommand(
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
  );
}

function commandForItem(item, itemType) {
  const own = normalizeRegistrationCommand(item?.command);
  if (own) return own;
  const base = baseCommandByItemId.get(String(item?.id || ""));
  if (base) return base;
  return deriveRegistrationCommand(item?.id || item?.name || itemType);
}

function readSourceCatalog() {
  let source = null;
  try {
    source = catalogProvider ? catalogProvider() : null;
  } catch {
    source = null;
  }
  const products = Array.isArray(source?.products) ? source.products : null;
  const plans = Array.isArray(source?.plans) ? source.plans : null;
  if (!products && !plans) {
    return [
      ...defaultProducts.map((item) => ({ item, itemType: "product" })),
      ...defaultPlans.map((item) => ({ item, itemType: "plan" }))
    ];
  }
  return [
    ...(products || []).map((item) => ({ item, itemType: "product" })),
    ...(plans || []).map((item) => ({ item, itemType: "plan" }))
  ];
}

function resolveCatalog({ includeDisabled = false } = {}) {
  const seen = new Set();
  const entries = [];
  for (const { item, itemType } of readSourceCatalog()) {
    if (!item || typeof item !== "object") continue;
    const command = commandForItem(item, itemType);
    if (!command || seen.has(command)) continue;
    const enabled = item.commandEnabled !== false;
    if (!enabled && !includeDisabled) continue;
    seen.add(command);
    entries.push({
      command,
      itemId: String(item.id || ""),
      itemType,
      enabled,
      item
    });
  }
  return entries;
}

function reservedRegistrationCommands() {
  return new Set(
    resolveCatalog({ includeDisabled: true }).map((entry) => entry.command)
  );
}

function priceForDays(item, days) {
  const tiers = Array.isArray(item?.pricingTiers) ? item.pricingTiers : [];
  if (tiers.length) {
    const sorted = tiers
      .map((tier) => ({
        minDays: Number(tier?.minDays) || 0,
        price: String(tier?.price || "").trim()
      }))
      .filter((tier) => tier.price)
      .sort((a, b) => b.minDays - a.minDays);
    const match = sorted.find((tier) => Number(days) >= tier.minDays);
    if (match) return match.price;
  }
  if (item?.id === "gemini-pro") {
    if (days >= 500) return "S/70";
    if (days >= 300) return "S/50";
    return "S/20";
  }
  return item?.price;
}

function getCommandCatalog() {
  return resolveCatalog().map(({ command, itemId, itemType, item }) => ({
    command,
    itemId,
    itemType,
    name: item.name,
    price: item.price
  }));
}

function parseRegistrationCommand(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("/")) return { isCommand: false, ok: false };

  const match = raw.match(/^\/([a-z0-9]+)(?:\s+(\d+))?\s*$/i);
  if (!match) {
    return {
      isCommand: true,
      ok: false,
      error: "Usa el formato /comando días. Ejemplo: /planpro 30"
    };
  }

  const command = `/${match[1].toLowerCase()}`;
  const definition = resolveCatalog().find(
    (entry) => entry.command === command
  );
  if (!definition) {
    return {
      isCommand: true,
      ok: false,
      command,
      error: `El comando ${command} no existe.`
    };
  }

  const days = Number(match[2]);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3650) {
    return {
      isCommand: true,
      ok: false,
      command,
      error: "Los días deben ser un número entero entre 1 y 3650."
    };
  }

  const item = definition.item;
  if (!item?.name) {
    return {
      isCommand: true,
      ok: false,
      command,
      error: `No se encontró el producto asociado a ${command}.`
    };
  }

  return {
    isCommand: true,
    ok: true,
    command,
    days,
    itemType: definition.itemType,
    item: {
      id: item.id,
      name: item.name,
      price: priceForDays(item, days)
    }
  };
}

module.exports = {
  baseCommandDefinitions,
  commandDefinitions: baseCommandDefinitions,
  configureCatalogSource,
  commandForItem,
  deriveRegistrationCommand,
  normalizeRegistrationCommand,
  reservedRegistrationCommands,
  resolveCatalog,
  getCommandCatalog,
  parseRegistrationCommand,
  priceForDays
};
