"""
Public tools API for the marketing site: abstract generator, thesis statement,
equation-to-LaTeX, DOI/arXiv to BibTeX, table-to-LaTeX (file upload), image-to-LaTeX (file upload).
No auth; rate limiting applied at app level. /tools/* is intentionally unauthenticated for the
marketing/landing site; do not expose the backend publicly without rate limiting.
"""

from __future__ import annotations

import base64
import io
import logging
import os
import re
import tempfile
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tools", tags=["tools"])

# Max file sizes (bytes)
MAX_TABLE_FILE_SIZE = 2 * 1024 * 1024  # 2 MB
MAX_IMAGE_FILE_SIZE = 4 * 1024 * 1024   # 4 MB
MAX_ABSTRACT_FILE_SIZE = 5 * 1024 * 1024   # 5 MB
MAX_THESIS_FILE_SIZE = 2 * 1024 * 1024   # 2 MB
MAX_DOI_FILE_SIZE = 1 * 1024 * 1024   # 1 MB
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
ALLOWED_TABLE_EXTENSIONS = {".csv", ".tsv", ".xlsx", ".xls"}


# --- Request/response models ---

class AbstractGeneratorRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=2000)
    keywords: Optional[str] = Field(None, max_length=1000)


class ThesisStatementRequest(BaseModel):
    topic: str = Field(..., min_length=1, max_length=2000)


class EquationToLatexRequest(BaseModel):
    description: str = Field(..., min_length=1, max_length=2000)


class DoiToBibtexRequest(BaseModel):
    identifier: str = Field(..., min_length=1, max_length=500)


class ToolResponse(BaseModel):
    output: str
    filename: str


def _get_llm():
    from langchain_openai import ChatOpenAI
    max_tokens_raw = os.getenv("GENLATEX_LLM_MAX_TOKENS", "2048")
    try:
        max_tokens = int(max_tokens_raw)
    except Exception:
        max_tokens = 2048
    max_tokens = max(256, min(max_tokens, 12000))
    return ChatOpenAI(
        model=os.getenv("AI_MODEL") or os.getenv("AI_MODEL_FALLBACK") or "deepseek/deepseek-chat",
        base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        api_key=os.getenv("OPENROUTER_API_KEY"),
        temperature=0.3,
        max_tokens=max_tokens,
    )


async def _llm_invoke(prompt: str, system: Optional[str] = None) -> str:
    from langchain_core.messages import HumanMessage, SystemMessage
    llm = _get_llm()
    messages = []
    if system:
        messages.append(SystemMessage(content=system))
    messages.append(HumanMessage(content=prompt))
    response = await llm.ainvoke(messages)
    return (response.content or "").strip()


def _extract_text_from_upload(content: bytes, filename: str) -> str:
    """Extract plain text from uploaded PDF, .tex, or .txt."""
    ext = os.path.splitext(filename or "")[1].lower()
    if ext == ".txt":
        return content.decode("utf-8", errors="replace")
    if ext == ".tex":
        return content.decode("utf-8", errors="replace")
    if ext == ".pdf":
        try:
            import pdfplumber
            with pdfplumber.open(io.BytesIO(content)) as pdf:
                parts = []
                for page in pdf.pages[:50]:  # limit pages
                    t = page.extract_text()
                    if t:
                        parts.append(t)
                return "\n\n".join(parts) if parts else ""
        except Exception as e:
            logger.warning("pdfplumber extract failed: %s", e)
            return ""
    return content.decode("utf-8", errors="replace")


# --- Abstract generator ---

