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
    };
  }

  /* ═══════════════ BAŞLATMA ═══════════════ */
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
      } catch (e) {
        console.error('İlk bağlantı başarısız:', e);
        this.state.apiReady = false;
        this.updateConnectionUI(false);
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
    document.getElementById('api-key').value = settings.apiKey;
  }

  /* ═══════════════ TEMA ═══════════════ */
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

  /* ═══════════════ BAĞLANTI DURUMU ═══════════════ */
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

  /* ═══════════════ OLAY DİNLEYİCİLERİ ═══════════════ */
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

    // Dışa Aktar
    document.getElementById('export-today-btn')?.addEventListener('click', () => this.exportToday());
    document.getElementById('export-all-btn')?.addEventListener('click', () => this.exportAllCombined());
    document.getElementById('export-date-btn')?.addEventListener('click', () => this.exportByDate());
    document.getElementById('refresh-files')?.addEventListener('click', () => this.loadDailyFiles());
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

  /* ═══════════════ SEKME GEÇİŞİ ═══════════════ */
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

    const titles = { 'dashboard': 'Kontrol Paneli', 'process': 'Fiş İşle', 'queries': 'Son Sorgular', 'export': 'Dışa Aktar' };
    document.getElementById('page-title').textContent = titles[tabId] || tabId;
    this.state.currentTab = tabId;

    switch (tabId) {
      case 'dashboard': this.loadDashboardData(); break;
      case 'queries': this.loadQueries(); break;
      case 'export': this.loadDailyFiles(); break;
    }
  }

  /* ═══════════════ SUNUCU AYARLARI MODALI ═══════════════ */
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
    const key = document.getElementById('api-key').value.trim();
    if (!url) { utils.toast('Sunucu adresi girin', 'warning'); return; }

    utils.setLoading('test-connection', true, 'Test ediliyor...');
    try {
      const normalizedUrl = url.replace(/\/v1\/?$/, '').replace(/\/+$/, '');
      const headers = { 'Content-Type': 'application/json' };
      if (key) headers['X-API-Key'] = key;

      const response = await fetch(`${normalizedUrl}/v1/health`, { headers, signal: AbortSignal.timeout(10000) });
      const data = await response.json();

      if (data.status === 'healthy') {
        await api.saveSettings(url, key);
        this.state.apiReady = true;
        this.updateConnectionUI(true);
        this.updateApiModalStatus();
        const closeBtn = document.getElementById('api-modal-close');
        if (closeBtn) closeBtn.style.display = '';
        utils.toast(`Bağlantı başarılı! v${data.version}`, 'success');
        this.closeApiModal();
        this.loadDashboardData();
      } else {
        utils.toast('Sunucu yanıt verdi ama durum sağlıklı değil', 'warning');
      }
    } catch (e) {
      utils.toast('Bağlantı başarısız: ' + e.message, 'error');
    } finally {
      utils.setLoading('test-connection', false);
    }
  }

  async saveSettings() {
    const url = document.getElementById('api-url').value.trim();
    const key = document.getElementById('api-key').value.trim();
    if (!url) { utils.toast('Sunucu adresi gerekli', 'warning'); return; }

    utils.setLoading('save-settings', true, 'Kaydediliyor...');
    try {
      await api.saveSettings(url, key);
      await api.getHealth();
      this.state.apiReady = true;
      this.updateConnectionUI(true);
      this.updateApiModalStatus();
      // Close butonunu tekrar göster
      const closeBtn = document.getElementById('api-modal-close');
      if (closeBtn) closeBtn.style.display = '';
      utils.toast('Ayarlar kaydedildi ve bağlantı kuruldu!', 'success');
      this.closeApiModal();
      this.loadDashboardData();
    } catch (e) {
      utils.toast('Kaydedildi ama bağlantı kurulamadı: ' + e.message, 'warning');
      this.state.apiReady = false;
      this.updateConnectionUI(false);
      this.updateApiModalStatus();
    } finally {
      utils.setLoading('save-settings', false);
    }
  }

  /* ═══════════════ PANEL ═══════════════ */
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

  /* ═══════════════ FİŞ İŞLE ═══════════════ */
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
    chrome.runtime.sendMessage({ command: 'START_QUEUE' }, (response) => {
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

  /* ═══════════════ BACKGROUND KUYRUK YÖNETİMİ ═══════════════ */

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

  /* ═══════════════ SORGULAR ═══════════════ */
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
        if (dateTo && isoDate > dateTo) return false;
        return true;
      });
    }

    this.renderQueries(filtered);
  }

  /* ═══════════════ SORGU DETAY POPUP ═══════════════ */
  openDetailModal(query, idx) {
    this._editingQueryIdx = idx;
    this._editingQuery = { ...query };

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
            <label><i class="fas fa-calculator"></i> Matrah</label>
            <input type="number" step="0.01" id="edit-matrah" value="${query.matrah || 0}">
          </div>
          <div class="detail-field">
            <label><i class="fas fa-percentage"></i> KDV Oranı</label>
            <input type="text" id="edit-kdv-oran" value="${utils.escapeHtml(query.kdv_oran || '')}" placeholder="%8, %18...">
          </div>
        </div>
        <div class="detail-field-row">
          <div class="detail-field">
            <label><i class="fas fa-coins"></i> KDV Tutarı</label>
            <input type="number" step="0.01" id="edit-kdv-tutar" value="${query.kdv_tutar || 0}">
          </div>
          <div class="detail-field">
            <label><i class="fas fa-lira-sign"></i> Toplam</label>
            <input type="number" step="0.01" id="edit-toplam" value="${query.toplam || 0}">
          </div>
        </div>
        <div class="detail-field-row">
          <div class="detail-field">
            <label><i class="fas fa-credit-card"></i> Ödeme</label>
            <input type="text" id="edit-odeme" value="${utils.escapeHtml(query.odeme || '')}">
          </div>
          <div class="detail-field">
            <label><i class="fas fa-tag"></i> Masraf Türü</label>
            <input type="text" id="edit-masraf" value="${utils.escapeHtml(query.masraf || '')}">
          </div>
        </div>
      </div>
      <div class="detail-actions">
        <button class="btn btn-outline btn-sm" id="detail-cancel-btn"><i class="fas fa-times"></i> Kapat</button>
        <button class="btn btn-primary btn-sm" id="detail-save-btn"><i class="fas fa-edit"></i> Güncelle</button>
      </div>
    `;

    // Etkinlikler
    document.getElementById('detail-cancel-btn').addEventListener('click', () => this.closeDetailModal());
    document.getElementById('detail-save-btn').addEventListener('click', () => this.saveQueryEdit());

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

  /* ═══════════════ DIŞA AKTAR ═══════════════ */
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
        <button class="daily-file-download" data-date="${dateStr}" title="İndir"><i class="fas fa-download"></i></button>
      </div>`;
    }).join('');

    container.querySelectorAll('.daily-file-download').forEach(btn => {
      btn.addEventListener('click', () => this.exportByDateValue(btn.dataset.date));
    });
  }

  async exportToday() {
    const card = document.getElementById('export-today-btn');
    if (card) card.style.opacity = '0.5';
    try {
      const response = await api.exportExcel();
      await utils.downloadBlob(response, `faturalar_${new Date().toISOString().split('T')[0]}.xlsx`);
      utils.toast('Bugünkü dosya indirildi', 'success');
    } catch (e) { utils.toast('İndirme hatası: ' + e.message, 'error'); }
    finally { if (card) card.style.opacity = ''; }
  }

  async exportAllCombined() {
    const card = document.getElementById('export-all-btn');
    if (card) card.style.opacity = '0.5';
    try {
      const response = await api.exportAll();
      await utils.downloadBlob(response, 'tum_faturalar.xlsx');
      utils.toast('Birleşik dosya indirildi', 'success');
    } catch (e) { utils.toast('İndirme hatası: ' + e.message, 'error'); }
    finally { if (card) card.style.opacity = ''; }
  }

  async exportByDate() {
    const dateStr = document.getElementById('export-date').value;
    if (!dateStr) { utils.toast('Lütfen bir tarih seçin', 'warning'); return; }
    await this.exportByDateValue(dateStr);
  }

  async exportByDateValue(dateStr) {
    try {
      const response = await api.exportExcel(dateStr);
      await utils.downloadBlob(response, `faturalar_${dateStr}.xlsx`);
      utils.toast(`${dateStr} dosyası indirildi`, 'success');
    } catch (e) { utils.toast('İndirme hatası: ' + e.message, 'error'); }
  }
}

/* ═══════════════ BAŞLAT ═══════════════ */
const app = new FaturaBotApp();
document.addEventListener('DOMContentLoaded', () => app.init());

