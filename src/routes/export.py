"""Fatura Bot — Excel dışa aktarma endpoint'leri."""

from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from src.state import excel_service

router = APIRouter(prefix="/v1", tags=["Export"])


@router.get("/export")
async def export_excel(date_str: Optional[str] = Query(None, alias="date", description="YYYY-MM-DD")):
    """Belirli günün veya bugünkü Excel dosyasını döndür."""
    target_date = None
    if date_str:
        try:
            target_date = date.fromisoformat(date_str)
        except ValueError:
            raise HTTPException(status_code=400, detail="Geçersiz tarih formatı. YYYY-MM-DD kullanın.")

    file_path = await excel_service.get_file_path(target_date)
    if not file_path:
        target = date_str or date.today().isoformat()
        raise HTTPException(status_code=404, detail=f"{target} tarihine ait Excel dosyası bulunamadı")

    return FileResponse(
        path=file_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=Path(file_path).name)


@router.get("/export-all")
async def export_all_excel():
    """Tüm günlük Excel dosyalarını birleştir ve döndür."""
    combined_path = await excel_service.export_all_combined()
    if not combined_path:
        raise HTTPException(status_code=404, detail="Hiç fatura kaydı bulunamadı")

    return FileResponse(
        path=combined_path,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename="all_invoices.xlsx")


@router.get("/daily-files")
async def list_daily_files():
    """Mevcut günlük Excel dosyalarını listele."""
    files = await excel_service.list_daily_files()
    return {"files": files, "total": len(files)}

