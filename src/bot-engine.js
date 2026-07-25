"use strict";

const fs = require("node:fs");

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s+]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(normalizeText(term)));
}

function isGreetingOnly(text) {
  return [
    "",
    "hola",
    "holi",
    "buenas",
    "buen dia",
    "buenos dias",
    "buenas tardes",
    "buenas noches",
    "hola buenas"
  ].includes(text);
}

function asksForPrice(text) {
  return includesAny(text, ["precio", "cuanto", "costo", "cuesta", "vale"]);
}

function asksForDuration(text) {
  return includesAny(text, ["duracion", "cuanto dura", "por cuanto tiempo", "meses"]);
}

function matchesWelcomeSequence(text, settings = {}) {
  const triggers = String(settings.welcomeTriggers || "")
    .split(/\r?\n|,/)
    .map(normalizeText)
    .filter(Boolean);
  return triggers.some((trigger) => text === trigger || text.includes(trigger));
}

function scoreKnowledgeTrigger(text, trigger) {
  const normalizedTrigger = normalizeText(trigger);
  if (!normalizedTrigger) return 0;
  if (text === normalizedTrigger) return 10000 + normalizedTrigger.length;
  if (text.includes(normalizedTrigger)) return 5000 + normalizedTrigger.length;

  const ignored = new Set([
    "que", "cual", "como", "cuando", "donde", "el", "la", "los", "las",
    "un", "una", "de", "del", "en", "por", "para", "me", "mi", "es"
  ]);
  const triggerTokens = normalizedTrigger
    .split(" ")
    .filter((token) => token.length >= 2 && !ignored.has(token));
  if (triggerTokens.length < 2) return 0;
  const textTokens = new Set(text.split(" "));
  const overlap = triggerTokens.filter((token) => textTokens.has(token)).length;
  return overlap / triggerTokens.length >= 0.75 ? 1000 + overlap : 0;
}

function findKnowledgeMatch(text, entries = []) {
  return entries
    .filter((entry) => entry?.enabled !== false && entry?.answer)
    .map((entry) => ({
      entry,
      score: (Array.isArray(entry.triggers) ? entry.triggers : [])
        .reduce(
          (best, trigger) => Math.max(best, scoreKnowledgeTrigger(text, trigger)),
          0
        )
    }))
    .filter((match) => match.score > 0)
    .sort((left, right) => right.score - left.score)[0]?.entry || null;
}

function formatPlan(plan, question = "") {
  const text = normalizeText(question);
  if (asksForPrice(text)) {
    return `${plan.name} cuesta *${plan.price}* por ${plan.period}.`;
  }
  if (asksForDuration(text)) {
    return `${plan.name} tiene una duración de *${plan.period}*.`;
  }
  return [
    `*${plan.name} — ${plan.price}/${plan.period === "1 mes" ? "mes" : plan.period}*`,
    plan.includes.join(" + ")
  ].join("\n");
}

