"""LUCA Muhasebe Programı — Fiş Aktarım Dönüştürücü.

Ham fiş/fatura verilerini LUCA muhasebe programının kabul edeceği standart
çift-taraflı (borç/alacak) şablon formatına dönüştürür.
"""

from __future__ import annotations

import re
from typing import Union

import pandas as pd

from src.models.schemas import ReceiptData, KdvKalem
from src.utils.logger import logger

MASRAF_HESAP_KODU: dict[str, str] = {
    "Market":    "770.01",
    "Yemek":     "770.02",
    "Akaryakıt": "770.03",
    "Kırtasiye": "770.04",
    "Giyim":     "770.05",
    "Ulaşım":    "770.06",
    "Konaklama": "770.07",
    "Teknoloji": "770.08",
    "Sağlık":    "770.09",
    "Temizlik":  "770.10",
    "Otopark":   "770.11",
    "Diğer":     "770.99",
}

BINEK_KISITLAMA_MASRAF_TIPLERI: set[str] = {"Akaryakıt", "Otopark"}

KKEG_HESAP_KODU: str = "900"
KKEG_HESAP_KODU_KARSI: str = "901"

_KKEG_KEYWORDS: tuple[str, ...] = (
    "akaryakıt", "akaryakit", "petrol", "benzin",
    "otopark", "motorin", "shell", "opet", "bp ",
    "total ", "go ", "alpet",
)


def _detect_kkeg_from_text(firma: str, masraf: str) -> bool:
    """Firma adı veya masraf tipinden 70/30 KKEG kuralı uygulanıp
    uygulanmayacağını otomatik tespit eder.
    """
    if masraf in BINEK_KISITLAMA_MASRAF_TIPLERI:
        return True
    firma_lower = (firma or "").lower()
    return any(kw in firma_lower for kw in _KKEG_KEYWORDS)


KDV_HESAP_KODU: dict[str, str] = {
    "%1":  "191.01",
    "%8":  "191.08",
    "%10": "191.10",
    "%18": "191.18",
    "%20": "191.20",
}

ODEME_HESAP_KODU: dict[str, str] = {
    "NAKİT":  "100.01",
    "KART":   "102.01",
    "HAVALE": "102.02",
}

ODEME_BELGE_TR: dict[str, str] = {
    "NAKİT":  "Kasa Fişi",
    "KART":   "Banka Fişi",
    "HAVALE": "Banka Fişi",
}

ODEME_DETAY_PREFIX: dict[str, str] = {
    "NAKİT":  "NAKİT",
    "KART":   "KART",
    "HAVALE": "HAVALE",
}

LUCA_COLUMNS: list[str] = [
    "Fiş No", "Fiş Tarihi", "Fiş Açıklama", "Hesap Kodu",
    "Evrak No", "Evrak Tarihi", "Detay Açıklama",
    "Borç", "Alacak", "Miktar",
    "Belge Türü", "Para Birimi", "Kur", "Döviz Tutar",
]

_KDV_ORAN_RE = re.compile(r"%?(\d+)")


def _parse_kdv_oran(oran_str: str) -> float:
    """'%20', '20', '%8' gibi ifadelerden ondalık oran hesapla."""
    m = _KDV_ORAN_RE.search(str(oran_str))
    if m:
        return int(m.group(1)) / 100.0
    return 0.0


def _normalize_tarih(tarih: str | None) -> str:
    """Tarih string'ini GG/AA/YYYY formatına normalize et."""
    if not tarih:
        return ""
    try:
        parts = tarih.replace(".", "/").replace("-", "/").split("/")
        if len(parts) == 3:
            d, m, y = int(parts[0]), int(parts[1]), int(parts[2])
            if y < 100:
                y += 2000
            return f"{d:02d}/{m:02d}/{y:04d}"
    except (ValueError, IndexError):
        pass
    return tarih


def _normalize_kdv_key(oran_str: str) -> str:
    """KDV oranını '%20' formatına normalize et."""
    m = _KDV_ORAN_RE.search(str(oran_str))
    if m:
        return f"%{m.group(1)}"
    return oran_str


