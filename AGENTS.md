# AGENTS.md — Fatura Bot (WhatsApp Invoice Pipeline)

## Architecture Overview

Three-component system for Turkish POS receipt scanning with AI: **Python API** (FastAPI :3000), **WhatsApp Bridge** (Node.js/Baileys :3001), **Chrome Extension** (MV3). All share a single root `.env` for config including `API_SECRET`.

**Data flow:** Image → Tesseract OCR pre-filter → (score ≥70: OCR-only extraction, 20–70: Gemini AI fallback, <20: rejected) → Validate → Double-entry accounting rows → Daily Excel (`public/daily/YYYY-MM-DD.xlsx`).

## Running the Project

```bash
# Terminal 1 — Python API (auto-reloads in dev)
python main.py

# Terminal 2 — WhatsApp Bridge (requires API_SECRET or exits)
cd whatsapp-baileys && npm start
```

Required env vars: `API_SECRET` (min 32 chars), `GEMINI_API_KEY`. Set `ENV=development` for debug logging and image saving. The Node bridge reads `.env` from project root (`../../.env` relative to its `src/`).

## Python API (`src/`)

- **Entry:** `main.py` — FastAPI app with lifespan, CORS, security middleware. All routes under `/v1`.
- **Config:** `src/config.py` — Env-aware defaults (prod vs dev). Uses `_get()` helper for env-specific fallbacks.
- **Routing pattern:** Each file in `src/routes/` creates `router = APIRouter(prefix="/v1")`. Routers are included in `main.py`.
- **Services are singletons:** `gemini_service`, `ocr_prefilter`, `excel_service`, `validator` — instantiated at module level, imported everywhere.
- **Shared state:** `src/state.py` holds in-memory stats, `recent_queries` deque (maxlen=50), and the `excel_service` instance.
- **Auth:** `src/middleware.py` — timing-safe `X-API-Key` check on all routes except `/v1/health`. IP-based sliding-window rate limiter.
- **Models:** `src/models/schemas.py` — All Pydantic v2 models. `ReceiptData` is the core domain object with `KdvKalem` list for multi-rate VAT.

## Key Domain Logic

- **OCR-First strategy** (`src/services/ocr_prefilter.py`): Tesseract with Turkish+English, image preprocessing (grayscale, contrast 2.0, sharpen). Keyword scoring (STRONG=15, MEDIUM=7, WEAK=3) plus bonuses for price patterns, dates, aspect ratio.
- **Gemini service** (`src/services/gemini_service.py`): Uses `google-genai` SDK (not `google-generativeai`). Model: `gemini-2.5-flash`. System prompt forces JSON-only Turkish receipt output. Monthly TL budget tracking with token-based cost calculation.
- **LUCA transformer** (`src/services/luca_transformer.py`): Converts receipts to double-entry accounting rows. Normal receipts → 3+ rows (expense DEBIT, VAT DEBIT per rate, payment CREDIT). Fuel/parking receipts get **KKEG 70/30 rule** → 5 rows with accounts 900/901. Balance validation: total DEBIT must equal total CREDIT.
- **Account code maps:** `MASRAF_HESAP_KODU` (770.xx), `KDV_HESAP_KODU` (191.xx), `ODEME_HESAP_KODU` (100.xx/102.xx). These are Turkish accounting standards.

## WhatsApp Bridge (`whatsapp-baileys/`)

- **ES Modules** (`"type": "module"` in package.json). Uses `@whiskeysockets/baileys` v6.
- **Boot guard:** `index.js` exits with code 1 if `API_SECRET` is missing.
- **Message flow:** `socket.js` receives image messages → filters by `ALLOW_JID` → `handler.js` downloads media → POSTs base64 to Python API `/v1/process-image` → emoji reaction (👀 processing, 👍 success, 👎 failure).
- **Queue system** (`queue.js`): Max 10 queued, concurrent processing limit. De-duplicates by message ID.
- **Auth persistence:** `public/whatsapp-auth/` — multi-file auth state from Baileys.

## Chrome Extension (`chrome-extension/`)

- Manifest V3. Pure vanilla JS (no framework). API calls in `js/api.js`, UI logic in `js/app.js`.
- Connects to both Python API (:3000) and Bridge (:3001). Stores API keys in `chrome.storage`.

## Conventions

- **Language:** Code comments, log messages, error messages, and variable names in domain context are in **Turkish**. Field names in models/schemas use Turkish (`firma`, `tarih`, `toplam`, `odeme`, `masraf`, `kdv`).
- **Logging:** Use `from src.utils.logger import logger` — structured kwargs logger (`logger.info("msg", event="name", key=value)`). Always include `event=` kwarg.
- **Error responses:** Consistent `{"success": false, "error_code": "SNAKE_CASE", "message": "Turkish text"}` format.
- **Excel output** uses the "Fiş Aktarım Şablon" sheet name and template from `src/templates/fis_aktarim_sablon.xlsx`.
- **No test suite** currently exists. No CI/CD configuration.
- **No ORM/database** — all data is file-based (Excel files in `public/daily/`, stats in memory).

