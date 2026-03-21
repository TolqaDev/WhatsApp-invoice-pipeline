"""Fatura Bot — Gemini Vision servisi. google-genai SDK, aylık TL bütçe takipli."""

import json
import re
import base64
from datetime import datetime, timezone
from typing import Optional

from google import genai
from google.genai import types

from src.models.schemas import ReceiptData
from src.utils.logger import logger


class GeminiUnavailableError(Exception):
    pass


class GeminiRateLimitError(Exception):
    pass


class BudgetExceededError(Exception):
    pass


RECEIPT_SYSTEM_PROMPT = """TR POS fişi→JSON. Başka metin ekleme.
{
"tarih":"GG/AA/YYYY|null",
"fis_no":"str|null",
"firma":"str|null",
"vkn":"10-11 hane|null",
"masraf":"Market|Yemek|Akaryakıt|Kırtasiye|Giyim|Ulaşım|Konaklama|Teknoloji|Sağlık|Temizlik|Diğer",
"kdv":[{"oran":"%8","matrah":0.00,"tutar":0.00}],
"toplam":0.00,
"odeme":"NAKİT|KART|HAVALE|null"
}
Fiş değilse→{"hata":"x"}
Ondalık=nokta TL KDV=%1/%8/%10/%18/%20"""


class MonthlyBudgetTracker:
    """Aylık TL bazlı Gemini API bütçe takibi."""

    PRICE_INPUT_USD = 0.15 / 1_000_000
    PRICE_OUTPUT_USD = 0.60 / 1_000_000
    PRICE_THINKING_USD = 3.50 / 1_000_000

    EST_INPUT = 1_000
    EST_OUTPUT = 150
    EST_THINKING = 0

    def __init__(self, monthly_budget_tl: float = 200.0, usd_tl_rate: float = 38.0):
        self._budget_tl = monthly_budget_tl
        self._usd_tl_rate = usd_tl_rate
        self._current_month: str = ""
        self._month_cost_tl: float = 0.0
        self._month_count: int = 0

        est_cost_usd = (
            self.EST_INPUT * self.PRICE_INPUT_USD
            + self.EST_OUTPUT * self.PRICE_OUTPUT_USD
            + self.EST_THINKING * self.PRICE_THINKING_USD
        )
        self._est_cost_tl = est_cost_usd * self._usd_tl_rate

        logger.info("Bütçe takipçisi başlatıldı", event="budget_initialized",
                     monthly_budget_tl=monthly_budget_tl, usd_tl_rate=usd_tl_rate,
                     est_cost_per_receipt_tl=round(self._est_cost_tl, 4))

    def _reset_if_new_month(self):
        month = datetime.now(timezone.utc).strftime("%Y-%m")
        if month != self._current_month:
            if self._current_month:
                logger.info("Yeni ay — bütçe sıfırlandı", event="budget_reset",
                            prev_month=self._current_month,
                            prev_cost_tl=round(self._month_cost_tl, 4),
                            prev_count=self._month_count)
            self._current_month = month
            self._month_cost_tl = 0.0
            self._month_count = 0

    def can_process(self) -> bool:
        self._reset_if_new_month()
        return (self._month_cost_tl + self._est_cost_tl) <= self._budget_tl

    def record_usage(self, input_tokens: int | None = None,
                     output_tokens: int | None = None,
                     thinking_tokens: int | None = None):
        self._reset_if_new_month()

        inp = input_tokens or self.EST_INPUT
        out = output_tokens or self.EST_OUTPUT
        think = thinking_tokens or 0

        cost_usd = (
            inp * self.PRICE_INPUT_USD
            + out * self.PRICE_OUTPUT_USD
            + think * self.PRICE_THINKING_USD
        )
        cost_tl = cost_usd * self._usd_tl_rate

        self._month_cost_tl += cost_tl
        self._month_count += 1

        logger.info("Bütçe güncellendi", event="budget_update",
                     receipt_cost_tl=round(cost_tl, 4),
                     month_total_tl=round(self._month_cost_tl, 4),
                     remaining_tl=round(self.remaining_budget_tl, 4),
                     month_count=self._month_count,
                     tokens_in=inp, tokens_out=out, tokens_think=think)

    @property
    def remaining_budget_tl(self) -> float:
        self._reset_if_new_month()
        return max(self._budget_tl - self._month_cost_tl, 0)

    @property
    def month_cost_tl(self) -> float:
        self._reset_if_new_month()
        return self._month_cost_tl

    @property
    def month_count(self) -> int:
        self._reset_if_new_month()
        return self._month_count

    @property
    def budget_tl(self) -> float:
        return self._budget_tl

    @property
    def estimated_remaining_receipts(self) -> int:
        if self._est_cost_tl <= 0:
            return 0
        return int(self.remaining_budget_tl / self._est_cost_tl)

    @property
    def est_cost_per_receipt_tl(self) -> float:
        """Tahmini fiş başı maliyet (TL)."""
        return self._est_cost_tl


