'use strict';

import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import 'pdf-parse/worker';
import { PDFParse } from 'pdf-parse';
import QRCode from 'qrcode';
import pino from 'pino';
import crypto from 'node:crypto';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { DEFAULT_CONFIG, SEEDED_FAQS, SEEDED_PRODUCTS } from './seed-data.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ADMIN_KEY = String(process.env.ADMIN_KEY || '').trim();
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const SESSION_PATH = process.env.SESSION_PATH || '/data/baileys_auth';
const DATA_DIR = process.env.DATA_DIR || '/data/bot-control';
const DATA_FILE = path.join(DATA_DIR, 'bot-data-v4.json');
const AUDIO_DIR = path.join(DATA_DIR, 'audios');
const WA_VERSION = String(process.env.WA_VERSION || '').trim();

fsSync.mkdirSync(AUDIO_DIR, { recursive: true });
fsSync.mkdirSync(SESSION_PATH, { recursive: true });

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === 'application/pdf' ||
      String(file.originalname || '').toLowerCase().endsWith('.pdf');
    cb(isPdf ? null : new Error('Solo se permiten archivos PDF.'), isPdf);
  },
});

const audioStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, AUDIO_DIR),
  filename: (_req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase() || '.bin';
    cb(null, `${Date.now()}-${crypto.randomUUID()}${extension}`);
  },
});

const audioUpload = multer({
  storage: audioStorage,
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const allowedMime = new Set([
      'audio/mpeg',
      'audio/mp3',
      'audio/ogg',
      'audio/mp4',
      'audio/x-m4a',
      'audio/wav',
      'audio/x-wav',
      'audio/webm',
    ]);
    const extension = path.extname(file.originalname || '').toLowerCase();
    const allowedExt = new Set(['.mp3', '.ogg', '.m4a', '.mp4', '.wav', '.webm']);
    const ok = allowedMime.has(file.mimetype) || allowedExt.has(extension);
    cb(ok ? null : new Error('Usa un audio MP3, OGG, M4A, WAV o WEBM.'), ok);
  },
});

let database = {
  version: 4,
  config: { ...DEFAULT_CONFIG },
  products: [],
  faqs: [],
  documents: [],
  knowledgeChunks: [],
  audios: [],
  customers: [],
  payments: [],
  contactState: {},
  updatedAt: new Date().toISOString(),
};

const runtime = {
  version: 4,
  engine: 'Baileys + OpenAI',
  status: 'iniciando',
  detail: 'Preparando la conexión...',
  qrDataUrl: null,
  connectedNumber: null,
  botEnabled: true,
  startedAt: new Date().toISOString(),
  lastEventAt: new Date().toISOString(),
  messagesReceived: 0,
  repliesSent: 0,
  aiReplies: 0,
  ruleReplies: 0,
  welcomeSequences: 0,
  audiosSent: 0,
  remindersSent: 0,
  aiErrors: 0,
  waVersion: null,
};

const recentEvents = [];
const processedMessages = new Set();
const processedOrder = [];
const humanModeUntil = new Map();
const lastReplyAt = new Map();
const conversationHistory = new Map();
const waLogger = pino({ level: process.env.WA_LOG_LEVEL || 'silent' });
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

let socket = null;
let startingSocket = false;
let reconnectTimer = null;
let generation = 0;
let shuttingDown = false;
let saveQueue = Promise.resolve();
let billingCheckRunning = false;

function addEvent(type, text) {
  const item = { type, text, at: new Date().toISOString() };
  recentEvents.unshift(item);
  recentEvents.splice(60);
  runtime.lastEventAt = item.at;
  console.log(`[${item.at}] [${type}] ${text}`);
}

function setStatus(status, detail) {
  runtime.status = status;
  runtime.detail = detail;
  runtime.lastEventAt = new Date().toISOString();
}

function cleanString(value, max = 5000) {
  return String(value ?? '').replace(/\0/g, '').trim().slice(0, max);
}

function normalizeText(text) {
  return cleanString(text, 30000)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizePhone(value) {
  return String(value || '').replace(/\D/g, '');
}

function phoneToJid(value) {
  const digits = normalizePhone(value);
  return digits ? `${digits}@s.whatsapp.net` : '';
}

function maskPhone(value) {
  const digits = String(value || '').split('@')[0].replace(/\D/g, '');
  if (digits.length <= 4) return digits || 'desconocido';
  return `${digits.slice(0, 3)}***${digits.slice(-3)}`;
}

function rememberMessage(id) {
  if (!id || processedMessages.has(id)) return false;
  processedMessages.add(id);
  processedOrder.push(id);
  while (processedOrder.length > 3000) {
    processedMessages.delete(processedOrder.shift());
  }
  return true;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isAdmin(req) {
  if (!ADMIN_KEY) return false;
  const supplied = String(req.get('x-admin-key') || req.query.key || '');
  return supplied === ADMIN_KEY;
}

function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) {
    return res.status(503).json({ ok: false, error: 'Falta configurar ADMIN_KEY en Render.' });
  }
  if (!isAdmin(req)) {
    return res.status(401).json({ ok: false, error: 'Clave incorrecta.' });
  }
  next();
}

function tokenize(text) {
  const stop = new Set([
    'a','al','algo','como','con','cual','de','del','el','ella','en','es','esta','este','hay',
    'la','las','lo','los','me','mi','para','por','que','quiero','se','si','su','un','una','y',
    'tiene','tienen','tengo','necesito','sobre','cuanto','cuesta','deseo','interesa','estimado',
  ]);
  return normalizeText(text)
    .split(' ')
    .filter((word) => word.length >= 2 && !stop.has(word));
}

function scoreText(query, candidate) {
  const q = normalizeText(query);
  const c = normalizeText(candidate);
  if (!q || !c) return 0;
  let score = 0;
  if (c === q) score += 100;
  if (c.includes(q)) score += 18;
  if (q.includes(c) && c.length >= 4) score += 15;
  const queryTokens = [...new Set(tokenize(q))];
  for (const token of queryTokens) {
    if (c.includes(token)) score += token.length >= 7 ? 4 : 2;
  }
  return score;
}

