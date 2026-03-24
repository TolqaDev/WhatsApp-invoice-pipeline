import { Router } from 'express';
import QRCode from 'qrcode';
import config from './config.js';
import { getState, disconnect, restart, clearAuth } from './socket.js';

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

router.post('/restart', (_req, res) => {
  res.json({ success: true, message: 'Yeniden başlatılıyor...' });
  setImmediate(() => restart().catch(err => {
    console.error('[Routes] Restart hatası:', err.message);
  }));
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
