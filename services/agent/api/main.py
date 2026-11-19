"""
FastAPI application for GenLaTeX document generation.
This module provides REST API endpoints for prompt-first document creation and management.
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys
import threading
import time
import uuid
import zipfile
import tempfile
import json
import shutil
import io
import base64
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any

try:
    from PyPDF2 import PdfReader  # type: ignore
except ImportError:  # pragma: no cover - optional dependency
    PdfReader = None

import uvicorn
from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, status, Response, UploadFile, File, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from time import time

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # python-dotenv not installed, use system env vars only

# Add the parent directory to the path to import our modules
sys.path.append(str(Path(__file__).parent.parent))

from api.models import (
    PaperGenerationRequest, PaperGenerationResponse, PaperStatus, PaperPhase,
    HealthResponse, ErrorResponse,
    PaperDataModel,
    APIConfig, SystemInfo,
    GenLatexAgentRequest, MakePaperResponse,
    ChatRequest, ChatResponse, ChatContext,
)
try:
    from api.services import PaperService, SystemService
    from api.dependencies import get_paper_service, get_system_service
    SERVICES_AVAILABLE = True
except ImportError:
    SERVICES_AVAILABLE = False
    PaperService = None
    SystemService = None
    def get_paper_service():
        raise HTTPException(status_code=503, detail="Paper service requires langchain.")
    def get_system_service():
        raise HTTPException(status_code=503, detail="System service requires langchain.")

from api.exceptions import PaperNotFoundError, PaperGenerationError, ValidationError
from api import state
from pydantic import BaseModel

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

paper_counter = 0

# Debug mode flag
DEBUG_MODE = os.getenv("DEBUG_MODE", "false").lower() == "true"

# Paper retention and cap for memory management
PAPER_RETENTION_SEC = float(os.getenv("PAPER_RETENTION_SEC", "3600"))
PAPER_MAX_ACTIVE = int(os.getenv("PAPER_MAX_ACTIVE", "500"))
PAPER_CLEANUP_INTERVAL_SEC = 300  # Run cleanup every 5 minutes
STORAGE_CLEANUP_INTERVAL_SEC = int(os.getenv("STORAGE_CLEANUP_INTERVAL_SEC", "900"))  # 15 min, no cron needed
STORAGE_CLEANUP_ENABLED = os.getenv("STORAGE_CLEANUP_ENABLED", "true").lower() == "true"
STORAGE_CLEANUP_TIMEOUT_SEC = int(os.getenv("STORAGE_CLEANUP_TIMEOUT_SEC", "300"))  # Max 5 min per run


# Helper functions for agent initialization
def _clamp_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    """Read int env var safely with min/max bounds."""
    try:
        value = int(os.getenv(name, str(default)))
    except Exception:
        value = default
    return max(minimum, min(value, maximum))


def _get_llm():
    """Initialize LLM for agent operations"""
    try:
        from langchain_openai import ChatOpenAI
    except ImportError:
        raise HTTPException(
            status_code=503,
            detail="LangChain is required for LLM operations. Install with: pip install langchain langchain-openai"
        )
    llm_max_tokens = _clamp_int_env("GENLATEX_LLM_MAX_TOKENS", 2048, 256, 12000)
    return ChatOpenAI(
        model=os.getenv("AI_MODEL") or os.getenv("AI_MODEL_FALLBACK") or "deepseek/deepseek-chat",
        base_url=os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        api_key=os.getenv("OPENROUTER_API_KEY"),
        temperature=0.3,
        max_tokens=llm_max_tokens,
        streaming=False  # Disable streaming to prevent SSE JSON errors
    )


def _get_search_tools():
    """Initialize search tools"""
    from tools.search import get_search_tools
    tavily_key = os.getenv("TAVILY_API_KEY")
    return get_search_tools(tavily_key)


def _get_reviewer_agent():
    """Initialize article reviewer agent"""
    from agents.article_reviewer import ComprehensiveArticleReviewer
    from tools.citation import CitationManager
    
    llm = _get_llm()
    search_tools = _get_search_tools()
    citation_manager = CitationManager()
    
    return ComprehensiveArticleReviewer(
        llm=llm,
        search_tools=search_tools,
        citation_manager=citation_manager
    )


# Fake API functions for testing
async def create_fake_paper_data(topic: str, description: str) -> Dict:
    """Create fake paper data for testing"""
    return {
        "title": f"Research on {topic}",
        "abstract": f"This paper presents a comprehensive analysis of {topic.lower()}. {description[:200]}...",
        "keywords": [topic.split()[0], "research", "analysis", "study"],
        "sections": [
            {
                "section_id": "intro",
                "section_name": "Introduction",
                "content": f"# Introduction\n\nThis paper investigates {topic.lower()}. {description}",
                "word_count": 500,
                "citations": ["ref1", "ref2"]
            },
            {
                "section_id": "methodology",
                "section_name": "Methodology", 
                "content": "# Methodology\n\nWe employed a systematic approach to analyze the topic.",
                "word_count": 800,
                "citations": ["ref3", "ref4"]
            },
            {
                "section_id": "results",
                "section_name": "Results",
                "content": "# Results\n\nOur analysis revealed significant findings.",
                "word_count": 600,
                "citations": ["ref5"]
            },
            {
                "section_id": "conclusion",
                "section_name": "Conclusion",
                "content": "# Conclusion\n\nIn conclusion, our research provides valuable insights.",
                "word_count": 400,
                "citations": ["ref1", "ref3"]
            }
        ],
        "bibtex": """@misc{ref1,
  title={Sample Reference 1},
  author={Smith, John},
  howpublished={Journal of Research},
  year={2023}
}
@misc{ref2,
  title={Sample Reference 2},
  author={Doe, Jane},
  howpublished={Academic Studies},
  year={2022}
}""",
        "target_words": 8 * 250,  # Default ~8 pages
        "actual_words": 2300
    }


def _is_valid_support_file_content(filename: str, content: str) -> bool:
    """Validate .cls/.sty content is not a LaTeX document (prevents main.tex as IEEEtran.cls bug).
    Only rejects if \\documentclass or \\begin{document} appears on a non-comment line."""
    if not isinstance(content, str) or not filename.lower().endswith(('.cls', '.sty')):
        return True
    for line in content[:4000].split('\n'):
        s = line.strip()
        if not s or s.startswith('%'):
            continue
        if '\\documentclass' in s or '\\begin{document}' in s:
            return False
    return True


async def create_fake_output_files(paper_id: str, output_dir: str) -> Dict[str, str]:
    """Create fake output files for testing"""
    output_path = Path(output_dir)
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Create fake LaTeX file
    latex_content = """\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\title{Research on Sample Topic}
\\author{AI Research Assistant}
\\date{\\today}

\\begin{document}
\\maketitle

\\begin{abstract}
This is a sample abstract for testing purposes.
\\end{abstract}

\\section{Introduction}
This is sample content for testing the API integration.

\\section{Methodology}
Sample methodology section.

\\section{Results}
Sample results section.

\\section{Conclusion}
Sample conclusion section.

\\bibliographystyle{plain}
\\bibliography{references}
\\end{document}"""
    
    latex_file = output_path / "main.tex"
    with open(latex_file, 'w', encoding='utf-8') as f:
        f.write(latex_content)
    
    # Create fake BibTeX file
    bibtex_content = """@misc{sample1,
  title={Sample Paper 1},
  author={Author One},
  howpublished={Sample Journal},
  year={2023}
}

@misc{sample2,
  title={Sample Paper 2},
  author={Author Two},
  howpublished={Another Journal},
  year={2022}
}"""
    
    bibtex_file = output_path / "references.bib"
    with open(bibtex_file, 'w', encoding='utf-8') as f:
        f.write(bibtex_content)
    
    # Create fake JSON data file
    json_data = await create_fake_paper_data("Sample Topic", "Sample description", 5)
    json_file = output_path / "paper_data.json"
    with open(json_file, 'w', encoding='utf-8') as f:
        json.dump(json_data, f, indent=2)
    
    # Create fake report file
    report_content = f"""Paper Generation Report
Generated: {datetime.now().isoformat()}
Paper ID: {paper_id}
Status: Completed

Files Generated:
- main.tex (LaTeX source)
- references.bib (Bibliography)
- paper_data.json (Structured data)

Word Count: 2300 words
Sections: 4
Citations: 5
"""
    
    report_file = output_path / "report.txt"
    with open(report_file, 'w', encoding='utf-8') as f:
        f.write(report_content)
    
    return {
        "latex": str(latex_file),
        "bibtex": str(bibtex_file),
        "json": str(json_file),
        "report": str(report_file)
    }


async def simulate_paper_generation(paper_id: str, request: PaperGenerationRequest):
    """Simulate paper generation with realistic timeouts"""
    phases = [
        ("plan", "Planning paper structure and outline...", 2),
        ("research", "Researching sources and gathering information...", 3),
        ("writing", "Writing sections and content...", 4),
        ("verification", "Verifying content and checking citations...", 1),
        ("complete", "Document generation completed!", 0)
    ]
    
    paper = await state.get_paper(paper_id)
    if paper is None:
        logger.warning(f"Paper {paper_id} not found in simulate_paper_generation")
        return
    total_time = sum(phase[2] for phase in phases)
    current_time = 0
    
    for i, (phase, message, duration) in enumerate(phases):
        # Update paper status
        paper.phase = PaperPhase(phase)
        paper.status = PaperStatus.IN_PROGRESS if phase != "complete" else PaperStatus.COMPLETED
        paper.progress = (current_time / total_time) * 100
        paper.updated_at = datetime.now()
        
        logger.info(f"DEBUG MODE: {message}")
        
        # Wait for this phase
        if duration > 0:
            await asyncio.sleep(duration)
        
        current_time += duration
    
    # Create fake output files
    output_files = await create_fake_output_files(paper_id, request.output_dir or "./output")
    paper.output_files = output_files
    
    # Create fake paper data
    paper_data = await create_fake_paper_data(request.topic, request.description)
    paper.paper_data = paper_data
    
    # Final update
    paper.progress = 100.0
    paper.updated_at = datetime.now()
    
    logger.info(f"DEBUG MODE: Paper {paper_id} generation completed with fake data")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager"""
    logger.info("Starting GenLaTeX Document API...")
    
    # Initialize services (only if langchain is available)
    if SERVICES_AVAILABLE:
        try:
            paper_service = PaperService()
            search_service = SearchService()
            system_service = SystemService()
            
            # Store services in app state
            app.state.paper_service = paper_service
            app.state.search_service = search_service
            app.state.system_service = system_service
            
            logger.info("Services initialized successfully")
        except Exception as e:
            logger.warning(f"Failed to initialize services (some endpoints may not work): {e}")
            logger.info("Memory endpoints will still work without services")
    else:
        logger.warning("Services not available (langchain not installed). Memory endpoints will work, but paper/search endpoints will not.")
        logger.info("To enable all features, install: pip install langchain langchain-openai")
    
    # Background cleanup tasks â€“ run automatically, no cron needed
    cleanup_task = None
    storage_cleanup_task = None
    _storage_cleanup_lock = asyncio.Lock()  # Prevent overlapping storage cleanup runs

    async def _cleanup_loop():
        """In-memory paper cleanup (async, non-blocking)."""
        while True:
            await asyncio.sleep(PAPER_CLEANUP_INTERVAL_SEC)
            try:
                removed = await state.cleanup_old_papers(PAPER_RETENTION_SEC)
                if removed:
                    logger.info(f"Cleaned up {removed} old papers (retention={PAPER_RETENTION_SEC}s)")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning(f"Paper cleanup error: {e}")

    async def _storage_cleanup_loop():
        """Storage cleanup (runs in thread pool to avoid blocking event loop)."""
        await asyncio.sleep(90)  # Stagger: first run 90s after startup (avoids overlap with paper cleanup)
        if not STORAGE_CLEANUP_ENABLED:
            return
        from utils.storage_cleanup import run_cleanup
        while True:
            try:
                async with _storage_cleanup_lock:
                    # Run blocking I/O in thread pool â€“ does not block event loop
                    removed = await asyncio.wait_for(
                        asyncio.to_thread(run_cleanup, False, True, logger.info),
                        timeout=STORAGE_CLEANUP_TIMEOUT_SEC,
                    )
            except asyncio.CancelledError:
                break
            except asyncio.TimeoutError:
                logger.warning(f"Storage cleanup timed out after {STORAGE_CLEANUP_TIMEOUT_SEC}s")
            except Exception as e:
                logger.warning(f"Storage cleanup error: {e}")
            await asyncio.sleep(STORAGE_CLEANUP_INTERVAL_SEC)

    cleanup_task = asyncio.create_task(_cleanup_loop())
    if STORAGE_CLEANUP_ENABLED:
        storage_cleanup_task = asyncio.create_task(_storage_cleanup_loop())
        logger.info("Storage cleanup enabled (runs every %ds in background)", STORAGE_CLEANUP_INTERVAL_SEC)

    yield

    # Graceful shutdown: cancel cleanup tasks and wait briefly
    for task in [t for t in (cleanup_task, storage_cleanup_task) if t is not None]:
        task.cancel()
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=5.0)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass
    
    # Cleanup
    logger.info("Shutting down GenLaTeX Document API...")
    # Cancel any running generation jobs
    for paper_id, paper in await state.list_paper_ids_and_values():
        if paper.status == PaperStatus.IN_PROGRESS:
            logger.info(f"Cancelling generation job: {paper_id}")
            paper.status = PaperStatus.CANCELLED


