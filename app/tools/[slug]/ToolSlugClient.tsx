"use client";

import { useState } from "react";
import Link from "next/link";
import Navigation from "@/components/layout/Navigation";
import Footer from "@/components/layout/Footer";
import ToolResult from "@/components/tools/ToolResult";
import { getToolBySlug } from "@/lib/tools";
import { csvToLatexTable } from "@/lib/tools/table-to-latex";
import { excelFileToLatexTable } from "@/lib/tools/excel-to-latex";
import { formatLatex } from "@/lib/tools/latex-formatter";
import { resolveIdentifierToBibtex, resolveIdentifiersToBibtex } from "@/lib/tools/doi-to-bibtex";
import { pdfFileToLatexVerbatim } from "@/lib/tools/pdf-to-latex";
import { arxivIdentifierToLatex, arxivPdfFileToLatex } from "@/lib/tools/arxiv-to-latex";

const MOCK_OUTPUT: Record<string, string> = {
  "table-to-latex": "",
  "doi-to-bibtex": "@article{author2024,\n  title = {Example},\n  author = {Author},\n  year = {2024}\n}",
  "equation-to-latex": "\\int_0^1 x^2 \\, dx = \\frac{1}{3}",
  "pdf-equation-extractor": "\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}",
  "word-to-latex": "\\section{Introduction}\nSome text.",
  "latex-formatter": "",
  "arxiv-to-latex": "\\title{Paper}\n\\begin{abstract}\nAbstract text.\n\\end{abstract}",
  "abstract-generator": "This paper investigates the relationship between X and Y. We find that...",
  "thesis-statement-generator": "Climate change is primarily driven by anthropogenic emissions, and policy interventions are necessary to mitigate its effects.",
};

const APP_URL = process.env.NEXT_PUBLIC_SERVER_URL || "";

/** Parse response as JSON; if the server returns HTML or plain text, return a clear error instead of throwing. */
async function parseJsonFromResponse(res: Response): Promise<{ data: Record<string, unknown>; error?: string }> {
  const text = await res.text();
  try {
    return { data: JSON.parse(text) as Record<string, unknown> };
  } catch {
    const preview = text.trim().slice(0, 80).replace(/\s+/g, " ");
    return {
      data: {},
      error: `Server did not return JSON (got: "${preview}${text.length > 80 ? "…" : ""}"). Check that NEXT_PUBLIC_SERVER_URL points to the optional server workspace, not the Python backend or another server.`,
    };
  }
}

const FILE_ONLY_TOOL_CONFIG: Record<
  string,
  { accept: string; label: string; hint: string; maxMb: number }
> = {
  "pdf-equation-extractor": {
    accept: "application/pdf,.pdf",
    label: "Upload a PDF",
    hint: "We extract equations and return LaTeX. Max 10 MB.",
    maxMb: 10,
  },
  "word-to-latex": {
    accept: ".docx,.doc,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword",
    label: "Upload a Word document",
    hint: ".doc or .docx. Max 15 MB.",
    maxMb: 15,
  },
  "arxiv-to-latex": {
    accept: "application/pdf,.pdf",
    label: "Upload a PDF or enter arXiv ID below",
    hint: "PDF of a paper, or paste an arXiv URL/ID. Max 15 MB.",
    maxMb: 15,
  },
};

