"""Fatura Bot — WhatsApp Baileys Bridge proxy route'ları."""

import httpx
from fastapi import APIRouter, HTTPException

from src.config import WHATSAPP_BRIDGE_URL, API_SECRET

router = APIRouter(prefix="/v1/whatsapp", tags=["WhatsApp"])

_TIMEOUT = 15.0
_HEADERS = {"X-API-Key": API_SECRET} if API_SECRET else {}


async def _proxy_get(path: str):
    """Node.js bridge'e GET isteği proxy'le."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.get(f"{WHATSAPP_BRIDGE_URL}{path}", headers=_HEADERS)
            return resp.json()
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


async def _proxy_post(path: str):
    """Node.js bridge'e POST isteği proxy'le."""
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            resp = await client.post(f"{WHATSAPP_BRIDGE_URL}{path}", headers=_HEADERS)
            return resp.json()
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


@router.get("/status")
async def whatsapp_status():
    """WhatsApp bağlantı durumunu sorgula."""
    return await _proxy_get("/status")


@router.get("/qr")
async def whatsapp_qr():
    """QR kodu al (base64 PNG data URI)."""
    return await _proxy_get("/qr")


@router.post("/logout")
async def whatsapp_logout():
    """WhatsApp oturumunu kapat."""
    return await _proxy_post("/logout")


@router.post("/restart")
async def whatsapp_restart():
    """WhatsApp bağlantısını yeniden başlat."""
    return await _proxy_post("/restart")

