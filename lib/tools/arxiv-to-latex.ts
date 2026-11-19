/**
 * Client-side arXiv to LaTeX: fetch metadata by ID or extract text from PDF.
 * No backend/LLM required.
 */

import { pdfFileToLatexVerbatim } from "./pdf-to-latex";

function escapeLatex(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\{/g, "\\{")
    .replace(/\}/g, "\\}")
    .replace(/&/g, "\\&");
}

function normalizeArxivId(identifier: string): string | null {
  const s = identifier.trim();
  if (!s) return null;
  const m = s.match(/(?:arxiv\.org\/abs\/|arxiv\.org\/pdf\/)?(\d{4}\.\d{4,5})(?:v\d+)?/i);
  return m ? m[1] : null;
}

/**
 * Fetch arXiv metadata and return structured LaTeX (title, author, abstract).
 */
export async function arxivIdentifierToLatex(identifier: string): Promise<string> {
  const arxivId = normalizeArxivId(identifier);
  if (!arxivId) throw new Error("Invalid arXiv identifier.");
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
  const res = await fetch(url, { headers: { Accept: "application/atom+xml" } });
  if (!res.ok) throw new Error("Failed to fetch arXiv metadata.");
  const xml = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const entry = doc.querySelector("entry");
  if (!entry) throw new Error("arXiv entry not found.");
  const get = (tag: string) => entry.querySelector(tag)?.textContent?.trim() ?? "";
  const title = get("title")?.replace(/\s+/g, " ") || "Untitled";
  const summary = get("summary")?.replace(/\s+/g, " ").trim() || "";
  const authors = Array.from(entry.querySelectorAll("author name")).map((n) => n.textContent?.trim() ?? "");
  const authorStr = authors.length ? authors.join(" and ") : "Unknown";
  const id = get("id") || `https://arxiv.org/abs/${arxivId}`;
  const latex = [
    "\\documentclass{article}",
    "\\title{" + escapeLatex(title) + "}",
    "\\author{" + escapeLatex(authorStr) + "}",
    "\\begin{document}",
    "\\maketitle",
    "\\begin{abstract}",
    escapeLatex(summary),
    "\\end{abstract}",
    "\\end{document}",
  ].join("\n");
  return latex;
}

/**
 * Extract text from uploaded PDF and return minimal LaTeX document with verbatim content.
 */
export async function arxivPdfFileToLatex(file: File): Promise<string> {
  const verbatim = await pdfFileToLatexVerbatim(file);
  return "\\documentclass{article}\n\\begin{document}\n" + verbatim + "\n\\end{document}";
}
