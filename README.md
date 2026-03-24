<h1 align="center">🧾 Fatura Bot — POS Fiş Tarayıcı</h1>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white" alt="Python">
  <img src="https://img.shields.io/badge/FastAPI-0.111+-009688?logo=fastapi&logoColor=white" alt="FastAPI">
  <img src="https://img.shields.io/badge/Gemini_AI-2.5_Flash-4285F4?logo=google&logoColor=white" alt="Gemini">
  <img src="https://img.shields.io/badge/Node.js-18+-339933?logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/Chrome_Extension-MV3-4285F4?logo=googlechrome&logoColor=white" alt="Chrome">
  <img src="https://img.shields.io/badge/Lisans-MIT-green" alt="MIT">
</p>

<p align="center">
  AI destekli <strong>Türk POS fiş tarayıcı</strong> — görsel yükleyin, veriler otomatik Excel'e kaydedilsin.<br>
  Chrome eklentisi + WhatsApp entegrasyonu, <strong>OCR-First</strong> strateji ile maliyet optimizasyonu.
</p>

---

## 🏗️ Mimari

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  ┌──────────────────┐    HTTP/JSON   ┌────────────────────┐  │
│  │ Chrome Extension │◄─────────────►│  Python API        │  │
│  │   (Manifest V3)  │  :3000/v1     │  (FastAPI :3000)   │  │
│  │                  │               │                    │  │
│  │ • Sürükle-bırak  │               │ • OCR-First        │  │
│  │ • Yapıştır/Kamera │              │ • Gemini 2.5 Flash │  │
│  │ • Sonuç göster    │              │ • Günlük Excel     │  │
│  │ • Bütçe takibi    │              │ • Bütçe takip      │  │
│  │ • Excel indir     │              │ • Rate limit       │  │
│  │ • WA durumu       │              │ • API Key auth     │  │
│  └──────┬───────────┘               └────────┬───────────┘  │
│         │ :3001                               │              │
│         ▼                                     ▼              │
│  ┌──────────────────┐   görsel mesaj  ┌──────────────────┐   │
│  │ WhatsApp Bridge  │───────────────►│  Python API      │   │
│  │ (Node.js :3001)  │  POST /v1/     │  /v1/process-    │   │
│  │                  │  process-image │  image            │   │
│  │ • Baileys WA API │               │                   │   │
│  │ • QR bağlantı    │  X-API-Key ✓  │  → OCR → Gemini  │   │
│  │ • Emoji tepki    │               │  → Excel kayıt    │   │
│  │ • JID filtreleme │               │                   │   │
│  └──────────────────┘               └───────────────────┘   │
│                                                              │
│  public/                                                     │
│  ├── daily/          ← Günlük Excel dosyaları                │
│  ├── images/         ← Debug görselleri                      │
│  └── whatsapp-auth/  ← WA oturum dosyaları                  │
└──────────────────────────────────────────────────────────────┘
```

### İşlem Akışı (OCR-First Strateji)

```
Görsel → Tesseract OCR → Fiş mi?
  ├─ Skor ≥ 70 → OCR veri çıkarır → Excel ✓  (₺0 maliyet)
  ├─ Skor 20-70 → Gemini AI fallback → Excel ✓  (~₺0.01/fiş)
  └─ Skor < 20  → Reddedilir (fiş değil)
