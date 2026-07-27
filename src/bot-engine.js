"use strict";

function normalizeText(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{Letter}\p{Number}\s+]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

class BotEngine {
  constructor({ store, sendText }) {
    this.store = store;
    this.sendText = sendText;
  }

  async handleIncoming({
    chatId,
    alternateChatId = "",
    body = "",
    hasMedia = false,
    fromName = ""
  }) {
    const conversationIds = [...new Set([chatId, alternateChatId].filter(Boolean))];
    const conversations = conversationIds.map((id) =>
      this.store.getConversation(id)
    );
    const conversation = conversations.reduce(
      (selected, item) => {
        if (item.welcomeSequenceSentAt && !selected.welcomeSequenceSentAt) {
          return item;
        }
        if (
          Number(item.welcomeMessagesSent || 0) >
          Number(selected.welcomeMessagesSent || 0)
        ) {
          return item;
        }
        return selected;
      },
      {}
    );
    const updateConversations = (patch) => {
      for (const id of conversationIds) {
        this.store.updateConversation(id, patch);
      }
    };
    const now = new Date().toISOString();
    const client =
      this.store.findClientByWhatsApp?.(chatId, alternateChatId) || null;

    if (client) {
      updateConversations({
        lastInboundAt: now,
        lastInboundPreview: String(body || "").slice(0, 180),
        lastInboundHadMedia: Boolean(hasMedia),
        registeredClientId: client.id
      });
      return { action: "registered-client", clientId: client.id };
    }

    if (conversation.welcomeSequenceSentAt) {
      updateConversations({
        lastInboundAt: now,
        lastInboundPreview: String(body || "").slice(0, 180),
        lastInboundHadMedia: Boolean(hasMedia)
      });
      return { action: "welcome-already-sent" };
    }

    const settings = this.store.getSettings();
    const messages = settings.greetingMessages.slice(0, 3);
    const previousCount = Math.max(
      0,
      Math.min(3, Number(conversation.welcomeMessagesSent) || 0)
    );

    updateConversations({
      firstInboundAt: conversation.firstInboundAt || now,
      lastInboundAt: now,
      lastInboundPreview: String(body || "").slice(0, 180),
      lastInboundHadMedia: Boolean(hasMedia),
      firstInboundName: conversation.firstInboundName || fromName || ""
    });

    let sentNow = 0;
    for (let index = previousCount; index < messages.length; index += 1) {
      await this.sendText(chatId, messages[index]);
      sentNow += 1;
      updateConversations({
        welcomeMessagesSent: index + 1
      });
    }

    updateConversations({
      welcomeMessagesSent: 3,
      welcomeSequenceSentAt: new Date().toISOString()
    });
    this.store.addLog(
      "welcome",
      `Bienvenida enviada a ${fromName || chatId}`,
      { chatId, messages: sentNow }
    );
    this.store.save();

    return {
      action: previousCount ? "welcome-resumed" : "welcome-sequence",
      messages: sentNow
    };
  }
}

module.exports = {
  BotEngine,
  normalizeText
};
