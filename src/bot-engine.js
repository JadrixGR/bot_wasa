"use strict";

const { commandForItem } = require("./command-registry");

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
        image: item?.image || null,
        audio: item?.audio || null
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
        image: null,
        audio: null
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
      image: null,
      audio: null
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

function catalogPurchaseIntent(
  data,
  { messages = [], lastItemId = "" } = {}
) {
  const entries = [
    ...(data?.products || []).map((item) => ({ item, itemType: "product" })),
    ...(data?.plans || []).map((item) => ({ item, itemType: "plan" }))
  ].filter(({ item }) => item?.id && item?.name && item.commandEnabled !== false);

  for (const message of [...messages].reverse()) {
    const normalizedMessage = normalizeText(message);
    if (!normalizedMessage) continue;
    const match = entries
      .map((entry) => {
        const terms = [
          entry.item.name,
          ...(entry.item.aliases || []),
          entry.item.command
        ]
          .map(normalizeText)
          .filter((term) => term.length >= 3);
        const score = Math.max(
          0,
          ...terms.map((term) =>
            normalizedMessage === term
              ? 10000 + term.length
              : normalizedMessage.includes(term)
                ? term.length
                : 0
          )
        );
        return { ...entry, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((first, second) => second.score - first.score)[0];
    if (match) return match;
  }

  return entries.find(
    ({ item }) => String(item.id) === String(lastItemId || "")
  ) || null;
}

function parseLocalizedAmount(value) {
  let raw = String(value || "").trim().replace(/\s/g, "");
  if (!raw) return null;
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const thousands = decimal === "," ? /\./g : /,/g;
    raw = raw.replace(thousands, "").replace(decimal, ".");
  } else {
    const separator = lastComma >= 0 ? "," : lastDot >= 0 ? "." : "";
    if (separator) {
      const decimals = raw.length - raw.lastIndexOf(separator) - 1;
      raw = decimals === 1 || decimals === 2
        ? raw.replace(separator, ".")
        : raw.replace(new RegExp(`\\${separator}`, "g"), "");
    }
  }
  const amount = Number(raw.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function moneyValues(priceText) {
  const source = String(priceText || "");
  const values = [];
  const pattern = /(?:S\/|MX\$|AR\$|USDT|USD|\$)\s*([0-9][0-9.,]*)/gi;
  for (const match of source.matchAll(pattern)) {
    const amount = parseLocalizedAmount(match[1]);
    if (amount !== null) {
      values.push({ amount, display: match[0].replace(/\s+/g, "") });
    }
  }
  if (!values.length) {
    const amount = parseLocalizedAmount(source.match(/[0-9][0-9.,]*/)?.[0]);
    if (amount !== null) values.push({ amount, display: String(amount) });
  }
  return values.filter(
    (entry, index, all) =>
      all.findIndex((candidate) => candidate.amount === entry.amount) === index
  );
}

function paymentOptionsForItem(item, priceBook = null) {
  if (!item) return [];
  const localPrice = priceBook?.prices?.[item.id] || item.price || "";
  const values = moneyValues(localPrice);
  const defaultDurations = item.id === "gemini-pro"
    ? [30, 365, 540]
    : [30, 365, 540, 730];
  const currency = String(priceBook?.currency || "").match(/\b[A-Z]{3,5}\b/)?.[0] ||
    (/USDT/i.test(localPrice) ? "USDT" : /S\//i.test(localPrice) ? "PEN" : "");
  return values.map((entry, index) => ({
    ...entry,
    durationDays: defaultDurations[index] || 30,
    currency
  }));
}

function normalizedCurrency(value) {
  const normalized = normalizeText(value).replace(/\s/g, "");
  if (/^(pen|sol|soles|s)$/.test(normalized)) return "PEN";
  if (/^(mxn|pesomexicano|pesosmexicanos|mx)$/.test(normalized)) return "MXN";
  if (/^(ars|pesoargentino|pesosargentinos|ar)$/.test(normalized)) return "ARS";
  if (/^(usd|dolar|dolares|us)$/.test(normalized)) return "USD";
  if (/^(usdt|tether)$/.test(normalized)) return "USDT";
  return String(value || "").trim().toUpperCase();
}

function validatePaymentAnalysis(analysis, options = []) {
  if (!analysis?.isPaymentReceipt) {
    return { ok: false, reason: "not_receipt" };
  }
  if (!analysis.paymentConfirmed || Number(analysis.confidence) < 0.9) {
    return { ok: false, reason: "not_confirmed" };
  }
  if (!analysis.transactionId || String(analysis.transactionId).length < 4) {
    return { ok: false, reason: "missing_reference" };
  }
  if (analysis.recipientMatchesExpected !== true) {
    return { ok: false, reason: "recipient_mismatch" };
  }
  const amount = Number(analysis.amount);
  const option = options.find(
    (entry) => Math.abs(Number(entry.amount) - amount) < 0.01
  );
  if (!option) return { ok: false, reason: "amount_mismatch" };
  const expectedCurrency = normalizedCurrency(option.currency);
  const detectedCurrency = normalizedCurrency(analysis.currency);
  if (
    expectedCurrency &&
    (!detectedCurrency || detectedCurrency !== expectedCurrency)
  ) {
    return { ok: false, reason: "currency_mismatch" };
  }
  return { ok: true, option };
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
    whatsapp = "",
    whatsappPhone = "",
    whatsappUsername = "",
    whatsappChatId = "",
    body = "",
    hasMedia = false,
    mediaType = "",
    media = null,
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
    const purchaseIntent = catalogPurchaseIntent(storeData, {
      messages: recentUserMessages,
      lastItemId: conversation.lastPurchaseIntentId || ""
    });

    updateConversations({
      firstInboundAt: conversation.firstInboundAt || now,
      lastInboundAt: now,
      lastInboundPreview: String(body || "").slice(0, 180),
      lastInboundHadMedia: Boolean(hasMedia),
      firstInboundName: conversation.firstInboundName || fromName || "",
      recentUserMessages,
      ...(purchaseIntent
        ? {
            lastPurchaseIntentId: purchaseIntent.item.id,
            lastPurchaseIntentAt: now
          }
        : {}),
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

    const aiEnabled = Boolean(this.ai?.isReplyEnabled?.());
    let welcomeResult = null;
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
        if (item.audio?.path && this.sendMedia) {
          try {
            await this.sendMedia(chatId, item.audio.path, {
              asVoice: true
            });
          } catch (error) {
            this.store.addLog(
              "welcome-media",
              `No se pudo enviar el audio de bienvenida: ${error.message}`,
              { chatId, messageId: item.id || null }
            );
          }
        }
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

      welcomeResult = {
        action: previousCount ? "welcome-resumed" : "welcome-sequence",
        messages: sentNow,
        country: welcome.profile?.country || null,
        callingCode: welcome.profile?.callingCode || null,
        adGreetingId: welcome.adProfile?.id || null,
        adName: welcome.adProfile?.name || null,
        source: welcome.source,
        usedFallback: welcome.source === "general"
      };
      if (!aiEnabled) return welcomeResult;
    }

    const welcomeMessageCount = Number(welcomeResult?.messages || 0);
    const aiStatus = this.ai?.getStatus?.() || {};
    const paymentRecognitionEnabled = Boolean(
      aiEnabled &&
        aiStatus.provider === "claude" &&
        aiStatus.autoRegisterPayments !== false &&
        typeof this.ai?.analyzePaymentReceipt === "function"
    );
    const paymentOptions = purchaseIntent
      ? paymentOptionsForItem(purchaseIntent.item, localPricing.book)
      : [];
    const paymentInstructions =
      localPricing.book?.callingCode === "+51"
        ? settings.peruPayment
        : settings.internationalPayment;

    const registerRecognizedPayment = async (analysis, intent, validation) => {
      const registrationIdentity =
        whatsapp ||
        whatsappPhone ||
        whatsappUsername ||
        customerPhone ||
        alternateChatId ||
        chatId;
      if (!registrationIdentity) {
        throw new Error("WhatsApp no entregó una identidad válida del cliente.");
      }
      const command = commandForItem(intent.item, intent.itemType);
      const registration = this.store.registerClientFromCommand({
        whatsapp: registrationIdentity,
        whatsappPhone: whatsappPhone || customerPhone,
        whatsappUsername,
        whatsappChatId: whatsappChatId || chatId,
        name: fromName || whatsappUsername || whatsappPhone || "Cliente",
        item: {
          id: intent.item.id,
          name: intent.item.name,
          price: validation.option.display || intent.item.price || ""
        },
        days: validation.option.durationDays,
        command,
        commandMessageId: String(messageId || ""),
        registrationSource: "whatsapp-payment-ai",
        paymentMethod: analysis.paymentMethod || "Comprobante por WhatsApp",
        accountReference: analysis.transactionId,
        notes: `Pago reconocido automáticamente desde un comprobante enviado por WhatsApp. Confianza: ${Math.round(Number(analysis.confidence) * 100)}%.`
      });
      const registered = registration.client;
      if (registration.duplicate) {
        updateConversations({
          pendingPaymentReceipt: null,
          pendingPaymentReceiptAt: null
        });
        await this.sendText(
          chatId,
          "⚠️ La referencia de este comprobante ya fue utilizada. No se creó otro registro y un asesor revisará el caso."
        );
        this.store.addLog(
          "payment",
          "Se bloqueó un comprobante con referencia ya utilizada",
          { chatId, productId: intent.item.id }
        );
        this.store.save();
        return {
          action: "payment-review",
          messages: welcomeMessageCount + 1,
          reason: "duplicate_reference"
        };
      }
      updateConversations({
        registeredClientId: registered?.id || conversation.registeredClientId || null,
        pendingPaymentReceipt: null,
        pendingPaymentReceiptAt: null,
        lastPaymentRegisteredAt: new Date().toISOString(),
        lastPaymentMessageId: String(messageId || "")
      });
      const confirmation = [
        "✅ *¡Pago reconocido y cliente registrado!* 🎉",
        `Servicio: *${intent.item.name}*`,
        `Vigencia: *${validation.option.durationDays} días*`,
        registered?.expiryDate
          ? `Vence: *${registered.expiryDate}*`
          : "",
        "Te enviaremos los datos de acceso por este chat."
      ]
        .filter(Boolean)
        .join("\n");
      await this.sendText(chatId, confirmation);
      this.store.addLog(
        "payment",
        `Comprobante reconocido y cliente registrado: ${intent.item.name}`,
        {
          chatId,
          clientId: registered?.id || null,
          productId: intent.item.id,
          confidence: analysis.confidence,
          duplicate: false
        }
      );
      this.store.save();
      return {
        action: "payment-registered",
        messages: welcomeMessageCount + 1,
        clientId: registered?.id || null,
        productId: intent.item.id,
        duplicate: false
      };
    };

    const pendingPayment = conversation.pendingPaymentReceipt;
    const pendingPaymentAge = Date.now() - Date.parse(
      conversation.pendingPaymentReceiptAt || ""
    );
    if (
      paymentRecognitionEnabled &&
      !hasMedia &&
      currentMessage &&
      purchaseIntent &&
      pendingPayment?.isPaymentReceipt &&
      Number.isFinite(pendingPaymentAge) &&
      pendingPaymentAge >= 0 &&
      pendingPaymentAge <= 30 * 60 * 1000
    ) {
      const validation = validatePaymentAnalysis(
        pendingPayment,
        paymentOptionsForItem(purchaseIntent.item, localPricing.book)
      );
      updateConversations({
        pendingPaymentReceipt: null,
        pendingPaymentReceiptAt: null
      });
      if (validation.ok) {
        return registerRecognizedPayment(
          pendingPayment,
          purchaseIntent,
          validation
        );
      }
      await this.sendText(
        chatId,
        "🧾 Encontré el comprobante, pero el importe o la moneda no coincide con ese servicio. Lo dejaré para revisión de un asesor."
      );
      this.store.addLog("payment", "Comprobante pendiente de revisión", {
        chatId,
        reason: validation.reason,
        productId: purchaseIntent.item.id
      });
      this.store.save();
      return {
        action: "payment-review",
        messages: welcomeMessageCount + 1,
        reason: validation.reason
      };
    }

    if (paymentRecognitionEnabled && media?.dataUrl) {
      try {
        const analysis = await this.ai.analyzePaymentReceipt({
          imageDataUrl: media.dataUrl,
          expectedPayment: {
            product: purchaseIntent?.item?.name || "",
            currency: paymentOptions[0]?.currency || "",
            allowedAmounts: paymentOptions.map((option) => option.amount),
            paymentInstructions
          }
        });
        if (analysis.isPaymentReceipt) {
          if (!purchaseIntent) {
            updateConversations({
              pendingPaymentReceipt: analysis,
              pendingPaymentReceiptAt: new Date().toISOString()
            });
            await this.sendText(
              chatId,
              "🧾 ¡Recibí tu comprobante! Para registrarte correctamente, dime qué servicio pagaste, por ejemplo: *ChatGPT Plus*."
            );
            this.store.save();
            return {
              action: "payment-needs-product",
              messages: welcomeMessageCount + 1
            };
          }
          const validation = validatePaymentAnalysis(analysis, paymentOptions);
          if (validation.ok) {
            return registerRecognizedPayment(
              analysis,
              purchaseIntent,
              validation
            );
          }
          await this.sendText(
            chatId,
            "🧾 Recibí tu comprobante, pero no pude validarlo automáticamente con total seguridad. Lo dejaré pendiente para que un asesor lo revise."
          );
          this.store.addLog("payment", "Comprobante pendiente de revisión", {
            chatId,
            reason: validation.reason,
            productId: purchaseIntent.item.id,
            confidence: analysis.confidence
          });
          this.store.save();
          return {
            action: "payment-review",
            messages: welcomeMessageCount + 1,
            reason: validation.reason
          };
        }
        if (!currentMessage) {
          await this.sendText(
            chatId,
            "📷 Recibí la imagen. Cuéntame brevemente qué necesitas para poder ayudarte de inmediato."
          );
          this.store.save();
          return {
            action: "ai-media-reply",
            messages: welcomeMessageCount + 1
          };
        }
      } catch (error) {
        this.store.addLog(
          "payment",
          `No se pudo analizar el comprobante: ${error.message}`,
          { chatId, code: error.code || "payment_analysis_error" }
        );
        if (!currentMessage) {
          await this.sendText(
            chatId,
            "🧾 Recibí la imagen, pero no pude verificar automáticamente si es un comprobante válido. Si corresponde a un pago, un asesor lo revisará lo antes posible."
          );
          this.store.save();
          return {
            action: "payment-review",
            messages: welcomeMessageCount + 1,
            reason: error.code || "payment_analysis_error"
          };
        }
      }
    } else if (aiEnabled && hasMedia && !currentMessage) {
      const mediaReply = mediaType === "audio"
        ? "🎙️ Recibí tu audio. Para ayudarte de inmediato, escríbeme brevemente qué necesitas."
        : mediaType === "document"
          ? "📄 Recibí el documento. Si es un comprobante, envíame también una captura como imagen JPG o PNG para reconocer el pago automáticamente."
          : mediaType === "video"
            ? "🎥 Recibí tu video. Escríbeme brevemente qué necesitas para poder ayudarte."
            : mediaType === "sticker"
              ? "👋 Recibí tu sticker. Cuéntame qué servicio buscas o qué deseas consultar."
              : "📷 Recibí la imagen, pero no pude analizarla. Cuéntame brevemente qué necesitas.";
      await this.sendText(
        chatId,
        mediaReply
      );
      this.store.save();
      return {
        action: "payment-review",
        messages: welcomeMessageCount + 1,
        reason: "media_unavailable"
      };
    }

    if (aiEnabled && currentMessage) {
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
              conversation.welcomeCountry || welcomeResult?.country || detectedWelcome.profile?.country || null,
            welcomeCallingCode:
              conversation.welcomeCallingCode || welcomeResult?.callingCode || detectedWelcome.profile?.callingCode || null,
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
            `La IA respondió a ${fromName || chatId}`,
            {
              chatId,
              clientId: client?.id || null,
              provider: this.ai.getStatus?.().provider || "gemini"
            }
          );
          this.store.save();
          return {
            action: "ai-reply",
            messages: welcomeMessageCount + 1,
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
          messages: welcomeMessageCount,
          clientId: client?.id || null,
          errorCode: error.code || "ai_error"
        };
      }
    }

    this.store.save();
    if (welcomeResult) return welcomeResult;
    if (client) {
      return { action: "registered-client", clientId: client.id };
    }
    return { action: "welcome-already-sent" };
  }
}

module.exports = {
  BotEngine,
  adReferralValues,
  catalogPurchaseIntent,
  moneyValues,
  normalizeText,
  parseLocalizedAmount,
  paymentOptionsForItem,
  resolveAdWelcomeProfile,
  resolveWelcomeProfile,
  resolveWelcomeSelection,
  resolveCountryPriceBook,
  validatePaymentAnalysis,
  whatsappPhoneDigits
};
