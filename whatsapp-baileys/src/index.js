import config from './config.js';
import { connect, onMessage } from './socket.js';
import { handleImageMessage } from './handler.js';
import { startServer } from './server.js';

console.log(`[Boot] WhatsApp Baileys Bridge v1.0.0 (${config.env})`);
console.log(`[Config] Python API: ${config.pythonApiUrl} | Bridge Port: ${config.port}`);
console.log(`[Config] API Secret: ${config.apiSecret ? '***' + config.apiSecret.slice(-4) : 'YOK (UYARI!)'}`);
console.log(`[Config] İzinli JID: ${config.allowedJids.length > 0 ? config.allowedJids.join(', ') : 'HEPSİ (filtresiz)'}`);
console.log(`[Config] Rate Limit: ${config.rateLimitRpm} req/dk`);

if (!config.apiSecret) {
  console.error('[SECURITY] ⛔ API_SECRET tanımlanmamış — sunucu başlatılamıyor!');
  console.error('[SECURITY] Kök dizindeki .env dosyasına API_SECRET ekleyin.');
  process.exit(1);
}

onMessage(handleImageMessage);

(async () => {
  try {
    await startServer();
    await connect();
    console.log('[Boot] Sistem hazır');
  } catch (err) {
    console.error('[Boot] Başlatma hatası:', err);
    process.exit(1);
  }
})();

process.on('SIGINT', () => {
  console.log('\n[Shutdown] Kapatılıyor...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n[Shutdown] SIGTERM — kapatılıyor...');
  process.exit(0);
});

process.on('unhandledRejection', (err) => {
  console.error('[Error] Unhandled rejection:', err?.message || err);
});
