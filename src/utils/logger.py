"""Fatura Bot — Python API structured console logger."""

import logging
import sys
from datetime import datetime, timezone
from typing import Callable


class ColorFormatter(logging.Formatter):
    COLORS = {
        "DEBUG": "\033[36m",
        "INFO": "\033[32m",
        "WARNING": "\033[33m",
        "ERROR": "\033[31m",
        "CRITICAL": "\033[1;31m",
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        color = self.COLORS.get(record.levelname, self.RESET)
        timestamp = datetime.now().strftime("%H:%M:%S")
        msg = record.getMessage()
        extra_str = ""
        if hasattr(record, "extra_data") and isinstance(record.extra_data, dict):
            extra_str = " | " + " ".join(f"{k}={v}" for k, v in record.extra_data.items())
        return f"{color}[{timestamp}] {record.levelname:<8}{self.RESET} {msg}{extra_str}"


class LogEventBus:
    """Basit event bus — log event'lerini SSE stream'e yönlendirir."""

    def __init__(self):
        self._listeners: list[Callable] = []

    def on(self, callback: Callable):
        self._listeners.append(callback)

    def off(self, callback: Callable):
        self._listeners = [cb for cb in self._listeners if cb is not callback]

    def emit(self, data: dict):
        for cb in self._listeners:
            try:
                cb(data)
            except Exception:
                pass


log_event_bus = LogEventBus()


class StructuredLogger:
    def __init__(self, name: str = "python-api"):
        self._logger = logging.getLogger(name)
        self._logger.setLevel(logging.DEBUG)
        self._logger.propagate = False

    def setup(self, log_level: str = "INFO"):
        if self._logger.handlers:
            return

        level = getattr(logging, log_level.upper(), logging.INFO)
        self._logger.setLevel(level)

        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setLevel(level)
        console_handler.setFormatter(ColorFormatter())
        self._logger.addHandler(console_handler)

    def _log(self, level: int, message: str, **kwargs):
        extra = {"extra_data": kwargs} if kwargs else {}
        self._logger.log(level, message, extra=extra)

        level_name = logging.getLevelName(level).lower()
        category = kwargs.get("event", "system")
        bus_data = {k: v for k, v in kwargs.items() if k != "event"} if kwargs else None
        log_event_bus.emit({
            "level": level_name,
            "category": category,
            "message": message,
            "data": bus_data or None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })

    def debug(self, message: str, **kwargs):
        self._log(logging.DEBUG, message, **kwargs)

    def info(self, message: str, **kwargs):
        self._log(logging.INFO, message, **kwargs)

    def warning(self, message: str, **kwargs):
        self._log(logging.WARNING, message, **kwargs)

    def error(self, message: str, **kwargs):
        self._log(logging.ERROR, message, **kwargs)

    def critical(self, message: str, **kwargs):
        self._log(logging.CRITICAL, message, **kwargs)

    def exception(self, message: str, **kwargs):
        extra = {"extra_data": kwargs} if kwargs else {}
        self._logger.exception(message, extra=extra)

        category = kwargs.get("event", "system")
        bus_data = {k: v for k, v in kwargs.items() if k != "event"} if kwargs else None
        log_event_bus.emit({
            "level": "error",
            "category": category,
            "message": message,
            "data": bus_data or None,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })


logger = StructuredLogger()