class GeminiService:
    """Gemini Vision API ile fiş analiz servisi."""

    def __init__(self):
        self._client: Optional[genai.Client] = None
        self._model_name = "gemini-2.5-flash"
        self.budget: Optional[MonthlyBudgetTracker] = None

    def initialize(self, api_key: str, monthly_budget_tl: float = 200.0, usd_tl_rate: float = 38.0):
        self._client = genai.Client(api_key=api_key)
        self.budget = MonthlyBudgetTracker(monthly_budget_tl=monthly_budget_tl, usd_tl_rate=usd_tl_rate)
        logger.info("Gemini servisi başlatıldı", event="gemini_initialized",
                     model=self._model_name, monthly_budget_tl=monthly_budget_tl)

    async def analyze_receipt(self, image_data: bytes | str, mime_type: str) -> ReceiptData:
        """Fiş görselini analiz eder ve yapılandırılmış veri döndürür."""
        if not self._client:
            raise GeminiUnavailableError("Gemini servisi başlatılmadı")

        if self.budget and not self.budget.can_process():
            logger.warning("Aylık bütçe limiti doldu", event="budget_exceeded",
                           month_cost_tl=round(self.budget.month_cost_tl, 2),
                           month_count=self.budget.month_count)
            raise BudgetExceededError(
                f"Aylık bütçe limiti doldu (₺{self.budget.month_cost_tl:.2f} / ₺{self.budget.budget_tl:.2f})")

        try:
            logger.info("Gemini'ye görsel gönderiliyor", event="image_processing_start")

            image_bytes = base64.b64decode(image_data) if isinstance(image_data, str) else image_data

            response = await self._client.aio.models.generate_content(
                model=self._model_name,
                contents=[
                    types.Content(
                        parts=[
                            types.Part.from_text(text=RECEIPT_SYSTEM_PROMPT),
                            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
                        ]
                    )
                ],
                config=types.GenerateContentConfig(
                    temperature=0.1,
                    max_output_tokens=2048,
                    response_mime_type="application/json",
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            )

            raw_text = response.text
            if not raw_text:
                logger.error("Gemini boş yanıt döndü", event="gemini_empty_response")
                raise ValueError("Gemini boş yanıt döndü")

            logger.debug("Gemini yanıtı alındı", event="gemini_response", raw_length=len(raw_text))

            input_tokens = output_tokens = thinking_tokens = None
            if hasattr(response, "usage_metadata") and response.usage_metadata:
                um = response.usage_metadata
                input_tokens = getattr(um, "prompt_token_count", None)
                output_tokens = getattr(um, "candidates_token_count", None)
                thinking_tokens = getattr(um, "thoughts_token_count", None) or 0

            parsed = self._parse_response(raw_text)
            receipt = ReceiptData(**parsed)

            if self.budget:
                self.budget.record_usage(
                    input_tokens=input_tokens,
                    output_tokens=output_tokens,
                    thinking_tokens=thinking_tokens,
                )

            return receipt

        except (GeminiRateLimitError, GeminiUnavailableError, BudgetExceededError):
            raise
        except Exception as e:
            error_str = str(e).lower()

            if "429" in str(e) or "resource_exhausted" in error_str or "quota" in error_str:
                logger.warning("Gemini rate limit", event="rate_limit_hit", error=str(e))
                raise GeminiRateLimitError(str(e))

            if any(k in error_str for k in ["503", "unavailable", "connection", "timeout"]):
                logger.error("Gemini erişilemiyor", event="gemini_error", error=str(e))
                raise GeminiUnavailableError(f"Gemini erişilemiyor: {e}")

            logger.error("Gemini beklenmeyen hata", event="gemini_error", error=str(e))
            raise

    @staticmethod
    def _parse_response(raw_text: str) -> dict:
        """Gemini yanıtından JSON çıkar."""
        text = raw_text.strip()

        code_block_match = re.search(r'```(?:json)?\s*([\s\S]*?)\s*```', text)
        if code_block_match:
            text = code_block_match.group(1).strip()

        try:
            return json.loads(text)
        except json.JSONDecodeError:
            pass

        json_match = re.search(r'\{[\s\S]*\}', text)
        if json_match:
            try:
                return json.loads(json_match.group())
            except json.JSONDecodeError:
                pass

        logger.error("Gemini yanıtı JSON olarak parse edilemedi", raw_text=text[:500])
        raise ValueError(f"Gemini yanıtı geçerli JSON değil: {text[:200]}")


gemini_service = GeminiService()

