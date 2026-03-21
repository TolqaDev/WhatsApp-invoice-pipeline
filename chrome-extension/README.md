# Fatura Bot Manager — Chrome Addon

> **v1.0.0** — Fatura Bot API için geliştirilmiş Chrome Extension. POS fiş analizi, Excel dışa aktarma, bütçe takibi ve gerçek zamanlı istatistikler.

## ✨ Özellikler

### Panel (Dashboard)
- 📊 Toplam işlenen, bugünkü fiş sayısı, hata sayısı, Excel satır sayısı
- 💰 Gemini API bütçe durumu (ring chart ile kullanım yüzdesi)
- ❤️ Sistem sağlığı (uptime, durum, ortalama güven skoru, ortalama işleme süresi)
- 🔬 OCR Pipeline istatistikleri (OCR yeterli, Gemini fallback, reddedilen, bypass)
- 🏪 En çok işlenen mağazalar listesi
- 🖥 Çoklu sunucu yönetimi

### Fiş İşle (Process)
- 📷 Dosya yükleme (sürükle-bırak veya dosya seçici)
- 📋 Base64 yapıştırma desteği
- 🔄 MIME tipi seçimi (JPEG, PNG, WebP)
- ⚡ Gerçek zamanlı işleme durumu (OCR → Gemini AI → Excel)
- ✅ Detaylı sonuç görüntüleme (firma, tarih, toplam, masraf, ödeme, Excel satır)
- ❌ Hata durumunda detaylı hata mesajı

### Sorgular (Queries)
- 📋 Son işlenen fişlerin listesi (tablo görünümü)
- 🔍 Firma adına göre arama/filtreleme
- 📊 Güven skoru, kaynak (OCR/Gemini), işleme süresi, durum bilgisi
- 🔄 Yenileme desteği

### Dışa Aktar (Export)
- 📥 Bugünkü Excel dosyasını indirme
- 📦 Tüm günlük dosyaları birleştirip indirme
- 📅 Belirli tarihe göre Excel indirme
- 📁 Mevcut günlük dosyaların listesi

---

## 🛠 Kurulum

### 1. Chrome'a Yükleme

1. Chrome'da `chrome://extensions` adresine gidin
2. Sağ üstten **Geliştirici modu**'nu açın
3. **Paketlenmemiş öğe yükle** butonuna tıklayın
4. `chrome-extension` klasörünü seçin

### 2. API Bağlantısı

Extension API'ye erişmek için API Key kullanır. `.env` dosyasında `API_SECRET` tanımlayın.

### 3. Addon'da API Bağlantısı

1. Extension ikonuna tıklayın → **Panel** sekmesi açılır
2. Sol alttaki **⚙** (Sunucu Ayarları) butonuna tıklayın
3. "Yeni Ekle" sekmesinden sunucu adresi girin (varsayılan: `http://localhost:3000`)
4. Varsa API Key girin
5. **Test** ile bağlantıyı doğrulayın → **Ekle ve Bağlan**

---

## 📖 Kullanım

### Panel
- Bağlantı sonrası tüm istatistikler otomatik yüklenir
- Bütçe ring chart'ı kullanım oranına göre renk değiştirir (yeşil → sarı → kırmızı)
- Yenile butonu ile anlık güncelleme

### Fiş İşle
1. "Dosya" modunda görseli sürükle-bırak veya tıklayarak seçin
2. "Base64" modunda direkt base64 verisi yapıştırın
3. "Fişi İşle" butonuna tıklayın
4. Sonuç sağ panelde görüntülenir

### Sorgular
- Son 50 işlenmiş fiş listelenir
- Firma adına göre filtreleme yapılabilir
- Güven skorları renkli badge'lerle gösterilir (yeşil ≥80, sarı ≥50, kırmızı <50)

### Dışa Aktar
- "Bugünü İndir" ile günlük Excel dosyasını indirin
- "Tümünü Birleştir" ile tüm günleri tek dosyada indirin
- Tarih seçerek belirli bir günün dosyasını indirin
- Alt listede mevcut tüm günlük dosyalar görünür

---

## 🎨 Tasarım

- **Dark/Light tema** desteği (sol alt tema butonu)
- **Pencere boyutu**: 720×580 px
- **Ana renk**: `#00A884` (yeşil)
- **Arka plan**: `#0A0F14` (dark) / `#F0F2F5` (light)
- **Manifest V3** — Modern Chrome Extension API

---

## 🔒 Güvenlik

- API Key'ler Chrome'un güvenli `chrome.storage` API'sinde saklanır
- Tüm istekler `X-API-Key` header'ı ile gönderilir
- Hassas bilgiler loglanmaz

---

## 📋 API Endpoint'leri

| Endpoint | Metod | Açıklama |
|----------|-------|----------|
| `/v1/health` | GET | Servis sağlık durumu |
| `/v1/stats` | GET | İşlem istatistikleri |
| `/v1/budget` | GET | Bütçe bilgisi |
| `/v1/queue-status` | GET | Kuyruk durumu |
| `/v1/process-image` | POST | Fiş görselini işle |
| `/v1/recent-queries` | GET | Son sorgular |
| `/v1/export` | GET | Excel dışa aktarma |
| `/v1/export-all` | GET | Tüm günleri birleştir |
| `/v1/daily-files` | GET | Günlük dosya listesi |

---

## 📋 Gereksinimler

- Chrome 88+ veya uyumlu Chromium tabanlı tarayıcı
- Fatura Bot API'nin çalışır durumda olması
- API'ye erişim izni (localhost veya CORS whitelist)

---

## 🔧 Sorun Giderme

| Sorun | Çözüm |
|-------|-------|
| API bağlantısı kurulamadı | API sunucusunun çalıştığını ve URL'nin doğru olduğunu kontrol edin |
| CORS hatası | `.env` dosyasında `CORS_ORIGINS` ayarını kontrol edin |
| Fiş işlenemiyor | Görsel formatının desteklendiğinden emin olun (JPEG, PNG, WebP) |
| Excel indirme hatası | API'nin çalışır durumda olduğunu ve dosyanın mevcut olduğunu kontrol edin |
| Bütçe bilgisi görünmüyor | `GEMINI_API_KEY` ayarının `.env` dosyasında tanımlı olduğunu doğrulayın |

---

## 📜 Lisans

MIT

