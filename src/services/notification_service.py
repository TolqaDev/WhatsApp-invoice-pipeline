"""Fatura Bot — Gemini API hata bildirimi servisi."""

import asyncio
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from src.utils.logger import logger


@dataclass
class GeminiNotification:
    id: str
    error_type: str
    message: str
    timestamp: str
    dismissed: bool = False


_MESSAGES = {
    "BUDGET_EXCEEDED": "⚠️ Gemini AI aylık bütçe limiti doldu. Yeni fişler sadece OCR ile işlenebilir. Lütfen yönetici ile iletişime geçin.",
    "RATE_LIMITED": "⚠️ Gemini AI istek limiti aşıldı. Birkaç dakika bekleyin veya yönetici ile iletişime geçin.",
    "GEMINI_UNAVAILABLE": "⚠️ Gemini AI servisi geçici olarak erişilemiyor. Lütfen yönetici ile iletişime geçin.",
}

_WA_MESSAGES = {
    "BUDGET_EXCEEDED": "⚠️ *Fatura Bot Uyarı*\n\nGemini AI aylık bütçe limiti doldu.\nYeni fişler sadece OCR ile işlenebilir.\n\n_Lütfen yönetici ile iletişime geçin._",
    "RATE_LIMITED": "⚠️ *Fatura Bot Uyarı*\n\nGemini AI istek limiti aşıldı.\nBirkaç dakika bekleyip tekrar deneyin.\n\n_Lütfen yönetici ile iletişime geçin._",
    "GEMINI_UNAVAILABLE": "⚠️ *Fatura Bot Uyarı*\n\nGemini AI servisi geçici olarak erişilemiyor.\n\n_Lütfen yönetici ile iletişime geçin._",
}


class NotificationService:
    """Gemini API hata bildirimlerini yönetir."""

    COOLDOWN_SECONDS = 300

    def __init__(self):
        self._notifications: deque[GeminiNotification] = deque(maxlen=20)
        self._last_sent: dict[str, float] = {}
        self._counter = 0

    @property
    def active_notifications(self) -> list[dict]:
        """Aktif (dismissed olmayan) bildirimleri döndür."""
        return [
            {"id": n.id, "error_type": n.error_type, "message": n.message, "timestamp": n.timestamp}
            for n in self._notifications
            if not n.dismissed
        ]

    def dismiss(self, notification_id: str) -> bool:
        """Bildirimi kapat."""
        for n in self._notifications:
            if n.id == notification_id:
                n.dismissed = True
                return True
        return False

    def dismiss_all(self) -> int:
        """Tüm bildirimleri kapat."""
        count = 0
        for n in self._notifications:
            if not n.dismissed:
                n.dismissed = True
                count += 1
        return count

    async def notify_gemini_failure(self, error_type: str, detail: str = ""):
        """Gemini hatası bildirimini oluştur ve WhatsApp'a gönder (cooldown kontrolü ile)."""
        now = time.time()
        last = self._last_sent.get(error_type, 0)

        if now - last < self.COOLDOWN_SECONDS:
            logger.debug(
                "Bildirim cooldown içinde, atlanıyor",
                event="notification_cooldown",
                error_type=error_type,
                remaining=int(self.COOLDOWN_SECONDS - (now - last)),
            )
            return

        self._last_sent[error_type] = now
        self._counter += 1

        notification = GeminiNotification(
            id=f"notif_{self._counter}_{int(now)}",
            error_type=error_type,
            message=_MESSAGES.get(error_type, f"⚠️ AI servisi hatası: {error_type}"),
            timestamp=datetime.now(timezone.utc).isoformat(),
        )
        self._notifications.appendleft(notification)

        logger.warning(
            "Gemini API hata bildirimi oluşturuldu",
            event="gemini_notification",
            error_type=error_type,
            detail=detail,
        )

        asyncio.create_task(self._send_wa_notification(error_type))

    async def _send_wa_notification(self, error_type: str):
        """WhatsApp Bridge'e bildirim mesajı gönder."""
        try:
            from src.config import API_SECRET, WHATSAPP_BRIDGE_URL

            wa_message = _WA_MESSAGES.get(error_type, f"⚠️ AI servisi hatası: {error_type}")

            headers = {"Content-Type": "application/json"}
            if API_SECRET:
                headers["X-API-Key"] = API_SECRET

            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(
                    f"{WHATSAPP_BRIDGE_URL}/send-notification",
                    json={"message": wa_message, "error_type": error_type},
                    headers=headers,
                )
                if resp.status_code == 200:
                    logger.info(
                        "WhatsApp bildirim gönderildi",
                        event="wa_notification_sent",
                        error_type=error_type,
                    )
                else:
                    logger.warning(
                        "WhatsApp bildirim gönderilemedi",
                        event="wa_notification_failed",
                        status=resp.status_code,
                    )
        except Exception as e:
            logger.debug(
                "WhatsApp bildirim gönderimi başarısız (bridge kapalı olabilir)",
                event="wa_notification_error",
                error=str(e),
            )


notification_service = NotificationService()

