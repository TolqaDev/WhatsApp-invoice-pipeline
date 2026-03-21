<h1 align="center">🧾 Fatura Bot — POS Fiş Tarayıcı</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/FastAPI-0.111+-009688?logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/Gemini_AI-2.5_Flash-4285F4?logo=google&logoColor=white" alt="Gemini">
  <img src="https://img.shields.io/badge/Chrome_Extension-MV3-4285F4?logo=googlechrome&logoColor=white" alt="Chrome">
  <img src="https://img.shields.io/badge/Lisans-MIT-green" alt="MIT">
</p>

<p align="center">
  AI destekli <strong>Türk POS fiş tarayıcı</strong> — görsel yükleyin, veriler otomatik Excel'e kaydedilsin.<br>
  Chrome eklentisi ile kullanımı kolay, <strong>OCR-First</strong> strateji ile maliyet optimizasyonu.
</p>

---

## 🏗️ Mimari

```
┌──────────────────────────────────────────────────────────┐
│                                                          │
│  ┌──────────────────┐    HTTP/JSON   ┌────────────────┐  │
│  │ Chrome Extension │◄─────────────►│  Python API    │  │
│  │   (Manifest V3)  │  :3000/v1     │  (FastAPI)     │  │
│  │                  │               │                │  │
│  │ • Sürükle-bırak  │               │ • OCR-First    │  │
│  │ • Yapıştır/Kamera │              │ • Gemini 2.5   │  │
│  │ • Sonuç göster    │              │ • Günlük Excel │  │
│  │ • Bütçe takibi    │              │ • Bütçe takip  │  │
│  │ • Excel indir     │              │ • Rate limit   │  │
│  └──────────────────┘               └────────────────┘  │
│                                            │             │
│                                      src/public/         │
│                                   (Excel + images)       │
└──────────────────────────────────────────────────────────┘
```

### İşlem Akışı (OCR-First Strateji)

```
Görsel → Tesseract OCR → Fiş mi?
  ├─ Skor ≥ 70 → OCR veri çıkarır → Excel ✓  (₺0 maliyet)
  ├─ Skor 20-70 → Gemini AI fallback → Excel ✓  (~₺0.01/fiş)
  └─ Skor < 20  → Reddedilir (fiş değil)
```

> **Neden OCR-First?** Tesseract ücretsizdir. Fiş yeterince okunabilirse Gemini'ye gerek kalmaz — aylık API maliyeti minimuma iner.

---

## 📋 Gereksinimler