def _make_row(
    *, fis_no: str, tarih: str, firma: str, hesap_kodu: str,
    evrak_no: str, detay: str, borc: float, alacak: float,
    miktar: int | float, belge_tr: str, para_birimi: str = "TL",
    kur: int | float = 1, doviz_tutar: int | float = 0,
) -> dict:
    """Tek bir LUCA satır dict'i oluşturur."""
    return {
        "Fiş No": fis_no, "Fiş Tarihi": tarih, "Fiş Açıklama": firma,
        "Hesap Kodu": hesap_kodu, "Evrak No": evrak_no, "Evrak Tarihi": tarih,
        "Detay Açıklama": detay, "Borç": borc, "Alacak": alacak,
        "Miktar": miktar, "Belge Türü": belge_tr, "Para Birimi": para_birimi,
        "Kur": kur, "Döviz Tutar": doviz_tutar,
    }


def _from_receipt_data(data: ReceiptData) -> dict:
    """ReceiptData nesnesini normalize dict'e dönüştür."""
    kdv_items = []
    if data.kdv:
        for k in data.kdv:
            kdv_items.append({"oran": k.oran, "matrah": k.matrah, "tutar": k.tutar})

    return {
        "fis_no": data.fis_no or "", "tarih": data.tarih or "",
        "firma": data.firma or "", "toplam": data.toplam,
        "masraf": data.masraf, "odeme": data.odeme,
        "kdv_items": kdv_items, "plaka": data.plaka or "",
        "is_binek_auto": data.is_binek_auto,
    }


def _normalize_dict(raw: dict) -> dict:
    """Ham dict'i standart formata normalize et."""
    fis_no = raw.get("fis_no") or raw.get("fatura_no") or raw.get("fiş_no") or ""
    tarih  = raw.get("tarih") or ""
    firma  = raw.get("firma") or raw.get("satici") or ""
    toplam = float(raw.get("toplam") or raw.get("toplam_tutar") or 0)
    odeme  = raw.get("odeme") or raw.get("odeme_yontemi") or "NAKİT"
    masraf = raw.get("masraf") or "Market"
    plaka  = raw.get("plaka") or ""
    is_binek_auto = raw.get("is_binek_auto")

    kdv_items: list[dict] = []

    if "kdv" in raw and isinstance(raw["kdv"], list):
        for item in raw["kdv"]:
            if isinstance(item, dict):
                kdv_items.append({
                    "oran": item.get("oran", ""),
                    "matrah": float(item.get("matrah", 0)),
                    "tutar": float(item.get("tutar", 0)),
                })
    elif "kdv_orani" in raw and raw["kdv_orani"]:
        oran_str = str(raw["kdv_orani"])
        oran_decimal = _parse_kdv_oran(oran_str)
        if oran_decimal > 0 and toplam > 0:
            matrah = round(toplam / (1 + oran_decimal), 2)
            tutar  = round(toplam - matrah, 2)
            kdv_items.append({
                "oran": _normalize_kdv_key(oran_str),
                "matrah": matrah, "tutar": tutar,
            })

    return {
        "fis_no": fis_no, "tarih": tarih, "firma": firma,
        "toplam": toplam, "masraf": masraf, "odeme": odeme,
        "kdv_items": kdv_items, "plaka": plaka,
        "is_binek_auto": is_binek_auto,
    }


