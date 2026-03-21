"""Fatura Bot — Günlük Excel dosyalarına fiş verisi yazma servisi."""

import asyncio
from datetime import datetime, timezone, date
from pathlib import Path
from typing import Optional

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter

from src.models.schemas import ReceiptData
from src.utils.logger import logger


class ExcelService:

    COLUMNS = [
        ("Belge Tarihi", 14),
        ("Belge No", 16),
        ("Firma Unvanı", 30),
        ("VKN/TCKN", 14),
        ("Masraf İçeriği", 20),
        ("Matrah (₺)", 14),
        ("KDV Oranı", 14),
        ("KDV Tutarı (₺)", 14),
        ("Genel Toplam (₺)", 16),
        ("Ödeme Şekli", 16),
        ("Güven %", 10),
        ("Kaynak", 10),
        ("Gönderen", 16),
        ("İşlem Zamanı", 20),
    ]

    HEADER_FILL = PatternFill(start_color="1F4E79", end_color="1F4E79", fill_type="solid")
    HEADER_FONT = Font(name="Calibri", bold=True, color="FFFFFF", size=11)
    EVEN_ROW_FILL = PatternFill(start_color="D6E4F0", end_color="D6E4F0", fill_type="solid")
    ODD_ROW_FILL = PatternFill(start_color="FFFFFF", end_color="FFFFFF", fill_type="solid")
    GREEN_FONT = Font(color="006100")
    ORANGE_FONT = Font(color="BF8F00")
    RED_FONT = Font(color="9C0006")
    THIN_BORDER = Border(
        left=Side(style="thin", color="B4C6E7"),
        right=Side(style="thin", color="B4C6E7"),
        top=Side(style="thin", color="B4C6E7"),
        bottom=Side(style="thin", color="B4C6E7"),
    )

    def __init__(self, data_dir: str = "public/daily"):
        self._data_dir = Path(data_dir)
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._lock = asyncio.Lock()

    def _daily_path(self, target_date: Optional[date] = None) -> Path:
        d = target_date or date.today()
        return self._data_dir / f"{d.isoformat()}.xlsx"

    @staticmethod
    def _parse_receipt_date(tarih_str: Optional[str]) -> Optional[date]:
        if not tarih_str:
            return None
        try:
            parts = tarih_str.replace('.', '/').replace('-', '/').split('/')
            if len(parts) == 3:
                d, m, y = int(parts[0]), int(parts[1]), int(parts[2])
                if y < 100:
                    y += 2000
                return date(y, m, d)
        except (ValueError, IndexError):
            pass
        return None

    def _ensure_workbook(self, file_path: Path) -> Workbook:
        if file_path.exists():
            try:
                return load_workbook(str(file_path))
            except Exception as e:
                logger.error("Excel dosyası açılamadı, yeni oluşturulacak", error=str(e))

        wb = Workbook()
        ws = wb.active
        ws.title = "Faturalar"
        self._setup_header(ws)
        wb.save(str(file_path))
        return wb

    def _setup_header(self, ws):
        for col_idx, (title, width) in enumerate(self.COLUMNS, 1):
            cell = ws.cell(row=1, column=col_idx, value=title)
            cell.font = self.HEADER_FONT
            cell.fill = self.HEADER_FILL
            cell.alignment = Alignment(horizontal="center", vertical="center")
            cell.border = self.THIN_BORDER
            ws.column_dimensions[get_column_letter(col_idx)].width = width
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = f"A1:{get_column_letter(len(self.COLUMNS))}1"

    async def add_row(self, data: ReceiptData, confidence: int, sender: str, source: str = "gemini") -> int:
        """Fiş verisini bugünün Excel dosyasına yaz."""
        async with self._lock:
            try:
                file_path = self._daily_path(date.today())

                wb = self._ensure_workbook(file_path)
                ws = wb["Faturalar"]
                row = ws.max_row + 1

                kdv_oran_str = ", ".join(k.oran for k in data.kdv) if data.kdv else ""
                now_str = datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M:%S")

                row_data = [
                    data.tarih or "",
                    data.fis_no or "",
                    data.firma or "",
                    data.vkn or "",
                    data.masraf or "",
                    data.matrah_toplam,
                    kdv_oran_str,
                    data.kdv_toplam,
                    data.toplam or 0,
                    data.odeme or "",
                    confidence,
                    source.upper(),
                    sender,
                    now_str,
                ]

                for col_idx, value in enumerate(row_data, 1):
                    cell = ws.cell(row=row, column=col_idx, value=value)
                    cell.border = self.THIN_BORDER
                    cell.fill = self.EVEN_ROW_FILL if row % 2 == 0 else self.ODD_ROW_FILL

                for col in [6, 8, 9]:
                    ws.cell(row=row, column=col).number_format = '#,##0.00'

                conf_cell = ws.cell(row=row, column=11)
                if confidence >= 80:
                    conf_cell.font = self.GREEN_FONT
                elif confidence >= 60:
                    conf_cell.font = self.ORANGE_FONT
                else:
                    conf_cell.font = self.RED_FONT

                wb.save(str(file_path))

                logger.info("Excel satırı eklendi", event="excel_row_added",
                            file=file_path.name, row_number=row,
                            store=data.firma, total=data.toplam,
                            source=source, confidence=confidence)

                return row

            except Exception as e:
                logger.error("Excel yazma hatası", event="excel_error", error=str(e))
                raise

    async def update_row(self, row_number: int, data: dict, target_date: Optional[date] = None) -> bool:
        """Belirtilen satırı güncelle (firma, tarih, toplam, odeme, masraf)."""
        async with self._lock:
            try:
                file_path = self._daily_path(target_date)
                if not file_path.exists():
                    return False

                wb = load_workbook(str(file_path))
                ws = wb["Faturalar"]

                if row_number < 2 or row_number > ws.max_row:
                    wb.close()
                    return False

                # Sütun eşlemesi: field → column index
                field_col_map = {
                    "tarih": 1,
                    "fis_no": 2,
                    "firma": 3,
                    "vkn": 4,
                    "masraf": 5,
                    "matrah": 6,
                    "kdv_oran": 7,
                    "kdv_tutar": 8,
                    "toplam": 9,
                    "odeme": 10,
                }

                for field_name, col_idx in field_col_map.items():
                    if field_name in data and data[field_name] is not None:
                        ws.cell(row=row_number, column=col_idx, value=data[field_name])

                for col in [6, 8, 9]:
                    ws.cell(row=row_number, column=col).number_format = '#,##0.00'

                wb.save(str(file_path))
                wb.close()

                logger.info("Excel satırı güncellendi", event="excel_row_updated",
                            file=file_path.name, row_number=row_number, fields=list(data.keys()))
                return True

            except Exception as e:
                logger.error("Excel güncelleme hatası", event="excel_update_error", error=str(e))
                raise

    async def get_row_count(self, target_date: Optional[date] = None) -> int:
        async with self._lock:
            try:
                path = self._daily_path(target_date)
                if not path.exists():
                    return 0
                wb = load_workbook(str(path), read_only=True)
                ws = wb["Faturalar"]
                count = max(ws.max_row - 1, 0)
                wb.close()
                return count
            except Exception:
                return 0

    async def get_file_path(self, target_date: Optional[date] = None) -> Optional[str]:
        path = self._daily_path(target_date)
        if path.exists():
            return str(path.resolve())
        return None

    async def get_file_bytes(self, target_date: Optional[date] = None) -> Optional[bytes]:
        async with self._lock:
            path = self._daily_path(target_date)
            if path.exists():
                return path.read_bytes()
            return None

    async def export_all_combined(self) -> Optional[str]:
        """Tüm günlük dosyaları tek bir Excel'de birleştirir."""
        async with self._lock:
            try:
                daily_files = sorted(self._data_dir.glob("*.xlsx"))
                if not daily_files:
                    return None

                combined_wb = Workbook()
                combined_ws = combined_wb.active
                combined_ws.title = "Tüm Faturalar"
                self._setup_header(combined_ws)

                combined_row = 2
                total_files = 0

                for daily_file in daily_files:
                    try:
                        wb = load_workbook(str(daily_file), read_only=True)
                        ws = wb["Faturalar"]
                        for row in ws.iter_rows(min_row=2, values_only=True):
                            if not any(row):
                                continue
                            for col_idx, value in enumerate(row, 1):
                                cell = combined_ws.cell(row=combined_row, column=col_idx, value=value)
                                cell.border = self.THIN_BORDER
                                cell.fill = self.EVEN_ROW_FILL if combined_row % 2 == 0 else self.ODD_ROW_FILL
                            combined_row += 1
                        wb.close()
                        total_files += 1
                    except Exception as e:
                        logger.warning(f"Dosya okunamadı: {daily_file.name}", error=str(e))

                for row_num in range(2, combined_row):
                    for col in [6, 8, 9]:
                        combined_ws.cell(row=row_num, column=col).number_format = '#,##0.00'

                self._create_combined_summary(combined_wb, combined_row - 2, total_files)

                output_path = self._data_dir.parent / "all_invoices.xlsx"
                combined_wb.save(str(output_path))

                logger.info("Birleşik Excel oluşturuldu", event="excel_combined",
                            total_files=total_files, total_rows=combined_row - 2)

                return str(output_path.resolve())

            except Exception as e:
                logger.error("Birleştirme hatası", event="excel_combine_error", error=str(e))
                raise

    def _create_combined_summary(self, wb: Workbook, total_rows: int, total_files: int):
        ws = wb.create_sheet("Özet")
        title_font = Font(name="Calibri", bold=True, size=14, color="1F4E79")
        label_font = Font(name="Calibri", bold=True, size=11)
        value_font = Font(name="Calibri", size=11)

        ws.column_dimensions["A"].width = 28
        ws.column_dimensions["B"].width = 30

        ws["A1"] = "Fatura Bot — Tüm Faturalar Özeti"
        ws["A1"].font = title_font

        rows = [
            ("A3", "Toplam Gün Sayısı:", "B3", total_files),
            ("A4", "Toplam Fiş Sayısı:", "B4", "=COUNTA('Tüm Faturalar'!A2:A1000000)"),
            ("A5", "Toplam Harcama (₺):", "B5", "=SUM('Tüm Faturalar'!I2:I1000000)"),
            ("A6", "Toplam KDV (₺):", "B6", "=SUM('Tüm Faturalar'!H2:H1000000)"),
            ("A7", "Toplam Matrah (₺):", "B7", "=SUM('Tüm Faturalar'!F2:F1000000)"),
            ("A8", "OCR ile İşlenen:", "B8", '=COUNTIF(\'Tüm Faturalar\'!L2:L1000000,"OCR")'),
            ("A9", "Gemini ile İşlenen:", "B9", '=COUNTIF(\'Tüm Faturalar\'!L2:L1000000,"GEMINI")'),
            ("A10", "Oluşturma Tarihi:", "B10", datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M")),
        ]

        for label_ref, label, val_ref, value in rows:
            ws[label_ref] = label
            ws[label_ref].font = label_font
            ws[val_ref] = value
            ws[val_ref].font = value_font

        ws["B5"].number_format = '#,##0.00'
        ws["B6"].number_format = '#,##0.00'
        ws["B7"].number_format = '#,##0.00'

    async def list_daily_files(self) -> list[dict]:
        files = []
        for f in sorted(self._data_dir.glob("*.xlsx"), reverse=True):
            try:
                wb = load_workbook(str(f), read_only=True)
                ws = wb["Faturalar"]
                count = max(ws.max_row - 1, 0)
                wb.close()
                files.append({"date": f.stem, "file": f.name, "row_count": count})
            except Exception:
                files.append({"date": f.stem, "file": f.name, "row_count": 0})
        return files
