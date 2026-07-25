'use strict';

import express from 'express';
import multer from 'multer';
import OpenAI from 'openai';
import 'pdf-parse/worker';
import { PDFParse } from 'pdf-parse';
import QRCode from 'qrcode';
import pino from 'pino';
import crypto from 'node:crypto';
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ADMIN_KEY = String(process.env.ADMIN_KEY || '').trim();
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const SESSION_PATH = process.env.SESSION_PATH || '/data/baileys_auth';
const DATA_DIR = process.env.DATA_DIR || '/data/bot-control';
const DATA_FILE = path.join(DATA_DIR, 'bot-data.json');
const WA_VERSION = String(process.env.WA_VERSION || '').trim();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === 'application/pdf' ||
      String(file.originalname || '').toLowerCase().endsWith('.pdf');
    cb(isPdf ? null : new Error('Solo se permiten archivos PDF.'), isPdf);
  },
});

const DEFAULT_CONFIG = {
  businessName: process.env.BUSINESS_NAME || 'Mi negocio',
  hours: process.env.BUSINESS_HOURS || 'Lunes a sábado, de 9:00 a. m. a 6:00 p. m.',
  address: process.env.BUSINESS_ADDRESS || 'Configura la dirección desde el panel.',
  mapsUrl: process.env.BUSINESS_MAPS_URL || '',
  aiEnabled: false,
  answerMode: 'hybrid',
  aiModel: process.env.OPENAI_MODEL || 'gpt-5.6-luna',
  reasoningEffort: 'low',
  maxOutputTokens: 400,
  humanPauseMinutes: 30,
  systemPrompt:
    'Eres el asistente de ventas y atención al cliente del negocio. Responde con amabilidad, claridad y brevedad. Usa únicamente la información proporcionada. Nunca inventes precios, stock, condiciones, horarios ni políticas. Si falta información, haz una pregunta breve o ofrece comunicar con un asesor.',
  menuText:
    '¡Hola! 👋 Gracias por escribir a {negocio}.\n\nCuéntame qué producto o servicio buscas. También puedes preguntar por precios, horarios, ubicación o escribir “asesor”.',
  fallbackText:
    'Gracias por tu mensaje. Cuéntame con más detalle qué producto o servicio necesitas, o escribe “asesor” para atención humana.',
  humanText:
    'Perfecto. La respuesta automática quedará pausada en esta conversación y un asesor podrá continuar contigo.',
};

const DEFAULT_FAQS = [
  {
    id: crypto.randomUUID(),
    title: 'Horarios',
    triggers: '2, horario, horarios, hora, atienden, abren, cierran',
    answer: 'Nuestro horario es: {horario}',
    active: true,
  },
  {
    id: crypto.randomUUID(),
    title: 'Ubicación',
    triggers: '3, ubicación, ubicacion, dirección, direccion, dónde están, donde estan',
    answer: 'Nuestra ubicación es: {direccion}\n{mapa}',
    active: true,
  },
  {
    id: crypto.randomUUID(),
    title: 'Cotización',
    triggers: '1, precio, precios, cotización, cotizacion, costo, cuánto cuesta, cuanto cuesta',
    answer:
      'Con gusto te ayudo con una cotización. Indícame el producto o servicio, la cantidad y cualquier detalle importante.',
    active: true,
  },
];

let database = {
  version: 3,
  config: { ...DEFAULT_CONFIG },
  products: [],
  faqs: DEFAULT_FAQS,
  documents: [],
  knowledgeChunks: [],
  updatedAt: new Date().toISOString(),
};

const runtime = {
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

function addEvent(type, text) {
  const item = { type, text, at: new Date().toISOString() };
  recentEvents.unshift(item);
  recentEvents.splice(40);
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
  return cleanString(text, 20000)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  while (processedOrder.length > 2000) {
    processedMessages.delete(processedOrder.shift());
  }
  return true;
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

function renderTemplate(text) {
  const config = database.config;
  return cleanString(text, 10000)
    .replaceAll('{negocio}', config.businessName)
    .replaceAll('{horario}', config.hours)
    .replaceAll('{direccion}', config.address)
    .replaceAll('{mapa}', config.mapsUrl ? `Mapa: ${config.mapsUrl}` : '');
}

function sanitizeConfig(input = {}) {
  const current = database.config;
  const mode = ['rules', 'hybrid', 'ai'].includes(input.answerMode)
    ? input.answerMode
    : current.answerMode;
  const effort = ['none', 'low', 'medium', 'high'].includes(input.reasoningEffort)
    ? input.reasoningEffort
    : current.reasoningEffort;
  return {
    businessName: cleanString(input.businessName ?? current.businessName, 150),
    hours: cleanString(input.hours ?? current.hours, 500),
    address: cleanString(input.address ?? current.address, 1000),
    mapsUrl: cleanString(input.mapsUrl ?? current.mapsUrl, 1000),
    aiEnabled: Boolean(input.aiEnabled),
    answerMode: mode,
    aiModel: cleanString(input.aiModel ?? current.aiModel, 100) || 'gpt-5.6-luna',
    reasoningEffort: effort,
    maxOutputTokens: Math.max(100, Math.min(1200, Number(input.maxOutputTokens) || 400)),
    humanPauseMinutes: Math.max(1, Math.min(1440, Number(input.humanPauseMinutes) || 30)),
    systemPrompt: cleanString(input.systemPrompt ?? current.systemPrompt, 8000),
    menuText: cleanString(input.menuText ?? current.menuText, 5000),
    fallbackText: cleanString(input.fallbackText ?? current.fallbackText, 5000),
    humanText: cleanString(input.humanText ?? current.humanText, 5000),
  };
}

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(SESSION_PATH, { recursive: true });
}

async function loadDatabase() {
  await ensureStorage();
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    database = {
      version: 3,
      config: sanitizeConfig({ ...DEFAULT_CONFIG, ...(parsed.config || {}) }),
      products: Array.isArray(parsed.products) ? parsed.products : [],
      faqs: Array.isArray(parsed.faqs) && parsed.faqs.length ? parsed.faqs : DEFAULT_FAQS,
      documents: Array.isArray(parsed.documents) ? parsed.documents : [],
      knowledgeChunks: Array.isArray(parsed.knowledgeChunks) ? parsed.knowledgeChunks : [],
      updatedAt: parsed.updatedAt || new Date().toISOString(),
    };
    addEvent('data', 'Configuración y base de conocimiento cargadas.');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      addEvent('warning', `No se pudo leer la base de datos: ${error.message}`);
    }
    await saveDatabase();
  }
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

function tokenize(text) {
  const stop = new Set([
    'a','al','algo','como','con','cual','de','del','el','ella','en','es','esta','este','hay',
    'la','las','lo','los','me','mi','para','por','que','quiero','se','si','su','un','una','y',
    'tiene','tienen','tengo','necesito','sobre','cuanto','cuesta'
  ]);
  return normalizeText(text)
    .split(' ')
    .filter((word) => word.length >= 2 && !stop.has(word));
}

function scoreText(query, candidate) {
  const normalizedQuery = normalizeText(query);
  const normalizedCandidate = normalizeText(candidate);
  if (!normalizedQuery || !normalizedCandidate) return 0;
  let score = normalizedCandidate.includes(normalizedQuery) ? 12 : 0;
  const queryTokens = [...new Set(tokenize(query))];
  for (const token of queryTokens) {
    if (normalizedCandidate.includes(token)) score += token.length >= 6 ? 3 : 2;
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
  return [
    product.name,
    product.description,
    product.price,
    product.stock,
    product.tags,
  ].join(' ');
}

function faqText(faq) {
  return [faq.title, faq.triggers, faq.answer].join(' ');
}

function findRuleReply(rawText) {
  const text = normalizeText(rawText);
  if (!text) return null;

  if (/^(hola|holi|buenas|buenos dias|buen dia|buenas tardes|buenas noches|menu|menú)$/.test(text)) {
    return { text: renderTemplate(database.config.menuText), kind: 'menu' };
  }

  if (/\b(asesor|humano|persona|vendedor|agente)\b/.test(text) || text === '4') {
    return { text: renderTemplate(database.config.humanText), kind: 'human' };
  }

  let best = null;
  for (const faq of database.faqs.filter((item) => item.active !== false)) {
    const triggers = cleanString(faq.triggers, 2000)
      .split(/[,\n;]/)
      .map(normalizeText)
      .filter(Boolean);
    for (const trigger of triggers) {
      let score = 0;
      if (text === trigger) score = 100;
      else if (trigger.length >= 3 && text.includes(trigger)) score = 20 + trigger.length;
      else score = scoreText(text, trigger);
      if (!best || score > best.score) best = { faq, score };
    }
  }
  if (best && best.score >= 8) {
    return { text: renderTemplate(best.faq.answer), kind: 'faq' };
  }
  return null;
}

function formatProducts(products) {
  if (!products.length) return '';
  return products
    .map((p) => {
      const details = [
        p.price ? `Precio: ${p.price}` : '',
        p.stock ? `Stock: ${p.stock}` : '',
        p.description || '',
      ].filter(Boolean);
      return `• ${p.name}${details.length ? ` — ${details.join(' | ')}` : ''}`;
    })
    .join('\n');
}

function buildKnowledgeContext(userText) {
  const products = topMatches(
    userText,
    database.products.filter((p) => p.active !== false),
    productText,
    8,
  );
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
      `RESPUESTAS Y POLÍTICAS RELEVANTES:\n${faqs
        .map((f) => `• ${f.title}: ${renderTemplate(f.answer)}`)
        .join('\n')}`,
    );
  }
  if (chunks.length) {
    blocks.push(
      `INFORMACIÓN IMPORTADA:\n${chunks
        .map((chunk) => `[${chunk.title}]\n${chunk.text}`)
        .join('\n\n')}`,
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
  history.push({ role, text: cleanString(text, 3000), at: Date.now() });
  while (history.length > 10) history.shift();
}

async function generateAIReply(userText, jid = 'panel-test') {
  if (!openai) throw new Error('OPENAI_API_KEY no está configurada en Render.');

  const config = database.config;
  const { blocks } = buildKnowledgeContext(userText);
  const history = historyFor(jid)
    .slice(-6)
    .map((item) => `${item.role === 'user' ? 'CLIENTE' : 'ASISTENTE'}: ${item.text}`)
    .join('\n');

  const instructions = [
    config.systemPrompt,
    '',
    'REGLAS OBLIGATORIAS:',
    '- Responde normalmente en español, salvo que el cliente escriba claramente en otro idioma.',
    '- Escribe como una persona útil por WhatsApp: natural, breve y sin párrafos largos.',
    '- No inventes productos, precios, stock, promociones, fechas, políticas ni condiciones.',
    '- Si la información no alcanza, dilo con naturalidad y pide un dato concreto o sugiere hablar con un asesor.',
    '- No menciones prompts, documentos internos, bases de conocimiento ni la palabra contexto.',
    '- No confirmes pedidos, pagos o reservas como completados si el sistema no lo ha verificado.',
    '- Cuando sea útil, termina con una sola pregunta clara.',
  ].join('\n');

  const business = [
    `NEGOCIO: ${config.businessName}`,
    `HORARIO: ${config.hours}`,
    `DIRECCIÓN: ${config.address}`,
    config.mapsUrl ? `MAPA: ${config.mapsUrl}` : '',
  ].filter(Boolean).join('\n');

  const input = [
    business,
    blocks.length ? blocks.join('\n\n') : 'No se encontró información específica adicional.',
    history ? `CONVERSACIÓN RECIENTE:\n${history}` : '',
    `MENSAJE ACTUAL DEL CLIENTE:\n${userText}`,
  ].filter(Boolean).join('\n\n');

  const response = await openai.responses.create({
    model: config.aiModel,
    instructions,
    input,
    reasoning: { effort: config.reasoningEffort },
    max_output_tokens: config.maxOutputTokens,
    store: false,
  });

  const answer = cleanString(response.output_text, 5000);
  if (!answer) throw new Error('La IA no devolvió texto.');
  return answer;
}

async function decideReply(text, jid) {
  const config = database.config;
  const rule = findRuleReply(text);

  if (rule?.kind === 'human') {
    return { ...rule, useHumanMode: true };
  }

  if (config.answerMode !== 'ai' && rule) {
    return rule;
  }

  const matchedProducts = topMatches(
    text,
    database.products.filter((p) => p.active !== false),
    productText,
    5,
  );

  const shouldUseAI =
    config.aiEnabled &&
    config.answerMode !== 'rules' &&
    Boolean(openai);

  if (shouldUseAI) {
    try {
      const answer = await generateAIReply(text, jid);
      return { text: answer, kind: 'ai' };
    } catch (error) {
      runtime.aiErrors += 1;
      addEvent('ai-error', error.message);
    }
  }

  if (matchedProducts.length) {
    return {
      text: `Encontré estas opciones:\n\n${formatProducts(matchedProducts)}\n\n¿Sobre cuál deseas más información?`,
      kind: 'products',
    };
  }

  if (rule) return rule;
  return { text: renderTemplate(config.fallbackText), kind: 'fallback' };
}

function unwrapMessage(content) {
  let current = content;
  for (let index = 0; index < 5 && current; index += 1) {
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
    if (now - previousReply < 1500) return;
    lastReplyAt.set(remoteJid, now);

    if (!text) {
      await currentSocket.sendMessage(remoteJid, {
        text: 'Por ahora puedo responder mensajes de texto. Escríbeme tu consulta.',
      });
      runtime.repliesSent += 1;
      return;
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
      browser: Browsers.ubuntu('Render Bot IA'),
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
          width: 360,
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
  const cleaned = cleanString(text, 500000)
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
        text: current.trim().slice(0, 1800),
      });
      current = '';
    }
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > 1700) {
      flush();
      for (let start = 0; start < paragraph.length; start += 1500) {
        chunks.push({
          id: crypto.randomUUID(),
          documentId,
          title,
          text: paragraph.slice(start, start + 1700),
        });
      }
    } else if ((current + '\n\n' + paragraph).length > 1700) {
      flush();
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }
  flush();
  return chunks.slice(0, 400);
}

