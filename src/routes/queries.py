"""Fatura Bot — Son sorgular ve satır güncelleme endpoint'leri (Excel-tabanlı, restart-dayanıklı)."""

from datetime import date, timedelta
from typing import Optional

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


def _resolve_target_date_from_id(request_id: str) -> date:
    """request_id'den dosya tarihini çöz (excel_YYYY-MM-DD_ROW formatı)."""
    if request_id.startswith("excel_"):
        parts = request_id.split("_")
        if len(parts) >= 2:
            try:
                return date.fromisoformat(parts[1])
            except (ValueError, TypeError):
                pass
    return date.today()


def _resolve_target_date(query) -> date:
    """Sorgunun dosya tarihini çözümle, bulunamazsa bugünü döndür."""
    if query.file_date:
        try:
            return date.fromisoformat(query.file_date)
        except (ValueError, TypeError):
            pass
    return date.today()


@router.get("/recent-queries", response_model=RecentQueriesResponse)
async def get_recent_queries(
    limit: int = Query(20, ge=1, le=50, description="Döndürülecek kayıt sayısı"),
    target_date: Optional[str] = Query(None, description="Excel dosya tarihi (YYYY-MM-DD)")
):
    """Son işlenen fişlerin listesi — Excel dosyasından okunur (restart-dayanıklı)."""
    try:
        if target_date:
            d = date.fromisoformat(target_date)
        else:
            d = date.today()
    except ValueError:
        d = date.today()

    # Excel'den oku (restart'a dayanıklı)
    items = await excel_service.read_queries_from_excel(target_date=d, limit=limit)
    return RecentQueriesResponse(queries=items, total=len(items), limit=limit)


@router.delete("/delete-row/{request_id}")
async def delete_row(request_id: str):
    """Bir sorguyu ve Excel satırlarını sil."""
    # Önce bellekte ara
    query, query_idx = _find_query(request_id)

    if query:
        # Bellekteki sorgu
        if not query.row_number:
            del recent_queries[query_idx]
            return {"success": True, "message": "Sorgu bellekten silindi (Excel kaydı yoktu)", "deleted_rows": 0}
        target_date = _resolve_target_date(query)
        row_number = query.row_number
    elif request_id.startswith("excel_"):
        # Excel-tabanlı sorgu (bellekte yok ama Excel'de var)
        target_date = _resolve_target_date_from_id(request_id)
        parts = request_id.split("_")
        try:
            row_number = int(parts[2]) if len(parts) >= 3 else None
        except (ValueError, IndexError):
            row_number = None
        if not row_number:
            raise HTTPException(status_code=400, detail={
                "success": False, "message": "Geçersiz request_id formatı"
            })
    else:
        raise HTTPException(status_code=404, detail={
            "success": False, "message": f"Sorgu bulunamadı: {request_id}"
        })

    result = await excel_service.delete_row(row_number, target_date)

    if result.get("deleted", 0) == 0:
        raise HTTPException(status_code=404, detail={
            "success": False, "message": result.get("error", "Excel satırı silinemedi")
        })

    deleted_count = result["deleted"]

    # Bellekteki sorguyu da sil (varsa)
    if query and query_idx is not None:
        del recent_queries[query_idx]
        for q in recent_queries:
            if q.file_date == query.file_date and q.row_number and q.row_number > row_number:
                q.row_number = max(q.row_number - deleted_count, 2)

    return {"success": True, "message": f"Fiş ve {deleted_count} Excel satırı silindi", "deleted_rows": deleted_count}


@router.put("/update-row/{request_id}", response_model=UpdateRowResponse)
async def update_row(request_id: str, body: UpdateRowRequest):
    """Bir sorgunun Excel satırını güncelle."""
    # Önce bellekte ara
    query, _ = _find_query(request_id)

    if query:
        row_number = query.row_number
        target_date = _resolve_target_date(query)
    elif request_id.startswith("excel_"):
        # Excel-tabanlı sorgu
        target_date = _resolve_target_date_from_id(request_id)
        parts = request_id.split("_")
        try:
            row_number = int(parts[2]) if len(parts) >= 3 else None
        except (ValueError, IndexError):
            row_number = None
    else:
        raise HTTPException(status_code=404, detail={
            "success": False, "message": f"Sorgu bulunamadı: {request_id}"
        })

    if not row_number:
        raise HTTPException(status_code=400, detail={
            "success": False, "message": "Bu sorgunun satır numarası bilinmiyor, güncellenemez."
        })

    update_fields = ["firma", "tarih", "fis_no", "vkn", "toplam", "odeme", "masraf", "kdv_oran", "kdv_tutar", "matrah"]
    update_data = {f: getattr(body, f) for f in update_fields if getattr(body, f) is not None}

    if not update_data:
        raise HTTPException(status_code=400, detail={
            "success": False, "message": "Güncellenecek alan belirtilmedi."
        })

    success = await excel_service.update_row(row_number, update_data, target_date)
    if not success:
        raise HTTPException(status_code=404, detail={
            "success": False, "message": "Excel satırı bulunamadı veya güncellenemedi."
        })

    # Bellekteki sorguyu da güncelle (varsa)
    if query:
        for field in update_data:
            if hasattr(query, field):
                setattr(query, field, update_data[field])

    return UpdateRowResponse(success=True, message="Excel satırı başarıyla güncellendi")