@router.post("/abstract-generator", response_model=ToolResponse)
async def abstract_generator_request(request: Request) -> ToolResponse:
    """Accepts either JSON (title, keywords) or multipart (file, optional title, keywords)."""
    content_type = (request.headers.get("content-type") or "").lower()
    if "multipart/form-data" in content_type:
        form = await request.form()
        file_part = form.get("file")
        title = (form.get("title") or "").strip() if isinstance(form.get("title"), str) else ""
        keywords = (form.get("keywords") or "").strip() if isinstance(form.get("keywords"), str) else ""
        if file_part and hasattr(file_part, "read"):
            file_content = await file_part.read()
            filename = getattr(file_part, "filename", "") or "upload"
            if len(file_content) > MAX_ABSTRACT_FILE_SIZE:
                return JSONResponse(
                    status_code=413,
                    content={"error": "file_too_large", "message": "File is too large (max 5 MB)."},
                )
            text = _extract_text_from_upload(file_content, filename)
            if not text.strip():
                return JSONResponse(
                    status_code=400,
                    content={"error": "empty_content", "message": "Could not extract text from the file."},
                )
            prompt = f"""Based on the following document content, write a concise academic abstract (2–4 sentences, about 100–150 words). Output only the abstract text, no heading or labels.

Document content (excerpt):
{text[:8000]}

Abstract:"""
            if title:
                prompt = f"Paper title: {title}\n\n" + prompt
            if keywords:
                prompt += f"\nKeywords to reflect: {keywords}"
            try:
                out = await _llm_invoke(prompt)
                if not out:
                    raise ValueError("Empty response from model")
                latex = out.replace("\\", "\\\\").replace("&", "\\&").replace("%", "\\%")
                return ToolResponse(output=f"\\begin{{abstract}}\n{latex}\n\\end{{abstract}}", filename="abstract.tex")
            except Exception as e:
                logger.exception("abstract_generator (file) failed")
                return JSONResponse(status_code=500, content={"error": "generation_failed", "message": str(e)})
        if not title:
            return JSONResponse(
                status_code=400,
                content={"error": "missing_title", "message": "Provide a title or upload a document."},
            )
        req = AbstractGeneratorRequest(title=title, keywords=keywords or None)
    else:
        body = await request.json()
        req = AbstractGeneratorRequest(title=body.get("title", ""), keywords=body.get("keywords"))
        if not req.title.strip():
            return JSONResponse(status_code=400, content={"error": "missing_title", "message": "Title is required."})

    try:
        prompt = f"Generate a concise academic abstract (2–4 sentences, about 100–150 words) for a paper with this title: {req.title}"
        if req.keywords and req.keywords.strip():
            prompt += f"\nKeywords or topic: {req.keywords.strip()}"
        prompt += "\n\nOutput only the abstract text, no heading or labels. Use clear academic style."
        out = await _llm_invoke(prompt)
        if not out:
            raise ValueError("Empty response from model")
        # Optionally wrap in LaTeX paragraph
        latex = out.replace("\\", "\\\\").replace("&", "\\&").replace("%", "\\%")
        return ToolResponse(output=f"\\begin{{abstract}}\n{latex}\n\\end{{abstract}}", filename="abstract.tex")
    except Exception as e:
        logger.exception("abstract_generator failed")
        return JSONResponse(
            status_code=500,
            content={"error": "generation_failed", "message": str(e)},
        )


# --- Thesis statement generator ---

