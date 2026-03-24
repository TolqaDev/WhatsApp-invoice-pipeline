"""Fatura Bot — OCR-First fiş işleme motoru. Tesseract ile veri çıkarma, Gemini sadece fallback."""

import base64
import io
import re
from dataclasses import dataclass, field
from typing import Optional

from PIL import Image, ImageFilter, ImageEnhance

from src.utils.logger import logger

TESSERACT_AVAILABLE = False
try:
    import pytesseract
    import sys
    if sys.platform == "win32":
        import shutil
        if not shutil.which("tesseract"):
            import os
            for _p in [
                r"C:\Program Files\Tesseract-OCR\tesseract.exe",
                r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
            ]:
                if os.path.isfile(_p):
                    pytesseract.pytesseract.tesseract_cmd = _p
                    break
    pytesseract.get_tesseract_version()
    TESSERACT_AVAILABLE = True
    logger.info("Tesseract OCR hazır", event="tesseract_ready")
except ImportError:
    logger.warning("pytesseract paketi yüklü değil", event="prefilter_dep_missing")
except Exception as e:
    logger.warning(f"Tesseract OCR Engine bulunamadı: {e}", event="prefilter_engine_missing")


@dataclass
class PrefilterResult:
    is_receipt: bool
    confidence: int
    extraction_score: int = 0
    decision: str = ""
    matched_keywords: list[str] = field(default_factory=list)
    extracted_text: str = ""
    ocr_available: bool = True
    detail: str = ""
    extracted_data: Optional[dict] = field(default=None, repr=False)


STRONG_KEYWORDS = [
    "TOPLAM", "GENEL TOPLAM", "ARA TOPLAM", "G.TOPLAM",
    "KDV", "KDVTOPLAM", "KDV TOPLAM",
    "FİŞ", "FIS", "BELGE NO",
    "VERGİ DAİRESİ", "VERGI DAIRESI", "VERGİ NO", "VERGI NO",
    "EKÜ", "EKU", "ÖKC", "OKC",
    "Z RAPOR", "Z NO", "Z TOPLAM", "FATURA",
]
MEDIUM_KEYWORDS = [
    "KASA", "KASİYER", "KASIYER", "NAKİT", "NAKIT",
    "KREDİ KARTI", "KREDI KARTI", "BANKA KARTI",
    "SATIŞ", "SATIS", "ADET", "MÜŞTERİ", "MUSTERI",
    "NÜSHA", "NUSHA", "SON FİYAT", "SON FIYAT",
    "TEMAS", "TEMASSIZ", "İADE", "IADE",
]
WEAK_KEYWORDS = [
    "TL", "₺", "TEŞ", "TES", "BANKA", "TCKN", "VKN",
    "MALİ", "MALI", "ÖDEME", "ODEME", "PARA ÜSTÜ", "PARA USTU",
    "EFT", "POS",
]

STRONG_WEIGHT = 15
MEDIUM_WEIGHT = 7
WEAK_WEIGHT = 3
PRICE_PATTERN_BONUS = 8
DATE_PATTERN_BONUS = 5
ASPECT_RATIO_BONUS = 5
TEXT_DENSITY_BONUS = 3


