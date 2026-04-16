"""Fatura Bot — Ana fiş işleme endpoint'i."""

import re
import asyncio
import base64
import time
import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from datetime import datetime, timezone

from src.config import MAX_IMAGE_SIZE_MB, SAVE_IMAGES, IMAGES_DIR, MIN_CONFIDENCE_WARN
from src.models.schemas import (
    ImageProcessRequest, ProcessResponse, ProcessSummary, ReceiptData,
)
from src.services.gemini_service import (
    gemini_service, GeminiRateLimitError, GeminiUnavailableError, BudgetExceededError,
)
from src.services.notification_service import notification_service
from src.services.ocr_prefilter import ocr_prefilter
from src.services.validator import validator
from src.state import stats, excel_service, add_recent_query, active_processing, add_error_record
from src import state
from src.utils.logger import logger

router = APIRouter(prefix="/v1", tags=["Processing"])

_SAFE_FILENAME_RE = re.compile(r'[^a-zA-Z0-9_\-]')


def _sanitize_filename(name: str) -> str:
    return _SAFE_FILENAME_RE.sub('_', name)[:100]


def _save_debug_image(image_bytes: bytes, request_id: str, mime_type: str):
    ext_map = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/heic": ".heic"}
    ext = ext_map.get(mime_type, ".bin")
    safe_name = _sanitize_filename(request_id)
    file_path = Path(IMAGES_DIR) / f"{safe_name}{ext}"
    file_path.parent.mkdir(parents=True, exist_ok=True)
    file_path.write_bytes(image_bytes)
    logger.debug("Görsel kaydedildi", path=str(file_path))