@router.post("/thesis-statement-generator", response_model=ToolResponse)
async def thesis_statement_generator_request(request: Request) -> ToolResponse:
    """Accepts either JSON (topic) or multipart (file, optional topic)."""
    content_type = (request.headers.get("content-type") or "").lower()
    if "multipart/form-data" in content_type:
        form = await request.form()
        file_part = form.get("file")
        topic = (form.get("topic") or "").strip() if isinstance(form.get("topic"), str) else ""
        if file_part and hasattr(file_part, "read"):
            file_content = await file_part.read()
            if len(file_content) > MAX_THESIS_FILE_SIZE:
                return JSONResponse(
                    status_code=413,
                    content={"error": "file_too_large", "message": "File is too large (max 2 MB)."},
                )
            filename = getattr(file_part, "filename", "") or "upload"
            text = _extract_text_from_upload(file_content, filename)
            if not text.strip():
                return JSONResponse(
                    status_code=400,
                    content={"error": "empty_content", "message": "Could not extract text from the file."},
                )
            prompt = f"""Based on the following document content, generate 1 to 3 clear, arguable thesis statements that could serve as the main claim of a paper.

Document content (excerpt):
{text[:6000]}

Output only the thesis statements, one per line. No numbering, no preamble."""
            if topic:
                prompt = f"Topic context: {topic}\n\n" + prompt
            try:
                out = await _llm_invoke(prompt)
                if not out:
                    raise ValueError("Empty response from model")
                return ToolResponse(output=out, filename="thesis.tex")
            except Exception as e:
                logger.exception("thesis_statement_generator (file) failed")
                return JSONResponse(status_code=500, content={"error": "generation_failed", "message": str(e)})
        if not topic:
            return JSONResponse(
                status_code=400,
                content={"error": "missing_topic", "message": "Provide a topic or upload a document."},
            )
        req = ThesisStatementRequest(topic=topic)
    else:
        body = await request.json()
        req = ThesisStatementRequest(topic=body.get("topic", ""))

    try:
        prompt = f"""Generate 1 to 3 clear, arguable thesis statements for an academic paper on this topic or question: {req.topic}

Output only the thesis statements, one per line. No numbering, no preamble. Each should be a single sentence that could serve as the main claim of a paper."""
        out = await _llm_invoke(prompt)
        if not out:
            raise ValueError("Empty response from model")
        return ToolResponse(output=out, filename="thesis.tex")
    except Exception as e:
        logger.exception("thesis_statement_generator failed")
        return JSONResponse(
            status_code=500,
            content={"error": "generation_failed", "message": str(e)},
        )


# --- Equation (plain language) to LaTeX ---

@router.post("/equation-to-latex", response_model=ToolResponse)
async def equation_to_latex(req: EquationToLatexRequest) -> ToolResponse:
    try:
        prompt = f"""Convert this description of a mathematical expression or equation into LaTeX math only.

Description: {req.description}

Rules:
- Output ONLY the LaTeX code for the math (e.g. \\frac{{a}}{{b}}, \\int_0^1, etc.). No \\documentclass, no \\begin{{document}}, no explanation.
- Use inline math if it is a short expression, or display math \\[ ... \\] if it is an equation. Prefer \\[ ... \\] for equations.
- Escape backslashes and braces correctly."""
        out = await _llm_invoke(prompt)
        if not out:
            raise ValueError("Empty response from model")
        # Strip markdown code blocks if present
        out = re.sub(r"^```\w*\n?", "", out)
        out = re.sub(r"\n?```\s*$", "", out)
        return ToolResponse(output=out.strip(), filename="equation.tex")
    except Exception as e:
        logger.exception("equation_to_latex failed")
        return JSONResponse(
            status_code=500,
            content={"error": "generation_failed", "message": str(e)},
        )


# --- DOI / arXiv to BibTeX ---

def _normalize_doi(identifier: str) -> Optional[str]:
    s = identifier.strip()
    if not s:
        return None
    # Extract DOI from URL
    if "doi.org/" in s:
        m = re.search(r"doi\.org/(10\.\S+)", s, re.I)
        if m:
            return m.group(1).rstrip("/?&#")
    if s.startswith("10.") and "/" in s:
        return s.split("?")[0].split("#")[0].strip()
    return None


def _normalize_arxiv_id(identifier: str) -> Optional[str]:
    s = identifier.strip()
    if not s:
        return None
    # arxiv.org/abs/1234.5678 or 1234.5678
    m = re.search(r"(?:arxiv\.org/abs/|arxiv\.org/pdf/)?(\d{4}\.\d{4,5})(?:v\d+)?", s, re.I)
    if m:
        return m.group(1)
    return None


