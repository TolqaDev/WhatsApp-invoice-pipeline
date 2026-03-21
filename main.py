"""Fatura Bot — FastAPI POS receipt analysis service."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import (
    VERSION, GEMINI_API_KEY, HOST, PORT, LOG_LEVEL, ENV, IS_DEV,
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.setup(log_level=LOG_LEVEL)

    print("")
    print("=" * 42)
    print(f"  Fatura Bot -- Python API v{VERSION}")
    print(f"  Ortam: {ENV.upper()}")
    print("=" * 42)
    print("")

    logger.info("API starting", event="bot_started", version=VERSION)

    ocr_prefilter.reject_threshold = OCR_REJECT_THRESHOLD
    ocr_prefilter.ocr_sufficient_threshold = OCR_SUFFICIENT_THRESHOLD

    if not GEMINI_API_KEY or GEMINI_API_KEY == "your_key_here":
        logger.error("GEMINI_API_KEY not set! Check your .env file.")
        print("[!] GEMINI_API_KEY not set!")
    else:
        gemini_service.initialize(GEMINI_API_KEY, monthly_budget_tl=MONTHLY_BUDGET_TL, usd_tl_rate=USD_TL_RATE)
        print("[+] Gemini service ready")

    if SAVE_IMAGES:
        Path(IMAGES_DIR).mkdir(parents=True, exist_ok=True)

    print(f"[{'+'if TESSERACT_AVAILABLE else '!'}] Tesseract OCR {'ready' if TESSERACT_AVAILABLE else 'not found'}")
    print(f"[+] OCR thresholds: reject={OCR_REJECT_THRESHOLD}, sufficient={OCR_SUFFICIENT_THRESHOLD}")
    print(f"[+] Rate limit: {RATE_LIMIT_RPM} req/min")
    if API_SECRET:
        print("[+] API key auth enabled")
    print(f"[+] Budget: TL{MONTHLY_BUDGET_TL}/month")
    print(f"\n>>> http://{HOST}:{PORT} listening\n")

    logger.info("API ready", event="bot_ready", port=PORT, host=HOST)
    yield
    logger.info("API shutting down")


app = FastAPI(
    title="Fatura Bot API",
    version=VERSION,
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in CORS_ORIGINS.split(",")] if CORS_ORIGINS != "*" else ["*"],
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app", host=HOST, port=PORT,
        reload=IS_DEV, log_level=LOG_LEVEL.lower(),
        access_log=IS_DEV, server_header=False, date_header=False)