@router.post("/process-image", response_model=ProcessResponse)
async def process_image(request: ImageProcessRequest):
    """Fiş görselini analiz et ve Excel'e kaydet."""
    start = time.time()

    sender = request.sender or "chrome-extension"
    request_id = request.request_id or str(uuid.uuid4())[:8]
    if request.timestamp is None:
        request.timestamp = int(time.time() * 1000)

    state.active_processing += 1

    try:
        try:
            image_bytes = base64.b64decode(request.image_base64)
            image_size_mb = len(image_bytes) / (1024 * 1024)
            if image_size_mb > MAX_IMAGE_SIZE_MB:
                add_error_record("IMAGE_TOO_LARGE", f"Görsel çok büyük: {image_size_mb:.1f}MB (max {MAX_IMAGE_SIZE_MB}MB)", sender, request_id)
                raise HTTPException(status_code=422, detail={
                    "success": False, "error_code": "IMAGE_TOO_LARGE",
                    "message": f"Görsel çok büyük: {image_size_mb:.1f}MB (max {MAX_IMAGE_SIZE_MB}MB)",
                })
        except HTTPException:
            raise
        except Exception:
            add_error_record("INVALID_BASE64", "Geçersiz base64 verisi", sender, request_id)
            raise HTTPException(status_code=422, detail={
                "success": False, "error_code": "INVALID_BASE64",
                "message": "Geçersiz base64 verisi",
            })

        if SAVE_IMAGES:
            _save_debug_image(image_bytes, request_id, request.mime_type)

        ocr_result = await asyncio.to_thread(
            ocr_prefilter.analyze, image_bytes, request.mime_type
        )

        if not ocr_result.is_receipt:
            stats["prefilter_rejected"] += 1
            if gemini_service.budget:
                stats["estimated_savings_tl"] += gemini_service.budget.est_cost_per_receipt_tl
            logger.info("OCR: Fiş değil, reddedildi",
                        event="ocr_rejected", sender=sender,
                        ocr_score=ocr_result.confidence)
            add_error_record("NOT_A_RECEIPT", "Gönderilen görsel bir POS fişi olarak tanınamadı", sender, request_id)
            raise HTTPException(status_code=422, detail={
                "success": False, "error_code": "NOT_A_RECEIPT",
                "message": "Gönderilen görsel bir POS fişi olarak tanınamadı",
                "prefilter_score": ocr_result.confidence,
                "prefilter_detail": ocr_result.detail,
            })

        receipt_data = None
        source = "gemini"

        if ocr_result.decision == "OCR_SUFFICIENT":
            extracted = ocr_prefilter.get_extracted_data(ocr_result)
            if extracted:
                receipt_data = ReceiptData(**extracted)
                source = "ocr"
                stats["ocr_sufficient"] += 1
                if gemini_service.budget:
                    stats["estimated_savings_tl"] += gemini_service.budget.est_cost_per_receipt_tl
                logger.info("OCR başarılı, Gemini atlandı",
                            event="ocr_sufficient", sender=sender,
                            ext_score=ocr_result.extraction_score)

        if receipt_data is None:
            if ocr_result.decision in ("BYPASS", "ERROR_BYPASS"):
                stats["prefilter_bypassed"] += 1
            else:
                stats["ocr_partial"] += 1

            logger.info(f"Gemini'ye yönlendiriliyor ({ocr_result.decision})",
                        event="gemini_fallback", sender=sender,
                        cls_score=ocr_result.confidence, ext_score=ocr_result.extraction_score)

            receipt_data = await gemini_service.analyze_receipt(image_bytes, request.mime_type)
            source = "gemini"

        if receipt_data.hata:
            logger.warning("Görsel fiş değil", event="not_a_receipt",
                           sender=sender, error=receipt_data.hata)
            add_error_record("NOT_A_RECEIPT", f"Görsel fiş değil: {receipt_data.hata}", sender, request_id)
            raise HTTPException(status_code=422, detail={
                "success": False, "error_code": "NOT_A_RECEIPT",
                "message": "Gönderilen görsel bir POS fişi değil",
            })

        confidence, warnings = validator.validate(receipt_data)
        if confidence < MIN_CONFIDENCE_WARN:
            logger.warning("Düşük güven skoru", event="low_confidence",
                           confidence=confidence, warnings=warnings)

        row_number = await excel_service.add_row(receipt_data, confidence, sender, source)

        processing_time = int((time.time() - start) * 1000)

        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        stats["total_processed"] += 1
        stats["processing_times"].append(processing_time)
        stats["confidences"].append(confidence)
        stats["daily_counts"][today] += 1
        if receipt_data.firma:
            stats["store_counts"][receipt_data.firma] += 1

        add_recent_query(
            request_id=request_id,
            receipt_data=receipt_data,
            confidence=confidence,
            source=source,
            processing_time_ms=processing_time,
            row_number=row_number,
        )

        logger.info(f"Fiş işlendi [{source.upper()}]",
                    event="image_processed", sender=sender,
                    request_id=request_id, confidence=confidence,
                    store=receipt_data.firma, total=receipt_data.toplam,
                    processing_ms=processing_time, excel_row=row_number, source=source)

        kdv_oran_str = ", ".join(k.oran for k in receipt_data.kdv) if receipt_data.kdv else None

        return ProcessResponse(
            success=True, row_number=row_number, confidence=confidence, source=source,
            summary=ProcessSummary(
                firma=receipt_data.firma, tarih=receipt_data.tarih,
                toplam=receipt_data.toplam, masraf=receipt_data.masraf,
                odeme=receipt_data.odeme,
                matrah=receipt_data.matrah_toplam if receipt_data.kdv else None,
                kdv_oran=kdv_oran_str,
                kdv_tutar=receipt_data.kdv_toplam if receipt_data.kdv else None),
            excel_path=excel_service.current_filename, processing_time_ms=processing_time)

    except HTTPException:
        stats["total_errors"] += 1
        raise
    except BudgetExceededError:
        stats["total_errors"] += 1
        budget = gemini_service.budget
        add_error_record("BUDGET_EXCEEDED", f"Aylık bütçe doldu (₺{budget.month_cost_tl:.2f}/₺{budget.budget_tl:.2f})", sender, request_id)
        # sender_jid: "whatsapp:905..." → "905..."
        sender_jid = sender.replace("whatsapp:", "") if sender.startswith("whatsapp:") else None
        await notification_service.notify_gemini_failure(
            "BUDGET_EXCEEDED",
            f"₺{budget.month_cost_tl:.2f}/₺{budget.budget_tl:.2f}",
            sender_jid=sender_jid,
        )
        raise HTTPException(status_code=429, detail={
            "success": False, "error_code": "BUDGET_EXCEEDED",
            "message": f"Aylık bütçe doldu (₺{budget.month_cost_tl:.2f}/₺{budget.budget_tl:.2f}). Yönetici ile iletişime geçin."})
    except GeminiRateLimitError:
        stats["total_errors"] += 1
        add_error_record("RATE_LIMITED", "Gemini API rate limit aşıldı", sender, request_id)
        sender_jid = sender.replace("whatsapp:", "") if sender.startswith("whatsapp:") else None
        await notification_service.notify_gemini_failure("RATE_LIMITED", "Rate limit aşıldı", sender_jid=sender_jid)
        raise HTTPException(status_code=429, detail={
            "success": False, "error_code": "RATE_LIMITED",
            "message": "Gemini API rate limit aşıldı. Birkaç dakika bekleyin."})
    except GeminiUnavailableError:
        stats["total_errors"] += 1
        add_error_record("GEMINI_UNAVAILABLE", "AI servisi geçici olarak erişilemiyor", sender, request_id)
        sender_jid = sender.replace("whatsapp:", "") if sender.startswith("whatsapp:") else None
        await notification_service.notify_gemini_failure("GEMINI_UNAVAILABLE", "Servis erişilemez", sender_jid=sender_jid)
        raise HTTPException(status_code=503, detail={
            "success": False, "error_code": "GEMINI_UNAVAILABLE",
            "message": "AI servisi geçici olarak erişilemiyor. Yönetici ile iletişime geçin."})
    except Exception as e:
        stats["total_errors"] += 1
        add_error_record("INTERNAL_ERROR", f"Beklenmeyen hata: {str(e)}", sender, request_id)
        logger.exception("Beklenmeyen hata", event="unknown_error", error=str(e))
        raise HTTPException(status_code=500, detail={
            "success": False, "error_code": "INTERNAL_ERROR",
            "message": "Beklenmeyen bir hata oluştu"})
    finally:
        state.active_processing = max(state.active_processing - 1, 0)