class OCRReceiptExtractor:

    @staticmethod
    def extract(ocr_text: str) -> dict:
        lines = ocr_text.strip().split('\n')
        upper = ocr_text.upper()
        data = {}

        data["tarih"] = OCRReceiptExtractor._extract_date(ocr_text)
        data["fis_no"] = OCRReceiptExtractor._extract_fis_no(ocr_text, upper)
        data["firma"] = OCRReceiptExtractor._extract_store_name(lines)
        data["vkn"] = OCRReceiptExtractor._extract_vergi_no(ocr_text, upper)
        data["masraf"] = OCRReceiptExtractor._infer_masraf_kategori(lines, upper)

        ara_toplam = OCRReceiptExtractor._extract_ara_toplam(ocr_text, upper)
        kdv_toplami = OCRReceiptExtractor._extract_kdv_toplami(ocr_text, upper)
        if ara_toplam and kdv_toplami:
            oran = OCRReceiptExtractor._guess_kdv_oran(ara_toplam, kdv_toplami)
            data["kdv"] = [{"oran": oran, "matrah": ara_toplam, "tutar": kdv_toplami}]

        data["toplam"] = OCRReceiptExtractor._extract_genel_toplam(ocr_text, upper)
        data["odeme"] = OCRReceiptExtractor._extract_odeme(upper)

        return {k: v for k, v in data.items() if v is not None}

    @staticmethod
    def score_extraction(data: dict) -> int:
        score = 0
        if data.get("toplam") and data["toplam"] > 0:
            score += 30
        if data.get("tarih"):
            score += 20
        if data.get("firma") and len(data["firma"].strip()) > 2:
            score += 15
        if data.get("vkn"):
            score += 10
        if data.get("fis_no"):
            score += 10
        if data.get("kdv") and len(data["kdv"]) > 0:
            score += 10
        if data.get("odeme"):
            score += 5
        return min(score, 100)

    @staticmethod
    def _infer_masraf_kategori(lines: list[str], upper: str) -> str:
        MARKET_KW = ["MİGROS", "MIGROS", "BİM", "BIM", "A101", "ŞOK", "SOK",
                      "CARREFOUR", "MACRO", "FİLE", "FILE", "MARKET", "GIDA"]
        YAKIT_KW = ["AKARYAKIT", "BP", "OPET", "SHELL", "TOTAL", "PETROL",
                     "BENZIN", "MOTORİN", "MOTORIN", "LPG", "PETROL OFİSİ"]
        YEMEK_KW = ["RESTORAN", "RESTAURANT", "CAFE", "KAFE", "KEBAP",
                     "PİDE", "PIDE", "YEMEK", "DÖNER", "DONER", "BURGER"]
        SAGLIK_KW = ["ECZANE", "PHARMACY", "SAĞLIK", "SAGLIK", "HASTANE"]
        KIRTASIYE_KW = ["KIRTASİYE", "KIRTASIYE", "OFIS", "OFİS"]
        TEKNOLOJI_KW = ["TEKNOLOJİ", "TEKNOLOJI", "ELEKTRONİK", "ELEKTRONIK",
                         "BİLGİSAYAR", "BILGISAYAR", "MEDIAMARKT", "TEKNOSA"]

        for kw in YAKIT_KW:
            if kw in upper:
                return "Akaryakıt"
        for kw in MARKET_KW:
            if kw in upper:
                return "Market"
        for kw in YEMEK_KW:
            if kw in upper:
                return "Yemek"
        for kw in SAGLIK_KW:
            if kw in upper:
                return "Sağlık"
        for kw in KIRTASIYE_KW:
            if kw in upper:
                return "Kırtasiye"
        for kw in TEKNOLOJI_KW:
            if kw in upper:
                return "Teknoloji"
        return "Diğer"

    @staticmethod
    def _guess_kdv_oran(matrah: float, kdv_tutar: float) -> str:
        if matrah <= 0:
            return "%18"
        ratio = (kdv_tutar / matrah) * 100
        rates = [(1, "%1"), (8, "%8"), (10, "%10"), (18, "%18"), (20, "%20")]
        closest = min(rates, key=lambda r: abs(r[0] - ratio))
        return closest[1]

    @staticmethod
    def _extract_date(text: str) -> Optional[str]:
        patterns = [
            r'(\d{2})[./\-](\d{2})[./\-](20\d{2})',
            r'(\d{2})[./\-](\d{2})[./\-](\d{2})\b',
        ]
        for p in patterns:
            m = re.search(p, text)
            if m:
                d, mo, y = m.group(1), m.group(2), m.group(3)
                if len(y) == 2:
                    y = "20" + y
                if 1 <= int(d) <= 31 and 1 <= int(mo) <= 12:
                    return f"{d}/{mo}/{y}"
        return None

    @staticmethod
    def _extract_store_name(lines: list[str]) -> Optional[str]:
        skip_words = {"FİŞ", "FIS", "FATURA", "Z RAPOR", "---", "***", "==="}
        for line in lines[:5]:
            cleaned = line.strip()
            if len(cleaned) < 3:
                continue
            if cleaned.upper() in skip_words:
                continue
            if re.match(r'^[\d\s./:*\-=]+$', cleaned):
                continue
            if len(cleaned) >= 3:
                return cleaned
        return None

    @staticmethod
    def _extract_vergi_no(text: str, upper: str) -> Optional[str]:
        patterns = [
            r'(?:VKN|TCKN|VERGİ\s*(?:NO|NUM)|VERGI\s*(?:NO|NUM))[:\s]*(\d{10,11})',
            r'(?:V\.?K\.?N\.?|T\.?C\.?K\.?N\.?)[:\s]*(\d{10,11})',
        ]
        for p in patterns:
            m = re.search(p, upper)
            if m:
                return m.group(1)
        m = re.search(r'\b(\d{10,11})\b', text)
        if m:
            num = m.group(1)
            if not re.search(r'\d{2}[./]\d{2}[./]\d{2,4}', text[max(0, m.start()-5):m.end()+5]):
                return num
        return None

    @staticmethod
    def _extract_fis_no(text: str, upper: str) -> Optional[str]:
        patterns = [
            r'(?:FİŞ\s*NO|FIS\s*NO|BELGE\s*NO|EKÜ\s*NO|EKU\s*NO)[:\s]*([A-Za-z0-9\-/]+)',
            r'(?:Z\s*NO)[:\s]*(\d+)',
        ]
        for p in patterns:
            m = re.search(p, upper)
            if m:
                return m.group(1).strip()
        return None

    @staticmethod
    def _extract_genel_toplam(text: str, upper: str) -> Optional[float]:
        patterns = [
            r'(?:GENEL\s*TOPLAM|G\.?\s*TOPLAM)[:\s]*[*]*\s*[₺]?\s*(\d{1,7}[.,]\d{2})',
            r'TOPLAM[:\s]*[*]*\s*[₺]?\s*(\d{1,7}[.,]\d{2})',
        ]
        last_match = None
        for p in patterns:
            for m in re.finditer(p, upper):
                last_match = m
        if last_match:
            return OCRReceiptExtractor._parse_number(last_match.group(1))

        amounts = re.findall(r'[₺]\s*(\d{1,7}[.,]\d{2})', text)
        if not amounts:
            amounts = re.findall(r'(\d{1,7}[.,]\d{2})\s*(?:TL|₺)', text)
        if amounts:
            parsed = [OCRReceiptExtractor._parse_number(a) for a in amounts]
            parsed = [p for p in parsed if p and p > 0]
            if parsed:
                return max(parsed)
        return None

    @staticmethod
    def _extract_ara_toplam(text: str, upper: str) -> Optional[float]:
        m = re.search(r'ARA\s*TOPLAM[:\s]*[*]*\s*[₺]?\s*(\d{1,7}[.,]\d{2})', upper)
        if m:
            return OCRReceiptExtractor._parse_number(m.group(1))
        return None

    @staticmethod
    def _extract_kdv_toplami(text: str, upper: str) -> Optional[float]:
        patterns = [
            r'(?:KDV\s*TOPLAM|KDVTOPLAM|TOPLAM\s*KDV)[:\s]*[₺]?\s*(\d{1,7}[.,]\d{2})',
            r'KDV[:\s]*[%]?\d*[:\s]*[₺]?\s*(\d{1,7}[.,]\d{2})',
        ]
        for p in patterns:
            m = re.search(p, upper)
            if m:
                return OCRReceiptExtractor._parse_number(m.group(1))
        return None

    @staticmethod
    def _extract_odeme(upper: str) -> Optional[str]:
        if any(k in upper for k in ["NAKİT", "NAKIT"]):
            return "NAKİT"
        if any(k in upper for k in ["KREDİ KARTI", "KREDI KARTI", "KREDİ K", "KREDI K",
                                     "BANKA KARTI", "BANKA K"]):
            return "KART"
        if any(k in upper for k in ["TEMAS", "TEMASSIZ"]):
            return "KART"
        if any(k in upper for k in ["HAVALE", "EFT"]):
            return "HAVALE"
        return None

    @staticmethod
    def _parse_number(s: str) -> Optional[float]:
        try:
            return float(s.replace(',', '.'))
        except (ValueError, TypeError):
            return None


