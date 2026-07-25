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

function formatPlan(plan) {
  return [
    `🔥 *${plan.name} — ${plan.price}/${plan.period === "1 mes" ? "mes" : plan.period}*`,
    "",
    ...plan.includes.map((item) => `• ${item}`),
    "",
    "Incluye entrega inmediata, soporte activo y garantía."
  ].join("\n");
}

function formatProduct(product) {
  return [
    `✨ *${product.name}*`,
    `Precio: *${product.price}*`,
    `Duración: *${product.period}*`,
    "",
    product.details,
    "",
    "¿Deseas adquirirlo? Escribe *pagar* y te envío los datos."
  ].join("\n");
}

class BotEngine {
  constructor({ store, sendText, sendMedia, greetingCooldownHours = 24 }) {
    this.store = store;
    this.sendText = sendText;
    this.sendMedia = sendMedia;
    this.greetingCooldownMs = Math.max(1, Number(greetingCooldownHours) || 24) * 3600000;
  }

  async handleIncoming({ chatId, body, hasMedia = false, mediaType = "", fromName = "" }) {
    const text = normalizeText(body);
    const conversation = this.store.getConversation(chatId);

    if (conversation.paused) return { action: "paused" };

    if (hasMedia && conversation.awaitingReceipt) {
      await this.sendText(chatId, this.store.getSettings().receiptReply);
      this.store.updateConversation(chatId, {
        awaitingReceipt: false,
        lastReceiptAt: new Date().toISOString()
      });
      this.store.addLog("receipt", `Comprobante recibido de ${fromName || chatId}`, { chatId, mediaType });
      this.store.save();
      return { action: "receipt" };
    }

    const greetedAt = conversation.greetedAt ? new Date(conversation.greetedAt).getTime() : 0;
    const shouldGreet = !greetedAt || Date.now() - greetedAt >= this.greetingCooldownMs;
    const isGreeting = !text || includesAny(text, ["hola", "buenas", "buen dia", "buenos dias", "catalogo", "menú", "menu"]);

    if (shouldGreet) {
      await this.sendGreeting(chatId);
      if (isGreeting) return { action: "greeting" };
    }

    if (includesAny(text, ["asesor", "humano", "atencion personal", "hablar con una persona"])) {
      await this.sendText(chatId, this.store.getSettings().humanReply);
      this.store.updateConversation(chatId, {
        paused: true,
        pausedAt: new Date().toISOString(),
        pauseReason: "Solicitó un asesor"
      });
      this.store.addLog("human", `${fromName || chatId} solicitó atención personal`, { chatId });
      this.store.save();
      return { action: "human" };
    }

    if (hasMedia) {
      await this.sendText(
        chatId,
        "✅ Recibí tu archivo. Si es un comprobante, escribe *pago* para registrarlo; si necesitas ayuda, escribe *asesor*."
      );
      return { action: "media" };
    }

    if (includesAny(text, ["plan pro", "combo pro"])) {
      const plan = this.store.data.plans.find((item) => item.id === "plan-pro");
      await this.sendText(chatId, formatPlan(plan));
      return { action: "plan", id: plan.id };
    }

    if (includesAny(text, ["plan plus", "combo plus"])) {
      const plan = this.store.data.plans.find((item) => item.id === "plan-plus");
      await this.sendText(chatId, formatPlan(plan));
      return { action: "plan", id: plan.id };
    }

    if (includesAny(text, ["planes", "combos", "combo personalizado"])) {
      await this.sendText(chatId, this.store.getSettings().greetingMessages[1]);
      return { action: "plans" };
    }

    if (includesAny(text, ["dicloak", "dicloud", "como ingreso", "como entrar"]) && includesAny(text, ["chatgpt", "pro", "dicloak", "dicloud"])) {
      const media = this.store.getMedia("dicloakAudio");
      if (media?.path && fs.existsSync(media.path)) {
        await this.sendMedia(chatId, media.path, { asVoice: true });
        await this.sendText(chatId, "🎧 Te envié el audio con las instrucciones para ingresar mediante DICloak.");
      } else {
        await this.sendText(
          chatId,
          "DICloak permite usar la cuenta original de ChatGPT Pro desde Windows, macOS o Linux. JadrixServs crea tus credenciales de acceso. Si usarás celular, te entregamos ChatGPT Plus sin costo adicional."
        );
      }
      return { action: "dicloak" };
    }

    const product = this.store.data.products
      .flatMap((item) =>
        item.aliases
          .filter((alias) => text.includes(normalizeText(alias)))
          .map((alias) => ({ item, matchLength: normalizeText(alias).length }))
      )
      .sort((left, right) => right.matchLength - left.matchLength)[0]?.item;
    if (product) {
      await this.sendText(chatId, formatProduct(product));
      return { action: "product", id: product.id };
    }

    if (includesAny(text, ["pdf", "catalogo", "lista", "precio", "precios", "servicios"])) {
      const media = this.store.getMedia("catalogPdf");
      if (includesAny(text, ["pdf"]) && media?.path && fs.existsSync(media.path)) {
        await this.sendMedia(chatId, media.path, { caption: "📄 Catálogo actualizado de JadrixServs" });
      } else {
        await this.sendText(chatId, this.store.getSettings().greetingMessages[0]);
      }
      return { action: "catalog" };
    }

    if (includesAny(text, ["internacional", "otro pais", "binance", "usdt", "dolares"])) {
      await this.sendText(chatId, this.store.getSettings().internationalPayment);
      this.store.updateConversation(chatId, { awaitingReceipt: true });
      return { action: "international-payment" };
    }

    if (includesAny(text, ["yape", "peru", "pagar", "pago", "comprar", "adquirir"])) {
      const settings = this.store.getSettings();
      await this.sendText(
        chatId,
        `${settings.peruPayment}\n\n${settings.internationalPayment}\n\nIndícame desde qué país pagarás.`
      );
      this.store.updateConversation(chatId, { awaitingReceipt: true });
      return { action: "payment" };
    }

    if (includesAny(text, ["renovar", "renovacion", "vence", "vencimiento"])) {
      await this.sendText(
        chatId,
        "✅ Puedes renovar antes de vencer sin perder días. Por ejemplo, si tu servicio vence el 26 y pagas el 23, el nuevo periodo empieza el 26. Escribe *pagar* para recibir los datos."
      );
      return { action: "renewal" };
    }

    if (includesAny(text, ["garantia", "soporte", "problema", "no funciona"])) {
      await this.sendText(
        chatId,
        "🛟 Todos los servicios incluyen soporte activo y garantía durante el periodo contratado. Cuéntame qué servicio tienes y qué inconveniente aparece; si deseas atención personal, escribe *asesor*."
      );
      return { action: "support" };
    }

    if (includesAny(text, ["entrega", "demora", "cuanto tarda", "cuando llega"])) {
      await this.sendText(
        chatId,
        "⚡ La entrega es inmediata después de verificar el comprobante. Envíalo por este chat y confirmaremos la activación."
      );
      return { action: "delivery" };
    }

    await this.sendText(chatId, this.store.getSettings().fallbackReply);
    return { action: "fallback" };
  }

  async sendGreeting(chatId) {
    const messages = this.store.getSettings().greetingMessages;
    for (const message of messages) {
      await this.sendText(chatId, message);
      await new Promise((resolve) => setTimeout(resolve, 550));
    }
    this.store.updateConversation(chatId, {
      greetedAt: new Date().toISOString(),
      awaitingReceipt: false
    });
  }
}

module.exports = {
  BotEngine,
  normalizeText,
  formatPlan,
  formatProduct
};