def fis_to_luca_rows(receipt: Union[dict, ReceiptData]) -> list[dict]:
    """Tek bir fiş verisinden LUCA şablonuna uygun satır listesi üretir.

    Normal fişler (3+ satır):
      1) 770.xx  Borç  matrah       — Gider
      2) 191.xx  Borç  kdv          — KDV
      3) 100/102 Alacak toplam      — Ödeme

    Akaryakıt / Otopark — KKEG KDV (5 satır):
      Örnek: 400 TL (%20 KDV dahil) → matrah=333.33, KDV=66.67

      1) 770.03  Borç   313.33  — Gider (matrah − KDV×%30)
      2) 191.20  Borç    46.67  — İndirilecek KDV %20 (%70)
      3) 900     Borç    20.00  — KKEG KDV (%30)
      4) 901     Alacak  20.00  — KKEG KDV (%30)
      5) 100.01  Alacak 380.00  — Ödeme (matrah + KDV×%70)
    """
    if isinstance(receipt, ReceiptData):
        rec = _from_receipt_data(receipt)
    elif isinstance(receipt, dict):
        rec = _normalize_dict(receipt)
    else:
        raise TypeError(f"Beklenen dict veya ReceiptData, gelen: {type(receipt)}")

    fis_no    = rec["fis_no"]
    tarih     = _normalize_tarih(rec["tarih"])
    firma     = rec["firma"]
    evrak_no  = rec["fis_no"]
    toplam    = round(rec["toplam"], 2)
    masraf    = rec.get("masraf") or "Market"
    odeme_key = (rec.get("odeme") or "NAKİT").upper()
    plaka     = rec.get("plaka") or ""
    is_binek  = rec.get("is_binek_auto")

    belge_tr    = ODEME_BELGE_TR.get(odeme_key, "Kasa Fişi")
    para_birimi = "TL"
    kur         = 1
    doviz_tutar = 0

    if is_binek is True:
        apply_kkeg = True
    elif is_binek is False:
        apply_kkeg = False
    else:
        apply_kkeg = _detect_kkeg_from_text(firma, masraf)

    if apply_kkeg:
        logger.info("70/30 KKEG kuralı uygulanıyor",
                     event="kkeg_applied", fis_no=fis_no, firma=firma, masraf=masraf)

    def _detay(aciklama: str) -> str:
        return f"{plaka} - {aciklama}" if plaka else aciklama

    rows: list[dict] = []
    kdv_items: list[dict] = rec.get("kdv_items", [])
    odeme_tutar = toplam

    if kdv_items:
        matrah_toplam = sum(item["matrah"] for item in kdv_items)
        kdv_toplam    = sum(item["tutar"]  for item in kdv_items)

        if apply_kkeg:
            masraf_kodu = MASRAF_HESAP_KODU.get(masraf, "770.03")

            kdv_70_per_item = [round(it["tutar"] * 0.70, 2) for it in kdv_items]
            kdv_70_total    = sum(kdv_70_per_item)
            kdv_30_total    = round(kdv_toplam - kdv_70_total, 2)

            gider_tutar = round(matrah_toplam - kdv_30_total, 2)
            odeme_tutar = round(matrah_toplam + kdv_70_total, 2)

            rows.append(_make_row(
                fis_no=fis_no, tarih=tarih, firma=firma,
                hesap_kodu=masraf_kodu, evrak_no=evrak_no,
                detay=_detay(f"{masraf} Gideri"),
                borc=gider_tutar, alacak=0, miktar=1,
                belge_tr=belge_tr, para_birimi=para_birimi,
                kur=kur, doviz_tutar=doviz_tutar,
            ))

            for i_kdv, item in enumerate(kdv_items):
                oran_key = _normalize_kdv_key(item["oran"])
                kdv_kodu = KDV_HESAP_KODU.get(
                    oran_key, f"191.{oran_key.replace('%', '').zfill(2)}")
                rows.append(_make_row(
                    fis_no=fis_no, tarih=tarih, firma=firma,
                    hesap_kodu=kdv_kodu, evrak_no=evrak_no,
                    detay=_detay(f"İndirilecek KDV {oran_key} (%70)"),
                    borc=kdv_70_per_item[i_kdv], alacak=0, miktar=0,
                    belge_tr=belge_tr, para_birimi=para_birimi,
                    kur=kur, doviz_tutar=doviz_tutar,
                ))

            rows.append(_make_row(
                fis_no=fis_no, tarih=tarih, firma=firma,
                hesap_kodu=KKEG_HESAP_KODU, evrak_no=evrak_no,
                detay=_detay("KKEG KDV (%30)"),
                borc=kdv_30_total, alacak=0, miktar=0,
                belge_tr=belge_tr, para_birimi=para_birimi,
                kur=kur, doviz_tutar=doviz_tutar,
            ))

            rows.append(_make_row(
                fis_no=fis_no, tarih=tarih, firma=firma,
                hesap_kodu=KKEG_HESAP_KODU_KARSI, evrak_no=evrak_no,
                detay=_detay("KKEG KDV (%30)"),
                borc=0, alacak=kdv_30_total, miktar=0,
                belge_tr=belge_tr, para_birimi=para_birimi,
                kur=kur, doviz_tutar=doviz_tutar,
            ))

        else:
            masraf_kodu = MASRAF_HESAP_KODU.get(masraf, "770.01")
            rows.append(_make_row(
                fis_no=fis_no, tarih=tarih, firma=firma,
                hesap_kodu=masraf_kodu, evrak_no=evrak_no,
                detay=_detay(f"{masraf} Gideri - {firma}"),
                borc=round(matrah_toplam, 2), alacak=0, miktar=1,
                belge_tr=belge_tr, para_birimi=para_birimi,
                kur=kur, doviz_tutar=doviz_tutar,
            ))

            for item in kdv_items:
                oran_key = _normalize_kdv_key(item["oran"])
                kdv_kodu = KDV_HESAP_KODU.get(
                    oran_key, f"191.{oran_key.replace('%', '').zfill(2)}")
                rows.append(_make_row(
                    fis_no=fis_no, tarih=tarih, firma=firma,
                    hesap_kodu=kdv_kodu, evrak_no=evrak_no,
                    detay=_detay(f"KDV {oran_key} - {firma}"),
                    borc=round(item["tutar"], 2), alacak=0, miktar=0,
                    belge_tr=belge_tr, para_birimi=para_birimi,
                    kur=kur, doviz_tutar=doviz_tutar,
                ))
    else:
        masraf_kodu = MASRAF_HESAP_KODU.get(masraf, "770.01")
        rows.append(_make_row(
            fis_no=fis_no, tarih=tarih, firma=firma,
            hesap_kodu=masraf_kodu, evrak_no=evrak_no,
            detay=_detay(f"{masraf} Gideri - {firma}"),
            borc=toplam, alacak=0, miktar=1,
            belge_tr=belge_tr, para_birimi=para_birimi,
            kur=kur, doviz_tutar=doviz_tutar,
        ))

    odeme_kodu   = ODEME_HESAP_KODU.get(odeme_key, "100.01")
    odeme_prefix = ODEME_DETAY_PREFIX.get(odeme_key, odeme_key)
    rows.append(_make_row(
        fis_no=fis_no, tarih=tarih, firma=firma,
        hesap_kodu=odeme_kodu, evrak_no=evrak_no,
        detay=f"{odeme_prefix} - {firma}",
        borc=0, alacak=odeme_tutar, miktar=0,
        belge_tr=belge_tr, para_birimi=para_birimi,
        kur=kur, doviz_tutar=doviz_tutar,
    ))

    return rows


