"""Fatura Bot — Pydantic request/response modelleri."""

from __future__ import annotations
from typing import Optional
from pydantic import BaseModel, Field, field_validator


class ImageProcessRequest(BaseModel):
    image_base64: str = Field(..., min_length=100)
    mime_type: str = Field(...)
    sender: str = Field(default="chrome-extension")
    request_id: Optional[str] = Field(default=None)
    timestamp: Optional[int] = Field(default=None, gt=0)

    @field_validator("mime_type")
    @classmethod
    def validate_mime_type(cls, v: str) -> str:
        allowed = {"image/jpeg", "image/png", "image/webp", "image/heic"}
        if v not in allowed:
            raise ValueError(f"Desteklenmeyen görsel formatı: {v}")
        return v


class KdvKalem(BaseModel):
    oran: str
    matrah: float
    tutar: float


class ReceiptData(BaseModel):
    tarih: Optional[str] = None
    fis_no: Optional[str] = None
    firma: Optional[str] = None
    vkn: Optional[str] = None
    masraf: Optional[str] = None
    kdv: list[KdvKalem] = Field(default_factory=list)
    toplam: float = 0.0
    odeme: Optional[str] = None
    plaka: Optional[str] = None
    is_binek_auto: Optional[bool] = None
    hata: Optional[str] = None

    @property
    def matrah_toplam(self) -> float:
        return sum(k.matrah for k in self.kdv) if self.kdv else 0.0

    @property
    def kdv_toplam(self) -> float:
        return sum(k.tutar for k in self.kdv) if self.kdv else 0.0


class ProcessSummary(BaseModel):
    firma: Optional[str] = None
    tarih: Optional[str] = None
    toplam: float = 0.0
    masraf: Optional[str] = None
    odeme: Optional[str] = None
    matrah: Optional[float] = None
    kdv_oran: Optional[str] = None
    kdv_tutar: Optional[float] = None


class ProcessResponse(BaseModel):
    success: bool = True
    row_number: int
    confidence: int
    source: str = "gemini"
    summary: ProcessSummary
    excel_path: str
    processing_time_ms: int


class ErrorResponse(BaseModel):
    success: bool = False
    error_code: str
    message: str
    retry_after_ms: Optional[int] = None


class HealthResponse(BaseModel):
    status: str = "healthy"
    gemini_budget_remaining: str = "servisi başlatılmadı"
    prefilter_status: str = "başlatılmadı"
    excel_row_count: int = 0
    uptime_seconds: int = 0
    version: str = "1.0.0"


class StatsResponse(BaseModel):
    total_processed: int = 0
    total_errors: int = 0
    today_processed: int = 0
    today_errors: int = 0
    average_confidence: float = 0.0
    average_processing_ms: float = 0.0
    top_stores: list[str] = Field(default_factory=list)
    prefilter_rejected: int = 0
    prefilter_confirmed: int = 0
    prefilter_uncertain: int = 0
    prefilter_bypassed: int = 0
    estimated_savings_tl: float = 0.0


class BudgetResponse(BaseModel):
    budget_tl: float = 0.0
    month_cost_tl: float = 0.0
    remaining_tl: float = 0.0
    month_count: int = 0
    estimated_remaining_receipts: int = 0
    est_cost_per_receipt_tl: float = 0.0
    ocr_savings_tl: float = 0.0
    usage_percentage: float = 0.0
    status: str = "inactive"
    message: str = ""


class QueueStatusResponse(BaseModel):
    active_processing: int = 0
    pending: int = 0
    recent_count: int = 0
    max_recent: int = 50


class RecentQueryItem(BaseModel):
    request_id: str
    timestamp: str
    firma: Optional[str] = None
    toplam: float = 0.0
    confidence: int = 0
    source: str = "gemini"
    processing_time_ms: int = 0
    masraf: Optional[str] = None
    tarih: Optional[str] = None
    odeme: Optional[str] = None
    status: str = "success"
    row_number: Optional[int] = None


class RecentQueriesResponse(BaseModel):
    queries: list[dict] = Field(default_factory=list)
    total: int = 0
    limit: int = 20


class UpdateRowRequest(BaseModel):
    firma: Optional[str] = None
    tarih: Optional[str] = None
    fis_no: Optional[str] = None
    vkn: Optional[str] = None
    toplam: Optional[float] = None
    odeme: Optional[str] = None
    masraf: Optional[str] = None
    kdv_oran: Optional[str] = None
    kdv_tutar: Optional[float] = None
    matrah: Optional[float] = None


class UpdateRowResponse(BaseModel):
    success: bool = True
    message: str = "Satır güncellendi"


class ErrorRecordItem(BaseModel):
    timestamp: str
    error_code: str
    message: str
    sender: Optional[str] = None
    request_id: Optional[str] = None


class ErrorsResponse(BaseModel):
    errors: list[dict] = Field(default_factory=list)
    total: int = 0
    today_count: int = 0
