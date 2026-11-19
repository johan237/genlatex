/**
 * Client-side PDF text extraction using PDF.js. No backend/LLM required.
 * Extracts text and wraps in LaTeX verbatim.
 */

const MAX_PAGES = 200;
const MAX_TEXT_LENGTH = 50000;

function escapeVerbatim(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/&/g, "\\&")
    .replace(/%/g, "\\%")
    .replace(/#/g, "\\#")
    .replace(/_/g, "\\_")
    .replace(/\$/g, "\\$");
}

/**
 * Extract text from a PDF file and return LaTeX with verbatim block.
 * Uses pdfjs-dist (loaded dynamically for browser only).
 */
export async function pdfFileToLatexVerbatim(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const pdfjs = await import("pdfjs-dist");
  if (typeof window !== "undefined") {
    const gwo = (pdfjs as unknown as { GlobalWorkerOptions?: { workerSrc: string } }).GlobalWorkerOptions;
    if (gwo && !gwo.workerSrc) {
      gwo.workerSrc = "https://unpkg.com/pdfjs-dist@5/build/pdf.worker.min.mjs";
    }
  }
  const loading = pdfjs.getDocument({ data: buf });
  const doc = await loading.promise;
  const numPages = Math.min(doc.numPages, MAX_PAGES);
  const parts: string[] = [];
  for (let i = 1; i <= numPages; i++) {
    const page = await doc.getPage(i);
    const tc = await page.getTextContent();
    const strs = (tc.items as { str?: string }[]).map((it) => it.str ?? "").filter(Boolean);
    parts.push(strs.join(" "));
  }
  let text = parts.join("\n\n").trim();
  if (text.length > MAX_TEXT_LENGTH) text = text.slice(0, MAX_TEXT_LENGTH) + "\n\n[... truncated ...]";
  const escaped = escapeVerbatim(text);
  return "\\begin{verbatim}\n" + escaped + "\n\\end{verbatim}";
}
