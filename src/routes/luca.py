"""Fatura Bot — LUCA muhasebe dönüşüm endpoint'leri.

Ham fiş verilerini doğrudan LUCA formatına dönüştürme ve doğrulama API'leri.
"""

from datetime import date
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from src.services.luca_transformer import (
    transform_to_luca_df,
    validate_luca_balance,
    LucaBalanceError,
    LUCA_COLUMNS,
)
from src.utils.logger import logger


router = APIRouter(prefix="/v1", tags=["LUCA"])



class LucaKdvItem(BaseModel):
    oran: str = Field(..., description="KDV oranı, örn: '%20'")
    matrah: float = Field(..., description="KDV matrahı")
    tutar: float = Field(..., description="KDV tutarı")


class LucaReceiptInput(BaseModel):
    fis_no: str = Field(..., description="Fiş / fatura numarası")
    tarih: str = Field(..., description="Tarih (GG/AA/YYYY)")
    firma: str = Field(..., description="Firma / satıcı adı")
    toplam: float = Field(..., gt=0, description="Toplam tutar (KDV dahil)")
    kdv_orani: Optional[str] = Field(
        None, description="Tekli KDV oranı, örn: '%20'. kdv alanı verilmişse yoksayılır."
    )
    kdv: Optional[list[LucaKdvItem]] = Field(
        None, description="Çoklu KDV kırılımı (opsiyonel)"
    )
    odeme: str = Field("KART", description="Ödeme yöntemi: NAKİT | KART | HAVALE")
    masraf: Optional[str] = Field(
        "Market", description="Masraf kategorisi: Market, Yemek, Akaryakıt vb."
    )
    plaka: Optional[str] = Field(
        None, description="Araç plaka numarası (Akaryakıt/Otopark fişlerinde)"
    )
    is_binek_auto: Optional[bool] = Field(
        None,
        description=(
            "Binek otomobil gider kısıtlaması (70/30). "
            "None (varsayılan) → firma adı/masraf tipinden otomatik tespit. "
            "True → zorla uygula. False → zorla atla (ticari araç)."
        ),
    )


class LucaTransformRequest(BaseModel):
    fisler: list[LucaReceiptInput] = Field(..., min_length=1)


class LucaRowOutput(BaseModel):
    fis_no: str
    fis_tarihi: str
    fis_aciklama: str
    hesap_kodu: str
    evrak_no: str
    evrak_tarihi: str
    detay_aciklama: str
    borc: float
    alacak: float
    miktar: float
    belge_turu: str
    para_birimi: str
    kur: float
    doviz_tutar: float


class LucaTransformResponse(BaseModel):
    success: bool = True
    fis_sayisi: int
    satir_sayisi: int
    toplam_borc: float
    toplam_alacak: float
    denklik: bool
    rows: list[dict]




@router.post("/luca-transform", response_model=LucaTransformResponse)
async def luca_transform(request: LucaTransformRequest):
    """Ham fiş listesini LUCA muhasebe şablonuna dönüştürür.

    Çift-taraflı muhasebe kuralı uygulanır:
    - Gider hesabı → BORÇ (matrah)
    - KDV hesabı   → BORÇ (oran başına ayrı satır)
    - Ödeme hesabı → ALACAK (toplam)

    Borç = Alacak denkliği doğrulanır.
    """
    try:
        raw_list = [fis.model_dump() for fis in request.fisler]
        df = transform_to_luca_df(raw_list, validate_balance=True)

        toplam_borc = round(df["Borç"].sum(), 2)
        toplam_alacak = round(df["Alacak"].sum(), 2)

        rows = df.to_dict(orient="records")

        logger.info(
            "LUCA dönüşüm endpoint çağrıldı",
            event="luca_transform_api",
            fis_sayisi=len(request.fisler),
            satir_sayisi=len(rows),
        )

        return LucaTransformResponse(
            success=True,
            fis_sayisi=len(request.fisler),
            satir_sayisi=len(rows),
            toplam_borc=toplam_borc,
            toplam_alacak=toplam_alacak,
            denklik=toplam_borc == toplam_alacak,
            rows=rows,
        )

    except LucaBalanceError as e:
        raise HTTPException(status_code=422, detail={
            "success": False,
            "error_code": "BALANCE_ERROR",
            "message": str(e),
        })
    except Exception as e:
        logger.error("LUCA dönüşüm hatası", event="luca_transform_error", error=str(e))
        raise HTTPException(status_code=500, detail={
            "success": False,
            "error_code": "TRANSFORM_ERROR",
            "message": f"Dönüşüm hatası: {str(e)}",
        })


@router.post("/luca-export")
async def luca_export(
    request: LucaTransformRequest,
    fmt: str = Query("csv", alias="format", description="csv | json"),
):
    """Ham fiş listesini LUCA formatında dışa aktarır.

    - csv: UTF-8 BOM, noktalı virgül ayraçlı CSV (LUCA import uyumlu)
    - json: JSON dizisi
    """
    try:
        raw_list = [fis.model_dump() for fis in request.fisler]
        df = transform_to_luca_df(raw_list, validate_balance=True)

        fmt = (fmt or "csv").lower().strip()

        if fmt == "json":
            return df.to_dict(orient="records")

        elif fmt == "csv":
            csv_content = df.to_csv(index=False, sep=";", encoding="utf-8")
            csv_bytes = ("\ufeff" + csv_content).encode("utf-8")
            return Response(
                content=csv_bytes,
                media_type="text/csv; charset=utf-8",
                headers={
                    "Content-Disposition": 'attachment; filename="luca_fis_aktarim.csv"',
                },
            )
        else:
            raise HTTPException(status_code=400, detail=f"Desteklenmeyen format: {fmt}")

    except LucaBalanceError as e:
        raise HTTPException(status_code=422, detail={
            "success": False,
            "error_code": "BALANCE_ERROR",
            "message": str(e),
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error("LUCA export hatası", event="luca_export_error", error=str(e))
        raise HTTPException(status_code=500, detail={
            "success": False,
            "error_code": "EXPORT_ERROR",
            "message": f"Export hatası: {str(e)}",
        })


@router.post("/luca-validate")
async def luca_validate(request: LucaTransformRequest):
    """Fiş listesini LUCA formatına dönüştürür ve borç/alacak denkliğini doğrular."""
    try:
        raw_list = [fis.model_dump() for fis in request.fisler]
        df = transform_to_luca_df(raw_list, validate_balance=False)

        is_valid, message = validate_luca_balance(df)

        toplam_borc = round(df["Borç"].sum(), 2)
        toplam_alacak = round(df["Alacak"].sum(), 2)

        return {
            "success": True,
            "valid": is_valid,
            "message": message,
            "fis_sayisi": len(request.fisler),
            "satir_sayisi": len(df),
            "toplam_borc": toplam_borc,
            "toplam_alacak": toplam_alacak,
            "fark": round(abs(toplam_borc - toplam_alacak), 2),
        }

    except Exception as e:
        logger.error("LUCA doğrulama hatası", event="luca_validate_error", error=str(e))
        raise HTTPException(status_code=500, detail={
            "success": False,
            "error_code": "VALIDATE_ERROR",
            "message": f"Doğrulama hatası: {str(e)}",
        })

