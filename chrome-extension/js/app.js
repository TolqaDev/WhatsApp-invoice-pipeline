/**
 * Fatura Bot Manager — Ana Uygulama
 */
class FaturaBotApp {
  constructor() {
    this.state = {
      apiReady: false,
      currentTab: 'dashboard',
      selectedFiles: [],
      isProcessing: false,
      waPollingInterval: null,
      waConnection: 'disconnected',
      notificationPollingInterval: null,
    };
  }

  /* BAŞLATMA */
  async init() {
    try {
      await api.init();
      await this.loadTheme();
      this.setupEventListeners();
      this.setupQueueListener();
      utils.initTooltips();
      await this.loadSettings();

      try {
        await api.getHealth();
        this.state.apiReady = true;
        this.updateConnectionUI(true);
        this.loadDashboardData();
        this.startNotificationPolling();
        this.startConnectionWatchdog();
      } catch (e) {
        console.error('İlk bağlantı başarısız:', e);
        this.state.apiReady = false;
        this.updateConnectionUI(false);
        this.showDisconnectionOverlay(true);
        setTimeout(() => this.openApiModal(), 600);
      }

      // Popup yeniden açıldığında aktif/tamamlanmış kuyruğu kontrol et
      await this.checkPendingQueue();

      this.hideLoadingScreen();
    } catch (error) {
      console.error('Başlatma hatası:', error);
      this.updateLoadingStatus('Bağlantı hatası');
      setTimeout(() => {
        this.hideLoadingScreen();
        this.state.apiReady = false;
        this.updateConnectionUI(false);
        setTimeout(() => this.openApiModal(), 300);
      }, 1500);
    }
  }

  hideLoadingScreen() {
    const loading = document.getElementById('loading-screen');
    const app = document.getElementById('app');
    loading.classList.add('fade-out');
    app.classList.remove('hidden');
    setTimeout(() => loading.style.display = 'none', 300);
  }

  updateLoadingStatus(text) {
    const el = document.querySelector('.loading-status');
    if (el) el.textContent = text;
  }

  async loadSettings() {
    const settings = await api.getSettings();
    document.getElementById('api-url').value = settings.apiUrl;
    document.getElementById('wa-url').value = settings.waUrl;
    document.getElementById('api-key').value = settings.apiKey;
  }

