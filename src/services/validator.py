"""Fatura Bot — Fiş verisi doğrulama ve güven skoru hesaplama servisi."""

import re
from src.models.schemas import ReceiptData
from src.utils.logger import logger


class ReceiptValidator:

    @staticmethod
    def validate(data: ReceiptData) -> tuple[int, list[str]]:
        """Fiş verisini doğrula ve güven skoru hesapla (0-100)."""
        score = 0
        warnings: list[str] = []

        if data.toplam and data.toplam > 0:
            score += 30
        else:
            warnings.append("Genel toplam eksik veya 0")

        if data.tarih:
            if ReceiptValidator._is_valid_date(data.tarih):
                score += 20
            else:
                score += 5
                warnings.append(f"Tarih formatı beklenenden farklı: {data.tarih}")
        else:
            warnings.append("Tarih bilgisi eksik")

        if data.firma and len(data.firma.strip()) > 0:
            score += 15
        else:
            warnings.append("Firma adı eksik")

        if data.vkn and len(data.vkn.strip()) >= 10:
            score += 10
        else:
            warnings.append("VKN/TCKN eksik")

        if data.kdv and len(data.kdv) > 0 and data.kdv_toplam > 0:
            score += 10
        else:
            warnings.append("KDV bilgisi eksik")

        if data.fis_no and len(data.fis_no.strip()) > 0:
            if re.match(r'^[\w\-/]+$', data.fis_no.strip()):
                score += 5
            else:
                score += 2
                warnings.append(f"Fiş numarası beklenmeyen karakterler içeriyor: {data.fis_no}")
        else:
            warnings.append("Fiş numarası eksik")

        if data.odeme and len(data.odeme.strip()) > 0:
            score += 5
        else:
            warnings.append("Ödeme şekli eksik")

        if data.masraf and len(data.masraf.strip()) > 0:
            score += 5
        else:
            warnings.append("Masraf kategorisi eksik")

        if ReceiptValidator._check_total_consistency(data):
            score += 10
        elif data.kdv and data.matrah_toplam > 0:
            warnings.append("Matrah + KDV ≠ Genel toplam (±%2 tolerans dışında)")

        score = min(score, 100)

        logger.debug("Doğrulama tamamlandı", event="validation_result",
                      confidence=score, warning_count=len(warnings), warnings=warnings)

        return score, warnings

    @staticmethod
    def _is_valid_date(date_str: str) -> bool:
        pattern = r'^(0[1-9]|[12]\d|3[01])/(0[1-9]|1[0-2])/\d{4}$'
        if not re.match(pattern, date_str):
            return False
        try:
            day, month, year = map(int, date_str.split('/'))
            if year < 2000 or year > 2099:
                return False
            if month in (4, 6, 9, 11) and day > 30:
                return False
            if month == 2:
                is_leap = (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0)
                if day > (29 if is_leap else 28):
                    return False
            return True
        except (ValueError, IndexError):
            return False

    @staticmethod
    def _check_total_consistency(data: ReceiptData) -> bool:
        """matrah_toplam + kdv_toplam ≈ toplam (±%2 tolerans)"""
        if data.kdv and data.matrah_toplam > 0 and data.toplam > 0:
            expected = data.matrah_toplam + data.kdv_toplam
            tolerance = data.toplam * 0.02
            return abs(expected - data.toplam) <= tolerance
        return False


validator = ReceiptValidator()

