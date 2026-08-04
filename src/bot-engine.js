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

function whatsappPhoneDigits(value) {
  const localPart = String(value || "")
    .split("@")[0]
    .split(":")[0];
  return localPart.replace(/\D/g, "");
}

function resolveWelcomeProfile(
  settings,
  { customerPhone = "", chatId = "", alternateChatId = "", profileId = "" } = {}
) {
  const profiles = Array.isArray(settings?.countryGreetings)
    ? settings.countryGreetings
    : [];
  const savedProfile = profileId
    ? profiles.find((profile) => String(profile.id) === String(profileId))
    : null;
  const phoneCandidates = [
    customerPhone,
    ...[alternateChatId, chatId].filter((value) =>
      /@(s\.whatsapp\.net|c\.us)$/i.test(String(value || ""))
    )
  ]
    .filter(Boolean)
    .map(whatsappPhoneDigits)
    .filter(Boolean);
  const phoneDigits = phoneCandidates[0] || "";
  const matchedProfile = savedProfile ||
    profiles
      .filter((profile) => profile.enabled !== false)
      .map((profile, index) => ({
        ...profile,
        profileOrder: index,
        callingCodeDigits: String(profile.callingCode || "").replace(/\D/g, "")
      }))
      .filter(
        (profile) =>
          profile.callingCodeDigits &&
          phoneDigits.startsWith(profile.callingCodeDigits)
      )
      .sort(
        (first, second) =>
          second.callingCodeDigits.length - first.callingCodeDigits.length ||
          second.profileOrder - first.profileOrder
      )[0] ||
    null;
  const fallbackMessages = Array.isArray(settings?.greetingMessages)
    ? settings.greetingMessages
    : [];

  return {
    profile: matchedProfile,
    phoneDigits,
    messages: (matchedProfile?.messages || fallbackMessages).slice(0, 3)
  };
}

function resolveCountryPriceBook(
  data,
  { customerPhone = "", chatId = "", alternateChatId = "", priceBookId = "" } = {}
) {
  const priceBooks = Array.isArray(data?.countryPriceBooks)
    ? data.countryPriceBooks
    : [];
  const savedBook = priceBookId
    ? priceBooks.find(
        (book) =>
          String(book.id) === String(priceBookId) && book.enabled !== false
      )
    : null;
  const phoneCandidates = [
    customerPhone,
    ...[alternateChatId, chatId].filter((value) =>
      /@(s\.whatsapp\.net|c\.us)$/i.test(String(value || ""))
    )
  ]
    .filter(Boolean)
    .map(whatsappPhoneDigits)
    .filter(Boolean);
  const phoneDigits = phoneCandidates[0] || "";
  const book = savedBook ||
    priceBooks
      .filter((entry) => entry.enabled !== false)
      .map((entry) => ({
        ...entry,
        callingCodeDigits: String(entry.callingCode || "").replace(/\D/g, "")
      }))
      .filter(
        (entry) =>
          entry.callingCodeDigits &&
          phoneDigits.startsWith(entry.callingCodeDigits)
      )
      .sort(
        (first, second) =>
          second.callingCodeDigits.length - first.callingCodeDigits.length
      )[0] ||
    null;
  return { book, phoneDigits };
}

class BotEngine {
  constructor({ store, ai = null, sendText }) {
    this.store = store;
    this.ai = ai;
    this.sendText = sendText;
  }

