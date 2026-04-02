"""Fatura Bot — FastAPI POS receipt analysis service."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import (
    VERSION, GEMINI_API_KEY, HOST, PORT, LOG_LEVEL, ENV, IS_DEV, IS_PROD,
    MONTHLY_BUDGET_TL, USD_TL_RATE, SAVE_IMAGES, IMAGES_DIR,
    OCR_REJECT_THRESHOLD, OCR_SUFFICIENT_THRESHOLD,
    RATE_LIMIT_RPM, API_SECRET, CORS_ORIGINS,
)
from src.middleware import security_middleware
from src.services.gemini_service import gemini_service
from src.services.ocr_prefilter import ocr_prefilter, TESSERACT_AVAILABLE
from src.utils.logger import logger
from src.routes.process import router as process_router
from src.routes.health import router as health_router
from src.routes.export import router as export_router
from src.routes.queries import router as queries_router
from src.routes.whatsapp import router as whatsapp_router
from src.routes.luca import router as luca_router
from src.routes.notifications import router as notifications_router
from src.routes.terminal import router as terminal_router
from src.routes.settings import router as settings_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.setup(log_level=LOG_LEVEL)
    logger.info("API starting", event="bot_started", version=VERSION, env=ENV)

    ocr_prefilter.reject_threshold = OCR_REJECT_THRESHOLD
    ocr_prefilter.ocr_sufficient_threshold = OCR_SUFFICIENT_THRESHOLD

    if not GEMINI_API_KEY or GEMINI_API_KEY == "your_key_here":
        logger.error("GEMINI_API_KEY not set! Check your .env file.")
    else:
        gemini_service.initialize(GEMINI_API_KEY, monthly_budget_tl=MONTHLY_BUDGET_TL, usd_tl_rate=USD_TL_RATE)

    if SAVE_IMAGES:
        Path(IMAGES_DIR).mkdir(parents=True, exist_ok=True)

    logger.info("API ready", event="bot_ready", port=PORT, host=HOST,
                tesseract=TESSERACT_AVAILABLE, rate_limit=RATE_LIMIT_RPM,
                auth_enabled=bool(API_SECRET))
    yield
    logger.info("API shutting down", event="bot_shutdown")


app = FastAPI(
    title="Fatura Bot API",
    version=VERSION,
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

_cors_origins = (
    [o.strip() for o in CORS_ORIGINS.split(",") if o.strip()]
    if CORS_ORIGINS != "*"
    else ["*"]
)
if IS_PROD and _cors_origins == ["*"]:
    logger.warning("CORS allow_origins='*' production ortamında geniş kapsamlı — "
                    ".env dosyasında CORS_ORIGINS'i kısıtlamayı değerlendirin",
                    event="cors_wide_open")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

app.middleware("http")(security_middleware)

app.include_router(process_router)
app.include_router(health_router)
app.include_router(export_router)
app.include_router(queries_router)
app.include_router(whatsapp_router)
app.include_router(luca_router)
app.include_router(notifications_router)
app.include_router(terminal_router)
app.include_router(settings_router)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app", host=HOST, port=PORT,
        reload=IS_DEV, log_level=LOG_LEVEL.lower(),
        access_log=IS_DEV, server_header=False, date_header=False)