function FileOnlyToolSection({
  toolId,
  onResult,
  onResultFilename,
  onSourceFile,
  onError,
  loading,
  setLoading,
  appUrl,
}: {
  toolId: string;
  onResult: (s: string) => void;
  onResultFilename: (s: string | null) => void;
  onSourceFile?: (file: File | null) => void;
  onError: (s: string | null) => void;
  loading: boolean;
  setLoading: (b: boolean) => void;
  appUrl: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [arxivId, setArxivId] = useState("");
  const config = FILE_ONLY_TOOL_CONFIG[toolId];

  async function handleSubmit() {
    setLoading(true);
    onError(null);
    try {
      // Client-side: arXiv identifier only
      if (toolId === "arxiv-to-latex" && arxivId.trim() && !file) {
        onSourceFile?.(null);
        const latex = await arxivIdentifierToLatex(arxivId.trim());
        onResult(latex);
        onResultFilename("main.tex");
        return;
      }
      // Client-side: PDF equation extractor
      if (toolId === "pdf-equation-extractor" && file) {
        onSourceFile?.(file);
        const latex = await pdfFileToLatexVerbatim(file);
        onResult(latex);
        onResultFilename("equations.tex");
        return;
      }
      // Client-side: arXiv PDF upload
      if (toolId === "arxiv-to-latex" && file) {
        onSourceFile?.(file);
        const latex = await arxivPdfFileToLatex(file);
        onResult(latex);
        onResultFilename("main.tex");
        return;
      }
      if (!file) {
        onError(toolId === "arxiv-to-latex" ? "Upload a PDF or enter an arXiv URL." : "Please select a file.");
        return;
      }
      onSourceFile?.(file);
      if (!appUrl) throw new Error("Word conversion needs the optional server workspace. This static deployment has no server configured.");
      // Backend: word-to-latex
      const formData = new FormData();
      formData.append("file", file);
      if (toolId === "arxiv-to-latex" && arxivId.trim()) formData.append("identifier", arxivId.trim());
      const res = await fetch(`${appUrl}/api/tools/${toolId}`, { method: "POST", body: formData });
      const { data, error: parseError } = await parseJsonFromResponse(res);
      if (parseError) {
        onError(parseError);
        return;
      }
      if (!res.ok) {
        onError((data.message as string) || (data.error as string) || "Request failed.");
        return;
      }
      if (data.output != null) {
        onResult(data.output as string);
        onResultFilename(typeof data.filename === "string" ? data.filename : null);
      } else if (data.pdf_base64) {
        onResult(`[PDF received; ${(data.pdf_base64 as string).length} chars base64]`);
        onResultFilename("output.pdf");
      } else {
        onError("No output returned.");
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setLoading(false);
    }
  }

  if (!config) return null;
  return (
    <>
      <label className="block text-sm font-medium text-foreground mb-2">{config.label}</label>
      <p className="text-secondary text-sm mb-3">{config.hint}</p>
      <input
        type="file"
        accept={config.accept}
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        className="block w-full text-sm text-secondary file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 mb-3"
      />
      {file && <p className="text-sm text-foreground mb-3">Selected: {file.name}</p>}
      {toolId === "arxiv-to-latex" && (
        <>
          <label className="block text-sm font-medium text-foreground mb-2 mt-2">Or paste arXiv URL / ID</label>
          <input
            type="text"
            value={arxivId}
            onChange={(e) => setArxivId(e.target.value)}
            placeholder="e.g. https://arxiv.org/abs/1234.5678 or 1234.5678"
            className="w-full rounded-xl border border-border bg-gray-50 px-3 py-2 text-sm mb-3"
          />
        </>
      )}
      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading || (!file && (toolId !== "arxiv-to-latex" || !arxivId.trim()))}
        className="mt-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-gradient-to-r from-primary to-accent shadow-[0_8px_20px_rgba(38,104,255,0.35)] hover:translate-y-[-1px] transition-transform disabled:opacity-60"
      >
        {loading ? "Processing…" : "Convert"}
      </button>
    </>
  );
}

/** Tool IDs that use the backend API (POST to /api/tools/<id>) */
const BACKEND_TOOLS = new Set([
  "abstract-generator",
  "thesis-statement-generator",
  "equation-to-latex",
  "doi-to-bibtex",
]);

interface ToolSlugClientProps {
  slug: string;
}

export default function ToolSlugClient({ slug }: ToolSlugClientProps) {
  const tool = getToolBySlug(slug);
  const [result, setResult] = useState<string | null>(null);
  const [resultFilename, setResultFilename] = useState<string | null>(null);
  const [sourceFileForResult, setSourceFileForResult] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!tool) {
    return (
      <main className="min-h-screen bg-background">
        <Navigation />
        <section className="pt-32 pb-24 px-6">
          <div className="max-w-hero mx-auto text-center">
            <h1 className="font-heading text-2xl font-bold mb-4">Tool not found</h1>
            <Link href="/tools" className="text-primary font-semibold hover:underline">
              Back to tools
            </Link>
          </div>
        </section>
        <Footer />
      </main>
    );
  }

  const defaultFilename = tool.defaultFilename ?? "output.tex";
  const mockOutput = MOCK_OUTPUT[tool.id] ?? "\\documentclass{article}\n\\begin{document}\nSample output.\n\\end{document}";
  const isTableTool = tool.id === "table-to-latex";
  const isFormatterTool = tool.id === "latex-formatter";
  const isBackendTool = BACKEND_TOOLS.has(tool.id);
  const isFileOnlyTool =
    tool.id === "pdf-equation-extractor" ||
    tool.id === "word-to-latex" ||
    tool.id === "arxiv-to-latex";
  const hasRealUI = isTableTool || isFormatterTool || isBackendTool || isFileOnlyTool;
  const inputTitle = tool.id === "table-to-latex" ? "Table Information" : `${tool.name} Input`;
  const outputTitle = tool.id === "doi-to-bibtex" ? "BibTeX Code" : "LaTeX Code";
  const outputSubtitle =
    tool.id === "doi-to-bibtex"
      ? "Ready to use in your bibliography"
      : "Ready to use in your LaTeX documents";
  const hasResult = result !== null && result !== "";

  // --- Table to LaTeX (file upload: CSV/TSV client-side, Excel via API) ---
  const [tableFile, setTableFile] = useState<File | null>(null);
  const [tableText, setTableText] = useState("");
  async function handleTableConvert() {
    setError(null);
    if (!tableFile && !tableText.trim()) {
      setError("Paste table data or upload a CSV, TSV, or Excel file.");
      return;
    }
    if (tableFile) {
      const ext = tableFile.name.split(".").pop()?.toLowerCase() ?? "";
      if (ext === "xlsx" || ext === "xls") {
        setLoading(true);
        setError(null);
        try {
          const latex = await excelFileToLatexTable(tableFile);
          setSourceFileForResult(tableFile);
          setResult(latex);
          setResultFilename("table.tex");
        } catch (e) {
          setError(e instanceof Error ? e.message : "Conversion failed.");
        } finally {
          setLoading(false);
        }
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const text = (reader.result as string) || "";
          const latex = csvToLatexTable(text, { useBooktabs: true, hasHeader: true });
          setSourceFileForResult(tableFile);
          setResult(latex);
          setResultFilename(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : "Failed to convert.");
        }
      };
      reader.onerror = () => setError("Failed to read file.");
      reader.readAsText(tableFile, "utf-8");
      return;
    }
    try {
      const latex = csvToLatexTable(tableText.trim(), { useBooktabs: true, hasHeader: true });
      setSourceFileForResult(null);
      setResult(latex);
      setResultFilename(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to convert.");
    }
  }

  // --- LaTeX formatter (client-side: paste or .tex file upload) ---
  const [latexInput, setLatexInput] = useState("");
  const [formatterFile, setFormatterFile] = useState<File | null>(null);
  async function handleFormat() {
    setError(null);
    let source = latexInput.trim();
    if (formatterFile) {
      try {
        source = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve((r.result as string) || "");
          r.onerror = () => reject(new Error("Failed to read file."));
          r.readAsText(formatterFile, "utf-8");
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to read file.");
        return;
      }
    }
    if (!source.trim()) {
      setError("Paste LaTeX or upload a .tex file to format.");
      return;
    }
    try {
      const formatted = formatLatex(source);
      setSourceFileForResult(formatterFile ?? null);
      setResult(formatted);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to format.");
    }
  }

  // --- Backend tools: abstract, thesis, equation, doi (some support optional file upload) ---
  const [backendInput, setBackendInput] = useState<Record<string, string>>({});
  const [backendFile, setBackendFile] = useState<File | null>(null);

  async function handleBackendSubmit() {
    if (!tool) return;
    setError(null);
    setLoading(true);
    try {
      // DOI to BibTeX: client-side (no backend/LLM)
      if (tool.id === "doi-to-bibtex") {
        const hasFile = backendFile && backendFile.size > 0;
        if (hasFile) {
          const text = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve((r.result as string) || "");
            r.onerror = () => reject(new Error("Failed to read file."));
            r.readAsText(backendFile!, "utf-8");
          });
          const identifiers = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
          const { bibtex, errors } = await resolveIdentifiersToBibtex(identifiers);
          if (bibtex) {
            setSourceFileForResult(backendFile);
            setResult(bibtex);
            setResultFilename("references.bib");
            if (errors.length > 0) setError(`Could not resolve: ${errors.join(", ")}`);
          } else {
            setError(errors.length ? `Could not resolve: ${errors.join(", ")}` : "No valid identifiers in file.");
          }
        } else {
          const ident = (backendInput.identifier ?? "").trim();
          if (!ident) {
            setError("Enter a DOI or arXiv URL.");
            return;
          }
          const bib = await resolveIdentifierToBibtex(ident);
          if (bib) {
            setSourceFileForResult(null);
            setResult(bib);
            setResultFilename("references.bib");
          } else {
            setError("Could not find metadata for this identifier.");
          }
        }
        return;
      }

      if (!APP_URL) throw new Error("This tool needs the optional server workspace. For AI writing, open the editor and connect your own model.");
      const hasFile = backendFile && backendFile.size > 0;
      const url = `${APP_URL}/api/tools/${tool.id}`;

      if (
        (tool.id === "abstract-generator" && (hasFile || (backendInput.title ?? "").trim())) ||
        (tool.id === "thesis-statement-generator" && (hasFile || (backendInput.topic ?? "").trim()))
      ) {
        const formData = new FormData();
        if (hasFile) formData.append("file", backendFile!);
        if (tool.id === "abstract-generator") {
          if ((backendInput.title ?? "").trim()) formData.append("title", backendInput.title!.trim());
          if ((backendInput.keywords ?? "").trim()) formData.append("keywords", backendInput.keywords!.trim());
        } else if (tool.id === "thesis-statement-generator") {
          if ((backendInput.topic ?? "").trim()) formData.append("topic", backendInput.topic!.trim());
        }
        const res = await fetch(url, { method: "POST", body: formData });
        const { data, error: parseError } = await parseJsonFromResponse(res);
        if (parseError) {
          setError(parseError);
          return;
        }
        if (!res.ok) {
          setError((data.message as string) || (data.error as string) || "Request failed.");
          return;
        }
        if (data.output != null) {
          setSourceFileForResult(hasFile ? backendFile : null);
          setResult(data.output as string);
          setResultFilename(typeof data.filename === "string" ? data.filename : null);
        } else {
          setError("No output returned.");
        }
        return;
      }

      // JSON body (no file, or tool doesn't accept file)
      const body: Record<string, string> = {};
      if (tool.id === "abstract-generator") {
        body.title = backendInput.title ?? "";
        body.keywords = backendInput.keywords ?? "";
      } else if (tool.id === "thesis-statement-generator") {
        body.topic = backendInput.topic ?? "";
      } else if (tool.id === "equation-to-latex") {
        body.description = backendInput.description ?? "";
      }
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const { data, error: parseError } = await parseJsonFromResponse(res);
      if (parseError) {
        setError(parseError);
        return;
      }
      if (!res.ok) {
        setError((data.message as string) || (data.error as string) || "Request failed.");
        return;
      }
      if (data.output != null) {
        setSourceFileForResult(null);
        setResult(data.output as string);
        setResultFilename(typeof data.filename === "string" ? data.filename : null);
      } else {
        setError("No output returned.");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Request failed.";
      if (msg === "Failed to fetch" || msg.includes("fetch")) {
        setError(
          "Could not reach the server. If the tools site and app run on different URLs, set MARKETING_SITE_ORIGIN (or TOOLS_CORS_ORIGIN) in the app to this site’s URL. Otherwise check that the app and backend are running."
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-background" role="main" aria-label={tool.name}>
      <Navigation />
      <section className="pt-32 pb-24 px-6">
        <div className="max-w-hero mx-auto">
          <Link href="/tools" className="inline-block text-primary font-medium hover:underline mb-6">
            Back to tools
          </Link>
          <h1 className="font-heading text-4xl md:text-5xl font-bold mb-3">
            {tool.name}
          </h1>
          <p className="text-secondary text-lg mb-8 max-w-2xl">
            {tool.description}
          </p>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-200 text-red-800 text-sm p-4 mb-6">
              {error}
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-8">
            <div className="rounded-3xl border border-border/60 bg-white p-6 shadow-card-soft">
              <div className="flex items-center gap-4 mb-6">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-700 bg-amber-100 px-3 py-1 rounded-full">
                  Input
                </span>
                <div>
                  <h2 className="font-heading text-lg font-semibold text-foreground">{inputTitle}</h2>
                  <p className="text-sm text-secondary">Provide inputs to generate your output.</p>
                </div>
              </div>

              <div className="space-y-6">
                {/* Table to LaTeX: upload CSV, TSV, Excel, or paste data */}
                {isTableTool && (
                  <div className="space-y-4">
                    <label className="block text-sm font-medium text-foreground">Table Data</label>
                    <textarea
                      value={tableText}
                      onChange={(e) => setTableText(e.target.value)}
                      placeholder="Paste CSV/TSV data here (with headers if available)."
                      className="w-full h-28 rounded-2xl border border-border bg-gray-50 p-3 text-sm"
                    />
                    <div className="space-y-2">
                      <label className="block text-sm font-medium text-foreground">Upload Table File</label>
                      <label className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-gray-50 px-4 py-6 text-sm text-secondary cursor-pointer hover:border-primary/40 hover:text-foreground transition-colors">
                        <span>Click to select or drag and drop</span>
                        <span className="text-xs text-secondary">CSV, TSV, or Excel (.xlsx, .xls). Max 2 MB.</span>
                        <input
                          type="file"
                          accept=".csv,.tsv,.xlsx,.xls,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                          onChange={(e) => setTableFile(e.target.files?.[0] ?? null)}
                          className="sr-only"
                        />
                      </label>
                      {tableFile && <p className="text-sm text-foreground">Selected: {tableFile.name}</p>}
                    </div>
                    <div className="flex flex-wrap gap-3">
                      <button
                        type="button"
                        onClick={() => {
                          setTableFile(null);
                          setTableText("");
                          setResult(null);
                          setError(null);
                        }}
                        className="px-5 py-2.5 rounded-full text-sm font-semibold text-foreground border border-border bg-white hover:bg-gray-50 transition-colors"
                      >
                        Clear
                      </button>
                      <button
                        type="button"
                        onClick={handleTableConvert}
                        disabled={loading || (!tableFile && !tableText.trim())}
                        className="px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-gradient-to-r from-primary to-accent shadow-[0_8px_20px_rgba(38,104,255,0.35)] hover:translate-y-[-1px] transition-transform disabled:opacity-60 disabled:hover:translate-y-0"
                      >
                        {loading ? "Converting…" : "Convert to LaTeX"}
                      </button>
                    </div>
                  </div>
                )}

                {/* LaTeX formatter */}
                {isFormatterTool && (
                  <div className="space-y-4">
                    <label className="block text-sm font-medium text-foreground">Paste LaTeX or upload a .tex file</label>
                    <p className="text-secondary text-sm">Paste below or upload a .tex file. Max 1 MB.</p>
                    <input
                      type="file"
                      accept=".tex,text/x-tex"
                      onChange={(e) => setFormatterFile(e.target.files?.[0] ?? null)}
                      className="block w-full text-sm text-secondary file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20"
                    />
                    {formatterFile && <p className="text-sm text-foreground">Selected: {formatterFile.name}</p>}
                    <textarea
                      value={latexInput}
                      onChange={(e) => setLatexInput(e.target.value)}
                      placeholder="\\documentclass{article}\n\\begin{document}\nHello\n\\end{document}"
                      className="w-full h-40 rounded-2xl border border-border bg-gray-50 p-3 text-sm font-mono"
                    />
                    <button
                      type="button"
                      onClick={handleFormat}
                      className="px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-gradient-to-r from-primary to-accent shadow-[0_8px_20px_rgba(38,104,255,0.35)] hover:translate-y-[-1px] transition-transform"
                    >
                      Format
                    </button>
                  </div>
                )}

                {/* Backend tools: abstract, thesis, equation, doi */}
                {isBackendTool && (
                  <div className="space-y-4">
              {tool.id === "abstract-generator" && (
                <>
                  <label className="block text-sm font-medium text-foreground mb-2">Paper title</label>
                  <input
                    type="text"
                    value={backendInput.title ?? ""}
                    onChange={(e) => setBackendInput((p) => ({ ...p, title: e.target.value }))}
                    placeholder="e.g. Deep Learning for NLP"
                    className="w-full rounded-xl border border-border bg-gray-50 px-3 py-2 text-sm mb-4"
                  />
                  <label className="block text-sm font-medium text-foreground mb-2">Keywords or topic (optional)</label>
                  <input
                    type="text"
                    value={backendInput.keywords ?? ""}
                    onChange={(e) => setBackendInput((p) => ({ ...p, keywords: e.target.value }))}
                    placeholder="e.g. transformers, attention"
                    className="w-full rounded-xl border border-border bg-gray-50 px-3 py-2 text-sm mb-4"
                  />
                </>
              )}
              {tool.id === "thesis-statement-generator" && (
                <>
                  <label className="block text-sm font-medium text-foreground mb-2">Topic or question</label>
                  <textarea
                    value={backendInput.topic ?? ""}
                    onChange={(e) => setBackendInput((p) => ({ ...p, topic: e.target.value }))}
                    placeholder="e.g. impact of social media on mental health"
                    className="w-full h-24 rounded-xl border border-border bg-gray-50 p-3 text-sm mb-4"
                  />
                </>
              )}
              {tool.id === "equation-to-latex" && (
                <>
                  <label className="block text-sm font-medium text-foreground mb-2">Describe the equation in words</label>
                  <textarea
                    value={backendInput.description ?? ""}
                    onChange={(e) => setBackendInput((p) => ({ ...p, description: e.target.value }))}
                    placeholder="e.g. integral of x squared from 0 to 1"
                    className="w-full h-24 rounded-xl border border-border bg-gray-50 p-3 text-sm mb-3"
                  />
                </>
              )}
              {tool.id === "doi-to-bibtex" && (
                <>
                  <label className="block text-sm font-medium text-foreground mb-2">DOI, doi.org URL, or arXiv URL</label>
                  <input
                    type="text"
                    value={backendInput.identifier ?? ""}
                    onChange={(e) => setBackendInput((p) => ({ ...p, identifier: e.target.value }))}
                    placeholder="e.g. 10.1234/example or https://arxiv.org/abs/1234.5678"
                    className="w-full rounded-xl border border-border bg-gray-50 px-3 py-2 text-sm mb-4"
                  />
                </>
              )}
              {tool.id === "abstract-generator" && (
                <>
                  <p className="text-secondary text-sm mb-2 mt-2">Or upload a document to generate abstract from (PDF, .tex, .txt). Max 5 MB.</p>
                  <input
                    type="file"
                    accept=".pdf,.tex,.txt,application/pdf,text/plain,text/x-tex"
                    onChange={(e) => setBackendFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-secondary file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 mb-4"
                  />
                  {backendFile && <p className="text-sm text-foreground mb-4">Selected: {backendFile.name}</p>}
                </>
              )}
              {tool.id === "thesis-statement-generator" && (
                <>
                  <p className="text-secondary text-sm mb-2 mt-2">Or upload a document to generate thesis from (.tex, .txt). Max 2 MB.</p>
                  <input
                    type="file"
                    accept=".tex,.txt,text/plain,text/x-tex"
                    onChange={(e) => setBackendFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-secondary file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 mb-4"
                  />
                  {backendFile && <p className="text-sm text-foreground mb-4">Selected: {backendFile.name}</p>}
                </>
              )}
              {tool.id === "doi-to-bibtex" && (
                <>
                  <p className="text-secondary text-sm mb-2 mt-2">Or upload a .txt file with one DOI or arXiv URL per line.</p>
                  <input
                    type="file"
                    accept=".txt,text/plain"
                    onChange={(e) => setBackendFile(e.target.files?.[0] ?? null)}
                    className="block w-full text-sm text-secondary file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary/10 file:text-primary hover:file:bg-primary/20 mb-4"
                  />
                  {backendFile && <p className="text-sm text-foreground mb-4">Selected: {backendFile.name}</p>}
                </>
              )}
              <button
                type="button"
                onClick={handleBackendSubmit}
                disabled={
                  loading ||
                  (tool.id === "equation-to-latex" && !(backendInput.description?.trim())) ||
                  (tool.id === "abstract-generator" && !(backendInput.title?.trim() || backendFile)) ||
                  (tool.id === "thesis-statement-generator" && !(backendInput.topic?.trim() || backendFile)) ||
                  (tool.id === "doi-to-bibtex" && !(backendInput.identifier?.trim() || backendFile))
                }
                className="mt-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-gradient-to-r from-primary to-accent shadow-[0_8px_20px_rgba(38,104,255,0.35)] hover:translate-y-[-1px] transition-transform disabled:opacity-60"
              >
                {loading ? "Generating…" : tool.id === "doi-to-bibtex" ? "Get BibTeX" : "Generate"}
              </button>
                  </div>
                )}

                {/* File-only tools: pdf-equation-extractor, word-to-latex, arxiv-to-latex */}
                {isFileOnlyTool && (
                  <div className="space-y-4">
                    <FileOnlyToolSection
                      toolId={tool.id}
                      onResult={setResult}
                      onResultFilename={setResultFilename}
                      onSourceFile={setSourceFileForResult}
                      onError={setError}
                      loading={loading}
                      setLoading={setLoading}
                      appUrl={APP_URL}
                    />
                  </div>
                )}

                {/* Placeholder for tools not yet implemented */}
                {!hasRealUI && (
                  <div className="space-y-4">
                    <p className="text-secondary text-sm">
                      This tool is in development. Try the sample output to see Download and Open in GenLaTeX.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        setSourceFileForResult(null);
                        setResult(mockOutput);
                      }}
                      className="px-5 py-2.5 rounded-full text-sm font-semibold text-white bg-gradient-to-r from-primary to-accent shadow-[0_8px_20px_rgba(38,104,255,0.35)] hover:translate-y-[-1px] transition-transform"
                    >
                      Try sample output
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-border/60 bg-white p-6 shadow-card-soft">
              <div className="flex items-center gap-4 mb-6">
                <span className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700 bg-emerald-100 px-3 py-1 rounded-full">
                  Output
                </span>
                <div>
                  <h2 className="font-heading text-lg font-semibold text-foreground">{outputTitle}</h2>
                  <p className="text-sm text-secondary">{outputSubtitle}</p>
                </div>
              </div>

              {hasResult ? (
                <ToolResult
                  output={result}
                  filename={resultFilename ?? defaultFilename}
                  toolSlug={tool.id}
                  sourceFile={sourceFileForResult ? { name: sourceFileForResult.name, data: sourceFileForResult } : undefined}
                  variant="plain"
                />
              ) : (
                <div className="rounded-2xl border border-border bg-gray-50 p-6 text-center text-secondary">
                  <div className="font-heading text-3xl text-secondary/60 mb-4">L A T E X</div>
                  <p className="text-sm mb-6">Your output will appear here</p>
                  <ol className="text-sm space-y-2 text-left max-w-xs mx-auto">
                    <li>1. Paste or upload your input</li>
                    <li>2. Click Convert or Generate</li>
                    <li>3. Get LaTeX output</li>
                  </ol>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