def _crossref_to_bibtex(item: Dict[str, Any]) -> str:
    """Build one BibTeX entry from CrossRef API item (message.items[0])."""
    doi = item.get("DOI", "")
    if not doi:
        return ""
    title = item.get("title", ["Untitled"])[0]
    author_list = item.get("author", [])
    authors = []
    for a in author_list:
        family = a.get("family", "")
        given = a.get("given", "")
        if family:
            authors.append(f"{family}, {given}".strip(", "))
    author_str = " and ".join(authors) if authors else "Unknown"
    year = ""
    if item.get("published", {}).get("date-parts"):
        parts = item["published"]["date-parts"][0]
        if parts:
            year = str(parts[0])
    container = item.get("container-title", [])
    journal = container[0] if container else ""
    entry_type = "misc"
    key = re.sub(r"[^a-zA-Z0-9]", "", (authors[0].split(",")[0] if authors else "ref") + year)[:30]
    key = key or "ref"
    # Escape BibTeX specials in title/author
    def esc(t: str) -> str:
        return t.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("&", "\\&")
    lines = [
        f"@{entry_type}{{{key},",
        f"  title = {{{esc(title)}}},",
        f"  author = {{{esc(author_str)}}},",
        f"  year = {{{year}}},",
        f"  doi = {{{doi}}},",
        f"  url = {{https://doi.org/{doi}}},",
    ]
    if journal:
        lines.insert(-2, f"  howpublished = {{{esc(journal)}}},")
    lines.append("}")
    return "\n".join(lines)


def _arxiv_to_bibtex(paper: Any) -> str:
    """Build one BibTeX entry from arxiv.Result."""
    title = getattr(paper, "title", "Untitled")
    authors = getattr(paper, "authors", [])
    author_str = " and ".join(str(a).replace(" ", ", ") for a in authors) if authors else "Unknown"
    year = str(getattr(paper, "published", None).year) if getattr(paper, "published", None) else ""
    arxiv_id = getattr(paper, "entry_id", "").split("/abs/")[-1].rstrip("/") or ""
    url = getattr(paper, "entry_id", f"https://arxiv.org/abs/{arxiv_id}")
    pdf_url = getattr(paper, "pdf_url", "")
    key = re.sub(r"[^a-zA-Z0-9]", "", (str(authors[0]).split()[-1] if authors else "arxiv") + year)[:30]
    key = key or "arxiv"
    def esc(t: str) -> str:
        return t.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("&", "\\&")
    lines = [
        f"@misc{{{key},",
        f"  title = {{{esc(title)}}},",
        f"  author = {{{esc(author_str)}}},",
        f"  year = {{{year}}},",
        f"  howpublished = {{arXiv preprint}},",
        f"  note = {{arXiv:{arxiv_id}}},",
        f"  url = {{{url}}},",
    ]
    if pdf_url:
        lines.append(f"  pdf = {{{pdf_url}}},")
    lines.append("}")
    return "\n".join(lines)


async def _resolve_identifier_to_bibtex(identifier: str) -> Optional[str]:
    """Resolve one DOI or arXiv identifier to BibTeX; return None if not found."""
    doi = _normalize_doi(identifier)
    arxiv_id = _normalize_arxiv_id(identifier)
    if arxiv_id:
        try:
            import arxiv
            search = arxiv.Search(id_list=[arxiv_id])
            paper = next(search.results(), None)
            if paper:
                return _arxiv_to_bibtex(paper)
        except Exception as e:
            logger.warning("arXiv fetch failed: %s", e)
    if doi:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                r = await client.get(
                    f"https://api.crossref.org/works/{httpx.quote(doi, safe='')}",
                )
                if r.status_code == 200:
                    data = r.json()
                    items = data.get("message", {}).get("items", [])
                    if items:
                        return _crossref_to_bibtex(items[0])
        except Exception as e:
            logger.warning("CrossRef fetch failed: %s", e)
    return None