function topMatches(query, items, textBuilder, limit = 6) {
  return items
    .map((item) => ({ item, score: scoreText(query, textBuilder(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}

function productText(product) {
  return [product.name, product.tags, product.knowledge, product.category].join(' ');
}

function faqText(faq) {
  return [faq.title, faq.triggers, faq.answer].join(' ');
}

function sanitizeConfig(input = {}) {
  const current = database.config || DEFAULT_CONFIG;
  const answerMode = ['rules', 'hybrid', 'ai'].includes(input.answerMode)
    ? input.answerMode
    : current.answerMode;
  const effort = ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(input.reasoningEffort)
    ? input.reasoningEffort
    : current.reasoningEffort;
  const welcomeMessages = Array.isArray(input.welcomeMessages)
    ? input.welcomeMessages.slice(0, 3).map((item) => cleanString(item, 10000))
    : current.welcomeMessages;

  return {
    businessName: cleanString(input.businessName ?? current.businessName, 150) || 'JadrixServs',
    aiEnabled: Boolean(input.aiEnabled),
    answerMode,
    aiModel: cleanString(input.aiModel ?? current.aiModel, 100) || 'gpt-5-mini',
    reasoningEffort: effort,
    maxOutputTokens: Math.max(100, Math.min(1500, Number(input.maxOutputTokens) || 500)),
    humanPauseMinutes: Math.max(1, Math.min(1440, Number(input.humanPauseMinutes) || 30)),
    supportHours: cleanString(input.supportHours ?? current.supportHours, 100),
    customerGroupUrl: cleanString(input.customerGroupUrl ?? current.customerGroupUrl, 1000),
    welcomeEnabled: input.welcomeEnabled === undefined ? Boolean(current.welcomeEnabled) : Boolean(input.welcomeEnabled),
    welcomeRepeatDays: Math.max(0, Math.min(365, Number(input.welcomeRepeatDays ?? current.welcomeRepeatDays) || 30)),
    welcomeDelayMs: Math.max(250, Math.min(5000, Number(input.welcomeDelayMs ?? current.welcomeDelayMs) || 750)),
    welcomeMessages: welcomeMessages?.length === 3 ? welcomeMessages : [...DEFAULT_CONFIG.welcomeMessages],
    systemPrompt: cleanString(input.systemPrompt ?? current.systemPrompt, 12000),
    fallbackText: cleanString(input.fallbackText ?? current.fallbackText, 5000),
    humanText: cleanString(input.humanText ?? current.humanText, 5000),
    billingAutomationEnabled:
      input.billingAutomationEnabled === undefined
        ? Boolean(current.billingAutomationEnabled)
        : Boolean(input.billingAutomationEnabled),
    defaultReminderLeadDays: [1, 2].includes(Number(input.defaultReminderLeadDays))
      ? Number(input.defaultReminderLeadDays)
      : Number(current.defaultReminderLeadDays) || 2,
    reminderHour: Math.max(0, Math.min(23, Number(input.reminderHour ?? current.reminderHour) || 10)),
    timezone: cleanString(input.timezone ?? current.timezone, 100) || 'America/Lima',
    reminderTemplate: cleanString(input.reminderTemplate ?? current.reminderTemplate, 8000),
    yapeNumber: cleanString(input.yapeNumber ?? current.yapeNumber, 50),
    yapeHolder: cleanString(input.yapeHolder ?? current.yapeHolder, 150),
    binanceId: cleanString(input.binanceId ?? current.binanceId, 100),
    penToUsdRate: Math.max(0.0001, Number(input.penToUsdRate ?? current.penToUsdRate) || 0.29),
    internationalSurchargePct: Math.max(0, Math.min(50, Number(input.internationalSurchargePct ?? current.internationalSurchargePct) || 3)),
    audioCooldownHours: Math.max(0, Math.min(720, Number(input.audioCooldownHours ?? current.audioCooldownHours) || 24)),
  };
}

function sanitizeProduct(input = {}, existing = {}) {
  return {
    id: existing.id || input.id || crypto.randomUUID(),
    seedKey: cleanString(input.seedKey ?? existing.seedKey, 100),
    name: cleanString(input.name ?? existing.name, 200),
    category: cleanString(input.category ?? existing.category, 100) || 'IA',
    pricePen: Math.max(0, Number(input.pricePen ?? existing.pricePen) || 0),
    active: input.active === undefined ? existing.active !== false : Boolean(input.active),
    soldSeparately:
      input.soldSeparately === undefined
        ? existing.soldSeparately !== false
        : Boolean(input.soldSeparately),
    durationValue: Math.max(1, Number(input.durationValue ?? existing.durationValue) || 1),
    durationUnit: ['days', 'months', 'years'].includes(input.durationUnit)
      ? input.durationUnit
      : existing.durationUnit || 'months',
    tags: cleanString(input.tags ?? existing.tags, 2000),
    knowledge: cleanString(input.knowledge ?? existing.knowledge, 10000),
    dicloak: input.dicloak === undefined ? Boolean(existing.dicloak) : Boolean(input.dicloak),
    sharingType: cleanString(input.sharingType ?? existing.sharingType, 100),
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeFaq(input = {}, existing = {}) {
  return {
    id: existing.id || input.id || crypto.randomUUID(),
    seedKey: cleanString(input.seedKey ?? existing.seedKey, 100),
    title: cleanString(input.title ?? existing.title, 200),
    triggers: cleanString(input.triggers ?? existing.triggers, 3000),
    answer: cleanString(input.answer ?? existing.answer, 8000),
    active: input.active === undefined ? existing.active !== false : Boolean(input.active),
    audioSuggested:
      input.audioSuggested === undefined
        ? Boolean(existing.audioSuggested)
        : Boolean(input.audioSuggested),
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeAudio(input = {}, existing = {}) {
  const productSeedKeys = Array.isArray(input.productSeedKeys)
    ? input.productSeedKeys.map((item) => cleanString(item, 100)).filter(Boolean).slice(0, 30)
    : existing.productSeedKeys || [];
  return {
    id: existing.id || input.id || crypto.randomUUID(),
    title: cleanString(input.title ?? existing.title, 200),
    filename: cleanString(input.filename ?? existing.filename, 500),
    originalName: cleanString(input.originalName ?? existing.originalName, 255),
    mimeType: cleanString(input.mimeType ?? existing.mimeType, 100) || 'audio/mpeg',
    triggers: cleanString(input.triggers ?? existing.triggers, 3000),
    productSeedKeys,
    active: input.active === undefined ? existing.active !== false : Boolean(input.active),
    ptt: input.ptt === undefined ? existing.ptt !== false : Boolean(input.ptt),
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function dateOnly(value) {
  const raw = cleanString(value, 50);
  const match = raw.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '';
}

function addDuration(startDate, value, unit) {
  const start = new Date(`${dateOnly(startDate)}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return '';
  const amount = Math.max(1, Number(value) || 1);
  if (unit === 'days') start.setUTCDate(start.getUTCDate() + amount);
  else if (unit === 'years') start.setUTCFullYear(start.getUTCFullYear() + amount);
  else start.setUTCMonth(start.getUTCMonth() + amount);
  return start.toISOString().slice(0, 10);
}

function compareDates(a, b) {
  return dateOnly(a).localeCompare(dateOnly(b));
}

function daysBetween(fromDate, toDate) {
  const from = new Date(`${dateOnly(fromDate)}T00:00:00Z`);
  const to = new Date(`${dateOnly(toDate)}T00:00:00Z`);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null;
  return Math.round((to - from) / 86400000);
}

function localDateParts(timezone = 'America/Lima') {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(new Date());
    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    return {
      date: `${get('year')}-${get('month')}-${get('day')}`,
      hour: Number(get('hour')),
    };
  } catch (_) {
    const now = new Date();
    return { date: now.toISOString().slice(0, 10), hour: now.getUTCHours() };
  }
}

function formatDateEs(value) {
  const parsed = new Date(`${dateOnly(value)}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value || '';
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

function sanitizeCustomer(input = {}, existing = {}) {
  const product = database.products.find((p) => p.id === input.productId || p.seedKey === input.productSeedKey);
  const activationDate = dateOnly(input.activationDate ?? existing.activationDate) || localDateParts(database.config.timezone).date;
  const durationValue = Math.max(1, Number(input.durationValue ?? existing.durationValue ?? product?.durationValue) || 1);
  const durationUnit = ['days', 'months', 'years'].includes(input.durationUnit)
    ? input.durationUnit
    : existing.durationUnit || product?.durationUnit || 'months';
  const expiryDate =
    dateOnly(input.expiryDate ?? existing.expiryDate) ||
    addDuration(activationDate, durationValue, durationUnit);
  return {
    id: existing.id || input.id || crypto.randomUUID(),
    name: cleanString(input.name ?? existing.name, 200),
    phone: normalizePhone(input.phone ?? existing.phone),
    country: cleanString(input.country ?? existing.country, 100) || 'Perú',
    productId: product?.id || cleanString(input.productId ?? existing.productId, 100),
    productSeedKey: product?.seedKey || cleanString(input.productSeedKey ?? existing.productSeedKey, 100),
    productName: product?.name || cleanString(input.productName ?? existing.productName, 200),
    pricePen: Math.max(0, Number(input.pricePen ?? existing.pricePen ?? product?.pricePen) || 0),
    paymentMethod: ['yape', 'binance', 'other'].includes(input.paymentMethod)
      ? input.paymentMethod
      : existing.paymentMethod || 'yape',
    activationDate,
    expiryDate,
    durationValue,
    durationUnit,
    reminderEnabled:
      input.reminderEnabled === undefined
        ? existing.reminderEnabled !== false
        : Boolean(input.reminderEnabled),
    reminderLeadDays: [1, 2].includes(Number(input.reminderLeadDays))
      ? Number(input.reminderLeadDays)
      : Number(existing.reminderLeadDays) || database.config.defaultReminderLeadDays,
    status: ['active', 'expiring', 'expired', 'paused'].includes(input.status)
      ? input.status
      : existing.status || 'active',
    notes: cleanString(input.notes ?? existing.notes, 3000),
    lastReminderKey: existing.lastReminderKey || '',
    lastReminderAt: existing.lastReminderAt || '',
    createdAt: existing.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(AUDIO_DIR, { recursive: true });
  await fs.mkdir(SESSION_PATH, { recursive: true });
}

function mergeSeeds() {
  const products = Array.isArray(database.products) ? database.products : [];
  for (const seed of SEEDED_PRODUCTS) {
    const found = products.find(
      (item) =>
        item.seedKey === seed.seedKey ||
        normalizeText(item.name) === normalizeText(seed.name),
    );
    if (found) {
      const keep = {
        ...seed,
        ...found,
        seedKey: found.seedKey || seed.seedKey,
        knowledge: found.knowledge || seed.knowledge,
        tags: found.tags || seed.tags,
      };
      Object.assign(found, sanitizeProduct(keep, found));
    } else {
      products.push(sanitizeProduct(seed));
    }
  }
  database.products = products;

  const faqs = Array.isArray(database.faqs) ? database.faqs : [];
  for (const seed of SEEDED_FAQS) {
    const found = faqs.find(
      (item) =>
        item.seedKey === seed.seedKey ||
        normalizeText(item.title) === normalizeText(seed.title),
    );
    if (found) {
      const keep = {
        ...seed,
        ...found,
        seedKey: found.seedKey || seed.seedKey,
        answer: found.answer || seed.answer,
        triggers: found.triggers || seed.triggers,
      };
      Object.assign(found, sanitizeFaq(keep, found));
    } else {
      faqs.push(sanitizeFaq(seed));
    }
  }
  database.faqs = faqs;
}

async function loadDatabase() {
  await ensureStorage();
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    database = {
      version: 4,
      config: { ...DEFAULT_CONFIG, ...(parsed.config || {}) },
      products: Array.isArray(parsed.products) ? parsed.products : [],
      faqs: Array.isArray(parsed.faqs) ? parsed.faqs : [],
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
      knowledgeChunks: Array.isArray(parsed.knowledgeChunks) ? parsed.knowledgeChunks : [],
      audios: Array.isArray(parsed.audios) ? parsed.audios : [],
      customers: Array.isArray(parsed.customers) ? parsed.customers : [],
      payments: Array.isArray(parsed.payments) ? parsed.payments : [],
      contactState:
        parsed.contactState && typeof parsed.contactState === 'object'
          ? parsed.contactState
          : {},
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
    database.config = sanitizeConfig(database.config);
    mergeSeeds();
    database.products = database.products.map((p) => sanitizeProduct(p, p));
    database.faqs = database.faqs.map((f) => sanitizeFaq(f, f));
    database.audios = database.audios.map((a) => sanitizeAudio(a, a));
    database.customers = database.customers.map((c) => sanitizeCustomer(c, c));
    addEvent('data', 'Base de datos v4 cargada y actualizada.');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      addEvent('warning', `No se pudo leer la base de datos: ${error.message}`);
    }
    database.config = sanitizeConfig(DEFAULT_CONFIG);
    mergeSeeds();
  }
  await saveDatabase();
}

function saveDatabase() {
  saveQueue = saveQueue
    .then(async () => {
      database.updatedAt = new Date().toISOString();
      await ensureStorage();
      const temp = `${DATA_FILE}.tmp`;
      await fs.writeFile(temp, JSON.stringify(database, null, 2), 'utf8');
      await fs.rename(temp, DATA_FILE);
    })
    .catch((error) => addEvent('error', `No se pudo guardar la configuración: ${error.message}`));
  return saveQueue;
}

function renderTemplate(text, variables = {}) {
  const config = database.config;
  const defaults = {
    negocio: config.businessName,
    soporte: config.supportHours,
    grupo: config.customerGroupUrl,
    yape: config.yapeNumber,
    titular_yape: config.yapeHolder,
    binance: config.binanceId,
  };
  let result = cleanString(text, 12000);
  for (const [key, value] of Object.entries({ ...defaults, ...variables })) {
    result = result.replaceAll(`{${key}}`, String(value ?? ''));
  }
  return result;
}

function calculateUsdt(pricePen) {
  const base = Math.max(0, Number(pricePen) || 0) * database.config.penToUsdRate;
  const total = base * (1 + database.config.internationalSurchargePct / 100);
  return Math.ceil((total - Number.EPSILON) * 100) / 100;
}

function formatPaymentBlock(method = 'yape', pricePen = null) {
  if (method === 'binance') {
    const amount = pricePen === null ? null : calculateUsdt(pricePen);
    return [
      'Pago internacional por Binance:',
      amount !== null ? `Monto: ${amount.toFixed(2)} USDT` : '',
      `ID Binance: ${database.config.binanceId}`,
      'El envío es interno mediante el ID de Binance; no debe elegir una red.',
      'Después del pago, envíe el comprobante. La activación es inmediata después de verificarlo.',
    ].filter(Boolean).join('\n');
  }
  return [
    'Yape 💳💰',
    `Número: ${database.config.yapeNumber}`,
    `Titular: ${database.config.yapeHolder}`,
    'Después del pago, envíe el comprobante para proceder con la activación.',
  ].join('\n');
}

function isInternationalQuery(text) {
  return /\b(chile|colombia|ecuador|mexico|méxico|binance|usdt|dolar|dólar|otro pais|otro país|extranjero)\b/i.test(text);
}

function isPeruQuery(text) {
  return /\b(peru|perú|yape|soles|pen)\b/i.test(text);
}

function findBestProduct(query, includeInactive = true) {
  const candidates = database.products.filter((p) => includeInactive || p.active);
  const ranked = candidates
    .map((product) => ({
      product,
      score: scoreText(query, `${product.name} ${product.tags}`),
    }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 4 ? ranked[0].product : null;
}

function findRuleReply(rawText) {
  const text = normalizeText(rawText);
  if (!text) return null;

  if (/\b(asesor|humano|persona|vendedor|agente)\b/.test(text) || text === '4') {
    return { text: renderTemplate(database.config.humanText), kind: 'human', useHumanMode: true };
  }

  const product = findBestProduct(rawText, true);
  const asksPrice = /\b(precio|cuesta|costo|pagar|comprar|cuanto|cuánto|vale)\b/.test(text);
  if (product && !product.active) {
    return {
      text: `${product.name} no está disponible actualmente, estimad@. Puedo mostrarle otras opciones activas.`,
      kind: 'unavailable',
      product,
    };
  }

  if (product && asksPrice && isInternationalQuery(text)) {
    const usdt = calculateUsdt(product.pricePen);
    return {
      text: `${product.name} cuesta S/${product.pricePen.toFixed(2)}. Para pago internacional, el monto final es ${usdt.toFixed(2)} USDT, incluido el ${database.config.internationalSurchargePct}% adicional.\n\n${formatPaymentBlock('binance', product.pricePen)}`,
      kind: 'quote',
      product,
    };
  }

  if (product && asksPrice && isPeruQuery(text)) {
    return {
      text: `${product.name} cuesta S/${product.pricePen.toFixed(2)}.\n\n${formatPaymentBlock('yape', product.pricePen)}`,
      kind: 'quote',
      product,
    };
  }

  let best = null;
  for (const faq of database.faqs.filter((item) => item.active !== false)) {
    const triggers = cleanString(faq.triggers, 3000)
      .split(/[,\n;]/)
      .map(normalizeText)
      .filter(Boolean);
    for (const trigger of triggers) {
      let score = 0;
      if (text === trigger) score = 100;
      else if (trigger.length >= 3 && text.includes(trigger)) score = 25 + trigger.length;
      else score = scoreText(text, trigger);
      if (!best || score > best.score) best = { faq, score };
    }
  }
  if (best && best.score >= 10) {
    return { text: renderTemplate(best.faq.answer), kind: 'faq', faq: best.faq, product };
  }

  return null;
}

function formatProducts(products) {
  return products
    .map((p) => {
      const availability = p.active ? 'Disponible' : 'No disponible';
      const price = p.pricePen > 0 ? `S/${p.pricePen}` : 'Incluido en combo';
      return `• ${p.name} — ${price} — ${availability}\n  ${p.knowledge}`;
    })
    .join('\n\n');
}

function buildKnowledgeContext(userText) {
  const recommendation = /\b(recomiend|necesito|busco|presupuesto|me conviene|para que|para qué)\b/i.test(userText);
  const products = recommendation
    ? database.products.filter((p) => p.active).slice(0, 30)
    : topMatches(userText, database.products, productText, 8);
  const faqs = topMatches(
    userText,
    database.faqs.filter((f) => f.active !== false),
    faqText,
    6,
  );
  const chunks = topMatches(
    userText,
    database.knowledgeChunks,
    (chunk) => `${chunk.title} ${chunk.text}`,
    8,
  );

  const blocks = [];
  if (products.length) {
    blocks.push(`PRODUCTOS RELEVANTES:\n${formatProducts(products)}`);
  }
  if (faqs.length) {
    blocks.push(
      `POLÍTICAS Y RESPUESTAS:\n${faqs.map((f) => `• ${f.title}: ${renderTemplate(f.answer)}`).join('\n')}`,
    );
  }
  if (chunks.length) {
    blocks.push(
      `INFORMACIÓN IMPORTADA:\n${chunks.map((c) => `[${c.title}]\n${c.text}`).join('\n\n')}`,
    );
  }
  return { blocks, products, faqs, chunks };
}

function historyFor(jid) {
  if (!conversationHistory.has(jid)) conversationHistory.set(jid, []);
  return conversationHistory.get(jid);
}

function addHistory(jid, role, text) {
  const history = historyFor(jid);
  history.push({ role, text: cleanString(text, 4000), at: Date.now() });
  while (history.length > 12) history.shift();
}

async function generateAIReply(userText, jid = 'panel-test') {
  if (!openai) throw new Error('OPENAI_API_KEY no está configurada en Render.');

  const config = database.config;
  const { blocks, products } = buildKnowledgeContext(userText);
  const history = historyFor(jid)
    .slice(-8)
    .map((item) => `${item.role === 'user' ? 'CLIENTE' : 'ASESOR'}: ${item.text}`)
    .join('\n');

  const payment = [
    `PAGO PERÚ: Yape ${config.yapeNumber}, titular ${config.yapeHolder}.`,
    `PAGO INTERNACIONAL: USDT por ID Binance ${config.binanceId}.`,
    `Conversión: precio PEN × ${config.penToUsdRate} × (1 + ${config.internationalSurchargePct}/100), redondeando hacia arriba a dos decimales.`,
    'La activación se realiza después de revisar el comprobante.',
  ].join('\n');

  const input = [
    blocks.length ? blocks.join('\n\n') : 'No se encontró información específica.',
    `PAGOS:\n${payment}`,
    `SOPORTE: ${config.supportHours}. Grupo de clientes: ${config.customerGroupUrl}`,
    history ? `CONVERSACIÓN RECIENTE:\n${history}` : '',
    `MENSAJE ACTUAL:\n${userText}`,
  ].filter(Boolean).join('\n\n');

  const response = await openai.responses.create({
    model: config.aiModel,
    instructions: config.systemPrompt,
    input,
    reasoning: { effort: config.reasoningEffort },
    max_output_tokens: config.maxOutputTokens,
    store: false,
  });

  const answer = cleanString(response.output_text, 7000);
  if (!answer) throw new Error('La IA no devolvió texto.');
  return { answer, product: products[0] || findBestProduct(userText, true) };
}

async function decideReply(text, jid) {
  const config = database.config;
  const rule = findRuleReply(text);

  if (rule?.useHumanMode) return rule;

  if (config.answerMode !== 'ai' && rule) {
    return rule;
  }

  const bestProduct = findBestProduct(text, true);
  const shouldUseAI =
    config.aiEnabled &&
    config.answerMode !== 'rules' &&
    Boolean(openai);

  if (shouldUseAI) {
    try {
      const result = await generateAIReply(text, jid);
      return { text: result.answer, kind: 'ai', product: result.product || bestProduct };
    } catch (error) {
      runtime.aiErrors += 1;
      addEvent('ai-error', error.message);
    }
  }

  if (bestProduct) {
    return {
      text: bestProduct.active
        ? `${bestProduct.name} — S/${bestProduct.pricePen}\n\n${bestProduct.knowledge}`
        : `${bestProduct.name} no está disponible actualmente.`,
      kind: 'product',
      product: bestProduct,
    };
  }

  if (rule) return rule;
  return { text: renderTemplate(config.fallbackText), kind: 'fallback' };
}

function isGreetingOrCatalog(text) {
  const normalized = normalizeText(text);
  return /^(hola|holi|buenas|buen dia|buenos dias|buenas tardes|buenas noches|menu|catalogo|catalogo de productos|productos|lista de precios)$/.test(normalized);
}

function catalogRequested(text) {
  return /\b(menu|catalogo|catálogo|lista de precios|productos disponibles|ver productos)\b/i.test(text);
}

function contactInfo(jid) {
  if (!database.contactState[jid]) {
    database.contactState[jid] = {
      welcomedAt: '',
      audioLastSent: {},
      updatedAt: new Date().toISOString(),
    };
  }
  return database.contactState[jid];
}

function welcomeIsDue(jid, text) {
  if (!database.config.welcomeEnabled) return false;
  if (catalogRequested(text)) return true;
  const info = contactInfo(jid);
  if (!info.welcomedAt) return true;
  const elapsed = Date.now() - new Date(info.welcomedAt).getTime();
  const days = database.config.welcomeRepeatDays;
  return days > 0 && elapsed >= days * 86400000;
}

async function sendWelcomeSequence(currentSocket, jid) {
  const messages = database.config.welcomeMessages || [];
  for (const message of messages.slice(0, 3)) {
    if (!cleanString(message)) continue;
    await currentSocket.sendMessage(jid, { text: message });
    runtime.repliesSent += 1;
    await delay(database.config.welcomeDelayMs);
  }
  const info = contactInfo(jid);
  info.welcomedAt = new Date().toISOString();
  info.updatedAt = new Date().toISOString();
  runtime.welcomeSequences += 1;
  await saveDatabase();
}

function findAudioForMessage(text, decision, jid) {
  const normalized = normalizeText(text);
  const productKey = decision?.product?.seedKey || '';
  const info = contactInfo(jid);
  const cooldownMs = database.config.audioCooldownHours * 3600000;

  const candidates = database.audios.filter((audio) => {
    if (!audio.active || !audio.filename) return false;
    const matchesProduct = productKey && audio.productSeedKeys?.includes(productKey);
    const triggers = cleanString(audio.triggers, 3000)
      .split(/[,\n;]/)
      .map(normalizeText)
      .filter(Boolean);
    const matchesTrigger = triggers.some((trigger) => normalized.includes(trigger));
    return matchesProduct || matchesTrigger;
  });

  for (const audio of candidates) {
    const last = Number(info.audioLastSent?.[audio.id] || 0);
    if (!cooldownMs || Date.now() - last >= cooldownMs) return audio;
  }
  return null;
}

async function sendConfiguredAudio(currentSocket, jid, audio) {
  const filePath = path.join(AUDIO_DIR, path.basename(audio.filename));
  const buffer = await fs.readFile(filePath);
  await currentSocket.sendMessage(jid, {
    audio: buffer,
    mimetype: audio.mimeType || 'audio/mpeg',
    ptt: audio.ptt !== false,
  });
  const info = contactInfo(jid);
  if (!info.audioLastSent) info.audioLastSent = {};
  info.audioLastSent[audio.id] = Date.now();
  info.updatedAt = new Date().toISOString();
  runtime.audiosSent += 1;
  await saveDatabase();
}

function unwrapMessage(content) {
  let current = content;
  for (let index = 0; index < 6 && current; index += 1) {
    if (current.ephemeralMessage?.message) current = current.ephemeralMessage.message;
    else if (current.viewOnceMessage?.message) current = current.viewOnceMessage.message;
    else if (current.viewOnceMessageV2?.message) current = current.viewOnceMessageV2.message;
    else if (current.viewOnceMessageV2Extension?.message) current = current.viewOnceMessageV2Extension.message;
    else if (current.documentWithCaptionMessage?.message) current = current.documentWithCaptionMessage.message;
    else break;
  }
  return current || {};
}

function extractText(messageContent) {
  const content = unwrapMessage(messageContent);
  return String(
    content.conversation ||
      content.extendedTextMessage?.text ||
      content.imageMessage?.caption ||
      content.videoMessage?.caption ||
      content.documentMessage?.caption ||
      content.buttonsResponseMessage?.selectedButtonId ||
      content.listResponseMessage?.singleSelectReply?.selectedRowId ||
      content.templateButtonReplyMessage?.selectedId ||
      '',
  );
}

function timestampToMs(value) {
  if (!value) return Date.now();
  if (typeof value === 'bigint') return Number(value) * 1000;
  if (typeof value === 'number') return value * 1000;
  if (typeof value.toNumber === 'function') return value.toNumber() * 1000;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric * 1000 : Date.now();
}

function getDisconnectCode(lastDisconnect) {
  const error = lastDisconnect?.error;
  return (
    error?.output?.statusCode ||
    error?.data?.statusCode ||
    error?.statusCode ||
    error?.cause?.output?.statusCode ||
    null
  );
}

async function resolveWaVersion() {
  if (WA_VERSION) {
    const parsed = WA_VERSION.split('.').map((item) => Number(item));
    if (parsed.length === 3 && parsed.every(Number.isFinite)) return parsed;
  }
  try {
    const result = await fetchLatestBaileysVersion();
    return result.version;
  } catch (error) {
    addEvent('warning', `No se pudo consultar la versión de WhatsApp: ${error.message}`);
    return null;
  }
}

function scheduleReconnect(delayMs = 5000) {
  if (shuttingDown || reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startSocket().catch((error) => addEvent('error', `Reconexión fallida: ${error.message}`));
  }, delayMs);
}

async function handleIncomingMessage(currentSocket, message) {
  try {
    const remoteJid = message.key?.remoteJid || '';
    if (!runtime.botEnabled || message.key?.fromMe) return;
    if (!remoteJid || remoteJid === 'status@broadcast') return;
    if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@broadcast') || remoteJid.endsWith('@newsletter')) return;

    const messageId = message.key?.id || '';
    if (!rememberMessage(messageId)) return;

    const messageAgeMs = Date.now() - timestampToMs(message.messageTimestamp);
    if (messageAgeMs > 5 * 60 * 1000) return;

    const text = extractText(message.message);
    runtime.messagesReceived += 1;
    const now = Date.now();
    const humanUntil = humanModeUntil.get(remoteJid) || 0;

    if (humanUntil > now) {
      addEvent('human', `Mensaje de ${maskPhone(remoteJid)}; atención humana activa.`);
      return;
    }

    const previousReply = lastReplyAt.get(remoteJid) || 0;
    if (now - previousReply < 1200) return;
    lastReplyAt.set(remoteJid, now);

    if (!text) {
      await currentSocket.sendMessage(remoteJid, {
        text: 'Por ahora puedo responder mensajes de texto. Escríbame su consulta.',
      });
      runtime.repliesSent += 1;
      return;
    }

    const mustWelcome = welcomeIsDue(remoteJid, text);
    if (mustWelcome) {
      await sendWelcomeSequence(currentSocket, remoteJid);
      if (isGreetingOrCatalog(text) || catalogRequested(text)) {
        addEvent('welcome', `Catálogo enviado a ${maskPhone(remoteJid)}.`);
        return;
      }
    }

    addHistory(remoteJid, 'user', text);
    const decision = await decideReply(text, remoteJid);

    if (decision.useHumanMode) {
      humanModeUntil.set(
        remoteJid,
        now + database.config.humanPauseMinutes * 60 * 1000,
      );
    }

    await currentSocket.sendMessage(remoteJid, { text: decision.text });
    addHistory(remoteJid, 'assistant', decision.text);
    runtime.repliesSent += 1;
    if (decision.kind === 'ai') runtime.aiReplies += 1;
    else runtime.ruleReplies += 1;

    const audio = findAudioForMessage(text, decision, remoteJid);
    if (audio) {
      await delay(700);
      try {
        await sendConfiguredAudio(currentSocket, remoteJid, audio);
        addEvent('audio', `Audio “${audio.title}” enviado a ${maskPhone(remoteJid)}.`);
      } catch (error) {
        addEvent('audio-error', `No se pudo enviar “${audio.title}”: ${error.message}`);
      }
    }

    addEvent('reply', `${decision.kind}: respuesta enviada a ${maskPhone(remoteJid)}.`);
  } catch (error) {
    addEvent('error', `Error procesando mensaje: ${error.message}`);
  }
}

async function startSocket() {
  if (startingSocket || shuttingDown) return;
  startingSocket = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const myGeneration = ++generation;

  try {
    setStatus('iniciando', 'Abriendo la conexión de WhatsApp...');
    runtime.qrDataUrl = null;
    await ensureStorage();

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const version = await resolveWaVersion();
    const currentSocket = makeWASocket({
      ...(version ? { version } : {}),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, waLogger),
      },
      logger: waLogger,
      browser: Browsers.ubuntu('JadrixServs Bot v4'),
      printQRInTerminal: false,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
    });

    socket = currentSocket;
    runtime.waVersion = version ? version.join('.') : 'predeterminada';
    currentSocket.ev.on('creds.update', saveCreds);

    currentSocket.ev.on('connection.update', async (update) => {
      if (myGeneration !== generation || shuttingDown) return;
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        runtime.qrDataUrl = await QRCode.toDataURL(qr, {
          width: 380,
          margin: 2,
          errorCorrectionLevel: 'M',
        });
        runtime.connectedNumber = null;
        setStatus('esperando_qr', 'Escanea el QR desde WhatsApp → Dispositivos vinculados.');
        addEvent('qr', 'Se generó un nuevo código QR.');
      } else if (connection === 'connecting') {
        setStatus('conectando', 'WhatsApp está verificando la sesión...');
      }

      if (connection === 'open') {
        runtime.qrDataUrl = null;
        runtime.connectedNumber = currentSocket.user?.id?.split(':')[0] || currentSocket.user?.id || null;
        setStatus('conectado', 'Bot conectado y listo para responder.');
        addEvent('ready', `Bot conectado${runtime.connectedNumber ? ` a ${maskPhone(runtime.connectedNumber)}` : ''}.`);
        setTimeout(() => checkBillingReminders('connection-open'), 5000);
      }

      if (connection === 'close') {
        const code = getDisconnectCode(lastDisconnect);
        const loggedOut = code === DisconnectReason.loggedOut;
        runtime.qrDataUrl = null;
        runtime.connectedNumber = null;
        socket = null;
        if (loggedOut) {
          setStatus('sesion_cerrada', 'La sesión fue cerrada. Preparando un QR nuevo...');
          await removeSession();
          scheduleReconnect(1500);
        } else {
          setStatus('reconectando', `Conexión cerrada${code ? ` (${code})` : ''}. Reconectando...`);
          scheduleReconnect(4000);
        }
      }
    });

    currentSocket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (myGeneration !== generation || type !== 'notify') return;
      for (const message of messages || []) {
        await handleIncomingMessage(currentSocket, message);
      }
    });
  } catch (error) {
    if (myGeneration === generation) {
      socket = null;
      setStatus('error', 'No se pudo iniciar WhatsApp.');
      addEvent('error', error.stack || error.message);
      scheduleReconnect(8000);
    }
  } finally {
    startingSocket = false;
  }
}

async function stopCurrentSocket(reason = 'Reinicio manual') {
  generation += 1;
  const oldSocket = socket;
  socket = null;
  if (oldSocket) {
    try { oldSocket.end(new Error(reason)); } catch (_) {}
  }
}

async function removeSession() {
  await fs.rm(SESSION_PATH, { recursive: true, force: true });
  await fs.mkdir(SESSION_PATH, { recursive: true });
  addEvent('session', 'Se borró la sesión local.');
}

function splitIntoChunks(text, title, documentId) {
  const cleaned = cleanString(text, 600000)
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
  const paragraphs = cleaned.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  const flush = () => {
    if (current.trim()) {
      chunks.push({
        id: crypto.randomUUID(),
        documentId,
        title,
        text: current.trim().slice(0, 2000),
      });
      current = '';
    }
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > 1900) {
      flush();
      for (let start = 0; start < paragraph.length; start += 1700) {
        chunks.push({
          id: crypto.randomUUID(),
          documentId,
          title,
          text: paragraph.slice(start, start + 1900),
        });
      }
    } else if ((current + '\n\n' + paragraph).length > 1900) {
      flush();
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  flush();
  return chunks.slice(0, 500);
}

function refreshCustomerStatuses() {
  const today = localDateParts(database.config.timezone).date;
  let changed = false;
  for (const customer of database.customers) {
    if (customer.status === 'paused') continue;
    const diff = daysBetween(today, customer.expiryDate);
    const next =
      diff === null ? customer.status :
      diff < 0 ? 'expired' :
      diff <= customer.reminderLeadDays ? 'expiring' : 'active';
    if (customer.status !== next) {
      customer.status = next;
      customer.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) saveDatabase();
}

function renderReminder(customer) {
  const payment = formatPaymentBlock(customer.paymentMethod, customer.pricePen);
  return renderTemplate(database.config.reminderTemplate, {
    cliente: customer.name || 'estimad@',
    producto: customer.productName || 'su servicio',
    vencimiento: formatDateEs(customer.expiryDate),
    precio: customer.paymentMethod === 'binance'
      ? `${calculateUsdt(customer.pricePen).toFixed(2)} USDT`
      : `S/${customer.pricePen.toFixed(2)}`,
    pago: payment,
  });
}

async function sendTextToPhone(phone, text) {
  if (!socket || runtime.status !== 'conectado') {
    throw new Error('WhatsApp no está conectado.');
  }
  const jid = phoneToJid(phone);
  if (!jid) throw new Error('El número de WhatsApp no es válido.');
  await socket.sendMessage(jid, { text });
  runtime.repliesSent += 1;
  return jid;
}

async function sendCustomerReminder(customer, source = 'manual') {
  const text = renderReminder(customer);
  await sendTextToPhone(customer.phone, text);
  customer.lastReminderKey = `${customer.expiryDate}:${customer.reminderLeadDays}`;
  customer.lastReminderAt = new Date().toISOString();
  customer.updatedAt = new Date().toISOString();
  runtime.remindersSent += 1;
  database.payments.unshift({
    id: crypto.randomUUID(),
    customerId: customer.id,
    type: 'reminder',
    source,
    amount: 0,
    method: customer.paymentMethod,
    date: new Date().toISOString(),
    note: `Recordatorio de vencimiento ${customer.expiryDate}`,
  });
  await saveDatabase();
  addEvent('reminder', `Recordatorio enviado a ${customer.name || maskPhone(customer.phone)}.`);
}

async function checkBillingReminders(source = 'scheduler') {
  if (billingCheckRunning) return { checked: 0, sent: 0 };
  billingCheckRunning = true;
  let checked = 0;
  let sent = 0;

  try {
    refreshCustomerStatuses();
    if (!database.config.billingAutomationEnabled) {
      return { checked: 0, sent: 0, disabled: true };
    }
    if (!socket || runtime.status !== 'conectado') {
      return { checked: 0, sent: 0, disconnected: true };
    }

    const now = localDateParts(database.config.timezone);
    if (now.hour < database.config.reminderHour) {
      return { checked: 0, sent: 0, beforeHour: true };
    }

    for (const customer of database.customers) {
      checked += 1;
      if (!customer.reminderEnabled || customer.status === 'paused') continue;
      const diff = daysBetween(now.date, customer.expiryDate);
      if (diff === null || diff < 0 || diff > customer.reminderLeadDays) continue;
      const key = `${customer.expiryDate}:${customer.reminderLeadDays}`;
      if (customer.lastReminderKey === key) continue;

      try {
        await sendCustomerReminder(customer, source);
        sent += 1;
        await delay(1200);
      } catch (error) {
        addEvent('reminder-error', `${customer.name}: ${error.message}`);
      }
    }
    return { checked, sent };
  } finally {
    billingCheckRunning = false;
  }
}

function renewCustomer(customer, paymentInput = {}) {
  const paymentDate =
    dateOnly(paymentInput.paymentDate) ||
    localDateParts(database.config.timezone).date;
  const currentExpiry = dateOnly(customer.expiryDate);
  const nextStart =
    currentExpiry && compareDates(currentExpiry, paymentDate) >= 0
      ? currentExpiry
      : paymentDate;
  const nextExpiry = addDuration(
    nextStart,
    customer.durationValue,
    customer.durationUnit,
  );

  database.payments.unshift({
    id: crypto.randomUUID(),
    customerId: customer.id,
    type: 'renewal',
    source: 'panel',
    amount: Math.max(0, Number(paymentInput.amount ?? customer.pricePen) || 0),
    method: paymentInput.method || customer.paymentMethod,
    date: new Date().toISOString(),
    paymentDate,
    previousExpiry: customer.expiryDate,
    periodStart: nextStart,
    newExpiry: nextExpiry,
    note: cleanString(paymentInput.note, 1000),
  });

  customer.activationDate = nextStart;
  customer.expiryDate = nextExpiry;
  customer.paymentMethod = paymentInput.method || customer.paymentMethod;
  customer.status = 'active';
  customer.lastReminderKey = '';
  customer.lastReminderAt = '';
  customer.updatedAt = new Date().toISOString();
  return { nextStart, nextExpiry };
}

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
  next();
});
app.use(express.json({ limit: '3mb' }));
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, version: 4, status: runtime.status, engine: runtime.engine });
});

app.post('/api/login', requireAdmin, (_req, res) => res.json({ ok: true }));

app.get('/api/status', requireAdmin, (_req, res) => {
  refreshCustomerStatuses();
  res.json({
    ok: true,
    runtime,
    events: recentEvents,
    aiKeyConfigured: Boolean(OPENAI_API_KEY),
    counts: {
      products: database.products.length,
      activeProducts: database.products.filter((p) => p.active).length,
      customers: database.customers.length,
      expiring: database.customers.filter((c) => c.status === 'expiring').length,
      expired: database.customers.filter((c) => c.status === 'expired').length,
      audios: database.audios.length,
    },
    persistenceWarning:
      'Render gratis usa almacenamiento temporal y puede suspender el servicio. Para clientes, audios y recordatorios confiables, usa un servicio de pago con disco persistente.',
  });
});

app.get('/api/config', requireAdmin, (_req, res) => {
  res.json({ ok: true, config: database.config, updatedAt: database.updatedAt });
});

app.put('/api/config', requireAdmin, async (req, res) => {
  database.config = sanitizeConfig(req.body || {});
  await saveDatabase();
  addEvent('config', 'Configuración actualizada desde el panel.');
  res.json({ ok: true, config: database.config });
});

app.get('/api/products', requireAdmin, (_req, res) => {
  res.json({ ok: true, products: database.products });
});

app.post('/api/products', requireAdmin, async (req, res) => {
  const product = sanitizeProduct(req.body);
  if (!product.name) return res.status(400).json({ ok: false, error: 'El producto necesita un nombre.' });
  database.products.unshift(product);
  await saveDatabase();
  res.json({ ok: true, product });
});

app.put('/api/products/:id', requireAdmin, async (req, res) => {
  const index = database.products.findIndex((p) => p.id === req.params.id);
  if (index < 0) return res.status(404).json({ ok: false, error: 'Producto no encontrado.' });
  database.products[index] = sanitizeProduct(req.body, database.products[index]);
  await saveDatabase();
  res.json({ ok: true, product: database.products[index] });
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  database.products = database.products.filter((p) => p.id !== req.params.id);
  await saveDatabase();
  res.json({ ok: true });
});

app.post('/api/products/bulk', requireAdmin, async (req, res) => {
  const lines = cleanString(req.body?.text, 150000).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let count = 0;
  for (const line of lines.slice(0, 500)) {
    const [name, price = '', status = 'activo', knowledge = '', tags = ''] = line.split('|').map((v) => v.trim());
    if (!name) continue;
    database.products.push(sanitizeProduct({
      name,
      pricePen: Number(price.replace(/[^\d.]/g, '')) || 0,
      active: !/inactiv|no disponible/i.test(status),
      knowledge,
      tags,
    }));
    count += 1;
  }
  await saveDatabase();
  res.json({ ok: true, count });
});

app.get('/api/faqs', requireAdmin, (_req, res) => {
  res.json({ ok: true, faqs: database.faqs });
});

app.post('/api/faqs', requireAdmin, async (req, res) => {
  const faq = sanitizeFaq(req.body);
  if (!faq.title || !faq.answer) {
    return res.status(400).json({ ok: false, error: 'Completa el título y la respuesta.' });
  }
  database.faqs.unshift(faq);
  await saveDatabase();
  res.json({ ok: true, faq });
});

app.put('/api/faqs/:id', requireAdmin, async (req, res) => {
  const index = database.faqs.findIndex((f) => f.id === req.params.id);
  if (index < 0) return res.status(404).json({ ok: false, error: 'Respuesta no encontrada.' });
  database.faqs[index] = sanitizeFaq(req.body, database.faqs[index]);
  await saveDatabase();
  res.json({ ok: true, faq: database.faqs[index] });
});

app.delete('/api/faqs/:id', requireAdmin, async (req, res) => {
  database.faqs = database.faqs.filter((f) => f.id !== req.params.id);
  await saveDatabase();
  res.json({ ok: true });
});

app.get('/api/documents', requireAdmin, (_req, res) => {
  res.json({ ok: true, documents: database.documents });
});

app.post('/api/knowledge/text', requireAdmin, async (req, res) => {
  const title = cleanString(req.body?.title, 200) || 'Información pegada';
  const text = cleanString(req.body?.text, 600000);
  if (text.length < 20) return res.status(400).json({ ok: false, error: 'Escribe más información.' });
  const documentId = crypto.randomUUID();
  const chunks = splitIntoChunks(text, title, documentId);
  const document = {
    id: documentId,
    title,
    type: 'texto',
    characters: text.length,
    chunks: chunks.length,
    createdAt: new Date().toISOString(),
  };
  database.documents.unshift(document);
  database.knowledgeChunks.push(...chunks);
  await saveDatabase();
  res.json({ ok: true, document });
});

app.post('/api/knowledge/pdf', requireAdmin, pdfUpload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'Selecciona un PDF.' });
  const title = cleanString(req.body?.title, 200) || cleanString(req.file.originalname, 200);
  let parser;
  try {
    parser = new PDFParse({ data: req.file.buffer });
    const result = await parser.getText();
    const text = cleanString(result.text, 600000);
    if (text.length < 30) {
      return res.status(400).json({
        ok: false,
        error: 'El PDF no contiene texto extraíble. Puede ser una imagen o un escaneo.',
      });
    }
    const documentId = crypto.randomUUID();
    const chunks = splitIntoChunks(text, title, documentId);
    const document = {
      id: documentId,
      title,
      originalName: cleanString(req.file.originalname, 255),
      type: 'pdf',
      characters: text.length,
      chunks: chunks.length,
      createdAt: new Date().toISOString(),
    };
    database.documents.unshift(document);
    database.knowledgeChunks.push(...chunks);
    await saveDatabase();
    addEvent('pdf', `PDF importado: ${title} (${chunks.length} fragmentos).`);
    res.json({ ok: true, document });
  } finally {
    if (parser) await parser.destroy().catch(() => {});
  }
});

app.delete('/api/documents/:id', requireAdmin, async (req, res) => {
  database.documents = database.documents.filter((d) => d.id !== req.params.id);
  database.knowledgeChunks = database.knowledgeChunks.filter((c) => c.documentId !== req.params.id);
  await saveDatabase();
  res.json({ ok: true });
});

app.get('/api/audios', requireAdmin, (_req, res) => {
  res.json({ ok: true, audios: database.audios });
});

app.post('/api/audios', requireAdmin, audioUpload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'Selecciona un audio.' });
  const audio = sanitizeAudio({
    title: req.body?.title || req.file.originalname,
    filename: req.file.filename,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    triggers: req.body?.triggers || 'dicloak, cómo funciona, como funciona, acceso',
    productSeedKeys: cleanString(req.body?.productSeedKeys, 3000)
      .split(/[,\n;]/)
      .map((item) => cleanString(item, 100))
      .filter(Boolean),
    active: req.body?.active !== 'false',
    ptt: req.body?.ptt !== 'false',
  });
  database.audios.unshift(audio);
  await saveDatabase();
  res.json({ ok: true, audio });
});

