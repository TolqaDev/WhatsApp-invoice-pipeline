"""Fatura Bot — Merkezi yapılandırma modülü (PROD / DEV ortam desteği)."""

import os
from pathlib import Path
from dotenv import load_dotenv

_PROJECT_ROOT = Path(__file__).resolve().parent.parent

load_dotenv(_PROJECT_ROOT / ".env")

ENV = os.getenv("ENV", "production").lower()
IS_DEV = ENV in ("development", "dev", "test")
IS_PROD = not IS_DEV

_env_specific = _PROJECT_ROOT / f".env.{ENV}"
if _env_specific.exists():
    load_dotenv(_env_specific, override=True)

VERSION = "1.0.0"

_DEFAULTS = {
    "production": {
        "HOST": "0.0.0.0",
        "PORT": "3000",
        "LOG_LEVEL": "WARNING",
        "SAVE_IMAGES": "false",
        "CORS_ORIGINS": "*",
        "RATE_LIMIT_RPM": "30",
        "MONTHLY_BUDGET_TL": "200.0",
        "MIN_CONFIDENCE_WARN": "60",
    },
    "development": {
        "HOST": "127.0.0.1",
        "PORT": "3000",
        "LOG_LEVEL": "DEBUG",
        "SAVE_IMAGES": "true",
        "CORS_ORIGINS": "*",
        "RATE_LIMIT_RPM": "100",
        "MONTHLY_BUDGET_TL": "50.0",
        "MIN_CONFIDENCE_WARN": "40",
    },
}

_defaults = _DEFAULTS.get(ENV, _DEFAULTS.get("development" if IS_DEV else "production"))


def _get(key: str, fallback: str = "") -> str:
    """Ortam değişkenini oku; yoksa ortama uygun varsayılanı döndür."""
    return os.getenv(key, _defaults.get(key, fallback))


GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
HOST = _get("HOST")
PORT = int(_get("PORT", "3000"))

EXCEL_DATA_DIR = os.getenv("EXCEL_DATA_DIR", "src/public/daily")
SAVE_IMAGES = _get("SAVE_IMAGES", "false").lower() == "true"
IMAGES_DIR = os.getenv("IMAGES_DIR", "src/public/images")

LOG_LEVEL = _get("LOG_LEVEL", "INFO")
MIN_CONFIDENCE_WARN = int(_get("MIN_CONFIDENCE_WARN", "60"))

MONTHLY_BUDGET_TL = float(_get("MONTHLY_BUDGET_TL", "200.0"))
USD_TL_RATE = float(os.getenv("USD_TL_RATE", "45.0"))

OCR_REJECT_THRESHOLD = int(os.getenv("OCR_REJECT_THRESHOLD", "20"))
OCR_SUFFICIENT_THRESHOLD = int(os.getenv("OCR_SUFFICIENT_THRESHOLD", "70"))

API_SECRET = os.getenv("API_SECRET", "")
RATE_LIMIT_RPM = int(_get("RATE_LIMIT_RPM", "30"))
CORS_ORIGINS = _get("CORS_ORIGINS", "*")
MAX_BODY_SIZE = 15 * 1024 * 1024
MAX_IMAGE_SIZE_MB = 10

if IS_PROD and not API_SECRET:
    import warnings
    warnings.warn(
        "⚠ API_SECRET tanımlanmamış! Production ortamında tüm endpoint'ler korumasız.",
        RuntimeWarning,
        stacklevel=1,
    )

_BRIDGE_PORT = os.getenv("BRIDGE_PORT", "3001")
WHATSAPP_BRIDGE_URL = f"http://127.0.0.1:{_BRIDGE_PORT}"

