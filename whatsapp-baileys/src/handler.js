import { downloadMediaMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import config from './config.js';
import { sendReaction, sendText, markRead, setLastProcessed } from './socket.js';
import { extractNumber } from './utils.js';
import {
  trackMessageId, drainQueue, enqueue, isQueueFull, isBusy,
  shouldWarnQueueFull, incrementActive, decrementActive,
  getActiveCount, getQueueLength, setProcessCallback,
  MAX_CONCURRENT,
} from './queue.js';

const mediaLogger = pino({ level: 'warn' });

const EMOJI = { PROCESSING: '👀', SUCCESS: '👍', FAILURE: '👎' };

setProcessCallback(processImage);

export async function handleImageMessage(msg, sock) {
  const messageId = msg.key?.id;

  if (!trackMessageId(messageId)) {
    console.log(`[Handler] ⏭ Zaten işlendi, atlanıyor — MsgID: ${messageId}`);
    return;
  }

  if (isBusy()) {
    if (isQueueFull()) {
      if (shouldWarnQueueFull()) {
        const jid = msg.key.remoteJid;
        await sendText(jid, '⏳ Kuyruk dolu (maks 10). Lütfen mevcut fişlerin işlenmesini bekleyin.');
      }
      console.warn(`[Queue] ⛔ Kuyruk DOLU — mesaj reddedildi, MsgID: ${messageId}`);
      return;
    }
    enqueue(msg, sock);
    return;
  }

  processImage(msg, sock);
}

async function processImage(msg, sock) {
  const { key: messageKey } = msg;
  const senderNumber = extractNumber(messageKey.senderPn) || extractNumber(messageKey.remoteJid);
  const messageId = messageKey.id;

  incrementActive();
  console.log(`[Handler] ⚙ İşleniyor — MsgID: ${messageId}, aktif: ${getActiveCount()}/${MAX_CONCURRENT}, kuyruk: ${getQueueLength()}`);

  try {
    await markRead(messageKey);
    await sendReaction(messageKey, EMOJI.PROCESSING);

    const imageBuffer = await downloadMediaMessage(msg, 'buffer', {}, {
      logger: mediaLogger,
      reuploadRequest: sock.updateMediaMessage,
    });

    if (!imageBuffer?.length) {
      console.error(`[Handler] ❌ Görsel indirilemedi — MsgID: ${messageId}`);
      await sendReaction(messageKey, EMOJI.FAILURE);
      return;
    }

    const imageMsg = msg.message?.imageMessage
      || msg.message?.viewOnceMessage?.message?.imageMessage
      || msg.message?.viewOnceMessageV2?.message?.imageMessage
      || msg.message?.viewOnceMessageV2Extension?.message?.imageMessage
      || msg.message?.ephemeralMessage?.message?.imageMessage
      || msg.message?.ephemeralMessage?.message?.viewOnceMessage?.message?.imageMessage
      || msg.message?.documentWithCaptionMessage?.message?.documentMessage
      || msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage;
    const mimeType = imageMsg?.mimetype || 'image/jpeg';
    const base64 = imageBuffer.toString('base64');

    const headers = { 'Content-Type': 'application/json' };
    if (config.apiSecret) headers['X-API-Key'] = config.apiSecret;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);

    try {
      const response = await fetch(`${config.pythonApiUrl}/v1/process-image`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          image_base64: base64,
          mime_type: mimeType,
          sender: `whatsapp:${senderNumber}`,
          request_id: `wa_${messageId}`,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      const data = await response.json();

      if (response.ok && data.success) {
        await sendReaction(messageKey, EMOJI.SUCCESS);
        setLastProcessed();
        const s = data.summary || {};
        console.log(
          `[Handler] ✅ ${senderNumber} — ${s.firma || '?'}, ` +
          `₺${s.toplam || '?'}, %${data.confidence || '?'}, ${data.processing_time_ms || '?'}ms`,
        );
      } else {
        await sendReaction(messageKey, EMOJI.FAILURE);
        const errMsg = data.detail?.message || data.detail || data.message || `HTTP ${response.status}`;
        console.warn(`[Handler] ❌ ${senderNumber} — ${errMsg}`);
      }
    } catch (fetchErr) {
      clearTimeout(timeout);
      console.error(`[Handler] ❌ ${fetchErr.name === 'AbortError' ? 'Timeout (120s)' : fetchErr.message}`);
      await sendReaction(messageKey, EMOJI.FAILURE);
    }
  } catch (err) {
    console.error(`[Handler] ❌ ${err.message}`);
    try { await sendReaction(messageKey, EMOJI.FAILURE); } catch { /* noop */ }
  } finally {
    decrementActive();
    console.log(`[Handler] 🏁 Tamamlandı — MsgID: ${messageId}, aktif: ${getActiveCount()}/${MAX_CONCURRENT}, kuyruk: ${getQueueLength()}`);
    drainQueue();
  }
}
