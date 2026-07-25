"use strict";

const products = [
  {
    id: "claude-pro",
    name: "Claude Pro",
    price: "S/25",
    period: "1 mes",
    aliases: ["claude", "claude pro"],
    details:
      "Cuenta compartida entre 4 clientes. Se entrega correo y contraseña y funciona en celular o laptop. Otros usuarios pueden ver los chats y archivos; no se deben cambiar los datos ni borrar chats. Incluye garantía durante el tiempo contratado y soporte activo."
  },
  {
    id: "chatgpt-pro",
    name: "ChatGPT Pro",
    price: "S/45",
    period: "1 mes",
    aliases: ["chatgpt pro", "gpt pro", "pro de chatgpt"],
    details:
      "Cuenta original de ChatGPT Pro compartida mediante DICloak. Funciona en Windows, macOS y Linux; JadrixServs crea las credenciales. Para celular se entrega ChatGPT Plus sin costo adicional. Otros usuarios pueden ver los chats, no se deben borrar conversaciones. Incluye soporte 24 h y solución o reemplazo."
  },
  {
    id: "chatgpt-plus",
    name: "ChatGPT Plus",
    price: "S/10",
    period: "1 mes",
    aliases: ["chatgpt plus", "gpt plus", "plus compartido"],
    details: "Acceso a ChatGPT Plus por 1 mes, con entrega inmediata, soporte activo y garantía durante el periodo contratado."
  },
  {
    id: "chatgpt-plus-personal",
    name: "ChatGPT Plus Personal",
    price: "S/30",
    period: "1 mes",
    aliases: ["chatgpt plus personal", "plus personal", "cuenta personal"],
    details: "ChatGPT Plus para uso personal por 1 mes, con entrega inmediata, soporte activo y garantía."
  },
  {
    id: "gemini-pro",
    name: "Gemini Pro",
    price: "S/20 mensual · S/50 anual · S/70 por 18 meses",
    period: "1, 12 o 18 meses",
    aliases: ["gemini", "gemini pro", "gemini 3 ultra"],
    details: "Disponible por S/20 al mes, S/50 al año o S/70 por 18 meses. Incluye entrega inmediata, soporte y garantía."
  },
  {
    id: "supergrok",
    name: "SuperGrok",
    price: "S/20",
    period: "1 mes",
    aliases: ["supergrok", "grok", "super grok", "supergrok heavy"],
    details: "Acceso a SuperGrok por 1 mes, con entrega inmediata, soporte activo y garantía."
  },
  {
    id: "perplexity-pro",
    name: "Perplexity Pro",
    price: "S/15",
    period: "1 mes",
    aliases: ["perplexity", "perplexity pro"],
    details: "Acceso a Perplexity Pro por 1 mes, con entrega inmediata, soporte activo y garantía."
  },
  {
    id: "gamma-pro",
    name: "Gamma Pro",
    price: "S/20",
    period: "1 mes",
    aliases: ["gamma", "gamma pro"],
    details: "Acceso a Gamma Pro por 1 mes, con entrega inmediata, soporte activo y garantía."
  },
  {
    id: "capcut-pro",
    name: "CapCut Pro",
    price: "S/15",
    period: "1 mes",
    aliases: ["capcut", "capcut pro"],
    details: "Acceso a CapCut Pro por 1 mes, con entrega inmediata, soporte activo y garantía."
  },
  {
    id: "netflix",
    name: "Netflix",
    price: "S/10",
    period: "1 mes",
    aliases: ["netflix"],
    details: "Perfil de Netflix por 1 mes. Incluye soporte y garantía durante el periodo contratado."
  },
  {
    id: "hbo",
    name: "HBO",
    price: "S/7",
    period: "1 mes",
    aliases: ["hbo", "max", "hbo max"],
    details: "Perfil de HBO por 1 mes. Incluye soporte y garantía durante el periodo contratado."
  },
  {
    id: "crunchyroll",
    name: "Crunchyroll",
    price: "S/5",
    period: "1 mes",
    aliases: ["crunchyroll", "crunchy"],
    details: "Perfil de Crunchyroll por 1 mes. Incluye soporte y garantía durante el periodo contratado."
  }
];