def fis_to_luca_list(receipt: Union[dict, ReceiptData]) -> list[list]:
    """Tek bir fiş verisinden LUCA satırlarını list[list] olarak döndürür."""
    return [[row[col] for col in LUCA_COLUMNS] for row in fis_to_luca_rows(receipt)]


class LucaBalanceError(ValueError):
    """Borç/Alacak dengesizliği hatası."""
    pass


def validate_luca_balance(df: pd.DataFrame) -> tuple[bool, str]:
    """LUCA DataFrame'inin borç/alacak denkliğini doğrular.

    KKEG satırlarındaki gider azaltma farkı (KDV×%30) tolerans olarak hesaplanır.
    """
    _kkeg_hesaplar = {KKEG_HESAP_KODU, KKEG_HESAP_KODU_KARSI}
    mask = ~df["Hesap Kodu"].isin(_kkeg_hesaplar)
    toplam_borc   = round(df.loc[mask, "Borç"].sum(), 2)
    toplam_alacak = round(df.loc[mask, "Alacak"].sum(), 2)

    kkeg_borc_mask = df["Hesap Kodu"] == KKEG_HESAP_KODU
    kkeg_offset = round(df.loc[kkeg_borc_mask, "Borç"].sum(), 2)
    adjusted_borc = round(toplam_borc + kkeg_offset, 2)

    if adjusted_borc == toplam_alacak:
        return True, f"✓ Denklik sağlandı: Borç = Alacak = {toplam_alacak:.2f} TL"
    else:
        fark = abs(adjusted_borc - toplam_alacak)
        return False, (
            f"✗ Denklik BOZUK! "
            f"Borç: {toplam_borc:.2f} + KKEG: {kkeg_offset:.2f} = {adjusted_borc:.2f} TL, "
            f"Alacak: {toplam_alacak:.2f} TL, Fark: {fark:.2f} TL"
        )


