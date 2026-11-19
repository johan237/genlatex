/**
 * Client-side DOI and arXiv to BibTeX using CrossRef and arXiv APIs.
 * No backend/LLM required. May be blocked by CORS; then use proxy (see app/api/tools/proxy).
 */

function escapeBibtex(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/{/g, "\\{").replace(/}/g, "\\}").replace(/&/g, "\\&");
}

function normalizeDoi(identifier: string): string | null {
  const s = identifier.trim();
  if (!s) return null;
  if (s.includes("doi.org/")) {
    const m = s.match(/doi\.org\/(10\.\S+)/i);
    return m ? m[1].replace(/[?#&].*$/, "").trim() : null;
  }
  if (s.startsWith("10.") && s.includes("/")) return s.replace(/[?#&].*$/, "").trim();
  return null;
}

function normalizeArxivId(identifier: string): string | null {
  const s = identifier.trim();
  if (!s) return null;
  const m = s.match(/(?:arxiv\.org\/abs\/|arxiv\.org\/pdf\/)?(\d{4}\.\d{4,5})(?:v\d+)?/i);
  return m ? m[1] : null;
}

async function fetchCrossRef(doi: string): Promise<string | null> {
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return null;
  const data = await res.json();
  const items = data?.message?.items;
  if (!items?.length) return null;
  const item = items[0];
  const title = (item.title && item.title[0]) || "Untitled";
  const authors = (item.author || []).map(
    (a: { family?: string; given?: string }) => `${a.family || ""}, ${a.given || ""}`.trim()
  );
  const authorStr = authors.length ? authors.join(" and ") : "Unknown";
  const year = item.published?.["date-parts"]?.[0]?.[0] ?? "";
  const journal = (item["container-title"] && item["container-title"][0]) || "";
  const key = (authorStr.split(",")[0]?.replace(/\W/g, "") || "ref") + year;
  const lines = [
    `@article{${key},`,
    `  title = {${escapeBibtex(title)}},`,
    `  author = {${escapeBibtex(authorStr)}},`,
    `  year = {${year}},`,
    `  doi = {${doi}},`,
    `  url = {https://doi.org/${doi}},`,
  ];
  if (journal) lines.splice(-2, 0, `  journal = {${escapeBibtex(journal)}},`);
  lines.push("}");
  return lines.join("\n");
}

async function fetchArxiv(arxivId: string): Promise<string | null> {
  const url = `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(arxivId)}`;
  const res = await fetch(url, { headers: { Accept: "application/atom+xml" } });
  if (!res.ok) return null;
  const xml = await res.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const entry = doc.querySelector("entry");
  if (!entry) return null;
  const get = (tag: string) => entry.querySelector(tag)?.textContent?.trim() ?? "";
  const title = get("title")?.replace(/\s+/g, " ") || "Untitled";
  const summary = get("summary")?.replace(/\s+/g, " ").trim() || "";
  const authors = Array.from(entry.querySelectorAll("author name")).map((n) => n.textContent?.trim() ?? "");
  const authorStr = authors.length ? authors.join(" and ") : "Unknown";
  const published = get("published");
  const year = published ? new Date(published).getFullYear().toString() : "";
  const id = get("id") || `https://arxiv.org/abs/${arxivId}`;
  const linkPdf = entry.querySelector('link[title="pdf"]')?.getAttribute("href") ?? "";
  const key = (authorStr.split(" ").pop() || "arxiv").replace(/\W/g, "") + year;
  const lines = [
    `@article{${key},`,
    `  title = {${escapeBibtex(title)}},`,
    `  author = {${escapeBibtex(authorStr)}},`,
    `  year = {${year}},`,
    `  journal = {arXiv preprint},`,
    `  note = {arXiv:${arxivId}},`,
    `  url = {${id}},`,
  ];
  if (linkPdf) lines.push(`  pdf = {${linkPdf}},`);
  lines.push("}");
  return lines.join("\n");
}

/**
 * Resolve one identifier (DOI or arXiv) to BibTeX. Returns null if not found.
 */
export async function resolveIdentifierToBibtex(identifier: string): Promise<string | null> {
  const arxivId = normalizeArxivId(identifier);
  if (arxivId) {
    const bib = await fetchArxiv(arxivId);
    if (bib) return bib;
  }
  const doi = normalizeDoi(identifier);
  if (doi) {
    const bib = await fetchCrossRef(doi);
    if (bib) return bib;
  }
  return null;
}

/**
 * Resolve multiple identifiers (one per line or comma-separated) to concatenated BibTeX.
 */
export async function resolveIdentifiersToBibtex(identifiers: string[]): Promise<{ bibtex: string; errors: string[] }> {
  const entries: string[] = [];
  const errors: string[] = [];
  for (const id of identifiers) {
    const trimmed = id.trim();
    if (!trimmed) continue;
    const bib = await resolveIdentifierToBibtex(trimmed);
    if (bib) entries.push(bib);
    else errors.push(trimmed);
  }
  return { bibtex: entries.join("\n\n"), errors };
}