function formatProduct(product, question = "") {
  const text = normalizeText(question);

  if (asksForPrice(text)) {
    return `${product.name} cuesta *${product.price}* por ${product.period}.`;
  }
  if (asksForDuration(text)) {
    return `${product.name} dura *${product.period}*.`;
  }
  if (includesAny(text, ["garantia"])) {
    return `${product.name} tiene garantía y soporte durante todo el periodo contratado.`;
  }

  if (product.id === "chatgpt-pro") {
    if (includesAny(text, ["celular", "telefono", "movil"])) {
      return "Para celular te entregamos ChatGPT Plus sin costo adicional; ChatGPT Pro se usa en PC mediante DICloak.";
    }
    if (includesAny(text, ["pc", "laptop", "windows", "mac", "linux", "dicloak", "como funciona"])) {
      return "ChatGPT Pro se usa mediante DICloak en Windows, macOS o Linux. Nosotros creamos tus credenciales de acceso.";
    }
    if (includesAny(text, ["compartida", "personal", "chats", "conversaciones"])) {
      return "ChatGPT Pro es una cuenta original compartida. Otros usuarios pueden ver los chats, por eso no se deben guardar datos privados ni borrar conversaciones.";
    }
    return "ChatGPT Pro cuesta *S/45 por un mes*. Se usa en PC mediante DICloak y, para celular, entregamos ChatGPT Plus sin costo adicional.";
  }

  if (product.id === "claude-pro") {
    if (includesAny(text, ["celular", "telefono", "laptop", "pc", "donde"])) {
      return "Claude Pro funciona tanto en celular como en laptop. Se entrega el correo y la contraseña de acceso.";
    }
    if (includesAny(text, ["compartida", "personal", "chats", "archivos"])) {
      return "Claude Pro es una cuenta compartida entre 4 clientes. Los demás pueden ver chats y archivos, y no se deben cambiar los datos ni borrar conversaciones.";
    }
    return "Claude Pro cuesta *S/25 por un mes*. Es una cuenta compartida entre 4 clientes y funciona en celular o laptop.";
  }

  if (product.id === "gemini-pro") {
    return `Gemini Pro está disponible a *${product.price}*. Incluye soporte y garantía durante el periodo elegido.`;
  }

  return `${product.name} cuesta *${product.price}* por ${product.period}. Incluye entrega inmediata, soporte y garantía.`;
}

class BotEngine {
  constructor({ store, sendText, sendMedia, beginTyping, ai }) {
    this.store = store;
    this.sendText = sendText;
    this.sendMedia = sendMedia;
    this.beginTyping = beginTyping || (async () => async () => undefined);
    this.ai = ai;
  }