@router.post("/doi-to-bibtex", response_model=ToolResponse)
async def doi_to_bibtex_request(request: Request) -> ToolResponse:
    """Accepts either JSON (identifier) or multipart (file with one DOI/arXiv per line)."""
    content_type = (request.headers.get("content-type") or "").lower()
    identifiers: List[str] = []
    if "multipart/form-data" in content_type:
        form = await request.form()
        file_part = form.get("file")
        single = (form.get("identifier") or "").strip() if isinstance(form.get("identifier"), str) else ""
        if file_part and hasattr(file_part, "read"):
            file_content = await file_part.read()
            if len(file_content) > MAX_DOI_FILE_SIZE:
                return JSONResponse(
                    status_code=413,
                    content={"error": "file_too_large", "message": "File is too large (max 1 MB)."},
                )
            text = file_content.decode("utf-8", errors="replace")
            identifiers = [line.strip() for line in text.splitlines() if line.strip()]
        elif single:
            identifiers = [single]
        else:
            return JSONResponse(
                status_code=400,
                content={"error": "missing_identifier", "message": "Provide a DOI/arXiv or upload a file with one per line."},
            )
    else:
        body = await request.json()
        ident = (body.get("identifier") or "").strip()
        if not ident:
            return JSONResponse(status_code=400, content={"error": "missing_identifier", "message": "Identifier is required."})
        identifiers = [ident]

    if not identifiers:
        return JSONResponse(status_code=400, content={"error": "missing_identifier", "message": "Provide a DOI/arXiv or upload a file."})

    entries: List[str] = []
    for ident in identifiers:
        bib = await _resolve_identifier_to_bibtex(ident)
        if bib:
            entries.append(bib)
        else:
            doi = _normalize_doi(ident)
            arxiv_id = _normalize_arxiv_id(ident)
            if not doi and not arxiv_id:
                return JSONResponse(
                    status_code=400,
                    content={"error": "invalid_identifier", "message": f"Invalid identifier: {ident[:50]}..."},
                )

    if not entries:
        return JSONResponse(
            status_code=404,
            content={"error": "not_found", "message": "Could not find metadata for the given identifier(s)."},
        )
    return ToolResponse(output="\n\n".join(entries), filename="references.bib")


# --- Table to LaTeX (file upload: CSV, TSV, Excel) ---

def _escape_latex_cell(s: str) -> str:
    if s is None or (isinstance(s, float) and (s != s)):  # NaN
        return ""
    t = str(s).strip()
    for old, new in [("\\", "\\\\"), ("&", "\\&"), ("#", "\\#"), ("_", "\\_"), ("$", "\\$"), ("%", "\\%"), ("{", "\\{"), ("}", "\\}")]:
        t = t.replace(old, new)
    return t


def _dataframe_to_latex(df: Any) -> str:
    """Convert pandas DataFrame to LaTeX tabular (booktabs)."""
    import pandas as pd
    col_count = len(df.columns)
    align = "l" * col_count
    lines = [
        "\\begin{tabular}{" + align + "}",
        "\\toprule",
    ]
    # Header
    headers = [_escape_latex_cell(str(c)) for c in df.columns]
    lines.append("  " + " & ".join(headers) + " \\\\")
    lines.append("\\midrule")
    # Rows
    for _, row in df.iterrows():
        cells = [_escape_latex_cell(str(row[c])) for c in df.columns]
        lines.append("  " + " & ".join(cells) + " \\\\")
    lines.append("\\bottomrule")
    lines.append("\\end{tabular}")
    return "\n".join(lines)


@router.post("/table-to-latex", response_model=ToolResponse)
async def table_to_latex(file: UploadFile = File(...)) -> ToolResponse:
    if not file.filename:
        return JSONResponse(status_code=400, content={"error": "missing_file", "message": "No file provided."})
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_TABLE_EXTENSIONS:
        return JSONResponse(
            status_code=400,
            content={"error": "invalid_type", "message": "Upload a CSV, TSV, or Excel (.xlsx, .xls) file."},
        )
    content = await file.read()
    if len(content) > MAX_TABLE_FILE_SIZE:
        return JSONResponse(
            status_code=413,
            content={"error": "file_too_large", "message": "File is too large (max 2 MB)."},
        )
    try:
        import pandas as pd
        if ext in (".xlsx", ".xls"):
            df = pd.read_excel(io.BytesIO(content), nrows=1000)
        elif ext == ".tsv":
            df = pd.read_csv(io.BytesIO(content), sep="\t", nrows=1000, encoding="utf-8", on_bad_lines="skip")
        else:
            df = pd.read_csv(io.BytesIO(content), nrows=1000, encoding="utf-8", on_bad_lines="skip")
        if df.empty or len(df.columns) == 0:
            return JSONResponse(status_code=400, content={"error": "empty_file", "message": "File has no data or columns."})
        latex = _dataframe_to_latex(df)
        return ToolResponse(output=latex, filename="table.tex")
    except Exception as e:
        logger.exception("table_to_latex failed")
        return JSONResponse(
            status_code=500,
            content={"error": "conversion_failed", "message": str(e)},
        )


