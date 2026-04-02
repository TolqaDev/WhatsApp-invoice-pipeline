import { timingSafeEqual } from 'crypto';
import config from './config.js';

function safeCompare(a, b) {
  if (!a || !b) return false;
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const windows = new Map();

function isRateLimited(ip) {
  const now = Date.now();
  const cutoff = now - 60_000;
  const limit = config.rateLimitRpm || 30;

  if (!windows.has(ip)) windows.set(ip, []);
  const hits = windows.get(ip);

  // Süresi dolmuş kayıtları baştan kırp (sıralı olduğu için shift yeterli)
  while (hits.length > 0 && hits[0] <= cutoff) {
    hits.shift();
  }

  if (hits.length >= limit) return true;
  hits.push(now);
  return false;
}

setInterval(() => {
  const cutoff = Date.now() - 120_000;
  for (const [ip, hits] of windows) {
    if (hits.length === 0 || hits[hits.length - 1] < cutoff) {
      windows.delete(ip);
    }
  }
}, 60_000);

export function cors(req, res, next) {
  const allowedOrigin = config.pythonApiUrl || 'http://127.0.0.1:3000';
  res.header('Access-Control-Allow-Origin', allowedOrigin);
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-API-Key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
}

export function securityHeaders(_req, res, next) {
  res.header('X-Content-Type-Options', 'nosniff');
  res.header('X-Frame-Options', 'DENY');
  res.header('X-XSS-Protection', '0');
  res.header('Referrer-Policy', 'no-referrer');
  res.header('Cache-Control', 'no-store');
  res.removeHeader('X-Powered-By');
  next();
}

export function auth(req, res, next) {
  if (!config.apiSecret) {
    return res.status(503).json({
      success: false,
      error_code: 'NO_SECRET',
      message: 'API secret yapılandırılmamış — sunucu güvensiz modda başlatılamaz',
    });
  }

  const key = req.headers['x-api-key'] || '';
  if (!safeCompare(key, config.apiSecret)) {
    return res.status(401).json({
      success: false,
      error_code: 'UNAUTHORIZED',
      message: 'Geçersiz veya eksik API anahtarı',
    });
  }

  next();
}

export function rateLimit(req, res, next) {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({
      success: false,
      error_code: 'RATE_LIMITED',
      message: `Çok fazla istek. Maks ${config.rateLimitRpm} istek/dk.`,
    });
  }
  next();
}

export function bodyLimit(req, res, next) {
  const cl = req.headers['content-length'];
  if (cl && parseInt(cl, 10) > config.maxBodySize) {
    return res.status(413).json({
      success: false,
      error_code: 'PAYLOAD_TOO_LARGE',
      message: 'İstek boyutu çok büyük (max 15MB)',
    });
  }
  next();
}

