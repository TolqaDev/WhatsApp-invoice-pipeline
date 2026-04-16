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
    this.waBaseUrl = '';
    this.apiKey = '';
    this._pendingRequests = new Map();
  }

  /* Chrome Storage — tüm ayarlar chrome.storage.local'da kalıcı saklanır */
  async init() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['apiUrl', 'waUrl', 'apiKey'], (data) => {
        this.baseUrl = (data.apiUrl || 'http://localhost:3000').replace(/\/v1\/?$/, '').replace(/\/+$/, '');
        this.waBaseUrl = (data.waUrl || 'http://localhost:3001').replace(/\/+$/, '');
        this.apiKey = data.apiKey || '';

        // Tek seferlik migration: session → local
        if (!data.apiKey && chrome.storage.session) {
          chrome.storage.session.get(['apiKey'], (session) => {
            if (session.apiKey) {
              this.apiKey = session.apiKey;
              chrome.storage.local.set({ apiKey: session.apiKey });
              chrome.storage.session.remove(['apiKey']);
            }
            resolve();
          });
        } else {
          resolve();
        }
      });
    });
  }

  async saveSettings(url, waUrl, key) {
    const normalizedUrl = url.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
    const normalizedWaUrl = waUrl.replace(/\/+$/, '');
    return new Promise((resolve) => {
      chrome.storage.local.set({
        apiUrl: normalizedUrl,
        waUrl: normalizedWaUrl,
        apiKey: key
      }, () => {
        this.baseUrl = normalizedUrl;
        this.waBaseUrl = normalizedWaUrl;
        this.apiKey = key;
        resolve();
      });
    });
  }

  async getSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['apiUrl', 'waUrl', 'apiKey'], (data) => {
        resolve({
          apiUrl: (data.apiUrl || 'http://localhost:3000').replace(/\/v1\/?$/, '').replace(/\/+$/, ''),
          waUrl: (data.waUrl || 'http://localhost:3001').replace(/\/+$/, ''),
          apiKey: data.apiKey || ''
        });
      });
    });
  }

  /* HTTP İstek */
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

  /* Health & Monitoring */
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

  /* Process */
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

  /* Sorgular */
  async getRecentQueries(limit = 20) {
    return this.request(`/recent-queries?limit=${limit}`);
  }

  async getErrors(limit = 50) {
    return this.request(`/errors?limit=${limit}`);
  }

  async updateQueryRow(requestId, data) {
    return this.request(`/update-row/${requestId}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteQueryRow(requestId) {
    return this.request(`/delete-row/${requestId}`, {
      method: 'DELETE',
    });
  }

  /* Bildirimler */
  async getNotifications() {
    return this.request('/notifications');
  }

  async dismissNotification(notificationId = null) {
    return this.request('/notifications/dismiss', {
      method: 'POST',
      body: JSON.stringify({ notification_id: notificationId }),
    });
  }

  /* Terminal */
  startTerminalStream(onLog, onOpen, onError) {
    this.stopTerminalStream();

    let url = `${this.baseUrl}/v1/terminal/stream`;
    if (this.apiKey) {
      url += `?api_key=${encodeURIComponent(this.apiKey)}`;
    }

    try {
      this.terminalEventSource = new EventSource(url);
    } catch (e) {
      console.error('Failed to create terminal EventSource:', e);
      if (onError) onError(new Error('Sunucuya bağlanılamadı'));
      return;
    }

    let terminalHasReceived = false;
    let terminalErrorCount = 0;
    const maxTerminalErrors = 3;

    this.terminalEventSource.onopen = () => {
      console.log('Terminal stream connected');
      terminalHasReceived = true;
      terminalErrorCount = 0;
      if (onOpen) onOpen();
    };

    this.terminalEventSource.onmessage = (event) => {
      terminalHasReceived = true;
      terminalErrorCount = 0;
      try {
        const data = JSON.parse(event.data);
        if (onLog) onLog(data);
      } catch (e) {
        console.error('Terminal SSE parse error:', e);
      }
    };

    this.terminalEventSource.onerror = (error) => {
      console.error('Terminal SSE error:', error);
      terminalErrorCount++;

      if (!terminalHasReceived || terminalErrorCount > maxTerminalErrors) {
        console.error('Terminal stream failed: server unreachable or too many errors');
        this.stopTerminalStream();
        if (onError) onError(new Error('Terminal stream bağlantısı kesildi'));
        return;
      }

      if (onError) onError(error);
    };
  }

  stopTerminalStream() {
    if (this.terminalEventSource) {
      this.terminalEventSource.close();
      this.terminalEventSource = null;
    }
  }

  async clearTerminalLogs() {
    return this.request('/terminal/logs', { method: 'DELETE' });
  }

  /* Export */
  async getDailyFiles() {
    return this.request('/daily-files');
  }

  async exportExcel(dateStr = null, format = 'xlsx') {
    let endpoint = '/export';
    const params = [];
    if (dateStr) params.push(`date=${dateStr}`);
    if (format && format !== 'xlsx') params.push(`format=${format}`);
    if (params.length) endpoint += '?' + params.join('&');
    return this.request(endpoint, { responseType: 'blob' });
  }

  async exportAll(format = 'xlsx') {
    const endpoint = format && format !== 'xlsx' ? `/export-all?format=${format}` : '/export-all';
    return this.request(endpoint, { responseType: 'blob' });
  }

  /* Ayarlar (Settings) */
  async getGeminiConfig() {
    return this.request('/settings/gemini');
  }

  async updateGeminiConfig(apiKey, monthlyBudgetTl = null, usdTlRate = null, model = null) {
    const payload = {};
    if (apiKey) payload.api_key = apiKey;
    if (monthlyBudgetTl !== null) payload.monthly_budget_tl = monthlyBudgetTl;
    if (usdTlRate !== null) payload.usd_tl_rate = usdTlRate;
    if (model !== null) payload.model = model;
    return this.request('/settings/gemini', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  }

  async getAllowedJids() {
    return this.request('/settings/jids');
  }

  async updateAllowedJids(jids) {
    return this.request('/settings/jids', {
      method: 'PUT',
      body: JSON.stringify({ jids }),
    });
  }

  /* WhatsApp Bridge */
  async waRequest(path, options = {}) {
    const url = `${this.waBaseUrl}${path}`;
    const timeout = options.timeout || 10000;
    const headers = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = await response.json();
      if (!response.ok) {
        const error = new Error(data.message || data.error || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') throw new Error('WhatsApp köprüsü zaman aşımına uğradı.');
      if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
        throw new Error('WhatsApp köprüsüne bağlanılamadı. Adres ve portu kontrol edin.');
      }
      throw error;
    }
  }

  async getWhatsAppStatus() {
    return this.waRequest('/status');
  }

  async getWhatsAppQR() {
    return this.waRequest('/qr');
  }

  async whatsAppLogout() {
    return this.waRequest('/logout', { method: 'POST', timeout: 15000 });
  }

  async whatsAppRestart() {
    return this.waRequest('/restart', { method: 'POST', timeout: 15000 });
  }
}

const api = new FaturaAPI();

