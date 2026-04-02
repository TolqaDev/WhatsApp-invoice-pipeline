/**
 * Fatura Bot — Background Service Worker
 * Popup kapansa bile toplu fiş işlemeyi arka planda sürdürür.
 * Kuyruk verileri chrome.storage.local üzerinden kalıcı tutulur.
 */

let isProcessing = false;
let keepAliveTimer = null;

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.command === 'START_QUEUE') {
    if (isProcessing) {
      sendResponse({ ok: false, reason: 'already_processing' });
    } else {
      processQueue();
      sendResponse({ ok: true });
    }
    return false;
  }

  if (message.command === 'GET_QUEUE_STATE') {
    chromeGet(['queue_meta']).then(({ queue_meta }) => {
      sendResponse(queue_meta || null);
    });
    return true;
  }

  if (message.command === 'CANCEL_QUEUE') {
    cancelQueue();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

chrome.runtime.onStartup.addListener(checkAndResume);
chrome.runtime.onInstalled.addListener(() => {
  console.log('[Fatura Bot] Service worker installed');
  checkAndResume();
});

function checkAndResume() {
  chromeGet(['queue_meta']).then(({ queue_meta }) => {
    if (queue_meta && queue_meta.status === 'processing') {
      console.log('[Fatura Bot] Yarım kalmış kuyruk tespit edildi, devam ediliyor...');
      processQueue();
    }
  });
}

function startKeepAlive() {
  stopKeepAlive();
  // Her 25 saniyede bir ping — MV3 SW 30sn inaktivitede ölür
  keepAliveTimer = setInterval(() => {
    chromeGet(['queue_meta']).then(() => { /* storage okuma SW'yi canlı tutar */ });
  }, 25000);
}

function stopKeepAlive() {
  if (keepAliveTimer) {
    clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  }
}

let cancelRequested = false;

function cancelQueue() {
  cancelRequested = true;
}

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;
  cancelRequested = false;
  startKeepAlive();

  try {
    const { apiUrl, apiKey } = await chromeGet(['apiUrl', 'apiKey']);
    const baseUrl = normalizeUrl(apiUrl || 'http://localhost:3000');

    while (true) {
      if (cancelRequested) {
        const { queue_meta } = await chromeGet(['queue_meta']);
        if (queue_meta) {
          queue_meta.status = 'cancelled';
          await chromeSet({ queue_meta });
        }
        broadcast({ type: 'QUEUE_CANCELLED' });
        break;
      }

      const { queue_meta, queue_items } = await chromeGet(['queue_meta', 'queue_items']);

      if (!queue_meta || queue_meta.status !== 'processing' || !queue_items) break;

      // Sonraki bekleyen öğeyi bul
      const idx = queue_meta.results.findIndex(r => r.status === 'pending');
      if (idx === -1) {
        queue_meta.status = 'completed';
        await chromeSet({ queue_meta });
        await chromeRemove(['queue_items']);
        broadcast({ type: 'QUEUE_COMPLETED', meta: queue_meta });
        break;
      }

      queue_meta.currentIndex = idx;
      queue_meta.results[idx].status = 'processing';
      await chromeSet({ queue_meta });
      broadcast({ type: 'QUEUE_PROGRESS', index: idx, total: queue_meta.totalCount, status: 'processing' });

      const item = queue_items[idx];
      try {
        const result = await fetchProcessImage(baseUrl, apiKey, item.base64, item.mimeType);
        queue_meta.results[idx] = { status: 'done', result, fileName: item.fileName };
      } catch (e) {
        queue_meta.results[idx] = { status: 'error', error: e.message || 'Hata oluştu', fileName: item.fileName };
      }

      // İşlenen öğenin base64'ünü temizle (bellek tasarrufu)
      queue_items[idx] = { base64: null, mimeType: item.mimeType, fileName: item.fileName };
      await chromeSet({ queue_meta, queue_items });

      broadcast({
        type: 'QUEUE_ITEM_DONE',
        index: idx,
        total: queue_meta.totalCount,
        item: queue_meta.results[idx],
      });

      // Rate-limit koruması — sonraki öğe varsa bekle
      const nextPending = queue_meta.results.findIndex(r => r.status === 'pending');
      if (nextPending !== -1) {
        await sleep(500);
      }
    }
  } catch (e) {
    console.error('[Fatura Bot] Kuyruk işleme hatası:', e);
    try {
      const { queue_meta } = await chromeGet(['queue_meta']);
      if (queue_meta && queue_meta.status === 'processing') {
        queue_meta.status = 'error';
        queue_meta.errorMessage = e.message;
        await chromeSet({ queue_meta });
      }
    } catch (_) { /* ignore */ }
  } finally {
    isProcessing = false;
    stopKeepAlive();
  }
}

async function fetchProcessImage(baseUrl, apiKey, imageBase64, mimeType) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['X-API-Key'] = apiKey;

  const resp = await fetch(`${baseUrl}/v1/process-image`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      image_base64: imageBase64,
      mime_type: mimeType,
      sender: 'chrome-extension',
    }),
  });

  const data = await resp.json();

  if (!resp.ok) {
    const errMsg = (typeof data.detail === 'object' ? data.detail.message : data.detail)
      || data.message
      || `HTTP ${resp.status}`;
    throw new Error(errMsg);
  }

  return data;
}

function broadcast(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {
    // Popup kapalı — sessizce yut
  });
}

function normalizeUrl(url) {
  return url.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
}

function chromeGet(keys) {
  return new Promise(resolve => chrome.storage.local.get(keys, resolve));
}

function chromeSet(data) {
  return new Promise(resolve => chrome.storage.local.set(data, resolve));
}

function chromeRemove(keys) {
  return new Promise(resolve => chrome.storage.local.remove(keys, resolve));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

