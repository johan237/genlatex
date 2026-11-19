/**
 * Client-side Excel (.xlsx, .xls) to LaTeX table using SheetJS (xlsx).
 * No backend/LLM required.
 */

import * as XLSX from "xlsx";
import { rowsToLatexTable } from "./table-to-latex";

const MAX_ROWS = 1000;

/**
 * Read an Excel file and return LaTeX tabular (booktabs). Uses first sheet.
 */
export async function excelFileToLatexTable(
  file: File,
  options: { useBooktabs?: boolean; hasHeader?: boolean } = {}
): Promise<string> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: false });
  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) throw new Error("Workbook has no sheets.");
  const sheet = wb.Sheets[firstSheetName];
  const aoa: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
  });
  const rows = (aoa as unknown[][]).slice(0, MAX_ROWS).map((row) => (row as unknown[]).map((c) => String(c ?? "")));
  if (rows.length === 0) throw new Error("Sheet has no data.");
  return rowsToLatexTable(rows, { useBooktabs: true, hasHeader: true, ...options });
}
