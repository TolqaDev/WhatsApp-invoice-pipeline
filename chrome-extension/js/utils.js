/**
 * Fatura Bot — Yardımcı fonksiyonlar
 */
const utils = {
  _cache: new Map(),
  _cacheMaxSize: 100,

  clearCache() {
    this._cache.clear();
  },

  toast(message, type = 'info', duration = 3000) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'fa-info-circle';
    if (type === 'success') icon = 'fa-check-circle';
    if (type === 'error') icon = 'fa-exclamation-circle';
    if (type === 'warning') icon = 'fa-exclamation-triangle';

    toast.innerHTML = `<i class="fas ${icon}"></i> ${this.escapeHtml(message)}`;
    toast.style.setProperty('--toast-duration', duration + 'ms');
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  },

  truncate(text, maxLength = 50) {
    if (!text) return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  },

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  formatUptime(seconds) {
    if (!seconds || seconds < 0) return '-';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (days > 0) parts.push(`${days}g`);
    if (hours > 0) parts.push(`${hours}s`);
    if (minutes > 0) parts.push(`${minutes}dk`);
    return parts.join(' ') || '< 1dk';
  },

  formatDate(date, format = 'short') {
    if (!date) return '-';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';

    const now = new Date();
    const diff = now - d;
    const oneDay = 24 * 60 * 60 * 1000;

    if (format === 'relative') {
      if (diff < 60000) return 'Az önce';
      if (diff < 3600000) return `${Math.floor(diff / 60000)} dk önce`;
      if (diff < oneDay) return `${Math.floor(diff / 3600000)} saat önce`;
      if (diff < oneDay * 7) return `${Math.floor(diff / oneDay)} gün önce`;
    }

    if (format === 'time') {
      return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
    }

    if (format === 'short') {
      if (diff < oneDay && d.getDate() === now.getDate()) {
        return d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
      }
      return d.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' });
    }

    return d.toLocaleString('tr-TR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    });
  },

  formatCurrency(value) {
    if (value === undefined || value === null) return '₺0';
    return `₺${Number(value).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  },

  show(element) {
    if (typeof element === 'string') {
      element = document.getElementById(element) || document.querySelector(element);
    }
    if (element) element.classList.remove('hidden');
  },

  hide(element) {
    if (typeof element === 'string') {
      element = document.getElementById(element) || document.querySelector(element);
    }
    if (element) element.classList.add('hidden');
  },

  toggle(element, show) {
    if (show) this.show(element);
    else this.hide(element);
  },

  setLoading(button, loading, text = null) {
    if (typeof button === 'string') button = document.getElementById(button);
    if (!button) return;

    if (loading) {
      button.disabled = true;
      button.dataset.originalText = button.innerHTML;
      button.innerHTML = '<span class="spinner"></span> ' + (text || 'Yükleniyor...');
    } else {
      button.disabled = false;
      if (button.dataset.originalText) {
        button.innerHTML = button.dataset.originalText;
      }
    }
  },

  showConfirm(message) {
    return new Promise((resolve) => {
      const backdrop = document.getElementById('confirm-backdrop');
      const dialog = document.getElementById('confirm-dialog');
      const msgEl = document.getElementById('confirm-message');
      const okBtn = document.getElementById('confirm-ok-btn');
      const cancelBtn = document.getElementById('confirm-cancel-btn');

      if (!backdrop || !dialog) {
        resolve(window.confirm(message));
        return;
      }

      msgEl.textContent = message;
      backdrop.classList.remove('hidden');
      dialog.classList.remove('hidden');

      const cleanup = () => {
        backdrop.classList.add('hidden');
        dialog.classList.add('hidden');
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
        backdrop.removeEventListener('click', onCancel);
      };

      const onOk = () => { cleanup(); resolve(true); };
      const onCancel = () => { cleanup(); resolve(false); };

      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      backdrop.addEventListener('click', onCancel);
    });
  },

  initTooltips() {
    document.addEventListener('mouseover', (e) => {
      const tooltip = e.target.closest('.info-tooltip');
      if (!tooltip) return;

      const rect = tooltip.getBoundingClientRect();
      const tooltipWidth = 200;
      const tooltipPad = 10;
      const viewW = document.documentElement.clientWidth || 720;
      const viewH = document.documentElement.clientHeight || 580;

      let left = rect.left;
      if (left + tooltipWidth > viewW - tooltipPad) left = viewW - tooltipWidth - tooltipPad;
      if (left < tooltipPad) left = tooltipPad;

      let top = rect.bottom + 6;
      const approxHeight = 60;
      if (top + approxHeight > viewH - tooltipPad) top = rect.top - approxHeight - 6;
      if (top < tooltipPad) top = tooltipPad;

      tooltip.style.setProperty('--tip-left', left + 'px');
      tooltip.style.setProperty('--tip-top', top + 'px');
    });
  },

  /**
   * Dosyayı base64'e çevir
   */
  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  },

  /**
   * Dosya blob'unu indir
   */
  async downloadBlob(response, fallbackFilename = 'download.xlsx') {
    const blob = await response.blob();
    const contentDisposition = response.headers.get('Content-Disposition');
    let filename = fallbackFilename;
    if (contentDisposition) {
      const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
      if (match && match[1]) {
        filename = match[1].replace(/['"]/g, '');
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  getMimeFromFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const map = {
      'jpg': 'image/jpeg', 'jpeg': 'image/jpeg',
      'png': 'image/png',
      'webp': 'image/webp',
    };
    return map[ext] || file.type || 'image/jpeg';
  }
};