| Araç | Açıklama | Kurulum |
|------|----------|---------|
| **Python 3.11+** | Runtime | [python.org](https://www.python.org/downloads/) |
| **Tesseract OCR** | Ücretsiz OCR motoru | `winget install UB-Mannheim.TesseractOCR` |
| **Google Gemini API** | AI fiş analizi (fallback) | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| **Google Chrome** | Eklenti çalıştırmak için | [chrome.com](https://www.google.com/chrome/) |

---

## 🚀 Kurulum

### 1. Klonla ve bağımlılıkları kur

```bash
git clone <repo-url>
cd WhatsApp-invoice-pipeline

python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Linux/macOS

pip install -r requirements.txt
```

### 2. Ortam dosyasını oluştur

```bash
cp .env.example .env
# .env dosyasını açın ve GEMINI_API_KEY değerini ayarlayın
```

### 3. API'yi başlat

```bash
# Development (auto-reload + debug log)
set ENV=development && python main.py

# Production
set ENV=production && python main.py

# veya doğrudan uvicorn ile
uvicorn main:app --host 0.0.0.0 --port 3000
```

### 4. Chrome Eklentisini Yükle

1. `chrome://extensions` adresini açın
2. Sağ üstten **Geliştirici modu**'nu açın
3. **Paketlenmemiş öğe yükle** → `chrome-extension/` klasörünü seçin
4. Araç çubuğundaki 🧾 simgesine tıklayın
5. ⚙️ butonundan API URL ve API Key ayarını yapın

---

## ⚙️ Yapılandırma

### Ortam Desteği (PROD / DEV)

`ENV` değişkeni ile ortam belirlenir. Her ortamın farklı varsayılan değerleri vardır:

| Değişken | Production (varsayılan) | Development |
|----------|------------------------|-------------|
| `HOST` | `0.0.0.0` | `127.0.0.1` |
| `LOG_LEVEL` | `WARNING` | `DEBUG` |
| `SAVE_IMAGES` | `false` | `true` |
| `RATE_LIMIT_RPM` | `30` | `100` |
| `MONTHLY_BUDGET_TL` | `200.0` | `50.0` |
| `MIN_CONFIDENCE_WARN` | `60` | `40` |

> **Öncelik sırası:** `.env.{ENV}` dosyası > `.env` dosyası > ortam varsayılanları

### Tüm .env Değişkenleri

| Değişken | Açıklama | Varsayılan |
|----------|----------|------------|
| `ENV` | Ortam (`production` / `development`) | `production` |
| `GEMINI_API_KEY` | Google Gemini API anahtarı | — (**zorunlu**) |
| `HOST` | Sunucu adresi | ortama göre |
| `PORT` | Sunucu portu | `3000` |
| `CORS_ORIGINS` | CORS izinleri (`*` veya origin listesi) | `*` |
| `EXCEL_DATA_DIR` | Günlük Excel dizini | `src/public/daily` |
| `IMAGES_DIR` | Debug görsel dizini | `src/public/images` |
| `SAVE_IMAGES` | Görselleri diske kaydet | ortama göre |
| `LOG_LEVEL` | Log seviyesi | ortama göre |
| `MIN_CONFIDENCE_WARN` | Güven uyarı eşiği | ortama göre |
| `MONTHLY_BUDGET_TL` | Aylık Gemini bütçesi (₺) | ortama göre |
| `USD_TL_RATE` | USD/TL kuru | `45.0` |
| `OCR_REJECT_THRESHOLD` | OCR red eşiği | `20` |
| `OCR_SUFFICIENT_THRESHOLD` | OCR yeterlilik eşiği | `70` |
| `API_SECRET` | API anahtar koruması | — (isteğe bağlı) |
| `RATE_LIMIT_RPM` | İstek limiti (req/dk) | ortama göre |

---

## 🔌 API Referansı

Tüm endpoint'ler `/v1` prefix'i altındadır.  
`API_SECRET` ayarlıysa `/v1/health` hariç tüm endpoint'ler `x-api-key` header'ı gerektirir.

### Fiş İşleme

#### `POST /v1/process-image`

Fiş görselini analiz eder, doğrular ve Excel'e yazar.

**Request:**
```json
{
  "image_base64": "<BASE64_ENCODED_IMAGE>",
  "mime_type": "image/jpeg",
  "sender": "chrome-extension",
  "request_id": "abc123",
  "timestamp": 1742428800000
}
```

| Alan | Tip | Zorunlu | Açıklama |
|------|-----|---------|----------|
| `image_base64` | string | ✅ | Base64 kodlanmış görsel (min 100 karakter) |
| `mime_type` | string | ✅ | `image/jpeg`, `image/png`, `image/webp`, `image/heic` |
| `sender` | string | — | Gönderen kaynağı (varsayılan: `chrome-extension`) |
| `request_id` | string | — | İstek ID (otomatik üretilir) |
| `timestamp` | integer | — | Unix timestamp (ms) |

**Response (200):**
```json
{
  "success": true,
  "row_number": 5,
  "confidence": 85,
  "source": "ocr",
  "summary": {
    "firma": "MİGROS",
    "tarih": "20/03/2026",
    "toplam": 245.90,
    "masraf": "Market",
    "odeme": "KART"
  },
  "excel_path": "src/public/daily",
  "processing_time_ms": 320
}
```

**Hata Kodları:**

| HTTP | Kod | Açıklama |
|------|-----|----------|
| 422 | `INVALID_BASE64` | Geçersiz base64 verisi |
| 422 | `IMAGE_TOO_LARGE` | Görsel > 10MB |
| 422 | `NOT_A_RECEIPT` | Görsel POS fişi değil |
| 429 | `BUDGET_EXCEEDED` | Aylık Gemini bütçesi doldu |
| 429 | `RATE_LIMITED` | İstek limiti aşıldı |
| 503 | `GEMINI_UNAVAILABLE` | Gemini AI geçici erişilemiyor |

---

### Sağlık & İzleme

#### `GET /v1/health` *(auth gerektirmez)*

```json
{
  "status": "healthy",
  "gemini_budget_remaining": "₺198.77 kaldı (~18400 fiş)",
  "prefilter_status": "OCR-First aktif | OCR çözüm: 12 | Gemini fallback: 3",
  "excel_row_count": 15,
  "uptime_seconds": 3600,
  "version": "1.0.0"
}
```

#### `GET /v1/stats`

```json
{
  "total_processed": 150,
  "total_errors": 3,
  "today_processed": 12,
  "average_confidence": 82.5,
  "average_processing_ms": 450.0,
  "top_stores": ["MİGROS", "BİM", "A101"],
  "prefilter_rejected": 5,
  "prefilter_confirmed": 100,
  "prefilter_uncertain": 42,
  "prefilter_bypassed": 3,
  "estimated_savings_tl": 0.85
}
```

#### `GET /v1/budget`

```json
{
  "budget_tl": 200.0,
  "month_cost_tl": 1.23,
  "remaining_tl": 198.77,
  "month_count": 150,
  "estimated_remaining_receipts": 18400,
  "est_cost_per_receipt_tl": 0.0108,
  "ocr_savings_tl": 0.85,
  "usage_percentage": 0.6,
  "status": "healthy",
  "message": "₺198.77 kaldı (~18400 fiş)"
}
```

#### `GET /v1/queue-status`

```json
{
  "active_processing": 1,
  "pending": 0,
  "recent_count": 15,
  "max_recent": 50
}
```

---

### Excel Dışa Aktarma

#### `GET /v1/export`
Bugünkü Excel dosyasını indirir.

#### `GET /v1/export?date=2026-03-20`
Belirli günün Excel dosyasını indirir.

#### `GET /v1/export-all`
Tüm günlük dosyaları birleştirilmiş tek Excel olarak indirir (özet sayfası dahil).

#### `GET /v1/daily-files`

```json
{
  "files": [
    { "date": "2026-03-20", "file": "2026-03-20.xlsx", "row_count": 12 },
    { "date": "2026-03-19", "file": "2026-03-19.xlsx", "row_count": 8 }
  ],
  "total": 2
}
```

---

### Son Sorgular

#### `GET /v1/recent-queries?limit=10`

```json
{
  "queries": [
    {
      "request_id": "abc12345",
      "timestamp": "2026-03-20T10:30:00+00:00",
      "firma": "MİGROS",
      "toplam": 125.50,
      "confidence": 85,
      "source": "ocr",
      "processing_time_ms": 320,
      "masraf": "Market",
      "tarih": "20/03/2026",
      "odeme": "KART",
      "status": "success"
    }
  ],
  "total": 15,
  "limit": 10
}
```

---

## 📊 Excel Çıktısı

Günlük dosyalar: `src/public/daily/YYYY-MM-DD.xlsx`

**14 sütunlu LUCA muhasebe uyumlu format:**

| # | Sütun | Açıklama |
|---|-------|----------|
| 1 | Belge Tarihi | Fiş tarihi (GG/AA/YYYY) |
| 2 | Belge No | Fiş numarası |
| 3 | Firma Unvanı | Mağaza adı |
| 4 | VKN/TCKN | Vergi kimlik numarası |
| 5 | Masraf İçeriği | Kategori (Market, Yemek, Akaryakıt…) |
| 6 | Matrah (₺) | KDV hariç tutar |
| 7 | KDV Oranı | %1, %8, %10, %18, %20 |
| 8 | KDV Tutarı (₺) | KDV tutarı |
| 9 | Genel Toplam (₺) | Toplam tutar |
| 10 | Ödeme Şekli | NAKİT / KART / HAVALE |
| 11 | Güven % | Doğrulama güven skoru (0-100) |
| 12 | Kaynak | OCR veya GEMINI |
| 13 | Gönderen | chrome-extension vb. |
| 14 | İşlem Zamanı | UTC zaman damgası |

---

## 📁 Proje Yapısı

```
WhatsApp-invoice-pipeline/
├── main.py                          # Entry point (FastAPI + Uvicorn)
├── .env.example                     # Ortam değişkenleri şablonu
├── requirements.txt                 # Python bağımlılıkları
├── README.md
│
├── src/                             # Tüm uygulama kodu
│   ├── __init__.py
│   ├── config.py                    # Merkezi yapılandırma (PROD/DEV)
│   ├── middleware.py                # Auth, rate-limit, body-size
│   ├── state.py                     # Paylaşılan state & singleton'lar
│   │
│   ├── models/                      # [M] Veri Modelleri
│   │   └── schemas.py               #     Pydantic request/response şemaları
│   │
│   ├── routes/                      # [C] Controller Katmanı
│   │   ├── process.py               #     POST /v1/process-image
│   │   ├── health.py                #     GET  /v1/health, /stats, /budget, /queue-status
│   │   ├── export.py                #     GET  /v1/export, /export-all, /daily-files
│   │   └── queries.py               #     GET  /v1/recent-queries
│   │
│   ├── services/                    # İş Mantığı Katmanı
│   │   ├── gemini_service.py        #     Gemini Vision AI + bütçe takibi
│   │   ├── excel_service.py         #     Günlük Excel dosya yönetimi
│   │   ├── ocr_prefilter.py         #     Tesseract OCR ön-filtre motoru
│   │   └── validator.py             #     Fiş doğrulama + güven skoru
│   │
│   ├── utils/                       # Yardımcı Araçlar
│   │   └── logger.py                #     Structured console logger
│   │
│   └── public/                      # Veri Çıktıları
│       ├── daily/                   #     Günlük Excel dosyaları
│       └── images/                  #     Debug görselleri
│
├── chrome-extension/                # Chrome Eklentisi (Manifest V3)
│   ├── manifest.json
│   ├── popup.html                   #     Popup HTML
│   ├── options.html                 #     Ayarlar sayfası HTML
│   ├── icons/                       #     Eklenti ikonları
│   ├── js/                          #     JavaScript modülleri
│   │   ├── popup.js                 #         Popup mantığı + tema yönetimi
│   │   └── options.js               #         Ayarlar mantığı
│   └── styles/                      #     CSS dosyaları
│       ├── theme.css                #         Dark/Light tema değişkenleri
│       ├── popup.css                #         Popup stilleri
│       └── options.css              #         Ayarlar stilleri
│
└── postman/                         # API Test Koleksiyonu
    └── Fatura_Bot_API.postman_collection.json
```

---

## 📱 Kullanım

1. **🧾 simgesine** tıklayın → popup açılır
2. **Görsel yükle**: sürükle-bırak, dosya seç, yapıştır (`Ctrl+V`) veya kamera
3. **Fişi Analiz Et** butonuna basın
4. **Sonuç** sekmesinde: firma, tarih, toplam, KDV, ödeme şekli
5. **Geçmiş** sekmesi: son işlenen fişlerin listesi
6. **Bütçe** sekmesi: aylık maliyet takibi ve OCR tasarruf
7. **İstatistik** sekmesi: işlem metrikleri ve en çok gidilen mağazalar
8. **Excel İndir** butonları ile günlük veya toplu dışa aktarma

---

## 🔒 Güvenlik

- **API Key Auth**: `API_SECRET` ayarlandığında tüm endpoint'ler (`/v1/health` hariç) `x-api-key` header'ı gerektirir
- **Rate Limiting**: IP bazlı sliding-window (varsayılan: 30 req/dk)
- **Body Size Limit**: Maksimum 15MB istek boyutu
- **Görsel Boyut Limiti**: Maksimum 10MB görsel

> ⚠️ **Önemli**: `.env` dosyanızı asla Git'e commit etmeyin. API anahtarlarınızı düzenli olarak rotate edin.

---

## 📝 Lisans

MIT — Detaylar için [LICENSE](LICENSE) dosyasına bakın.
