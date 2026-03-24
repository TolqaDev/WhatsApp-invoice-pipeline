import express from 'express';
import config from './config.js';
import { cors, securityHeaders, auth, rateLimit, bodyLimit } from './middleware.js';
import routes from './routes.js';

const app = express();

app.disable('x-powered-by');
app.use(express.json({ limit: '15mb' }));

app.use(securityHeaders);
app.use(cors);
app.use(bodyLimit);
app.use(rateLimit);
app.use(auth);

app.use('/', routes);

app.use((_req, res) => {
  res.status(404).json({ success: false, error_code: 'NOT_FOUND', message: 'Endpoint bulunamadı' });
});

app.use((err, _req, res, _next) => {
  console.error('[HTTP] Beklenmeyen hata:', err.message);
  res.status(500).json({ success: false, error_code: 'INTERNAL_ERROR', message: 'Sunucu hatası' });
});

export function startServer() {
  return new Promise((resolve) => {
    const server = app.listen(config.port, () => {
      console.log(`[HTTP] Köprü sunucusu http://localhost:${config.port} üzerinde çalışıyor`);
      resolve(server);
    });
  });
}

export default app;