```

### İletişim Zinciri

| Kaynak | Hedef | Yöntem | Auth |
|--------|-------|--------|------|
| Extension → Python API | `:3000/v1/*` | HTTP | `X-API-Key` |
| Extension → WA Bridge | `:3001/status,qr,…` | HTTP | `X-API-Key` |
| WA Bridge → Python API | `:3000/v1/process-image` | HTTP | `X-API-Key` |
| Python API → WA Bridge | `:3001/status,qr,…` (proxy) | HTTP | `X-API-Key` |

> Tüm servisler aynı `API_SECRET` değerini paylaşır — tek .env dosyasından okunur.

---

## 📋 Gereksinimler

| Araç | Açıklama | Kurulum |
|------|----------|---------|
| **Python 3.11+** | Backend runtime | [python.org](https://www.python.org/downloads/) |
| **Node.js 18+** | WhatsApp bridge | [nodejs.org](https://nodejs.org/) |
| **Tesseract OCR** | Ücretsiz OCR motoru | `winget install UB-Mannheim.TesseractOCR` |
| **Google Gemini API** | AI fiş analizi (fallback) | [aistudio.google.com](https://aistudio.google.com/app/apikey) |
| **Google Chrome** | Eklenti çalıştırmak için | [chrome.com](https://www.google.com/chrome/) |

---

## 🚀 Kurulum

### 1. Klonla ve bağımlılıkları kur

```bash
git clone <repo-url>
cd WhatsApp-invoice-pipeline

# Python
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt

# Node.js (WhatsApp Bridge)
cd whatsapp-baileys
npm install
cd ..
```

### 2. Ortam dosyasını oluştur

```bash
cp .env.example .env
```

`.env` dosyasını açıp **en az** şu değerleri doldurun:

| Değişken | Açıklama |
|----------|----------|
| `API_SECRET` | Rastgele güçlü bir string (min 32 karakter) |
| `GEMINI_API_KEY` | Google AI Studio'dan ücretsiz anahtar |
| `ALLOW_JID` | WhatsApp'tan izin verilen telefon numaraları (virgülle çoklu) |

> ⚠️ Tek bir `.env` dosyası hem Python hem Node tarafını yapılandırır. `whatsapp-baileys/` içinde ayrı `.env` gerekmez.

### 3. Servisleri başlat

```bash
# Terminal 1 — Python API
python main.py

# Terminal 2 — WhatsApp Bridge
cd whatsapp-baileys
npm start
```

### 4. Chrome Eklentisini Yükle

1. `chrome://extensions` adresini açın
2. Sağ üstten **Geliştirici modu**'nu açın
3. **Paketlenmemiş öğe yükle** → `chrome-extension/` klasörünü seçin
4. Araç çubuğundaki 🧾 simgesine tıklayın
5. ⚙️ butonundan:
   - **Python API Adresi** → `http://localhost:3000`
   - **WhatsApp Köprü Adresi** → `http://localhost:3001`
   - **API Anahtarı** → `.env` dosyasındaki `API_SECRET` değeri

---

## ⚙️ Yapılandırma

### Ortam Desteği (PROD / DEV)

| Değişken | Production | Development |
|----------|-----------|-------------|
| `HOST` | `0.0.0.0` | `127.0.0.1` |
| `LOG_LEVEL` | `WARNING` | `DEBUG` |
| `SAVE_IMAGES` | `false` | `true` |
| `RATE_LIMIT_RPM` | `30` | `100` |
| `MONTHLY_BUDGET_TL` | `200.0` | `50.0` |

### Tüm .env Değişkenleri

#### Ortak

| Değişken | Açıklama | Varsayılan |
|----------|----------|------------|
| `ENV` | `production` / `development` | `production` |
| `API_SECRET` | API anahtarı (**zorunlu**) | — |
| `RATE_LIMIT_RPM` | İstek limiti (req/dk) | `30` |

#### Python API

| Değişken | Açıklama | Varsayılan |
|----------|----------|------------|
| `GEMINI_API_KEY` | Gemini API anahtarı (**zorunlu**) | — |
| `HOST` | Sunucu adresi | `0.0.0.0` |
| `PORT` | Sunucu portu | `3000` |
| `CORS_ORIGINS` | CORS izinleri | `*` |
| `EXCEL_DATA_DIR` | Günlük Excel dizini | `public/daily` |
| `IMAGES_DIR` | Debug görsel dizini | `public/images` |
| `SAVE_IMAGES` | Görselleri kaydet | `false` |
| `LOG_LEVEL` | Log seviyesi | ortama göre |
| `MONTHLY_BUDGET_TL` | Aylık Gemini bütçesi (₺) | `200.0` |
| `USD_TL_RATE` | USD/TL kuru | `45.0` |
| `OCR_REJECT_THRESHOLD` | OCR red eşiği | `20` |
| `OCR_SUFFICIENT_THRESHOLD` | OCR yeterlilik eşiği | `70` |

#### WhatsApp Bridge

| Değişken | Açıklama | Varsayılan |
|----------|----------|------------|
| `BRIDGE_PORT` | WhatsApp Bridge portu | `3001` |
| `ALLOW_JID` | İzinli numaralar (virgülle çoklu, ör: `905xx,905yy`) | boş (hepsi) |
| `QR_REFRESH_INTERVAL` | QR yenileme süresi (sn) | `30` |
| `NOTIFICATION_MUTE_INTERVAL` | Bildirim kapatma döngüsü (sn) | `30` |

---

## 🔌 API Referansı

Tüm endpoint'ler `/v1` prefix'i altındadır.  
`API_SECRET` zorunludur — `/v1/health` hariç tüm endpoint'ler `X-API-Key` header'ı gerektirir.

### Python API (`:3000`)

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| `GET` | `/v1/health` | Sağlık durumu *(auth gerektirmez)* |
| `GET` | `/v1/stats` | İstatistikler |
| `GET` | `/v1/budget` | Bütçe durumu |
| `GET` | `/v1/queue-status` | Kuyruk durumu |
| `POST` | `/v1/process-image` | Fiş görselini analiz et |
| `GET` | `/v1/recent-queries` | Son sorgular |
| `GET` | `/v1/export` | Günlük Excel indir |
| `GET` | `/v1/export-all` | Tüm günleri birleşik indir |
| `GET` | `/v1/daily-files` | Mevcut dosya listesi |
| `GET` | `/v1/whatsapp/status` | WA durum (proxy) |
| `GET` | `/v1/whatsapp/qr` | WA QR (proxy) |
| `POST` | `/v1/whatsapp/logout` | WA çıkış (proxy) |
| `POST` | `/v1/whatsapp/restart` | WA yeniden başlat (proxy) |

### WhatsApp Bridge (`:3001`)

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| `GET` | `/health` | Bridge sağlık durumu |
| `GET` | `/status` | Bağlantı durumu + detaylar |
| `GET` | `/qr` | QR kod (base64 data URI) |
| `POST` | `/logout` | Oturumu kapat |
| `POST` | `/restart` | Yeniden bağlan |

---

## 📊 Excel Çıktısı

Günlük dosyalar: `public/daily/YYYY-MM-DD.xlsx`

**Fiş Aktarım Şablon formatı — Çift kayıt muhasebe (LUCA / Logo / Mikro uyumlu):**

| # | Sütun | Format | Açıklama |
|---|-------|--------|----------|
| A | Fiş No | Metin | Fiş numarası |
| B | Fiş Tarihi | GG/AA/YYYY | Fiş tarihi |
| C | Fiş Açıklama | Metin | Firma adı |
| D | Hesap Kodu | Metin | Muhasebe hesap kodu (770.xx / 191.xx / 100.xx) |
| E | Evrak No | Metin | Evrak numarası |
| F | Evrak Tarihi | GG/AA/YYYY | Evrak tarihi |
| G | Detay Açıklama | Metin | Detay bilgi (masraf/KDV/ödeme) |
| H | Borç | #,##0.00 | Borç tutarı (gider + KDV) |
| I | Alacak | #,##0.00 | Alacak tutarı (ödeme) |
| J | Miktar | #,##0.00000 | Adet |
| K | Belge Tr | Metin | Belge türü (Kasa Fişi / Banka Fişi) |
| L | Para Birimi | Metin | TL |
| M | Kur | #,##0.00000000 | Döviz kuru |
| N | Döviz Tutarı | #,##0.00 | Döviz cinsinden tutar |

**Çift kayıt prensibi:** Her fiş için Borç toplamı = Alacak toplamı
- Gider hesabı → Borç (matrah)
- KDV hesabı → Borç (her oran için ayrı satır)
- Ödeme hesabı → Alacak (toplam)

**Dışa aktarım formatları:** XLSX, CSV (UTF-8 BOM, `;` ayraçlı), XLS (legacy)

---

## 📁 Proje Yapısı

```
WhatsApp-invoice-pipeline/
├── .env                              # Tüm yapılandırma (tek dosya)
├── .env.example                      # Ortam değişkenleri şablonu
├── main.py                           # Python entry point (FastAPI + Uvicorn)
├── requirements.txt                  # Python bağımlılıkları
├── README.md
│
├── public/                           # Veri Çıktıları
│   ├── daily/                        #   Günlük Excel dosyaları
│   ├── images/                       #   Debug görselleri
│   └── whatsapp-auth/                #   WA oturum dosyaları (gitignore)
│
├── src/                              # Python Uygulama (MVC)
│   ├── config.py                     #   Merkezi yapılandırma
│   ├── middleware.py                 #   Auth, rate-limit, body-size
│   ├── state.py                      #   Paylaşılan state
│   ├── models/                       #   [M] Pydantic şemaları
│   │   └── schemas.py
│   ├── routes/                       #   [C] Controller katmanı
│   │   ├── process.py                #       POST /v1/process-image
│   │   ├── health.py                 #       GET  /v1/health, stats, budget
│   │   ├── export.py                 #       GET  /v1/export, daily-files
│   │   ├── queries.py                #       GET  /v1/recent-queries
│   │   └── whatsapp.py               #       /v1/whatsapp/* (bridge proxy)
│   ├── services/                     #   İş mantığı katmanı
│   │   ├── gemini_service.py         #       Gemini Vision AI + bütçe
│   │   ├── excel_service.py          #       Excel dosya yönetimi
│   │   ├── ocr_prefilter.py          #       Tesseract OCR ön-filtre
│   │   └── validator.py              #       Fiş doğrulama + güven skoru
│   └── utils/
│       └── logger.py                 #       Structured console logger
│
├── whatsapp-baileys/                 # Node.js WhatsApp Bridge (MVC)
│   ├── package.json
│   └── src/
│       ├── index.js                  #   Bootstrap + boot guard
│       ├── config.js                 #   Yapılandırma (kök .env okur)
│       ├── middleware.js             #   Auth, CORS, rate-limit, güvenlik
│       ├── routes.js                 #   [C] Route handler'lar
│       ├── server.js                 #   Express app factory
│       ├── socket.js                 #   [S] WA bağlantı servisi
│       └── handler.js               #   [S] Görsel mesaj işleyici
│
├── chrome-extension/                 # Chrome Eklentisi (Manifest V3)
│   ├── manifest.json
│   ├── popup.html
│   ├── js/
│   │   ├── api.js                    #   Python + Bridge API client
│   │   ├── app.js                    #   Uygulama mantığı
│   │   └── utils.js                  #   Yardımcı fonksiyonlar
│   └── styles/
│       └── main.css
│
└── postman/                          # API Test Koleksiyonu
    └── fatura-bot.postman_collection.json
```

---

## 🔒 Güvenlik

| Katman | Python API | WhatsApp Bridge |
|--------|-----------|-----------------|
| **Auth** | `X-API-Key` header (timing-safe) | `X-API-Key` header (timing-safe) |
| **Boot Guard** | — | `API_SECRET` yoksa başlamaz |
| **Rate Limit** | IP bazlı sliding-window | IP bazlı sliding-window |
| **Body Limit** | 15MB max | 15MB max |
| **Headers** | — | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` |
| **CORS** | Yapılandırılabilir | `*` (bridge) |
| **JID Filter** | — | `ALLOW_JID` ile numara kısıtlama |
| **404/500** | FastAPI default | Özel JSON yanıtlar |

> ⚠️ `.env` dosyasını asla Git'e commit etmeyin. `API_SECRET` değerini düzenli olarak rotate edin.

---

## 📝 Lisans

MIT — Detaylar için [LICENSE](LICENSE) dosyasına bakın.
