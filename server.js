'use strict';

const express = require('express');
const QRCode = require('qrcode');
const fs = require('fs/promises');
const path = require('path');
const { Client, LocalAuth } = require('whatsapp-web.js');

const app = express();
const PORT = Number(process.env.PORT || 10000);
const ADMIN_KEY = String(process.env.ADMIN_KEY || '').trim();
const SESSION_PATH = process.env.SESSION_PATH || '/data/.wwebjs_auth';
const CHROME_PATH = process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium';

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
  status: 'iniciando',
  detail: 'Preparando el navegador...',
  qrDataUrl: null,
  connectedNumber: null,
  botEnabled: true,
  startedAt: new Date().toISOString(),
  lastEventAt: new Date().toISOString(),
  messagesReceived: 0,
  repliesSent: 0,
};

const recentEvents = [];
const processedMessages = new Set();
const processedOrder = [];
const humanModeUntil = new Map();
const lastReplyAt = new Map();
let client = null;
let startingClient = false;
let reconnectTimer = null;

function addEvent(type, text) {
  const item = {
    type,
    text,
    at: new Date().toISOString(),
  };
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

function maskPhone(chatId) {
  const digits = String(chatId || '').replace(/\D/g, '');
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
    return res.status(503).json({
      ok: false,
      error: 'Falta configurar ADMIN_KEY en Render.',
    });
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

  if (
    text === '1' ||
    /\b(precio|precios|cotizacion|cotizar|costo|costos|cuanto cuesta)\b/.test(text)
  ) {
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

function createClient() {
  return new Client({
    authStrategy: new LocalAuth({
      clientId: 'render-bot',
      dataPath: SESSION_PATH,
    }),
    puppeteer: {
      headless: true,
      executablePath: CHROME_PATH,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
      ],
    },
  });
}

function attachClientEvents(instance) {
  instance.on('qr', async (qr) => {
    try {
      runtime.qrDataUrl = await QRCode.toDataURL(qr, {
        width: 360,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
      runtime.connectedNumber = null;
      setStatus('esperando_qr', 'Escanea el código QR desde WhatsApp en tu teléfono.');
      addEvent('qr', 'Se generó un nuevo código QR.');
    } catch (error) {
      setStatus('error', 'No se pudo convertir el QR en imagen.');
      addEvent('error', `Error creando QR: ${error.message}`);
    }
  });

  instance.on('authenticated', () => {
    runtime.qrDataUrl = null;
    setStatus('autenticado', 'QR aceptado. WhatsApp está terminando de sincronizar.');
    addEvent('auth', 'WhatsApp aceptó el código QR.');
  });

  instance.on('ready', () => {
    runtime.qrDataUrl = null;
    runtime.connectedNumber = instance.info?.wid?.user || null;
    setStatus('conectado', 'Bot conectado y listo para responder.');
    addEvent('ready', `Bot conectado${runtime.connectedNumber ? ` al número ${maskPhone(runtime.connectedNumber)}` : ''}.`);
  });

  instance.on('auth_failure', (message) => {
    runtime.qrDataUrl = null;
    setStatus('error_autenticacion', 'La sesión no pudo restaurarse. Genera un QR nuevo.');
    addEvent('error', `Fallo de autenticación: ${message}`);
  });

  instance.on('disconnected', (reason) => {
    runtime.qrDataUrl = null;
    runtime.connectedNumber = null;
    setStatus('desconectado', `WhatsApp se desconectó: ${reason}`);
    addEvent('disconnect', `WhatsApp desconectado: ${reason}`);
    scheduleReconnect();
  });

  instance.on('message', async (message) => {
    try {
      if (!runtime.botEnabled || message.fromMe) return;
      if (!message.from || message.from === 'status@broadcast') return;
      if (message.from.endsWith('@g.us') || message.from.endsWith('@broadcast')) return;

      const messageId = message.id?._serialized || String(message.id || '');
      if (!rememberMessage(messageId)) return;

      // Evita contestar mensajes antiguos después de una resincronización.
      const messageAgeMs = Date.now() - Number(message.timestamp || 0) * 1000;
      if (messageAgeMs > 5 * 60 * 1000) return;

      runtime.messagesReceived += 1;
      const sender = message.from;
      const now = Date.now();
      const humanUntil = humanModeUntil.get(sender) || 0;

      if (humanUntil > now) {
        addEvent('human', `Mensaje recibido de ${maskPhone(sender)}; atención humana activa.`);
        return;
      }

      if (message.type !== 'chat') {
        await message.reply('Por ahora puedo responder mensajes de texto. Escríbeme tu consulta o “menú”.');
        runtime.repliesSent += 1;
        addEvent('reply', `Se pidió texto a ${maskPhone(sender)}.`);
        return;
      }

      // Pequeño límite para evitar respuestas repetidas por mensajes enviados muy rápido.
      const previousReply = lastReplyAt.get(sender) || 0;
      if (now - previousReply < 1500) return;
      lastReplyAt.set(sender, now);

      const text = String(message.body || '');
      const normalized = normalizeText(text);
      const reply = buildReply(text);

      if (normalized === '4' || /\b(asesor|humano|persona|vendedor|agente)\b/.test(normalized)) {
        humanModeUntil.set(sender, now + 30 * 60 * 1000);
      }

      await message.reply(reply);
      runtime.repliesSent += 1;
      addEvent('reply', `Respuesta automática enviada a ${maskPhone(sender)}.`);
    } catch (error) {
      addEvent('error', `Error procesando un mensaje: ${error.message}`);
    }
  });
}

async function startClient() {
  if (startingClient) return;
  startingClient = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;

  try {
    setStatus('iniciando', 'Abriendo WhatsApp Web...');
    runtime.qrDataUrl = null;

    if (client) {
      try {
        await client.destroy();
      } catch (_) {
        // Ignorado: el navegador anterior podría estar cerrado.
      }
    }

    client = createClient();
    attachClientEvents(client);
    await client.initialize();
  } catch (error) {
    setStatus('error', 'No se pudo iniciar el navegador de WhatsApp.');
    addEvent('error', `No se pudo iniciar WhatsApp: ${error.message}`);
    scheduleReconnect();
  } finally {
    startingClient = false;
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startClient().catch((error) => addEvent('error', error.message));
  }, 15000);
}

async function removeSession() {
  try {
    await fs.rm(SESSION_PATH, { recursive: true, force: true });
    addEvent('session', 'Se borró la sesión local.');
  } catch (error) {
    addEvent('error', `No se pudo borrar la sesión: ${error.message}`);
  }
}

app.disable('x-powered-by');
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (_req, res) => {
  res.json({ ok: true, status: runtime.status });
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
      'Esta conexión usa WhatsApp Web y no es una API oficial.',
      'En Render gratis la sesión puede perderse al reiniciar o redesplegar.',
    ],
  });
});

app.post('/api/toggle', requireAdmin, (req, res) => {
  runtime.botEnabled = Boolean(req.body?.enabled);
  addEvent('bot', `Respuestas automáticas ${runtime.botEnabled ? 'activadas' : 'pausadas'}.`);
  res.json({ ok: true, enabled: runtime.botEnabled });
});

app.post('/api/restart', requireAdmin, async (_req, res) => {
  res.json({ ok: true, message: 'Reinicio solicitado.' });
  setImmediate(() => startClient().catch((error) => addEvent('error', error.message)));
});

app.post('/api/logout', requireAdmin, async (_req, res) => {
  res.json({ ok: true, message: 'Sesión eliminada. Aparecerá un QR nuevo.' });
  setImmediate(async () => {
    try {
      if (client) {
        try {
          await client.logout();
        } catch (_) {
          // Continuamos borrando los datos locales.
        }
        try {
          await client.destroy();
        } catch (_) {
          // Ignorado.
        }
      }
      client = null;
      await removeSession();
      setStatus('reiniciando', 'Preparando un nuevo código QR...');
      await startClient();
    } catch (error) {
      addEvent('error', `Error cerrando sesión: ${error.message}`);
      scheduleReconnect();
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  addEvent('server', `Panel iniciado en el puerto ${PORT}.`);
  startClient().catch((error) => addEvent('error', error.message));
});

async function shutdown(signal) {
  addEvent('server', `Cerrando por ${signal}.`);
  try {
    if (client) await client.destroy();
  } catch (_) {
    // Ignorado durante apagado.
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  addEvent('error', `Promesa no controlada: ${String(reason)}`);
});
process.on('uncaughtException', (error) => {
  addEvent('error', `Excepción no controlada: ${error.message}`);
});