# Create FastAPI application
app = FastAPI(
    title="GenLaTeX Agent - Document Generation API",
    description="""
    Core AI module for prompt-first LaTeX document generation.
    
    ## Features
    
    * **Document Generation**: Generate complete LaTeX documents from prompts and files
    * **Context Tools**: Use uploaded files and optional web context
    * **Content Verification**: Verify claims and check for hallucinations
    * **LaTeX Output**: Generate production-ready LaTeX documents
    
    ## API Keys Required
    
    - Anthropic API key (required)
    - Tavily API key (optional, for web search)
    """,
    version="1.0.0",
    lifespan=lifespan
)

# Add CORS middleware - Configure allowed origins from environment
# In production, set ALLOWED_ORIGINS to your frontend URL(s)
ALLOWED_ORIGINS = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")
# Strip whitespace from origins
ALLOWED_ORIGINS = [origin.strip() for origin in ALLOWED_ORIGINS if origin.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)

@app.middleware("http")
async def add_request_id(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["X-Request-ID"] = request_id
    return response

try:
    from api.tools_router import router as tools_router
    app.include_router(tools_router)
    print("âœ“ Tools router loaded")
except Exception as e:
    print(f"âš  Warning: Could not load tools router: {e}")

# Memory system will be integrated directly into services

# Security
security = HTTPBearer(auto_error=False)

# In-memory IP rate limiter (very simple; replace with Redis in prod)
RATE_LIMIT_WINDOW_SEC = int(os.getenv("RATE_LIMIT_WINDOW_SEC", "60"))
RATE_LIMIT_MAX_REQ = int(os.getenv("RATE_LIMIT_MAX_REQ", "120"))
RATE_LIMIT_MAX_IP_ENTRIES = int(os.getenv("RATE_LIMIT_MAX_IP_ENTRIES", "10000"))
_ip_hits: Dict[str, List[float]] = {}
_ip_hits_lock = threading.Lock()


def _rate_limit_ok(ip: str) -> bool:
    with _ip_hits_lock:
        now = time()
        window_start = now - RATE_LIMIT_WINDOW_SEC
        hits = _ip_hits.get(ip, [])
        hits = [t for t in hits if t >= window_start]
        if not hits:
            _ip_hits.pop(ip, None)
            hits = []
        if len(hits) >= RATE_LIMIT_MAX_REQ:
            _ip_hits[ip] = hits
            return False
        hits.append(now)
        _ip_hits[ip] = hits
        # Evict oldest IPs by last hit when over cap
        while len(_ip_hits) > RATE_LIMIT_MAX_IP_ENTRIES:
            if not _ip_hits:
                break
            oldest_ip = min(
                _ip_hits.keys(),
                key=lambda k: max(_ip_hits[k]) if _ip_hits[k] else 0.0
            )
            _ip_hits.pop(oldest_ip, None)
        return True


def _sanitize_filename(filename: str) -> str:
    name = Path(filename).name
    # Remove any potentially dangerous characters
    return "".join(ch for ch in name if ch.isalnum() or ch in (" ", ".", "_", "-")).strip() or "upload"


TEMPLATE_TEXT_EXTENSIONS = {
    ".tex", ".sty", ".cls", ".bib", ".bst", ".def", ".fd", ".cfg", ".txt", ".md"
}
TEMPLATE_BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".pdf", ".eps", ".tif", ".tiff"
}
TEMPLATE_ALLOWED_EXTENSIONS = TEMPLATE_TEXT_EXTENSIONS | TEMPLATE_BINARY_EXTENSIONS


def _sanitize_template_relative_path(filename: str) -> Optional[str]:
    raw = str(filename or "").replace("\\", "/").strip()
    if not raw:
        return None
    while raw.startswith("/"):
        raw = raw[1:]
    while raw.startswith("./"):
        raw = raw[2:]

    parts = []
    for part in raw.split("/"):
        segment = part.strip()
        if not segment or segment == ".":
            continue
        if segment == "..":
            return None
        cleaned = "".join(ch for ch in segment if ch.isalnum() or ch in (" ", ".", "_", "-", "(", ")", "+"))
        cleaned = cleaned.strip()
        if not cleaned:
            return None
        parts.append(cleaned)

    if not parts:
        return None
    return "/".join(parts)


def _guess_template_mime_type(ext: str) -> str:
    ext = str(ext or "").lower()
    mime_by_ext = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".bmp": "image/bmp",
        ".svg": "image/svg+xml",
        ".pdf": "application/pdf",
        ".eps": "application/postscript",
        ".tif": "image/tiff",
        ".tiff": "image/tiff"
    }
    return mime_by_ext.get(ext, "application/octet-stream")


def _decode_base64_payload(payload: Any) -> Optional[bytes]:
    if not isinstance(payload, dict):
        return None
    encoding = str(payload.get("__encoding") or payload.get("encoding") or "").lower()
    if encoding != "base64":
        return None
    raw = payload.get("data")
    if raw is None:
        raw = payload.get("content")
    if raw is None:
        return None
    try:
        return base64.b64decode(str(raw))
    except Exception:
        return None


def _template_payload_to_text(filename: str, payload: Any) -> Optional[str]:
    if isinstance(payload, str):
        return payload
    if isinstance(payload, (bytes, bytearray)):
        return bytes(payload).decode("utf-8", errors="ignore")
    decoded = _decode_base64_payload(payload)
    if decoded is not None:
        return decoded.decode("utf-8", errors="ignore")
    return None


def _template_payload_to_bytes(payload: Any) -> Optional[bytes]:
    if isinstance(payload, (bytes, bytearray)):
        return bytes(payload)
    decoded = _decode_base64_payload(payload)
    if decoded is not None:
        return decoded
    if isinstance(payload, str):
        return payload.encode("utf-8", errors="ignore")
    return None


def _normalize_template_files_dict(template_files: Any) -> Dict[str, Any]:
    if not isinstance(template_files, dict):
        return {}

    normalized: Dict[str, Any] = {}
    for raw_name, payload in template_files.items():
        safe_name = _sanitize_template_relative_path(str(raw_name))
        if not safe_name:
            logger.warning(f"Skipping template file with unsafe path: {raw_name}")
            continue

        ext = Path(safe_name).suffix.lower()
        if ext and ext not in TEMPLATE_ALLOWED_EXTENSIONS:
            logger.info(f"Skipping unsupported template extension: {safe_name}")
            continue

        if ext in TEMPLATE_BINARY_EXTENSIONS:
            bytes_data = _template_payload_to_bytes(payload)
            if not bytes_data:
                logger.warning(f"Skipping binary template file with unreadable payload: {safe_name}")
                continue
            normalized[safe_name] = {
                "__encoding": "base64",
                "mime_type": _guess_template_mime_type(ext),
                "data": base64.b64encode(bytes_data).decode("ascii")
            }
            continue

        text_payload = _template_payload_to_text(safe_name, payload)
        if text_payload is None:
            logger.warning(f"Skipping text template file with unreadable payload: {safe_name}")
            continue
        if ext in {".cls", ".sty"} and not _is_valid_support_file_content(safe_name, text_payload):
            logger.warning(
                f"Skipping {safe_name}: content appears to be a LaTeX document, not a valid class/style file"
            )
            continue
        normalized[safe_name] = text_payload

    return normalized


def _extract_text_from_bytes(data: bytes, suffix: str) -> Optional[str]:
    """Extract text content from supported file types."""
    suffix = suffix.lower()
    text_extensions = {
        ".txt", ".md", ".csv", ".json", ".yaml", ".yml", ".xml", ".tex", ".bib", ".bibtex",
        ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".cpp", ".h", ".go", ".rs", ".r"
    }
    if suffix in text_extensions:
        return data.decode("utf-8", errors="ignore")
    if suffix in {".pdf"} and PdfReader is not None:
        try:
            reader = PdfReader(io.BytesIO(data))
            text = []
            for page in reader.pages:
                try:
                    text.append(page.extract_text() or "")
                except Exception:
                    continue
            return "\n".join(text)
        except Exception:
            return None
    return None


def _summarize_text(content: str, max_chars: int = 800) -> str:
    cleaned = " ".join(content.split())
    if len(cleaned) <= max_chars:
        return cleaned
    return cleaned[:max_chars].rsplit(" ", 1)[0] + "â€¦"


IMAGE_EXTENSIONS = {'.png', '.jpg', '.jpeg', '.gif', '.svg', '.bmp', '.heic', '.webp'}