# --- Image to LaTeX (file upload + vision model) ---

def _get_vision_llm():
    """Vision-capable model for image-to-LaTeX (OpenRouter)."""
    from langchain_openai import ChatOpenAI
    # Prefer a vision model; fallback to default if not set
    model = os.getenv("VISION_MODEL") or os.getenv("AI_MODEL") or os.getenv("AI_MODEL_FALLBACK") or "openai/gpt-4o-mini"
    max_tokens_raw = os.getenv("GENLATEX_VISION_MAX_TOKENS", "1200")
    try:
        max_tokens = int(max_tokens_raw)
    except Exception:
        max_tokens = 1200
    max_tokens = max(256, min(max_tokens, 6000))
    return ChatOpenAI(
        model=model,
        base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        api_key=os.getenv("OPENROUTER_API_KEY"),
        temperature=0,
        max_tokens=max_tokens,
    )


async def _image_to_latex_vision(image_base64: str, mime: str) -> str:
    from langchain_core.messages import HumanMessage
    llm = _get_vision_llm()
    url = f"data:{mime};base64,{image_base64}"
    message = HumanMessage(
        content=[
            {"type": "text", "text": "Extract the mathematical formula or equation from this image. Output ONLY the LaTeX code, nothing else. No explanation, no \\documentclass, no \\begin{document}. Just the math (e.g. \\frac{1}{2}, E=mc^2 in LaTeX). Use \\[ ... \\] for display math if appropriate."},
            {"type": "image_url", "image_url": {"url": url}},
        ]
    )
    response = await llm.ainvoke([message])
    out = (response.content or "").strip()
    out = re.sub(r"^```\w*\n?", "", out)
    out = re.sub(r"\n?```\s*$", "", out)
    return out.strip()


@router.post("/image-to-latex", response_model=ToolResponse)
async def image_to_latex(file: UploadFile = File(...)) -> ToolResponse:
    if not file.filename:
        return JSONResponse(status_code=400, content={"error": "missing_file", "message": "No file provided."})
    ct = (file.content_type or "").lower()
    if ct not in ALLOWED_IMAGE_TYPES:
        return JSONResponse(
            status_code=400,
            content={"error": "invalid_type", "message": "Upload an image (JPEG, PNG, GIF, or WebP)."},
        )
    content = await file.read()
    if len(content) > MAX_IMAGE_FILE_SIZE:
        return JSONResponse(
            status_code=413,
            content={"error": "file_too_large", "message": "Image is too large (max 4 MB)."},
        )
    try:
        b64 = base64.b64encode(content).decode("ascii")
        latex = await _image_to_latex_vision(b64, ct)
        if not latex:
            return JSONResponse(
                status_code=422,
                content={"error": "no_math", "message": "No formula could be extracted from the image."},
            )
        return ToolResponse(output=latex, filename="equation.tex")
    except Exception as e:
        logger.exception("image_to_latex failed")
        return JSONResponse(
            status_code=500,
            content={"error": "conversion_failed", "message": str(e)},
        )


# --- LaTeX to PDF (file upload: .tex → compile; requires pdflatex) ---

MAX_LATEX_TO_PDF_SIZE = 2 * 1024 * 1024  # 2 MB
MAX_PDF_EQUATION_SIZE = 10 * 1024 * 1024  # 10 MB
MAX_WORD_TO_LATEX_SIZE = 15 * 1024 * 1024  # 15 MB
MAX_ARXIV_TO_LATEX_SIZE = 15 * 1024 * 1024  # 15 MB


