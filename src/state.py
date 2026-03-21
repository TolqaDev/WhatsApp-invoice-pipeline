"""Fatura Bot — Uygulama çapında paylaşılan durum nesneleri."""

import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone, date
from typing import Optional

from src.services.excel_service import ExcelService
from src.config import EXCEL_DATA_DIR


@dataclass
class RecentQuery:
    request_id: str
    timestamp: str
    firma: Optional[str]
    toplam: float
    confidence: int
    source: str
    processing_time_ms: int
    masraf: Optional[str] = None
    tarih: Optional[str] = None
    odeme: Optional[str] = None
    fis_no: Optional[str] = None
    vkn: Optional[str] = None
    matrah: Optional[float] = None
    kdv_oran: Optional[str] = None
    kdv_tutar: Optional[float] = None
    status: str = "success"
    row_number: Optional[int] = None
    file_date: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "request_id": self.request_id,
            "timestamp": self.timestamp,
            "firma": self.firma,
            "toplam": self.toplam,
            "confidence": self.confidence,
            "source": self.source,
            "processing_time_ms": self.processing_time_ms,
            "masraf": self.masraf,
            "tarih": self.tarih,
            "odeme": self.odeme,
            "fis_no": self.fis_no,
            "vkn": self.vkn,
            "matrah": self.matrah,
            "kdv_oran": self.kdv_oran,
            "kdv_tutar": self.kdv_tutar,
            "status": self.status,
            "row_number": self.row_number,
            "file_date": self.file_date,
        }


recent_queries: deque[RecentQuery] = deque(maxlen=50)

stats = {
    "total_processed": 0,
    "total_errors": 0,
    "ocr_sufficient": 0,
    "ocr_partial": 0,
    "prefilter_rejected": 0,
    "prefilter_bypassed": 0,
    "estimated_savings_tl": 0.0,
    "processing_times": deque(maxlen=1000),
    "confidences": deque(maxlen=1000),
    "daily_counts": defaultdict(int),
    "store_counts": defaultdict(int),
}

active_processing: int = 0

start_time = time.time()
excel_service = ExcelService(EXCEL_DATA_DIR)


def add_recent_query(
    request_id: str,
    receipt_data,
    confidence: int,
    source: str,
    processing_time_ms: int,
    status: str = "success",
    row_number: int = None,
):
    kdv_list = getattr(receipt_data, "kdv", None) or []
    kdv_oran = ", ".join(getattr(k, "oran", "") for k in kdv_list) if kdv_list else None
    kdv_tutar = sum(getattr(k, "tutar", 0) for k in kdv_list) if kdv_list else None
    matrah = sum(getattr(k, "matrah", 0) for k in kdv_list) if kdv_list else None

    recent_queries.appendleft(RecentQuery(
        request_id=request_id,
        timestamp=datetime.now(timezone.utc).isoformat(),
        firma=getattr(receipt_data, "firma", None),
        toplam=getattr(receipt_data, "toplam", 0.0),
        confidence=confidence,
        source=source,
        processing_time_ms=processing_time_ms,
        masraf=getattr(receipt_data, "masraf", None),
        tarih=getattr(receipt_data, "tarih", None),
        odeme=getattr(receipt_data, "odeme", None),
        fis_no=getattr(receipt_data, "fis_no", None),
        vkn=getattr(receipt_data, "vkn", None),
        matrah=matrah,
        kdv_oran=kdv_oran,
        kdv_tutar=kdv_tutar,
        status=status,
        row_number=row_number,
        file_date=date.today().isoformat(),
    ))
