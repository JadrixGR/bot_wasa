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

const knowledgeBase = [
  {
    id: "chatgpt-vs-gemini",
    title: "Elegir entre ChatGPT y Gemini",
    triggers: [
      "chatgpt o gemini",
      "cual es mejor chatgpt o gemini",
      "cual me recomiendas chatgpt o gemini",
      "que ia recomiendas",
      "ia para videos"
    ],
    answer:
      "Para uso general te recomiendo ChatGPT. Si tu prioridad es crear videos, te conviene Gemini.",
    enabled: true
  },
  {
    id: "privacy-personal",
    title: "Privacidad y cuentas personales",
    triggers: [
      "necesito privacidad",
      "mis chats son privados",
      "otros pueden ver mis chats",
      "cuenta privada",
      "informacion privada"
    ],
    answer:
      "Si necesitas privacidad, te recomiendo una cuenta personal. En las cuentas compartidas otros usuarios pueden ver los chats y archivos.",
    enabled: true
  },
  {
    id: "shared-account-rules",
    title: "Reglas de cuentas compartidas",
    triggers: [
      "puedo borrar los chats",
      "puedo borrar conversaciones",
      "puedo cambiar la contraseña",
      "puedo cambiar los datos",
      "reglas de cuenta compartida"
    ],
    answer:
      "En las cuentas compartidas no se deben cambiar los datos de acceso ni borrar chats o conversaciones.",
    enabled: true
  },
  {
    id: "chatgpt-pro-devices",
    title: "ChatGPT Pro en PC y celular",
    triggers: [
      "chatgpt pro funciona en celular",
      "chatgpt pro en celular",
      "chatgpt pro en laptop",
      "chatgpt pro en pc",
      "en que dispositivos funciona chatgpt pro"
    ],
    answer:
      "ChatGPT Pro se usa en PC mediante DICloak. Para celular te entregamos ChatGPT Plus sin costo adicional.",
    enabled: true
  },
  {
    id: "dicloak-access",
    title: "Acceso mediante DICloak",
    triggers: [
      "que es dicloak",
      "como funciona dicloak",
      "como ingreso a dicloak",
      "como entro a chatgpt pro",
      "como recibo chatgpt pro"
    ],
    answer:
      "DICloak permite usar ChatGPT Pro en Windows, macOS o Linux. JadrixServs crea tus credenciales de acceso.",
    enabled: true
  },
  {
    id: "claude-shared",
    title: "Funcionamiento de Claude Pro",
    triggers: [
      "claude es compartido",
      "cuantas personas usan claude",
      "claude funciona en celular",
      "claude funciona en laptop",
      "como recibo claude"
    ],
    answer:
      "Claude Pro es una cuenta compartida entre 4 clientes. Funciona en celular o laptop y se entrega el correo y la contraseña.",
    enabled: true
  },
  {
    id: "immediate-delivery",
    title: "Tiempo de entrega",
    triggers: [
      "la entrega es inmediata",
      "cuanto demora la entrega",
      "cuanto tarda en llegar",
      "cuando recibo mi cuenta",
      "cuando me entregan"
    ],
    answer: "La entrega es inmediata después de verificar el comprobante.",
    enabled: true
  },
  {
    id: "support-guarantee",
    title: "Soporte y garantía",
    triggers: [
      "tiene garantia",
      "incluye garantia",
      "tienen soporte",
      "incluye soporte",
      "que pasa si no funciona"
    ],
    answer:
      "Todos los servicios incluyen soporte activo y garantía durante el periodo contratado.",
    enabled: true
  },
  {
    id: "early-renewal",
    title: "Renovación anticipada",
    triggers: [
      "puedo renovar antes",
      "pierdo dias si renuevo antes",
      "como funciona la renovacion",
      "renovacion anticipada",
      "cuando empieza mi renovacion"
    ],
    answer:
      "Puedes renovar antes sin perder días. El nuevo periodo comienza desde la fecha de vencimiento actual, no desde la fecha del pago.",
    enabled: true
  },
  {
    id: "payment-peru",
    title: "Pago desde Perú",
    triggers: [
      "como pago desde peru",
      "pago por yape",
      "numero de yape",
      "datos de yape"
    ],
    answer:
      "Puedes pagar por Yape al 921 444 991, a nombre de Jaime Gar. Después envía el comprobante por este chat.",
    enabled: true
  },
  {
    id: "payment-international",
    title: "Pago desde otro país",
    triggers: [
      "como pago desde otro pais",
      "pago internacional",
      "pago por binance",
      "binance id",
      "pago en usdt"
    ],
    answer:
      "Desde otro país puedes pagar por Binance al ID 1205380212 en USDT. El precio se convierte de soles a dólares, se agrega 3% y el total se redondea hacia arriba.",
    enabled: true
  },
  {
    id: "payment-receipt",
    title: "Envío del comprobante",
    triggers: [
      "donde envio el comprobante",
      "ya pague",
      "te envio el comprobante",
      "como confirmo mi pago"
    ],
    answer:
      "Envía el comprobante por este chat. Lo revisaremos antes de confirmar la activación.",
    enabled: true
  },
  {
    id: "custom-combo",
    title: "Combo personalizado",
    triggers: [
      "puedo armar mi combo",
      "combo personalizado",
      "quiero otro combo",
      "puedo elegir los productos"
    ],
    answer:
      "Sí, podemos armar un combo personalizado. Indícame qué servicios quieres incluir.",
    enabled: true
  },
  {
    id: "streaming-profile",
    title: "Servicios de streaming",
    triggers: [
      "netflix es perfil",
      "hbo es perfil",
      "crunchyroll es perfil",
      "los streaming son perfiles"
    ],
    answer:
      "Netflix, HBO y Crunchyroll se entregan como perfiles por un mes, con soporte y garantía durante el periodo contratado.",
    enabled: true
  }
];