const plans = [
  {
    id: "plan-pro",
    name: "Plan Pro",
    price: "S/60",
    period: "1 mes",
    aliases: ["plan pro", "combo pro"],
    includes: [
      "ChatGPT Pro",
      "Gemini 3 Ultra",
      "Perplexity Pro",
      "Freepik Premium",
      "CapCut Pro",
      "+1000 cursos de IA",
      "SuperGrok",
      "SuperGrok Heavy"
    ]
  },
  {
    id: "plan-plus",
    name: "Plan Plus",
    price: "S/25",
    period: "1 mes",
    aliases: ["plan plus", "combo plus"],
    includes: ["ChatGPT Plus", "Perplexity Pro", "CapCut Pro", "+1000 cursos de IA"]
  }
];

function buildGreetingMessages() {
  const catalogLines = products.map(
    (product) => `• *${product.name}* — ${product.price}${product.period === "1 mes" ? "/mes" : ""}`
  );

  return [
    [
      "👋 ¡Hola! Bienvenido(a) a *JadrixServs*.",
      "",
      "🚀 *CATÁLOGO DISPONIBLE*",
      ...catalogLines,
      "",
      "Escríbeme el nombre del servicio que te interesa y te doy todos los detalles."
    ].join("\n"),
    [
      "🔥 *COMBOS ESPECIALES*",
      "",
      "⭐ *Plan Pro — S/60/mes*",
      "ChatGPT Pro + Gemini 3 Ultra + Perplexity Pro + Freepik Premium + CapCut Pro + más de 1000 cursos de IA + SuperGrok + SuperGrok Heavy.",
      "",
      "✨ *Plan Plus — S/25/mes*",
      "ChatGPT Plus + Perplexity Pro + CapCut Pro + más de 1000 cursos de IA."
    ].join("\n"),
    [
      "⚡ Entrega inmediata",
      "🛟 Soporte activo",
      "✅ Renovación garantizada",
      "🎁 También armamos tu combo personalizado.",
      "",
      "¿Qué servicio deseas adquirir?",
      "*JadrixServs*"
    ].join("\n")
  ];
}

const defaultSettings = {
  businessName: "JadrixServs",
  shortGreeting:
    "¡Hola! 👋 Soy parte del equipo de JadrixServs. ¿En qué servicio estás interesado o qué deseas consultar?",
  peruPayment:
    "🇵🇪 *Pago en Perú*\nYape: *921 444 991*\nTitular: *Jaime Gar.*\n\nDespués de pagar, envía tu comprobante por este chat.",
  internationalPayment:
    "🌎 *Pago desde otro país*\nBinance ID: *1205380212*\nPago en USDT. Se convierte el precio de soles a dólares, se agrega 3% y el total se redondea hacia arriba.\n\nEnvía tu comprobante para activar el servicio inmediatamente.",
  receiptReply:
    "✅ Comprobante recibido. Lo revisaremos y te confirmaremos la activación lo antes posible. ¡Gracias por elegir JadrixServs!",
  humanReply:
    "🙋 He avisado que necesitas atención personal. Un asesor de JadrixServs continuará contigo por este chat.",
  fallbackReply:
    "No tengo ese dato confirmado. Si deseas, puedo comunicarte con un asesor de JadrixServs.",
  reminderTemplate:
    "Hola {nombre} 👋 Te recordamos que tu servicio *{producto}* vence el {fecha}. Puedes renovar anticipadamente sin perder ningún día; el nuevo mes comienza desde tu fecha de vencimiento actual.",
  chargeTemplate:
    "Hola {nombre} 👋 Hoy corresponde renovar tu servicio *{producto}*. El monto es *{precio}*. Escríbenos para enviarte los datos de pago y mantener el servicio activo.",
  greetingMessages: buildGreetingMessages()
};

function createInitialData() {
  return {
    version: 4.1,
    settings: structuredClone(defaultSettings),
    products: structuredClone(products),
    plans: structuredClone(plans),
    clients: [],
    conversations: {},
    logs: [],
    media: {
      dicloakAudio: null,
      catalogPdf: null
    }
  };
}

module.exports = {
  products,
  plans,
  defaultSettings,
  buildGreetingMessages,
  createInitialData
};
