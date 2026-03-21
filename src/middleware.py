"""Fatura Bot — Güvenlik middleware'leri."""

import time
import secrets
from collections import deque

from fastapi import Request
from fastapi.responses import JSONResponse

from src.config import API_SECRET, RATE_LIMIT_RPM, MAX_BODY_SIZE
from src.utils.logger import logger


class RateLimiter:
    __slots__ = ("_rpm", "_windows")

    def __init__(self, rpm: int = 30):
        self._rpm = rpm
        self._windows: dict[str, deque] = {}

    def is_allowed(self, client_ip: str) -> bool:
        now = time.monotonic()
        cutoff = now - 60.0

        if client_ip not in self._windows:
            self._windows[client_ip] = deque()

        window = self._windows[client_ip]
        while window and window[0] < cutoff:
            window.popleft()

        if len(window) >= self._rpm:
            return False

        window.append(now)
        return True

    def cleanup(self):
        now = time.monotonic()
        cutoff = now - 120.0
        empty_ips = [
            ip for ip, w in self._windows.items()
            if not w or w[-1] < cutoff
        ]
        for ip in empty_ips:
            del self._windows[ip]


rate_limiter = RateLimiter(RATE_LIMIT_RPM)


async def security_middleware(request: Request, call_next):
    client_ip = request.client.host if request.client else "unknown"
    path = request.url.path

    cl = request.headers.get("content-length")
    if cl:
        try:
            if int(cl) > MAX_BODY_SIZE:
                return JSONResponse(status_code=413, content={
                    "success": False, "error_code": "PAYLOAD_TOO_LARGE",
                    "message": "İstek boyutu çok büyük (max 15MB)"})
        except (ValueError, TypeError):
            return JSONResponse(status_code=400, content={
                "success": False, "error_code": "INVALID_HEADER",
                "message": "Geçersiz Content-Length header"})

    if API_SECRET and path not in ("/v1/health",):
        api_key = request.headers.get("x-api-key", "")
        if not api_key or not secrets.compare_digest(api_key, API_SECRET):
            logger.warning("Auth başarısız", event="auth_failed", ip=client_ip, path=path)
            return JSONResponse(status_code=401, content={
                "success": False, "error_code": "UNAUTHORIZED",
                "message": "Geçersiz veya eksik API anahtarı"})

    if not rate_limiter.is_allowed(client_ip):
        logger.warning("Rate limit", event="rate_limited", ip=client_ip)
        return JSONResponse(status_code=429, content={
            "success": False, "error_code": "RATE_LIMITED",
            "message": f"Çok fazla istek. Maks {RATE_LIMIT_RPM} istek/dk."})

    return await call_next(request)