function buildGreetingMessages() {
  const catalogLines = products.map(
    (product) => `• *${product.name}* — ${product.price}${product.period === "1 mes" ? "/mes" : ""}`
  );

  return [
    [
      "🚀 JADRIXSERVS 🚀",
      "👋 ¡Hola! Bienvenido(a).",
      "",
      "📋 *CATÁLOGO DISPONIBLE*",
      ...catalogLines,
      "",
      "Escríbeme el nombre del servicio que te interesa y te doy todos los detalles."
    ].join("\n"),
    [
      "💼 COMBOS ESPECIALES - Todo en 1",
      "",
      "⭐ *Plan Pro — S/60/mes*",
      "ChatGPT Pro + Gemini 3 Ultra + Perplexity Pro + Freepik Premium + CapCut Pro + más de 1000 cursos de IA + SuperGrok + SuperGrok Heavy.",
      "",
      "✨ *Plan Plus — S/25/mes*",
      "ChatGPT Plus + Perplexity Pro + CapCut Pro + más de 1000 cursos de IA."
    ].join("\n"),
    [
      "✅ `Entrega inmediata`",
      "🛟 Soporte activo",
      "✅ Renovación garantizada",
      "🎁 También armamos tu combo personalizado.",
      "",
      "¿Qué servicio deseas adquirir?",
      "JadrixServs 💪"
    ].join("\n")
  ];
}

const defaultSettings = {
  businessName: "JadrixServs",
  inboundMode: "welcome_once",
  shortGreeting:
    "¡Hola! 👋 Soy parte del equipo de JadrixServs. ¿En qué servicio estás interesado o qué deseas consultar?",
  welcomeTriggers:
    "¿Cuál es el precio del Super Combo IA 2026?\nSuper Combo IA 2026\nPrecio del Super Combo IA 2026",
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
    "Hola {nombre} 👋 Te recordamos que tu servicio *{producto}* vence en 2 días, el *{fecha}*. Puedes renovar anticipadamente sin perder ningún día; el nuevo periodo comienza desde tu fecha de vencimiento actual.",
  chargeTemplate:
    "Hola {nombre} 👋 Hoy vence tu servicio *{producto}*. El monto de renovación es *{precio}*. Escríbenos para mantener el servicio activo.",
  greetingMessages: buildGreetingMessages()
};

function createInitialData() {
  return {
    version: 4.6,
    settings: structuredClone(defaultSettings),
    products: structuredClone(products),
    plans: structuredClone(plans),
    knowledgeBase: structuredClone(knowledgeBase),
    clients: [],
    processedCommandIds: [],
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
  knowledgeBase,
  defaultSettings,
  buildGreetingMessages,
  createInitialData
};
