"""
Service layer for the GenLaTeX document generation API.
This module contains business logic for document generation, search, and system operations.
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import platform
import psutil
import re
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any

# Lazy import for langchain - only import when actually needed
# This allows memory endpoints to work without langchain installed
try:
    from langchain_openai import ChatOpenAI
    LANGCHAIN_AVAILABLE = True
except ImportError:
    LANGCHAIN_AVAILABLE = False
    ChatOpenAI = None  # Placeholder for type hints

from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from api.models import (
    PaperGenerationRequest, PaperGenerationResponse, PaperDataModel,
    PaperStatus, PaperPhase,
    VerificationRequest, VerificationResultModel,
    HealthResponse, SystemInfo, APIConfig
)
from api.exceptions import PaperGenerationError, ValidationError
from api import state

# Import our existing modules (no search/research agents)
from main import PaperOrchestrator
from tools.citation import CitationManager
from agents.document_planner import DocumentPlanner
from agents.document_writer import DocumentWriter
from utils.latex import LatexGenerator
from utils.sources import Source

# Import memory system
import sys
from pathlib import Path
sys.path.append(str(Path(__file__).parent.parent))
# Memory system removed

logger = logging.getLogger(__name__)


def _clamp_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
    except Exception:
        value = default
    return max(minimum, min(value, maximum))


_DOCUMENT_TEMPLATE_BY_TYPE = {
    "slides": "slides.tex",
    "presentation": "slides.tex",
    "beamer": "slides.tex",
    "cv": "cv.tex",
    "resume": "cv.tex",
    "letter": "letter.tex",
    "invoice": "invoice.tex",
    "report": "report.tex",
    "business": "report.tex",
    "technical": "report.tex",
    "proposal": "report.tex",
}

_TEXTUAL_UPLOAD_EXTENSIONS = {
    ".txt", ".md", ".csv", ".tsv", ".json", ".yaml", ".yml",
    ".tex", ".bib", ".xml", ".log", ".rst"
}

_BINARY_TEMPLATE_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".pdf", ".eps"
}

_SLIDE_COLOR_RGB = {
    "blue": (37, 99, 235),
    "orange": (249, 115, 22),
    "green": (34, 197, 94),
    "teal": (13, 148, 136),
    "purple": (147, 51, 234),
    "red": (220, 38, 38),
    "pink": (236, 72, 153),
    "gray": (75, 85, 99),
    "black": (31, 41, 55),
}

_SLIDE_COLOR_ALIASES = {
    "blue": ["blue", "navy", "azure", "cobalt"],
    "orange": ["orange", "amber", "tangerine", "coral"],
    "green": ["green", "emerald", "lime"],
    "teal": ["teal", "turquoise", "cyan"],
    "purple": ["purple", "violet", "indigo"],
    "red": ["red", "crimson", "scarlet"],
    "pink": ["pink", "magenta", "rose"],
    "gray": ["gray", "grey", "slate", "charcoal"],
    "black": ["black"],
}


def _normalize_document_type(value: Optional[str]) -> str:
    normalized = str(value or "").strip().lower()
    if not normalized:
        return "article"
    if normalized in {"presentation", "beamer"}:
        return "slides"
    if normalized == "resume":
        return "cv"
    return normalized


def _safe_template_relative_path(raw_path: str) -> Optional[Path]:
    text = str(raw_path or "").replace("\\", "/").strip()
    if not text:
        return None
    while text.startswith("./"):
        text = text[2:]
    if text.startswith("/") or ".." in text.split("/"):
        return None
    path_value = Path(text)
    if path_value.is_absolute():
        return None
    return path_value


def _decode_template_payload_to_bytes(payload: Any) -> Optional[bytes]:
    if payload is None:
        return None
    if isinstance(payload, (bytes, bytearray)):
        return bytes(payload)
    if isinstance(payload, str):
        return payload.encode("utf-8", errors="ignore")
    if isinstance(payload, dict):
        encoding = str(payload.get("__encoding") or payload.get("encoding") or "").lower()
        if encoding == "base64":
            data = payload.get("data") or payload.get("content")
            if data is None:
                return None
            try:
                return base64.b64decode(str(data))
            except Exception:
                return None
        inline_data = payload.get("data")
        if isinstance(inline_data, str):
            return inline_data.encode("utf-8", errors="ignore")
    return None


def _decode_template_payload_to_text(payload: Any) -> Optional[str]:
    if payload is None:
        return None
    if isinstance(payload, str):
        return payload
    raw_bytes = _decode_template_payload_to_bytes(payload)
    if raw_bytes is None:
        return None
    return raw_bytes.decode("utf-8", errors="ignore")


def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    candidate = str(text or "").strip()
    if not candidate:
        return None

    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass

    block_match = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", candidate, flags=re.IGNORECASE)
    if block_match:
        try:
            parsed = json.loads(block_match.group(1))
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass

    start = candidate.find("{")
    if start < 0:
        return None
    depth = 0
    for idx in range(start, len(candidate)):
        ch = candidate[idx]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                snippet = candidate[start:idx + 1]
                try:
                    parsed = json.loads(snippet)
                    if isinstance(parsed, dict):
                        return parsed
                except Exception:
                    return None
    return None


class DocumentService:
    """Service for document generation operations."""
    
    def __init__(self):
        self.config = self._load_config()
        self.orchestrator = None
        self.memory = None  # Will be initialized per request with dynamic project_id
        self._initialize_orchestrator()
    
    def _load_config(self) -> APIConfig:
        """Load API configuration from environment variables"""
        return APIConfig(
            openrouter_api_key=os.getenv("OPENROUTER_API_KEY", ""),
            tavily_api_key=os.getenv("TAVILY_API_KEY"),
            template_dir=os.getenv("TEMPLATE_DIR", "./template"),
            checkpoint_dir=os.getenv("CHECKPOINT_DIR", "./checkpoints"),
            output_dir=os.getenv("OUTPUT_DIR", "./output"),
            max_concurrent_papers=int(os.getenv("MAX_CONCURRENT_PAPERS", "5")),
            request_timeout=int(os.getenv("REQUEST_TIMEOUT", "300"))
        )
    
    def _initialize_orchestrator(self):
        """Initialize the document orchestrator."""
        try:
            if not os.getenv("OPENROUTER_API_KEY"):
                raise ValidationError("OPENROUTER_API_KEY environment variable is required")
            
            # Default orchestrator uses fast_mode=True; per-request generation uses request.fast_mode
            self.orchestrator = PaperOrchestrator(
                openrouter_api_key=os.getenv("OPENROUTER_API_KEY"),
                openrouter_base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
                openrouter_model=os.getenv("AI_MODEL") or os.getenv("AI_MODEL_FALLBACK") or "deepseek/deepseek-chat",
                tavily_api_key=self.config.tavily_api_key,
                template_dir=self.config.template_dir,
                checkpoint_dir=self.config.checkpoint_dir,
                verbose=False,  # Disable verbose output in API mode
                fast_mode=True  # Default; paper generation uses request.fast_mode
            )
            
            # Enable speed optimizations for API
            logger.info("Speed optimizations enabled for API mode")
            
            # Check memory integration
            if hasattr(self.orchestrator, 'memory') and self.orchestrator.memory:
                logger.info("Paper orchestrator initialized with memory integration")
            else:
                logger.info("Paper orchestrator initialized without memory integration")
            
            logger.info("Paper orchestrator initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize paper orchestrator: {e}")
            raise PaperGenerationError(f"Failed to initialize paper orchestrator: {e}")

    def _resolve_document_type(self, request: PaperGenerationRequest) -> str:
        explicit = _normalize_document_type(getattr(request, "document_type", None))
        if explicit and explicit != "article":
            return explicit

        combined = f"{request.topic} {request.description}".lower()
        if re.search(r"\b(slides?|deck|presentation|beamer|pptx?)\b", combined):
            return "slides"
        if re.search(r"\b(cv|resume|curriculum vitae)\b", combined):
            return "cv"
        if re.search(r"\b(cover letter|motivation letter|recommendation letter|letter)\b", combined):
            return "letter"
        if re.search(r"\b(invoice|quotation|billing)\b", combined):
            return "invoice"
        if re.search(r"\b(report|financial report|technical report|business report|audit)\b", combined):
            return "report"
        if re.search(r"\b(proposal|grant proposal|project proposal)\b", combined):
            return "proposal"
        if re.search(r"\b(technical document|specification|manual|architecture)\b", combined):
            return "technical"
        if re.search(r"\b(business plan|business case|executive brief|strategy)\b", combined):
            return "business"
        return "article"

    def _collect_upload_context(
        self,
        research_files: Optional[List[Dict[str, Any]]],
        max_files: int = 8,
        max_chars_per_file: int = 2200
    ) -> List[Dict[str, Any]]:
        context_rows: List[Dict[str, Any]] = []
        for entry in research_files or []:
            if not isinstance(entry, dict):
                continue

            metadata = entry.get("metadata") or {}
            if isinstance(metadata, str):
                try:
                    metadata = json.loads(metadata)
                except Exception:
                    metadata = {}
            if not isinstance(metadata, dict):
                metadata = {}

            file_name = str(entry.get("fileName") or entry.get("file_name") or metadata.get("uploaded_filename") or "uploaded-file")
            file_type = str(entry.get("fileType") or entry.get("file_type") or Path(file_name).suffix.lower().lstrip(".") or "file")
            file_path = str(entry.get("filePath") or entry.get("file_path") or "")

            extracted = (
                entry.get("extracted_content")
                or metadata.get("extracted_content")
                or metadata.get("extractedContent")
            )

            extracted_text = ""
            if isinstance(extracted, dict):
                extracted_text = (
                    extracted.get("full_text")
                    or extracted.get("extracted_text")
                    or extracted.get("content")
                    or ""
                )
            elif isinstance(extracted, str):
                extracted_text = extracted

            if not extracted_text:
                extracted_text = (
                    metadata.get("preview_text")
                    or metadata.get("summary")
                    or metadata.get("caption")
                    or ""
                )

            if not extracted_text and file_path:
                suffix = Path(file_path).suffix.lower()
                if suffix in _TEXTUAL_UPLOAD_EXTENSIONS:
                    try:
                        extracted_text = Path(file_path).read_text(encoding="utf-8", errors="ignore")
                    except Exception:
                        extracted_text = ""

            snippet = re.sub(r"\s+", " ", str(extracted_text or "").strip())
            if len(snippet) > max_chars_per_file:
                snippet = snippet[:max_chars_per_file] + "..."

            context_rows.append(
                {
                    "name": file_name,
                    "type": file_type,
                    "summary": snippet
                }
            )
            if len(context_rows) >= max_files:
                break
        return context_rows

    def _derive_slide_subject(self, request: PaperGenerationRequest) -> str:
        topic = str(getattr(request, "topic", "") or "").strip()
        description = str(getattr(request, "description", "") or "").strip()
        candidate = topic or description
        if not candidate:
            return "the requested topic"

        candidate = re.sub(r"\*\*[^*]+\*\*:?", " ", candidate)
        candidate = re.sub(
            r"(?i)\b(create|build|generate|make)\b\s+(?:a|an)?\s*(?:professional\s*)?(?:presentation|slide\s*deck|slides?)\b",
            " ",
            candidate,
        )
        candidate = re.sub(r"(?i)\b(using|with)\b\s+the\s+beamer\s+package\b", " ", candidate)
        candidate = re.sub(r"(?i)\b(content\s+details|additional\s+requirements|reference\s+files)\b\s*:", " ", candidate)
        candidate = re.sub(r"\s+", " ", candidate).strip(" .,:;-")

        if len(candidate) < 8:
            candidate = topic or description

        return candidate[:120] if candidate else "the requested topic"

    def _extract_requested_colors(self, *texts: Optional[str]) -> List[str]:
        combined = " ".join(str(t or "") for t in texts).lower()
        if not combined.strip():
            return []

        hits: List[tuple[int, str]] = []
        for canonical, aliases in _SLIDE_COLOR_ALIASES.items():
            best_pos = None
            for alias in aliases:
                match = re.search(rf"\b{re.escape(alias)}\b", combined)
                if match:
                    if best_pos is None or match.start() < best_pos:
                        best_pos = match.start()
            if best_pos is not None:
                hits.append((best_pos, canonical))

        hits.sort(key=lambda item: item[0])
        ordered = []
        seen = set()
        for _, color in hits:
            if color in seen:
                continue
            seen.add(color)
            ordered.append(color)
        return ordered

    def _build_smoking_slide_sections(self) -> List[Dict[str, str]]:
        return [
            {
                "id": "1",
                "name": "Why Smoking Is A Critical Health Issue",
                "content": (
                    "\\begin{itemize}\n"
                    "\\item \\textbf{Scale of harm.} Smoking is one of the largest preventable drivers of illness and early mortality worldwide.\n"
                    "\\item \\textbf{Systemic exposure.} Toxic chemicals from tobacco smoke circulate through blood and damage nearly every major organ system.\n"
                    "\\item \\textbf{Presentation goal.} Clarify major health impacts, broader societal costs, and high-impact prevention actions.\n"
                    "\\end{itemize}"
                ),
            },
            {
                "id": "2",
                "name": "Immediate And Short-Term Health Effects",
                "content": (
                    "\\begin{itemize}\n"
                    "\\item \\textbf{Cardio-respiratory strain.} Smoking rapidly raises heart rate, blood pressure, and airway irritation, reducing oxygen delivery.\n"
                    "\\item \\textbf{Reduced physical performance.} Users often experience shortness of breath, reduced endurance, and longer recovery time.\n"
                    "\\item \\textbf{Early warning signs.} Persistent cough, wheezing, chest discomfort, and recurrent respiratory infections indicate escalating risk.\n"
                    "\\end{itemize}"
                ),
            },
            {
                "id": "3",
                "name": "Long-Term Disease Burden",
                "content": (
                    "\\begin{itemize}\n"
                    "\\item \\textbf{Cancer risk.} Tobacco exposure is strongly associated with lung cancer and multiple other cancers.\n"
                    "\\item \\textbf{Chronic disease progression.} Long-term smoking increases risk of COPD, stroke, coronary artery disease, and peripheral vascular disease.\n"
                    "\\item \\textbf{Quality of life decline.} Chronic breathlessness, frequent hospitalization, and disability significantly reduce daily functioning.\n"
                    "\\end{itemize}"
                ),
            },
            {
                "id": "4",
                "name": "Secondhand Smoke And Vulnerable Groups",
                "content": (
                    "\\begin{itemize}\n"
                    "\\item \\textbf{Non-smokers are affected.} Secondhand smoke exposure raises cardiovascular and respiratory risk even without direct tobacco use.\n"
                    "\\item \\textbf{Children and adolescents.} Exposure is linked to asthma exacerbation, respiratory infections, and impaired lung development.\n"
                    "\\item \\textbf{Pregnancy risks.} Maternal exposure increases risk of low birth weight and adverse neonatal outcomes.\n"
                    "\\end{itemize}"
                ),
            },
            {
                "id": "5",
                "name": "Economic And Social Impact",
                "content": (
                    "\\begin{itemize}\n"
                    "\\item \\textbf{Healthcare expenditure.} Smoking-related conditions drive substantial direct treatment and hospitalization costs.\n"
                    "\\item \\textbf{Productivity losses.} Absenteeism, presenteeism, and premature mortality reduce workforce output.\n"
                    "\\item \\textbf{Household burden.} Families bear costs from treatment, reduced income, and long-term caregiving obligations.\n"
                    "\\end{itemize}"
                ),
            },
            {
                "id": "6",
                "name": "Prevention And Cessation Priorities",
                "content": (
                    "\\begin{itemize}\n"
                    "\\item \\textbf{Policy levers.} Taxation, smoke-free environments, marketing controls, and warning labels consistently reduce use rates.\n"
                    "\\item \\textbf{Clinical interventions.} Behavioral counseling plus evidence-based pharmacotherapy improves quit success.\n"
                    "\\item \\textbf{Program design.} Pair public education with accessible cessation services and measurable follow-up indicators.\n"
                    "\\end{itemize}"
                ),
            },
            {
                "id": "7",
                "name": "Key Takeaways",
                "content": (
                    "\\begin{itemize}\n"
                    "\\item \\textbf{Smoking remains highly preventable harm.} The impact spans individual health, population outcomes, and economic stability.\n"
                    "\\item \\textbf{Early action is decisive.} Prevention, detection, and cessation support materially reduce long-term disease burden.\n"
                    "\\item \\textbf{Recommended next step.} Align policy, clinical care, and communication strategy around clear reduction targets.\n"
                    "\\end{itemize}"
                ),
            },
        ]

    def _build_generic_slide_sections(self, subject: str) -> List[Dict[str, str]]:
        subject_text = subject or "the requested topic"
        return [
            {
                "id": "1",
                "name": "Context And Objectives",
                "content": (
                    "\\begin{itemize}\n"
                    f"\\item \\textbf{{Context.}} This presentation introduces {subject_text} and why it matters for decision-making.\n"
                    "\\item \\textbf{Objective.} Provide a clear explanation of core drivers, observed impacts, and practical implications.\n"
                    "\\item \\textbf{Audience focus.} Prioritize points that support action planning and stakeholder alignment.\n"
                    "\\end{itemize}"
                ),
            },
            {
                "id": "2",
                "name": "Key Drivers And Mechanisms",
                "content": (
                    "\\begin{itemize}\n"
                    "\\item \\textbf{Primary drivers.} Identify the strongest factors shaping outcomes and explain how they interact.\n"
                    "\\item \\textbf{Causal mechanism.} Connect inputs, constraints, and feedback loops that produce the current state.\n"
                    "\\item \\textbf{Risk factors.} Highlight leading vulnerabilities that could worsen performance if unaddressed.\n"
                    "\\end{itemize}"
                ),
            },
            {
                "id": "3",
                "name": "Impact Analysis",
                "content": (
                    "\\begin{itemize}\n"
                    "\\item \\textbf{Operational impact.} Summarize effects on execution quality, timelines, and service outcomes.\n"
                    "\\item \\textbf{Financial impact.} Describe direct costs, indirect losses, and potential efficiency opportunities.\n"
                    "\\item \\textbf{Human impact.} Explain consequences for users, teams, and affected communities.\n"
                    "\\end{itemize}"
                ),
            },
            {
                "id": "4",
                "name": "Evidence And Trends",
                "content": (
                    "\\begin{itemize}\n"
                    "\\item \\textbf{Current baseline.} Establish the present condition using measurable indicators.\n"
                    "\\item \\textbf{Trend direction.} Show whether key metrics are improving, stable, or deteriorating over time.\n"
                    "\\item \\textbf{Interpretation.} Translate trend signals into strategic implications and urgency level.\n"
                    "\\end{itemize}"
                ),
            },
            {
                "id": "5",
                "name": "Recommendations",
                "content": (
                    "\\begin{itemize}\n"
                    "\\item \\textbf{Immediate actions (0-90 days).} Prioritize high-impact interventions that are feasible with current resources.\n"
                    "\\item \\textbf{Mid-term actions (3-12 months).} Build structural improvements and governance support.\n"
                    "\\item \\textbf{Success metrics.} Define clear KPIs and review cadence to track execution quality.\n"
                    "\\end{itemize}"
                ),
            },
            {
                "id": "6",
                "name": "Conclusion",
                "content": (
                    "\\begin{itemize}\n"
                    "\\item \\textbf{Core message.} The topic requires coordinated action across policy, process, and stakeholder communication.\n"
                    "\\item \\textbf{Decision point.} Use the presented evidence to prioritize interventions with measurable outcomes.\n"
                    "\\item \\textbf{Next step.} Confirm ownership, timeline, and reporting structure for implementation.\n"
                    "\\end{itemize}"
                ),
            },
        ]

    def _slides_content_needs_upgrade(self, sections: List[Dict[str, Any]]) -> bool:
        if not sections:
            return True
        total_words = 0
        combined = []
        for section in sections:
            text = str(section.get("content") or "")
            combined.append(text.lower())
            total_words += len(re.findall(r"\b\w+\b", text))

        combined_text = " ".join(combined)
        placeholder_markers = [
            "point one",
            "point two",
            "point three",
            "add key points here",
            "main concepts and context",
            "this presentation covers the main concepts",
        ]
        marker_hits = sum(1 for marker in placeholder_markers if marker in combined_text)
        return len(sections) < 5 or total_words < 170 or marker_hits > 0

    def _apply_slide_color_preferences(
        self,
        latex_text: str,
        request_text: str,
        special_instructions: Optional[str] = None
    ) -> str:
        if not latex_text:
            return latex_text
        if "genlatex user color palette" in latex_text.lower():
            return latex_text

        requested_colors = self._extract_requested_colors(request_text, special_instructions)
        if not requested_colors:
            return latex_text

        primary = requested_colors[0]
        accent = requested_colors[1] if len(requested_colors) > 1 else ("orange" if primary != "orange" else "blue")
        primary_rgb = _SLIDE_COLOR_RGB.get(primary, _SLIDE_COLOR_RGB["blue"])
        accent_rgb = _SLIDE_COLOR_RGB.get(accent, _SLIDE_COLOR_RGB["orange"])

        palette_block = (
            "\n% GenLaTeX user color palette\n"
            f"\\definecolor{{GenPrimary}}{{RGB}}{{{primary_rgb[0]},{primary_rgb[1]},{primary_rgb[2]}}}\n"
            f"\\definecolor{{GenAccent}}{{RGB}}{{{accent_rgb[0]},{accent_rgb[1]},{accent_rgb[2]}}}\n"
            "\\setbeamercolor{structure}{fg=GenAccent}\n"
            "\\setbeamercolor{title}{fg=white,bg=GenPrimary}\n"
            "\\setbeamercolor{frametitle}{fg=white,bg=GenPrimary}\n"
            "\\setbeamercolor{palette primary}{fg=white,bg=GenPrimary}\n"
            "\\setbeamercolor{palette secondary}{fg=white,bg=GenAccent}\n"
            "\\setbeamercolor{palette tertiary}{fg=white,bg=GenPrimary!80!black}\n"
            "\\setbeamercolor{palette quaternary}{fg=white,bg=GenAccent!75!black}\n"
            "\\setbeamercolor{item}{fg=GenAccent}\n"
        )

        if not re.search(r"\\usepackage(?:\[[^\]]*\])?\{xcolor\}", latex_text):
            palette_block = "\n\\usepackage{xcolor}\n" + palette_block

        insertion_points = [
            r"(\\usecolortheme\{[^\}]*\}\s*\n)",
            r"(\\usetheme\{[^\}]*\}\s*\n)",
            r"(\\documentclass[^\n]*\n)",
        ]

        for pattern in insertion_points:
            if re.search(pattern, latex_text):
                return re.sub(
                    pattern,
                    lambda m, block=palette_block: m.group(1) + block,
                    latex_text,
                    count=1,
                )

        return palette_block + "\n" + latex_text

    def _enforce_builtin_document_class(
        self,
        latex_text: str,
        document_type: str,
        has_custom_template: bool = False
    ) -> str:
        if not latex_text:
            return latex_text
        if has_custom_template:
            return latex_text

        normalized_type = _normalize_document_type(document_type)
        expected_map = {
            "cv": ("moderncv", "\\documentclass[11pt,a4paper,sans]{moderncv}"),
            "slides": ("beamer", "\\documentclass[aspectratio=169]{beamer}"),
            "letter": ("letter", "\\documentclass[11pt]{letter}"),
            "report": ("report", "\\documentclass[11pt,a4paper]{report}"),
            "business": ("report", "\\documentclass[11pt,a4paper]{report}"),
            "technical": ("report", "\\documentclass[11pt,a4paper]{report}"),
            "proposal": ("report", "\\documentclass[11pt,a4paper]{report}"),
        }

        expected = expected_map.get(normalized_type)
        if not expected:
            return latex_text

        expected_class, expected_line = expected
        docclass_pattern = r"\\documentclass(?:\[[^\]]*\])?\{([^\}]+)\}"
        docclass_match = re.search(docclass_pattern, latex_text)

        if docclass_match:
            current_class = str(docclass_match.group(1) or "").strip().lower()
            if current_class != expected_class:
                latex_text = re.sub(
                    docclass_pattern,
                    lambda _m, line=expected_line: line,
                    latex_text,
                    count=1,
                )
        else:
            latex_text = expected_line + "\n" + latex_text

        if normalized_type == "cv":
            if not re.search(r"\\moderncvstyle\{", latex_text):
                latex_text = re.sub(
                    r"(\\documentclass[^\n]*\n)",
                    r"\1\\moderncvstyle{classic}\n\\moderncvcolor{blue}\n\\usepackage[scale=0.85]{geometry}\n",
                    latex_text,
                    count=1,
                )
            if not re.search(r"\\name\{", latex_text):
                title_match = re.search(r"\\title\{([^}]*)\}", latex_text)
                candidate_name = str(title_match.group(1)).strip() if title_match else "Candidate"
                candidate_name = candidate_name.replace("{", "").replace("}", "")
                candidate_name = re.sub(r"\s+", " ", candidate_name)[:80] or "Candidate"
                insertion_point = re.search(r"\\begin\{document\}", latex_text)
                name_line = f"\\name{{{candidate_name}}}{{}}\n"
                if insertion_point:
                    latex_text = latex_text[:insertion_point.start()] + name_line + latex_text[insertion_point.start():]
                else:
                    latex_text += "\n" + name_line
            if "\\maketitle" in latex_text and "\\makecvtitle" not in latex_text:
                latex_text = latex_text.replace("\\maketitle", "\\makecvtitle")

        return latex_text

    def _build_fallback_plan(
        self,
        request: PaperGenerationRequest,
        document_type: str,
        file_context: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        title = (request.topic or "Generated Document").strip()
        title = title[:180] if title else "Generated Document"
        desc = (request.description or "").strip()[:500]

        if document_type == "slides":
            prompt_blob = f"{request.topic} {request.description}".lower()
            smoking_related = bool(re.search(r"\b(smoking|smoker|tobacco|cigarette|nicotine|secondhand smoke|vaping)\b", prompt_blob))
            subject = self._derive_slide_subject(request)
            sections = self._build_smoking_slide_sections() if smoking_related else self._build_generic_slide_sections(subject)
            abstract = (
                f"Comprehensive presentation on {subject} with evidence-based impacts, "
                "structured analysis, and practical recommendations."
            )
        elif document_type in {"cv", "resume"}:
            sections = [
                {"id": "1", "name": "Experience", "content": "\\begin{itemize}\n\\item Role, company, and measurable impact\n\\item Focus on outcomes and metrics\n\\end{itemize}"},
                {"id": "2", "name": "Skills", "content": "\\begin{itemize}\n\\item Technical skills\n\\item Domain knowledge\n\\item Collaboration tools\n\\end{itemize}"},
                {"id": "3", "name": "Education", "content": "\\begin{itemize}\n\\item Degree and institution\n\\item Certifications and distinctions\n\\end{itemize}"},
            ]
            abstract = "Professional CV profile generated from the requested role and context."
        elif document_type == "letter":
            sections = [
                {"id": "1", "name": "Body", "content": "I am writing regarding your request. This letter summarizes the objective, supporting details, and expected outcome in a clear professional tone."}
            ]
            abstract = "Professional letter generated from prompt details."
        elif document_type == "invoice":
            sections = [
                {"id": "1", "name": "Line Items", "content": "\\begin{tabular}{p{0.45\\linewidth}r}\n\\toprule\nDescription & Amount \\\\\n\\midrule\nService A & 0.00 \\\\\nService B & 0.00 \\\\\n\\bottomrule\n\\end{tabular}"},
                {"id": "2", "name": "Payment Terms", "content": "Payment due within 30 days. Include invoice ID in the transfer reference."},
            ]
            abstract = "Invoice generated with placeholder line items and payment terms."
        else:
            sections = [
                {"id": "1", "name": "Introduction", "content": "This document presents the requested topic, scope, and practical objectives."},
                {"id": "2", "name": "Main Content", "content": "This section develops the core analysis, methods, and supporting arguments relevant to the prompt."},
                {"id": "3", "name": "Conclusion", "content": "This section summarizes key points and outlines actionable next steps."},
            ]
            abstract = "Generated from your prompt with a complete LaTeX structure and editable section content."

        keywords = ["genlatex", "document", document_type]
        if file_context:
            keywords.append("file-informed")

        return {
            "title": title,
            "abstract": abstract,
            "keywords": keywords,
            "sections": sections,
            "bibtex": ""
        }

    async def _generate_document_fast(
        self,
        request: PaperGenerationRequest,
        template_files: Optional[Dict[str, Any]],
        special_instructions: Optional[str],
        update_progress
    ) -> Dict[str, Any]:
        document_type = self._resolve_document_type(request)
        template_hint = str(getattr(request, "document_template", "") or "").strip()
        model_name = os.getenv("AI_MODEL") or os.getenv("AI_MODEL_FALLBACK") or "deepseek/deepseek-chat"

        file_context: List[Dict[str, Any]] = self._collect_upload_context(
            getattr(request, "research_files", None) or [], max_files=8, max_chars_per_file=2200
        )
        selected_refs: List[Dict[str, Any]] = []

        if update_progress:
            await update_progress("plan", 8.0, f"Preparing {document_type} structure and template...")
            await update_progress("research", 20.0, "Collecting context from uploaded files...")

        prompt_sections: List[str] = [
            f"DOCUMENT TYPE: {document_type}",
            f"TEMPLATE HINT: {template_hint or 'default'}",
            f"TOPIC: {request.topic}",
            "USER REQUIREMENTS:",
            request.description.strip(),
        ]

        if special_instructions:
            prompt_sections.extend([
                "SPECIAL INSTRUCTIONS:",
                special_instructions.strip()
            ])

        if selected_refs:
            prompt_sections.append("SELECTED REFERENCES:")
            for idx, ref in enumerate(selected_refs[:20], start=1):
                title = str(ref.get("title") or "Untitled source").strip()
                year = str(ref.get("year") or "").strip()
                authors = ref.get("authors")
                if isinstance(authors, list):
                    author_text = ", ".join(str(a).strip() for a in authors if str(a).strip())
                else:
                    author_text = str(authors or "").strip()
                line = f"{idx}. {title}"
                if author_text:
                    line += f" | {author_text}"
                if year:
                    line += f" ({year})"
                prompt_sections.append(line)

        if file_context:
            prompt_sections.append("UPLOADED FILE CONTEXT:")
            for idx, item in enumerate(file_context, start=1):
                prompt_sections.append(f"{idx}. {item['name']} [{item['type']}]")
                if item["summary"]:
                    prompt_sections.append(item["summary"])

        llm_plan: Optional[Dict[str, Any]] = None
        if LANGCHAIN_AVAILABLE and os.getenv("OPENROUTER_API_KEY"):
            try:
                max_tokens = _clamp_int_env("GENLATEX_DOCUMENT_GEN_MAX_TOKENS", 2800, 600, 8000)
                llm = ChatOpenAI(
                    model=model_name,
                    base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
                    api_key=os.getenv("OPENROUTER_API_KEY"),
                    temperature=0.2,
                    max_tokens=max_tokens,
                    streaming=False
                )

                system_prompt = (
                    "You are GenLaTeX, a document-generation assistant. "
                    "Return ONLY strict JSON with this shape: "
                    "{\"title\": str, \"abstract\": str, \"keywords\": [str], "
                    "\"sections\": [{\"id\": str, \"name\": str, \"content\": str}], \"bibtex\": str}. "
                    "Rules: content must be compilable with pdflatex templates; do not wrap JSON in markdown fences; "
                    "do not include prose outside JSON; generate practical section content. "
                    "CRITICAL: Each section's \"content\" must be FULL content: write complete sentences and paragraphs (or full bullet points with explanatory text after each \\item), not just headings or bare \\item labels. For slides, each \\item must include the point and at least one sentence of explanation or detail."
                )
                user_prompt = "\n\n".join(prompt_sections)
                llm_response = await llm.ainvoke(f"{system_prompt}\n\n{user_prompt}")
                llm_plan = _extract_json_object(getattr(llm_response, "content", ""))
            except Exception as exc:
                logger.warning(f"Fast document generation LLM failed, using fallback: {exc}")

        if not llm_plan:
            llm_plan = self._build_fallback_plan(request, document_type, file_context)

        title = str(llm_plan.get("title") or request.topic or "Generated Document").strip()
        if not title:
            title = "Generated Document"
        title = re.sub(r"\s+", " ", title)[:220]

        abstract = str(llm_plan.get("abstract") or "").strip()
        if not abstract:
            abstract = "Generated from your prompt with a complete LaTeX structure."

        raw_keywords = llm_plan.get("keywords") or []
        if isinstance(raw_keywords, str):
            raw_keywords = [k.strip() for k in raw_keywords.split(",")]
        keywords: List[str] = []
        for value in raw_keywords:
            item = str(value or "").strip()
            if not item:
                continue
            key = item.lower()
            if key in {k.lower() for k in keywords}:
                continue
            keywords.append(item)
            if len(keywords) >= 10:
                break
        if not keywords:
            keywords = [document_type, "genlatex"]

        raw_sections = llm_plan.get("sections") or []
        sections: List[Dict[str, Any]] = []
        if isinstance(raw_sections, list):
            for idx, section in enumerate(raw_sections, start=1):
                if not isinstance(section, dict):
                    continue
                section_name = str(section.get("name") or section.get("section_name") or f"Section {idx}").strip()
                section_content = str(section.get("content") or "").strip()
                if not section_content:
                    continue
                sections.append(
                    {
                        "section_id": str(section.get("id") or section.get("section_id") or idx),
                        "section_name": section_name,
                        "content": section_content,
                        "word_count": len(re.findall(r"\b\w+\b", section_content)),
                        "citations": section.get("citations") if isinstance(section.get("citations"), list) else [],
                    }
                )

        if not sections:
            fallback = self._build_fallback_plan(request, document_type, file_context)
            for idx, section in enumerate(fallback.get("sections", []), start=1):
                section_content = str(section.get("content") or "").strip()
                sections.append(
                    {
                        "section_id": str(section.get("id") or idx),
                        "section_name": str(section.get("name") or f"Section {idx}"),
                        "content": section_content,
                        "word_count": len(re.findall(r"\b\w+\b", section_content)),
                        "citations": [],
                    }
                )
        elif document_type == "slides" and self._slides_content_needs_upgrade(sections):
            logger.info("Slide content looked too generic; applying enriched fallback structure")
            fallback = self._build_fallback_plan(request, document_type, file_context)
            sections = []
            for idx, section in enumerate(fallback.get("sections", []), start=1):
                section_content = str(section.get("content") or "").strip()
                if not section_content:
                    continue
                sections.append(
                    {
                        "section_id": str(section.get("id") or idx),
                        "section_name": str(section.get("name") or f"Section {idx}"),
                        "content": section_content,
                        "word_count": len(re.findall(r"\b\w+\b", section_content)),
                        "citations": [],
                    }
                )

        if update_progress:
            await update_progress("writing", 55.0, "Generating LaTeX document content...")

        latex_generator = LatexGenerator(template_dir=self.config.template_dir)
        has_custom_template = False
        if template_files:
            for raw_name in template_files.keys():
                rel_path = _safe_template_relative_path(raw_name)
                if rel_path and rel_path.suffix.lower() == ".tex":
                    has_custom_template = True
                    break
        if template_files:
            latex_generator.set_template_files(template_files)
        if special_instructions:
            latex_generator.set_special_instructions(special_instructions)

        latex_data = {
            "title": title,
            "abstract": abstract,
            "keywords": keywords,
            "sections": sections,
            "document_type": document_type,
            "document_template": template_hint,
        }
        main_tex = latex_generator._generate_main_tex(latex_data)
        if not main_tex or "\\begin{document}" not in main_tex:
            fallback_template_name = _DOCUMENT_TEMPLATE_BY_TYPE.get(document_type, "main.tex")
            fallback_template_path = Path(self.config.template_dir) / fallback_template_name
            if not fallback_template_path.exists():
                fallback_template_path = Path(self.config.template_dir) / "main.tex"
            fallback_template = fallback_template_path.read_text(encoding="utf-8", errors="ignore")
            main_tex = (
                fallback_template
                .replace("{{TITLE}}", title)
                .replace("{{AUTHOR}}", "GenLaTeX")
                .replace("{{AFFILIATION}}", "AI Document Assistant")
                .replace("{{EMAIL}}", "noreply@genlatex.local")
                .replace("{{DATE}}", "\\today")
                .replace("{{ABSTRACT}}", abstract)
                .replace("{{KEYWORDS}}", ", ".join(keywords))
                .replace("{{CONTENT}}", "\n\n".join(
                    f"\\section{{{s['section_name']}}}\n{s['content']}" for s in sections
                ))
            )

        main_tex = self._enforce_builtin_document_class(
            main_tex,
            document_type,
            has_custom_template=has_custom_template,
        )

        if document_type == "slides":
            request_text = f"{request.topic}\n{request.description}"
            main_tex = self._apply_slide_color_preferences(main_tex, request_text, special_instructions)

        bibtex = str(llm_plan.get("bibtex") or "").strip()
        if not bibtex:
            if selected_refs:
                generated_entries = []
                for idx, ref in enumerate(selected_refs[:40], start=1):
                    key_base = re.sub(r"[^a-zA-Z0-9]+", "", str(ref.get("title") or f"source{idx}").lower())[:18] or f"source{idx}"
                    citation_key = f"{key_base}{idx}"
                    title_field = str(ref.get("title") or f"Source {idx}").replace("{", "").replace("}", "")
                    authors = ref.get("authors")
                    if isinstance(authors, list):
                        author_field = " and ".join(str(a).strip() for a in authors if str(a).strip()) or "Unknown"
                    else:
                        author_field = str(authors or "Unknown")
                    year_field = str(ref.get("year") or datetime.now().year)
                    url_field = str(ref.get("url") or "")
                    entry = [
                        f"@misc{{{citation_key},",
                        f"  title = {{{title_field}}},",
                        f"  author = {{{author_field}}},",
                        f"  year = {{{year_field}}},",
                    ]
                    if url_field:
                        entry.append(f"  url = {{{url_field}}},")
                    entry.append("}")
                    generated_entries.append("\n".join(entry))
                bibtex = "\n\n".join(generated_entries)
            else:
                bibtex = (
                    "@misc{placeholder_source,\n"
                    "  title = {Placeholder Source},\n"
                    "  author = {GenLaTeX},\n"
                    f"  year = {{{datetime.now().year}}}\n"
                    "}"
                )

        output_path = Path(request.output_dir or self.config.output_dir).resolve()
        output_path.mkdir(parents=True, exist_ok=True)

        main_tex_path = output_path / "main.tex"
        bibtex_path = output_path / "references.bib"
        json_path = output_path / "paper_data.json"
        report_path = output_path / "report.txt"

        # Normalize common LLM typo: 1modern -> lmodern (invalid package -> valid)
        main_tex = re.sub(r"\\usepackage(\[[^\]]*\])?\{1modern\}", r"\\usepackage\1{lmodern}", main_tex)
        main_tex_path.write_text(main_tex, encoding="utf-8")
        bibtex_path.write_text(bibtex + ("\n" if not bibtex.endswith("\n") else ""), encoding="utf-8")

        if template_files:
            for raw_name, payload in template_files.items():
                rel = _safe_template_relative_path(raw_name)
                if rel is None:
                    continue
                if str(rel).replace("\\", "/").lower() == "main.tex":
                    continue
                ext = rel.suffix.lower()
                dest = output_path / rel
                dest.parent.mkdir(parents=True, exist_ok=True)
                raw_bytes = _decode_template_payload_to_bytes(payload)
                if raw_bytes is None:
                    text_value = _decode_template_payload_to_text(payload)
                    if text_value is None:
                        continue
                    raw_bytes = text_value.encode("utf-8")
                if ext in _BINARY_TEMPLATE_EXTENSIONS:
                    dest.write_bytes(raw_bytes)
                else:
                    try:
                        dest.write_text(raw_bytes.decode("utf-8", errors="ignore"), encoding="utf-8")
                    except Exception:
                        dest.write_bytes(raw_bytes)

        paper_payload = {
            "title": title,
            "abstract": abstract,
            "keywords": keywords,
            "sections": sections,
            "bibtex": bibtex,
            "actual_words": sum(int(s.get("word_count") or 0) for s in sections),
            "references": selected_refs,
        }
        json_path.write_text(json.dumps(paper_payload, indent=2, ensure_ascii=False), encoding="utf-8")

        report_lines = [
            "GenLaTeX Document Generation Report",
            f"Generated: {datetime.now().isoformat()}",
            f"Type: {document_type}",
            f"Template: {template_hint or 'default'}",
            f"Sections: {len(sections)}",
            f"Files used as context: {len(file_context)}",
            f"Selected references: {len(selected_refs)}",
            "",
            "Output files:",
            "- main.tex",
            "- references.bib",
            "- paper_data.json",
        ]
        report_path.write_text("\n".join(report_lines) + "\n", encoding="utf-8")

        if update_progress:
            await update_progress("verification", 88.0, "Finalizing files and outputs...")

        return paper_payload
    
    async def generate_paper(
        self,
        request: PaperGenerationRequest,
        template_files: Optional[Dict[str, str]] = None,
        special_instructions: Optional[str] = None,
        paper_id: Optional[str] = None,
        zotero_config: Optional[Dict[str, Any]] = None,
        document_mode: bool = False
    ) -> PaperGenerationResponse:
        """Generate a paper with optional template files and special instructions."""
        try:
            # Validate request
            self._validate_generation_request(request)
            
            # Memory system removed - template files must be provided
            if not template_files:
                logger.warning("⚠️  No template files provided - will use default template")
            
            # Store paper_id for progress callback
            stored_paper_id = paper_id  # Use passed paper_id first
            if not stored_paper_id:
                # Fallback: Find paper_id by matching project_id or latest in-progress paper
                for pid, paper in await state.list_paper_ids_and_values():
                    if hasattr(paper, 'paper_data') and paper.paper_data:
                        # Check if project_id matches
                        paper_project_id = getattr(paper.paper_data, 'project_id', None) if hasattr(paper.paper_data, 'project_id') else None
                        if paper_project_id == request.project_id:
                            stored_paper_id = pid
                            break
                    # Fallback: match latest in-progress paper
                    if paper.status == PaperStatus.IN_PROGRESS and not stored_paper_id:
                        stored_paper_id = pid
            
            logger.info(f"📝 Using paper_id '{stored_paper_id}' for progress updates (project_id: {request.project_id})")
            
            # Track last progress value to ensure monotonic progress (never goes backwards)
            last_progress = {"value": 0.0}
            
            # Define progress callback to update paper status in real-time
            async def update_progress(phase: str, progress: float, message: str):
                """Update paper status in real-time with monotonic progress enforcement"""
                from datetime import datetime
                
                # MONOTONIC PROGRESS: Never allow progress to go backwards
                if progress < last_progress["value"]:
                    logger.debug(f"Progress regression prevented: {progress:.1f}% < {last_progress['value']:.1f}%, keeping {last_progress['value']:.1f}%")
                    progress = last_progress["value"]
                else:
                    last_progress["value"] = progress
                
                # Use stored paper_id or try to find it
                paper_id = stored_paper_id
                if not paper_id:
                    # Fallback: find latest in-progress paper
                    for pid, paper in await state.list_paper_ids_and_values():
                        if paper.status == PaperStatus.IN_PROGRESS:
                            paper_id = pid
                            break
                
                if paper_id:
                    paper = await state.get_paper(paper_id)
                else:
                    paper = None
                if paper is not None:
                    # Handle phase conversion gracefully - use WRITING as fallback for unknown phases
                    # Map common invalid phases to valid ones
                    phase_mapping = {
                        "latex": "writing",  # LaTeX generation is part of writing phase
                        "latex_generation": "writing",
                        "generating_latex": "writing",
                        "plan": "plan",  # Keep plan as-is
                        "research": "research",  # Keep research as-is
                        "writing": "writing",  # Keep writing as-is
                        "complete": "complete"  # Keep complete as-is
                    }
                    normalized_phase = phase_mapping.get(phase.lower(), phase)
                    
                    try:
                        paper.phase = PaperPhase(normalized_phase)
                    except ValueError:
                        # If phase is still not a valid enum value, default to WRITING
                        logger.warning(f"Invalid phase '{phase}' (normalized: '{normalized_phase}'), defaulting to WRITING")
                        paper.phase = PaperPhase.WRITING
                    paper.progress = progress
                    paper.message = message
                    
                    # Update output files if they exist (especially after writing/LaTeX phases)
                    output_dir = request.output_dir or self.config.output_dir
                    try:
                        updated_files = self._get_output_files({}, output_dir)  # Empty dict is fine, we just check file existence
                        if updated_files:
                            paper.output_files = updated_files
                            logger.debug(f"Updated output files: {list(updated_files.keys())}")
                    except Exception as e:
                        logger.debug(f"Could not update output files: {e}")
                    
                    paper.updated_at = datetime.now()
                    logger.info(f"📊 Progress Update [{paper_id}]: {phase} - {progress:.1f}% - {message}")
                else:
                    logger.warning(f"⚠️  Could not find paper_id '{paper_id}' in active_papers for progress update")
            
            # Use fast_mode and flash_mode from request only (no .env fallback)
            fast_mode = request.fast_mode
            flash_mode = getattr(request, "flash_mode", False)
            if flash_mode:
                fast_mode = True  # Flash implies fast

            resolved_document_mode = bool(
                document_mode
                or getattr(request, "document_type", None)
                or getattr(request, "document_template", None)
                or getattr(request, "document_schema_id", None)
            )

            if resolved_document_mode:
                logger.info("[DOCUMENT MODE] Using fast prompt/files generation pipeline")
                paper_data = await self._generate_document_fast(
                    request=request,
                    template_files=template_files,
                    special_instructions=special_instructions,
                    update_progress=update_progress,
                )

                try:
                    paper_data_model = self._convert_paper_data(paper_data)
                except Exception as e:
                    logger.error(f"Failed to convert fast document data: {e}")
                    from api.models import CitationStatsModel
                    paper_data_model = PaperDataModel(
                        title=paper_data.get('title', 'Generated Document'),
                        abstract=paper_data.get('abstract', ''),
                        keywords=paper_data.get('keywords', []),
                        sections=[],
                        bibtex=paper_data.get('bibtex', ''),
                        actual_words=paper_data.get('actual_words', 0),
                        citation_stats=CitationStatsModel(
                            total_sources=0,
                            cited_sources=0,
                            total_citations=0,
                            unused_sources=[],
                            citation_density=0.0
                        )
                    )

                return PaperGenerationResponse(
                    paper_id=f"generated_{datetime.now().timestamp()}",
                    status="completed",
                    phase="complete",
                    progress=100.0,
                    paper_data=paper_data_model,
                    message=None,
                    created_at=datetime.now(),
                    updated_at=datetime.now(),
                    output_files=self._get_output_files(paper_data, request.output_dir or self.config.output_dir)
                )

            # Create orchestrator with dynamic project_id and progress callback
            orchestrator = PaperOrchestrator(
                openrouter_api_key=os.getenv("OPENROUTER_API_KEY"),
                openrouter_base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
                openrouter_model=os.getenv("AI_MODEL") or os.getenv("AI_MODEL_FALLBACK") or "deepseek/deepseek-chat",
                tavily_api_key=self.config.tavily_api_key,
                template_dir=self.config.template_dir,
                checkpoint_dir=self.config.checkpoint_dir,
                project_id=request.project_id,
                verbose=True,
                progress_callback=update_progress,
                fast_mode=fast_mode,
                flash_mode=flash_mode,
                paper_id=stored_paper_id
            )
            
            # Generate paper using orchestrator with template files
            # Force fresh generation unless explicitly resuming to avoid cross-topic contamination
            if template_files:
                logger.info(f"🚀 Starting paper generation with {len(template_files)} template files: {list(template_files.keys())}")
            else:
                logger.warning("⚠️  Starting paper generation WITHOUT template files - will use default template")
            
            if document_mode:
                logger.info("[DOCUMENT MODE] Using prompt/files-first generation (external research disabled)")
            if getattr(request, "document_type", None):
                logger.info(
                    f"[DOCUMENT MODE] Document target: type={request.document_type}, template={getattr(request, 'document_template', None)}"
                )

            research_files = getattr(request, "research_files", None) or []
            paper_data = await orchestrator.generate_paper(
                topic=request.topic,
                description=request.description,
                output_dir=request.output_dir or self.config.output_dir,
                resume_from=request.resume_from.value if request.resume_from and hasattr(request.resume_from, 'value') else (request.resume_from if request.resume_from else None),
                template_files=template_files,
                special_instructions=special_instructions,
                research_files=research_files,
                zotero_config=zotero_config,
                document_mode=document_mode,
                document_type=getattr(request, "document_type", None),
                document_template=getattr(request, "document_template", None),
                document_schema_id=getattr(request, "document_schema_id", None),
            )
            
            # Convert to response model with error handling
            try:
                paper_data_model = self._convert_paper_data(paper_data)
            except Exception as e:
                logger.error(f"Failed to convert paper data: {e}")
                # Create a minimal response
                from api.models import CitationStatsModel, SectionModel
                paper_data_model = PaperDataModel(
                    title=paper_data.get('title', 'Generated Paper'),
                    abstract=paper_data.get('abstract', ''),
                    keywords=paper_data.get('keywords', []),
                    sections=[],
                    bibtex=paper_data.get('bibtex', ''),
                    actual_words=paper_data.get('actual_words', 0),
                    citation_stats=CitationStatsModel(
                        total_sources=0,
                        cited_sources=0,
                        total_citations=0,
                        unused_sources=[],  # Should be a list, not int
                        citation_density=0.0
                    )
                )
            
            # Create response with error handling (include message if LaTeX compile failed)
            compile_message = paper_data.get("_compile_message") if paper_data.get("_compile_status") != "success" else None
            try:
                response = PaperGenerationResponse(
                    paper_id=f"generated_{datetime.now().timestamp()}",
                    status="completed",
                    phase="complete",
                    progress=100.0,
                    paper_data=paper_data_model,
                    message=compile_message,
                    created_at=datetime.now(),
                    updated_at=datetime.now(),
                    output_files=self._get_output_files(paper_data, request.output_dir or self.config.output_dir)
                )
            except Exception as e:
                logger.error(f"Failed to create response: {e}")
                # Create minimal response
                response = PaperGenerationResponse(
                    paper_id=f"generated_{datetime.now().timestamp()}",
                    status="completed",
                    phase="complete",
                    progress=100.0,
                    paper_data=paper_data_model,
                    message=compile_message,
                    created_at=datetime.now(),
                    updated_at=datetime.now(),
                    output_files={}
                )
            
            return response
            
        except Exception as e:
            import traceback
            error_traceback = traceback.format_exc()
            logger.error(f"Document generation failed: {e}")
            logger.error(f"Full traceback:\n{error_traceback}")
            raise PaperGenerationError(f"Document generation failed: {e}")
    
    async def verify_content(self, request: VerificationRequest) -> VerificationResultModel:
        """GenLaTeX: fact-check/verification disabled - return stub"""
        return VerificationResultModel(
            section=request.section_name or "section",
            total_claims=0,
            verified_claims=0,
            issues=[],
            uncited_claims=[],
            passed=True
        )
    
    def _validate_generation_request(self, request: PaperGenerationRequest):
        """Validate paper generation request"""
        if not request.topic or len(request.topic.strip()) < 1:
            raise ValidationError("Topic is required")
        
        if not request.description or len(request.description.strip()) < 20:
            raise ValidationError("Description must be at least 20 characters long")
        
    
    def _convert_paper_data(self, paper_data: Dict) -> PaperDataModel:
        """Convert paper data to response model"""
        from api.models import CitationStatsModel, SectionModel
        
        # Debug: Check what type paper_data actually is
        logger.info(f"Paper data type: {type(paper_data)}")
        if hasattr(paper_data, 'sections'):
            logger.info(f"Paper data has sections attribute: {type(paper_data.sections)}")
        elif isinstance(paper_data, dict):
            logger.info(f"Paper data is dict with keys: {list(paper_data.keys())}")
        else:
            logger.info(f"Paper data is not dict, has attributes: {dir(paper_data)}")
        
        # Convert sections to SectionModel objects
        sections = []
        
        # Handle both dict and object types for paper_data
        if isinstance(paper_data, dict):
            sections_data = paper_data.get('sections', [])
        else:
            sections_data = getattr(paper_data, 'sections', [])
        
        for section in sections_data:
            try:
                # Handle both dict and object types
                if isinstance(section, dict):
                    section_id = section.get('section_id', section.get('id', ''))
                    section_name = section.get('section_name', section.get('name', ''))
                    content = section.get('content', '')
                    word_count = section.get('word_count', 0)
                    citations = section.get('citations', [])
                else:
                    # Handle Source objects or other types
                    section_id = getattr(section, 'section_id', getattr(section, 'id', ''))
                    section_name = getattr(section, 'section_name', getattr(section, 'name', ''))
                    content = getattr(section, 'content', '')
                    word_count = getattr(section, 'word_count', 0)
                    citations = getattr(section, 'citations', [])
                
                section_model = SectionModel(
                    section_id=section_id,
                    section_name=section_name,
                    content=content,
                    word_count=word_count,
                    citations=citations,
                    sources=[],  # Convert sources if needed
                    subsections=[]  # Convert subsections if needed
                )
                sections.append(section_model)
            except Exception as e:
                logger.warning(f"Failed to convert section: {e}")
                # Create a minimal section
                if isinstance(section, dict):
                    section_id = section.get('id', 'unknown')
                    section_name = section.get('name', 'Unknown Section')
                    content = section.get('content', '')
                    word_count = section.get('word_count', 0)
                else:
                    section_id = getattr(section, 'id', 'unknown')
                    section_name = getattr(section, 'name', 'Unknown Section')
                    content = getattr(section, 'content', '')
                    word_count = getattr(section, 'word_count', 0)
                
                sections.append(SectionModel(
                    section_id=section_id,
                    section_name=section_name,
                    content=content,
                    word_count=word_count,
                    citations=[],
                    sources=[],
                    subsections=[]
                ))
        
        # Create citation stats
        try:
            # Get total sources from paper_data['references'] (global pool)
            total_sources = 0
            if isinstance(paper_data, dict):
                total_sources = len(paper_data.get('references', []))
            elif hasattr(paper_data, 'references'):
                total_sources = len(paper_data.references)
            
            # Count all citations used across all sections
            all_citations = []
            for s in sections_data:
                citations = s.get('citations', []) if isinstance(s, dict) else getattr(s, 'citations', [])
                if isinstance(citations, list):
                    all_citations.extend(citations)
            
            # Get unique cited sources (citation keys)
            cited_sources = len(set(all_citations))
            
            # Calculate citation density (citations per 1000 words)
            total_words = sum(s.get('word_count', 0) if isinstance(s, dict) else getattr(s, 'word_count', 0) for s in sections_data)
            citation_density = (len(all_citations) / total_words * 1000) if total_words > 0 else 0.0
            
            citation_stats = CitationStatsModel(
                total_sources=total_sources,
                cited_sources=cited_sources,
                total_citations=len(all_citations),
                unused_sources=[],  # Could calculate: total_sources - cited_sources, but keeping simple for now
                citation_density=citation_density
            )
        except Exception as e:
            logger.warning(f"Failed to create citation stats: {e}")
            # Create default citation stats
            citation_stats = CitationStatsModel(
                total_sources=0,
                cited_sources=0,
                total_citations=0,
                unused_sources=[],  # Should be a list, not int
                citation_density=0.0
            )
        
        # Handle both dict and object types for final paper data access
        if isinstance(paper_data, dict):
            title = paper_data.get('title', 'Unknown Title')
            abstract = paper_data.get('abstract', '')
            keywords = paper_data.get('keywords', [])
            bibtex = paper_data.get('bibtex', '')
            actual_words = paper_data.get('actual_words', 0)
        else:
            title = getattr(paper_data, 'title', 'Unknown Title')
            abstract = getattr(paper_data, 'abstract', '')
            keywords = getattr(paper_data, 'keywords', [])
            bibtex = getattr(paper_data, 'bibtex', '')
            actual_words = getattr(paper_data, 'actual_words', 0)
        
        return PaperDataModel(
            title=title,
            abstract=abstract,
            keywords=keywords,
            sections=sections,
            bibtex=bibtex,
            actual_words=actual_words,
            citation_stats=citation_stats
        )
    
    def _get_output_files(self, paper_data: Dict, output_dir: str) -> Dict[str, str]:
        """Get output file paths - verify files exist before returning. Uses resolved (absolute) paths for ZIP creation."""
        output_path = Path(output_dir).resolve()
        output_files = {}
        
        # Check each file and only include if it exists
        latex_file = output_path / "main.tex"
        bibtex_file = output_path / "references.bib"
        json_file = output_path / "paper_data.json"
        report_file = output_path / "report.txt"
        
        if latex_file.exists():
            output_files["latex"] = str(latex_file)
        if bibtex_file.exists():
            output_files["bibtex"] = str(bibtex_file)
        if json_file.exists():
            output_files["json"] = str(json_file)
        if report_file.exists():
            output_files["report"] = str(report_file)
        
        # Also check for images.tex if it exists
        images_tex = output_path / "images.tex"
        if images_tex.exists():
            output_files["images"] = str(images_tex)
        
        logger.info(f"Output files found: {list(output_files.keys())}")
        return output_files


class SystemService:
    """Service for system operations"""
    
    def __init__(self):
        self.start_time = datetime.now()
        self.paper_counter = 0
    
    async def get_health_status(self) -> HealthResponse:
        """Get system health status"""
        try:
            # Check dependencies
            dependencies = {}
            
            # Check OpenRouter API
            try:
                dependencies["openrouter"] = "healthy" if os.getenv("OPENROUTER_API_KEY") else "missing_key"
            except Exception:
                dependencies["openrouter"] = "error"
            
            # Check Tavily API
            try:
                dependencies["tavily"] = "healthy" if os.getenv("TAVILY_API_KEY") else "optional"
            except Exception:
                dependencies["tavily"] = "error"
            
            # Check file system
            try:
                Path("./checkpoints").mkdir(exist_ok=True)
                Path("./output").mkdir(exist_ok=True)
                dependencies["filesystem"] = "healthy"
            except Exception:
                dependencies["filesystem"] = "error"
            
            # Determine overall status
            status = "healthy" if all(
                dep_status in ["healthy", "optional"] 
                for dep_status in dependencies.values()
            ) else "degraded"
            
            return HealthResponse(
                status=status,
                version="1.0.0",
                timestamp=datetime.now(),
                dependencies=dependencies
            )
            
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return HealthResponse(
                status="unhealthy",
                version="1.0.0",
                timestamp=datetime.now(),
                dependencies={"error": str(e)}
            )
    
    async def get_system_info(self) -> SystemInfo:
        """Get detailed system information"""
        try:
            # Get system resources
            memory = psutil.virtual_memory()
            # Use current directory for disk usage (Windows compatible)
            disk = psutil.disk_usage('.')
            cpu_percent = psutil.cpu_percent(interval=1)
            
            system_resources = {
                "memory": {
                    "total": memory.total,
                    "available": memory.available,
                    "percent": memory.percent
                },
                "disk": {
                    "total": disk.total,
                    "free": disk.free,
                    "percent": (disk.used / disk.total) * 100
                },
                "cpu_percent": cpu_percent
            }
            
            # Get dependency versions
            dependencies = {}
            try:
                import langchain
                dependencies["langchain"] = langchain.__version__
            except ImportError:
                dependencies["langchain"] = "not_installed"
            
            try:
                import openai
                dependencies["openai"] = openai.__version__
            except ImportError:
                dependencies["openai"] = "not_installed"
            
            try:
                import psutil
                dependencies["psutil"] = psutil.__version__
            except ImportError:
                dependencies["psutil"] = "not_installed"
            
            try:
                import fastapi
                dependencies["fastapi"] = fastapi.__version__
            except ImportError:
                dependencies["fastapi"] = "not_installed"
            
            return SystemInfo(
                api_version="1.0.0",
                python_version=platform.python_version(),
                dependencies=dependencies,
                system_resources=system_resources,
                active_papers=0,  # This would be tracked elsewhere
                total_papers_generated=self.paper_counter
            )
            
        except Exception as e:
            logger.error(f"Failed to get system info: {e}")
            # Return a minimal system info instead of raising an error
            return SystemInfo(
                api_version="1.0.0",
                python_version=platform.python_version(),
                dependencies={"error": str(e)},
                system_resources={"error": str(e)},
                active_papers=0,
                total_papers_generated=self.paper_counter
            )
    
    def increment_paper_counter(self):
        """Increment paper counter"""
        self.paper_counter += 1


# Backward compatibility for older imports during migration.
PaperService = DocumentService
