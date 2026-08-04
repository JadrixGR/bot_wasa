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

function welcomeSequence(source, fallbackMessages = []) {
  if (Array.isArray(source?.sequence) && source.sequence.length) {
    const normalizedSequence = source.sequence
      .map((item) => ({
        id: String(item?.id || ""),
        text: String(item?.text || "").trim(),
        image: item?.image || null
      }))
      .filter((item) => item.text);
    const legacyMessages = Array.isArray(source?.messages)
      ? source.messages.map((text) => String(text || "").trim()).filter(Boolean)
      : [];
    const sequenceTexts = normalizedSequence.map((item) => item.text);
    if (
      legacyMessages.length &&
      (legacyMessages.length !== sequenceTexts.length ||
        legacyMessages.some((text, index) => text !== sequenceTexts[index]))
    ) {
      return legacyMessages.map((text, index) => ({
        id: `legacy-message-${index + 1}`,
        text,
        image: null
      }));
    }
    return normalizedSequence;
  }
  const messages = Array.isArray(source?.messages)
    ? source.messages
    : fallbackMessages;
  return (Array.isArray(messages) ? messages : [])
    .map((text, index) => ({
      id: `legacy-message-${index + 1}`,
      text: String(text || "").trim(),
      image: null
    }))
    .filter((item) => item.text);
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
  const fallbackSequence = welcomeSequence(
    {
      sequence: settings?.greetingSequence,
      messages: settings?.greetingMessages
    },
    settings?.greetingMessages
  );
  const sequence = matchedProfile
    ? welcomeSequence(matchedProfile, fallbackSequence.map((item) => item.text))
    : fallbackSequence;

  return {
    profile: matchedProfile,
    phoneDigits,
    sequence,
    messages: sequence.map((item) => item.text)
  };
}

