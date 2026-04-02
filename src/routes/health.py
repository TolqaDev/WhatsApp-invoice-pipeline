"""Fatura Bot — Sağlık, istatistik, bütçe ve kuyruk durum endpoint'leri."""

import time
from datetime import datetime, timezone

from fastapi import APIRouter, Query

from src.config import VERSION
from src.models.schemas import HealthResponse, StatsResponse, BudgetResponse, QueueStatusResponse, ErrorsResponse
from src.services.gemini_service import gemini_service
from src.services.ocr_prefilter import TESSERACT_AVAILABLE
from src.state import stats, start_time, excel_service, active_processing, recent_queries, recent_errors

router = APIRouter(prefix="/v1", tags=["Monitoring"])


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Servis sağlık durumu."""
    row_count = await excel_service.get_row_count()
    uptime = int(time.time() - start_time)

    budget_info = "servisi başlatılmadı"
    if gemini_service.budget:
        b = gemini_service.budget
        budget_info = (
            f"₺{b.remaining_budget_tl:.2f} kaldı "
            f"(~{b.estimated_remaining_receipts} fiş) | "
            f"Bu ay: {b.month_count} fiş, ₺{b.month_cost_tl:.2f}")

    prefilter_info = (
        f"OCR-First {'aktif' if TESSERACT_AVAILABLE else 'devre dışı'} | "
        f"OCR çözüm: {stats['ocr_sufficient']} | "
        f"Gemini fallback: {stats['ocr_partial']} | "
        f"Reddedilen: {stats['prefilter_rejected']} | "
        f"Tasarruf: ₺{stats['estimated_savings_tl']:.4f}")

    return HealthResponse(
        status="healthy", gemini_budget_remaining=budget_info,
        prefilter_status=prefilter_info, excel_row_count=row_count,
        uptime_seconds=uptime, version=VERSION)


@router.get("/stats", response_model=StatsResponse)
async def get_stats():
    """İşlem istatistikleri."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    avg_confidence = 0.0
    if stats["confidences"]:
        avg_confidence = round(sum(stats["confidences"]) / len(stats["confidences"]), 1)

    avg_processing = 0.0
    if stats["processing_times"]:
        avg_processing = round(sum(stats["processing_times"]) / len(stats["processing_times"]), 1)

    top_stores = sorted(stats["store_counts"].items(), key=lambda x: x[1], reverse=True)[:5]

    today_errors = sum(1 for e in recent_errors if e.timestamp.startswith(today))

    return StatsResponse(
        total_processed=stats["total_processed"], total_errors=stats["total_errors"],
        today_processed=stats["daily_counts"].get(today, 0),
        today_errors=today_errors,
        average_confidence=avg_confidence, average_processing_ms=avg_processing,
        top_stores=[name for name, _ in top_stores],
        prefilter_rejected=stats["prefilter_rejected"],
        prefilter_confirmed=stats["ocr_sufficient"],
        prefilter_uncertain=stats["ocr_partial"],
        prefilter_bypassed=stats["prefilter_bypassed"],
        estimated_savings_tl=round(stats["estimated_savings_tl"], 4))


@router.get("/budget", response_model=BudgetResponse)
async def get_budget():
    """Detaylı aylık bütçe bilgisi."""
    if not gemini_service.budget:
        return BudgetResponse(
            budget_tl=0, month_cost_tl=0, remaining_tl=0,
            month_count=0, estimated_remaining_receipts=0,
            est_cost_per_receipt_tl=0, ocr_savings_tl=0,
            status="inactive", message="Gemini servisi başlatılmadı",
        )

    b = gemini_service.budget
    remaining = b.remaining_budget_tl
    usage_pct = round((b.month_cost_tl / b.budget_tl * 100) if b.budget_tl > 0 else 0, 1)

    if usage_pct >= 95:
        status = "critical"
    elif usage_pct >= 75:
        status = "warning"
    else:
        status = "healthy"

    return BudgetResponse(
        budget_tl=round(b.budget_tl, 2),
        month_cost_tl=round(b.month_cost_tl, 4),
        remaining_tl=round(remaining, 2),
        month_count=b.month_count,
        estimated_remaining_receipts=b.estimated_remaining_receipts,
        est_cost_per_receipt_tl=round(b.est_cost_per_receipt_tl, 4),
        ocr_savings_tl=round(stats["estimated_savings_tl"], 4),
        usage_percentage=usage_pct,
        status=status,
        message=f"₺{remaining:.2f} kaldı (~{b.estimated_remaining_receipts} fiş)",
    )


@router.get("/queue-status", response_model=QueueStatusResponse)
async def get_queue_status():
    """Kuyruk ve aktif işlem durumu."""
    return QueueStatusResponse(
        active_processing=active_processing,
        pending=0,
        recent_count=len(recent_queries),
        max_recent=recent_queries.maxlen or 50,
    )


@router.get("/errors", response_model=ErrorsResponse)
async def get_errors(limit: int = Query(50, ge=1, le=100, description="Döndürülecek hata sayısı")):
    """Son hata kayıtlarını döndürür."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    items = [e.to_dict() for e in list(recent_errors)[:limit]]
    today_count = sum(1 for e in recent_errors if e.timestamp.startswith(today))
    return ErrorsResponse(errors=items, total=len(recent_errors), today_count=today_count)