def _sanitize_error_for_user(error_msg: str) -> str:
    """
    Sanitize error messages before sending to users.
    Removes sensitive information and makes errors user-friendly.
    """
    if not error_msg:
        return "An unexpected error occurred. Please try again."

    error_lower = error_msg.lower()

    # Map technical errors to user-friendly messages
    error_mappings = [
        # API/Connection errors
        (["connection refused", "econnrefused", "connection reset"],
         "The AI service is temporarily unavailable. Please try again in a moment."),
        (["timeout", "timed out", "deadline exceeded"],
         "The request took too long. Please try a simpler request or try again."),
        (["rate limit", "too many requests", "429"],
         "You've made too many requests. Please wait a moment before trying again."),

        # Authentication errors (don't expose details)
        (["unauthorized", "401", "authentication", "api key", "api_key", "token"],
         "There was an authentication issue. Please try again or contact support."),

        # Model/AI errors
        (["context length", "token limit", "context window", "too long"],
         "The document is too long for processing. Try selecting a smaller section."),
        (["model not found", "model_not_found", "invalid model"],
         "There was an issue with the AI model. Please try again."),

        # File errors
        (["file not found", "no such file", "filenotfounderror"],
         "The requested file could not be found. Make sure the file exists."),
        (["permission denied", "access denied"],
         "Unable to access the file. Please check file permissions."),

        # JSON/Parsing errors (often internal)
        (["json", "parse error", "invalid syntax", "unexpected token"],
         "There was an issue processing the response. Please try again."),

        # Database errors (don't expose)
        (["database", "sql", "postgres", "connection pool"],
         "There was a temporary service issue. Please try again."),

        # Memory/Resource errors
        (["out of memory", "memory error", "resource exhausted"],
         "The system is currently under high load. Please try again in a moment."),
    ]

    for keywords, friendly_message in error_mappings:
        if any(keyword in error_lower for keyword in keywords):
            return friendly_message

    # If the error message is very long or looks like a stack trace, simplify it
    if len(error_msg) > 200 or "traceback" in error_lower or "  at " in error_msg:
        return "An unexpected error occurred. Please try again or contact support if the issue persists."

    # If error looks technical (contains paths, class names, etc.), simplify
    if any(pattern in error_msg for pattern in ["\\", "/", "::", "Error(", "Exception", ".py:", ".js:"]):
        # Extract just the main message if possible
        if ": " in error_msg:
            parts = error_msg.split(": ")
            # Return the last meaningful part, cleaned up
            for part in reversed(parts):
                cleaned = part.strip()
                if cleaned and len(cleaned) > 10 and not any(c in cleaned for c in ["\\", "/", "::"]):
                    return cleaned[:200]
        return "An error occurred while processing your request. Please try again."

    # For short, simple error messages, return them (but cap length)
    return error_msg[:200] if len(error_msg) > 200 else error_msg


def _require_auth_and_rate_limit(credentials: Optional[HTTPAuthorizationCredentials], ip: str):
    # Rate limit per IP
    if not _rate_limit_ok(ip or "unknown"):
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")

    # Bearer token authentication - REQUIRED in production
    required = os.getenv("AGENT_API_TOKEN")
    is_production = os.getenv("ENVIRONMENT", "").lower() == "production"
    
    # In production, API token is mandatory
    if is_production and not required:
        logger.error("AGENT_API_TOKEN must be set in production environment")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, 
            detail="Server configuration error: API authentication not configured"
        )
    
    # Validate token if configured (always in prod, optional in dev)
    if required:
        if not credentials:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, 
                detail="Authentication required",
                headers={"WWW-Authenticate": "Bearer"}
            )
        if credentials.scheme.lower() != "bearer":
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, 
                detail="Invalid authentication scheme. Use Bearer token.",
                headers={"WWW-Authenticate": "Bearer"}
            )
        # Use constant-time comparison to prevent timing attacks
        import hmac
        if not hmac.compare_digest(credentials.credentials.encode(), required.encode()):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED, 
                detail="Invalid authentication token",
                headers={"WWW-Authenticate": "Bearer"}
            )
    return True


# Exception handlers
@app.exception_handler(PaperNotFoundError)
async def paper_not_found_handler(request, exc: PaperNotFoundError):
    """Handle paper not found errors"""
    return JSONResponse(
        status_code=status.HTTP_404_NOT_FOUND,
        content={
            "error": "PaperNotFound",
            "message": str(exc),
            "timestamp": datetime.now().isoformat(),
            "request_id": getattr(request.state, "request_id", None)
        }
    )


@app.exception_handler(PaperGenerationError)
async def paper_generation_error_handler(request, exc: PaperGenerationError):
    """Handle paper generation errors"""
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "PaperGenerationError",
            "message": str(exc),
            "timestamp": datetime.now().isoformat(),
            "request_id": getattr(request.state, "request_id", None)
        }
    )


@app.exception_handler(ValidationError)
async def validation_error_handler(request, exc: ValidationError):
    """Handle validation errors"""
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={
            "error": "ValidationError",
            "message": str(exc),
            "timestamp": datetime.now().isoformat(),
            "request_id": getattr(request.state, "request_id", None)
        }
    )


# Global exception handler - catch ALL unhandled exceptions
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Handle all unhandled exceptions"""
    import traceback
    request_id = getattr(request.state, "request_id", None) if request else None
    
    # Get the path that failed
    path = str(request.url.path) if request else "unknown"
    
    # Log the full error with traceback
    logger.error(
        f"Unhandled exception in {path}: {str(exc)}\n{traceback.format_exc()}",
        exc_info=True
    )
    
    # Memory feature removed; legacy clients may still hit this path - return safe empty stats
    if path == "/memory/statistics":
        return JSONResponse(
            status_code=200,  # Always return 200 for statistics endpoint
            content={
                'project_id': request.query_params.get('project_id', 'genlatex-agent') if request else 'genlatex-agent',
                'error': f"Internal error: {str(exc)[:200]}",  # Truncate error message
                'request_id': request_id,
                'episodic': {'total_episodes': 0, 'recent_episodes': 0},
                'semantic': {'total_nodes': 0},
                'vector': {'total_chunks': 0, 'file_hashes': {}, 'file_metadata_cache': {}},
                'episodic_count': 0,
                'semantic_count': 0,
                'vector_count': 0,
                'image_count': 0,
                'file_count': 0,
                'project_state': {'phase': 'unknown', 'progress': 0.0, 'last_updated': datetime.now().isoformat()}
            }
        )
    
    # For other endpoints, return 500 with sanitized error details
    user_friendly_msg = _sanitize_error_for_user(str(exc))
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": "InternalServerError",
            "message": user_friendly_msg,
            "path": path,
            "timestamp": datetime.now().isoformat(),
            "request_id": request_id
        }
    )
# === AI Edit Endpoint ===

class SelectionModel(BaseModel):
    start: int
    end: int
    text: str

class AIEditRequest(BaseModel):
    projectId: str
    filePath: str
    fullText: str
    selection: SelectionModel
    prompt: str
    fileList: Optional[List[str]] = None
    compileLog: Optional[str] = None
    latexGuide: Optional[str] = None

class PatchModel(BaseModel):
    start: int
    end: int
    newText: str

class FileEditModel(BaseModel):
    filePath: str
    patches: List[PatchModel]

class AIEditResponse(BaseModel):
    success: bool
    edits: List[FileEditModel] = []
    summary: Optional[str] = None
    error: Optional[str] = None


@app.post("/api/genlatex-agent/ai/edit", response_model=AIEditResponse)
async def ai_edit(request_body: AIEditRequest, request_: Request, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Generate structured edits to apply directly to files.
    Always consider fullText (entire file), selection (local context), and prompt.
    """
    _require_auth_and_rate_limit(credentials, ip=(request_.client.host if request_.client else "unknown"))

    try:
        llm = _get_llm()
        # Base system instructions
        sys_instructions = (
            "You are an expert LaTeX writer and editor. Be direct, clear, and specific. "
            "Do not ask questions. Infer intent from context. "
            "Your ONLY output must be structured patches as per the schema. "
            "Given the entire file, the selected range, the user's instruction, and optional compile log, produce precise, minimal patches. "
            "Preserve meaning, section structure, citations, labels, and LaTeX validity (lists, environments, math, refs). "
            "If other files (e.g., references.bib) require updates, include them as additional file edits. "
            "Do not include any prose, explanations, or code fences outside the JSON response."
        )

        # Strengthen guidance implicitly for modification/fix intents
        prompt_lower = (request_body.prompt or "").lower()
        is_modify_intent = any(k in prompt_lower for k in [
            "fix", "correct", "modify", "refactor", "resolve", "repair", "clean", "format", "latex error", "compile error"
        ]) or bool(request_body.compileLog)

        if is_modify_intent:
            sys_instructions += (
                " Prioritize resolving compile errors and structural LaTeX issues. "
                "Prefer smallest viable edits; do not rewrite large sections unless necessary to fix errors. "
                "Ensure all list environments have proper \\item usage and matching begin/end, and sectioning commands are valid."
            )

        user_payload = {
            "projectId": request_body.projectId,
            "filePath": request_body.filePath,
            "fullText": request_body.fullText,
            "selection": request_body.selection.model_dump(),
            "prompt": request_body.prompt,
            "fileList": request_body.fileList or [],
            "compileLog": request_body.compileLog or "",
            "latexGuide": request_body.latexGuide or ""
        }

        output_contract = {
            "type": "object",
            "properties": {
                "edits": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "filePath": {"type": "string"},
                            "patches": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "start": {"type": "number"},
                                        "end": {"type": "number"},
                                        "newText": {"type": "string"}
                                    },
                                    "required": ["start", "end", "newText"]
                                }
                            }
                        },
                        "required": ["filePath", "patches"]
                    }
                },
                "summary": {"type": "string"}
            },
            "required": ["edits"]
        }

        prompt_text = (
            f"SYSTEM:\n{sys_instructions}\n\n"
            f"USER PROMPT:\n{request_body.prompt}\n\n"
            f"FILE PATH: {request_body.filePath}\n\n"
            f"SELECTION (start={request_body.selection.start}, end={request_body.selection.end}):\n{request_body.selection.text}\n\n"
            f"FULL FILE CONTENT:\n{request_body.fullText}\n\n"
            f"COMPILE LOG (if any):\n{(request_body.compileLog or '')[:4000]}\n\n"
            f"LATEX QUICK GUIDE:\n{(request_body.latexGuide or '')}\n\n"
            f"Return ONLY JSON that conforms to this schema: {json.dumps(output_contract)}."
        )

        # Call LLM
        try:
            response = await llm.ainvoke(prompt_text)
            content = response.content.strip()
            # Extract JSON if wrapped
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0].strip()
            elif "```" in content:
                content = content.split("```", 1)[1].split("```", 1)[0].strip()
            data = json.loads(content)
            # Basic validation
            edits = []
            for e in data.get("edits", []):
                file_path = e.get("filePath")
                patches = e.get("patches", [])
                clean_patches = []
                for p in patches:
                    try:
                        s = int(p.get("start"))
                        nd = int(p.get("end"))
                        nt = str(p.get("newText"))
                        if s >= 0 and nd >= s:
                            clean_patches.append({"start": s, "end": nd, "newText": nt})
                    except Exception:
                        continue
                if file_path and clean_patches:
                    edits.append({"filePath": file_path, "patches": clean_patches})

            if not edits:
                return AIEditResponse(success=False, edits=[], summary=data.get("summary", "No valid edits produced"))
            return AIEditResponse(success=True, edits=edits, summary=data.get("summary"))
        except Exception as e:
            # Fallback: if model fails, propose no-op with summary
            return AIEditResponse(success=False, edits=[], summary="AI failed to produce structured edits", error=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI edit failed: {str(e)}")


# Health and system endpoints
@app.get(
    "/health",
    response_model=HealthResponse,
    summary="Health Check",
    description="Check the health status of the API and its dependencies"
)
async def health_check():
    """Check API health status"""
    try:
        system_service = get_system_service()
        return await system_service.get_health_status()
    except Exception as e:
        logger.error(f"Health check failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Health check failed"
        )


@app.get(
    "/system/info",
    response_model=SystemInfo,
    summary="System Information",
    description="Get detailed system information and statistics"
)
async def get_system_info():
    """Get system information"""
    try:
        system_service = get_system_service()
        return await system_service.get_system_info()
    except Exception as e:
        logger.error(f"Failed to get system info: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve system information"
        )


# Circuit breaker status and management endpoints
@app.get(
    "/system/circuit-breakers",
    summary="Circuit Breaker Status",
    description="Get status of all circuit breakers for external service resilience"
)
async def get_circuit_breaker_status():
    """Get status of all circuit breakers"""
    try:
        from utils.circuit_breaker import circuit_registry
        return circuit_registry.get_status_summary()
    except ImportError:
        return {"error": "Circuit breaker not available", "breakers": {}}
    except Exception as e:
        logger.error(f"Failed to get circuit breaker status: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve circuit breaker status"
        )


@app.post(
    "/system/circuit-breakers/{service_name}/reset",
    summary="Reset Circuit Breaker",
    description="Manually reset a circuit breaker to closed state"
)
async def reset_circuit_breaker(service_name: str):
    """Reset a specific circuit breaker"""
    try:
        from utils.circuit_breaker import circuit_registry
        breaker = circuit_registry.get(service_name)
        breaker.reset()
        return {
            "success": True,
            "message": f"Circuit breaker '{service_name}' has been reset",
            "new_state": breaker.state.value
        }
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Circuit breaker not available"
        )
    except Exception as e:
        logger.error(f"Failed to reset circuit breaker: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to reset circuit breaker: {str(e)}"
        )


