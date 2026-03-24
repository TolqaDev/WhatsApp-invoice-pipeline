"""Fatura Bot — Fiş Aktarım Şablon formatında günlük Excel/CSV/XLS çıktı servisi."""

import asyncio
import csv
import io
import shutil
from datetime import datetime, timezone, date
from pathlib import Path
from typing import Optional

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

from src.models.schemas import ReceiptData
from src.utils.logger import logger

from src.services.luca_transformer import (
    MASRAF_HESAP_KODU, KDV_HESAP_KODU, ODEME_HESAP_KODU,
    ODEME_BELGE_TR, fis_to_luca_list,
)


class ExcelService:
    """Fiş Aktarım Şablon formatında Excel dosyası oluşturma servisi."""

    TEMPLATE_COLUMNS = [
        ("Fiş No",         14.15, "@"),
        ("Fiş Tarihi",     13.29, "dd/mm/yyyy"),
        ("Fiş Açıklama",   33.71, "@"),
        ("Hesap Kodu",     18.29, "@"),
        ("Evrak No",       15.15, "@"),
        ("Evrak Tarihi",   13.29, "dd/mm/yyyy"),
        ("Detay Açıklama", 34.71, "@"),
        ("Borç",           11.86, "#,##0.00"),
        ("Alacak",         11.86, "#,##0.00"),
        ("Miktar",         11.86, "#,##0.00000"),
        ("Belge Tr",       16.41, "@"),
        ("Para Birimi",    15.79, "@"),
        ("Kur",            11.86, "#,##0.00000000"),
        ("Döviz Tutarı",   17.55, "#,##0.00"),
    ]

    HEADER_FONT = Font(name="Calibri", bold=True, color="FF000000", size=10, charset=1, family=2)
    HEADER_FILL = PatternFill(patternType="solid", fgColor="FFC0C0C0", bgColor="FFCCCCFF")
    HEADER_ALIGNMENT = Alignment(horizontal="center", vertical="center", wrap_text=True)
    HEADER_ROW_HEIGHT = 21.75
    SHEET_NAME = "Fiş Aktarım Şablon"

    def __init__(self, data_dir: str = "public/daily"):
        self._data_dir = Path(data_dir)
        self._data_dir.mkdir(parents=True, exist_ok=True)
        self._lock = asyncio.Lock()
        self._template_path = Path(__file__).parent.parent / "templates" / "fis_aktarim_sablon.xlsx"

    @property
    def current_filename(self) -> str:
        """Günlük Excel dosyasının sadece adını döndürür (yol bilgisi olmadan)."""
        return self._daily_path().name

    def _daily_path(self, target_date: Optional[date] = None) -> Path:
        d = target_date or date.today()
        return self._data_dir / f"{d.isoformat()}.xlsx"

    @staticmethod
    def _parse_receipt_date(tarih_str: Optional[str]) -> Optional[str]:
        """Tarih string'ini DD/MM/YYYY formatına normalleştir."""
        if not tarih_str:
            return None
        try:
            parts = tarih_str.replace(".", "/").replace("-", "/").split("/")
            if len(parts) == 3:
                d, m, y = int(parts[0]), int(parts[1]), int(parts[2])
                if y < 100:
                    y += 2000
                return f"{d:02d}/{m:02d}/{y:04d}"
        except (ValueError, IndexError):
            pass
        return tarih_str

    def _ensure_workbook(self, file_path: Path) -> Workbook:
        """Mevcut dosyayı aç veya şablondan yenisini oluştur."""
        if file_path.exists():
            try:
                wb = load_workbook(str(file_path))
                if self.SHEET_NAME in wb.sheetnames:
                    return wb
                # Eski formatta dosya — yeni şablon oluştur
                wb.close()
            except Exception as e:
                logger.warning("Mevcut dosya okunamadı, yeniden oluşturulacak", error=str(e))

        # Şablon dosyasından kopyala
        if self._template_path.exists():
            try:
                shutil.copy2(str(self._template_path), str(file_path))
                return load_workbook(str(file_path))
            except Exception as e:
                logger.warning("Şablon kopyalanamadı, sıfırdan oluşturuluyor", error=str(e))

        wb = Workbook()
        ws = wb.active
        ws.title = self.SHEET_NAME
        self._setup_header(ws)
        wb.save(str(file_path))
        return wb

    def _setup_header(self, ws):
        """Şablon başlık satırını birebir oluştur."""
        ws.row_dimensions[1].height = self.HEADER_ROW_HEIGHT

        for col_idx, (title, width, num_fmt) in enumerate(self.TEMPLATE_COLUMNS, 1):
            cell = ws.cell(row=1, column=col_idx, value=title)
            cell.font = self.HEADER_FONT
            cell.fill = self.HEADER_FILL
            cell.alignment = self.HEADER_ALIGNMENT
            cell.number_format = num_fmt
            ws.column_dimensions[get_column_letter(col_idx)].width = width

    def _build_rows(self, data: ReceiptData) -> list[list]:
        """Bir fişten şablon formatında satır(lar) üretir.

        Çift kayıt (double-entry) muhasebe prensibi:
          • Gider hesabına BORÇ  (matrah)
          • KDV hesabına   BORÇ  (her oran için ayrı — varsa)
          • Ödeme hesabına ALACAK (toplam)
        Toplam borç == toplam alacak → muhasebe denkliği sağlanır.

        Dönüşüm mantığı luca_transformer modülüne delege edilmiştir.
        """
        return fis_to_luca_list(data)

    async def add_row(self, data: ReceiptData, confidence: int, sender: str, source: str = "gemini") -> int:
        """Fiş verisini bugünün dosyasına çift kayıt olarak yaz. İlk satır numarasını döndürür."""
        async with self._lock:
            try:
                file_path = self._daily_path(date.today())
                wb = self._ensure_workbook(file_path)
                ws = wb[self.SHEET_NAME]

                first_row = ws.max_row + 1
                template_rows = self._build_rows(data)

                for row_data in template_rows:
                    row_num = ws.max_row + 1
                    for col_idx, value in enumerate(row_data, 1):
                        cell = ws.cell(row=row_num, column=col_idx, value=value)
                        cell.number_format = self.TEMPLATE_COLUMNS[col_idx - 1][2]

                wb.save(str(file_path))

                logger.info(
                    "Fiş aktarım satır(lar)ı eklendi",
                    event="excel_row_added",
                    file=file_path.name,
                    first_row=first_row,
                    row_count=len(template_rows),
                    store=data.firma,
                    total=data.toplam,
                    source=source,
                    confidence=confidence,
                )
                return first_row

            except Exception as e:
                logger.error("Excel yazma hatası", event="excel_error", error=str(e))
                raise

    async def update_row(self, row_number: int, data: dict, target_date: Optional[date] = None) -> bool:
        """Belirtilen satır grubunu güncelle (aynı Fiş No'ya sahip satırlar)."""
        async with self._lock:
            try:
                file_path = self._daily_path(target_date)
                if not file_path.exists():
                    return False

                wb = load_workbook(str(file_path))
                if self.SHEET_NAME not in wb.sheetnames:
                    wb.close()
                    return False
                ws = wb[self.SHEET_NAME]

                if row_number < 2 or row_number > ws.max_row:
                    wb.close()
                    return False

                # Fiş No'dan grup satırlarını bul
                fis_no = ws.cell(row=row_number, column=1).value
                group_rows = [row_number]
                if fis_no:
                    for r in range(row_number + 1, ws.max_row + 1):
                        if ws.cell(row=r, column=1).value == fis_no:
                            group_rows.append(r)
                        else:
                            break

                for r in group_rows:
                    if "fis_no" in data and data["fis_no"] is not None:
                        ws.cell(row=r, column=1, value=data["fis_no"])
                        ws.cell(row=r, column=5, value=data["fis_no"])

                    if "tarih" in data and data["tarih"] is not None:
                        formatted = self._parse_receipt_date(data["tarih"])
                        ws.cell(row=r, column=2, value=formatted)
                        ws.cell(row=r, column=6, value=formatted)

                    if "firma" in data and data["firma"] is not None:
                        ws.cell(row=r, column=3, value=data["firma"])

                if "masraf" in data and data["masraf"] is not None:
                    masraf_kodu = MASRAF_HESAP_KODU.get(data["masraf"], "770.99")
                    ws.cell(row=group_rows[0], column=4, value=masraf_kodu)
                    firma_val = ws.cell(row=group_rows[0], column=3).value or ""
                    ws.cell(row=group_rows[0], column=7, value=f"{data['masraf']} - {firma_val}")

                if "toplam" in data and data["toplam"] is not None:
                    toplam = float(data["toplam"])
                    last_row = group_rows[-1]
                    ws.cell(row=last_row, column=9, value=round(toplam, 2))
                    if len(group_rows) == 2:
                        ws.cell(row=group_rows[0], column=8, value=round(toplam, 2))

                if "odeme" in data and data["odeme"] is not None:
                    odeme_key = data["odeme"].upper()
                    odeme_kodu = ODEME_HESAP_KODU.get(odeme_key, "100.01")
                    last_row = group_rows[-1]
                    ws.cell(row=last_row, column=4, value=odeme_kodu)
                    belge_tr = ODEME_BELGE_TR.get(odeme_key, "Fiş")
                    for r in group_rows:
                        ws.cell(row=r, column=11, value=belge_tr)

                wb.save(str(file_path))
                wb.close()

                logger.info(
                    "Excel satır grubu güncellendi",
                    event="excel_row_updated",
                    file=file_path.name,
                    row_number=row_number,
                    group_size=len(group_rows),
                    fields=list(data.keys()),
                )
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
                sheet = self.SHEET_NAME if self.SHEET_NAME in wb.sheetnames else wb.sheetnames[0]
                ws = wb[sheet]
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

    async def export_as_xlsx(self, target_date: Optional[date] = None) -> Optional[str]:
        """XLSX dosya yolu döndür (zaten şablon formatında)."""
        return await self.get_file_path(target_date)

    async def export_as_csv(self, target_date: Optional[date] = None) -> Optional[bytes]:
        """Şablon formatında CSV çıktısı üret (UTF-8 BOM, ; ayraçlı)."""
        async with self._lock:
            path = self._daily_path(target_date)
            if not path.exists():
                return None
            try:
                wb = load_workbook(str(path), read_only=True)
                sheet = self.SHEET_NAME if self.SHEET_NAME in wb.sheetnames else wb.sheetnames[0]
                ws = wb[sheet]

                output = io.StringIO()
                writer = csv.writer(output, delimiter=";", quoting=csv.QUOTE_MINIMAL)
                for row in ws.iter_rows(values_only=True):
                    writer.writerow([v if v is not None else "" for v in row])

                wb.close()
                return ("\ufeff" + output.getvalue()).encode("utf-8")
            except Exception as e:
                logger.error("CSV export hatası", event="csv_export_error", error=str(e))
                return None

    async def export_as_xls(self, target_date: Optional[date] = None) -> Optional[bytes]:
        """Legacy .xls (BIFF) formatında çıktı üret."""
        async with self._lock:
            path = self._daily_path(target_date)
            if not path.exists():
                return None
            try:
                import xlwt

                wb_src = load_workbook(str(path), read_only=True)
                sheet = self.SHEET_NAME if self.SHEET_NAME in wb_src.sheetnames else wb_src.sheetnames[0]
                ws_src = wb_src[sheet]

                wb_xls = xlwt.Workbook(encoding="utf-8")
                ws_xls = wb_xls.add_sheet(self.SHEET_NAME)

                header_style = xlwt.easyxf(
                    "font: name Calibri, bold on, height 200;"
                    "pattern: pattern solid, fore_colour gray25;"
                    "align: horiz center, vert center, wrap on;"
                )
                money_fmt = xlwt.easyxf(num_format_str="#,##0.00")

                for row_idx, row in enumerate(ws_src.iter_rows(values_only=True)):
                    for col_idx, value in enumerate(row):
                        val = value if value is not None else ""
                        if row_idx == 0:
                            ws_xls.write(row_idx, col_idx, val, header_style)
                        elif col_idx in (7, 8, 13):
                            ws_xls.write(row_idx, col_idx, val, money_fmt)
                        else:
                            ws_xls.write(row_idx, col_idx, val)

                for col_idx, (_, width, _) in enumerate(self.TEMPLATE_COLUMNS):
                    ws_xls.col(col_idx).width = int(width * 256)

                wb_src.close()
                buf = io.BytesIO()
                wb_xls.save(buf)
                return buf.getvalue()

            except ImportError:
                logger.warning("xlwt yüklü değil, XLS export devre dışı")
                return None
            except Exception as e:
                logger.error("XLS export hatası", event="xls_export_error", error=str(e))
                return None

    async def export_all_combined(self, fmt: str = "xlsx") -> Optional[str | bytes]:
        """Tüm günlük dosyaları birleştirir. fmt: xlsx | csv | xls"""
        async with self._lock:
            try:
                daily_files = sorted(self._data_dir.glob("*.xlsx"))
                if not daily_files:
                    return None

                combined_wb = Workbook()
                combined_ws = combined_wb.active
                combined_ws.title = self.SHEET_NAME
                self._setup_header(combined_ws)

                combined_row = 2
                total_files = 0

                for daily_file in daily_files:
                    try:
                        wb = load_workbook(str(daily_file), read_only=True)
                        sheet = self.SHEET_NAME if self.SHEET_NAME in wb.sheetnames else wb.sheetnames[0]
                        ws = wb[sheet]
                        for row in ws.iter_rows(min_row=2, values_only=True):
                            if not any(row):
                                continue
                            for col_idx, value in enumerate(row, 1):
                                cell = combined_ws.cell(row=combined_row, column=col_idx, value=value)
                                if col_idx <= len(self.TEMPLATE_COLUMNS):
                                    cell.number_format = self.TEMPLATE_COLUMNS[col_idx - 1][2]
                            combined_row += 1
                        wb.close()
                        total_files += 1
                    except Exception as e:
                        logger.warning(f"Dosya okunamadı: {daily_file.name}", error=str(e))

                self._create_combined_summary(combined_wb, combined_row - 2, total_files)

                output_path = self._data_dir.parent / "all_invoices.xlsx"
                combined_wb.save(str(output_path))

                logger.info(
                    "Birleşik dosya oluşturuldu",
                    event="excel_combined",
                    total_files=total_files,
                    total_rows=combined_row - 2,
                    format=fmt,
                )

                if fmt == "csv":
                    return self._xlsx_to_csv_bytes(output_path)
                elif fmt == "xls":
                    return self._xlsx_to_xls_bytes(output_path)
                else:
                    return str(output_path.resolve())

            except Exception as e:
                logger.error("Birleştirme hatası", event="excel_combine_error", error=str(e))
                raise

    def _xlsx_to_csv_bytes(self, xlsx_path: Path) -> Optional[bytes]:
        try:
            wb = load_workbook(str(xlsx_path), read_only=True)
            sheet = self.SHEET_NAME if self.SHEET_NAME in wb.sheetnames else wb.sheetnames[0]
            ws = wb[sheet]
            output = io.StringIO()
            writer = csv.writer(output, delimiter=";", quoting=csv.QUOTE_MINIMAL)
            for row in ws.iter_rows(values_only=True):
                writer.writerow([v if v is not None else "" for v in row])
            wb.close()
            return ("\ufeff" + output.getvalue()).encode("utf-8")
        except Exception as e:
            logger.error("XLSX→CSV dönüşüm hatası", error=str(e))
            return None

    def _xlsx_to_xls_bytes(self, xlsx_path: Path) -> Optional[bytes]:
        try:
            import xlwt
            wb_src = load_workbook(str(xlsx_path), read_only=True)
            sheet = self.SHEET_NAME if self.SHEET_NAME in wb_src.sheetnames else wb_src.sheetnames[0]
            ws_src = wb_src[sheet]

            wb_xls = xlwt.Workbook(encoding="utf-8")
            ws_xls = wb_xls.add_sheet(self.SHEET_NAME)

            header_style = xlwt.easyxf(
                "font: name Calibri, bold on, height 200;"
                "pattern: pattern solid, fore_colour gray25;"
                "align: horiz center, vert center, wrap on;"
            )
            for row_idx, row in enumerate(ws_src.iter_rows(values_only=True)):
                for col_idx, val in enumerate(row):
                    v = val if val is not None else ""
                    ws_xls.write(row_idx, col_idx, v, header_style if row_idx == 0 else xlwt.Style.default_style)

            for col_idx, (_, width, _) in enumerate(self.TEMPLATE_COLUMNS):
                ws_xls.col(col_idx).width = int(width * 256)

            wb_src.close()
            buf = io.BytesIO()
            wb_xls.save(buf)
            return buf.getvalue()
        except ImportError:
            logger.warning("xlwt yüklü değil, XLS export devre dışı")
            return None
        except Exception as e:
            logger.error("XLSX→XLS dönüşüm hatası", error=str(e))
            return None

    def _create_combined_summary(self, wb: Workbook, total_rows: int, total_files: int):
        ws = wb.create_sheet("Özet")
        title_font = Font(name="Calibri", bold=True, size=14, color="1F4E79")
        label_font = Font(name="Calibri", bold=True, size=11)
        value_font = Font(name="Calibri", size=11)

        ws.column_dimensions["A"].width = 28
        ws.column_dimensions["B"].width = 30

        ws["A1"] = "Fatura Bot — Fiş Aktarım Özeti"
        ws["A1"].font = title_font

        sheet_ref = f"'{self.SHEET_NAME}'"
        summary = [
            ("A3", "Toplam Gün Sayısı:", "B3", total_files),
            ("A4", "Toplam Satır Sayısı:", "B4", f"=COUNTA({sheet_ref}!A2:A1000000)"),
            ("A5", "Toplam Borç (₺):", "B5", f"=SUM({sheet_ref}!H2:H1000000)"),
            ("A6", "Toplam Alacak (₺):", "B6", f"=SUM({sheet_ref}!I2:I1000000)"),
            ("A7", "Oluşturma Tarihi:", "B7", datetime.now(timezone.utc).strftime("%d/%m/%Y %H:%M")),
        ]
        for label_ref, label, val_ref, value in summary:
            ws[label_ref] = label
            ws[label_ref].font = label_font
            ws[val_ref] = value
            ws[val_ref].font = value_font
        ws["B5"].number_format = "#,##0.00"
        ws["B6"].number_format = "#,##0.00"

    async def list_daily_files(self) -> list[dict]:
        files = []
        for f in sorted(self._data_dir.glob("*.xlsx"), reverse=True):
            try:
                wb = load_workbook(str(f), read_only=True)
                sheet = self.SHEET_NAME if self.SHEET_NAME in wb.sheetnames else wb.sheetnames[0]
                ws = wb[sheet]
                count = max(ws.max_row - 1, 0)
                wb.close()
                files.append({"date": f.stem, "file": f.name, "row_count": count})
            except Exception:
                files.append({"date": f.stem, "file": f.name, "row_count": 0})
        return files
