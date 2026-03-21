"""Fatura Bot — Son sorgular ve satır güncelleme endpoint'leri."""

from datetime import date

from fastapi import APIRouter, Query, HTTPException

from src.models.schemas import RecentQueriesResponse, UpdateRowRequest, UpdateRowResponse
from src.state import recent_queries, excel_service

router = APIRouter(prefix="/v1", tags=["Queries"])


@router.get("/recent-queries", response_model=RecentQueriesResponse)
async def get_recent_queries(limit: int = Query(20, ge=1, le=50, description="Döndürülecek kayıt sayısı")):
    """Son işlenen fişlerin listesi."""
    items = [q.to_dict() for q in list(recent_queries)[:limit]]
    return RecentQueriesResponse(
        queries=items,
        total=len(recent_queries),
        limit=limit,
    )


@router.put("/update-row/{request_id}", response_model=UpdateRowResponse)
async def update_row(request_id: str, body: UpdateRowRequest):
    """Bir sorgunun Excel satırını güncelle."""
    # request_id ile sorguyu bul
    query = None
    for q in recent_queries:
        if q.request_id == request_id:
            query = q
            break

    if not query:
        raise HTTPException(status_code=404, detail={
            "success": False,
            "message": f"Sorgu bulunamadı: {request_id}"
        })

    if not query.row_number:
        raise HTTPException(status_code=400, detail={
            "success": False,
            "message": "Bu sorgunun satır numarası bilinmiyor, güncellenemez."
        })

    # Fişin tarihinden hangi dosyaya yazılacağını belirle
    target_date = None
    if query.file_date:
        try:
            target_date = date.fromisoformat(query.file_date)
        except (ValueError, TypeError):
            pass
    if not target_date:
        target_date = date.today()

    update_data = {}
    if body.firma is not None:
        update_data["firma"] = body.firma
    if body.tarih is not None:
        update_data["tarih"] = body.tarih
    if body.fis_no is not None:
        update_data["fis_no"] = body.fis_no
    if body.vkn is not None:
        update_data["vkn"] = body.vkn
    if body.toplam is not None:
        update_data["toplam"] = body.toplam
    if body.odeme is not None:
        update_data["odeme"] = body.odeme
    if body.masraf is not None:
        update_data["masraf"] = body.masraf
    if body.kdv_oran is not None:
        update_data["kdv_oran"] = body.kdv_oran
    if body.kdv_tutar is not None:
        update_data["kdv_tutar"] = body.kdv_tutar
    if body.matrah is not None:
        update_data["matrah"] = body.matrah

    if not update_data:
        raise HTTPException(status_code=400, detail={
            "success": False,
            "message": "Güncellenecek alan belirtilmedi."
        })

    success = await excel_service.update_row(query.row_number, update_data, target_date)

    if not success:
        raise HTTPException(status_code=404, detail={
            "success": False,
            "message": "Excel satırı bulunamadı veya güncellenemedi."
        })

    # Bellek içi sorgu verisini de güncelle
    if body.firma is not None:
        query.firma = body.firma
    if body.tarih is not None:
        query.tarih = body.tarih
    if body.toplam is not None:
        query.toplam = body.toplam
    if body.odeme is not None:
        query.odeme = body.odeme
    if body.masraf is not None:
        query.masraf = body.masraf
    if body.kdv_oran is not None:
        query.kdv_oran = body.kdv_oran
    if body.kdv_tutar is not None:
        query.kdv_tutar = body.kdv_tutar

    return UpdateRowResponse(success=True, message="Excel satırı başarıyla güncellendi")