  async handleIncoming({
    chatId,
    alternateChatId = "",
    customerPhone = "",
    body = "",
    hasMedia = false,
    fromName = "",
    messageId = ""
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
    const settings = this.store.getSettings();
    const storeData = this.store.snapshot?.() || this.store.data || {};
    const localPricing = resolveCountryPriceBook(storeData, {
      customerPhone,
      chatId,
      alternateChatId,
      priceBookId: conversation.localPriceBookId || ""
    });
    const client =
      this.store.findClientByWhatsApp?.(chatId, alternateChatId) || null;
    const normalizedMessageId = String(messageId || "").trim();
    if (
      normalizedMessageId &&
      conversations.some(
        (item) => String(item.lastInboundMessageId || "") === normalizedMessageId
      )
    ) {
      return { action: "duplicate-inbound" };
    }
    const currentMessage = String(body || "").trim();
    const recentUserMessages = [
      ...(Array.isArray(conversation.recentUserMessages)
        ? conversation.recentUserMessages
        : []),
      ...(currentMessage ? [currentMessage.slice(0, 1200)] : [])
    ].slice(-4);

    updateConversations({
      firstInboundAt: conversation.firstInboundAt || now,
      lastInboundAt: now,
      lastInboundPreview: String(body || "").slice(0, 180),
      lastInboundHadMedia: Boolean(hasMedia),
      firstInboundName: conversation.firstInboundName || fromName || "",
      recentUserMessages,
      ...(normalizedMessageId
        ? { lastInboundMessageId: normalizedMessageId }
        : {}),
      ...(client ? { registeredClientId: client.id } : {}),
      ...(localPricing.book
        ? {
            localPriceBookId: localPricing.book.id,
            localCountry: localPricing.book.country,
            localCallingCode: localPricing.book.callingCode,
            localCurrency: localPricing.book.currency,
            localCurrencySymbol: localPricing.book.symbol
          }
        : {})
    });

    if (settings.afkEnabled) {
      const afkSessionId = String(settings.afkSessionId || "afk-activo");
      const alreadyAnswered = conversations.some(
        (item) => String(item.lastAfkSessionId || "") === afkSessionId
      );
      if (alreadyAnswered) {
        return {
          action: "afk-already-sent",
          clientId: client?.id || null
        };
      }

      await this.sendText(chatId, settings.afkMessage);
      updateConversations({
        lastAfkSessionId: afkSessionId,
        lastAfkSentAt: new Date().toISOString()
      });
      this.store.addLog(
        "afk",
        `Respuesta AFK enviada a ${fromName || chatId}`,
        { chatId, clientId: client?.id || null }
      );
      this.store.save();
      return {
        action: "afk-reply",
        messages: 1,
        clientId: client?.id || null
      };
    }

    if (!client && !conversation.welcomeSequenceSentAt) {
      const welcome = resolveWelcomeProfile(settings, {
        customerPhone,
        chatId,
        alternateChatId,
        profileId: conversation.welcomeCountryGreetingId || ""
      });
      const messages = welcome.messages;
      const previousCount = Math.max(
        0,
        Math.min(3, Number(conversation.welcomeMessagesSent) || 0)
      );

      updateConversations({
        welcomeCountryGreetingId: welcome.profile?.id || null,
        welcomeCountry: welcome.profile?.country || null,
        welcomeCallingCode: welcome.profile?.callingCode || null,
        welcomeCurrency: welcome.profile?.currency || null
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
        {
          chatId,
          messages: sentNow,
          country: welcome.profile?.country || null,
          callingCode: welcome.profile?.callingCode || null,
          currency: welcome.profile?.currency || null,
          usedFallback: !welcome.profile
        }
      );
      this.store.save();

      return {
        action: previousCount ? "welcome-resumed" : "welcome-sequence",
        messages: sentNow,
        country: welcome.profile?.country || null,
        callingCode: welcome.profile?.callingCode || null,
        usedFallback: !welcome.profile
      };
    }

    if (this.ai?.isReplyEnabled?.() && currentMessage) {
      const detectedWelcome = resolveWelcomeProfile(settings, {
        customerPhone,
        chatId,
        alternateChatId,
        profileId: conversation.welcomeCountryGreetingId || ""
      });
      try {
        const answer = await this.ai.answer({
          question: currentMessage,
          conversation: {
            ...conversation,
            recentUserMessages,
            welcomeCountry:
              conversation.welcomeCountry || detectedWelcome.profile?.country || null,
            welcomeCallingCode:
              conversation.welcomeCallingCode || detectedWelcome.profile?.callingCode || null,
            welcomeCurrency:
              conversation.welcomeCurrency || detectedWelcome.profile?.currency || null,
            localPriceBookId:
              conversation.localPriceBookId || localPricing.book?.id || null,
            localCountry:
              conversation.localCountry || localPricing.book?.country || null,
            localCallingCode:
              conversation.localCallingCode || localPricing.book?.callingCode || null,
            localCurrency:
              conversation.localCurrency || localPricing.book?.currency || null,
            localCurrencySymbol:
              conversation.localCurrencySymbol || localPricing.book?.symbol || null,
            registeredClientId: client?.id || conversation.registeredClientId || null
          }
        });
        if (answer) {
          await this.sendText(chatId, answer);
          updateConversations({
            lastAiReplyAt: new Date().toISOString(),
            lastAiReplyPreview: String(answer).slice(0, 180)
          });
          this.store.addLog(
            "ai",
            `Gemini respondió a ${fromName || chatId}`,
            {
              chatId,
              clientId: client?.id || null,
              provider: this.ai.getStatus?.().provider || "gemini"
            }
          );
          this.store.save();
          return {
            action: "ai-reply",
            messages: 1,
            clientId: client?.id || null
          };
        }
      } catch (error) {
        this.store.addLog(
          "ai",
          `La IA no respondió a ${fromName || chatId}: ${error.message}`,
          {
            chatId,
            clientId: client?.id || null,
            code: error.code || "ai_error"
          }
        );
        this.store.save();
        return {
          action: "ai-error",
          messages: 0,
          clientId: client?.id || null,
          errorCode: error.code || "ai_error"
        };
      }
    }

    this.store.save();
    if (client) {
      return { action: "registered-client", clientId: client.id };
    }
    return { action: "welcome-already-sent" };
  }
}

module.exports = {
  BotEngine,
  normalizeText,
  resolveWelcomeProfile,
  resolveCountryPriceBook,
  whatsappPhoneDigits
};
