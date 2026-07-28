"use strict";

const { products, plans } = require("./defaults");

const commandDefinitions = Object.freeze([
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

const itemsById = new Map(
  [...products, ...plans].map((item) => [item.id, item])
);
const definitionsByCommand = new Map(
  commandDefinitions.map((definition) => [
    definition.command,
    definition
  ])
);

function priceForDays(item, days) {
  if (item.id === "gemini-pro") {
    if (days >= 500) return "S/70";
    if (days >= 300) return "S/50";
    return "S/20";
  }
  return item.price;
}

function getCommandCatalog() {
  return commandDefinitions.map((definition) => {
    const item = itemsById.get(definition.itemId);
    if (!item) {
      throw new Error(`Producto no encontrado para ${definition.command}.`);
    }
    return {
      ...definition,
      name: item.name,
      price: item.price
    };
  });
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
  const definition = definitionsByCommand.get(command);
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

  const item = itemsById.get(definition.itemId);
  if (!item) {
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
  commandDefinitions,
  getCommandCatalog,
  parseRegistrationCommand,
  priceForDays
};
