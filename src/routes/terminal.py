"""Fatura Bot — Terminal log SSE stream endpoint'leri."""

import asyncio
import json
from collections import deque
from datetime import datetime, timezone

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from src.utils.logger import logger, log_event_bus

router = APIRouter(prefix="/v1", tags=["Terminal"])

_log_history: deque[dict] = deque(maxlen=1000)
_log_counter = 0
_sse_queues: list[asyncio.Queue] = []


def _on_log_event(data: dict):
    """Logger event bus'tan gelen log'ları yakalayıp SSE client'lara iletir."""
    global _log_counter
    _log_counter += 1
    entry = {
        "id": _log_counter,
        "timestamp": data.get("timestamp", datetime.now(timezone.utc).isoformat()),
        "level": data.get("level", "info"),
        "category": data.get("category", "system"),
        "message": data.get("message", ""),
        "data": data.get("data"),
    }
    _log_history.append(entry)

    dead_queues = []
    for q in _sse_queues:
        try:
            q.put_nowait(entry)
        except asyncio.QueueFull:
            dead_queues.append(q)
    for q in dead_queues:
        if q in _sse_queues:
            _sse_queues.remove(q)


log_event_bus.on(_on_log_event)


@router.get("/terminal/stream")
async def terminal_stream(request: Request):
    """SSE endpoint — canlı terminal log akışı."""
    queue: asyncio.Queue = asyncio.Queue(maxsize=500)
    _sse_queues.append(queue)

    async def event_generator():
        try:
            welcome = json.dumps({
                "id": 0,
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "level": "info",
                "category": "system",
                "message": "Terminal stream bağlantısı kuruldu",
                "data": {"connectedClients": len(_sse_queues), "historyCount": len(_log_history)},
            })
            yield f"data: {welcome}\n\n"

            for entry in list(_log_history):
                yield f"data: {json.dumps(entry)}\n\n"

            while True:
                if await request.is_disconnected():
                    break
                try:
                    entry = await asyncio.wait_for(queue.get(), timeout=30.0)
                    yield f"data: {json.dumps(entry)}\n\n"
                except asyncio.TimeoutError:
                    yield ":heartbeat\n\n"

        except (asyncio.CancelledError, GeneratorExit):
            pass
        finally:
            if queue in _sse_queues:
                _sse_queues.remove(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.delete("/terminal/logs")
async def clear_terminal_logs():
    """Terminal log geçmişini temizle."""
    global _log_counter
    cleared = len(_log_history)
    _log_history.clear()
    _log_counter = 0
    logger.info("Terminal log geçmişi temizlendi", event="terminal_cleared", cleared_count=cleared)

    return {"success": True, "cleared": cleared, "message": f"{cleared} log girişi temizlendi"}