app.put('/api/audios/:id', requireAdmin, async (req, res) => {
  const index = database.audios.findIndex((a) => a.id === req.params.id);
  if (index < 0) return res.status(404).json({ ok: false, error: 'Audio no encontrado.' });
  database.audios[index] = sanitizeAudio(req.body, database.audios[index]);
  await saveDatabase();
  res.json({ ok: true, audio: database.audios[index] });
});

app.delete('/api/audios/:id', requireAdmin, async (req, res) => {
  const audio = database.audios.find((a) => a.id === req.params.id);
  database.audios = database.audios.filter((a) => a.id !== req.params.id);
  if (audio?.filename) {
    await fs.rm(path.join(AUDIO_DIR, path.basename(audio.filename)), { force: true }).catch(() => {});
  }
  await saveDatabase();
  res.json({ ok: true });
});

app.post('/api/audios/:id/test', requireAdmin, async (req, res) => {
  const audio = database.audios.find((a) => a.id === req.params.id);
  if (!audio) return res.status(404).json({ ok: false, error: 'Audio no encontrado.' });
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return res.status(400).json({ ok: false, error: 'Escribe un número de WhatsApp.' });
  await sendConfiguredAudio(socket, phoneToJid(phone), audio);
  res.json({ ok: true });
});

app.get('/api/customers', requireAdmin, (_req, res) => {
  refreshCustomerStatuses();
  res.json({ ok: true, customers: database.customers, payments: database.payments.slice(0, 200) });
});

app.post('/api/customers', requireAdmin, async (req, res) => {
  const customer = sanitizeCustomer(req.body);
  if (!customer.name || !customer.phone || !customer.productName) {
    return res.status(400).json({ ok: false, error: 'Completa nombre, WhatsApp y producto.' });
  }
  database.customers.unshift(customer);
  database.payments.unshift({
    id: crypto.randomUUID(),
    customerId: customer.id,
    type: 'purchase',
    source: 'panel',
    amount: customer.pricePen,
    method: customer.paymentMethod,
    date: new Date().toISOString(),
    paymentDate: customer.activationDate,
    periodStart: customer.activationDate,
    newExpiry: customer.expiryDate,
    note: 'Compra registrada',
  });
  await saveDatabase();
  res.json({ ok: true, customer });
});

app.put('/api/customers/:id', requireAdmin, async (req, res) => {
  const index = database.customers.findIndex((c) => c.id === req.params.id);
  if (index < 0) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });
  database.customers[index] = sanitizeCustomer(req.body, database.customers[index]);
  await saveDatabase();
  res.json({ ok: true, customer: database.customers[index] });
});

app.delete('/api/customers/:id', requireAdmin, async (req, res) => {
  database.customers = database.customers.filter((c) => c.id !== req.params.id);
  await saveDatabase();
  res.json({ ok: true });
});

app.post('/api/customers/:id/reminder', requireAdmin, async (req, res) => {
  const customer = database.customers.find((c) => c.id === req.params.id);
  if (!customer) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });
  await sendCustomerReminder(customer, 'manual');
  res.json({ ok: true });
});

app.post('/api/customers/:id/renew', requireAdmin, async (req, res) => {
  const customer = database.customers.find((c) => c.id === req.params.id);
  if (!customer) return res.status(404).json({ ok: false, error: 'Cliente no encontrado.' });
  const result = renewCustomer(customer, req.body || {});
  await saveDatabase();
  res.json({ ok: true, customer, ...result });
});

app.post('/api/billing/check', requireAdmin, async (_req, res) => {
  const result = await checkBillingReminders('manual-check');
  res.json({ ok: true, ...result });
});

app.post('/api/quote', requireAdmin, (req, res) => {
  const pricePen = Math.max(0, Number(req.body?.pricePen) || 0);
  res.json({
    ok: true,
    pricePen,
    rate: database.config.penToUsdRate,
    surchargePct: database.config.internationalSurchargePct,
    usdt: calculateUsdt(pricePen),
  });
});

app.post('/api/test', requireAdmin, async (req, res) => {
  const message = cleanString(req.body?.message, 6000);
  if (!message) return res.status(400).json({ ok: false, error: 'Escribe un mensaje de prueba.' });
  addHistory('panel-test', 'user', message);
  const decision = await decideReply(message, 'panel-test');
  addHistory('panel-test', 'assistant', decision.text);
  res.json({
    ok: true,
    answer: decision.text,
    kind: decision.kind,
    product: decision.product?.name || null,
  });
});

app.get('/api/export', requireAdmin, (_req, res) => {
  res.set('Content-Disposition', `attachment; filename="jadrixservs-bot-v4-${new Date().toISOString().slice(0, 10)}.json"`);
  res.type('application/json').send(JSON.stringify(database, null, 2));
});

app.post('/api/import', requireAdmin, async (req, res) => {
  const imported = req.body?.database;
  if (!imported || typeof imported !== 'object') {
    return res.status(400).json({ ok: false, error: 'El respaldo no es válido.' });
  }
  database = {
    version: 4,
    config: { ...DEFAULT_CONFIG, ...(imported.config || {}) },
    products: Array.isArray(imported.products) ? imported.products : [],
    faqs: Array.isArray(imported.faqs) ? imported.faqs : [],
    documents: Array.isArray(imported.documents) ? imported.documents : [],
    knowledgeChunks: Array.isArray(imported.knowledgeChunks) ? imported.knowledgeChunks : [],
    audios: Array.isArray(imported.audios) ? imported.audios : [],
    customers: Array.isArray(imported.customers) ? imported.customers : [],
    payments: Array.isArray(imported.payments) ? imported.payments : [],
    contactState:
      imported.contactState && typeof imported.contactState === 'object'
        ? imported.contactState
        : {},
    updatedAt: new Date().toISOString(),
  };
  database.config = sanitizeConfig(database.config);
  mergeSeeds();
  database.products = database.products.map((p) => sanitizeProduct(p, p));
  database.faqs = database.faqs.map((f) => sanitizeFaq(f, f));
  database.audios = database.audios.map((a) => sanitizeAudio(a, a));
  database.customers = database.customers.map((c) => sanitizeCustomer(c, c));
  await saveDatabase();
  res.json({ ok: true });
});

app.post('/api/toggle', requireAdmin, (req, res) => {
  runtime.botEnabled = Boolean(req.body?.enabled);
  addEvent('bot', `Respuestas ${runtime.botEnabled ? 'activadas' : 'pausadas'}.`);
  res.json({ ok: true, enabled: runtime.botEnabled });
});

app.post('/api/restart', requireAdmin, (_req, res) => {
  res.json({ ok: true });
  setImmediate(async () => {
    await stopCurrentSocket();
    setStatus('reiniciando', 'Reabriendo la conexión...');
    await startSocket();
  });
});

app.post('/api/logout', requireAdmin, (_req, res) => {
  res.json({ ok: true });
  setImmediate(async () => {
    generation += 1;
    const oldSocket = socket;
    socket = null;
    if (oldSocket) {
      try { await oldSocket.logout(); } catch (_) {
        try { oldSocket.end(new Error('Cerrar sesión')); } catch (_) {}
      }
    }
    await removeSession();
    setStatus('reiniciando', 'Preparando un QR nuevo...');
    await startSocket();
  });
});

app.use((error, _req, res, _next) => {
  addEvent('error', error.message || 'Error interno');
  res.status(error instanceof multer.MulterError ? 400 : 500).json({
    ok: false,
    error: error.message || 'Error interno.',
  });
});

await loadDatabase();

app.listen(PORT, '0.0.0.0', () => {
  addEvent('server', `Panel JadrixServs v4 iniciado en el puerto ${PORT}.`);
  startSocket().catch((error) => addEvent('error', error.message));
  setTimeout(() => checkBillingReminders('startup'), 20000);
  setInterval(() => checkBillingReminders('scheduler'), 10 * 60 * 1000);
});

async function shutdown(signal) {
  shuttingDown = true;
  clearTimeout(reconnectTimer);
  await saveDatabase();
  await stopCurrentSocket(`Apagado por ${signal}`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => addEvent('error', `Promesa no controlada: ${String(reason)}`));
process.on('uncaughtException', (error) => addEvent('error', error.stack || error.message));
