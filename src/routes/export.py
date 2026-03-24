"""Fatura Bot — Çoklu formatta (XLSX/CSV/XLS) dışa aktarma endpoint'leri."""

from datetime import date
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse, Response

from src.state import excel_service

router = APIRouter(prefix="/v1", tags=["Export"])

_MIME = {
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "xls": "application/vnd.ms-excel",
    "csv": "text/csv; charset=utf-8",
}

_EXT = {"xlsx": ".xlsx", "xls": ".xls", "csv": ".csv"}


def _validate_format(fmt: str) -> str:
    fmt = (fmt or "xlsx").lower().strip()
    if fmt not in _MIME:
        raise HTTPException(status_code=400, detail=f"Desteklenmeyen format: {fmt}. Geçerli: xlsx, csv, xls")
    return fmt


@router.get("/export")
async def export_excel(
    date_str: Optional[str] = Query(None, alias="date", description="YYYY-MM-DD"),
    fmt: str = Query("xlsx", alias="format", description="xlsx | csv | xls"),
):
    """Belirli günün veya bugünkü dosyayı seçilen formatta döndür."""
    fmt = _validate_format(fmt)

    target_date = None
    if date_str:
        try:
            target_date = date.fromisoformat(date_str)
        except ValueError:
            raise HTTPException(status_code=400, detail="Geçersiz tarih formatı. YYYY-MM-DD kullanın.")

    target_label = date_str or date.today().isoformat()

    if fmt == "xlsx":
        file_path = await excel_service.export_as_xlsx(target_date)
        if not file_path:
            raise HTTPException(status_code=404, detail=f"{target_label} tarihine ait dosya bulunamadı")
        return FileResponse(
            path=file_path,
            media_type=_MIME["xlsx"],
            filename=f"fis_aktarim_{target_label}.xlsx",
        )

    elif fmt == "csv":
        csv_bytes = await excel_service.export_as_csv(target_date)
        if not csv_bytes:
            raise HTTPException(status_code=404, detail=f"{target_label} tarihine ait dosya bulunamadı")
        return Response(
            content=csv_bytes,
            media_type=_MIME["csv"],
            headers={"Content-Disposition": f'attachment; filename="fis_aktarim_{target_label}.csv"'},
        )

    elif fmt == "xls":
        xls_bytes = await excel_service.export_as_xls(target_date)
        if not xls_bytes:
            raise HTTPException(status_code=404, detail=f"{target_label} tarihine ait dosya bulunamadı veya xlwt yüklü değil")
        return Response(
            content=xls_bytes,
            media_type=_MIME["xls"],
            headers={"Content-Disposition": f'attachment; filename="fis_aktarim_{target_label}.xls"'},
        )


@router.get("/export-all")
async def export_all_excel(
    fmt: str = Query("xlsx", alias="format", description="xlsx | csv | xls"),
):
    """Tüm günlük dosyaları birleştir ve seçilen formatta döndür."""
    fmt = _validate_format(fmt)

    result = await excel_service.export_all_combined(fmt=fmt)
    if not result:
        raise HTTPException(status_code=404, detail="Hiç fatura kaydı bulunamadı")

    filename_base = "tum_fis_aktarim"

    if fmt == "xlsx":
        # result = dosya yolu (str)
        return FileResponse(
            path=result,
            media_type=_MIME["xlsx"],
            filename=f"{filename_base}.xlsx",
        )
    elif fmt == "csv":
        return Response(
            content=result,
            media_type=_MIME["csv"],
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.csv"'},
        )
    elif fmt == "xls":
        return Response(
            content=result,
            media_type=_MIME["xls"],
            headers={"Content-Disposition": f'attachment; filename="{filename_base}.xls"'},
        )


@router.get("/daily-files")
async def list_daily_files():
    """Mevcut günlük dosyalarını listele."""
    files = await excel_service.list_daily_files()
    return {"files": files, "total": len(files)}

