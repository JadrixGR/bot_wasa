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
      .map((profile) => ({
        ...profile,
        callingCodeDigits: String(profile.callingCode || "").replace(/\D/g, "")
      }))
      .filter(
        (profile) =>
          profile.callingCodeDigits &&
          phoneDigits.startsWith(profile.callingCodeDigits)
      )
      .sort(
        (first, second) =>
          second.callingCodeDigits.length - first.callingCodeDigits.length
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

class BotEngine {
  constructor({ store, sendText }) {
    this.store = store;
    this.sendText = sendText;
  }

  async handleIncoming({
    chatId,
    alternateChatId = "",
    customerPhone = "",
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
    const settings = this.store.getSettings();
    const client =
      this.store.findClientByWhatsApp?.(chatId, alternateChatId) || null;

    updateConversations({
      firstInboundAt: conversation.firstInboundAt || now,
      lastInboundAt: now,
      lastInboundPreview: String(body || "").slice(0, 180),
      lastInboundHadMedia: Boolean(hasMedia),
      firstInboundName: conversation.firstInboundName || fromName || "",
      ...(client ? { registeredClientId: client.id } : {})
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

    if (client) {
      return { action: "registered-client", clientId: client.id };
    }

    if (conversation.welcomeSequenceSentAt) {
      return { action: "welcome-already-sent" };
    }

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
}

module.exports = {
  BotEngine,
  normalizeText,
  resolveWelcomeProfile,
  whatsappPhoneDigits
};