def transform_to_luca_df(
    receipts: list[Union[dict, ReceiptData]],
    *,
    validate_balance: bool = True,
) -> pd.DataFrame:
    """Ham fiş listesini LUCA şablonuna uygun DataFrame'e dönüştürür.

    Normal fişler (3+ satır):
      Gider 770.XX Borç, KDV 191.XX Borç, Ödeme 100/102 Alacak

    KKEG fişleri (Akaryakıt/Otopark — 5 satır):
      Gider 770.XX Borç (matrah−KDV×%30), İndirilecek KDV 191.XX Borç (KDV×%70),
      KKEG 900 Borç (KDV×%30), KKEG 901 Alacak (KDV×%30),
      Ödeme 100/102 Alacak (matrah+KDV×%70)
    """
    if not receipts:
        return pd.DataFrame(columns=LUCA_COLUMNS)

    all_rows: list[dict] = []

    for i, receipt in enumerate(receipts):
        rows = fis_to_luca_rows(receipt)
        all_rows.extend(rows)

        if validate_balance:
            _kkeg_hesaplar = {KKEG_HESAP_KODU, KKEG_HESAP_KODU_KARSI}
            non_kkeg = [r for r in rows if r["Hesap Kodu"] not in _kkeg_hesaplar]
            fis_borc   = round(sum(r["Borç"] for r in non_kkeg), 2)
            fis_alacak = round(sum(r["Alacak"] for r in non_kkeg), 2)

            has_kkeg = any(r["Hesap Kodu"] in _kkeg_hesaplar for r in rows)
            if has_kkeg:
                kkeg_borc = round(sum(
                    r["Borç"] for r in rows if r["Hesap Kodu"] == KKEG_HESAP_KODU
                ), 2)
                if round(fis_alacak - fis_borc, 2) != kkeg_borc:
                    fis_id = (
                        receipt.fis_no if isinstance(receipt, ReceiptData)
                        else receipt.get("fis_no", f"index-{i}")
                    )
                    msg = (
                        f"Fiş #{fis_id} KKEG denklik hatası! "
                        f"Borç: {fis_borc:.2f}, Alacak: {fis_alacak:.2f}, "
                        f"KKEG offset: {kkeg_borc:.2f}"
                    )
                    logger.error(msg, event="luca_fis_balance_error")
                    raise LucaBalanceError(msg)
            elif fis_borc != fis_alacak:
                fis_id = (
                    receipt.fis_no if isinstance(receipt, ReceiptData)
                    else receipt.get("fis_no", f"index-{i}")
                )
                msg = (
                    f"Fiş #{fis_id} denklik hatası! "
                    f"Borç: {fis_borc:.2f} ≠ Alacak: {fis_alacak:.2f}"
                )
                logger.error(msg, event="luca_fis_balance_error")
                raise LucaBalanceError(msg)

    df = pd.DataFrame(all_rows, columns=LUCA_COLUMNS)

    if validate_balance:
        _kkeg_hesaplar = {KKEG_HESAP_KODU, KKEG_HESAP_KODU_KARSI}
        kkeg_mask = ~df["Hesap Kodu"].isin(_kkeg_hesaplar)
        toplam_borc   = round(df.loc[kkeg_mask, "Borç"].sum(), 2)
        toplam_alacak = round(df.loc[kkeg_mask, "Alacak"].sum(), 2)

        kkeg_borc_mask = df["Hesap Kodu"] == KKEG_HESAP_KODU
        kkeg_offset = round(df.loc[kkeg_borc_mask, "Borç"].sum(), 2)
        adjusted_borc = round(toplam_borc + kkeg_offset, 2)

        if adjusted_borc != toplam_alacak:
            msg = (
                f"Genel muhasebe denklik hatası! "
                f"Toplam Borç: {toplam_borc:.2f} + KKEG: {kkeg_offset:.2f} = {adjusted_borc:.2f} ≠ "
                f"Toplam Alacak: {toplam_alacak:.2f}"
            )
            logger.error(msg, event="luca_balance_error",
                         borc=toplam_borc, alacak=toplam_alacak)
            raise LucaBalanceError(msg)

        logger.info("LUCA dönüşüm tamamlandı",
                     event="luca_transform_ok", fis_sayisi=len(receipts),
                     satir_sayisi=len(df), toplam_borc=toplam_borc,
                     toplam_alacak=toplam_alacak)

    return df

