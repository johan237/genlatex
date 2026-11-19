/**
 * Parse CSV/TSV text and generate LaTeX tabular (booktabs-style).
 */

function escapeLatexCell(s: string): string {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/&/g, "\\&")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/\$/g, "\\$")
    .replace(/%/g, "\\%")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .trim();
}

function detectSeparator(text: string): string {
  const firstLine = text.split("\n")[0] || "";
  if (firstLine.includes("\t")) return "\t";
  const commaCount = (firstLine.match(/,/g) || []).length;
  const semicolonCount = (firstLine.match(/;/g) || []).length;
  if (semicolonCount >= commaCount) return ";";
  return ",";
}

function parseRows(text: string): string[][] {
  const sep = detectSeparator(text);
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.map((line) => {
    const cells: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes && (c === sep || c === "\t")) {
        cells.push(current.trim());
        current = "";
      } else {
        current += c;
      }
    }
    cells.push(current.trim());
    return cells;
  });
}

export function csvToLatexTable(
  csvText: string,
  options: { useBooktabs?: boolean; hasHeader?: boolean } = {}
): string {
  const { useBooktabs = true, hasHeader = true } = options;
  const rows = parseRows(csvText);
  if (rows.length === 0) return "";

  const colCount = Math.max(...rows.map((r) => r.length));
  const align = "l".repeat(colCount);
  const hline = useBooktabs ? "\\toprule" : "\\hline";
  const midRule = useBooktabs ? "\\midrule" : "\\hline";
  const bottomRule = useBooktabs ? "\\bottomrule" : "\\hline";

  const lines: string[] = [];
  lines.push(useBooktabs ? "\\begin{tabular}{" + align + "}" : "\\begin{tabular}{|" + align.split("").join("|") + "|}");
  lines.push(hline);

  const dataRows = hasHeader && rows.length > 1 ? rows.slice(1) : rows;
  const headerRow = hasHeader && rows.length > 1 ? rows[0] : null;

  if (headerRow) {
    const headerCells = headerRow
      .concat(Array(colCount - headerRow.length).fill(""))
      .slice(0, colCount)
      .map(escapeLatexCell);
    lines.push("  " + headerCells.join(" & ") + " \\\\");
    lines.push(midRule);
  }

  for (const row of dataRows) {
    const cells = row
      .concat(Array(colCount - row.length).fill(""))
      .slice(0, colCount)
      .map(escapeLatexCell);
    lines.push("  " + cells.join(" & ") + " \\\\");
  }

  lines.push(bottomRule);
  lines.push("\\end{tabular}");
  return lines.join("\n");
}

/**
 * Build LaTeX tabular from a 2D array of cell strings (e.g. from Excel).
 * Same options as csvToLatexTable.
 */
export function rowsToLatexTable(
  rows: string[][],
  options: { useBooktabs?: boolean; hasHeader?: boolean } = {}
): string {
  if (rows.length === 0) return "";
  const colCount = Math.max(...rows.map((r) => r.length));
  const align = "l".repeat(colCount);
  const useBooktabs = options.useBooktabs ?? true;
  const hasHeader = options.hasHeader ?? true;
  const hline = useBooktabs ? "\\toprule" : "\\hline";
  const midRule = useBooktabs ? "\\midrule" : "\\hline";
  const bottomRule = useBooktabs ? "\\bottomrule" : "\\hline";

  const lines: string[] = [];
  lines.push(useBooktabs ? "\\begin{tabular}{" + align + "}" : "\\begin{tabular}{|" + align.split("").join("|") + "|}");
  lines.push(hline);

  const dataRows = hasHeader && rows.length > 1 ? rows.slice(1) : rows;
  const headerRow = hasHeader && rows.length > 1 ? rows[0] : null;

  if (headerRow) {
    const headerCells = headerRow
      .concat(Array(colCount - headerRow.length).fill(""))
      .slice(0, colCount)
      .map((c) => escapeLatexCell(String(c)));
    lines.push("  " + headerCells.join(" & ") + " \\\\");
    lines.push(midRule);
  }

  for (const row of dataRows) {
    const cells = row
      .concat(Array(colCount - row.length).fill(""))
      .slice(0, colCount)
      .map((c) => escapeLatexCell(String(c)));
    lines.push("  " + cells.join(" & ") + " \\\\");
  }

  lines.push(bottomRule);
  lines.push("\\end{tabular}");
  return lines.join("\n");
}