@router.post("/latex-to-pdf")
async def latex_to_pdf(request: Request):
    """Accept .tex file; compile to PDF. Returns 501 if compiler not available."""
    content_type = (request.headers.get("content-type") or "").lower()
    if "multipart/form-data" not in content_type:
        return JSONResponse(status_code=400, content={"error": "missing_file", "message": "Upload a .tex file."})
    form = await request.form()
    file_part = form.get("file")
    if not file_part or not hasattr(file_part, "read"):
        return JSONResponse(status_code=400, content={"error": "missing_file", "message": "Upload a .tex file."})
    content = await file_part.read()
    if len(content) > MAX_LATEX_TO_PDF_SIZE:
        return JSONResponse(status_code=413, content={"error": "file_too_large", "message": "File is too large (max 2 MB)."})
    # Compilation would require pdflatex in the environment; not available in agent by default
    return JSONResponse(
        status_code=501,
        content={"error": "not_implemented", "message": "LaTeX compilation is not available here. Use the main GenLaTeX app to compile your project to PDF."},
    )


# --- PDF equation extractor (file upload: PDF → LaTeX equations) ---

@router.post("/pdf-equation-extractor", response_model=ToolResponse)
async def pdf_equation_extractor(file: UploadFile = File(...)) -> ToolResponse:
    """Extract text from PDF; return as LaTeX (equation-like content highlighted)."""
    if not file.filename:
        return JSONResponse(status_code=400, content={"error": "missing_file", "message": "No file provided."})
    ext = os.path.splitext(file.filename)[1].lower()
    if ext != ".pdf":
        return JSONResponse(status_code=400, content={"error": "invalid_type", "message": "Upload a PDF file."})
    content = await file.read()
    if len(content) > MAX_PDF_EQUATION_SIZE:
        return JSONResponse(status_code=413, content={"error": "file_too_large", "message": "File is too large (max 10 MB)."})
    try:
        text = _extract_text_from_upload(content, file.filename or "upload.pdf")
        if not text.strip():
            return JSONResponse(status_code=422, content={"error": "no_content", "message": "No text could be extracted from the PDF."})
        # Return extracted text wrapped in LaTeX verbatim for now; could add equation detection later
        escaped = text.replace("\\", "\\\\").replace("&", "\\&").replace("%", "\\%").replace("#", "\\#").replace("_", "\\_").replace("{", "\\{").replace("}", "\\}")
        latex = "\\begin{verbatim}\n" + escaped[:50000] + "\n\\end{verbatim}"
        return ToolResponse(output=latex, filename="equations.tex")
    except Exception as e:
        logger.exception("pdf_equation_extractor failed")
        return JSONResponse(status_code=500, content={"error": "conversion_failed", "message": str(e)})


# --- Word to LaTeX (file upload: .docx → LaTeX) ---

@router.post("/word-to-latex", response_model=ToolResponse)
async def word_to_latex(file: UploadFile = File(...)) -> ToolResponse:
    """Convert Word document to LaTeX (requires pandoc)."""
    if not file.filename:
        return JSONResponse(status_code=400, content={"error": "missing_file", "message": "No file provided."})
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in (".docx", ".doc"):
        return JSONResponse(status_code=400, content={"error": "invalid_type", "message": "Upload a Word document (.doc or .docx)."})
    content = await file.read()
    if len(content) > MAX_WORD_TO_LATEX_SIZE:
        return JSONResponse(status_code=413, content={"error": "file_too_large", "message": "File is too large (max 15 MB)."})
    try:
        import subprocess
        with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
            tmp.write(content)
            tmp_path = tmp.name
        out_path = tmp_path + ".tex"
        try:
            result = subprocess.run(
                ["pandoc", tmp_path, "-o", out_path, "--wrap=none"],
                capture_output=True,
                text=True,
                timeout=60,
            )
            if result.returncode != 0:
                err = (result.stderr or result.stdout or "").strip() or "Pandoc exited with an error."
                return JSONResponse(
                    status_code=501,
                    content={"error": "pandoc_failed", "message": f"Pandoc failed: {err[:200]}"},
                )
            with open(out_path, "r", encoding="utf-8", errors="replace") as f:
                latex = f.read()
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            try:
                os.unlink(out_path)
            except OSError:
                pass
        return ToolResponse(output=latex, filename="main.tex")
    except FileNotFoundError:
        return JSONResponse(
            status_code=501,
            content={
                "error": "pandoc_not_found",
                "message": "Pandoc is not on PATH. Close this terminal, open a new one, run 'pandoc --version' to confirm it's installed, then restart the API (e.g. python run_api.py).",
            },
        )
    except Exception as e:
        logger.exception("word_to_latex failed")
        return JSONResponse(status_code=500, content={"error": "conversion_failed", "message": str(e)})


