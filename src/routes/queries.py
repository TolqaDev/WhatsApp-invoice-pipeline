"""Fatura Bot — Son sorgular ve satır güncelleme endpoint'leri."""

from datetime import date

from fastapi import APIRouter, Query, HTTPException

from src.models.schemas import RecentQueriesResponse, UpdateRowRequest, UpdateRowResponse
from src.state import recent_queries, excel_service

router = APIRouter(prefix="/v1", tags=["Queries"])


def _find_query(request_id: str) -> tuple:
    """recent_queries deque'unda request_id ile eşleşen sorguyu bul."""
    for i, q in enumerate(recent_queries):
        if q.request_id == request_id:
            return q, i
    return None, None


def _resolve_target_date(query) -> date:
    """Sorgunun dosya tarihini çözümle, bulunamazsa bugünü döndür."""
    if query.file_date:
        try:
            return date.fromisoformat(query.file_date)
        except (ValueError, TypeError):
            pass
    return date.today()


@router.get("/recent-queries", response_model=RecentQueriesResponse)
async def get_recent_queries(limit: int = Query(20, ge=1, le=50, description="Döndürülecek kayıt sayısı")):
    """Son işlenen fişlerin listesi."""
    items = [q.to_dict() for q in list(recent_queries)[:limit]]
    return RecentQueriesResponse(queries=items, total=len(recent_queries), limit=limit)


@router.delete("/delete-row/{request_id}")
async def delete_row(request_id: str):
    """Bir sorguyu ve Excel satırlarını sil."""
    query, query_idx = _find_query(request_id)
    if not query:
        raise HTTPException(status_code=404, detail={
            "success": False, "message": f"Sorgu bulunamadı: {request_id}"
        })

    if not query.row_number:
        del recent_queries[query_idx]
        return {"success": True, "message": "Sorgu bellekten silindi (Excel kaydı yoktu)", "deleted_rows": 0}

    target_date = _resolve_target_date(query)
    deleted_row = query.row_number
    result = await excel_service.delete_row(deleted_row, target_date)

    if result.get("deleted", 0) == 0:
        raise HTTPException(status_code=404, detail={
            "success": False, "message": result.get("error", "Excel satırı silinemedi")
        })

    deleted_count = result["deleted"]
    del recent_queries[query_idx]

    for q in recent_queries:
        if q.file_date == query.file_date and q.row_number and q.row_number > deleted_row:
            q.row_number = max(q.row_number - deleted_count, 2)

    return {"success": True, "message": f"Fiş ve {deleted_count} Excel satırı silindi", "deleted_rows": deleted_count}


@router.put("/update-row/{request_id}", response_model=UpdateRowResponse)
async def update_row(request_id: str, body: UpdateRowRequest):
    """Bir sorgunun Excel satırını güncelle."""
    query, _ = _find_query(request_id)
    if not query:
        raise HTTPException(status_code=404, detail={
            "success": False, "message": f"Sorgu bulunamadı: {request_id}"
        })

    if not query.row_number:
        raise HTTPException(status_code=400, detail={
            "success": False, "message": "Bu sorgunun satır numarası bilinmiyor, güncellenemez."
        })

    target_date = _resolve_target_date(query)

    update_fields = ["firma", "tarih", "fis_no", "vkn", "toplam", "odeme", "masraf", "kdv_oran", "kdv_tutar", "matrah"]
    update_data = {f: getattr(body, f) for f in update_fields if getattr(body, f) is not None}

    if not update_data:
        raise HTTPException(status_code=400, detail={
            "success": False, "message": "Güncellenecek alan belirtilmedi."
        })

    success = await excel_service.update_row(query.row_number, update_data, target_date)
    if not success:
        raise HTTPException(status_code=404, detail={
            "success": False, "message": "Excel satırı bulunamadı veya güncellenemedi."
        })

    for field in update_data:
        if hasattr(query, field):
            setattr(query, field, update_data[field])

    return UpdateRowResponse(success=True, message="Excel satırı başarıyla güncellendi")
