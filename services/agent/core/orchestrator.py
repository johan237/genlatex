"""
Prompt-first orchestrator for GenLaTeX chat.

This module powers /api/chat and focuses on:
- Fast, single-pass LaTeX generation
- Direct project file updates (.tex/.bib/.sty/etc.)
- No autonomous research workflow
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import logging
import os
import re
import shutil
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional, Tuple

from langchain_core.messages import HumanMessage, SystemMessage
from langchain.prompts import ChatPromptTemplate
from langchain.prompts import MessagesPlaceholder
from langchain.agents import create_tool_calling_agent, AgentExecutor

from .base import ExecutionContext, ToolRegistry, create_default_registry
from .template_selector import TemplateSelector
from utils.image_fetcher import get_image_fetcher

logger = logging.getLogger(__name__)


SKIP_DIRS = {
    ".git",
    ".next",
    ".idea",
    ".vscode",
    "__pycache__",
    "node_modules",
    "venv",
    ".venv",
    "dist",
    "build",
}

TEXT_EXTENSIONS = {
    ".tex",
    ".bib",
    ".sty",
    ".cls",
    ".bst",
    ".txt",
    ".md",
    ".csv",
    ".json",
    ".yaml",
    ".yml",
    ".xml",
    ".html",
    ".css",
    ".js",
    ".ts",
    ".py",
}

IMAGE_EXTENSIONS = {
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".bmp",
    ".tiff",
    ".tif",
    ".webp",
    ".svg",
    ".ico",
}


def _clamp_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except Exception:
        value = default
    return max(minimum, min(value, maximum))


def _clamp_float_env(name: str, default: float, minimum: float, maximum: float) -> float:
    try:
        value = float(os.getenv(name, str(default)))
    except Exception:
        value = default
    return max(minimum, min(value, maximum))


def _hash_content(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _normalize_rel_path(path: str) -> str:
    raw = str(path or "").replace("\\", "/").strip()
    raw = re.sub(r"/+", "/", raw)
    while raw.startswith("./"):
        raw = raw[2:]
    return raw.lstrip("/")


def _is_text_file(path: Path) -> bool:
    return path.suffix.lower() in TEXT_EXTENSIONS


def _is_image_file(path: Path) -> bool:
    """Check if file extension indicates an image file."""
    return path.suffix.lower() in IMAGE_EXTENSIONS


def _validate_and_convert_image_content(content: str, file_path: Path) -> Tuple[bytes, bool]:
    """
    Validate image file content and convert base64 to binary if needed.

    Args:
        content: The content to validate (potentially base64 string)
        file_path: Path to the file being written

    Returns:
        Tuple of (binary_content, was_converted)
        - binary_content: The validated/converted binary data, or None if text
        - was_converted: True if base64 was detected and converted
    """
    if not _is_image_file(file_path):
        return None, False

    # Check if content looks like base64 (pure ASCII, reasonable length, valid chars)
    content_stripped = content.strip()

    # Base64 should only contain these characters
    base64_chars = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=")
    content_chars = set(content_stripped)

    # If content is pure base64 characters and reasonable length
    is_likely_base64 = (
        len(content_stripped) > 20 and  # Minimum reasonable base64 length
        len(content_stripped) < 1_000_000 and  # Maximum reasonable size
        content_chars.issubset(base64_chars) and
        '\n' not in content_stripped[:100]  # No newlines in first 100 chars
    )

    if is_likely_base64:
        try:
            # Attempt to decode base64
            binary_data = base64.b64decode(content_stripped, validate=True)

            # Verify it's actually image data by checking magic bytes
            is_valid_image = False
            if binary_data[:4] == b'\x89PNG':  # PNG
                is_valid_image = True
            elif binary_data[:2] in (b'\xff\xd8', b'\xff\xd9'):  # JPEG
                is_valid_image = True
            elif binary_data[:6] in (b'GIF87a', b'GIF89a'):  # GIF
                is_valid_image = True
            elif binary_data[:2] == b'BM':  # BMP
                is_valid_image = True
            elif binary_data[:4] in (b'II*\x00', b'MM\x00*'):  # TIFF
                is_valid_image = True

            if is_valid_image:
                logger.info(f"✅ Detected and converted base64 image to binary: {file_path.name}")
                return binary_data, True
            else:
                logger.warning(f"⚠️ Base64 decoded but not recognized as valid image format: {file_path.name}")
                return binary_data, True  # Still convert it, might be valid

        except Exception as e:
            logger.debug(f"Content not valid base64 or not an image: {e}")
            return None, False

    return None, False


def _extract_title_from_prompt(prompt: str, fallback: str) -> str:
    text = re.sub(r"\s+", " ", (prompt or "").strip())
    if not text:
        return fallback
    text = re.sub(r"^(please\s+)?(create|generate|write|build|draft)\s+", "", text, flags=re.I)
    words = text.split(" ")
    title = " ".join(words[:14]).strip(" .,:;-")
    if not title:
        return fallback
    return title[0].upper() + title[1:]


def _parse_attrs(attrs: str) -> Dict[str, str]:
    return {m.group(1).lower(): m.group(2) for m in re.finditer(r'(\w+)\s*=\s*"([^"]*)"', attrs or "")}


def _strip_code_fences(text: str) -> str:
    t = (text or "").strip()
    if not t.startswith("```"):
        return t
    m = re.match(r"^```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```$", t)
    if m:
        return m.group(1).strip()
    return t


class ChatEvent:
    """Event streamed to the frontend via SSE."""

    def __init__(self, event: str, data: Dict[str, Any]):
        self.event = event
        self.data = data

    def to_sse(self) -> str:
        return f"event: {self.event}\ndata: {json.dumps(self.data)}\n\n"


@dataclass
class Operation:
    op: str
    path: Optional[str] = None
    target_path: Optional[str] = None
    content: Optional[str] = None


class Orchestrator:
    """
    GenLaTeX chat orchestrator.

    The assistant behaves like ChatGPT for document generation, but writes outputs directly
    into the project filesystem when content is produced.
    """

    def __init__(self, llm=None, tool_registry: Optional[ToolRegistry] = None):
        self._default_llm = llm
        self._request_llm = None
        self.tools = tool_registry or create_default_registry()
        self.max_context_chars = _clamp_int_env("GENLATEX_CHAT_CONTEXT_CHARS", 16000, 4000, 50000)
        self.max_preview_files = _clamp_int_env("GENLATEX_CHAT_PREVIEW_FILES", 18, 4, 60)
        self.max_file_read_bytes = _clamp_int_env("GENLATEX_CHAT_FILE_READ_BYTES", 120000, 5000, 500000)
        self.heartbeat_sec = _clamp_int_env("GENLATEX_CHAT_HEARTBEAT_SEC", 8, 2, 30)
        self.model_timeout_sec = _clamp_int_env("GENLATEX_CHAT_MODEL_TIMEOUT_SEC", 140, 20, 900)
        # Initialize template selector for beautiful templates
        self.template_selector = TemplateSelector()
        # Store selected template for theme file copying
        self._selected_template = None

    def _build_llm(self, model: Optional[str] = None):
        from langchain_openai import ChatOpenAI

        llm_max_tokens = _clamp_int_env("GENLATEX_CHAT_MAX_TOKENS", 4096, 256, 8192)
        llm_temperature = _clamp_float_env("GENLATEX_CHAT_TEMPERATURE", 0.25, 0.0, 1.0)
        return ChatOpenAI(
            model=model or os.getenv("AI_MODEL") or os.getenv("AI_MODEL_FALLBACK") or "deepseek/deepseek-chat",
            base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
            api_key=os.getenv("OPENROUTER_API_KEY"),
            temperature=llm_temperature,
            max_tokens=llm_max_tokens,
            streaming=False,
        )

    @property
    def _effective_llm(self):
        if self._request_llm is not None:
            return self._request_llm
        if self._default_llm is None:
            self._default_llm = self._build_llm()
        return self._default_llm

    def _resolve_project_root(self, request: Dict[str, Any]) -> Path:
        project_path = request.get("project_path")
        project_id = str(request.get("project_id") or "default")

        if project_path:
            root = Path(project_path)
        else:
            root = Path("./output") / project_id

        root.mkdir(parents=True, exist_ok=True)
        return root.resolve()

    def _safe_resolve(self, project_root: Path, rel_path: str) -> Path:
        normalized = _normalize_rel_path(rel_path)
        if not normalized:
            raise ValueError("Empty path is not allowed")

        candidate = (project_root / normalized).resolve()
        root_resolved = project_root.resolve()
        if os.path.commonpath([str(root_resolved), str(candidate)]) != str(root_resolved):
            raise ValueError(f"Path escapes project root: {rel_path}")
        return candidate

    def _build_context(self, request: Dict[str, Any], project_root: Path) -> ExecutionContext:
        context = request.get("context") or {}
        highlighted = list(context.get("highlighted_files") or [])
        for item in list(context.get("mentioned_files") or []):
            if isinstance(item, str):
                candidate = item
            elif isinstance(item, dict):
                candidate = item.get("path") or item.get("file_path") or item.get("name") or ""
            else:
                candidate = ""
            candidate = _normalize_rel_path(candidate)
            if candidate and candidate not in highlighted:
                highlighted.append(candidate)

        return ExecutionContext(
            project_id=str(request.get("project_id") or ""),
            project_path=str(project_root),
            active_file=context.get("active_file"),
            selection=context.get("selection"),
            cursor_position=context.get("cursor_position"),
            current_document=context.get("current_document"),
            highlighted_files=highlighted,
            research_files=list(context.get("research_files") or []),
            tagged_imported_file_ids=list(context.get("tagged_imported_file_ids") or []),
            conversation_history=list(context.get("conversation_history") or []),
            zotero_config=context.get("zotero_config"),
        )

    def _detect_document_type(self, message: str, context: ExecutionContext) -> str:
        msg = (message or "").lower()
        active = (context.active_file or "").lower()

        if any(k in msg for k in ("slide", "presentation", "beamer", "powerpoint", "deck")):
            return "slides"
        if any(k in msg for k in ("cv", "resume", "curriculum vitae")):
            return "cv"
        if any(k in msg for k in ("cover letter", "motivation letter", "letter")):
            return "letter"
        if any(k in msg for k in ("invoice", "billing statement", "quotation")):
            return "invoice"
        if any(k in msg for k in ("report", "technical report", "business report")):
            return "report"
        if any(k in msg for k in ("article", "paper", "essay")):
            return "article"
        if active.endswith(".bib"):
            return "bibliography"
        return "article"

    def _pick_primary_tex(self, project_root: Path, context: ExecutionContext) -> str:
        active_file = _normalize_rel_path(context.active_file or "")
        if active_file.endswith(".tex"):
            return active_file

        main_tex = project_root / "main.tex"
        if main_tex.exists():
            return "main.tex"

        tex_candidates = sorted([p for p in project_root.glob("*.tex") if p.is_file()], key=lambda p: p.name.lower())
        if tex_candidates:
            return tex_candidates[0].name

        return "main.tex"

    def _is_generation_request(self, message: str) -> bool:
        msg = (message or "").lower()
        trigger_words = (
            "create",
            "generate",
            "write",
            "build",
            "draft",
            "make",
            "produce",
            "new document",
            "new file",
        )
        return any(word in msg for word in trigger_words)

    def _read_text_file(self, path: Path) -> Optional[str]:
        try:
            if not path.exists() or not path.is_file():
                return None
            if path.stat().st_size > self.max_file_read_bytes:
                return None
            if not _is_text_file(path):
                return None
            return path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            return None

    def _collect_project_snapshot(self, project_root: Path, context: ExecutionContext) -> Dict[str, Any]:
        listed_files: List[str] = []
        for path in project_root.rglob("*"):
            if any(part in SKIP_DIRS for part in path.parts):
                continue
            if not path.is_file():
                continue
            rel = path.relative_to(project_root).as_posix()
            listed_files.append(rel)
            if len(listed_files) >= 120:
                break

        focus_files: List[str] = []
        if context.active_file:
            focus_files.append(_normalize_rel_path(context.active_file))
        for p in context.highlighted_files:
            rp = _normalize_rel_path(p)
            if rp and rp not in focus_files:
                focus_files.append(rp)

        file_previews: List[Dict[str, str]] = []
        if context.current_document and context.active_file and context.active_file.endswith(".tex"):
            preview = context.current_document[: self.max_context_chars]
            file_previews.append(
                {
                    "path": _normalize_rel_path(context.active_file),
                    "content": preview,
                }
            )

        for rel in focus_files:
            if not rel:
                continue
            full = self._safe_resolve(project_root, rel)
            content = self._read_text_file(full)
            if not content:
                continue
            if any(item["path"] == rel for item in file_previews):
                continue
            file_previews.append({"path": rel, "content": content[: self.max_context_chars]})
            if len(file_previews) >= self.max_preview_files:
                break

        return {
            "project_files": listed_files,
            "previews": file_previews,
        }

    def _load_template(self, doc_type: str, user_prompt: str = "") -> Optional[str]:
        """
        Load template - first tries intelligent template selector, then falls back to basic templates.

        Args:
            doc_type: Document type (report, slides, cv, letter, etc.)
            user_prompt: User's prompt for intelligent template selection

        Returns:
            Template content or None
        """
        # Try intelligent template selection first if we have a user prompt
        if user_prompt and self.template_selector:
            try:
                # Map doc_type to category for template selector
                category_mapping = {
                    "slides": "presentation",
                    "report": "report",
                    "cv": "cv",
                    "letter": "letter",
                    "article": "article",
                    "invoice": "letter"  # Use letter template for invoices
                }
                category = category_mapping.get(doc_type, doc_type)

                # Select template based on user prompt
                template = self.template_selector.select_template(
                    prompt=user_prompt,
                    document_type=category
                )

                if template:
                    # Store selected template for theme file copying
                    self._selected_template = template

                    # Load template content
                    content = self.template_selector.load_template_content(template)
                    if content:
                        logger.info(f"✨ Selected beautiful template: {template['name']} for {doc_type}")
                        return content
            except Exception as e:
                logger.warning(f"Template selector failed, falling back to basic template: {e}")

        # Fall back to basic templates
        template_dir = Path(__file__).resolve().parent.parent / "template"
        mapping = {
            "report": "report.tex",
            "slides": "slides.tex",
            "cv": "cv.tex",
            "letter": "letter.tex",
            "invoice": "invoice.tex",
            "article": "main.tex",
        }
        filename = mapping.get(doc_type, "main.tex")
        path = template_dir / filename
        if not path.exists():
            return None
        try:
            return path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            return None

    def _default_content_block(self, doc_type: str) -> str:
        if doc_type == "slides":
            return (
                "\\begin{frame}{Overview}\n"
                "\\begin{itemize}\n"
                "  \\item \\textbf{Problem statement.} State the main problem or question this presentation addresses.\n"
                "  \\item \\textbf{Key findings.} Summarize the most important results or takeaways.\n"
                "  \\item \\textbf{Recommendations.} Outline suggested next steps or actions.\n"
                "\\end{itemize}\n"
                "\\end{frame}\n\n"
                "\\begin{frame}{Next Steps}\n"
                "\\begin{itemize}\n"
                "  \\item \\textbf{Implementation plan.} Describe how to put the ideas into practice.\n"
                "  \\item \\textbf{Risks and mitigation.} Note potential risks and how to address them.\n"
                "\\end{itemize}\n"
                "\\end{frame}"
            )
        if doc_type == "report":
            return (
                "\\chapter{Executive Summary}\n"
                "Provide a concise summary of the report objectives and outcomes.\n\n"
                "\\chapter{Background}\n"
                "Describe context, constraints, and baseline assumptions.\n\n"
                "\\chapter{Analysis}\n"
                "Present methods, evidence, and interpretation.\n\n"
                "\\chapter{Recommendations}\n"
                "Detail practical recommendations and implementation priorities."
            )
        if doc_type == "cv":
            return (
                "\\noindent\\textbf{Experience}\\\\\n"
                "\\begin{itemize}\n"
                "  \\item Add your work history with measurable outcomes.\n"
                "\\end{itemize}\n\n"
                "\\noindent\\textbf{Education}\\\\\n"
                "\\begin{itemize}\n"
                "  \\item Add degrees, institutions, and graduation dates.\n"
                "\\end{itemize}\n\n"
                "\\noindent\\textbf{Skills}\\\\\n"
                "\\begin{itemize}\n"
                "  \\item Add technical and professional skills.\n"
                "\\end{itemize}"
            )
        if doc_type == "letter":
            return "Write the main body of the letter here in short, clear paragraphs."
        if doc_type == "invoice":
            return (
                "\\begin{tabular}{p{0.5\\textwidth}r}\n"
                "\\toprule\n"
                "Description & Amount \\\\\n"
                "\\midrule\n"
                "Service item 1 & 0.00 \\\\\n"
                "Service item 2 & 0.00 \\\\\n"
                "\\midrule\n"
                "\\textbf{Total} & \\textbf{0.00} \\\\\n"
                "\\bottomrule\n"
                "\\end{tabular}"
            )
        return (
            "\\section{Introduction}\n"
            "Describe the objective and scope.\n\n"
            "\\section{Main Content}\n"
            "Develop your analysis, evidence, and discussion.\n\n"
            "\\section{Conclusion}\n"
            "Summarize key outcomes and next steps."
        )

    def _build_default_main_tex(self, doc_type: str, message: str) -> str:
        normalized_doc_type = str(doc_type or "article").strip().lower()
        if normalized_doc_type == "presentation":
            normalized_doc_type = "slides"
        if normalized_doc_type == "resume":
            normalized_doc_type = "cv"

        # Try to load intelligent template with user prompt
        template = self._load_template(normalized_doc_type, user_prompt=message)
        title = _extract_title_from_prompt(message, "Untitled Document")
        replacements = {
            "{{{TITLE}}}": title,
            "{{TITLE}}": title,
            "{{{AUTHOR}}}": "GenLaTeX",
            "{{AUTHOR}}": "GenLaTeX",
            "{{{DATE}}}": "\\today",
            "{{DATE}}": "\\today",
            "{{ABSTRACT}}": "Auto-generated draft. Replace with your final abstract/summary.",
            "{{KEYWORDS}}": "draft, generated-document",
            "{{CONTENT}}": self._default_content_block(normalized_doc_type),
            "{{AFFILIATION}}": "Organization",
            "{{EMAIL}}": "name@example.com",
        }
        if template:
            out = template
            for key, value in replacements.items():
                out = out.replace(key, value)
            return out

        if normalized_doc_type == "slides":
            return (
                "\\documentclass[aspectratio=169]{beamer}\n"
                "\\usetheme{Madrid}\n"
                "\\usepackage[utf8]{inputenc}\n"
                "\\title{" + title + "}\n"
                "\\author{GenLaTeX}\n"
                "\\date{\\today}\n"
                "\\begin{document}\n"
                "\\begin{frame}\\titlepage\\end{frame}\n\n"
                + self._default_content_block("slides")
                + "\n\\end{document}\n"
            )
        if normalized_doc_type in {"report", "business", "technical", "proposal"}:
            return (
                "\\documentclass[11pt,a4paper]{report}\n"
                "\\usepackage[utf8]{inputenc}\n"
                "\\usepackage[T1]{fontenc}\n"
                "\\usepackage{lmodern}\n"
                "\\usepackage{geometry}\n"
                "\\geometry{margin=1in}\n"
                "\\title{" + title + "}\n"
                "\\author{GenLaTeX}\n"
                "\\date{\\today}\n"
                "\\begin{document}\n"
                "\\maketitle\n"
                "\\tableofcontents\n\\newpage\n\n"
                + self._default_content_block("report")
                + "\n\n\\bibliographystyle{plain}\n\\bibliography{references}\n"
                "\\end{document}\n"
            )
        if normalized_doc_type == "cv":
            return (
                "\\documentclass[11pt,a4paper,sans]{moderncv}\n"
                "\\moderncvstyle{classic}\n"
                "\\moderncvcolor{blue}\n"
                "\\usepackage[utf8]{inputenc}\n"
                "\\usepackage[T1]{fontenc}\n"
                "\\usepackage[scale=0.85]{geometry}\n"
                "\\name{Candidate}{}\n"
                "\\title{" + title + "}\n"
                "\\email{name@example.com}\n"
                "\\begin{document}\n"
                "\\makecvtitle\n\n"
                + self._default_content_block("cv")
                + "\n\\end{document}\n"
            )
        if normalized_doc_type == "letter":
            return (
                "\\documentclass[11pt]{letter}\n"
                "\\signature{GenLaTeX}\n"
                "\\address{Organization\\\\Email}\n"
                "\\date{\\today}\n"
                "\\begin{document}\n"
                "\\begin{letter}{Recipient}\n"
                "\\opening{Dear Sir or Madam,}\n\n"
                + self._default_content_block("letter")
                + "\n\n\\closing{Sincerely,}\n"
                "\\end{letter}\n"
                "\\end{document}\n"
            )
        if normalized_doc_type == "invoice":
            return (
                "\\documentclass[11pt,a4paper]{article}\n"
                "\\usepackage[utf8]{inputenc}\n"
                "\\usepackage[T1]{fontenc}\n"
                "\\usepackage{lmodern}\n"
                "\\usepackage{geometry}\n"
                "\\usepackage{booktabs}\n"
                "\\geometry{margin=1in}\n"
                "\\title{" + title + "}\n"
                "\\date{\\today}\n"
                "\\begin{document}\n"
                "\\maketitle\n\n"
                + self._default_content_block("invoice")
                + "\n\\end{document}\n"
            )
        return (
            "\\documentclass[11pt,a4paper]{article}\n"
            "\\usepackage[utf8]{inputenc}\n"
            "\\usepackage[T1]{fontenc}\n"
            "\\usepackage{lmodern}\n"
            "\\usepackage{geometry}\n"
            "\\geometry{margin=1in}\n"
            "\\title{" + title + "}\n"
            "\\author{GenLaTeX}\n"
            "\\date{\\today}\n"
            "\\begin{document}\n"
            "\\maketitle\n\n"
            + self._default_content_block("article")
            + "\n\n\\bibliographystyle{plain}\n\\bibliography{references}\n"
            "\\end{document}\n"
        )

    def _build_system_prompt(self, doc_type: str, primary_tex: str) -> str:
        return (
            "You are GenLaTeX, an LLM for writing and editing LaTeX project files.\n"
            "Core behavior:\n"
            "- Do NOT trigger deep research workflows.\n"
            "- Do NOT browse or call external tools unless user explicitly asks for web data.\n"
            "- Use your internal knowledge and produce compilable LaTeX quickly.\n"
            "- If references are generated, write them to references.bib.\n"
            "- If style/package customizations are generated, write .sty files.\n\n"
            "Document-type bias:\n"
            "- report => use report-style structure (executive summary/background/analysis/recommendations)\n"
            "- slides => beamer (use \\documentclass{beamer}, NOT article!)\n"
            "- cv/resume => concise CV structure\n"
            "- letter => letter format\n\n"
            "BORDER STYLES AVAILABLE:\n"
            "When user requests borders, frames, boxes, or highlights, use these pre-validated packages:\n"
            "1. simple-borders.sty: Basic borders using \\simplebox{}, \\roundbox{}, \\bluebox{}, etc.\n"
            "2. section-borders.sty: Advanced section borders using \\begin{bluesection}, \\begin{greensection}, etc.\n"
            "3. page-borders.sty: Full page borders using \\enablesimplepageorder, \\enablebluepageorder, etc.\n"
            "- The appropriate .sty file will be auto-copied to the project\n"
            "- Just use \\usepackage{simple-borders} or \\usepackage{section-borders} in preamble\n"
            "- Then use the commands/environments in document body\n"
            "- DO NOT try to implement custom tcolorbox code - use these pre-validated styles!\n"
            "- Examples:\n"
            "  * \\bluebox{Important information here}\n"
            "  * \\begin{bluesection} Multi-paragraph bordered section \\end{bluesection}\n"
            "  * \\begin{leftbarblue} Quote or highlight \\end{leftbarblue}\n\n"
            "IMAGES:\n"
            "When the user message lists 'Available images (use ONLY these exact paths)', use ONLY those paths in \\includegraphics.\n"
            "- Images are fetched BEFORE your response; the paths listed are the only ones that exist in the project.\n"
            "- Example: If listed as 'images/presentation.jpg', use \\includegraphics[width=0.8\\textwidth]{images/presentation.jpg}\n"
            "- Do NOT invent other image paths (e.g. images/ai_revolution.jpg) unless that exact path appears in the list.\n"
            "- If 'Available images: None', do NOT add \\includegraphics for new images.\n"
            "- DO NOT use base64 encoding for images.\n\n"
            "CRITICAL: Document Type Changes\n"
            f"- The detected document type is: {doc_type}\n"
            "- If user requests a DIFFERENT document type than what exists in the files:\n"
            "  * COMPLETELY REPLACE the main .tex file with the correct document class\n"
            "  * For slides/presentations: Use \\documentclass{{beamer}}, NOT article\n"
            "  * For reports: Use \\documentclass{{report}}, NOT article\n"
            "  * Do NOT just modify the existing file - create NEW content with correct structure\n\n"
            "CRITICAL: ALWAYS WRITE MAIN CONTENT\n"
            "- When user asks to 'generate', 'create', or 'write' a document:\n"
            f"  * You MUST write FULL content to {primary_tex} - NOT just auxiliary files!\n"
            "  * Auxiliary files (.sty, .bib, images) are SUPPLEMENTS, not replacements\n"
            "  * User expects to see ACTUAL CONTENT in the main .tex file\n"
            "  * DO NOT create only style files or references - ALWAYS include main content\n"
            "  * Example: If creating a report, write the COMPLETE report with all sections\n"
            "  * Example: If creating a presentation, write ALL slides with content\n"
            f"  * MANDATORY: The <write path=\"{primary_tex}\"> tag MUST appear in your response\n\n"
            "Return output using these XML-like tags only:\n"
            "<response>Short user-facing summary.</response>\n"
            "<write path=\"relative/path.ext\">\n"
            "FULL FILE CONTENT\n"
            "</write>\n"
            "<append path=\"relative/path.ext\">TEXT TO APPEND</append>\n"
            "<mkdir path=\"relative/folder\"/>\n"
            "<delete path=\"relative/path.ext\"/>\n"
            "<delete_dir path=\"relative/folder\"/>\n"
            "<move from=\"old/path\" to=\"new/path\"/>\n"
            "<copy from=\"old/path\" to=\"new/path\"/>\n\n"
            "Rules:\n"
            "- Keep response concise.\n"
            "- For a new document request, include at least one <write> to a .tex file.\n"
            f"- Default primary .tex file is {primary_tex}.\n"
            f"- Current detected document type is {doc_type}.\n"
            "- If you include bibliography citations, also include references.bib content.\n"
        )

    def _build_user_prompt(
        self,
        message: str,
        doc_type: str,
        primary_tex: str,
        snapshot: Dict[str, Any],
        context: ExecutionContext,
    ) -> str:
        preview_parts: List[str] = []
        for preview in snapshot.get("previews", []):
            preview_parts.append(
                f"FILE: {preview['path']}\n"
                "-----\n"
                f"{preview['content']}\n"
                "-----"
            )
        previews_text = "\n\n".join(preview_parts) if preview_parts else "(no file previews)"
        files_text = ", ".join(snapshot.get("project_files", [])[:120]) or "(empty project)"

        history = context.conversation_history[-6:] if context.conversation_history else []
        history_text = "\n".join(f"{m.get('role', 'user')}: {m.get('content', '')}" for m in history)

        available_images = snapshot.get("available_images") or []
        if available_images:
            images_instruction = (
                f"Available images (use ONLY these exact paths in \\includegraphics): "
                + ", ".join(available_images)
                + "\n- Reference ONLY the paths listed above. Do NOT invent other image paths.\n"
            )
        else:
            images_instruction = (
                "Available images: None.\n"
                "- Do NOT add \\includegraphics unless the user request did not ask for images.\n"
                "- If the user asked for an image but none are listed above, omit the image from the document.\n"
            )

        research_context_block = ""
        if snapshot.get("research_file_context"):
            research_context_block = (
                "\n\nUPLOADED RESEARCH FILES CONTEXT (use this in your response where relevant):\n"
                "-----\n"
                f"{snapshot['research_file_context']}\n"
                "-----\n\n"
            )

        return (
            f"User request:\n{message}\n\n"
            f"Detected doc type: {doc_type}\n"
            f"Primary tex target: {primary_tex}\n\n"
            f"{images_instruction}\n"
            f"Project files:\n{files_text}\n\n"
            f"Conversation history (recent):\n{history_text or '(none)'}\n\n"
            f"Current file previews:\n{previews_text}\n\n"
            f"{research_context_block}"
            "Produce the tagged output now."
        )

    async def _gather_research_file_context(
        self, context: ExecutionContext, message: str
    ) -> str:
        """When research_files are present, run a short tool loop so the LLM can list/read/search files; return gathered context string."""
        research_files = getattr(context, "research_files", None) or []
        if not research_files:
            return ""
        try:
            from tools.file_tools import FileTools
            from tools.file_tool_definitions import create_file_tools
            file_tools = FileTools(research_files=research_files)
            tool_list = create_file_tools(file_tools)
            if not tool_list:
                return ""
            llm = self._effective_llm
            prompt = ChatPromptTemplate.from_messages([
                ("system", "You have access to file tools. Use list_available_files, then read_file_content or search_file_content to get content relevant to the user's request. Return only relevant excerpts and summaries (no preamble)."),
                ("human", "{input}"),
                MessagesPlaceholder(variable_name="agent_scratchpad"),
            ])
            agent = create_tool_calling_agent(llm, tool_list, prompt)
            executor = AgentExecutor(agent=agent, tools=tool_list, verbose=False, max_iterations=5, handle_parsing_errors=True)
            result = await executor.ainvoke({
                "input": f"User request: {message[:500]}. Use the file tools to gather relevant content from the uploaded files. Return only the relevant excerpts/summaries."
            })
            out = (result.get("output") or "").strip()
            if out and len(out) > 80:
                return out[:4000] + ("\n... [truncated]" if len(out) > 4000 else "")
        except Exception as e:
            logger.warning("Research file context gathering failed: %s", e)
        return ""

    async def _generate_llm_output(
        self,
        message: str,
        doc_type: str,
        primary_tex: str,
        snapshot: Dict[str, Any],
        context: ExecutionContext,
    ) -> str:
        llm = self._effective_llm
        system_prompt = self._build_system_prompt(doc_type, primary_tex)
        user_prompt = self._build_user_prompt(message, doc_type, primary_tex, snapshot, context)
        response = await llm.ainvoke(
            [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_prompt),
            ]
        )
        content = response.content
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for item in content:
                if isinstance(item, dict):
                    parts.append(str(item.get("text", "")))
                else:
                    parts.append(str(item))
            return "\n".join(parts)
        return str(content)

    def _parse_tagged_output(
        self,
        raw_text: str,
        message: str,
        doc_type: str,
        primary_tex: str,
    ) -> Tuple[str, List[Operation]]:
        text = raw_text or ""
        operations: List[Operation] = []

        response_match = re.search(r"<response>([\s\S]*?)</response>", text, flags=re.I)
        assistant_response = response_match.group(1).strip() if response_match else ""

        if not assistant_response:
            cleaned = re.sub(r"<write\s+[^>]+>[\s\S]*?</write>", "", text, flags=re.I)
            cleaned = re.sub(r"<append\s+[^>]+>[\s\S]*?</append>", "", cleaned, flags=re.I)
            cleaned = re.sub(r"<(mkdir|delete|delete_dir|move|copy)\s+[^>]+/?>", "", cleaned, flags=re.I)
            cleaned = re.sub(r"```[a-zA-Z0-9_-]*\n[\s\S]*?\n```", "", cleaned).strip()
            if cleaned:
                assistant_response = cleaned

        for match in re.finditer(r"<write\s+([^>]+)>([\s\S]*?)</write>", text, flags=re.I):
            attrs = _parse_attrs(match.group(1))
            path = attrs.get("path")
            if path:
                operations.append(Operation(op="write_file", path=path, content=match.group(2).strip()))

        for match in re.finditer(r"<append\s+([^>]+)>([\s\S]*?)</append>", text, flags=re.I):
            attrs = _parse_attrs(match.group(1))
            path = attrs.get("path")
            if path:
                operations.append(Operation(op="append_file", path=path, content=match.group(2).strip()))

        for match in re.finditer(r"<(mkdir|delete|delete_dir|move|copy)\s+([^>]+)\s*/?>", text, flags=re.I):
            tag = match.group(1).lower()
            attrs = _parse_attrs(match.group(2))
            if tag == "mkdir" and attrs.get("path"):
                operations.append(Operation(op="create_dir", path=attrs["path"]))
            elif tag == "delete" and attrs.get("path"):
                operations.append(Operation(op="delete_file", path=attrs["path"]))
            elif tag == "delete_dir" and attrs.get("path"):
                operations.append(Operation(op="delete_dir", path=attrs["path"]))
            elif tag == "move" and attrs.get("from") and attrs.get("to"):
                operations.append(Operation(op="move", path=attrs["from"], target_path=attrs["to"]))
            elif tag == "copy" and attrs.get("from") and attrs.get("to"):
                operations.append(Operation(op="copy", path=attrs["from"], target_path=attrs["to"]))

        if not operations:
            for m in re.finditer(
                r"(?:^|\n)FILE:\s*([^\n]+)\n```[a-zA-Z0-9_-]*\n([\s\S]*?)\n```",
                text,
                flags=re.I,
            ):
                path = _normalize_rel_path(m.group(1).strip())
                content = _strip_code_fences(m.group(2))
                if path and content:
                    operations.append(Operation(op="write_file", path=path, content=content))

        if not operations:
            code_fences = re.findall(r"```([a-zA-Z0-9_-]*)\n([\s\S]*?)\n```", text)
            for lang, code in code_fences:
                lang = (lang or "").strip().lower()
                body = (code or "").strip()
                if not body:
                    continue
                if lang in {"latex", "tex"}:
                    operations.append(Operation(op="write_file", path=primary_tex, content=body))
                elif lang in {"bib", "bibtex"}:
                    operations.append(Operation(op="write_file", path="references.bib", content=body))
                elif lang == "sty":
                    operations.append(Operation(op="write_file", path="custom.sty", content=body))

        if not operations:
            stripped = text.strip()
            if "\\documentclass" in stripped:
                operations.append(Operation(op="write_file", path=primary_tex, content=stripped))
            bib_like = re.search(r"@\w+\s*\{", stripped)
            if bib_like and "references.bib" not in [o.path for o in operations if o.path]:
                operations.append(Operation(op="write_file", path="references.bib", content=stripped))

        if self._is_generation_request(message):
            has_tex_write = any(o.op == "write_file" and (o.path or "").lower().endswith(".tex") for o in operations)
            if not has_tex_write:
                operations.append(
                    Operation(
                        op="write_file",
                        path=primary_tex,
                        content=self._build_default_main_tex(doc_type, message),
                    )
                )

        return assistant_response, self._normalize_operations(operations, doc_type, primary_tex)

    def _normalize_operations(self, operations: List[Operation], doc_type: str, primary_tex: str) -> List[Operation]:
        normalized: List[Operation] = []
        for op in operations:
            action = (op.op or "").strip().lower()
            path = _normalize_rel_path(op.path or "")
            target = _normalize_rel_path(op.target_path or "")
            content = op.content or ""

            if action in {"write", "create_file", "upsert_file"}:
                action = "write_file"
            if action in {"append"}:
                action = "append_file"
            if action in {"rename"}:
                action = "move"

            if action == "write_file" and not path:
                path = primary_tex
            if action in {"append_file", "delete_file", "create_dir", "delete_dir"} and not path:
                continue
            if action in {"move", "copy"} and (not path or not target):
                continue

            lower_path = path.lower()
            if lower_path in {"bibtex", "references"}:
                path = "references.bib"
            if lower_path == "style":
                path = "custom.sty"

            if action == "write_file" and path.lower().endswith(".tex"):
                content = self._sanitize_main_tex(content, doc_type)

            normalized.append(Operation(op=action, path=path, target_path=target or None, content=content))

        deduped: List[Operation] = []
        if not normalized:
            return deduped

        latest_write_index: Dict[str, int] = {}
        for idx, op in enumerate(normalized):
            if op.op == "write_file" and op.path:
                latest_write_index[op.path] = idx
        for idx, op in enumerate(normalized):
            if op.op == "write_file" and op.path and latest_write_index.get(op.path) != idx:
                continue
            deduped.append(op)
        return deduped

    def _sanitize_main_tex(self, content: str, doc_type: str) -> str:
        text = _strip_code_fences(content or "").strip()
        if not text:
            return text

        normalized_doc_type = str(doc_type or "article").strip().lower()
        if normalized_doc_type == "presentation":
            normalized_doc_type = "slides"
        if normalized_doc_type == "resume":
            normalized_doc_type = "cv"

        if "\\documentclass" not in text:
            if normalized_doc_type == "slides":
                return (
                    "\\documentclass[aspectratio=169]{beamer}\n"
                    "\\usetheme{Madrid}\n"
                    "\\usepackage[utf8]{inputenc}\n"
                    "\\begin{document}\n"
                    + text
                    + "\n\\end{document}\n"
                )
            if normalized_doc_type in {"report", "business", "technical", "proposal"}:
                return (
                    "\\documentclass[11pt,a4paper]{report}\n"
                    "\\usepackage[utf8]{inputenc}\n"
                    "\\usepackage[T1]{fontenc}\n"
                    "\\usepackage{lmodern}\n"
                    "\\usepackage{geometry}\n"
                    "\\geometry{margin=1in}\n"
                    "\\begin{document}\n"
                    + text
                    + "\n\\end{document}\n"
                )
            if normalized_doc_type == "cv":
                return (
                    "\\documentclass[11pt,a4paper,sans]{moderncv}\n"
                    "\\moderncvstyle{classic}\n"
                    "\\moderncvcolor{blue}\n"
                    "\\usepackage[utf8]{inputenc}\n"
                    "\\usepackage[T1]{fontenc}\n"
                    "\\usepackage[scale=0.85]{geometry}\n"
                    "\\name{Candidate}{}\n"
                    "\\title{Curriculum Vitae}\n"
                    "\\begin{document}\n"
                    "\\makecvtitle\n\n"
                    + text
                    + "\n\\end{document}\n"
                )
            if normalized_doc_type == "letter":
                return (
                    "\\documentclass[11pt]{letter}\n"
                    "\\signature{GenLaTeX}\n"
                    "\\address{Organization\\\\Email}\n"
                    "\\begin{document}\n"
                    "\\begin{letter}{Recipient}\n"
                    "\\opening{Dear Sir or Madam,}\n\n"
                    + text
                    + "\n\n\\closing{Sincerely,}\n"
                    "\\end{letter}\n"
                    "\\end{document}\n"
                )
            return (
                "\\documentclass[11pt,a4paper]{article}\n"
                "\\usepackage[utf8]{inputenc}\n"
                "\\usepackage[T1]{fontenc}\n"
                "\\usepackage{lmodern}\n"
                "\\usepackage{geometry}\n"
                "\\geometry{margin=1in}\n"
                "\\begin{document}\n"
                + text
                + "\n\\end{document}\n"
            )

        expected_map = {
            "slides": ("beamer", "\\documentclass[aspectratio=169]{beamer}"),
            "cv": ("moderncv", "\\documentclass[11pt,a4paper,sans]{moderncv}"),
            "letter": ("letter", "\\documentclass[11pt]{letter}"),
            "report": ("report", "\\documentclass[11pt,a4paper]{report}"),
            "business": ("report", "\\documentclass[11pt,a4paper]{report}"),
            "technical": ("report", "\\documentclass[11pt,a4paper]{report}"),
            "proposal": ("report", "\\documentclass[11pt,a4paper]{report}"),
        }
        expected = expected_map.get(normalized_doc_type)
        if expected:
            expected_class, expected_line = expected
            docclass_pattern = r"\\documentclass(?:\[[^\]]*\])?\{([^\}]+)\}"
            match = re.search(docclass_pattern, text)
            if match:
                current_class = str(match.group(1) or "").strip().lower()
                if current_class != expected_class:
                    text = re.sub(
                        docclass_pattern,
                        lambda _m, line=expected_line: line,
                        text,
                        count=1,
                    )

        if normalized_doc_type == "cv":
            if not re.search(r"\\moderncvstyle\{", text):
                text = re.sub(
                    r"(\\documentclass[^\n]*\n)",
                    r"\1\\moderncvstyle{classic}\n\\moderncvcolor{blue}\n\\usepackage[scale=0.85]{geometry}\n",
                    text,
                    count=1,
                )
            if "\\maketitle" in text and "\\makecvtitle" not in text:
                text = text.replace("\\maketitle", "\\makecvtitle")
            if not re.search(r"\\name\{", text):
                title_match = re.search(r"\\title\{([^}]*)\}", text)
                candidate_name = str(title_match.group(1)).strip() if title_match else "Candidate"
                candidate_name = candidate_name.replace("{", "").replace("}", "")
                candidate_name = re.sub(r"\s+", " ", candidate_name)[:80] or "Candidate"
                name_line = f"\\name{{{candidate_name}}}{{}}\n"
                insertion_point = re.search(r"\\begin\{document\}", text)
                if insertion_point:
                    text = text[:insertion_point.start()] + name_line + text[insertion_point.start():]
                else:
                    text = name_line + text

        return text

    def _validate_main_content_written(
        self, message: str, operations: List[Operation], primary_tex: str, doc_type: str
    ) -> None:
        """
        Validate that the LLM wrote actual content to the main tex file.

        This prevents the bug where LLM creates auxiliary files (styles, bib, images)
        but forgets to write the actual document content.
        """
        msg_lower = message.lower()
        is_generation_request = any(
            keyword in msg_lower
            for keyword in ["generate", "create", "write", "make", "build", "draft"]
        )

        if not is_generation_request:
            # Not a generation request, skip validation
            return

        # Check if main tex file was written with substantial content
        main_tex_written = False
        main_tex_content_length = 0

        for op in operations:
            if op.op == "write_file" and op.path == primary_tex:
                main_tex_written = True
                main_tex_content_length = len(op.content or "")
                break

        # Check if auxiliary files were created but not main content
        has_auxiliary_files = any(
            op.op == "write_file" and op.path != primary_tex
            for op in operations
        )

        # Warning thresholds
        MIN_CONTENT_LENGTH = 500  # Minimum reasonable content length

        if has_auxiliary_files and not main_tex_written:
            logger.error(
                "❌ VALIDATION FAILED: LLM created auxiliary files but did NOT write "
                f"content to main tex file: {primary_tex}. This is the known bug!"
            )
            logger.error(
                f"   Message: {message[:100]}..."
            )
            logger.error(
                f"   Auxiliary files created: {[op.path for op in operations if op.op == 'write_file']}"
            )
        elif main_tex_written and main_tex_content_length < MIN_CONTENT_LENGTH:
            logger.warning(
                f"⚠️  Main tex file written but content seems short ({main_tex_content_length} chars). "
                f"Expected at least {MIN_CONTENT_LENGTH} chars for a complete document."
            )
        elif main_tex_written and main_tex_content_length >= MIN_CONTENT_LENGTH:
            logger.info(
                f"✅ Validation passed: Main tex file written with {main_tex_content_length} chars"
            )

    def _copy_theme_files_to_project(self, project_root: Path) -> List[str]:
        """
        Copy theme/style files from selected template to project directory.

        This enables templates like Focus and Auriga Beamer to compile successfully
        by copying their .sty files to the user's project.

        Args:
            project_root: Path to the project directory

        Returns:
            List of copied file paths
        """
        import shutil

        copied_files = []

        if not self._selected_template:
            # No template was selected, nothing to copy
            return copied_files

        try:
            # Get list of theme files that need to be copied
            theme_files = self.template_selector.get_theme_files(self._selected_template)

            if not theme_files:
                # No theme files needed for this template
                return copied_files

            logger.info(
                f"📦 Copying {len(theme_files)} theme files for template: "
                f"{self._selected_template['name']}"
            )

            for src_path, dest_filename in theme_files:
                src = Path(src_path)
                dest = project_root / dest_filename

                if not src.exists():
                    logger.warning(f"⚠️  Theme file not found: {src}")
                    continue

                # Copy the file
                shutil.copy2(src, dest)
                copied_files.append(dest_filename)
                logger.info(f"  ✅ Copied: {dest_filename}")

            if copied_files:
                logger.info(
                    f"✨ Successfully copied {len(copied_files)} theme files to project"
                )

        except Exception as e:
            logger.error(f"❌ Failed to copy theme files: {e}")

        return copied_files

    def _detect_border_request(self, message: str) -> Optional[str]:
        """
        Detect if user is requesting borders and determine which style.

        Args:
            message: User's message

        Returns:
            Border style name ('simple', 'section', 'page', or None)
        """
        message_lower = message.lower()

        # Keywords for border requests
        border_keywords = ['border', 'frame', 'box', 'outline']
        has_border_request = any(kw in message_lower for kw in border_keywords)

        if not has_border_request:
            return None

        # Detect specific border style requests
        if any(kw in message_lower for kw in ['page border', 'entire page', 'all pages', 'full page']):
            return 'page'
        elif any(kw in message_lower for kw in ['section', 'colored', 'highlight', 'accent', 'shadow']):
            return 'section'
        else:
            # Default to simple borders
            return 'simple'

    def _copy_border_style_to_project(self, project_root: Path, border_style: str) -> List[str]:
        """
        Copy border style .sty file from templates to project directory.

        Args:
            project_root: Project root directory
            border_style: Border style name ('simple', 'section', 'page')

        Returns:
            List of copied file names
        """
        copied_files = []

        try:
            # Map style name to file name
            style_files = {
                'simple': 'simple-borders.sty',
                'section': 'section-borders.sty',
                'page': 'page-borders.sty'
            }

            if border_style not in style_files:
                logger.warning(f"⚠️  Unknown border style: {border_style}")
                return copied_files

            # Get path to border styles directory
            templates_dir = Path(__file__).parent.parent / "templates" / "border-styles"
            sty_file = style_files[border_style]
            src = templates_dir / sty_file
            dest = project_root / sty_file

            if not src.exists():
                logger.warning(f"⚠️  Border style file not found: {src}")
                return copied_files

            # Copy the border style file
            shutil.copy2(src, dest)
            copied_files.append(sty_file)
            logger.info(f"🖼️  Copied border style: {sty_file}")

            return copied_files

        except Exception as e:
            logger.error(f"❌ Failed to copy border style files: {e}")
            return copied_files

    def _detect_image_requests(self, message: str) -> List[str]:
        """
        Detect image requests in user message and extract keywords.

        Args:
            message: User's message

        Returns:
            List of image keywords to search for
        """
        message_lower = message.lower()

        # Keywords that indicate image requests
        image_keywords = ['image', 'picture', 'photo', 'graphic', 'illustration', 'icon']
        has_image_request = any(kw in message_lower for kw in image_keywords)

        if not has_image_request:
            return []

        # Extract keywords using image fetcher
        fetcher = get_image_fetcher()
        keywords = fetcher.extract_keywords_from_request(message)

        # Fallback: user asked for "an image" without a specific subject (e.g. "add an image to my powerpoint")
        if not keywords:
            if any(w in message_lower for w in ['slide', 'presentation', 'powerpoint', 'beamer']):
                keywords = ['presentation']
            else:
                keywords = ['document']

        return keywords

    def _fetch_images_for_project(self, project_root: Path, keywords: List[str]) -> List[str]:
        """
        Fetch images from Unsplash and save to project.

        Args:
            project_root: Project root directory
            keywords: List of keywords to search for

        Returns:
            List of saved image file names
        """
        if not keywords:
            return []

        fetcher = get_image_fetcher()
        saved_images = []

        try:
            # Create images directory
            images_dir = project_root / "images"
            images_dir.mkdir(exist_ok=True)

            for keyword in keywords[:5]:  # Limit to 5 images max
                # Clean keyword for filename
                safe_keyword = re.sub(r'[^\w\s-]', '', keyword).strip().replace(' ', '_')
                image_filename = f"{safe_keyword}.jpg"
                image_path = images_dir / image_filename

                logger.info(f"🖼️  Fetching image for: {keyword}")

                # Fetch and save image
                if fetcher.fetch_and_save(keyword, image_path):
                    saved_images.append(f"images/{image_filename}")
                    logger.info(f"✅ Saved image: images/{image_filename}")
                else:
                    logger.warning(f"⚠️  Failed to fetch image for: {keyword}")

            if saved_images:
                logger.info(f"✨ Successfully fetched {len(saved_images)} images")

        except Exception as e:
            logger.error(f"❌ Failed to fetch images: {e}")

        return saved_images

    def _apply_operation(self, project_root: Path, operation: Operation) -> Tuple[Optional[str], Optional[str]]:
        op = operation.op
        path = operation.path or ""
        target = operation.target_path or ""

        if op == "create_dir":
            full = self._safe_resolve(project_root, path)
            full.mkdir(parents=True, exist_ok=True)
            return None, None

        if op == "delete_dir":
            full = self._safe_resolve(project_root, path)
            if full.exists() and full.is_dir():
                shutil.rmtree(full)
            return None, None

        if op == "delete_file":
            full = self._safe_resolve(project_root, path)
            if full.exists() and full.is_file():
                full.unlink()
            return path, None

        if op == "move":
            src = self._safe_resolve(project_root, path)
            dst = self._safe_resolve(project_root, target)
            dst.parent.mkdir(parents=True, exist_ok=True)
            if src.exists():
                shutil.move(str(src), str(dst))
                return _normalize_rel_path(target), None
            return None, None

        if op == "copy":
            src = self._safe_resolve(project_root, path)
            dst = self._safe_resolve(project_root, target)
            dst.parent.mkdir(parents=True, exist_ok=True)
            if src.exists() and src.is_file():
                shutil.copy2(src, dst)
                if _is_text_file(dst):
                    version = _hash_content(dst.read_text(encoding="utf-8", errors="ignore"))
                else:
                    version = None
                return _normalize_rel_path(target), version
            return None, None

        if op in {"write_file", "append_file"}:
            full = self._safe_resolve(project_root, path)
            full.parent.mkdir(parents=True, exist_ok=True)
            data = operation.content or ""

            # Validate and convert image files if needed
            binary_data, was_converted = _validate_and_convert_image_content(data, full)

            if binary_data is not None:
                # Write as binary image file
                if op == "append_file":
                    logger.warning(f"⚠️ Cannot append to binary image file: {path}")
                    return None, None
                with full.open("wb") as f:
                    f.write(binary_data)
                if was_converted:
                    logger.info(f"🖼️ Wrote binary image (converted from base64): {path}")
                else:
                    logger.info(f"🖼️ Wrote binary image: {path}")
                version = None  # Binary files don't get versioned
            else:
                # Write as text file
                if op == "append_file":
                    with full.open("a", encoding="utf-8") as f:
                        f.write(data)
                else:
                    with full.open("w", encoding="utf-8") as f:
                        f.write(data)
                version = _hash_content(full.read_text(encoding="utf-8", errors="ignore"))

            return path, version

        raise ValueError(f"Unsupported operation: {op}")

    def _build_final_message(self, assistant_response: str, files_modified: List[str]) -> str:
        if assistant_response.strip():
            return assistant_response.strip()
        if files_modified:
            joined = ", ".join(files_modified[:6])
            more = "" if len(files_modified) <= 6 else f" (+{len(files_modified) - 6} more)"
            return f"Applied updates to: {joined}{more}."
        return "Done."

    async def process_stream(self, request: Dict[str, Any]) -> AsyncGenerator[ChatEvent, None]:
        message = str(request.get("message") or "").strip()
        model = request.get("model")
        files_modified: List[str] = []

        try:
            self._request_llm = self._build_llm(model=model) if model else None
            project_root = self._resolve_project_root(request)
            context = self._build_context(request, project_root)
            doc_type = self._detect_document_type(message, context)
            primary_tex = self._pick_primary_tex(project_root, context)

            logger.info("Chat project_root resolved: %s", project_root)
            yield ChatEvent("status", {"message": "Understanding your request..."})
            yield ChatEvent("tool_call", {"tool": "read_project_context", "params": {"project_root": str(project_root)}})
            snapshot = self._collect_project_snapshot(project_root, context)
            yield ChatEvent(
                "tool_result",
                {
                    "tool": "read_project_context",
                    "success": True,
                    "result": {
                        "file_count": len(snapshot.get("project_files", [])),
                        "preview_count": len(snapshot.get("previews", [])),
                    },
                },
            )

            # Fetch images BEFORE LLM so the model only references paths that exist
            image_keywords = self._detect_image_requests(message)
            fetched_images: List[str] = []
            if image_keywords:
                logger.info("Fetching images before LLM: %s", image_keywords)
                yield ChatEvent("status", {"message": "Fetching images..."})
                fetched_images = self._fetch_images_for_project(project_root, image_keywords)
                for image_file in fetched_images:
                    files_modified.append(image_file)
                    yield ChatEvent("file_saved", {"file_path": image_file, "version": None})
                if fetched_images:
                    logger.info("Fetched %d images for LLM context: %s", len(fetched_images), fetched_images)
            snapshot["available_images"] = fetched_images

            if getattr(context, "research_files", None):
                yield ChatEvent("status", {"message": "Checking uploaded files..."})
                try:
                    snapshot["research_file_context"] = await self._gather_research_file_context(
                        context, message
                    )
                except Exception as e:
                    logger.warning("Research file context failed: %s", e)
                    snapshot["research_file_context"] = ""

            yield ChatEvent("status", {"message": "Generating document changes..."})
            raw_output = ""
            timed_out = False
            started_at = time.monotonic()
            llm_task = asyncio.create_task(
                self._generate_llm_output(message, doc_type, primary_tex, snapshot, context)
            )
            while True:
                elapsed = time.monotonic() - started_at
                remaining = self.model_timeout_sec - elapsed
                if remaining <= 0:
                    timed_out = True
                    llm_task.cancel()
                    try:
                        await llm_task
                    except asyncio.CancelledError:
                        pass
                    break
                try:
                    raw_output = await asyncio.wait_for(
                        asyncio.shield(llm_task),
                        timeout=min(self.heartbeat_sec, max(0.2, remaining)),
                    )
                    break
                except asyncio.TimeoutError:
                    yield ChatEvent(
                        "status",
                        {"message": f"Still generating document changes... ({int(elapsed)}s)"},
                    )

            if timed_out:
                yield ChatEvent(
                    "status",
                    {"message": "Model response timed out. Creating a starter draft now..."},
                )
                assistant_response = (
                    "The model took too long, so I created a starter draft immediately. "
                    "You can refine it with your next prompt."
                )
                operations = [
                    Operation(
                        op="write_file",
                        path=primary_tex,
                        content=self._build_default_main_tex(doc_type, message),
                    )
                ]
            else:
                if llm_task.done():
                    # Propagate model exceptions if any.
                    _ = llm_task.result()
                assistant_response, operations = self._parse_tagged_output(
                    raw_output, message, doc_type, primary_tex
                )

            # Validate that main content was written for generation requests
            self._validate_main_content_written(message, operations, primary_tex, doc_type)

            if operations:
                yield ChatEvent("tool_call", {"tool": "apply_file_operations", "params": {"count": len(operations)}})
            else:
                yield ChatEvent("tool_result", {"tool": "apply_file_operations", "success": True, "result": {"count": 0}})

            for operation in operations:
                try:
                    modified_path, version = self._apply_operation(project_root, operation)
                    if modified_path:
                        normalized_path = _normalize_rel_path(modified_path)
                        files_modified.append(normalized_path)
                        full_path = (project_root / normalized_path).resolve()
                        logger.info("Wrote file: %s -> %s", normalized_path, full_path)
                        yield ChatEvent(
                            "file_saved",
                            {
                                "file_path": normalized_path,
                                "version": version,
                            },
                        )
                except Exception as op_error:
                    logger.warning("Failed operation %s on %s: %s", operation.op, operation.path, op_error)
                    yield ChatEvent(
                        "tool_result",
                        {
                            "tool": "apply_file_operations",
                            "success": False,
                            "error": f"{operation.op} {operation.path or ''}: {op_error}",
                        },
                    )

            if operations:
                yield ChatEvent(
                    "tool_result",
                    {
                        "tool": "apply_file_operations",
                        "success": True,
                        "result": {"count": len(operations)},
                    },
                )

            # Copy theme files if a template was selected (Focus, Auriga, etc.)
            copied_theme_files = self._copy_theme_files_to_project(project_root)
            if copied_theme_files:
                files_modified.extend(copied_theme_files)
                # Notify frontend about copied theme files
                for theme_file in copied_theme_files:
                    yield ChatEvent(
                        "file_saved",
                        {
                            "file_path": theme_file,
                            "version": None,
                        },
                    )

            # Detect and copy border styles if user requested borders
            border_style = self._detect_border_request(message)
            if border_style:
                logger.info(f"🖼️  Detected border request: {border_style} style")
                copied_border_files = self._copy_border_style_to_project(project_root, border_style)
                if copied_border_files:
                    files_modified.extend(copied_border_files)
                    # Notify frontend about copied border files
                    for border_file in copied_border_files:
                        yield ChatEvent(
                            "file_saved",
                            {
                                "file_path": border_file,
                                "version": None,
                            },
                        )

            # Images were already fetched before LLM; no second fetch

            files_modified = sorted(set(files_modified))
            final_text = self._build_final_message(assistant_response, files_modified)
            yield ChatEvent("text", {"content": final_text})
            yield ChatEvent("done", {"files_modified": files_modified})

        except Exception as e:
            logger.exception("Orchestrator stream error: %s", e)
            yield ChatEvent("error", {"error": str(e)})
            yield ChatEvent("done", {"files_modified": files_modified})
        finally:
            self._request_llm = None

    async def process(self, request: Dict[str, Any]) -> Dict[str, Any]:
        response_parts: List[str] = []
        files_modified: List[str] = []
        success = True
        error_message = None

        async for event in self.process_stream(request):
            if event.event == "text":
                response_parts.append(str(event.data.get("content", "")))
            elif event.event == "file_saved":
                fp = event.data.get("file_path")
                if fp:
                    files_modified.append(str(fp))
            elif event.event == "done":
                files_modified = event.data.get("files_modified", files_modified) or files_modified
            elif event.event == "error":
                success = False
                error_message = event.data.get("error", "Unknown error")

        result: Dict[str, Any] = {
            "success": success,
            "response": "\n".join([p for p in response_parts if p]).strip(),
            "code": None,
            "files_modified": sorted(set(files_modified)),
        }
        if error_message:
            result["error"] = error_message
        return result


_ORCHESTRATOR: Optional[Orchestrator] = None


def get_orchestrator() -> Orchestrator:
    global _ORCHESTRATOR
    if _ORCHESTRATOR is None:
        _ORCHESTRATOR = Orchestrator()
    return _ORCHESTRATOR