  /* TEMA */
  async loadTheme() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['theme'], (result) => {
        const theme = result.theme || 'dark';
        document.documentElement.setAttribute('data-theme', theme);
        this.updateThemeIcon(theme);
        resolve();
      });
    });
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    chrome.storage.local.set({ theme: next });
    this.updateThemeIcon(next);
  }

  updateThemeIcon(theme) {
    const icon = document.querySelector('#theme-toggle i');
    if (icon) icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
  }

  /* BAĞLANTI DURUMU */
  updateConnectionUI(connected) {
    const badge = document.getElementById('connection-status');
    const badgeText = badge.querySelector('.badge-text');
    badge.classList.remove('connected', 'disconnected');

    // Sidebar menü öğelerini kontrol et
    document.querySelectorAll('.sidebar-nav-item[data-tab]').forEach(item => {
      if (item.dataset.tab === 'dashboard') return; // Panel her zaman aktif
      if (connected) {
        item.classList.remove('disabled');
      } else {
        item.classList.add('disabled');
      }
    });

    // Content area blur
    const contentArea = document.querySelector('.content-area');
    if (contentArea) {
      if (connected) {
        contentArea.classList.remove('disconnected');
      } else {
        contentArea.classList.add('disconnected');
      }
    }

    if (connected) {
      badge.classList.add('connected');
      badgeText.textContent = 'Bağlı';
    } else {
      badge.classList.add('disconnected');
      badgeText.textContent = 'Bağlı Değil';
    }
  }

  /* OLAY DİNLEYİCİLERİ */
  setupEventListeners() {
    // Kenar çubuğu
    document.querySelectorAll('.sidebar-nav-item[data-tab]').forEach(item => {
      item.addEventListener('click', () => this.switchTab(item.dataset.tab));
    });

    // Tema
    document.getElementById('theme-toggle')?.addEventListener('click', () => this.toggleTheme());

    // Sunucu ayarları modalı
    document.getElementById('sidebar-api-settings')?.addEventListener('click', () => this.openApiModal());
    document.getElementById('api-modal-close')?.addEventListener('click', () => this.closeApiModal());
    document.getElementById('api-modal-backdrop')?.addEventListener('click', () => this.closeApiModal());
    document.getElementById('save-settings')?.addEventListener('click', () => this.saveSettings());
    document.getElementById('test-connection')?.addEventListener('click', () => this.testConnection());
    document.getElementById('toggle-api-key')?.addEventListener('click', () => this.toggleApiKeyVisibility());

    // Panel yenile
    document.getElementById('refresh-dashboard')?.addEventListener('click', () => this.loadDashboardData());
    document.getElementById('refresh-budget')?.addEventListener('click', () => this.loadBudget());
    document.getElementById('refresh-health')?.addEventListener('click', () => this.loadHealth());

    // Dashboard stat widget tıklama
    document.querySelectorAll('.dash-stat-widget[data-stat]').forEach(widget => {
      widget.addEventListener('click', () => this.onStatWidgetClick(widget.dataset.stat));
    });

    // Hata detay modal kapat
    document.getElementById('error-detail-modal-close')?.addEventListener('click', () => this.closeErrorDetailModal());
    document.getElementById('error-detail-backdrop')?.addEventListener('click', () => this.closeErrorDetailModal());

    // Fiş İşle
    this.setupProcessListeners();

    // Sorgular
    document.getElementById('refresh-queries')?.addEventListener('click', () => this.loadQueries());
    document.getElementById('queries-search')?.addEventListener('input',
      utils.debounce(() => this.filterQueries(), 300)
    );
    document.getElementById('queries-date-from')?.addEventListener('change', () => this.filterQueries());
    document.getElementById('queries-date-to')?.addEventListener('change', () => this.filterQueries());

    // Detay popup kapat
    document.getElementById('detail-modal-close')?.addEventListener('click', () => this.closeDetailModal());
    document.getElementById('detail-backdrop')?.addEventListener('click', () => this.closeDetailModal());

    // Dışa Aktar — dropdown toggle
    document.getElementById('export-today-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleExportDropdown('export-today-btn', 'export-today-dropdown');
    });
    document.getElementById('export-all-btn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleExportDropdown('export-all-btn', 'export-all-dropdown');
    });

    // Dropdown format seçimleri
    document.getElementById('export-today-dropdown')?.addEventListener('click', (e) => {
      const item = e.target.closest('.export-dropdown-item');
      if (item) { this.exportToday(item.dataset.format); this.closeAllExportDropdowns(); }
    });
    document.getElementById('export-all-dropdown')?.addEventListener('click', (e) => {
      const item = e.target.closest('.export-dropdown-item');
      if (item) { this.exportAllCombined(item.dataset.format); this.closeAllExportDropdowns(); }
    });

    // Dışarı tıklanınca dropdown'ları kapat
    document.addEventListener('click', () => this.closeAllExportDropdowns());

    document.getElementById('export-date-btn')?.addEventListener('click', () => this.exportByDate());
    document.getElementById('refresh-files')?.addEventListener('click', () => this.loadDailyFiles());

    // WhatsApp
    document.getElementById('wa-refresh-status')?.addEventListener('click', () => this.loadWhatsAppTab());
    document.getElementById('wa-restart-btn')?.addEventListener('click', () => this.whatsAppRestart());
    document.getElementById('wa-logout-btn')?.addEventListener('click', () => this.whatsAppLogout());

    // WhatsApp JID yönetimi
    document.getElementById('wa-jid-add-btn')?.addEventListener('click', () => this.addJid());
    document.getElementById('wa-jid-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.addJid();
    });
    // JID kartı accordion toggle
    document.getElementById('wa-jid-toggle')?.addEventListener('click', () => this.toggleJidCard());
    // QR kartı accordion toggle
    document.getElementById('wa-qr-toggle')?.addEventListener('click', () => this.toggleQrCard());

    // Settings modal tabs
    document.querySelectorAll('#settings-modal-tabs .modal-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchSettingsTab(tab.dataset.settingsTab));
    });

    // Gemini ayarları
    document.getElementById('toggle-gemini-key')?.addEventListener('click', () => this.toggleGeminiKeyVisibility());
    document.getElementById('test-gemini')?.addEventListener('click', () => this.testGeminiConfig());
    document.getElementById('save-gemini')?.addEventListener('click', () => this.saveGeminiConfig());

    // Terminal
    document.getElementById('open-terminal-btn')?.addEventListener('click', () => this.openTerminalPopup());
    document.getElementById('terminal-close-btn')?.addEventListener('click', () => this.closeTerminalPopup());
    document.getElementById('terminal-clear-btn')?.addEventListener('click', () => this.clearTerminalOutput());
    document.getElementById('terminal-scroll-btn')?.addEventListener('click', () => {
      const output = document.getElementById('terminal-output');
      if (output) { output.scrollTop = output.scrollHeight; this._terminalAutoScroll = true; }
    });

    // Bildirim banner
    document.getElementById('notification-banner-close')?.addEventListener('click', () => this.dismissNotifications());
  }
  setupProcessListeners() {
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    // Sürükle-bırak alanı tıklama
    dropZone?.addEventListener('click', (e) => {
      if (e.target.closest('#clear-image') || e.target.closest('.preview-remove') || e.target.closest('.drop-zone-preview')) return;
      if (this.state.selectedFiles.length === 0) fileInput.click();
    });

    // Sürükle-bırak
    dropZone?.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone?.addEventListener('dragleave', () => { dropZone.classList.remove('drag-over'); });
    dropZone?.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (files.length) this.addSelectedFiles(files);
    });

    // Dosya seçimi (çoklu)
    fileInput?.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (files.length) this.addSelectedFiles(files);
    });

    // Temizle
    document.getElementById('clear-image')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.clearSelectedFiles();
    });

    // İşle butonu
    document.getElementById('process-btn')?.addEventListener('click', () => this.processQueue());
  }

  /* SEKME GEÇİŞİ */
  switchTab(tabId) {
    if (!this.state.apiReady && tabId !== 'dashboard') {
      utils.toast('Önce sunucu bağlantısını yapılandırın', 'warning');
      return;
    }

    document.querySelectorAll('.sidebar-nav-item[data-tab]').forEach(item => {
      item.classList.toggle('active', item.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-content').forEach(tab => {
      tab.classList.toggle('active', tab.id === `tab-${tabId}`);
    });

    const titles = { 'dashboard': 'Kontrol Paneli', 'process': 'Fiş İşle', 'queries': 'Son Sorgular', 'export': 'Dışa Aktar', 'whatsapp': 'WhatsApp' };
    document.getElementById('page-title').textContent = titles[tabId] || tabId;
    this.state.currentTab = tabId;

    // WhatsApp polling yönetimi
    if (tabId === 'whatsapp') {
      this.startWhatsAppPolling();
    } else {
      this.stopWhatsAppPolling();
    }

    switch (tabId) {
      case 'dashboard': this.loadDashboardData(); break;
      case 'queries': this.loadQueries(); break;
      case 'export': this.loadDailyFiles(); break;
      case 'whatsapp': this.loadWhatsAppTab(); break;
    }
  }

  /* SUNUCU AYARLARI MODALI */
  openApiModal() {
    const modal = document.getElementById('api-modal');
    const backdrop = document.getElementById('api-modal-backdrop');
    const closeBtn = document.getElementById('api-modal-close');

    // Bağlantı yokken close butonunu gizle
    if (!this.state.apiReady) {
      closeBtn.style.display = 'none';
    } else {
      closeBtn.style.display = '';
    }

    backdrop.classList.remove('hidden');
    modal.classList.remove('hidden');
    setTimeout(() => { backdrop.classList.add('visible'); modal.classList.add('visible'); }, 10);
    this.updateApiModalStatus();
  }

  closeApiModal() {
    // Bağlantı yokken modal kapatılamaz
    if (!this.state.apiReady) {
      utils.toast('Önce sunucu bağlantısını yapılandırın', 'warning');
      return;
    }
    const modal = document.getElementById('api-modal');
    const backdrop = document.getElementById('api-modal-backdrop');
    modal.classList.remove('visible');
    backdrop.classList.remove('visible');
    setTimeout(() => { modal.classList.add('hidden'); backdrop.classList.add('hidden'); }, 300);
  }

  toggleApiKeyVisibility() {
    const input = document.getElementById('api-key');
    const icon = document.querySelector('#toggle-api-key i');
    if (input.type === 'password') { input.type = 'text'; icon.className = 'fas fa-eye-slash'; }
    else { input.type = 'password'; icon.className = 'fas fa-eye'; }
  }

  updateApiModalStatus() {
    const dot = document.getElementById('api-modal-status-dot');
    const text = document.getElementById('api-modal-status-text');
    if (this.state.apiReady) {
      dot.className = 'api-modal-status-dot connected';
      text.textContent = 'Sunucuya bağlı';
    } else {
      dot.className = 'api-modal-status-dot error';
      text.textContent = 'Bağlantı yok';
    }
  }

  async testConnection() {
    const url = document.getElementById('api-url').value.trim();
    const waUrl = document.getElementById('wa-url').value.trim();
    const key = document.getElementById('api-key').value.trim();
    if (!url) { utils.toast('Python API adresi girin', 'warning'); return; }

    utils.setLoading('test-connection', true, 'Test ediliyor...');
    try {
      const normalizedUrl = url.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
      const headers = { 'Content-Type': 'application/json' };
      if (key) headers['X-API-Key'] = key;

      const response = await fetch(`${normalizedUrl}/v1/health`, { headers, signal: AbortSignal.timeout(10000) });
      const data = await response.json();

      if (data.status !== 'healthy') {
        utils.toast('Python API yanıt verdi ama durum sağlıklı değil', 'warning');
        return;
      }

      let waOk = false;
      if (waUrl) {
        try {
          const normalizedWaUrl = waUrl.replace(/\/+$/, '');
          const waHeaders = { 'Content-Type': 'application/json' };
          if (key) waHeaders['X-API-Key'] = key;
          const waResp = await fetch(`${normalizedWaUrl}/status`, { headers: waHeaders, signal: AbortSignal.timeout(5000) });
          if (waResp.ok) waOk = true;
        } catch { /* bridge kapalı olabilir  */ }
      }

      await api.saveSettings(url, waUrl || 'http://localhost:3001', key);
      this.state.apiReady = true;
      this.updateConnectionUI(true);
      this.updateApiModalStatus();
      const closeBtn = document.getElementById('api-modal-close');
      if (closeBtn) closeBtn.style.display = '';

      const waMsg = waOk ? ' · WP köprüsü ✓' : (waUrl ? ' · WP köprüsü ✗' : '');
      utils.toast(`Python API bağlı! v${data.version}${waMsg}`, 'success');
      this.showDisconnectionOverlay(false);
      this.startConnectionWatchdog();
      this.closeApiModal();
      this.loadDashboardData();
      this.startNotificationPolling();
    } catch (e) {
      utils.toast('Bağlantı başarısız: ' + e.message, 'error');
    } finally {
      utils.setLoading('test-connection', false);
    }
  }

  async saveSettings() {
    const url = document.getElementById('api-url').value.trim();
    const waUrl = document.getElementById('wa-url').value.trim() || 'http://localhost:3001';
    const key = document.getElementById('api-key').value.trim();
    if (!url) { utils.toast('Python API adresi gerekli', 'warning'); return; }

    utils.setLoading('save-settings', true, 'Kaydediliyor...');
    try {
      await api.saveSettings(url, waUrl, key);
      await api.getHealth();
      this.state.apiReady = true;
      this.updateConnectionUI(true);
      this.updateApiModalStatus();
      const closeBtn = document.getElementById('api-modal-close');
      if (closeBtn) closeBtn.style.display = '';
      utils.toast('Ayarlar kaydedildi ve bağlantı kuruldu!', 'success');
      this.showDisconnectionOverlay(false);
      this.startConnectionWatchdog();
      this.closeApiModal();
      this.loadDashboardData();
      this.startNotificationPolling();
    } catch (e) {
      utils.toast('Kaydedildi ama bağlantı kurulamadı: ' + e.message, 'warning');
      this.state.apiReady = false;
      this.updateConnectionUI(false);
      this.updateApiModalStatus();
    } finally {
      utils.setLoading('save-settings', false);
    }
  }

  /* AYARLAR MODAL TAB GEÇİŞİ */
  switchSettingsTab(tabId) {
    document.querySelectorAll('#settings-modal-tabs .modal-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.settingsTab === tabId);
    });
    document.querySelectorAll('#api-modal .modal-tab-content').forEach(c => {
      c.classList.toggle('active', c.dataset.settingsContent === tabId);
    });
    if (tabId === 'gemini') this.loadGeminiConfig();
  }

  /* GEMİNİ AYARLARI */
  async loadGeminiConfig() {
    const dot = document.getElementById('gemini-status-dot');
    const text = document.getElementById('gemini-status-text');
    const info = document.getElementById('gemini-info');
    const modelSelect = document.getElementById('gemini-model');
    try {
      const data = await api.getGeminiConfig();

      // Model dropdown'ını doldur
      if (data.available_models && modelSelect) {
        const currentModel = data.model || 'gemini-2.5-flash';
        modelSelect.innerHTML = Object.entries(data.available_models).map(([id, m]) => {
          const priceLabel = `Giriş: $${m.input}/M · Çıkış: $${m.output}/M`;
          const selected = id === currentModel ? 'selected' : '';
          return `<option value="${id}" ${selected}>${utils.escapeHtml(m.label)} — ${m.tier} (${priceLabel})</option>`;
        }).join('');
      }

      if (data.active) {
        dot.className = 'api-modal-status-dot connected';
        text.textContent = `Gemini aktif — ${data.model || 'bilinmeyen model'}`;
      } else {
        dot.className = 'api-modal-status-dot error';
        text.textContent = 'Gemini yapılandırılmamış';
      }
      // Mevcut bütçe ve kur bilgisini göster
      if (data.monthly_budget_tl) {
        document.getElementById('gemini-budget').value = data.monthly_budget_tl;
      }
      if (data.usd_tl_rate) {
        document.getElementById('gemini-usd-rate').value = data.usd_tl_rate;
      }
      // Bilgi satırları
      if (data.active) {
        info.innerHTML = `
          <div class="gemini-info-row"><i class="fas fa-robot"></i><span>Model</span><strong>${utils.escapeHtml(data.model || '-')}</strong></div>
          <div class="gemini-info-row"><i class="fas fa-coins"></i><span>Ay Harcama</span><strong>${utils.formatCurrency(data.month_cost_tl || 0)}</strong></div>
          <div class="gemini-info-row"><i class="fas fa-wallet"></i><span>Kalan Bütçe</span><strong>${utils.formatCurrency(data.remaining_tl || 0)}</strong></div>
          <div class="gemini-info-row"><i class="fas fa-receipt"></i><span>Ay İşlem</span><strong>${data.month_count || 0} fiş</strong></div>
        `;
      } else {
        info.innerHTML = '';
      }
    } catch (e) {
      dot.className = 'api-modal-status-dot error';
      text.textContent = 'Gemini durumu alınamadı';
      info.innerHTML = '';
    }
  }

  toggleGeminiKeyVisibility() {
    const input = document.getElementById('gemini-api-key');
    const icon = document.querySelector('#toggle-gemini-key i');
    if (input.type === 'password') { input.type = 'text'; icon.className = 'fas fa-eye-slash'; }
    else { input.type = 'password'; icon.className = 'fas fa-eye'; }
  }

  async testGeminiConfig() {
    const apiKey = document.getElementById('gemini-api-key').value.trim();
    const budget = parseFloat(document.getElementById('gemini-budget').value) || 200;
    const rate = parseFloat(document.getElementById('gemini-usd-rate').value) || 45;
    const model = document.getElementById('gemini-model')?.value || null;

    // API key zorunlu değil — zaten aktifse sadece ayar güncellenebilir
    if (apiKey && apiKey.length < 10) {
      utils.toast('Geçerli bir Gemini API anahtarı girin (en az 10 karakter)', 'warning');
      return;
    }

    utils.setLoading('test-gemini', true, 'Test ediliyor...');
    try {
      const result = await api.updateGeminiConfig(apiKey || null, budget, rate, model);
      if (result.success) {
        utils.toast(`Gemini bağlandı! Model: ${result.model}`, 'success');
        this.loadGeminiConfig();
      } else {
        utils.toast('Gemini yapılandırma başarısız', 'error');
      }
    } catch (e) {
      utils.toast('Gemini test hatası: ' + e.message, 'error');
    } finally {
      utils.setLoading('test-gemini', false);
    }
  }

  async saveGeminiConfig() {
    const apiKey = document.getElementById('gemini-api-key').value.trim();
    const budget = parseFloat(document.getElementById('gemini-budget').value) || 200;
    const rate = parseFloat(document.getElementById('gemini-usd-rate').value) || 45;
    const model = document.getElementById('gemini-model')?.value || null;

    // API key zorunlu değil — zaten aktifse sadece ayar güncellenebilir
    if (apiKey && apiKey.length < 10) {
      utils.toast('Geçerli bir Gemini API anahtarı girin (en az 10 karakter)', 'warning');
      return;
    }

    utils.setLoading('save-gemini', true, 'Kaydediliyor...');
    try {
      const result = await api.updateGeminiConfig(apiKey || null, budget, rate, model);
      if (result.success) {
        utils.toast('Gemini ayarları kaydedildi!', 'success');
        this.loadGeminiConfig();
      } else {
        utils.toast('Gemini kaydetme başarısız', 'error');
      }
    } catch (e) {
      utils.toast('Gemini kaydetme hatası: ' + e.message, 'error');
    } finally {
      utils.setLoading('save-gemini', false);
    }
  }

  /* PANEL */
  async loadDashboardData() {
    if (!this.state.apiReady) return;
    await Promise.allSettled([
      this.loadHealth(),
      this.loadStats(),
      this.loadBudget(),
      this.loadQueueStatus(),
    ]);
  }

  async loadHealth() {
    try {
      const data = await api.getHealth();
      document.getElementById('sys-uptime').textContent = utils.formatUptime(data.uptime_seconds);
      document.getElementById('stat-excel-rows').textContent = data.excel_row_count;
      const healthBadge = document.getElementById('sys-health');
      healthBadge.textContent = data.status === 'healthy' ? 'Sağlıklı' : 'Sorunlu';
      healthBadge.className = `system-health-badge ${data.status === 'healthy' ? 'healthy' : 'degraded'}`;
    } catch (e) { console.error('Sağlık verisi hatası:', e); }
  }

  async loadStats() {
    try {
      const data = await api.getStats();
      document.getElementById('stat-total-processed').textContent = data.total_processed;
      document.getElementById('stat-today-processed').textContent = data.today_processed;
      document.getElementById('stat-total-errors').textContent = data.total_errors;
      document.getElementById('stat-avg-confidence').textContent = data.average_confidence + '%';
      document.getElementById('stat-avg-processing').textContent = Math.round(data.average_processing_ms) + 'ms';
      document.getElementById('stat-ocr-confirmed').textContent = data.prefilter_confirmed;
      document.getElementById('stat-ocr-uncertain').textContent = data.prefilter_uncertain;
      document.getElementById('stat-ocr-rejected').textContent = data.prefilter_rejected;
      document.getElementById('stat-ocr-bypassed').textContent = data.prefilter_bypassed;
      this.renderTopStores(data.top_stores || []);
    } catch (e) { console.error('İstatistik hatası:', e); }
  }

  renderTopStores(stores) {
    const container = document.getElementById('top-stores-list');
    if (!stores.length) {
      container.innerHTML = '<div class="status-empty"><i class="fas fa-store"></i><span>Henüz veri yok</span></div>';
      return;
    }
    container.innerHTML = stores.map((name, i) => `
      <div class="top-store-item"><span class="top-store-rank">${i + 1}</span><span class="top-store-name">${utils.escapeHtml(name)}</span></div>
    `).join('');
  }

  /* STAT WIDGET TIKLAMA */
  onStatWidgetClick(statType) {
    switch (statType) {
      case 'total':
        this.switchTab('queries');
        break;
      case 'today':
        this.switchTab('queries');
        // Tarih filtresini bugüne ayarla
        setTimeout(() => {
          const today = new Date().toISOString().split('T')[0];
          const fromEl = document.getElementById('queries-date-from');
          const toEl = document.getElementById('queries-date-to');
          if (fromEl) fromEl.value = today;
          if (toEl) toEl.value = today;
          this.filterQueries();
        }, 200);
        break;
      case 'errors':
        this.openErrorDetailModal();
        break;
      case 'excel':
        this.switchTab('export');
        break;
    }
  }

  /* HATA DETAY MODALI */
  async openErrorDetailModal() {
    const modal = document.getElementById('error-detail-modal');
    const backdrop = document.getElementById('error-detail-backdrop');
    const body = document.getElementById('error-detail-modal-body');

    body.innerHTML = '<div class="error-list-loading"><i class="fas fa-spinner fa-spin"></i> Yükleniyor...</div>';
    backdrop.classList.remove('hidden');
    modal.classList.remove('hidden');
    setTimeout(() => { backdrop.classList.add('visible'); modal.classList.add('visible'); }, 10);

    try {
      const data = await api.getErrors(50);
      this.renderErrorList(data);
    } catch (e) {
      body.innerHTML = `<div class="error-list-empty"><i class="fas fa-exclamation-circle"></i><p>Hatalar yüklenemedi: ${utils.escapeHtml(e.message)}</p></div>`;
    }
  }

  renderErrorList(data) {
    const body = document.getElementById('error-detail-modal-body');
    const errors = data.errors || [];

    if (!errors.length) {
      body.innerHTML = '<div class="error-list-empty"><i class="fas fa-check-circle" style="color:var(--success)"></i><p>Hiç hata kaydı yok!</p></div>';
      return;
    }

    const summary = `<div class="error-summary">
      <span class="error-summary-item"><i class="fas fa-exclamation-triangle"></i> Toplam: <strong>${data.total}</strong></span>
      <span class="error-summary-item"><i class="fas fa-calendar-day"></i> Bugün: <strong>${data.today_count}</strong></span>
    </div>`;

    const errorCodeLabels = {
      'NOT_A_RECEIPT': { label: 'Fiş Değil', cls: 'warn' },
      'BUDGET_EXCEEDED': { label: 'Bütçe Doldu', cls: 'critical' },
      'RATE_LIMITED': { label: 'Rate Limit', cls: 'warn' },
      'GEMINI_UNAVAILABLE': { label: 'AI Erişilemez', cls: 'critical' },
      'INTERNAL_ERROR': { label: 'Sunucu Hatası', cls: 'critical' },
      'IMAGE_TOO_LARGE': { label: 'Büyük Görsel', cls: 'warn' },
      'INVALID_BASE64': { label: 'Geçersiz Veri', cls: 'warn' },
    };

    const list = errors.map(e => {
      const codeInfo = errorCodeLabels[e.error_code] || { label: e.error_code, cls: 'warn' };
      const time = e.timestamp
        ? new Date(e.timestamp).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '-';
      return `<div class="error-list-item">
        <div class="error-list-item-header">
          <span class="error-code-badge ${codeInfo.cls}">${codeInfo.label}</span>
          <span class="error-list-time"><i class="fas fa-clock"></i> ${time}</span>
        </div>
        <div class="error-list-item-msg">${utils.escapeHtml(e.message)}</div>
        ${e.sender ? `<span class="error-list-sender"><i class="fas fa-user"></i> ${utils.escapeHtml(e.sender)}</span>` : ''}
      </div>`;
    }).join('');

    body.innerHTML = summary + '<div class="error-list-scroll">' + list + '</div>';
  }

  closeErrorDetailModal() {
    const modal = document.getElementById('error-detail-modal');
    const backdrop = document.getElementById('error-detail-backdrop');
    modal.classList.remove('visible');
    backdrop.classList.remove('visible');
    setTimeout(() => { modal.classList.add('hidden'); backdrop.classList.add('hidden'); }, 300);
  }

  async loadBudget() {
    try {
      const data = await api.getBudget();
      const usagePct = data.usage_percentage || 0;
      const remaining = 100 - usagePct;
      document.getElementById('budget-ring').setAttribute('stroke-dasharray', `${remaining}, 100`);
      document.getElementById('budget-usage-pct').textContent = `${Math.round(usagePct)}%`;
      document.getElementById('budget-total').textContent = utils.formatCurrency(data.budget_tl);
      document.getElementById('budget-remaining').textContent = utils.formatCurrency(data.remaining_tl);
      document.getElementById('budget-est-receipts').textContent = `${data.estimated_remaining_receipts} fiş`;
      document.getElementById('budget-ocr-savings').textContent = utils.formatCurrency(data.ocr_savings_tl);

      const statusBadge = document.getElementById('budget-status');
      const statusMap = { 'healthy': 'Sağlıklı', 'warning': 'Uyarı', 'critical': 'Kritik', 'inactive': 'Devre Dışı' };
      statusBadge.textContent = statusMap[data.status] || data.status;
      statusBadge.className = `system-health-badge ${data.status === 'healthy' ? 'healthy' : data.status === 'warning' ? 'degraded' : 'critical'}`;

      const ring = document.getElementById('budget-ring');
      if (usagePct >= 90) ring.style.stroke = 'var(--danger)';
      else if (usagePct >= 70) ring.style.stroke = 'var(--warning)';
      else ring.style.stroke = 'var(--primary)';
    } catch (e) { console.error('Bütçe hatası:', e); }
  }

  async loadQueueStatus() {
    try {
      const data = await api.getQueueStatus();
      document.getElementById('stat-active-processing').textContent = data.active_processing;
    } catch (e) { console.error('Kuyruk hatası:', e); }
  }

  /* FİŞ İŞLE */
  addSelectedFiles(files) {
    const MAX_FILES = 10;
    const remaining = MAX_FILES - this.state.selectedFiles.length;
    if (remaining <= 0) {
      utils.toast(`En fazla ${MAX_FILES} görsel yükleyebilirsiniz`, 'warning');
      return;
    }
    const toAdd = files.slice(0, remaining);
    this.state.selectedFiles.push(...toAdd);
    if (files.length > remaining) {
      utils.toast(`${files.length - remaining} görsel atlandı (maks ${MAX_FILES})`, 'warning');
    }
    this.renderPreviewGrid();
    this.updateProcessButton();
  }

  renderPreviewGrid() {
    const preview = document.getElementById('drop-zone-preview');
    const content = document.getElementById('drop-zone-content');
    const grid = document.getElementById('preview-grid');

    if (this.state.selectedFiles.length === 0) {
      utils.show(content);
      utils.hide(preview);
      return;
    }

    utils.hide(content);
    utils.show(preview);
    preview.classList.remove('hidden');

    grid.innerHTML = this.state.selectedFiles.map((file, idx) => `
      <div class="preview-thumb" id="thumb-${idx}">
        <img src="${URL.createObjectURL(file)}" alt="${utils.escapeHtml(file.name)}">
        <button class="preview-remove" data-idx="${idx}" title="Kaldır">×</button>
      </div>
    `).join('');

    // Kaldır butonları
    grid.querySelectorAll('.preview-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.state.isProcessing) return;
        const idx = parseInt(btn.dataset.idx);
        this.state.selectedFiles.splice(idx, 1);
        this.renderPreviewGrid();
        this.updateProcessButton();
      });
    });
  }

  clearSelectedFiles() {
    this.state.selectedFiles = [];
    const fileInput = document.getElementById('file-input');
    if (fileInput) fileInput.value = '';
    utils.show('drop-zone-content');
    utils.hide('drop-zone-preview');
    utils.hide('queue-progress');

    const dropZone = document.getElementById('drop-zone');
    if (dropZone) dropZone.style.pointerEvents = '';

    this.updateProcessButton();
    chrome.storage.local.remove(['queue_meta', 'queue_items']);
  }

  updateProcessButton() {
    const btn = document.getElementById('process-btn');
    const clearBtn = document.getElementById('clear-image');
    const count = this.state.selectedFiles.length;
    btn.disabled = count === 0 || this.state.isProcessing;
    if (clearBtn) clearBtn.disabled = this.state.isProcessing;

    document.querySelectorAll('.preview-remove').forEach(removeBtn => {
      removeBtn.disabled = this.state.isProcessing;
      if (this.state.isProcessing) {
        removeBtn.style.pointerEvents = 'none';
        removeBtn.style.opacity = '0.3';
      } else {
        removeBtn.style.pointerEvents = '';
        removeBtn.style.opacity = '';
      }
    });

    if (count > 1) {
      btn.innerHTML = `<i class="fas fa-magic"></i> ${count} Fişi İşle`;
    } else {
      btn.innerHTML = `<i class="fas fa-magic"></i> Fişi İşle`;
    }
  }

  async processQueue() {
    if (this.state.isProcessing || this.state.selectedFiles.length === 0) return;

    const files = [...this.state.selectedFiles];
    this.state.isProcessing = true;
    this.updateProcessButton();
    this.showProcessing();

    const dropZone = document.getElementById('drop-zone');
    if (dropZone) dropZone.style.pointerEvents = 'none';

    // ── 1) Tüm görselleri popup'ta base64'e çevir ──
    const queueItems = [];
    const results = [];
    for (let i = 0; i < files.length; i++) {
      try {
        const base64 = await utils.fileToBase64(files[i]);
        queueItems.push({
          base64,
          mimeType: utils.getMimeFromFile(files[i]),
          fileName: files[i].name,
        });
        results.push({ status: 'pending', fileName: files[i].name, result: null, error: null });
      } catch (e) {
        queueItems.push({ base64: null, mimeType: '', fileName: files[i].name });
        results.push({ status: 'error', fileName: files[i].name, result: null, error: 'Dosya okunamadı: ' + e.message });
      }
    }

    // ── 2) Kuyruk verisini chrome.storage.local'a kaydet ──
    const queueMeta = {
      status: 'processing',
      totalCount: files.length,
      currentIndex: 0,
      startedAt: Date.now(),
      results,
    };

    await new Promise(resolve => chrome.storage.local.set({
      queue_items: queueItems,
      queue_meta: queueMeta,
    }, resolve));

    // ── 3) Progress UI göster ──
    if (files.length > 1) {
      const progressEl = document.getElementById('queue-progress');
      const fillEl = document.getElementById('queue-progress-fill');
      const textEl = document.getElementById('queue-progress-text');
      utils.show(progressEl);
      fillEl.style.width = '0%';
      textEl.textContent = `1/${files.length} işleniyor...`;
    }

    // ── 4) Background service worker'ı tetikle ──
    chrome.runtime.sendMessage({ command: 'START_QUEUE' }, () => {
      if (chrome.runtime.lastError) {
        console.error('SW tetikleme hatası:', chrome.runtime.lastError.message);
        // Fallback: SW ulaşılamıyorsa popup'ta dene (eski davranış)
        this._fallbackProcessInPopup(files);
      }
    });
  }

  showProcessing() {
    utils.hide('result-welcome'); utils.hide('result-success'); utils.hide('result-error'); utils.hide('result-batch');
    utils.show('result-processing');
  }

  /* BACKGROUND KUYRUK YÖNETİMİ */

  /**
   * Background SW'den gelen ilerleme mesajlarını dinle
   */
  setupQueueListener() {
    chrome.runtime.onMessage.addListener((message) => {
      switch (message.type) {
        case 'QUEUE_PROGRESS':
          this._onQueueProgress(message);
          break;
        case 'QUEUE_ITEM_DONE':
          this._onQueueItemDone(message);
          break;
        case 'QUEUE_COMPLETED':
          this._onQueueCompleted(message);
          break;
        case 'QUEUE_CANCELLED':
          this._onQueueCancelled();
          break;
      }
    });
  }

  /**
   * Popup açıldığında aktif veya tamamlanmış kuyruk var mı kontrol et
   */
  async checkPendingQueue() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['queue_meta'], (result) => {
        const meta = result.queue_meta;
        if (!meta) { resolve(false); return; }

        if (meta.status === 'processing') {
          // Kuyruk hâlâ işleniyor — progress UI'ı göster
          this.state.isProcessing = true;
          this.updateProcessButton();
          this._showResumedQueueUI(meta);
          // Process sekmesine geç
          if (this.state.currentTab !== 'process') this.switchTab('process');
          resolve(true);
        } else if (meta.status === 'completed') {
          // Kuyruk tamamlanmış — sonuçları göster
          if (this.state.currentTab !== 'process') this.switchTab('process');
          this._showCompletedQueueResults(meta);
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  }

  /**
   * Bir öğe işlenmeye başladığında
   */
  _onQueueProgress(message) {
    const { index, total } = message;
    const fillEl = document.getElementById('queue-progress-fill');
    const textEl = document.getElementById('queue-progress-text');
    const progressEl = document.getElementById('queue-progress');

    if (progressEl) utils.show(progressEl);
    if (fillEl) fillEl.style.width = `${(index / total) * 100}%`;
    if (textEl) textEl.textContent = `${index + 1}/${total} işleniyor...`;

    // Thumbnail varsa animasyon ekle
    const thumb = document.getElementById(`thumb-${index}`);
    if (thumb) thumb.classList.add('processing');
  }

  /**
   * Bir öğe tamamlandığında (başarılı veya hatalı)
   */
  _onQueueItemDone(message) {
    const { index, total, item } = message;

    // Thumbnail güncelle
    const thumb = document.getElementById(`thumb-${index}`);
    if (thumb) {
      thumb.classList.remove('processing');
      thumb.classList.add(item.status === 'done' ? 'done' : 'error');
    }

    // Progress bar güncelle
    const fillEl = document.getElementById('queue-progress-fill');
    const textEl = document.getElementById('queue-progress-text');
    if (fillEl) fillEl.style.width = `${((index + 1) / total) * 100}%`;
    if (textEl) textEl.textContent = `${index + 1}/${total} tamamlandı`;
  }

  /**
   * Tüm kuyruk tamamlandığında
   */
  _onQueueCompleted(message) {
    const meta = message.meta;
    this.state.isProcessing = false;

    const dropZone = document.getElementById('drop-zone');
    if (dropZone) dropZone.style.pointerEvents = '';

    this.updateProcessButton();

    const results = this._metaToResults(meta);

    const fillEl = document.getElementById('queue-progress-fill');
    const textEl = document.getElementById('queue-progress-text');
    if (fillEl) fillEl.style.width = '100%';
    if (textEl) textEl.textContent = `${meta.totalCount}/${meta.totalCount} tamamlandı`;

    if (meta.totalCount === 1) {
      // Tek fiş
      if (results[0].success) {
        this.showResult(results[0].data);
        utils.toast('Fiş başarıyla işlendi!', 'success');
      } else {
        this.showError(results[0].error || { message: 'Hata oluştu' });
        utils.toast('Fiş işleme hatası', 'error');
      }
    } else {
      // Toplu sonuç
      this.showBatchResult(results);
      const successCount = results.filter(r => r.success).length;
      if (successCount === meta.totalCount) {
        utils.toast(`${meta.totalCount} fiş başarıyla işlendi!`, 'success');
      } else {
        utils.toast(`${successCount}/${meta.totalCount} fiş işlendi, ${meta.totalCount - successCount} hata`, 'warning');
      }
    }

    chrome.storage.local.remove(['queue_meta', 'queue_items']);
    this.clearSelectedFiles();
  }

  /**
   * Kuyruk iptal edildiğinde
   */
  _onQueueCancelled() {
    this.state.isProcessing = false;

    const dropZone = document.getElementById('drop-zone');
    if (dropZone) dropZone.style.pointerEvents = '';

    this.updateProcessButton();
    utils.toast('İşlem iptal edildi', 'warning');
    chrome.storage.local.remove(['queue_meta', 'queue_items']);
    this.clearSelectedFiles();
  }

  /**
   * Popup yeniden açıldığında devam eden kuyruğun UI'ını göster
   */
  _showResumedQueueUI(meta) {
    this.showProcessing();

    utils.hide('drop-zone-content');
    utils.hide('drop-zone-preview');

    const dropZone = document.getElementById('drop-zone');
    if (dropZone) dropZone.style.pointerEvents = 'none';

    const processBtn = document.getElementById('process-btn');
    if (processBtn) processBtn.disabled = true;

    const clearBtn = document.getElementById('clear-image');
    if (clearBtn) clearBtn.disabled = true;

    if (meta.totalCount > 1) {
      const progressEl = document.getElementById('queue-progress');
      const fillEl = document.getElementById('queue-progress-fill');
      const textEl = document.getElementById('queue-progress-text');
      utils.show(progressEl);

      const doneCount = meta.results.filter(r => r.status === 'done' || r.status === 'error').length;
      const pct = (doneCount / meta.totalCount) * 100;
      if (fillEl) fillEl.style.width = `${pct}%`;
      if (textEl) textEl.textContent = `${doneCount + 1}/${meta.totalCount} işleniyor...`;
    }
  }

  /**
   * Popup açıldığında tamamlanmış kuyruğun sonuçlarını göster
   */
  _showCompletedQueueResults(meta) {
    this.state.isProcessing = false;
    this.updateProcessButton();

    const dropZone = document.getElementById('drop-zone');
    if (dropZone) dropZone.style.pointerEvents = '';

    const results = this._metaToResults(meta);

    if (meta.totalCount === 1) {
      if (results[0].success) {
        this.showResult(results[0].data);
      } else {
        this.showError(results[0].error || { message: 'Hata oluştu' });
      }
    } else {
      this.showBatchResult(results);
      const successCount = results.filter(r => r.success).length;
      utils.toast(
        `${successCount}/${meta.totalCount} fiş işlendi`,
        successCount === meta.totalCount ? 'success' : 'warning'
      );
    }

    chrome.storage.local.remove(['queue_meta', 'queue_items']);
    this.clearSelectedFiles();
  }

  /**
   * queue_meta.results → showBatchResult/showResult uyumlu formata çevir
   */
  _metaToResults(meta) {
    return meta.results.map(r => ({
      success: r.status === 'done',
      data: r.result || {},
      error: r.error ? { message: r.error } : null,
      file: { name: r.fileName || 'Dosya' },
    }));
  }

  /**
   * Fallback: SW ulaşılamazsa popup'ta eski yöntemle işle
   */
  async _fallbackProcessInPopup(files) {
    const isBatch = files.length > 1;

    if (isBatch) {
      const progressEl = document.getElementById('queue-progress');
      const fillEl = document.getElementById('queue-progress-fill');
      const textEl = document.getElementById('queue-progress-text');
      utils.show(progressEl);

      const results = [];
      for (let i = 0; i < files.length; i++) {
        textEl.textContent = `${i + 1}/${files.length} işleniyor...`;
        fillEl.style.width = `${((i) / files.length) * 100}%`;
        const thumb = document.getElementById(`thumb-${i}`);
        if (thumb) thumb.classList.add('processing');

        try {
          const imageBase64 = await utils.fileToBase64(files[i]);
          const mimeType = utils.getMimeFromFile(files[i]);
          const result = await api.processImage(imageBase64, mimeType, 'chrome-extension');
          results.push({ success: true, data: result, file: files[i] });
          if (thumb) { thumb.classList.remove('processing'); thumb.classList.add('done'); }
        } catch (e) {
          results.push({ success: false, error: e, file: files[i] });
          if (thumb) { thumb.classList.remove('processing'); thumb.classList.add('error'); }
        }
        if (i < files.length - 1) await new Promise(r => setTimeout(r, 500));
      }

      fillEl.style.width = '100%';
      textEl.textContent = `${files.length}/${files.length} tamamlandı`;
      this.showBatchResult(results);
      const successCount = results.filter(r => r.success).length;
      if (successCount === files.length) {
        utils.toast(`${files.length} fiş başarıyla işlendi!`, 'success');
      } else {
        utils.toast(`${successCount}/${files.length} fiş işlendi, ${files.length - successCount} hata`, 'warning');
      }
    } else {
      try {
        const imageBase64 = await utils.fileToBase64(files[0]);
        const mimeType = utils.getMimeFromFile(files[0]);
        const result = await api.processImage(imageBase64, mimeType, 'chrome-extension');
        this.showResult(result);
        utils.toast('Fiş başarıyla işlendi!', 'success');
      } catch (e) {
        this.showError(e);
        utils.toast('Fiş işleme hatası: ' + e.message, 'error');
      }
    }

    this.state.isProcessing = false;
    this.updateProcessButton();
    chrome.storage.local.remove(['queue_meta', 'queue_items']);
    this.clearSelectedFiles();
  }


  showResult(data) {
    utils.hide('result-processing'); utils.hide('result-error'); utils.hide('result-welcome'); utils.hide('result-batch');
    utils.show('result-success');
    document.getElementById('result-confidence').textContent = `${data.confidence}%`;
    document.getElementById('result-source').textContent = data.source;
    document.getElementById('result-time').textContent = `${data.processing_time_ms}ms`;
    const s = data.summary || {};
    document.getElementById('res-firma').textContent = s.firma || '-';
    document.getElementById('res-tarih').textContent = s.tarih || '-';
    document.getElementById('res-matrah').textContent = utils.formatCurrency(s.matrah);
    document.getElementById('res-kdv-oran').textContent = s.kdv_oran || '-';
    document.getElementById('res-kdv-tutar').textContent = utils.formatCurrency(s.kdv_tutar);
    document.getElementById('res-toplam').textContent = utils.formatCurrency(s.toplam);
    document.getElementById('res-masraf').textContent = s.masraf || '-';
    document.getElementById('res-odeme').textContent = s.odeme || '-';
    document.getElementById('res-row').textContent = `#${data.row_number}`;
  }

  showBatchResult(results) {
    utils.hide('result-processing'); utils.hide('result-success'); utils.hide('result-error'); utils.hide('result-welcome');
    utils.show('result-batch');
    const container = document.getElementById('batch-summary');
    container.innerHTML = results.map((r, i) => {
      if (r.success) {
        const s = r.data.summary || {};
        return `<div class="batch-item success">
          <span class="batch-item-idx">${i + 1}</span>
          <div class="batch-item-info">
            <span class="batch-item-firma">${utils.escapeHtml(s.firma || 'Bilinmeyen')}</span>
            <span class="batch-item-detail">${utils.escapeHtml(s.tarih || '-')} • ${utils.formatCurrency(s.toplam)} • Satır #${r.data.row_number}</span>
          </div>
          <span class="batch-item-badge ok">${r.data.confidence}%</span>
        </div>`;
      } else {
        return `<div class="batch-item error">
          <span class="batch-item-idx">${i + 1}</span>
          <div class="batch-item-info">
            <span class="batch-item-firma">${utils.escapeHtml(r.file?.name || 'Dosya')}</span>
            <span class="batch-item-detail">${utils.escapeHtml(r.error?.message || 'Hata oluştu')}</span>
          </div>
          <span class="batch-item-badge fail">Hata</span>
        </div>`;
      }
    }).join('');
  }

  showError(error) {
    utils.hide('result-processing'); utils.hide('result-success'); utils.hide('result-welcome'); utils.hide('result-batch');
    utils.show('result-error');
    document.getElementById('result-error-msg').textContent = error.message;
    const detail = error.data?.detail;
    const detailEl = document.getElementById('result-error-detail');
    if (detail && typeof detail === 'object') detailEl.textContent = detail.message || JSON.stringify(detail);
    else if (detail) detailEl.textContent = detail;
    else detailEl.textContent = '';
  }

  /* SORGULAR */
  async loadQueries() {
    if (!this.state.apiReady) return;
    try {
      const data = await api.getRecentQueries(50);
      this._queriesData = data.queries || [];
      this.renderQueries(this._queriesData);
    } catch (e) {
      utils.toast('Sorgular yüklenemedi: ' + e.message, 'error');
    }
  }

  renderQueries(queries) {
    const tbody = document.getElementById('queries-tbody');
    const empty = document.getElementById('queries-empty');

    if (!queries.length) { tbody.innerHTML = ''; utils.show(empty); return; }
    utils.hide(empty);

    tbody.innerHTML = queries.map((q, idx) => {
      const statusClass = q.status === 'success' ? 'status-success' : 'status-error';
      const statusIcon = q.status === 'success' ? 'fa-check-circle' : 'fa-times-circle';
      return `
        <tr class="query-row" data-query-idx="${idx}" style="cursor:pointer" title="Detayı görüntülemek için tıklayın">
          <td class="td-firma">${utils.escapeHtml(q.firma || '-')}</td>
          <td>${utils.escapeHtml(q.tarih || '-')}</td>
          <td class="td-amount">${utils.formatCurrency(q.toplam)}</td>
          <td class="td-amount">${utils.formatCurrency(q.kdv_tutar)}</td>
          <td><span class="confidence-badge ${q.confidence >= 80 ? 'high' : q.confidence >= 50 ? 'mid' : 'low'}">${q.confidence}%</span></td>
          <td><span class="source-badge">${q.source}</span></td>
          <td>${q.processing_time_ms}ms</td>
          <td><span class="${statusClass}"><i class="fas ${statusIcon}"></i></span></td>
        </tr>`;
    }).join('');

    // Satır tıklama → detay popup
    tbody.querySelectorAll('.query-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.dataset.queryIdx);
        const query = this._queriesData[idx];
        if (query) this.openDetailModal(query, idx);
      });
    });
  }

  filterQueries() {
    if (!this._queriesData) return;
    const search = (document.getElementById('queries-search')?.value || '').toLowerCase();
    const dateFrom = document.getElementById('queries-date-from')?.value || '';
    const dateTo = document.getElementById('queries-date-to')?.value || '';

    let filtered = this._queriesData;

    // Firma araması
    if (search) {
      filtered = filtered.filter(q => (q.firma || '').toLowerCase().includes(search));
    }

    // Tarih filtresi (fiş tarihi GG/AA/YYYY formatında)
    if (dateFrom || dateTo) {
      filtered = filtered.filter(q => {
        if (!q.tarih) return false;
        // GG/AA/YYYY → YYYY-MM-DD dönüşümü
        const parts = q.tarih.replace(/\./g, '/').split('/');
        if (parts.length !== 3) return false;
        const isoDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        if (dateFrom && isoDate < dateFrom) return false;
        return !(dateTo && isoDate > dateTo);
      });
    }

    this.renderQueries(filtered);
  }

  /* SORGU DETAY POPUP */

  // Masraf ve ödeme seçenekleri (backend MASRAF_HESAP_KODU / ODEME_HESAP_KODU ile eşleşmeli)
  static MASRAF_OPTIONS = ['Market', 'Yemek', 'Akaryakıt', 'Kırtasiye', 'Giyim', 'Ulaşım', 'Konaklama', 'Teknoloji', 'Sağlık', 'Temizlik', 'Otopark', 'Diğer'];
  static ODEME_OPTIONS = ['NAKİT', 'KART', 'HAVALE'];
  static KDV_ORAN_OPTIONS = ['%1', '%8', '%10', '%18', '%20'];

  openDetailModal(query, idx) {
    this._editingQueryIdx = idx;
    this._editingQuery = { ...query };

    const masrafOptions = FaturaBotApp.MASRAF_OPTIONS.map(m =>
      `<option value="${m}" ${(query.masraf || '') === m ? 'selected' : ''}>${m}</option>`
    ).join('');

    const odemeOptions = FaturaBotApp.ODEME_OPTIONS.map(o =>
      `<option value="${o}" ${(query.odeme || '').toUpperCase() === o ? 'selected' : ''}>${o}</option>`
    ).join('');

    const kdvOranOptions = FaturaBotApp.KDV_ORAN_OPTIONS.map(k =>
      `<option value="${k}" ${(query.kdv_oran || '') === k ? 'selected' : ''}>${k}</option>`
    ).join('');

    const body = document.getElementById('detail-modal-body');
    body.innerHTML = `
      <div class="detail-meta">
        <span class="detail-meta-item"><i class="fas fa-hashtag"></i> ${utils.escapeHtml(query.request_id || '-')}</span>
        <span class="detail-meta-item"><i class="fas fa-clock"></i> ${utils.formatDate(query.timestamp, 'full')}</span>
        <span class="detail-meta-item confidence-badge ${query.confidence >= 80 ? 'high' : query.confidence >= 50 ? 'mid' : 'low'}">Güven: ${query.confidence}%</span>
        <span class="detail-meta-item source-badge">${query.source}</span>
        <span class="detail-meta-item"><i class="fas fa-stopwatch"></i> ${query.processing_time_ms}ms</span>
      </div>
      <div class="detail-form">
        <div class="detail-field-row">
          <div class="detail-field">
            <label><i class="fas fa-store"></i> Firma</label>
            <input type="text" id="edit-firma" value="${utils.escapeHtml(query.firma || '')}">
          </div>
          <div class="detail-field">
            <label><i class="fas fa-calendar"></i> Tarih</label>
            <input type="text" id="edit-tarih" value="${utils.escapeHtml(query.tarih || '')}" placeholder="GG/AA/YYYY">
          </div>
        </div>
        <div class="detail-field-row">
          <div class="detail-field">
            <label><i class="fas fa-file-alt"></i> Fiş No</label>
            <input type="text" id="edit-fis-no" value="${utils.escapeHtml(query.fis_no || '')}">
          </div>
          <div class="detail-field">
            <label><i class="fas fa-id-card"></i> VKN/TCKN</label>
            <input type="text" id="edit-vkn" value="${utils.escapeHtml(query.vkn || '')}">
          </div>
        </div>
        <div class="detail-field-row">
          <div class="detail-field">
            <label><i class="fas fa-lira-sign"></i> Toplam</label>
            <input type="number" step="0.01" id="edit-toplam" value="${query.toplam || 0}">
          </div>
          <div class="detail-field">
            <label><i class="fas fa-percentage"></i> KDV Oranı</label>
            <select id="edit-kdv-oran">
              <option value="">Seçiniz</option>
              ${kdvOranOptions}
            </select>
          </div>
        </div>
        <div class="detail-field-row">
          <div class="detail-field">
            <label><i class="fas fa-calculator"></i> Matrah <span class="detail-auto-badge" id="matrah-auto-badge"></span></label>
            <input type="number" step="0.01" id="edit-matrah" value="${query.matrah || 0}">
          </div>
          <div class="detail-field">
            <label><i class="fas fa-coins"></i> KDV Tutarı <span class="detail-auto-badge" id="kdv-auto-badge"></span></label>
            <input type="number" step="0.01" id="edit-kdv-tutar" value="${query.kdv_tutar || 0}">
          </div>
        </div>
        <div class="detail-field-row">
          <div class="detail-field">
            <label><i class="fas fa-tag"></i> Masraf Türü</label>
            <select id="edit-masraf">
              <option value="">Seçiniz</option>
              ${masrafOptions}
            </select>
          </div>
          <div class="detail-field">
            <label><i class="fas fa-credit-card"></i> Ödeme</label>
            <select id="edit-odeme">
              ${odemeOptions}
            </select>
          </div>
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-danger btn-sm" id="detail-delete-btn"><i class="fas fa-trash-alt"></i> Sil</button>
        <div style="flex:1"></div>
        <button class="btn btn-outline btn-sm" id="detail-cancel-btn"><i class="fas fa-times"></i> Kapat</button>
        <button class="btn btn-primary btn-sm" id="detail-save-btn"><i class="fas fa-edit"></i> Güncelle</button>
      </div>
    `;

    // Etkinlikler
    document.getElementById('detail-cancel-btn').addEventListener('click', () => this.closeDetailModal());
    document.getElementById('detail-save-btn').addEventListener('click', () => this.saveQueryEdit());
    document.getElementById('detail-delete-btn').addEventListener('click', () => this.deleteQueryFromDetail());

    // Otomatik matrah/kdv hesaplama — toplam veya kdv oranı değiştiğinde
    const toplamEl = document.getElementById('edit-toplam');
    const kdvOranEl = document.getElementById('edit-kdv-oran');
    const matrahEl = document.getElementById('edit-matrah');
    const kdvTutarEl = document.getElementById('edit-kdv-tutar');

    const autoCalc = () => {
      const toplam = parseFloat(toplamEl.value) || 0;
      const oranStr = kdvOranEl.value;
      if (!oranStr || !toplam) return;
      const m = oranStr.match(/(\d+)/);
      if (!m) return;
      const oranDecimal = parseInt(m[1]) / 100;
      const matrah = Math.round((toplam / (1 + oranDecimal)) * 100) / 100;
      const kdvTutar = Math.round((toplam - matrah) * 100) / 100;
      matrahEl.value = matrah.toFixed(2);
      kdvTutarEl.value = kdvTutar.toFixed(2);
      // Otomatik hesaplama göstergesi
      document.getElementById('matrah-auto-badge').textContent = '(otomatik)';
      document.getElementById('kdv-auto-badge').textContent = '(otomatik)';
    };

    toplamEl.addEventListener('input', autoCalc);
    kdvOranEl.addEventListener('change', autoCalc);

    const modal = document.getElementById('detail-modal');
    const backdrop = document.getElementById('detail-backdrop');
    backdrop.classList.remove('hidden');
    modal.classList.remove('hidden');
    setTimeout(() => { backdrop.classList.add('visible'); modal.classList.add('visible'); }, 10);
  }

  closeDetailModal() {
    const modal = document.getElementById('detail-modal');
    const backdrop = document.getElementById('detail-backdrop');
    modal.classList.remove('visible');
    backdrop.classList.remove('visible');
    setTimeout(() => { modal.classList.add('hidden'); backdrop.classList.add('hidden'); }, 300);
  }

  async saveQueryEdit() {
    const data = {
      firma: document.getElementById('edit-firma').value.trim(),
      tarih: document.getElementById('edit-tarih').value.trim(),
      fis_no: document.getElementById('edit-fis-no').value.trim() || null,
      vkn: document.getElementById('edit-vkn').value.trim() || null,
      matrah: parseFloat(document.getElementById('edit-matrah').value) || null,
      kdv_oran: document.getElementById('edit-kdv-oran').value.trim() || null,
      kdv_tutar: parseFloat(document.getElementById('edit-kdv-tutar').value) || null,
      toplam: parseFloat(document.getElementById('edit-toplam').value) || 0,
      odeme: document.getElementById('edit-odeme').value.trim(),
      masraf: document.getElementById('edit-masraf').value.trim(),
    };

    utils.setLoading('detail-save-btn', true, 'Kaydediliyor...');

    try {
      await api.updateQueryRow(this._editingQuery.request_id, data);

      if (this._queriesData && this._editingQueryIdx !== undefined) {
        const q = this._queriesData[this._editingQueryIdx];
        if (q) Object.assign(q, data);
        this.renderQueries(this._queriesData);
      }

      utils.toast('Değişiklikler Excel\'e kaydedildi', 'success');
      this.closeDetailModal();
    } catch (e) {
      utils.toast('Kaydetme hatası: ' + e.message, 'error');
    } finally {
      utils.setLoading('detail-save-btn', false);
    }
  }

  async deleteQueryFromDetail() {
    if (!this._editingQuery) return;

    const ok = await this.showConfirm(
      `"${this._editingQuery.firma || 'Bu fiş'}" kaydını silmek istiyor musunuz?\n\nExcel dosyasından da kaldırılacaktır.`
    );
    if (!ok) return;

    utils.setLoading('detail-delete-btn', true, 'Siliniyor...');

    try {
      const result = await api.deleteQueryRow(this._editingQuery.request_id);

      // Bellekteki listeyi güncelle
      if (this._queriesData && this._editingQueryIdx !== undefined) {
        this._queriesData.splice(this._editingQueryIdx, 1);
        this.renderQueries(this._queriesData);
      }

      utils.toast(result.message || 'Fiş silindi', 'success');
      this.closeDetailModal();
    } catch (e) {
      utils.toast('Silme hatası: ' + e.message, 'error');
    } finally {
      utils.setLoading('detail-delete-btn', false);
    }
  }

  /* DIŞA AKTAR */
  async loadDailyFiles() {
    if (!this.state.apiReady) return;
    try {
      const data = await api.getDailyFiles();
      this.renderDailyFiles(data.files || []);
    } catch (e) {
      utils.toast('Dosya listesi yüklenemedi: ' + e.message, 'error');
    }
  }

  renderDailyFiles(files) {
    const container = document.getElementById('daily-files-list');
    if (!files.length) {
      container.innerHTML = '<div class="status-empty"><i class="fas fa-folder-open"></i><span>Dosya bulunamadı</span></div>';
      return;
    }
    container.innerHTML = files.map(f => {
      const dateStr = typeof f === 'string' ? f.replace('.xlsx', '') : f.date || f;
      const fileName = typeof f === 'string' ? f : f.file || f.name || f.date;
      const rowCount = f.row_count || 0;
      return `
      <div class="daily-file-item">
        <div class="daily-file-icon"><i class="fas fa-file-excel"></i></div>
        <div class="daily-file-info">
          <span class="daily-file-name">${utils.escapeHtml(dateStr)}</span>
          <div class="daily-file-meta">
            <span class="file-rows"><i class="fas fa-table"></i> ${rowCount} satır</span>
            <span>${utils.escapeHtml(fileName)}</span>
          </div>
        </div>
        <div class="daily-file-actions">
          <button class="daily-file-download" data-date="${dateStr}" title="İndir"><i class="fas fa-download"></i></button>
          <div class="daily-file-dropdown hidden" data-date="${dateStr}">
            <button class="daily-file-dropdown-item" data-format="xlsx"><i class="fas fa-file-excel" style="color:#21a366"></i> XLSX</button>
            <button class="daily-file-dropdown-item" data-format="csv"><i class="fas fa-file-csv" style="color:#f59e0b"></i> CSV</button>
            <button class="daily-file-dropdown-item" data-format="xls"><i class="fas fa-file-alt" style="color:#6366f1"></i> XLS</button>
          </div>
        </div>
      </div>`;
    }).join('');

    // Günlük dosya indirme dropdown toggle
    container.querySelectorAll('.daily-file-download').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const dateVal = btn.dataset.date;
        const dropdown = container.querySelector(`.daily-file-dropdown[data-date="${dateVal}"]`);
        // Diğer açık dropdown'ları kapat
        container.querySelectorAll('.daily-file-dropdown').forEach(d => {
          if (d !== dropdown) d.classList.add('hidden');
        });
        dropdown.classList.toggle('hidden');
      });
    });

    // Günlük dosya format seçimi
    container.querySelectorAll('.daily-file-dropdown-item').forEach(item => {
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        const dropdown = item.closest('.daily-file-dropdown');
        const dateVal = dropdown.dataset.date;
        const fmt = item.dataset.format;
        dropdown.classList.add('hidden');
        this.exportByDateValue(dateVal, fmt);
      });
    });
  }

  /* Export Dropdown Yardımcıları */
  toggleExportDropdown(btnId, dropdownId) {
    const btn = document.getElementById(btnId);
    const dropdown = document.getElementById(dropdownId);
    const isOpen = !dropdown.classList.contains('hidden');

    // Tüm dropdown'ları kapat
    this.closeAllExportDropdowns();

    if (!isOpen) {
      dropdown.classList.remove('hidden');
      btn.classList.add('dropdown-open');
    }
  }

  closeAllExportDropdowns() {
    document.querySelectorAll('.export-dropdown').forEach(d => d.classList.add('hidden'));
    document.querySelectorAll('.export-action-card').forEach(c => c.classList.remove('dropdown-open'));
    document.querySelectorAll('.daily-file-dropdown').forEach(d => d.classList.add('hidden'));
  }

  _fmtExt(format) { return { xlsx: '.xlsx', csv: '.csv', xls: '.xls' }[format] || '.xlsx'; }

  async exportToday(format = 'xlsx') {
    const card = document.getElementById('export-today-btn');
    if (card) card.style.opacity = '0.5';
    try {
      const response = await api.exportExcel(null, format);
      const ext = this._fmtExt(format);
      await utils.downloadBlob(response, `fis_aktarim_${new Date().toISOString().split('T')[0]}${ext}`);
      utils.toast(`Bugünkü dosya indirildi (${format.toUpperCase()})`, 'success');
    } catch (e) { utils.toast('İndirme hatası: ' + e.message, 'error'); }
    finally { if (card) card.style.opacity = ''; }
  }

  async exportAllCombined(format = 'xlsx') {
    const card = document.getElementById('export-all-btn');
    if (card) card.style.opacity = '0.5';
    try {
      const response = await api.exportAll(format);
      const ext = this._fmtExt(format);
      await utils.downloadBlob(response, `tum_fis_aktarim${ext}`);
      utils.toast(`Birleşik dosya indirildi (${format.toUpperCase()})`, 'success');
    } catch (e) { utils.toast('İndirme hatası: ' + e.message, 'error'); }
    finally { if (card) card.style.opacity = ''; }
  }

  async exportByDate() {
    const dateStr = document.getElementById('export-date').value;
    if (!dateStr) { utils.toast('Lütfen bir tarih seçin', 'warning'); return; }
    const format = document.getElementById('export-date-format')?.value || 'xlsx';
    await this.exportByDateValue(dateStr, format);
  }

  async exportByDateValue(dateStr, format = 'xlsx') {
    try {
      const response = await api.exportExcel(dateStr, format);
      const ext = this._fmtExt(format);
      await utils.downloadBlob(response, `fis_aktarim_${dateStr}${ext}`);
      utils.toast(`${dateStr} dosyası indirildi (${format.toUpperCase()})`, 'success');
    } catch (e) { utils.toast('İndirme hatası: ' + e.message, 'error'); }
  }

  /* WHATSAPP */

  showWhatsAppConnected() {
    const qrCard = document.getElementById('wa-qr-card');
    const qrImage = document.getElementById('wa-qr-image');
    const placeholder = document.getElementById('wa-qr-placeholder');

    qrCard.classList.add('connected-state');
    qrCard.classList.remove('open');
    qrImage.classList.add('hidden');
    placeholder.classList.add('hidden');

    const headerSpan = qrCard.querySelector('.wa-qr-header span');
    if (headerSpan) {
      headerSpan.innerHTML = 'QR Kod ile Giriş <span class="wa-connected-status-line"><i class="fas fa-check-circle"></i> Bağlı</span>';
    }
  }

  hideWhatsAppConnected() {
    const qrCard = document.getElementById('wa-qr-card');
    if (qrCard) {
      qrCard.classList.remove('connected-state');
      const headerSpan = qrCard.querySelector('.wa-qr-header span');
      if (headerSpan) headerSpan.textContent = 'QR Kod ile Giriş';
    }
  }

  showWhatsAppQRPlaceholder(message) {
    const qrImage = document.getElementById('wa-qr-image');
    const placeholder = document.getElementById('wa-qr-placeholder');
    const qrCard = document.getElementById('wa-qr-card');

    qrCard.classList.remove('connected-state');
    qrCard.classList.add('open');
    qrImage.classList.add('hidden');
    placeholder.classList.remove('hidden');
    placeholder.querySelector('p').textContent = message || 'QR kod yükleniyor...';
    this.hideWhatsAppConnected();
  }

  async loadWhatsAppTab() {
    try {
      const status = await api.getWhatsAppStatus();
      this.state.waConnection = status.connection || 'disconnected';
      this.updateWhatsAppStatusUI(status);
      this.loadAllowedJids(status.allowedJids);

      if (status.connection === 'connected') {
        this.showWhatsAppConnected(status);
      } else {
        this.hideWhatsAppConnected();
        await this.loadWhatsAppQR();
      }
    } catch (e) {
      this.state.waConnection = 'disconnected';
      this.updateWhatsAppStatusUI({ connection: 'disconnected' });
      this.hideWhatsAppConnected();
      this.updateJidCardState(false);
      this.showWhatsAppQRPlaceholder('Köprü bağlantısı kurulamadı');
    }
  }

  updateWhatsAppStatusUI(status) {
    const iconEl = document.getElementById('wa-status-icon');
    const titleEl = document.getElementById('wa-status-title');
    const badgeEl = document.getElementById('wa-status-badge');
    const phoneEl = document.getElementById('wa-phone');
    const uptimeEl = document.getElementById('wa-uptime');
    const lastEl = document.getElementById('wa-last-processed');
    const statusCard = document.getElementById('wa-status-card');
    const restartBtn = document.getElementById('wa-restart-btn');
    const logoutBtn = document.getElementById('wa-logout-btn');

    const conn = status.connection || 'disconnected';
    const isConnected = conn === 'connected';
    const isDisconnected = conn === 'disconnected';

    statusCard.classList.toggle('connected', isConnected);

    badgeEl.className = 'wa-status-badge ' + conn;
    const labels = {
      connected: '● Bağlı',
      disconnected: '○ Bağlı Değil',
      qr_pending: '◌ QR Bekleniyor',
      connecting: '◌ Bağlanıyor...',
    };
    badgeEl.textContent = labels[conn] || conn;

    iconEl.className = 'wa-status-icon';
    if (isConnected) iconEl.classList.add('connected');
    else if (isDisconnected) iconEl.classList.add('disconnected');

    titleEl.textContent = isConnected ? 'WhatsApp Bağlı' : 'WhatsApp Bağlantısı';

    phoneEl.textContent = status.phoneNumber ? `+${status.phoneNumber}` : '-';
    uptimeEl.textContent = status.uptimeFormatted || '-';
    lastEl.textContent = status.lastProcessedAt
      ? new Date(status.lastProcessedAt).toLocaleTimeString('tr-TR')
      : '-';

    restartBtn.innerHTML = isConnected
      ? '<i class="fas fa-redo"></i> Yeniden Bağlan'
      : '<i class="fas fa-plug"></i> Bağlan';

    logoutBtn.disabled = !isConnected;
    logoutBtn.style.opacity = isConnected ? '' : '0.4';
    logoutBtn.style.pointerEvents = isConnected ? '' : 'none';

    this.updateJidCardState(isConnected);
  }

  updateJidCardState(isConnected) {
    const jidCard = document.getElementById('wa-jid-card');
    const subtitle = document.getElementById('wa-jid-subtitle');
    if (!jidCard) return;

    if (isConnected) {
      jidCard.classList.remove('disabled');
      const count = this._currentJids?.length || 0;
      subtitle.textContent = count > 0
        ? `${count} numara tanımlı — düzenlemek için tıklayın`
        : 'Mesaj kabul edilecek numaralar — tıklayarak düzenleyin';
    } else {
      jidCard.classList.add('disabled');
      jidCard.classList.remove('open');
      subtitle.textContent = 'WhatsApp bağlantısı gerekli';
    }
  }

  toggleJidCard() {
    const jidCard = document.getElementById('wa-jid-card');
    if (!jidCard || jidCard.classList.contains('disabled')) return;
    jidCard.classList.toggle('open');
  }

  toggleQrCard() {
    const qrCard = document.getElementById('wa-qr-card');
    if (!qrCard || qrCard.classList.contains('connected-state')) return;
    qrCard.classList.toggle('open');
  }

  async loadWhatsAppQR() {
    const qrCard = document.getElementById('wa-qr-card');
    const qrImage = document.getElementById('wa-qr-image');
    const placeholder = document.getElementById('wa-qr-placeholder');

    qrCard.classList.remove('connected-state');
    qrCard.classList.add('open');

    try {
      const data = await api.getWhatsAppQR();

      if (data.connection === 'connected') {
        this.showWhatsAppConnected(data);
        return;
      }

      if (data.success && data.qr) {
        qrImage.src = data.qr;
        qrImage.classList.remove('hidden');
        placeholder.classList.add('hidden');
      } else {
        this.showWhatsAppQRPlaceholder(data.message || 'QR kod bekleniyor...');
      }
    } catch (e) {
      this.showWhatsAppQRPlaceholder('QR kod alınamadı');
    }
  }


  startWhatsAppPolling() {
    this.stopWhatsAppPolling();
    // İlk yüklemeyi yap, sonra 5 saniyede bir güncelle (QR değişebilir)
    this.state.waPollingInterval = setInterval(() => {
      if (this.state.currentTab === 'whatsapp') {
        this.loadWhatsAppTab();
      }
    }, 5000);
  }

  stopWhatsAppPolling() {
    if (this.state.waPollingInterval) {
      clearInterval(this.state.waPollingInterval);
      this.state.waPollingInterval = null;
    }
  }

  async whatsAppRestart() {
    const isConnected = this.state.waConnection === 'connected';
    const msg = isConnected
      ? 'WhatsApp bağlantısını yeniden başlatmak istiyor musunuz?'
      : 'WhatsApp bağlantısını başlatmak istiyor musunuz?';
    const ok = await this.showConfirm(msg);
    if (!ok) return;

    utils.setLoading('wa-restart-btn', true, 'Bağlanıyor...');
    try {
      await api.whatsAppRestart();
      utils.toast(isConnected ? 'WhatsApp yeniden başlatılıyor...' : 'WhatsApp bağlanıyor...', 'info');
      setTimeout(() => this.loadWhatsAppTab(), 2000);
    } catch (e) {
      utils.toast('Yeniden başlatma hatası: ' + e.message, 'error');
    } finally {
      utils.setLoading('wa-restart-btn', false);
    }
  }

  async whatsAppLogout() {
    const ok = await this.showConfirm('WhatsApp oturumunu kapatmak istiyor musunuz?\nTekrar QR kod taramanız gerekecek.');
    if (!ok) return;

    utils.setLoading('wa-logout-btn', true, 'Çıkış yapılıyor...');
    try {
      await api.whatsAppLogout();
      utils.toast('WhatsApp oturumu kapatıldı', 'success');
      this.state.waConnection = 'disconnected';
      this.updateWhatsAppStatusUI({ connection: 'disconnected' });
      this.hideWhatsAppConnected();
      this.updateJidCardState(false);
      this.showWhatsAppQRPlaceholder('Oturum kapatıldı — yeniden bağlanın');
    } catch (e) {
      utils.toast('Çıkış hatası: ' + e.message, 'error');
    } finally {
      utils.setLoading('wa-logout-btn', false);
    }
  }

  /* JID YÖNETİMİ */
  loadAllowedJids(jids) {
    this._currentJids = (jids || []).map(j => j.replace('@s.whatsapp.net', ''));
    this.renderJidList();
    const isConnected = this.state.waConnection === 'connected';
    this.updateJidCardState(isConnected);
  }

  renderJidList() {
    const container = document.getElementById('wa-jid-list');
    if (!this._currentJids || this._currentJids.length === 0) {
      container.innerHTML = '<div class="wa-jid-empty"><i class="fas fa-globe"></i> Tüm numaralar (filtresiz)</div>';
      return;
    }
    container.innerHTML = this._currentJids.map((num, idx) => {
      const formatted = num.length > 5 ? `+${num.slice(0, 2)} ${num.slice(2, 5)} ${num.slice(5)}` : num;
      return `<span class="wa-jid-edit-chip" title="${utils.escapeHtml(num)}">
        <i class="fas fa-user"></i> ${utils.escapeHtml(formatted)}
        <button class="wa-jid-remove" data-idx="${idx}" title="Kaldır"><i class="fas fa-times"></i></button>
      </span>`;
    }).join('');

    // Kaldır butonları
    container.querySelectorAll('.wa-jid-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeJid(parseInt(btn.dataset.idx));
      });
    });
  }

  async addJid() {
    const input = document.getElementById('wa-jid-input');
    let value = input.value.trim().replace(/\s+/g, '').replace(/^\+/, '');
    if (!value) {
      utils.toast('Numara girin', 'warning');
      return;
    }
    // Temel format kontrolü
    if (!/^\d{10,15}$/.test(value)) {
      utils.toast('Geçersiz numara formatı. Örnek: 905xxxxxxxxx', 'warning');
      return;
    }
    // Tekrar kontrolü
    if (this._currentJids && this._currentJids.includes(value)) {
      utils.toast('Bu numara zaten listede', 'warning');
      return;
    }

    if (!this._currentJids) this._currentJids = [];
    this._currentJids.push(value);
    this.renderJidList();
    this.updateJidCardState(true);
    input.value = '';

    await this.saveJids();
  }

  async removeJid(idx) {
    if (!this._currentJids || idx < 0 || idx >= this._currentJids.length) return;
    const removed = this._currentJids.splice(idx, 1)[0];
    this.renderJidList();
    this.updateJidCardState(true);
    await this.saveJids();
    utils.toast(`${removed} kaldırıldı`, 'info');
  }

  async saveJids() {
    try {
      const result = await api.updateAllowedJids(this._currentJids || []);
      if (result.success) {
        utils.toast(`${result.allowedJids?.length || 0} numara güncellendi`, 'success');
      }
    } catch (e) {
      utils.toast('JID güncelleme hatası: ' + e.message, 'error');
    }
  }

  /* BİLDİRİM POLLİNG */
  startNotificationPolling() {
    this.stopNotificationPolling();
    this.checkNotifications();
    this.state.notificationPollingInterval = setInterval(() => this.checkNotifications(), 30000);
  }

  stopNotificationPolling() {
    if (this.state.notificationPollingInterval) {
      clearInterval(this.state.notificationPollingInterval);
      this.state.notificationPollingInterval = null;
    }
  }

  /* BAĞLANTI GÖZETİCİSİ (Watchdog) — Her 10 saniyede health check */
  startConnectionWatchdog() {
    this.stopConnectionWatchdog();
    this.state.connectionWatchdog = setInterval(() => this._checkConnection(), 10000);
  }

  stopConnectionWatchdog() {
    if (this.state.connectionWatchdog) {
      clearInterval(this.state.connectionWatchdog);
      this.state.connectionWatchdog = null;
    }
  }

  async _checkConnection() {
    try {
      await api.getHealth();
      if (!this.state.apiReady) {
        this.state.apiReady = true;
        this.updateConnectionUI(true);
        this.showDisconnectionOverlay(false);
        utils.toast('Sunucu bağlantısı yeniden kuruldu!', 'success');
        this.loadDashboardData();
      }
    } catch {
      if (this.state.apiReady) {
        this.state.apiReady = false;
        this.updateConnectionUI(false);
        this.showDisconnectionOverlay(true);
        utils.toast('Sunucu bağlantısı kesildi!', 'error');
      }
    }
  }

  showDisconnectionOverlay(show) {
    let overlay = document.getElementById('disconnection-overlay');
    if (show) {
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'disconnection-overlay';
        overlay.className = 'disconnection-overlay';
        overlay.innerHTML = `
          <div class="disconnection-overlay-content">
            <i class="fas fa-unlink"></i>
            <span>Sunucu bağlantısı kesildi</span>
            <button class="btn btn-outline btn-sm" id="disconnection-reconnect-btn">
              <i class="fas fa-plug"></i> Yeniden Bağlan
            </button>
          </div>
        `;
        document.querySelector('.content-area')?.prepend(overlay);
        document.getElementById('disconnection-reconnect-btn')?.addEventListener('click', () => this.openApiModal());
      }
      overlay.classList.remove('hidden');
    } else {
      if (overlay) overlay.classList.add('hidden');
    }
  }

  async checkNotifications() {
    if (!this.state.apiReady) return;
    try {
      const data = await api.getNotifications();
      const banner = document.getElementById('notification-banner');
      const text = document.getElementById('notification-banner-text');
      if (data.count > 0) {
        const latest = data.notifications[0];
        text.textContent = latest.message;
        banner.classList.remove('hidden');
      } else {
        banner.classList.add('hidden');
      }
    } catch {
    }
  }

  async dismissNotifications() {
    const banner = document.getElementById('notification-banner');
    banner.classList.add('hidden');
    try {
      await api.dismissNotification(null);
    } catch (e) {
      console.error('Bildirim kapatma hatası:', e);
    }
  }

  /* TERMİNAL LOG */
  openTerminalPopup() {
    const popup = document.getElementById('terminal-popup');
    const status = document.getElementById('terminal-status');
    const output = document.getElementById('terminal-output');

    if (!popup) return;

    popup.classList.remove('hidden');

    status.className = 'terminal-popup-status';
    status.innerHTML = '<span class="terminal-status-dot"></span><span>Bağlanıyor...</span>';
    output.innerHTML = '<div class="terminal-empty"><i class="fas fa-terminal"></i><span>Log akışı başlatılıyor...</span></div>';

    this._terminalAutoScroll = true;

    output.addEventListener('scroll', () => {
      this._terminalAutoScroll = output.scrollHeight - output.scrollTop - output.clientHeight < 40;
    });

    api.startTerminalStream(
      (logEntry) => {
        this.appendTerminalLog(logEntry);
      },
      () => {
        status.className = 'terminal-popup-status connected';
        status.innerHTML = '<span class="terminal-status-dot"></span><span>Bağlı — Canlı log akışı</span>';
        const empty = output.querySelector('.terminal-empty');
        if (empty) empty.remove();
      },
      (error) => {
        console.error('Terminal stream error:', error);
        status.className = 'terminal-popup-status error';
        status.innerHTML = '<span class="terminal-status-dot"></span><span>Bağlantı kesildi</span>';
      }
    );
  }

  closeTerminalPopup() {
    const popup = document.getElementById('terminal-popup');
    if (popup) popup.classList.add('hidden');
    api.stopTerminalStream();
  }

  async clearTerminalOutput() {
    const output = document.getElementById('terminal-output');
    if (output) {
      output.innerHTML = '<div class="terminal-empty"><i class="fas fa-terminal"></i><span>Log temizlendi</span></div>';
    }
    try {
      await api.clearTerminalLogs();
    } catch (error) {
      console.error('Failed to clear server logs:', error);
    }
  }

  appendTerminalLog(entry) {
    const output = document.getElementById('terminal-output');
    if (!output) return;

    const empty = output.querySelector('.terminal-empty');
    if (empty) empty.remove();

    const line = document.createElement('div');
    line.className = 'terminal-line';

    const time = entry.timestamp
      ? new Date(entry.timestamp).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : '';

    const level = (entry.level || 'info').toLowerCase();
    const category = entry.category || 'system';
    const message = entry.message || '';
    const hasData = entry.data && Object.keys(entry.data).length > 0;

    line.innerHTML = `
      <span class="terminal-time">${utils.escapeHtml(time)}</span>
      <span class="terminal-level ${level}">${level}</span>
      <span class="terminal-category">${utils.escapeHtml(category)}</span>
      <span class="terminal-msg">${utils.escapeHtml(message)}</span>
      ${hasData ? `<span class="terminal-data" title="${utils.escapeHtml(JSON.stringify(entry.data))}"><i class="fas fa-ellipsis-h"></i></span>` : ''}
    `;

    if (hasData) {
      const dataBtn = line.querySelector('.terminal-data');
      dataBtn?.addEventListener('click', () => {
        const formatted = JSON.stringify(entry.data, null, 2);
        const pre = document.createElement('div');
        pre.style.cssText = 'padding:4px 8px;margin:2px 0 4px 100px;background:var(--bg-input);border-radius:4px;font-size:10px;color:var(--text-secondary);white-space:pre-wrap;word-break:break-all;border:1px solid var(--border)';
        pre.textContent = formatted;
        if (line.nextElementSibling?.dataset?.dataExpanded) {
          line.nextElementSibling.remove();
        } else {
          pre.dataset.dataExpanded = 'true';
          line.after(pre);
        }
      });
    }

    output.appendChild(line);

    while (output.children.length > 500) {
      output.removeChild(output.firstChild);
    }

    if (this._terminalAutoScroll) {
      output.scrollTop = output.scrollHeight;
    }
  }

  showConfirm(message) {
    return new Promise((resolve) => {
      const backdrop = document.getElementById('confirm-backdrop');
      const dialog = document.getElementById('confirm-dialog');
      const msgEl = document.getElementById('confirm-message');
      const okBtn = document.getElementById('confirm-ok-btn');
      const cancelBtn = document.getElementById('confirm-cancel-btn');

      msgEl.textContent = message;
      backdrop.classList.remove('hidden');
      dialog.classList.remove('hidden');

      const cleanup = (result) => {
        backdrop.classList.add('hidden');
        dialog.classList.add('hidden');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        resolve(result);
      };

      const onOk = () => cleanup(true);
      const onCancel = () => cleanup(false);

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
    });
  }
}

/* BAŞLAT */
const app = new FaturaBotApp();
document.addEventListener('DOMContentLoaded', () => app.init());