@app.post(
    "/system/circuit-breakers/reset-all",
    summary="Reset All Circuit Breakers",
    description="Manually reset all circuit breakers to closed state"
)
async def reset_all_circuit_breakers():
    """Reset all circuit breakers"""
    try:
        from utils.circuit_breaker import circuit_registry
        circuit_registry.reset_all()
        return {
            "success": True,
            "message": "All circuit breakers have been reset",
            "status": circuit_registry.get_status_summary()
        }
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail="Circuit breaker not available"
        )
    except Exception as e:
        logger.error(f"Failed to reset circuit breakers: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to reset circuit breakers: {str(e)}"
        )


# Document generation endpoints
@app.post(
    "/documents/generate",
    response_model=PaperGenerationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Generate Document",
    description="Start generating a new LaTeX document with optional uploaded context and template files"
)
@app.post(
    "/papers/generate",
    response_model=PaperGenerationResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Generate Document (Legacy Path)",
    description="Legacy compatibility endpoint for document generation"
)
async def generate_paper(
    request_: Request,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """Generate a new document (supports both Form and JSON requests)."""
    _require_auth_and_rate_limit(credentials, ip=(request_.client.host if request_.client else "unknown"))
    
    # Check content type to determine how to parse the request
    content_type = request_.headers.get("content-type", "")
    template_files_dict = None
    special_instructions = None
    zotero_config = None
    topic = None
    description = None
    output_dir = "./output"
    resume_from = None
    project_id = "genlatex-agent"
    user_id = None  # FIX: Add user_id for correct path resolution
    fast_mode = True
    flash_mode = False
    document_mode = False
    document_type = None
    document_template = None
    document_schema_id = None
    reference_files = None
    special_instructions_file = None
    template_uploads = None
    research_files = []

    logger.info(f"Received request with content-type: {content_type}")

    if "application/json" in content_type:
        # Handle JSON request
        try:
            body = await request_.json()
            logger.info(f"JSON body keys: {list(body.keys())}")

            topic = body.get("topic") or body.get("prompt")
            description = body.get("description")
            project_id = body.get("project_id", "genlatex-agent")
            user_id = body.get("user_id")  # FIX: Get user_id for correct path resolution
            output_dir = body.get("output_dir", "./output")
            resume_from = body.get("resume_from")
            fast_mode = body.get("fast_mode", True)
            if isinstance(fast_mode, str):
                fast_mode = fast_mode.lower() in ("true", "1", "yes", "on")
            flash_mode = body.get("flash_mode", False)
            if isinstance(flash_mode, str):
                flash_mode = flash_mode.lower() in ("true", "1", "yes", "on")
            document_mode = body.get("document_mode", body.get("documentMode", True))
            if isinstance(document_mode, str):
                document_mode = document_mode.lower() in ("true", "1", "yes", "on")
            document_type = body.get("document_type", body.get("documentType"))
            document_template = body.get("document_template", body.get("documentTemplate"))
            document_schema_id = body.get("document_schema_id", body.get("documentSchemaId"))
            template_files_dict = _normalize_template_files_dict(body.get("template_files"))
            special_instructions = body.get("special_instructions")
            zotero_config = body.get("zotero_config")  # Zotero API config for paper generation
            research_files = body.get("research_files") or body.get("researchFiles") or []
            if not isinstance(research_files, list):
                research_files = []

            logger.info(
                f"Parsed JSON - topic: {topic}, description: {description}, "
                f"fast_mode: {fast_mode}, flash_mode: {flash_mode}, document_mode: {document_mode}, "
                f"document_type: {document_type}, document_template: {document_template}"
            )
            logger.info(f"Template files in JSON: {list(template_files_dict.keys()) if template_files_dict else 'None'}")

            if special_instructions:
                logger.info(f"Special instructions provided: {special_instructions[:100]}...")
            if zotero_config:
                logger.info("Zotero config provided for paper generation")
        except Exception as e:
            logger.error(f"Failed to parse JSON body: {e}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid JSON request: {str(e)}"
            )
    else:
        # Handle form data request
        form_data = await request_.form()
        topic = form_data.get("topic") or form_data.get("prompt")
        description = form_data.get("description")
        output_dir = form_data.get("output_dir", "./output")
        resume_from = form_data.get("resume_from")
        project_id = form_data.get("project_id", "genlatex-agent")
        user_id = form_data.get("user_id")  # FIX: Get user_id for correct path resolution
        fast_mode_val = form_data.get("fast_mode") or "true"
        fast_mode = str(fast_mode_val).lower() not in ("false", "0", "no", "off")
        flash_mode_val = form_data.get("flash_mode") or "false"
        flash_mode = str(flash_mode_val).lower() in ("true", "1", "yes", "on")
        document_mode_val = form_data.get("document_mode") or form_data.get("documentMode") or "true"
        document_mode = str(document_mode_val).lower() in ("true", "1", "yes", "on")
        document_type = form_data.get("document_type") or form_data.get("documentType")
        document_template = form_data.get("document_template") or form_data.get("documentTemplate")
        document_schema_id = form_data.get("document_schema_id") or form_data.get("documentSchemaId")
        special_instructions_text = form_data.get("specialInstructions") or form_data.get("special_instructions")
        special_instructions = special_instructions_text
        reference_files = []
        seen_uploads = set()
        for upload_key in ("uploadedFiles", "referenceFiles", "reference_files"):
            for upload in form_data.getlist(upload_key):
                if not hasattr(upload, "filename") or not hasattr(upload, "read"):
                    continue
                fingerprint = (
                    getattr(upload, "filename", None),
                    getattr(upload, "content_type", None),
                    id(getattr(upload, "file", upload))
                )
                if fingerprint in seen_uploads:
                    continue
                seen_uploads.add(fingerprint)
                reference_files.append(upload)

        special_instructions_file = form_data.get("specialInstructionsFile") or form_data.get("special_instructions_file")
        template_uploads = form_data.getlist("templateFiles") or form_data.getlist("template_files")
        template_files_dict = {}
        if template_uploads:
            for idx, upload in enumerate(template_uploads):
                if not hasattr(upload, "filename") or not hasattr(upload, "read"):
                    continue
                raw_name = getattr(upload, "filename", None) or f"template_{idx+1}.tex"
                safe_name = _sanitize_template_relative_path(raw_name)
                if not safe_name:
                    logger.warning(f"Skipping uploaded template with unsafe path: {raw_name}")
                    continue

                try:
                    content_bytes = await upload.read()
                except Exception as read_error:
                    logger.warning(f"Failed reading uploaded template {raw_name}: {read_error}")
                    continue

                ext = Path(safe_name).suffix.lower()
                if ext and ext not in TEMPLATE_ALLOWED_EXTENSIONS:
                    logger.info(f"Skipping unsupported uploaded template extension: {safe_name}")
                    continue

                if ext in TEMPLATE_BINARY_EXTENSIONS:
                    template_files_dict[safe_name] = {
                        "__encoding": "base64",
                        "mime_type": getattr(upload, "content_type", None) or _guess_template_mime_type(ext),
                        "data": base64.b64encode(content_bytes).decode("ascii")
                    }
                    continue

                text_content = content_bytes.decode("utf-8", errors="ignore")
                if ext in {".cls", ".sty"} and not _is_valid_support_file_content(safe_name, text_content):
                    logger.warning(
                        f"Skipping {safe_name}: content appears to be a LaTeX document, not a valid class/style file"
                    )
                    continue
                template_files_dict[safe_name] = text_content

        template_files_dict = _normalize_template_files_dict(template_files_dict)
        raw_rf = form_data.get("research_files") or form_data.get("researchFiles")
        if raw_rf:
            try:
                research_files = json.loads(raw_rf) if isinstance(raw_rf, str) else raw_rf
                if not isinstance(research_files, list):
                    research_files = []
            except Exception:
                research_files = []

        logger.info(
            f"Form parameters - topic: {topic}, description: {description}, "
            f"fast_mode: {fast_mode}, flash_mode: {flash_mode}, document_mode: {document_mode}, "
            f"document_type: {document_type}, document_template: {document_template}"
        )

    if isinstance(template_files_dict, dict) and len(template_files_dict) == 0:
        template_files_dict = None

    # Validate required parameters
    if not topic or not description:
        error_msg = f"Missing required parameters - prompt/topic: {bool(topic)}, description: {bool(description)}"
        logger.error(error_msg)
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=error_msg
        )
    global paper_counter
    paper_counter += 1
    paper_id = f"doc_{paper_counter}_{uuid.uuid4().hex[:8]}"

    # Use isolated output folders per generation to avoid stale-file bleed across runs.
    try:
        raw_output_dir = str(output_dir or "./output").strip()
    except Exception:
        raw_output_dir = "./output"

    normalized_output = raw_output_dir.replace("\\", "/").rstrip("/")
    default_output_markers = {"", ".", "./output", "output", ".\\output"}
    allowed_output_base = Path("./output").resolve()
    if normalized_output in default_output_markers or normalized_output.endswith("/output"):
        output_dir = str((Path("./output") / paper_id).resolve())
    else:
        resolved = Path(raw_output_dir).resolve()
        try:
            resolved.relative_to(allowed_output_base)
            if resolved.exists() and not resolved.is_dir():
                output_dir = str(allowed_output_base / paper_id)
                logger.warning(f"[OUTPUT] Client output_dir is a file or invalid; using {output_dir}")
            else:
                output_dir = str(resolved)
        except ValueError:
            output_dir = str(allowed_output_base / paper_id)
            logger.warning(f"[OUTPUT] Client output_dir escaped allowed base; using {output_dir}")

    logger.info(f"[OUTPUT] Using isolated output directory for {paper_id}: {output_dir}")
    
    try:
        paper_service = get_paper_service()
        
        # Save template files and reference files to project directory
        project_path = None
        if project_id:
            # FIX: Determine project directory path with user_id (matches Next.js structure: data/projects/{userId}/{projectId}/)
            if user_id:
                # User ID provided - use correct nested path structure
                possible_paths = [
                    Path("../workspace/data/projects") / user_id / project_id,  # Relative to genlatex-agent
                    Path("./data/projects") / user_id / project_id,  # Relative to genlatex-agent
                    Path(os.getenv("GENLATEX_PROJECTS_PATH", ".")) / user_id / project_id,  # From env var
                ]
            else:
                # No user ID - fallback to flat structure (legacy support)
                logger.warning("âš ï¸ No user_id provided - using flat project path (legacy mode)")
                possible_paths = [
                    Path("../workspace/data/projects") / project_id,  # Relative to genlatex-agent
                    Path("./data/projects") / project_id,  # Relative to genlatex-agent
                    Path(os.getenv("GENLATEX_PROJECTS_PATH", ".")) / project_id,  # From env var
                ]

            for path_candidate in possible_paths:
                if path_candidate.parent.exists():
                    project_path = path_candidate
                    break

            if not project_path:
                # Create default path with user_id if available
                if user_id:
                    project_path = Path("./data/projects") / user_id / project_id
                else:
                    project_path = Path("./data/projects") / project_id

            project_path.mkdir(parents=True, exist_ok=True)
            logger.info(f"ðŸ“ Project directory: {project_path}")
        
        # Process and save template files to project directory
        # FIX: Only save to template/ subdirectory to avoid duplication
        # The generated output (main.tex, references.bib) will be saved to project root after generation
        if template_files_dict and project_path:
            template_dir = project_path / "template"
            template_dir.mkdir(exist_ok=True)
            template_dir_resolved = template_dir.resolve()

            for raw_filename, content in template_files_dict.items():
                filename = _sanitize_template_relative_path(raw_filename)
                if not filename:
                    logger.warning(f"Skipping template file with unsafe path: {raw_filename}")
                    continue

                ext = Path(filename).suffix.lower()
                if ext and ext not in TEMPLATE_ALLOWED_EXTENSIONS:
                    logger.info(f"Skipping unsupported template file extension: {filename}")
                    continue

                try:
                    template_file_path = (template_dir / filename).resolve()
                    if not str(template_file_path).startswith(str(template_dir_resolved)):
                        logger.warning(f"Skipping template path outside template directory: {filename}")
                        continue
                    template_file_path.parent.mkdir(parents=True, exist_ok=True)

                    if ext in TEMPLATE_BINARY_EXTENSIONS:
                        bytes_payload = _template_payload_to_bytes(content)
                        if not bytes_payload:
                            logger.warning(f"Skipping binary template file with unreadable payload: {filename}")
                            continue
                        template_file_path.write_bytes(bytes_payload)
                        logger.info(f"[OK] Saved binary template file to project: template/{filename}")
                    else:
                        text_payload = _template_payload_to_text(filename, content)
                        if text_payload is None:
                            logger.warning(f"Skipping text template file with unreadable payload: {filename}")
                            continue
                        if ext in {".cls", ".sty"} and not _is_valid_support_file_content(filename, text_payload):
                            logger.warning(
                                f"[WARN] Skipping {filename}: content appears to be a LaTeX document, not a valid class/style file"
                            )
                            continue
                        template_file_path.write_text(text_payload, encoding='utf-8')
                        logger.info(f"[OK] Saved template file to project: template/{filename}")
                except Exception as e:
                    logger.error(f"[WARN] Failed to save template file {filename}: {e}")
        # Process and save uploaded reference files from multipart requests to project root.
        reference_files_saved = []
        inline_max_chars_raw = os.getenv("GENLATEX_INLINE_TEXT_MAX_CHARS", "60000")
        try:
            inline_max_chars = int(inline_max_chars_raw)
        except (TypeError, ValueError):
            inline_max_chars = 60000
        if inline_max_chars <= 0:
            inline_max_chars = 60000

        if reference_files and project_path:
            for idx, ref_file in enumerate(reference_files):
                if hasattr(ref_file, "read") and hasattr(ref_file, "filename"):
                    try:
                        raw_name = ref_file.filename or f"upload_{idx+1}"
                        safe_name = _sanitize_filename(raw_name)
                        if not safe_name:
                            safe_name = f"upload_{idx+1}"
                        candidate_name = safe_name
                        stem = Path(safe_name).stem
                        suffix_name = Path(safe_name).suffix
                        collision_index = 1
                        while (project_path / candidate_name).exists():
                            candidate_name = f"{stem}_{collision_index}{suffix_name}"
                            collision_index += 1
                        safe_name = candidate_name

                        content = await ref_file.read()
                        ref_file_path = project_path / safe_name
                        ref_file_path.write_bytes(content)
                        reference_files_saved.append(safe_name)

                        suffix = ref_file_path.suffix.lower()
                        file_type = suffix.lstrip(".") or "bin"
                        text_content = _extract_text_from_bytes(content, suffix)
                        metadata = {
                            "source": "multipart_upload",
                            "uploaded_filename": safe_name,
                            "keywords": [file_type, "uploaded-file"],
                        }
                        if text_content:
                            truncated = len(text_content) > inline_max_chars
                            full_text = text_content[:inline_max_chars]
                            metadata["summary"] = _summarize_text(full_text, max_chars=800)
                            metadata["preview_text"] = full_text[:2000]
                            metadata["extracted_content"] = {
                                "success": True,
                                "full_text": full_text,
                                "full_text_truncated": truncated,
                                "total_chars": len(text_content)
                            }
                        logger.info(f"Saved uploaded file: {safe_name}")
                    except Exception as e:
                        logger.error(f"Failed to save uploaded file {getattr(ref_file, 'filename', f'#{idx+1}')}: {e}")

        # Process attached files if provided (memory system removed - files not processed)
        processed_files = []
        # Note: attached_files feature removed - files are not processed
        
        # Create request object
        request = PaperGenerationRequest(
            topic=topic,
            description=description,
            output_dir=output_dir,
            resume_from=resume_from,
            project_id=project_id,
            fast_mode=fast_mode,
            flash_mode=flash_mode,
            document_type=document_type,
            document_template=document_template,
            document_schema_id=document_schema_id,
            research_files=research_files,
        )
        
        # Create initial response with error handling
        try:
            paper_response = PaperGenerationResponse(
                paper_id=paper_id,
                status=PaperStatus.PENDING,
                phase=PaperPhase.PLAN,
                progress=0.0,
                message="Initializing document generation...",  # Initialize message field
                created_at=datetime.now(),
                updated_at=datetime.now()
            )
        except Exception as e:
            logger.error(f"Failed to create initial response: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to create initial response: {str(e)}"
            )
        
        # Evict oldest completed/failed if at cap, then store
        await state.evict_oldest_completed_if_over(PAPER_MAX_ACTIVE)
        # Store in active papers
        await state.set_paper(paper_id, paper_response)
        
        # Process and NORMALIZE template files if provided (from JSON request)
        # This ensures any .tex file is normalized to 'main.tex' for consistent access
        if template_files_dict:
            logger.info(f"Processing {len(template_files_dict)} template files from JSON request: {list(template_files_dict.keys())}")

            # Find main.tex (case-insensitive) or any .tex file
            main_tex_key = None
            for key in template_files_dict.keys():
                if key.lower() == 'main.tex':
                    main_tex_key = key
                    break

            # If no main.tex, find any .tex file
            if not main_tex_key:
                tex_files = [key for key in template_files_dict.keys() if key.lower().endswith('.tex')]
                if tex_files:
                    # Prefer common template names
                    for preferred in ['template.tex', 'paper.tex', 'document.tex', 'article.tex']:
                        for tex_file in tex_files:
                            if tex_file.lower() == preferred:
                                main_tex_key = tex_file
                                break
                        if main_tex_key:
                            break
                    # Use first .tex file if no preferred name found
                    if not main_tex_key:
                        main_tex_key = tex_files[0]
                    logger.info(f"ðŸ“‹ Found template: '{main_tex_key}' (no main.tex, using first .tex file)")

            # Normalize to 'main.tex' key for consistent access
            if main_tex_key and main_tex_key != 'main.tex':
                template_files_dict['main.tex'] = template_files_dict[main_tex_key]
                logger.info(f"ðŸ“‹ Normalized '{main_tex_key}' â†’ 'main.tex'")

            if 'main.tex' in template_files_dict:
                main_tex_content = _template_payload_to_text('main.tex', template_files_dict['main.tex'])
                if main_tex_content is not None:
                    template_files_dict['main.tex'] = main_tex_content
                    logger.info(f"[OK] Template file ready: main.tex ({len(main_tex_content)} chars)")
                else:
                    logger.warning("[WARN] main.tex exists but could not be decoded as text; removing from template payload")
                    template_files_dict.pop('main.tex', None)
            else:
                logger.warning(f"âš ï¸  No .tex files found in template_files_dict! Available: {list(template_files_dict.keys())}")
                template_files_dict = None

            if template_files_dict:
                logger.info(f"Template files will be passed to background task: {list(template_files_dict.keys())}")
        
        # Log attached files processing
        if reference_files_saved:
            logger.info(f"Successfully saved {len(reference_files_saved)} reference files to project directory")
            for filename in reference_files_saved:
                logger.info(f"  - {filename}")
        
        # Start background generation
        try:
            background_tasks.add_task(
                _generate_paper_background,
                paper_id,
                request,
                paper_service,
                template_files_dict,
                special_instructions,
                zotero_config,
                document_mode
            )
        except Exception as e:
            logger.error(f"Failed to start background task: {e}")
            await state.pop_paper(paper_id)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to start background task: {str(e)}"
            )
        
        return paper_response
        
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        logger.error(f"Failed to start document generation: {e}")
        await state.pop_paper(paper_id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start document generation: {str(e)}"
        )