function adReferralValues(adReferral = {}) {
  const source =
    adReferral && typeof adReferral === "object" ? adReferral : {};
  return [
    source.title,
    source.body,
    source.sourceId,
    source.sourceUrl,
    source.ref,
    source.sourceType,
    source.sourceApp
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function resolveAdWelcomeProfile(
  settings,
  { adReferral = null, profileId = "" } = {}
) {
  const profiles = Array.isArray(settings?.adGreetings)
    ? settings.adGreetings
    : [];
  const savedProfile = profileId
    ? profiles.find((profile) => String(profile.id) === String(profileId))
    : null;
  if (savedProfile) return savedProfile;
  const referralValues = adReferralValues(adReferral);
  if (!referralValues.length) return null;
  const normalizedValues = referralValues.map(normalizeText).filter(Boolean);

  return profiles
    .filter((profile) => profile.enabled !== false)
    .map((profile, profileOrder) => {
      let score = 0;
      for (const term of profile.matchTerms || []) {
        const normalizedTerm = normalizeText(term);
        if (normalizedTerm.length < 4) continue;
        for (const value of normalizedValues) {
          if (value === normalizedTerm) {
            score = Math.max(score, 10000 + normalizedTerm.length);
          } else if (value.includes(normalizedTerm)) {
            score = Math.max(score, normalizedTerm.length);
          }
        }
      }
      return { profile, score, profileOrder };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (first, second) =>
        second.score - first.score || second.profileOrder - first.profileOrder
    )[0]?.profile || null;
}

function resolveWelcomeSelection(
  settings,
  {
    customerPhone = "",
    chatId = "",
    alternateChatId = "",
    countryProfileId = "",
    adProfileId = "",
    adReferral = null
  } = {}
) {
  const fallbackSequence = welcomeSequence(
    {
      sequence: settings?.greetingSequence,
      messages: settings?.greetingMessages
    },
    settings?.greetingMessages
  );
  const countryWelcome = resolveWelcomeProfile(settings, {
    customerPhone,
    chatId,
    alternateChatId,
    profileId: countryProfileId
  });
  if (settings?.welcomeRoutingMode === "general") {
    return {
      source: "general",
      adProfile: null,
      profile: null,
      phoneDigits: countryWelcome.phoneDigits,
      sequence: fallbackSequence,
      messages: fallbackSequence.map((item) => item.text)
    };
  }
  const adProfile = resolveAdWelcomeProfile(settings, {
    adReferral,
    profileId: adProfileId
  });
  if (adProfile) {
    const sequence = welcomeSequence(
      adProfile,
      fallbackSequence.map((item) => item.text)
    );
    return {
      source: "ad",
      adProfile,
      profile: countryWelcome.profile,
      phoneDigits: countryWelcome.phoneDigits,
      sequence,
      messages: sequence.map((item) => item.text)
    };
  }
  return {
    source: countryWelcome.profile ? "country" : "general",
    adProfile: null,
    ...countryWelcome
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
  constructor({ store, ai = null, sendText, sendMedia = null }) {
    this.store = store;
    this.ai = ai;
    this.sendText = sendText;
    this.sendMedia = sendMedia;
  }

  async handleIncoming({
    chatId,
    alternateChatId = "",
    customerPhone = "",
    body = "",
    hasMedia = false,
    fromName = "",
    messageId = "",
    adReferral = null
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
        : {}),
      ...(adReferral
        ? {
            lastAdTitle: String(adReferral.title || "").slice(0, 300),
            lastAdBody: String(adReferral.body || "").slice(0, 1200),
            lastAdSourceId: String(adReferral.sourceId || "").slice(0, 300),
            lastAdSourceUrl: String(adReferral.sourceUrl || "").slice(0, 1000),
            lastAdSeenAt: now
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
      const welcome = resolveWelcomeSelection(settings, {
        customerPhone,
        chatId,
        alternateChatId,
        countryProfileId: conversation.welcomeCountryGreetingId || "",
        adProfileId: conversation.welcomeAdGreetingId || "",
        adReferral
      });
      const sequence = welcome.sequence || welcome.messages.map((text) => ({
        text,
        image: null
      }));
      const previousCount = Math.max(
        0,
        Math.min(sequence.length, Number(conversation.welcomeMessagesSent) || 0)
      );

      updateConversations({
        welcomeCountryGreetingId: welcome.profile?.id || null,
        welcomeCountry: welcome.profile?.country || null,
        welcomeCallingCode: welcome.profile?.callingCode || null,
        welcomeCurrency: welcome.profile?.currency || null,
        welcomeAdGreetingId: welcome.adProfile?.id || null,
        welcomeAdName: welcome.adProfile?.name || null,
        welcomeSource: welcome.source
      });

      let sentNow = 0;
      for (let index = previousCount; index < sequence.length; index += 1) {
        const item = sequence[index];
        if (item.image?.path && this.sendMedia) {
          try {
            await this.sendMedia(chatId, item.image.path, {
              caption: item.text
            });
          } catch (error) {
            this.store.addLog(
              "welcome-media",
              `No se pudo enviar la imagen de bienvenida; se envió el texto: ${error.message}`,
              { chatId, messageId: item.id || null }
            );
            await this.sendText(chatId, item.text);
          }
        } else {
          await this.sendText(chatId, item.text);
        }
        sentNow += 1;
        updateConversations({
          welcomeMessagesSent: index + 1
        });
      }

      updateConversations({
        welcomeMessagesSent: sequence.length,
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
          adGreetingId: welcome.adProfile?.id || null,
          adName: welcome.adProfile?.name || null,
          source: welcome.source,
          usedFallback: welcome.source === "general"
        }
      );
      this.store.save();

      return {
        action: previousCount ? "welcome-resumed" : "welcome-sequence",
        messages: sentNow,
        country: welcome.profile?.country || null,
        callingCode: welcome.profile?.callingCode || null,
        adGreetingId: welcome.adProfile?.id || null,
        adName: welcome.adProfile?.name || null,
        source: welcome.source,
        usedFallback: welcome.source === "general"
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
  adReferralValues,
  normalizeText,
  resolveAdWelcomeProfile,
  resolveWelcomeProfile,
  resolveWelcomeSelection,
  resolveCountryPriceBook,
  whatsappPhoneDigits
};
