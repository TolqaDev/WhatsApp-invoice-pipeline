/**
 * Fatura Bot API — Chrome Extension API Client
 * Tüm endpoint'ler /v1 prefix altında çalışır.
 */
class FaturaAPI {
  static CONFIG = {
    DEFAULT_TIMEOUT: 60000,   // process-image uzun sürebilir
    STATUS_CACHE_TTL: 5000,
  };

  constructor() {
    this.baseUrl = '';
    this.apiKey = '';
    this._pendingRequests = new Map();
  }

  /* ─── Chrome Storage ─────────────────────────────── */
  async init() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['apiUrl', 'apiKey'], (result) => {
        this.baseUrl = (result.apiUrl || 'http://localhost:3000').replace(/\/v1\/?$/, '').replace(/\/+$/, '');
        this.apiKey = result.apiKey || '';
        resolve();
      });
    });
  }

  async saveSettings(url, key) {
    const normalizedUrl = url.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
    return new Promise((resolve) => {
      chrome.storage.local.set({ apiUrl: normalizedUrl, apiKey: key }, () => {
        this.baseUrl = normalizedUrl;
        this.apiKey = key;
        resolve();
      });
    });
  }

  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['apiUrl', 'apiKey'], (result) => {
        resolve({
          apiUrl: (result.apiUrl || 'http://localhost:3000').replace(/\/v1\/?$/, '').replace(/\/+$/, ''),
          apiKey: result.apiKey || ''
        });
      });
    });
  }

  /* ─── HTTP İstek ───────────────────────────────── */
  async request(endpoint, options = {}) {
    const url = `${this.baseUrl}/v1${endpoint}`;
    const timeout = options.timeout || FaturaAPI.CONFIG.DEFAULT_TIMEOUT;
    const cacheKey = options.method === 'GET' ? `${options.method || 'GET'}:${url}` : null;

    if (cacheKey && this._pendingRequests.has(cacheKey)) {
      return this._pendingRequests.get(cacheKey);
    }

    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const requestPromise = (async () => {
      try {
        const response = await fetch(url, {
          ...options,
          headers,
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        // Export endpoint'leri blob döndürebilir
        if (options.responseType === 'blob') {
          if (!response.ok) {
            const text = await response.text();
            let errMsg;
            try { errMsg = JSON.parse(text).detail || text; } catch { errMsg = text; }
            const error = new Error(errMsg);
            error.status = response.status;
            throw error;
          }
          return response;
        }

        const data = await response.json();

        if (!response.ok) {
          const error = new Error(data.detail?.message || data.detail || data.message || `HTTP ${response.status}`);
          error.status = response.status;
          error.data = data;
          throw error;
        }

        return data;
      } catch (error) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
          throw new Error('İstek zaman aşımına uğradı. Lütfen tekrar deneyin.');
        }
        if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
          throw new Error('API bağlantısı kurulamadı. URL ve ağ ayarlarınızı kontrol edin.');
        }
        throw error;
      } finally {
        if (cacheKey) {
          this._pendingRequests.delete(cacheKey);
        }
      }
    })();

    if (cacheKey) {
      this._pendingRequests.set(cacheKey, requestPromise);
    }

    return requestPromise;
  }

  /* ─── Health & Monitoring ────────────────────────── */
  async getHealth() {
    return this.request('/health');
  }

  async getStats() {
    return this.request('/stats');
  }

  async getBudget() {
    return this.request('/budget');
  }

  async getQueueStatus() {
    return this.request('/queue-status');
  }

  /* ─── Process ────────────────────────────────────── */
  async processImage(imageBase64, mimeType, sender = 'chrome-extension', requestId = null) {
    const payload = {
      image_base64: imageBase64,
      mime_type: mimeType,
      sender: sender,
    };
    if (requestId) {
      payload.request_id = requestId;
    }
    return this.request('/process-image', {
      method: 'POST',
      body: JSON.stringify(payload),
      timeout: 120000,  // 2 dakika — Gemini uzun sürebilir
    });
  }

  /* ─── Sorgular ───────────────────────────────────── */
  async getRecentQueries(limit = 20) {
    return this.request(`/recent-queries?limit=${limit}`);
  }

  async updateQueryRow(requestId, data) {
    return this.request(`/update-row/${requestId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  /* ─── Export ─────────────────────────────────────── */
  async getDailyFiles() {
    return this.request('/daily-files');
  }

  async exportExcel(dateStr = null) {
    const endpoint = dateStr ? `/export?date=${dateStr}` : '/export';
    return this.request(endpoint, { responseType: 'blob' });
  }

  async exportAll() {
    return this.request('/export-all', { responseType: 'blob' });
  }
}

const api = new FaturaAPI();