@app.get(
    "/documents/{paper_id}",
    response_model=PaperGenerationResponse,
    summary="Get Document Status",
    description="Get the current status and progress of a document generation job"
)
@app.get(
    "/papers/{paper_id}",
    response_model=PaperGenerationResponse,
    summary="Get Document Status (Legacy Path)",
    description="Legacy compatibility endpoint for generation status"
)
async def get_paper_status(
    paper_id: str,
    request_: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """Get document generation status."""
    _require_auth_and_rate_limit(credentials, ip=(request_.client.host if request_.client else "unknown"))
    paper = await state.get_paper(paper_id)
    if paper is None:
        raise PaperNotFoundError(f"Document job {paper_id} not found")
    
    # Log paper data availability for debugging
    logger.info(f"Getting paper status for {paper_id}: status={paper.status}, has_paper_data={hasattr(paper, 'paper_data') and paper.paper_data is not None}")
    if hasattr(paper, 'paper_data') and paper.paper_data:
        logger.info(f"Paper data type: {type(paper.paper_data)}, is_dict={isinstance(paper.paper_data, dict)}")
        if isinstance(paper.paper_data, dict):
            logger.info(f"Paper data keys: {list(paper.paper_data.keys())}")
    
    return paper


@app.get(
    "/documents/{paper_id}/progress-stream",
    summary="Stream Document Progress (SSE)",
    description="Server-Sent Events stream for real-time document generation progress updates"
)
@app.get(
    "/papers/{paper_id}/progress-stream",
    summary="Stream Document Progress (Legacy Path)",
    description="Legacy compatibility endpoint for real-time generation updates"
)
async def stream_paper_progress(
    paper_id: str,
    request_: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """Stream document generation progress updates via SSE."""
    _require_auth_and_rate_limit(credentials, ip=(request_.client.host if request_.client else "unknown"))
    paper = await state.get_paper(paper_id)
    if paper is None:
        raise PaperNotFoundError(f"Document job {paper_id} not found")

    async def event_generator():
        """Generate SSE events for paper progress. Sends keepalive so proxies/browsers don't close the stream during long phases."""
        import json
        last_progress = -1
        last_phase = None
        last_message = None
        last_keepalive = 0.0  # time of last keepalive

        try:
            while True:
                if not await state.contains_paper(paper_id):
                    # Paper was deleted, end stream
                    yield f"event: end\ndata: {json.dumps({'reason': 'paper_deleted'})}\n\n"
                    break

                paper = await state.get_paper(paper_id)
                if paper is None:
                    yield f"event: end\ndata: {json.dumps({'reason': 'paper_deleted'})}\n\n"
                    break

                # Check if there are updates
                current_progress = paper.progress
                current_phase = paper.phase.value if hasattr(paper.phase, 'value') else str(paper.phase)
                # Get message - handle both attribute access and Pydantic model field access
                current_message = getattr(paper, 'message', None)
                if current_message is None and hasattr(paper, '__dict__'):
                    current_message = paper.__dict__.get('message', None)
                if current_message is None:
                    # Try accessing as Pydantic model field
                    try:
                        current_message = paper.message if hasattr(paper, 'message') else None
                    except (AttributeError, TypeError) as e:
                        logger.debug(f"Could not access paper.message: {e}")
                        current_message = None

                if (current_progress != last_progress or
                    current_phase != last_phase or
                    current_message != last_message):

                    # Send update
                    event_data = {
                        'paper_id': paper_id,
                        'status': paper.status.value if hasattr(paper.status, 'value') else str(paper.status),
                        'phase': current_phase,
                        'progress': current_progress,
                        'message': current_message,
                        'updated_at': paper.updated_at.isoformat() if hasattr(paper.updated_at, 'isoformat') else str(paper.updated_at)
                    }

                    # Add error if present
                    if hasattr(paper, 'error_message') and paper.error_message:
                        event_data['error'] = paper.error_message

                    yield f"event: progress\ndata: {json.dumps(event_data)}\n\n"

                    last_progress = current_progress
                    last_phase = current_phase
                    last_message = current_message
                    last_keepalive = time.monotonic()

                # Check if generation is complete or failed
                if paper.status in [PaperStatus.COMPLETED, PaperStatus.FAILED]:
                    # Send final progress update before completion
                    final_event_data = {
                        'paper_id': paper_id,
                        'status': paper.status.value if hasattr(paper.status, 'value') else str(paper.status),
                        'phase': paper.phase.value if hasattr(paper.phase, 'value') else str(paper.phase),
                        'progress': paper.progress,
                        'message': getattr(paper, 'message', None) or "Document generation completed",
                        'updated_at': paper.updated_at.isoformat() if hasattr(paper.updated_at, 'isoformat') else str(paper.updated_at)
                    }
                    yield f"event: progress\ndata: {json.dumps(final_event_data)}\n\n"
                    
                    # Then send completion event
                    yield f"event: complete\ndata: {json.dumps({'status': paper.status.value if hasattr(paper.status, 'value') else str(paper.status), 'paper_id': paper_id})}\n\n"
                    break

                # Send SSE keepalive every 15s so proxies/browsers don't close the connection during long writing phases
                now = time.monotonic()
                if now - last_keepalive >= 15.0:
                    yield ": keepalive\n\n"
                    last_keepalive = now

                # Wait before checking again (1 second interval)
                await asyncio.sleep(1)

        except Exception as e:
            logger.error(f"Error in SSE stream for paper {paper_id}: {e}")
            yield f"event: error\ndata: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"  # Disable nginx buffering
        }
    )


