"""Fatura Bot — Runtime ayar güncelleme endpoint'leri."""

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional, List

from src.config import WHATSAPP_BRIDGE_URL, API_SECRET
from src.services.gemini_service import gemini_service
from src.utils.logger import logger

router = APIRouter(prefix="/v1/settings", tags=["Settings"])

_TIMEOUT = 15.0
_HEADERS = {"X-API-Key": API_SECRET} if API_SECRET else {}


# ─── Gemini Config ───────────────────────────────────

class GeminiConfigRequest(BaseModel):
    api_key: str = Field(..., min_length=10, description="Gemini API anahtarı")
    monthly_budget_tl: Optional[float] = Field(None, ge=0, description="Aylık TL bütçe limiti")
    usd_tl_rate: Optional[float] = Field(None, ge=0, description="USD/TL kuru")


class GeminiConfigResponse(BaseModel):
    success: bool
    message: str
    model: Optional[str] = None
    monthly_budget_tl: Optional[float] = None
    usd_tl_rate: Optional[float] = None


@router.get("/gemini")
async def get_gemini_config():
    """Mevcut Gemini yapılandırma durumunu döndürür."""
    is_active = gemini_service.is_active
    budget_info = {}
    if gemini_service.budget:
        b = gemini_service.budget
        budget_info = {
            "monthly_budget_tl": b.budget_tl,
            "usd_tl_rate": b.usd_tl_rate,
            "month_cost_tl": round(b.month_cost_tl, 4),
            "remaining_tl": round(b.remaining_budget_tl, 2),
            "month_count": b.month_count,
        }

    return {
        "success": True,
        "active": is_active,
        "model": gemini_service.model_name if is_active else None,
        "has_api_key": is_active,
        **budget_info,
    }


@router.put("/gemini", response_model=GeminiConfigResponse)
async def update_gemini_config(req: GeminiConfigRequest):
    """Gemini API anahtarını ve bütçe ayarlarını runtime'da günceller."""
    try:
        budget_tl = req.monthly_budget_tl or 200.0
        usd_rate = req.usd_tl_rate or 45.0

        gemini_service.initialize(
            api_key=req.api_key,
            monthly_budget_tl=budget_tl,
            usd_tl_rate=usd_rate,
        )

        logger.info("Gemini ayarları güncellendi", event="gemini_config_updated",
                     monthly_budget_tl=budget_tl, usd_tl_rate=usd_rate)

        return GeminiConfigResponse(
            success=True,
            message="Gemini ayarları başarıyla güncellendi",
            model=gemini_service.model_name,
            monthly_budget_tl=budget_tl,
            usd_tl_rate=usd_rate,
        )
    except Exception as e:
        logger.error("Gemini ayar güncelleme hatası", event="gemini_config_error", error=str(e))
        raise HTTPException(status_code=400, detail={
            "success": False,
            "error_code": "GEMINI_CONFIG_ERROR",
            "message": f"Gemini yapılandırma hatası: {str(e)}",
        })


# ─── JID Config (Bridge Proxy) ──────────────────────

class JidConfigRequest(BaseModel):
    jids: List[str] = Field(..., description="İzinli JID numaraları listesi")


@router.get("/jids")
async def get_allowed_jids():
    """Bridge'den mevcut izinli JID listesini alır."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{WHATSAPP_BRIDGE_URL}/config/jids", headers=_HEADERS)
            return resp.json()
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail={
            "success": False,
            "error_code": "BRIDGE_UNAVAILABLE",
            "message": "WhatsApp köprüsüne bağlanılamadı",
        })


@router.put("/jids")
async def update_allowed_jids(req: JidConfigRequest):
    """Bridge üzerinden izinli JID listesini günceller."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.put(
                f"{WHATSAPP_BRIDGE_URL}/config/jids",
                headers=_HEADERS,
                json={"jids": req.jids},
            )
            data = resp.json()

            if resp.status_code == 200:
                logger.info("JID listesi güncellendi", event="jid_config_updated",
                            jid_count=len(req.jids))
            return data
    except httpx.ConnectError:
        raise HTTPException(status_code=502, detail={
            "success": False,
            "error_code": "BRIDGE_UNAVAILABLE",
            "message": "WhatsApp köprüsüne bağlanılamadı",
        })
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail={
            "success": False,
            "error_code": "BRIDGE_TIMEOUT",
            "message": "WhatsApp köprüsü yanıt vermedi",
        })