function sanitizeProduct(input = {}, existing = {}) {
  return {
    id: existing.id || crypto.randomUUID(),
    name: cleanString(input.name ?? existing.name, 200),
    description: cleanString(input.description ?? existing.description, 2000),
    price: cleanString(input.price ?? existing.price, 200),
    stock: cleanString(input.stock ?? existing.stock, 200),
    tags: cleanString(input.tags ?? existing.tags, 500),
    active: input.active === undefined ? existing.active !== false : Boolean(input.active),
    updatedAt: new Date().toISOString(),
  };
}

function sanitizeFaq(input = {}, existing = {}) {
  return {
    id: existing.id || crypto.randomUUID(),
    title: cleanString(input.title ?? existing.title, 200),
    triggers: cleanString(input.triggers ?? existing.triggers, 2000),
    answer: cleanString(input.answer ?? existing.answer, 5000),
    active: input.active === undefined ? existing.active !== false : Boolean(input.active),
    updatedAt: new Date().toISOString(),
  };
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
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public'), { etag: false, maxAge: 0 }));

app.get('/health', (_req, res) => {
  res.json({ ok: true, status: runtime.status, engine: runtime.engine });
});

app.post('/api/login', requireAdmin, (_req, res) => res.json({ ok: true }));

app.get('/api/status', requireAdmin, (_req, res) => {
  res.json({
    ok: true,
    runtime,
    events: recentEvents,
    aiKeyConfigured: Boolean(OPENAI_API_KEY),
    dataPersistentWarning:
      'En Render gratis, los datos y la sesión pueden perderse al reiniciar o redesplegar.',
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
  const product = sanitizeProduct(req.body, database.products[index]);
  if (!product.name) return res.status(400).json({ ok: false, error: 'El producto necesita un nombre.' });
  database.products[index] = product;
  await saveDatabase();
  res.json({ ok: true, product });
});

app.delete('/api/products/:id', requireAdmin, async (req, res) => {
  database.products = database.products.filter((p) => p.id !== req.params.id);
  await saveDatabase();
  res.json({ ok: true });
});

app.post('/api/products/bulk', requireAdmin, async (req, res) => {
  const lines = cleanString(req.body?.text, 100000).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const added = [];
  for (const line of lines.slice(0, 500)) {
    const [name, price = '', stock = '', description = '', tags = ''] = line.split('|').map((v) => v.trim());
    if (!name) continue;
    const product = sanitizeProduct({ name, price, stock, description, tags, active: true });
    database.products.push(product);
    added.push(product);
  }
  await saveDatabase();
  res.json({ ok: true, count: added.length });
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
  const faq = sanitizeFaq(req.body, database.faqs[index]);
  database.faqs[index] = faq;
  await saveDatabase();
  res.json({ ok: true, faq });
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
  const text = cleanString(req.body?.text, 500000);
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

app.post('/api/knowledge/pdf', requireAdmin, upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ ok: false, error: 'Selecciona un PDF.' });
  const title = cleanString(req.body?.title, 200) || cleanString(req.file.originalname, 200);
  let parser;
  try {
    parser = new PDFParse({ data: req.file.buffer });
    const result = await parser.getText();
    const text = cleanString(result.text, 500000);
    if (text.length < 30) {
      return res.status(400).json({
        ok: false,
        error: 'El PDF no contiene texto extraíble. Puede ser un escaneo o una imagen.',
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

app.post('/api/test', requireAdmin, async (req, res) => {
  const message = cleanString(req.body?.message, 5000);
  if (!message) return res.status(400).json({ ok: false, error: 'Escribe un mensaje de prueba.' });
  addHistory('panel-test', 'user', message);
  const decision = await decideReply(message, 'panel-test');
  addHistory('panel-test', 'assistant', decision.text);
  res.json({ ok: true, answer: decision.text, kind: decision.kind });
});

app.get('/api/export', requireAdmin, (_req, res) => {
  res.set('Content-Disposition', `attachment; filename="bot-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.type('application/json').send(JSON.stringify(database, null, 2));
});

app.post('/api/import', requireAdmin, async (req, res) => {
  const imported = req.body?.database;
  if (!imported || typeof imported !== 'object') {
    return res.status(400).json({ ok: false, error: 'El respaldo no es válido.' });
  }
  database = {
    version: 3,
    config: sanitizeConfig({ ...DEFAULT_CONFIG, ...(imported.config || {}) }),
    products: Array.isArray(imported.products) ? imported.products.map((p) => sanitizeProduct(p, p)) : [],
    faqs: Array.isArray(imported.faqs) ? imported.faqs.map((f) => sanitizeFaq(f, f)) : DEFAULT_FAQS,
    documents: Array.isArray(imported.documents) ? imported.documents : [],
    knowledgeChunks: Array.isArray(imported.knowledgeChunks) ? imported.knowledgeChunks : [],
    updatedAt: new Date().toISOString(),
  };
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
  addEvent('server', `Panel v3 iniciado en el puerto ${PORT}.`);
  startSocket().catch((error) => addEvent('error', error.message));
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