@app.get(
    "/documents",
    response_model=List[PaperGenerationResponse],
    summary="List Document Jobs",
    description="Get a list of generation jobs (active and completed)"
)
@app.get(
    "/papers",
    response_model=List[PaperGenerationResponse],
    summary="List Document Jobs (Legacy Path)",
    description="Legacy compatibility endpoint for listing generation jobs"
)
async def list_papers(
    status_filter: Optional[PaperStatus] = None,
    limit: int = 50,
    offset: int = 0
):
    """List generation jobs with optional filtering."""
    papers = await state.list_papers()
    
    if status_filter:
        papers = [p for p in papers if p.status == status_filter]
    
    # Sort by creation date (newest first)
    papers.sort(key=lambda p: p.created_at, reverse=True)
    
    return papers[offset:offset + limit]


@app.delete(
    "/documents/{paper_id}",
    summary="Cancel Document Generation",
    description="Cancel an ongoing document generation"
)
@app.delete(
    "/papers/{paper_id}",
    summary="Cancel Document Generation (Legacy Path)",
    description="Legacy compatibility endpoint for cancellation"
)
async def cancel_paper(paper_id: str, request_: Request, credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """Cancel document generation."""
    _require_auth_and_rate_limit(credentials, ip=(request_.client.host if request_.client else "unknown"))
    paper = await state.get_paper(paper_id)
    if paper is None:
        raise PaperNotFoundError(f"Document job {paper_id} not found")
    if paper.status == PaperStatus.IN_PROGRESS:
        paper.status = PaperStatus.CANCELLED
        paper.updated_at = datetime.now()
        return {"message": f"Document job {paper_id} cancelled successfully"}
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Document job {paper_id} cannot be cancelled (status: {paper.status})"
        )


@app.get(
    "/documents/{paper_id}/download/{file_type}",
    summary="Download Document Files",
    description="Download generated document files (LaTeX, PDF, etc.)"
)
@app.get(
    "/papers/{paper_id}/download/{file_type}",
    summary="Download Document Files (Legacy Path)",
    description="Legacy compatibility endpoint for file download"
)
async def download_paper_file(
    paper_id: str,
    file_type: str,
    request_: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """Download generated document files."""
    _require_auth_and_rate_limit(credentials, ip=(request_.client.host if request_.client else "unknown"))
    paper = await state.get_paper(paper_id)
    if paper is None:
        raise PaperNotFoundError(f"Document job {paper_id} not found")
    
    # Check if files exist regardless of status
    if not paper.output_files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Document job {paper_id} has no output files yet (status: {paper.status})"
        )
    
    # Allow download if files exist, even if status is not completed
    if paper.status in [PaperStatus.FAILED, "failed"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Document generation failed for job {paper_id}"
        )
    
    if file_type not in paper.output_files:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File type {file_type} not found for document job {paper_id}"
        )
    
    file_path = paper.output_files[file_type]
    if not Path(file_path).exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"File {file_path} not found on disk"
        )
    
    return FileResponse(
        path=file_path,
        filename=f"{paper_id}_{file_type}",
        media_type="application/octet-stream"
    )


