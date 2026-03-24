import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import { mkdir, rm } from 'fs/promises';
import { existsSync } from 'fs';
import pino from 'pino';
import config from './config.js';
import { extractNumber } from './utils.js';

const logger = pino({ level: 'warn' });

let sock = null;
let currentQR = null;
let connectionState = 'disconnected';
let phoneNumber = null;
let startTime = null;
let lastProcessedAt = null;
let reconnectTimer = null;
let muteInterval = null;
let retryCount = 0;
const MAX_RETRY = 10;

let onMessageCallback = null;

export function onMessage(cb) {
  onMessageCallback = cb;
}

export function getState() {
  return {
    connection: connectionState,
    qr: currentQR,
    phoneNumber,
    uptime: startTime ? Date.now() - startTime : 0,
    lastProcessedAt,
    retryCount,
  };
}

export async function sendReaction(messageKey, emoji) {
  if (!sock || connectionState !== 'connected') return;
  try {
    await sock.sendMessage(messageKey.remoteJid, {
      react: { text: emoji, key: messageKey },
    });
  } catch (err) {
    console.error('[WA] Reaksiyon gönderilemedi:', err.message);
  }
}

export async function sendText(jid, text) {
  if (!sock || connectionState !== 'connected') return;
  try {
    await sock.sendMessage(jid, { text });
  } catch (err) {
    console.error('[WA] Mesaj gönderilemedi:', err.message);
  }
}

export async function markRead(messageKey) {
  if (!sock || connectionState !== 'connected') return;
  try {
    await sock.readMessages([messageKey]);
  } catch (err) {
    console.error('[WA] Okundu gönderilemedi:', err.message);
  }
}

export function setLastProcessed() {
  lastProcessedAt = Date.now();
}

function startMuteLoop() {
  stopMuteLoop();
  muteInterval = setInterval(async () => {
    if (!sock || connectionState !== 'connected') return;
    try { await sock.sendPresenceUpdate('unavailable'); } catch { /* noop */ }
  }, config.notificationMuteInterval);
}

function stopMuteLoop() {
  if (muteInterval) {
    clearInterval(muteInterval);
    muteInterval = null;
  }
}


export async function connect() {
  if (!existsSync(config.authDir)) {
    await mkdir(config.authDir, { recursive: true });
  }

  const { state, saveCreds } = await useMultiFileAuthState(config.authDir);
  const { version } = await fetchLatestBaileysVersion();

  connectionState = 'connecting';
  currentQR = null;
  retryCount = 0;

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    fireInitQueries: false,
    generateHighQualityLinkPreview: false,
    getMessage: async () => undefined,
    shouldIgnoreJid: (jid) => {
      return jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid === 'status@broadcast';
    },
    connectTimeoutMs: 30_000,
    keepAliveIntervalMs: 25_000,
    retryRequestDelayMs: 2_000,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQR = qr;
      connectionState = 'qr_pending';
      console.log('[WA] QR kodu güncellendi — tarama bekliyor');
    }

    if (connection === 'open') {
      connectionState = 'connected';
      currentQR = null;
      startTime = Date.now();
      retryCount = 0;
      phoneNumber = sock.user?.id?.split(':')[0] || sock.user?.id?.split('@')[0] || null;
      console.log(`[WA] Bağlantı kuruldu — ${phoneNumber || 'bilinmeyen numara'}`);
      try { await sock.sendPresenceUpdate('unavailable'); } catch { /* noop */ }
      startMuteLoop();
    }

    if (connection === 'close') {
      connectionState = 'disconnected';
      stopMuteLoop();

      const statusCode = lastDisconnect?.error?.output?.statusCode;
      console.log(`[WA] Bağlantı kapandı — kod: ${statusCode}`);

      if (statusCode === DisconnectReason.loggedOut) {
        console.log('[WA] Oturum kapandı, auth temizleniyor...');
        await clearAuth();
        currentQR = null;
        phoneNumber = null;
      } else if (retryCount < MAX_RETRY) {
        retryCount++;
        const delay = Math.min(2_000 * retryCount, 30_000);
        console.log(`[WA] Yeniden bağlanılıyor... (deneme ${retryCount}/${MAX_RETRY}, ${delay}ms bekle)`);
        reconnectTimer = setTimeout(() => connect(), delay);
      } else {
        console.error(`[WA] Maksimum yeniden bağlanma denemesi aşıldı (${MAX_RETRY})`);
      }
    }
  });

  sock.ev.on('messages.upsert', ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const m = msg.message;
      if (!m) continue;

      const senderNumber = extractNumber(msg.key.senderPn) || extractNumber(msg.key.remoteJid);

      if (config.allowedJids.length > 0) {
        const allowedNumbers = config.allowedJids.map(j => extractNumber(j));
        if (!allowedNumbers.includes(senderNumber)) continue;
      }

      const hasImage = m.imageMessage
        || m.viewOnceMessage?.message?.imageMessage
        || m.viewOnceMessageV2?.message?.imageMessage
        || m.viewOnceMessageV2Extension?.message?.imageMessage
        || m.ephemeralMessage?.message?.imageMessage
        || m.ephemeralMessage?.message?.viewOnceMessage?.message?.imageMessage
        || m.documentWithCaptionMessage?.message?.documentMessage
        || m.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;

      if (!hasImage) continue;

      console.log(`[WA] 📷 Görsel alındı — ${senderNumber}, MsgID: ${msg.key.id}`);

      if (onMessageCallback) {
        onMessageCallback(msg, sock).catch(err => {
          console.error(`[WA] ❌ Mesaj işleme hatası (${msg.key.id}):`, err.message);
        });
      }
    }
  });

  return sock;
}

export async function disconnect() {
  stopMuteLoop();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      await sock.logout();
    } catch { /* noop */ }
    sock = null;
  }
  connectionState = 'disconnected';
  currentQR = null;
  phoneNumber = null;
}

export async function clearAuth() {
  try {
    if (existsSync(config.authDir)) {
      await rm(config.authDir, { recursive: true, force: true });
    }
  } catch (err) {
    console.error('[WA] Auth temizleme hatası:', err.message);
  }
}

export async function restart() {
  stopMuteLoop();
  if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
  if (sock) {
    try {
      sock.ev.removeAllListeners();
      sock.end(undefined);
    } catch { /* noop */ }
    sock = null;
  }
  connectionState = 'disconnected';
  currentQR = null;
  phoneNumber = null;
  await new Promise(r => setTimeout(r, 1_000));
  return connect();
}
