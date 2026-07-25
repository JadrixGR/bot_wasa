'use strict';

import express from 'express';
import QRCode from 'qrcode';
import pino from 'pino';
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
const SESSION_PATH = process.env.SESSION_PATH || '/data/baileys_auth';
const WA_VERSION = String(process.env.WA_VERSION || '').trim();

const settings = {
  businessName: process.env.BUSINESS_NAME || 'Mi negocio',
  hours: process.env.BUSINESS_HOURS || 'Lunes a sábado, de 9:00 a. m. a 6:00 p. m.',
  address: process.env.BUSINESS_ADDRESS || 'Configura BUSINESS_ADDRESS en Render.',
  mapsUrl: process.env.BUSINESS_MAPS_URL || '',
  priceText:
    process.env.PRICE_TEXT ||
    'Cuéntame qué producto o servicio necesitas, la cantidad y cualquier detalle importante para cotizarte.',
  humanText:
    process.env.HUMAN_TEXT ||
    'Perfecto. Dejaré esta conversación en modo atención humana durante 30 minutos. Un asesor continuará contigo.',
};

const runtime = {
  engine: 'Baileys',
  status: 'iniciando',
  detail: 'Preparando la conexión...',
  qrDataUrl: null,
  connectedNumber: null,
  botEnabled: true,
  startedAt: new Date().toISOString(),
  lastEventAt: new Date().toISOString(),
  messagesReceived: 0,
  repliesSent: 0,
  waVersion: null,
};

const recentEvents = [];
const processedMessages = new Set();
const processedOrder = [];
const humanModeUntil = new Map();
const lastReplyAt = new Map();
const waLogger = pino({ level: process.env.WA_LOG_LEVEL || 'silent' });

let socket = null;
let startingSocket = false;
let reconnectTimer = null;
let generation = 0;
let shuttingDown = false;

function addEvent(type, text) {
  const item = { type, text, at: new Date().toISOString() };
  recentEvents.unshift(item);
  recentEvents.splice(30);
  runtime.lastEventAt = item.at;
  console.log(`[${item.at}] [${type}] ${text}`);
}

function setStatus(status, detail) {
  runtime.status = status;
  runtime.detail = detail;
  runtime.lastEventAt = new Date().toISOString();
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

function normalizeText(text) {
  return String(text || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function buildReply(rawText) {
  const text = normalizeText(rawText);

  if (/^(hola|holi|buenas|buenos dias|buen dia|buenas tardes|buenas noches|menu)$/.test(text)) {
    return (
      `¡Hola! 👋 Gracias por escribir a ${settings.businessName}.\n\n` +
      'Puedo ayudarte con:\n' +
      '1. Precios o cotización\n' +
      '2. Horarios\n' +
      '3. Ubicación\n' +
      '4. Hablar con un asesor\n\n' +
      'Escribe el número de una opción o cuéntame qué necesitas.'
    );
  }

  if (text === '1' || /\b(precio|precios|cotizacion|cotizar|costo|costos|cuanto cuesta)\b/.test(text)) {
    return settings.priceText;
  }

  if (text === '2' || /\b(horario|horarios|hora|atienden|abren|cierran)\b/.test(text)) {
    return `Nuestro horario es: ${settings.hours}`;
  }

  if (text === '3' || /\b(ubicacion|direccion|donde estan|como llego)\b/.test(text)) {
    const map = settings.mapsUrl ? `\nMapa: ${settings.mapsUrl}` : '';
    return `Nuestra ubicación es: ${settings.address}${map}`;
  }

  if (text === '4' || /\b(asesor|humano|persona|vendedor|agente)\b/.test(text)) {
    return settings.humanText;
  }

  if (/^(gracias|muchas gracias|ok|listo|perfecto)$/.test(text)) {
    return '¡Con gusto! 😊 Cuando necesites algo más, escribe “menú”.';
  }

  return (
    'Gracias por tu mensaje. Para ayudarte más rápido, escribe:\n' +
    '1 para precios\n' +
    '2 para horarios\n' +
    '3 para ubicación\n' +
    '4 para hablar con un asesor'
  );
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
    if (parsed.length === 3 && parsed.every(Number.isFinite)) {
      addEvent('version', `Usando versión configurada de WhatsApp: ${parsed.join('.')}.`);
      return parsed;
    }
    addEvent('warning', 'WA_VERSION no tiene el formato correcto; se usará la versión automática.');
  }

  try {
    const result = await fetchLatestBaileysVersion();
    addEvent('version', `Versión de WhatsApp detectada: ${result.version.join('.')}.`);
    return result.version;
  } catch (error) {
    addEvent('warning', `No se pudo consultar la versión más reciente: ${error.message}. Se usará la predeterminada.`);
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
      addEvent('human', `Mensaje recibido de ${maskPhone(remoteJid)}; atención humana activa.`);
      return;
    }

    const previousReply = lastReplyAt.get(remoteJid) || 0;
    if (now - previousReply < 1500) return;
    lastReplyAt.set(remoteJid, now);

    if (!text) {
      await currentSocket.sendMessage(remoteJid, {
        text: 'Por ahora puedo responder mensajes de texto. Escríbeme tu consulta o “menú”.',
      });
      runtime.repliesSent += 1;
      addEvent('reply', `Se pidió texto a ${maskPhone(remoteJid)}.`);
      return;
    }

    const normalized = normalizeText(text);
    if (normalized === '4' || /\b(asesor|humano|persona|vendedor|agente)\b/.test(normalized)) {
      humanModeUntil.set(remoteJid, now + 30 * 60 * 1000);
    }

    await currentSocket.sendMessage(remoteJid, { text: buildReply(text) });
    runtime.repliesSent += 1;
    addEvent('reply', `Respuesta automática enviada a ${maskPhone(remoteJid)}.`);
  } catch (error) {
    addEvent('error', `Error procesando un mensaje: ${error.message}`);
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

    await fs.mkdir(SESSION_PATH, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_PATH);
    const version = await resolveWaVersion();

    const currentSocket = makeWASocket({
      ...(version ? { version } : {}),
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, waLogger),
      },
      logger: waLogger,
      browser: Browsers.ubuntu('Render Bot'),
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
        try {
          runtime.qrDataUrl = await QRCode.toDataURL(qr, {
            width: 360,
            margin: 2,
            errorCorrectionLevel: 'M',
          });
          runtime.connectedNumber = null;
          setStatus('esperando_qr', 'Escanea el QR desde WhatsApp → Dispositivos vinculados.');
          addEvent('qr', 'Se generó un nuevo código QR.');
        } catch (error) {
          setStatus('error', 'No se pudo convertir el QR en imagen.');
          addEvent('error', `Error creando QR: ${error.message}`);
        }
      } else if (connection === 'connecting') {
        setStatus('conectando', 'WhatsApp está verificando y sincronizando la sesión...');
      }

      if (connection === 'open') {
        runtime.qrDataUrl = null;
        runtime.connectedNumber = currentSocket.user?.id?.split(':')[0] || currentSocket.user?.id || null;
        setStatus('conectado', 'Bot conectado y listo para responder.');
        addEvent(
          'ready',
          `Bot conectado${runtime.connectedNumber ? ` al número ${maskPhone(runtime.connectedNumber)}` : ''}.`,
        );
      }

      if (connection === 'close') {
        const code = getDisconnectCode(lastDisconnect);
        const loggedOut = code === DisconnectReason.loggedOut;
        runtime.qrDataUrl = null;
        runtime.connectedNumber = null;
        socket = null;

        if (loggedOut) {
          setStatus('sesion_cerrada', 'La sesión fue cerrada. Preparando un QR nuevo...');
          addEvent('disconnect', 'WhatsApp cerró la sesión; se eliminarán las credenciales locales.');
          await removeSession();
          scheduleReconnect(1500);
        } else {
          setStatus('reconectando', `Conexión cerrada${code ? ` (código ${code})` : ''}. Reconectando...`);
          addEvent('disconnect', `Conexión cerrada${code ? ` con código ${code}` : ''}.`);
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
      setStatus('error', 'No se pudo iniciar la conexión de WhatsApp.');
      addEvent('error', `No se pudo iniciar WhatsApp: ${error.stack || error.message}`);
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
    try {
      oldSocket.end(new Error(reason));
    } catch (_) {
      // La conexión anterior podría estar cerrada.
    }
  }
}

async function removeSession() {
  try {
    await fs.rm(SESSION_PATH, { recursive: true, force: true });
    await fs.mkdir(SESSION_PATH, { recursive: true });
    addEvent('session', 'Se borró la sesión local.');
  } catch (error) {
    addEvent('error', `No se pudo borrar la sesión: ${error.message}`);
  }
}

app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, status: runtime.status, engine: runtime.engine });
});

app.post('/api/login', requireAdmin, (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/status', requireAdmin, (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({
    ok: true,
    runtime,
    events: recentEvents,
    warnings: [
      'Esta conexión usa un cliente no oficial de WhatsApp.',
      'En Render gratis la sesión puede perderse al reiniciar o redesplegar.',
    ],
  });
});

app.post('/api/toggle', requireAdmin, (req, res) => {
  runtime.botEnabled = Boolean(req.body?.enabled);
  addEvent('bot', `Respuestas automáticas ${runtime.botEnabled ? 'activadas' : 'pausadas'}.`);
  res.json({ ok: true, enabled: runtime.botEnabled });
});

app.post('/api/restart', requireAdmin, (_req, res) => {
  res.json({ ok: true, message: 'Reinicio solicitado.' });
  setImmediate(async () => {
    try {
      await stopCurrentSocket();
      setStatus('reiniciando', 'Reabriendo la conexión sin borrar la sesión...');
      await startSocket();
    } catch (error) {
      addEvent('error', `Error reiniciando: ${error.message}`);
      scheduleReconnect();
    }
  });
});

app.post('/api/logout', requireAdmin, (_req, res) => {
  res.json({ ok: true, message: 'Sesión eliminada. Aparecerá un QR nuevo.' });
  setImmediate(async () => {
    try {
      generation += 1;
      const oldSocket = socket;
      socket = null;
      if (oldSocket) {
        try {
          await oldSocket.logout();
        } catch (_) {
          try {
            oldSocket.end(new Error('Cerrar sesión'));
          } catch (_) {
            // Ignorado.
          }
        }
      }
      await removeSession();
      setStatus('reiniciando', 'Preparando un nuevo código QR...');
      await startSocket();
    } catch (error) {
      addEvent('error', `Error cerrando sesión: ${error.message}`);
      scheduleReconnect();
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  addEvent('server', `Panel iniciado en el puerto ${PORT}. Motor: Baileys.`);
  startSocket().catch((error) => addEvent('error', error.message));
});

async function shutdown(signal) {
  shuttingDown = true;
  clearTimeout(reconnectTimer);
  addEvent('server', `Cerrando por ${signal}.`);
  await stopCurrentSocket(`Apagado por ${signal}`);
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  addEvent('error', `Promesa no controlada: ${String(reason)}`);
});
process.on('uncaughtException', (error) => {
  addEvent('error', `Excepción no controlada: ${error.stack || error.message}`);
});
