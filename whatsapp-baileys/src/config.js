import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../../.env') });

function buildPythonUrl() {
  const host = process.env.HOST === '0.0.0.0' ? '127.0.0.1' : (process.env.HOST || '127.0.0.1');
  const port = process.env.PORT || '3000';
  return `http://${host}:${port}`;
}

const config = {
  env: process.env.ENV || 'production',
  pythonApiUrl: buildPythonUrl(),
  apiSecret: process.env.API_SECRET || '',
  allowedJids: (process.env.ALLOW_JID || '')
    .split(',')
    .map(j => j.trim())
    .filter(Boolean)
    .map(j => (j.includes('@') ? j : `${j}@s.whatsapp.net`)),
  port: parseInt(process.env.BRIDGE_PORT || '3001', 10),
  qrRefreshInterval: parseInt(process.env.QR_REFRESH_INTERVAL || '30', 10) * 1000,
  notificationMuteInterval: parseInt(process.env.NOTIFICATION_MUTE_INTERVAL || '30', 10) * 1000,
  rateLimitRpm: parseInt(process.env.RATE_LIMIT_RPM || '30', 10),
  maxBodySize: 15 * 1024 * 1024,
  authDir: resolve(__dirname, '../../public/whatsapp-auth'),
};

export default config;