@app.get(
    "/documents/{paper_id}/download-all",
    summary="Download All Document Files",
    description="Download all generated document files as a ZIP archive"
)
@app.get(
    "/papers/{paper_id}/download-all",
    summary="Download All Document Files (Legacy Path)",
    description="Legacy compatibility endpoint for archive download"
)
async def download_paper_folder(
    paper_id: str,
    request_: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """Download all generated document files as a ZIP archive."""
    _require_auth_and_rate_limit(credentials, ip=(request_.client.host if request_.client else "unknown"))
    paper = await state.get_paper(paper_id)
    if paper is None:
        raise PaperNotFoundError(f"Document job {paper_id} not found")
    
    # Check if files exist regardless of status
    if not paper.output_files:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Document job {paper_id} has no output files yet (status: {paper.status})"
        )
    
    # Allow download if files exist, even if status is not completed
    if paper.status in [PaperStatus.FAILED, "failed"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Document generation failed for job {paper_id}"
        )
    
    # Get the output directory from the first file path
    if not paper.output_files:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"No output files found for document job {paper_id}"
        )
    
    # Extract output directory from first file (resolve to absolute path for reliability)
    first_file_path = Path(list(paper.output_files.values())[0]).resolve()
    output_dir = first_file_path.parent
    
    if not output_dir.exists():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Output directory not found: {output_dir}"
        )
    
    # Create temporary ZIP file - include all files including images/ subfolder
    images_dir = output_dir / "images"
    with tempfile.NamedTemporaryFile(delete=False, suffix='.zip') as temp_zip:
        temp_zip_path = temp_zip.name
        with zipfile.ZipFile(temp_zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            added_count = 0
            # Add all files from output_dir (rglob gets everything recursively, including images/)
            for file_path in output_dir.rglob('*'):
                if file_path.is_file():
                    arcname = file_path.relative_to(output_dir)
                    arcname_str = str(arcname).replace('\\', '/')  # Forward slashes in ZIP for cross-platform
                    zipf.write(file_path, arcname_str)
                    added_count += 1
            logger.info(f"ZIP created for paper {paper_id}: {added_count} files from {output_dir}, images/ included: {images_dir.exists()}")

        # Schedule cleanup of temp file after response is sent
        async def cleanup_temp_file():
            await asyncio.sleep(60)  # Wait 60 seconds for download to complete
            try:
                os.unlink(temp_zip_path)
                logger.debug(f"Cleaned up temp file: {temp_zip_path}")
            except Exception as e:
                logger.warning(f"Failed to cleanup temp file {temp_zip_path}: {e}")

        asyncio.create_task(cleanup_temp_file())

        # Return the ZIP file
        return FileResponse(
            path=temp_zip_path,
            filename=f"{paper_id}_complete.zip",
            media_type="application/zip"
    )


@app.get(
    "/documents/{paper_id}/content",
    summary="Get Document Content",
    description="Get the LaTeX content of a generation result as text"
)
@app.get(
    "/papers/{paper_id}/content",
    summary="Get Document Content (Legacy Path)",
    description="Legacy compatibility endpoint for content retrieval"
)
async def get_paper_content(
    paper_id: str,
    request_: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """Get generated LaTeX content."""
    _require_auth_and_rate_limit(credentials, ip=(request_.client.host if request_.client else "unknown"))
    paper = await state.get_paper(paper_id)
    if paper is None:
        raise PaperNotFoundError(f"Document job {paper_id} not found")
    
    # If not completed, return status
    if paper.status != PaperStatus.COMPLETED:
        return {
            "status": paper.status,
            "progress": paper.progress,
            "phase": paper.phase,
            "message": "Document generation not complete yet"
        }
    
    # Try to read LaTeX file
    if paper.output_files and paper.output_files.get("latex"):
        latex_file_path = paper.output_files["latex"]
        try:
            if os.path.exists(latex_file_path):
                with open(latex_file_path, 'r', encoding='utf-8') as f:
                    latex_content = f.read()
                # Remove any markdown code blocks that might have been introduced
                import re
                # Remove opening code fence (```latex, ```tex, ``` at start)
                latex_content = re.sub(r'^```(?:latex|tex)?\s*\n', '', latex_content, flags=re.MULTILINE)
                # Remove closing code fence (``` at end)
                latex_content = re.sub(r'\n```\s*$', '', latex_content, flags=re.MULTILINE)
                # Remove any remaining code fences in the middle
                latex_content = re.sub(r'```(?:latex|tex)?\s*\n', '', latex_content)
                latex_content = re.sub(r'\n```', '', latex_content)
                # Also handle triple single quotes ('''latex)
                latex_content = re.sub(r"^'''(?:latex|tex)?\s*\n", '', latex_content, flags=re.MULTILINE)
                latex_content = re.sub(r"\n'''\s*$", '', latex_content, flags=re.MULTILINE)
                latex_content = re.sub(r"'''(?:latex|tex)?\s*\n", '', latex_content)
                latex_content = re.sub(r"\n'''", '', latex_content)
                latex_content = latex_content.strip()
                return {
                    "status": "completed",
                    "content": latex_content,
                    "content_type": "latex"
                }
        except Exception as e:
            logger.error(f"Failed to read LaTeX file: {e}")
    
    # Fallback: return paper data
    if paper.paper_data:
        return {
            "status": "completed",
            "content": paper.paper_data,
            "content_type": "paper_data"
        }
    
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"No content available for document job {paper_id}"
    )


async def _generate_paper_background(
    paper_id: str,
    request: PaperGenerationRequest,
    paper_service: PaperService,
    template_files: Optional[Dict[str, str]] = None,
    special_instructions: Optional[str] = None,
    zotero_config: Optional[Dict[str, Any]] = None,
    document_mode: bool = False
):
    """Background task for paper generation"""
    result = None
    try:
        paper = await state.get_paper(paper_id)
        if paper is None:
            logger.error(f"Paper {paper_id} not found at start of background generation")
            return
        paper.status = PaperStatus.IN_PROGRESS
        paper.message = "Starting paper generation..."  # Set initial message
        paper.updated_at = datetime.now()

        if DEBUG_MODE:
            # Use fake API for testing
            logger.info(f"DEBUG MODE: Using fake API for paper {paper_id}")
            await simulate_paper_generation(paper_id, request)
        else:
            # UNIFIED PIPELINE: All generation goes through the full pipeline
            # Research files are now INTEGRATED into the pipeline (not a separate path)
            if template_files:
                logger.info(f"Passing {len(template_files)} template files to paper service")
            if special_instructions:
                logger.info(f"Passing special instructions to paper service: {special_instructions[:100]}...")
            if zotero_config:
                logger.info("Passing Zotero config to paper generation pipeline")
            if document_mode:
                logger.info("[DOCUMENT MODE] Prompt/files generation enabled")

            result = await paper_service.generate_paper(
                request,
                template_files=template_files,
                special_instructions=special_instructions,
                paper_id=paper_id,
                zotero_config=zotero_config,
                document_mode=document_mode
            )

            # Update paper with results immediately to preserve data even if later steps fail
            if result and result.paper_data:
                # Convert Pydantic model to dict for storage
                if hasattr(result.paper_data, 'model_dump'):
                    paper.paper_data = result.paper_data.model_dump()
                elif hasattr(result.paper_data, 'dict'):
                    paper.paper_data = result.paper_data.dict()
                else:
                    paper.paper_data = result.paper_data
                logger.info(f"Paper data set for {paper_id}")
                logger.info(f"Paper data type: {type(paper.paper_data)}, keys: {list(paper.paper_data.keys()) if isinstance(paper.paper_data, dict) else 'not a dict'}")

            if result and result.output_files:
                paper.output_files = result.output_files
        
        # Mark as completed
        paper.status = PaperStatus.COMPLETED
        paper.phase = PaperPhase.COMPLETE
        paper.progress = 100.0
        paper.message = getattr(result, "message", None) or "Document generation completed successfully!"
        paper.updated_at = datetime.now()
        
        logger.info(f"Paper {paper_id} generated successfully")
        logger.info(f"Paper status: {paper.status}, Phase: {paper.phase}, Progress: {paper.progress}")
        logger.info(f"Paper has paper_data: {hasattr(paper, 'paper_data') and paper.paper_data is not None}")
        logger.info(f"Paper has output_files: {hasattr(paper, 'output_files') and paper.output_files is not None}")
        if hasattr(paper, 'output_files') and paper.output_files:
            logger.info(f"Output files: {list(paper.output_files.keys())}")
        
    except Exception as e:
        import traceback
        error_traceback = traceback.format_exc()
        logger.error(f"Document generation failed for {paper_id}: {e}")
        logger.error(f"Full traceback:\n{error_traceback}")

        # Safely get paper - it might have been deleted
        paper = await state.get_paper(paper_id)
        if paper is None:
            logger.warning(f"Paper {paper_id} not found in active_papers during error handling - may have been cleaned up")
            return

        # If we have partial paper data, mark as completed with warning instead of failed
        # This prevents UI from showing "Failed" when paper was mostly generated
        if hasattr(paper, 'paper_data') and paper.paper_data:
            logger.warning(f"Paper {paper_id} has partial data - marking as completed with warning")
            paper.status = PaperStatus.COMPLETED
            paper.phase = PaperPhase.COMPLETE
            paper.progress = 95.0  # Almost complete
            paper.error_message = f"Generation completed with warnings: {str(e)[:200]}"
            paper.message = paper.error_message
        else:
            paper.status = PaperStatus.FAILED
            paper.error_message = str(e)[:500]  # Limit error message length
            paper.message = paper.error_message
        
        paper.updated_at = datetime.now()


# Memory system endpoints removed


# GenLaTeX-Agent API Endpoints
@app.post(
    "/api/genlatex-agent/make-paper",
    response_model=MakePaperResponse,
    summary="Make Paper",
    description="Generate a research paper based on user prompt using AI. Returns paper_id for status tracking."
)
async def make_paper(
    request: GenLatexAgentRequest,
    background_tasks: BackgroundTasks = BackgroundTasks(),
    request_: Request = None,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """
    Generate a research paper by extracting topic and description from prompt.
    Starts generation in background and returns immediately with document_id (paper_id).
    Frontend should poll GET /documents/{document_id} to check status.
    """
    try:
        _require_auth_and_rate_limit(credentials, ip=(request_.client.host if request_ and request_.client else "unknown"))
        # Extract parameters from prompt using AI
        llm = _get_llm()
        
        project_id = request.context.projectId if request.context and request.context.projectId else "genlatex-agent"
        
        extraction_prompt = f"""Extract the following information from this prompt for paper generation:

Prompt: {request.prompt}
{"Existing Content: " + request.content[:500] if request.content else ""}

Extract and return a JSON object with:
- topic: A clear, concise research topic (5-20 words)
- description: A detailed description of what to research (50-200 words)

CRITICAL INSTRUCTIONS:
1. DO NOT over-correlate topic and description - they may refer to different aspects or the user may have made a typo
2. If there's ambiguity or apparent contradiction (e.g., "fault" in one sentence, "inflation" in another):
   - Use logical reasoning to determine the user's ACTUAL intent
   - Look for the MAIN theme or most detailed/coherent part of the request
   - Speculate intelligently based on context clues
   - DO NOT ask for clarification - make your best logical inference
3. If information is missing, provide reasonable defaults:
   - topic: Extract the main theme from the prompt or use "Research Analysis"
   - description: Expand on the prompt to create a comprehensive research description

Return ONLY valid JSON in this exact format:
{{
  "topic": "...",
  "description": "..."
}}"""

        # Call LLM to extract parameters
        response = await llm.ainvoke(extraction_prompt)
        content = response.content.strip()
        
        # Parse JSON response
        # Extract JSON from markdown code blocks if present
        if "```json" in content:
            content = content.split("```json")[1].split("```")[0].strip()
        elif "```" in content:
            content = content.split("```")[1].split("```")[0].strip()
        
        import json
        extraction_result = json.loads(content)
        
        topic = extraction_result.get("topic", "Research Analysis")
        description = extraction_result.get("description", request.prompt)

        # Extract fast_mode from request (can be in prompt or explicit)
        fast_mode = request.fast_mode
        # Also check if prompt mentions fast mode
        if not fast_mode and ("fast" in request.prompt.lower() or "quick" in request.prompt.lower()):
            fast_mode = True
        
        # Create paper generation request
        paper_request = PaperGenerationRequest(
            topic=topic,
            description=description,
            output_dir="./output",
            project_id=project_id,
            fast_mode=fast_mode
        )
        
        # Get paper service
        paper_service = get_paper_service()
        
        # Generate unique paper ID
        global paper_counter
        paper_counter += 1
        paper_id = f"paper_{paper_counter}_{uuid.uuid4().hex[:8]}"
        
        # Create initial paper response
        paper_response = PaperGenerationResponse(
            paper_id=paper_id,
            status=PaperStatus.PENDING,
            phase=PaperPhase.PLAN,
            progress=0.0,
            message="Initializing document generation...",  # Initialize message field
            created_at=datetime.now(),
            updated_at=datetime.now()
        )
        
        # Evict oldest completed/failed if at cap, then store
        await state.evict_oldest_completed_if_over(PAPER_MAX_ACTIVE)
        # Store in active papers
        await state.set_paper(paper_id, paper_response)
        
        # Start background generation (reuses same background task as regular paper generation)
        background_tasks.add_task(
            _generate_paper_background,
            paper_id,
            paper_request,
            paper_service
        )
        
        # Return immediately with paper_id for status tracking
        return MakePaperResponse(
            success=True,
            result=f"Document generation started. Use document_id to check status at GET /documents/{paper_id}",
            paper_id=paper_id,
            citations=[]
        )
        
    except Exception as e:
        logger.error(f"Failed to start document generation: {e}")
        return MakePaperResponse(
            success=False,
            result="",
            error=str(e)
        )


@app.post(
    "/api/chat",
    summary="Unified Chat",
    description="Unified chat endpoint for all AI interactions. Supports streaming via SSE."
)
async def chat(
    request: ChatRequest,
    request_: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """
    Unified chat endpoint that handles all AI interactions.
    
    Features:
    - Intent classification (fix errors, generate content, etc.)
    - Tool execution (read/write files, compile LaTeX, search web)
    - Streaming responses via Server-Sent Events
    
    Modes:
    - 'chat': Conversational responses
    - 'execute': Apply changes to files
    """
    _require_auth_and_rate_limit(credentials, ip=(request_.client.host if request_.client else "unknown"))
    
    cleanup_minio = None
    project_path_resolved = getattr(request, "project_path", None)
    try:
        # When USE_MINIO and project_path missing/remote, sync from MinIO to temp
        try:
            from utils.minio_storage import resolve_project_path
            effective_path, cleanup_minio = resolve_project_path(project_path_resolved, request.project_id)
            project_path_resolved = str(effective_path)
        except ImportError:
            pass
        except Exception as e:
            logger.warning("MinIO resolve_project_path: %s", e)
        
        # Import orchestrator
        from core.orchestrator import get_orchestrator
        orchestrator = get_orchestrator()
        
        # Chat model selection (prefer explicit chat model or fast fallback for UI responsiveness)
        chat_model = (
            os.getenv("AI_CHAT_MODEL")
            or os.getenv("GENLATEX_CHAT_MODEL")
            or os.getenv("AI_MODEL_FALLBACK")
            or os.getenv("AI_MODEL")
            or "deepseek/deepseek-chat"
        )

        logger.info(f"ðŸ¤– AI Chat | model={chat_model}")

        # Build request dict
        request_dict = {
            "message": request.message,
            "project_id": request.project_id,
            "project_path": project_path_resolved,
            "context": request.context.model_dump() if request.context else {},
            "stream": request.stream,
            "model": chat_model
        }
        
        if request.stream:
            # Streaming response using SSE
            from sse_starlette.sse import EventSourceResponse
            
            async def event_generator():
                minio_synced = False
                buffered_file_saved_events = []
                buffered_done_event = None
                try:
                    async for event in orchestrator.process_stream(request_dict):
                        if await request_.is_disconnected():
                            logger.info("Chat stream disconnected by client")
                            break

                        # In MinIO mode, file writes happen in temp workspace first.
                        # Delay file_saved/done events until after sync-back so frontend reloads fresh content.
                        if cleanup_minio:
                            if event.event == "file_saved":
                                buffered_file_saved_events.append(event)
                                continue
                            if event.event == "done":
                                buffered_done_event = event
                                try:
                                    cleanup_minio()
                                    minio_synced = True
                                except Exception as e:
                                    logger.warning("MinIO sync back failed before done event: %s", e)

                                # Emit buffered file_saved events only after sync-back.
                                for fs_event in buffered_file_saved_events:
                                    yield {
                                        "event": fs_event.event,
                                        "data": json.dumps(fs_event.data)
                                    }
                                buffered_file_saved_events = []

                                # Emit done last.
                                yield {
                                    "event": buffered_done_event.event,
                                    "data": json.dumps(buffered_done_event.data)
                                }
                                buffered_done_event = None
                                continue

                        yield {
                            "event": event.event,
                            "data": json.dumps(event.data)
                        }

                    # Stream ended without explicit done event; ensure sync and flush buffered events.
                    if cleanup_minio and not minio_synced:
                        try:
                            cleanup_minio()
                            minio_synced = True
                        except Exception as e:
                            logger.warning("MinIO sync back failed: %s", e)
                    if cleanup_minio and buffered_file_saved_events:
                        for fs_event in buffered_file_saved_events:
                            yield {
                                "event": fs_event.event,
                                "data": json.dumps(fs_event.data)
                            }
                        buffered_file_saved_events = []
                    if cleanup_minio and buffered_done_event:
                        yield {
                            "event": buffered_done_event.event,
                            "data": json.dumps(buffered_done_event.data)
                        }
                        buffered_done_event = None
                finally:
                    if cleanup_minio and not minio_synced:
                        try:
                            cleanup_minio()
                        except Exception as e:
                            logger.warning("MinIO sync back failed: %s", e)
            
            headers = {"X-Agent-Synced-MinIO": "true"} if cleanup_minio else {}
            return EventSourceResponse(event_generator(), headers=headers)
        else:
            # Non-streaming response
            try:
                result = await orchestrator.process(request_dict)
                if result is None:
                    result = {"success": False, "response": "", "code": None, "files_modified": []}
                resp_data = {
                    "success": result.get("success", True),
                    "response": result.get("response", ""),
                    "code": result.get("code"),
                    "files_modified": result.get("files_modified", [])
                }
                headers = {"X-Agent-Synced-MinIO": "true"} if cleanup_minio else {}
                return JSONResponse(content=resp_data, headers=headers)
            finally:
                if cleanup_minio:
                    try:
                        cleanup_minio()
                    except Exception as e:
                        logger.warning("MinIO sync back failed: %s", e)
            
    except Exception as e:
        err_msg = str(e)
        logger.error(f"Chat error: {err_msg}")

        # Sanitize error message for user - remove sensitive info and make it user-friendly
        user_friendly_error = _sanitize_error_for_user(err_msg)

        if request.stream:
            # For streaming, return error as SSE (capture user_friendly_error so generator can use it after except block exits)
            from sse_starlette.sse import EventSourceResponse

            async def error_generator():
                yield {
                    "event": "error",
                    "data": json.dumps({"error": user_friendly_error})
                }
                yield {
                    "event": "done",
                    "data": json.dumps({"files_modified": []})
                }

            return EventSourceResponse(error_generator())
        else:
            return ChatResponse(
                success=False,
                response="",
                error=user_friendly_error
            )


# File-based LaTeX generation endpoint
@app.post(
    "/api/generate-latex-from-files",
    summary="Generate LaTeX from Project Files",
    description="Generate LaTeX document from uploaded project files (non-AI generation mode)"
)
async def generate_latex_from_files(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)
):
    """Generate LaTeX from project files (equivalent to frontend processProjectContent).
    When USE_MINIO is set and project_path does not exist on this host, syncs from MinIO and back."""
    _require_auth_and_rate_limit(credentials, ip=(request.client.host if request.client else "unknown"))
    
    cleanup_minio = None
    try:
        body = await request.json()
        
        project_id = body.get("projectId")
        project_path = body.get("projectPath")
        project_data = body.get("projectData", {})
        metadata = body.get("metadata", {})
        template_data = body.get("templateData")
        
        if not project_path and not project_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="projectPath or projectId is required"
            )
        
        # Resolve project path: when USE_MINIO and path missing/remote, sync from MinIO to temp
        try:
            from utils.minio_storage import resolve_project_path
            effective_path, cleanup_minio = resolve_project_path(project_path, project_id)
            effective_path = Path(effective_path)
        except ImportError:
            effective_path = Path(project_path) if project_path else None
            if not effective_path or not effective_path.exists():
                if not project_path:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="projectPath is required when MinIO is not configured"
                    )
                effective_path = Path(project_path)
                effective_path.mkdir(parents=True, exist_ok=True)
        
        # Import required modules
        from utils.file_processor import FileContentProcessor
        from utils.latex import LatexGenerator
        
        # Initialize LLM
        llm = _get_llm()
        
        # Initialize file processor and LaTeX generator
        file_processor = FileContentProcessor()
        latex_generator = LatexGenerator(
            template_dir=str(Path("./templates")),
            llm=llm
        )
        
        # Set template files if provided
        if template_data and template_data.get('parsed'):
            # Convert template_data to format expected by LatexGenerator
            template_files = {}
            if template_data.get('content'):
                template_files['main.tex'] = template_data['content']
            latex_generator.set_template_files(template_files)
        
        # Set special instructions from project metadata if provided
        meta_instructions = metadata.get("specialInstructions") or metadata.get("special_instructions")
        if meta_instructions and (isinstance(meta_instructions, str) and meta_instructions.strip()):
            latex_generator.set_special_instructions(meta_instructions.strip())
        elif meta_instructions and isinstance(meta_instructions, dict) and meta_instructions.get("text"):
            latex_generator.set_special_instructions(meta_instructions["text"].strip())
        
        # Process all files in the project directory
        logger.info(f"ðŸ“Š Processing project content for LaTeX generation: {effective_path}")
        content_summary = await asyncio.to_thread(file_processor.process_directory, str(effective_path))
        
        logger.info(f"ðŸ“„ Content summary: {content_summary['processedFiles']} files processed")
        
        # Generate LaTeX document
        latex_result = await latex_generator.generate_from_project_files(
            project_data=project_data,
            content_summary=content_summary,
            project_type=metadata.get('type', 'research'),
            template_data=template_data
        )
        
        if latex_result['success']:
            logger.info("âœ… LaTeX generation successful")

            # Validate LaTeX content before writing
            latex_content = latex_result.get('latex', '')
            if not latex_content or len(latex_content.strip()) < 50:
                logger.error(f"âŒ LaTeX generation returned empty or too short content ({len(latex_content)} chars)")
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail="LaTeX generation returned empty content. Please try again."
                )

            # Save the generated LaTeX content
            output_path = effective_path
            latex_file = output_path / "main.tex"
            latex_file.write_text(latex_content, encoding='utf-8')
            
            return {
                "success": True,
                "latex": latex_result['latex'],
                "metadata": latex_result['metadata'],
                "contentSummary": {
                    "totalFiles": content_summary['totalFiles'],
                    "processedFiles": content_summary['processedFiles'],
                    "fileTypes": content_summary['fileTypes'],
                    "references": len(content_summary['references']),
                    "keyFiles": [f['name'] for f in content_summary.get('keyFiles', [])]
                },
                "message": "Project content processed and LaTeX generated successfully"
            }
        else:
            logger.error(f"âŒ LaTeX generation failed: {latex_result.get('error')}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"LaTeX generation failed: {latex_result.get('error', 'Unknown error')}"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"âŒ Error generating LaTeX from files: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate LaTeX from files: {str(e)}"
        )
    finally:
        if cleanup_minio:
            try:
                cleanup_minio()
            except Exception as e:
                logger.warning("MinIO sync back failed: %s", e)


# Root endpoint
@app.get(
    "/",
    summary="API Root",
    description="Get basic API information"
)
async def root():
    """Root endpoint with API information"""
    return {
        "name": "GenLaTeX Agent - AI Research Module",
        "version": "1.0.0",
        "description": "Core AI module for research paper generation",
        "debug_mode": DEBUG_MODE,
        "endpoints": {
            "health": "/health",
            "chat": "/api/chat",
            "documents": "/documents",
            "docs": "/docs",
            "redoc": "/redoc",
            "genlatex_agent": {
                "make_paper": "/api/genlatex-agent/make-paper"
            }
        },
        "active_papers": len([p for p in await state.list_papers() if p.status == PaperStatus.IN_PROGRESS])
    }


if __name__ == "__main__":
    # Run the application
    uvicorn.run(
        "api.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )

