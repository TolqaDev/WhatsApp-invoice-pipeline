"""Fatura Bot — Gemini API bildirim endpoint'leri."""

from fastapi import APIRouter
from pydantic import BaseModel

from src.services.notification_service import notification_service

router = APIRouter(prefix="/v1", tags=["Notifications"])


class NotificationResponse(BaseModel):
    notifications: list[dict]
    count: int


class DismissRequest(BaseModel):
    notification_id: str | None = None


class DismissResponse(BaseModel):
    success: bool
    dismissed_count: int


@router.get("/notifications", response_model=NotificationResponse)
async def get_notifications():
    """Aktif Gemini hata bildirimlerini döndür."""
    active = notification_service.active_notifications
    return NotificationResponse(notifications=active, count=len(active))


@router.post("/notifications/dismiss", response_model=DismissResponse)
async def dismiss_notification(body: DismissRequest):
    """Bildirimi kapat (tek veya tümü)."""
    if body.notification_id:
        ok = notification_service.dismiss(body.notification_id)
        return DismissResponse(success=ok, dismissed_count=1 if ok else 0)
    else:
        count = notification_service.dismiss_all()
        return DismissResponse(success=True, dismissed_count=count)