class OCRPrefilter:

    def __init__(self, reject_threshold: int = 20, ocr_sufficient_threshold: int = 70):
        self.reject_threshold = reject_threshold
        self.ocr_sufficient_threshold = ocr_sufficient_threshold
        self._extractor = OCRReceiptExtractor()
        logger.info("OCR motoru başlatıldı", event="ocr_initialized",
                     tesseract_available=TESSERACT_AVAILABLE,
                     reject_threshold=reject_threshold,
                     ocr_sufficient_threshold=ocr_sufficient_threshold)

    def analyze(self, image_data: bytes | str, mime_type: str) -> PrefilterResult:
        """Görseli OCR ile analiz et: sınıflandır + veri çıkar. Senkron metod."""
        if not TESSERACT_AVAILABLE:
            return PrefilterResult(
                is_receipt=True, confidence=50, decision="BYPASS",
                ocr_available=False, detail="Tesseract kurulu değil, Gemini'ye yönlendiriliyor")

        try:
            image_bytes = base64.b64decode(image_data) if isinstance(image_data, str) else image_data
            image = Image.open(io.BytesIO(image_bytes))
            orig_w, orig_h = image.size

            processed = self._preprocess_image(image)
            ocr_text = self._run_tesseract(processed)
            ocr_upper = ocr_text.upper()
            text_len = len(ocr_text.strip())

            cls_score, matched = self._score_keywords(ocr_upper)
            cls_score += self._calculate_bonuses(ocr_text, orig_w, orig_h, text_len)
            cls_score = max(0, min(cls_score, 100))

            if cls_score < self.reject_threshold:
                result = PrefilterResult(
                    is_receipt=False, confidence=cls_score,
                    decision="REJECTED", matched_keywords=matched,
                    extracted_text=ocr_text,
                    detail=f"Fiş değil (sınıflama={cls_score})")
                self._log_result(result)
                return result

            extracted = self._extractor.extract(ocr_text)
            ext_score = self._extractor.score_extraction(extracted)

            if ext_score >= self.ocr_sufficient_threshold:
                decision = "OCR_SUFFICIENT"
                detail = f"OCR başarılı (sınıflama={cls_score}, çıkarma={ext_score})"
            else:
                decision = "OCR_PARTIAL"
                detail = f"OCR kısmen başarılı (sınıflama={cls_score}, çıkarma={ext_score})"

            result = PrefilterResult(
                is_receipt=True, confidence=cls_score, extraction_score=ext_score,
                decision=decision, matched_keywords=matched,
                extracted_text=ocr_text, detail=detail,
                extracted_data=extracted)

            self._log_result(result, ext_score=ext_score, extracted_fields=list(extracted.keys()))
            return result

        except Exception as e:
            logger.warning(f"OCR hatası: {e}", event="ocr_error", error=str(e))
            return PrefilterResult(
                is_receipt=True, confidence=50, decision="ERROR_BYPASS",
                detail=f"OCR hatası, Gemini fallback: {e}")

    def get_extracted_data(self, result: PrefilterResult) -> Optional[dict]:
        return result.extracted_data

    @staticmethod
    def _run_tesseract(image: Image.Image) -> str:
        ocr_config = "--psm 6 --oem 3"
        try:
            return pytesseract.image_to_string(image, lang="tur+eng", config=ocr_config)
        except Exception:
            return pytesseract.image_to_string(image, lang="eng", config=ocr_config)

    @staticmethod
    def _preprocess_image(image: Image.Image) -> Image.Image:
        if image.mode != "L":
            image = image.convert("L")
        w, h = image.size
        if w < 800:
            scale = 800 / w
            image = image.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
        enhancer = ImageEnhance.Contrast(image)
        image = enhancer.enhance(2.0)
        image = image.filter(ImageFilter.SHARPEN)
        return image

    @staticmethod
    def _score_keywords(text_upper: str) -> tuple[int, list[str]]:
        score = 0
        matched: list[str] = []
        for kw in STRONG_KEYWORDS:
            if kw in text_upper:
                score += STRONG_WEIGHT
                matched.append(kw)
        for kw in MEDIUM_KEYWORDS:
            if kw in text_upper:
                score += MEDIUM_WEIGHT
                matched.append(kw)
        for kw in WEAK_KEYWORDS:
            if kw in text_upper:
                score += WEAK_WEIGHT
                matched.append(kw)
        return score, matched

    @staticmethod
    def _calculate_bonuses(ocr_text: str, width: int, height: int, text_length: int) -> int:
        bonus = 0
        if len(re.findall(r'\d{1,6}[.,]\d{2}\b', ocr_text)) >= 2:
            bonus += PRICE_PATTERN_BONUS
        if re.findall(r'\d{2}[./]\d{2}[./]\d{2,4}', ocr_text):
            bonus += DATE_PATTERN_BONUS
        if height > width * 1.3:
            bonus += ASPECT_RATIO_BONUS
        if ocr_text.count('\n') >= 10 and text_length >= 150:
            bonus += TEXT_DENSITY_BONUS
        return bonus

    def _log_result(self, result: PrefilterResult, **extra):
        logger.info(f"OCR sonuç: {result.decision} (sınıflama={result.confidence}, çıkarma={result.extraction_score})",
                     event="ocr_result", decision=result.decision,
                     cls_score=result.confidence, ext_score=result.extraction_score,
                     is_receipt=result.is_receipt, matched_count=len(result.matched_keywords), **extra)


ocr_prefilter = OCRPrefilter()