# --- arXiv to structured LaTeX (identifier or PDF upload) ---

@router.post("/arxiv-to-latex")
async def arxiv_to_latex_request(request: Request):
    """Accept JSON { identifier: "arxiv id or url" } or multipart PDF file."""
    content_type = (request.headers.get("content-type") or "").lower()
    if "multipart/form-data" in content_type:
        form = await request.form()
        file_part = form.get("file")
        if file_part and hasattr(file_part, "read"):
            content = await file_part.read()
            if len(content) > MAX_ARXIV_TO_LATEX_SIZE:
                return JSONResponse(status_code=413, content={"error": "file_too_large", "message": "File is too large (max 15 MB)."})
            # PDF upload: extract text and return as minimal LaTeX
            text = _extract_text_from_upload(content, getattr(file_part, "filename", "") or "upload.pdf")
            if not text.strip():
                return JSONResponse(status_code=422, content={"error": "no_content", "message": "No text could be extracted from the PDF."})
            escaped = text.replace("\\", "\\\\").replace("&", "\\&").replace("%", "\\%").replace("#", "\\#").replace("_", "\\_").replace("{", "\\{").replace("}", "\\}")
            latex = "\\documentclass{article}\n\\begin{document}\n\\begin{verbatim}\n" + escaped[:80000] + "\n\\end{verbatim}\n\\end{document}"
            return ToolResponse(output=latex, filename="main.tex")
        return JSONResponse(status_code=400, content={"error": "missing_input", "message": "Upload a PDF or provide an arXiv identifier."})
    # JSON: arXiv identifier
    body = await request.json()
    identifier = (body.get("identifier") or "").strip()
    if not identifier:
        return JSONResponse(status_code=400, content={"error": "missing_identifier", "message": "Provide an arXiv URL or ID."})
    arxiv_id = _normalize_arxiv_id(identifier)
    if not arxiv_id:
        return JSONResponse(status_code=400, content={"error": "invalid_identifier", "message": "Invalid arXiv identifier."})
    try:
        import arxiv
        search = arxiv.Search(id_list=[arxiv_id])
        paper = next(search.results(), None)
        if not paper:
            return JSONResponse(status_code=404, content={"error": "not_found", "message": "arXiv paper not found."})
        title = getattr(paper, "title", "Untitled")
        summary = getattr(paper, "summary", "")
        authors = getattr(paper, "authors", [])
        author_str = " and ".join(str(a) for a in authors) if authors else "Unknown"
        def esc(t: str) -> str:
            return t.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}").replace("&", "\\&")
        latex = f"\\documentclass{{article}}\n\\title{{{esc(title)}}}\n\\author{{{esc(author_str)}}}\n\\begin{{document}}\n\\maketitle\n\\begin{{abstract}}\n{esc(summary)}\n\\end{{abstract}}\n\\end{{document}}"
        return ToolResponse(output=latex, filename="main.tex")
    except Exception as e:
        logger.exception("arxiv_to_latex failed")
        return JSONResponse(status_code=500, content={"error": "fetch_failed", "message": str(e)})
