import { Router } from 'express';
import QRCode from 'qrcode';
import config from './config.js';
import { getState, disconnect, restart, clearAuth, sendText, updateAllowedJids } from './socket.js';

const router = Router();

router.get('/health', (_req, res) => {
  const state = getState();
  res.json({
    status: state.connection === 'connected' ? 'healthy' : 'degraded',
    connection: state.connection,
    uptime: state.uptime,
    version: '1.0.0',
  });
});

router.get('/status', (_req, res) => {
  const state = getState();
  res.json({
    connection: state.connection,
    phoneNumber: state.phoneNumber,
    uptime: state.uptime,
    uptimeFormatted: formatUptime(state.uptime),
    lastProcessedAt: state.lastProcessedAt,
    hasQR: !!state.qr,
    retryCount: state.retryCount,
    allowedJids: config.allowedJids,
  });
});

router.get('/qr', async (_req, res) => {
  const state = getState();

  if (state.connection === 'connected') {
    return res.json({
      success: false,
      message: 'Zaten bağlı',
      connection: 'connected',
      phoneNumber: state.phoneNumber,
    });
  }

  if (!state.qr) {
    return res.json({
      success: false,
      message: 'QR kodu henüz hazır değil',
      connection: state.connection,
    });
  }

  try {
    const qrDataUri = await QRCode.toDataURL(state.qr, {
      width: 280,
      margin: 2,
      color: { dark: '#111b21', light: '#ffffff' },
      errorCorrectionLevel: 'M',
    });

    res.json({ success: true, qr: qrDataUri, connection: state.connection });
  } catch {
    res.status(500).json({ success: false, error: 'QR oluşturulamadı' });
  }
});

router.post('/logout', async (_req, res) => {
  try {
    await disconnect();
    await clearAuth();
    res.json({ success: true, message: 'Oturum kapatıldı' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/send-notification', async (req, res) => {
  const state = getState();
  if (state.connection !== 'connected') {
    return res.status(503).json({ success: false, message: 'WhatsApp bağlı değil' });
  }

  const { message, error_type, target_jid } = req.body || {};
  if (!message) {
    return res.status(400).json({ success: false, message: 'Mesaj içeriği gerekli' });
  }

  // target_jid varsa sadece o kullanıcıya gönder, yoksa tüm yetkili numaralara
  let targets;
  if (target_jid) {
    const normalizedTarget = target_jid.includes('@') ? target_jid : `${target_jid}@s.whatsapp.net`;
    targets = [normalizedTarget];
  } else {
    targets = config.allowedJids.length > 0 ? config.allowedJids : [];
  }

  if (targets.length === 0) {
    console.warn('[Routes] Bildirim hedefi yok — ALLOW_JID tanımlı değil ve target_jid belirtilmemiş');
    return res.json({ success: false, message: 'Bildirim hedefi bulunamadı' });
  }

  let sent = 0;
  for (const jid of targets) {
    try {
      await sendText(jid, message);
      sent++;
    } catch (err) {
      console.error(`[Routes] Bildirim gönderilemedi: ${jid}`, err.message);
    }
  }

  console.log(`[Routes] 📢 Gemini bildirim gönderildi — tip: ${error_type}, hedef: ${sent}/${targets.length}`);
  res.json({ success: true, sent, total: targets.length });
});

router.post('/restart', (_req, res) => {
  res.json({ success: true, message: 'Yeniden başlatılıyor...' });
  setImmediate(() => restart().catch(err => {
    console.error('[Routes] Restart hatası:', err.message);
  }));
});

router.get('/config/jids', (_req, res) => {
  res.json({
    success: true,
    allowedJids: config.allowedJids,
  });
});

router.put('/config/jids', (req, res) => {
  const { jids } = req.body || {};
  if (!Array.isArray(jids)) {
    return res.status(400).json({ success: false, message: 'jids alanı dizi olmalıdır' });
  }

  const normalized = jids
    .map(j => String(j).trim())
    .filter(Boolean)
    .map(j => (j.includes('@') ? j : `${j}@s.whatsapp.net`));

  config.allowedJids = normalized;
  updateAllowedJids(normalized);

  console.log(`[Routes] İzinli JID güncellendi: ${normalized.length > 0 ? normalized.join(', ') : 'HEPSİ (filtresiz)'}`);
  res.json({
    success: true,
    message: `${normalized.length} JID güncellendi`,
    allowedJids: normalized,
  });
});

function formatUptime(ms) {
  if (!ms || ms <= 0) return '-';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}g ${h % 24}s ${m % 60}dk`;
  if (h > 0) return `${h}s ${m % 60}dk`;
  if (m > 0) return `${m}dk ${s % 60}sn`;
  return `${s}sn`;
}

export default router;