  #rememberUserMessage(chatId, conversation, body) {
    const current = String(body || "").trim();
    if (!current) return conversation;
    const recentUserMessages = [
      ...(Array.isArray(conversation.recentUserMessages)
        ? conversation.recentUserMessages
        : []),
      current.slice(0, 600)
    ].slice(-4);
    return this.store.updateConversation(chatId, { recentUserMessages });
  }

  #setTopic(chatId, patch) {
    this.store.updateConversation(chatId, {
      ...patch,
      lastTopicAt: new Date().toISOString()
    });
  }

  async handleIncoming({ chatId, body, hasMedia = false, mediaType = "", fromName = "" }) {
    const text = normalizeText(body);
    const originalConversation = this.store.getConversation(chatId);

    if (originalConversation.paused) return { action: "paused" };

    if (hasMedia && originalConversation.awaitingReceipt) {
      await this.sendText(chatId, this.store.getSettings().receiptReply);
      this.store.updateConversation(chatId, {
        awaitingReceipt: false,
        paymentCountryRequested: false,
        lastReceiptAt: new Date().toISOString()
      });
      this.store.addLog("receipt", `Comprobante recibido de ${fromName || chatId}`, {
        chatId,
        mediaType
      });
      this.store.save();
      return { action: "receipt" };
    }

    const conversation = this.#rememberUserMessage(chatId, originalConversation, body);
    const settings = this.store.getSettings();

    if (includesAny(text, ["asesor", "humano", "atencion personal", "hablar con una persona"])) {
      await this.sendText(chatId, this.store.getSettings().humanReply);
      this.store.updateConversation(chatId, {
        paused: true,
        pausedAt: new Date().toISOString(),
        pauseReason: "Solicitó un asesor"
      });
      this.store.addLog("human", `${fromName || chatId} solicitó atención personal`, {
        chatId
      });
      this.store.save();
      return { action: "human" };
    }

    if (hasMedia) {
      await this.sendText(
        chatId,
        "Recibí el archivo. ¿Es un comprobante de pago o deseas que lo revise un asesor?"
      );
      return { action: "media" };
    }

    if (matchesWelcomeSequence(text, settings)) {
      const messages = settings.greetingMessages.slice(0, 3);
      for (const message of messages) {
        await this.sendText(chatId, message);
      }
      this.store.updateConversation(chatId, {
        welcomeSequenceSentAt: new Date().toISOString()
      });
      return { action: "welcome-sequence", messages: messages.length };
    }

    if (isGreetingOnly(text)) {
      await this.sendText(chatId, settings.shortGreeting);
      return { action: "greeting" };
    }

    if (includesAny(text, ["plan pro", "combo pro"])) {
      const plan = this.store.data.plans.find((item) => item.id === "plan-pro");
      await this.sendText(chatId, formatPlan(plan, body));
      this.#setTopic(chatId, { lastPlanId: plan.id, lastProductId: null });
      return { action: "plan", id: plan.id };
    }

    if (includesAny(text, ["plan plus", "combo plus"])) {
      const plan = this.store.data.plans.find((item) => item.id === "plan-plus");
      await this.sendText(chatId, formatPlan(plan, body));
      this.#setTopic(chatId, { lastPlanId: plan.id, lastProductId: null });
      return { action: "plan", id: plan.id };
    }

    if (includesAny(text, ["planes", "combos"])) {
      await this.sendText(chatId, this.store.getSettings().greetingMessages[1]);
      return { action: "plans" };
    }

    if (
      includesAny(text, ["dicloak", "dicloud", "como ingreso", "como entrar"]) &&
      includesAny(text, ["chatgpt", "pro", "dicloak", "dicloud"])
    ) {
      const media = this.store.getMedia("dicloakAudio");
      if (media?.path && fs.existsSync(media.path)) {
        await this.sendMedia(chatId, media.path, { asVoice: true });
      } else {
        await this.sendText(
          chatId,
          "DICloak permite usar ChatGPT Pro en Windows, macOS o Linux. Nosotros creamos tus credenciales de acceso."
        );
      }
      this.#setTopic(chatId, { lastProductId: "chatgpt-pro", lastPlanId: null });
      return { action: "dicloak" };
    }

    const trainedAnswer = findKnowledgeMatch(
      text,
      this.store.getKnowledgeBase?.() || this.store.data.knowledgeBase || []
    );
    if (trainedAnswer) {
      await this.sendText(chatId, trainedAnswer.answer);
      this.store.addLog("training", `Respuesta entrenada: ${trainedAnswer.title}`, {
        chatId,
        knowledgeId: trainedAnswer.id
      });
      this.store.save();
      return { action: "trained", id: trainedAnswer.id };
    }

    const product = this.store.data.products
      .flatMap((item) =>
        item.aliases
          .filter((alias) => text.includes(normalizeText(alias)))
          .map((alias) => ({ item, matchLength: normalizeText(alias).length }))
      )
      .sort((left, right) => right.matchLength - left.matchLength)[0]?.item;

    if (product) {
      await this.sendText(chatId, formatProduct(product, body));
      this.#setTopic(chatId, { lastProductId: product.id, lastPlanId: null });
      return { action: "product", id: product.id };
    }

    const asksTopicFollowup = includesAny(text, [
      "precio",
      "cuanto",
      "cuesta",
      "duracion",
      "cuanto dura",
      "celular",
      "telefono",
      "pc",
      "laptop",
      "windows",
      "mac",
      "linux",
      "compartida",
      "personal",
      "chats",
      "archivos",
      "garantia",
      "como funciona"
    ]);
    if (asksTopicFollowup && conversation.lastProductId) {
      const lastProduct = this.store.data.products.find(
        (item) => item.id === conversation.lastProductId
      );
      if (lastProduct) {
        await this.sendText(chatId, formatProduct(lastProduct, body));
        return { action: "product-followup", id: lastProduct.id };
      }
    }
    if (asksTopicFollowup && conversation.lastPlanId) {
      const lastPlan = this.store.data.plans.find(
        (item) => item.id === conversation.lastPlanId
      );
      if (lastPlan) {
        await this.sendText(chatId, formatPlan(lastPlan, body));
        return { action: "plan-followup", id: lastPlan.id };
      }
    }

    if (includesAny(text, ["pdf"])) {
      const media = this.store.getMedia("catalogPdf");
      if (media?.path && fs.existsSync(media.path)) {
        await this.sendMedia(chatId, media.path, {
          caption: "Catálogo actualizado de JadrixServs"
        });
      } else {
        await this.sendText(chatId, this.store.getSettings().greetingMessages[0]);
      }
      return { action: "catalog-pdf" };
    }

    if (includesAny(text, ["catalogo", "precios", "lista de precios", "que servicios", "servicios tienen"])) {
      await this.sendText(chatId, this.store.getSettings().greetingMessages[0]);
      return { action: "catalog" };
    }

    if (includesAny(text, ["internacional", "otro pais", "binance", "usdt", "dolares"])) {
      await this.sendText(chatId, this.store.getSettings().internationalPayment);
      this.store.updateConversation(chatId, {
        awaitingReceipt: true,
        paymentCountryRequested: false
      });
      return { action: "international-payment" };
    }

    if (
      includesAny(text, ["yape", "pago en peru", "soy de peru", "desde peru"]) ||
      text === "peru"
    ) {
      await this.sendText(chatId, this.store.getSettings().peruPayment);
      this.store.updateConversation(chatId, {
        awaitingReceipt: true,
        paymentCountryRequested: false
      });
      return { action: "peru-payment" };
    }

    if (conversation.paymentCountryRequested && text) {
      await this.sendText(chatId, this.store.getSettings().internationalPayment);
      this.store.updateConversation(chatId, {
        awaitingReceipt: true,
        paymentCountryRequested: false
      });
      return { action: "international-payment" };
    }

    if (includesAny(text, ["pagar", "pago", "comprar", "adquirir"])) {
      await this.sendText(chatId, "Claro. ¿Pagarás desde Perú o desde otro país?");
      this.store.updateConversation(chatId, {
        paymentCountryRequested: true,
        awaitingReceipt: false
      });
      return { action: "payment-country" };
    }

    if (includesAny(text, ["renovar", "renovacion", "vence", "vencimiento"])) {
      await this.sendText(
        chatId,
        "Puedes renovar antes de vencer sin perder días. Si vence el 26 y pagas el 23, el nuevo periodo empieza el 26."
      );
      return { action: "renewal" };
    }

    if (includesAny(text, ["garantia"])) {
      await this.sendText(
        chatId,
        "Todos los servicios tienen garantía y soporte durante el periodo contratado."
      );
      return { action: "guarantee" };
    }

    if (includesAny(text, ["soporte", "problema", "no funciona"])) {
      await this.sendText(
        chatId,
        "Cuéntame qué servicio tienes y qué problema aparece. Si prefieres atención personal, puedo comunicarte con un asesor."
      );
      return { action: "support" };
    }

    if (includesAny(text, ["entrega", "demora", "cuanto tarda", "cuando llega"])) {
      await this.sendText(
        chatId,
        "La entrega es inmediata después de verificar el comprobante."
      );
      return { action: "delivery" };
    }

    if (this.ai?.getStatus().enabled) {
      let stopTyping = async () => undefined;
      try {
        stopTyping = await this.beginTyping(chatId);
        const answer = await this.ai.answer({
          question: body,
          conversation
        });
        if (answer) {
          await this.sendText(chatId, answer, { typingAlreadyStarted: true });
          this.store.addLog("ai", `Respuesta de IA enviada a ${fromName || chatId}`, {
            chatId
          });
          this.store.save();
          return { action: "ai" };
        }
      } catch (error) {
        this.store.addLog("error", `OpenAI no pudo responder: ${error.message}`, {
          chatId
        });
        this.store.save();
      } finally {
        await stopTyping().catch(() => undefined);
      }
    }

    await this.sendText(chatId, this.store.getSettings().fallbackReply);
    return { action: "fallback" };
  }
}

module.exports = {
  BotEngine,
  normalizeText,
  isGreetingOnly,
  matchesWelcomeSequence,
  findKnowledgeMatch,
  formatPlan,
  formatProduct
};
