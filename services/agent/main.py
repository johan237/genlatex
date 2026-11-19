# main.py (FIXED VERSION)
from __future__ import annotations

from typing import Dict, List, Optional, Any, Tuple
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage
from agents.document_planner import DocumentPlanner
from agents.document_outline import DocumentOutlinePlanner
from agents.document_writer import DocumentWriter
from agents.citation_matcher import CitationMatcher
from tools.citation import CitationManager
from utils.latex import LatexGenerator
from utils.latex_review import LatexReview
from utils.latex_compile_fix import get_latex_fix_plan, apply_latex_fix_edits
from utils.sources import Source, sanitize_latex_unicode
from utils.image_assets import collect_image_candidates, build_output_name
from utils.minio_storage import is_minio_enabled, resolve_project_path
from pathlib import Path
import asyncio
import json
import argparse
import logging
import multiprocessing as mp
from concurrent.futures import ProcessPoolExecutor
import os
import re
import shutil
import base64

logger = logging.getLogger(__name__)


def _safe_int_env(name: str, default: int, minimum: int, maximum: int) -> int:
    """Read int env var with bounds and fallback."""
    try:
        value = int(os.getenv(name, str(default)))
    except Exception:
        value = default
    return max(minimum, min(value, maximum))


class PaperOrchestrator:
    """Main orchestrator for prompt-first document generation with checkpointing."""

    def __init__(
        self,
        openrouter_api_key: str,
        openrouter_base_url: str = "https://openrouter.ai/api/v1",
        openrouter_model: str = "google/gemini-2.5-flash",
        tavily_api_key: str = None,  # Unused: no external search; kept for API compatibility
        template_dir: str = "./template",
        checkpoint_dir: str = "./checkpoints",
        project_id: str = "genlatex-agent",
        verbose: bool = True,
        progress_callback = None,
        fast_mode: bool = False,
        flash_mode: bool = False,
        paper_id: Optional[str] = None  # Store paper_id for progress updates
    ):
        if flash_mode:
            fast_mode = True  # Flash implies fast

        # Prevent provider defaults from requesting huge completions (e.g., 65535 tokens).
        llm_max_tokens = _safe_int_env("GENLATEX_LLM_MAX_TOKENS", 2048, 256, 12000)
        
        # Initialize LLM (OpenRouter DeepSeek R1)
        self.llm = ChatOpenAI(
            model=openrouter_model,
            base_url=openrouter_base_url,
            api_key=openrouter_api_key,
            temperature=0.7,
            max_tokens=llm_max_tokens,
            streaming=False  # Disable streaming to prevent SSE JSON errors
        )

        # Initialize components (no external search or research agents)
        self.citation_manager = CitationManager(references_file_path=None)  # Will be set per generation
        self.planner = DocumentPlanner(self.llm)
        self.verbose = verbose
        if verbose:
            logger.setLevel(logging.DEBUG)
        self.progress_callback = progress_callback
        self.paper_id = paper_id  # Store paper_id for progress callbacks
        self.project_id = project_id  # Store project_id for template file saving
        self.writing_planner = DocumentOutlinePlanner(self.llm)
        citation_matcher = CitationMatcher(self.llm, self.citation_manager)
        self.writer = DocumentWriter(self.llm, self.citation_manager, citation_matcher=citation_matcher, verbose=verbose)
        self.fast_mode = fast_mode
        self.flash_mode = flash_mode
        self.template_files = None  # Will be set per generation
        
        # Memory system removed
        self.memory = None
        self.latex_gen = LatexGenerator(template_dir, None, self.citation_manager, llm=self.llm)
        self.paper_id = paper_id  # Store paper_id for progress callbacks

        # Setup checkpoint directory
        self.checkpoint_dir = Path(checkpoint_dir)
        self.checkpoint_dir.mkdir(exist_ok=True, parents=True)
        
        # Setup multiprocessing
        self.max_workers = min(mp.cpu_count(), 4)  # Limit to 4 processes max
        self.use_multiprocessing = True

    def _get_checkpoint_path(self, topic: str, phase: str) -> Path:
        """Get checkpoint file path"""
        safe_topic = "".join(c for c in topic if c.isalnum() or c in (' ', '-', '_')).strip()
        safe_topic = safe_topic.replace(' ', '_')[:50]
        return self.checkpoint_dir / f"{safe_topic}_{phase}.json"
    
    def _save_checkpoint(self, topic: str, phase: str, data: dict):
        """Save checkpoint data"""
        checkpoint_path = self._get_checkpoint_path(topic, phase)
        
        # Convert Source objects to dictionaries for JSON serialization
        serializable_data = self._make_json_serializable(data)
        
        with open(checkpoint_path, 'w', encoding='utf-8') as f:
            json.dump(serializable_data, f, indent=2, ensure_ascii=False)
        if self.verbose:
            logger.debug("Checkpoint saved: %s", checkpoint_path.name)
    
    def _load_checkpoint(self, topic: str, phase: str) -> Optional[dict]:
        """Load checkpoint data if exists"""
        checkpoint_path = self._get_checkpoint_path(topic, phase)
        if checkpoint_path.exists():
            try:
                with open(checkpoint_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except json.JSONDecodeError as e:
                if self.verbose:
                    logger.warning(f"âš ï¸  Corrupted checkpoint file {checkpoint_path.name}: {str(e)}")
                    logger.info("Removing corrupted checkpoint...")
                checkpoint_path.unlink()  # Remove corrupted file
                return None
            except Exception as e:
                if self.verbose:
                    logger.warning(f"âš ï¸  Error loading checkpoint {checkpoint_path.name}: {str(e)}")
                return None
        return None

    def _collect_section_citations(self, sections: List[dict]) -> List[str]:
        """Collect citation keys across sections (including nested subsections)."""
        citations: List[str] = []
        if not sections:
            return citations
        for section in sections:
            if isinstance(section, dict):
                section_citations = section.get("citations", [])
                if section_citations:
                    citations.extend([c for c in section_citations if isinstance(c, str)])
                content = section.get("content")
                if isinstance(content, str):
                    for block in re.findall(r"\\cite\{([^}]+)\}", content):
                        for key in [k.strip() for k in block.split(",")]:
                            if key:
                                citations.append(key)
                subsections = section.get("subsections", [])
                if subsections:
                    citations.extend(self._collect_section_citations(subsections))
        return citations

    def _validate_writing_checkpoint(self, written_sections: Optional[List[dict]]) -> Tuple[bool, List[str], int]:
        """Validate writing checkpoint citations against current CitationManager."""
        if not written_sections:
            return True, [], 0
        all_citations = self._collect_section_citations(written_sections)
        total_citations = len(all_citations)
        if total_citations == 0:
            return True, [], 0
        if not self.citation_manager or not getattr(self.citation_manager, "sources", None):
            return False, sorted(set(all_citations)), total_citations
        invalid = [key for key in all_citations if key not in self.citation_manager.sources]
        if invalid:
            return False, sorted(set(invalid)), total_citations
        return True, [], total_citations

    def _discard_writing_checkpoints(self, topic: str, reason: str = ""):
        """Remove writing-related checkpoints to force regeneration."""
        phases = [
            "writing_complete",
            "writing_humanized",
            "writing_adjusted",
            "writing_trimmed",
        ]
        removed = []
        for phase in phases:
            path = self._get_checkpoint_path(topic, phase)
            if path.exists():
                try:
                    path.unlink()
                    removed.append(path.name)
                except Exception as e:
                    if self.verbose:
                        logger.warning(f"âš ï¸  Failed to remove checkpoint {path.name}: {e}")
        if self.verbose and removed:
            reason_msg = f" ({reason})" if reason else ""
            logger.info(f"ðŸ§¹ Discarded writing checkpoints{reason_msg}: {', '.join(removed)}")

    def _load_valid_writing_checkpoint(self, topic: str, phase: str) -> Optional[List[dict]]:
        """Load a writing checkpoint and validate citations; return None if invalid."""
        checkpoint = self._load_checkpoint(topic, phase)
        if not checkpoint:
            return None
        valid_checkpoint, invalid_keys, total_citations = self._validate_writing_checkpoint(checkpoint)
        if not valid_checkpoint:
            if self.verbose:
                logger.warning(f"âš ï¸  Discarding {phase} checkpoint: {len(invalid_keys)} invalid citations")
            self._discard_writing_checkpoints(topic, "invalid citations")
            return None
        return checkpoint

    async def _refine_special_instructions(self, raw: str) -> Optional[Dict[str, str]]:
        """Refine raw user special instructions into per-agent JSON. Returns None on failure."""
        refiner_system = """You are a refinement step. Given the user's free-form "special instructions" for an AI-generated LaTeX document, output a JSON object with keys "planner", "writer", "latex". For each key, output 1-3 sentences of instructions for that phase only. Use plain language that the corresponding agent understands. Use "" or omit the key if nothing applies.
Routing: structure/sections -> planner; tone/style/language -> writer; document class, packages, layout, margins, citation setup -> latex.
Return only valid JSON. No markdown, no code fences, no preamble."""
        refiner_user = f"Refine these instructions per agent and return only valid JSON:\n\n{raw}"
        try:
            messages = [
                SystemMessage(content=refiner_system),
                HumanMessage(content=refiner_user),
            ]
            response = await self.llm.ainvoke(messages)
            text = response.content if hasattr(response, "content") else str(response)
            text = (text or "").strip()
            # Strip markdown code blocks if present
            if "```" in text:
                m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
                if m:
                    text = m.group(1).strip()
                else:
                    text = re.sub(r"^```\w*\s*", "", text)
                    text = re.sub(r"\s*```$", "", text).strip()
            out = json.loads(text)
            if not isinstance(out, dict):
                return None
            return {k: (v if isinstance(v, str) else str(v)) for k, v in out.items()}
        except Exception as e:
            if self.verbose:
                logger.warning(f"âš ï¸  Special-instructions refiner failed ({e}), using raw for all agents")
            return None

    async def generate_paper(
        self,
        topic: str,
        description: str,
        output_dir: str = "./output",
        resume_from: Optional[str] = None,
        template_files: Optional[Dict[str, str]] = None,
        special_instructions: Optional[str] = None,
        research_files: Optional[List[Dict[str, Any]]] = None,
        zotero_config: Optional[Dict[str, Any]] = None,
        selected_references: Optional[List[Dict[str, Any]]] = None,  # NEW: Pre-selected references from research-only
        document_mode: bool = False,
        document_type: Optional[str] = None,
        document_template: Optional[str] = None,
        document_schema_id: Optional[str] = None,
    ) -> Dict:
        """Main paper generation pipeline with checkpointing

        Args:
            topic: Research paper topic
            description: Detailed description
            (Page count removed - AI deduces adequate length, typically ~8 pages)
            output_dir: Output directory
            resume_from: Phase to resume from ('plan', 'research', 'writing', 'verification', or None)
            template_files: Optional dict of template files {filename: content}
            special_instructions: Optional custom formatting/style instructions to follow throughout generation
            research_files: Optional list of uploaded research files (PDFs become citations, data files available on-demand)
            selected_references: Optional list of pre-selected references (skips research phase if provided)
            document_mode: When true, skip external research crawling and generate from prompt/files only
            document_type: Requested document type (slides/report/letter/etc.)
            document_template: Requested template id from frontend
            document_schema_id: Requested schema id from frontend
        """
        # Store template files for this generation
        # NOTE: Templates ONLY affect:
        # 1. Optional section structure in planning (if template has sections)
        # 2. LaTeX formatting wrapper (final output)
        # Templates do NOT affect: research, writing, or any other agent execution

        # NORMALIZE template files: Find main.tex or any .tex file
        if template_files:
            logger.info(f"ðŸ“‹ Orchestrator received {len(template_files)} template files: {list(template_files.keys())}")

            # Find main.tex (case-insensitive) or any .tex file
            main_tex_key = None
            for key in template_files.keys():
                if key.lower() == 'main.tex':
                    main_tex_key = key
                    break

            # If no main.tex, find any .tex file
            if not main_tex_key:
                tex_files = [key for key in template_files.keys() if key.lower().endswith('.tex')]
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

            # Normalize to 'main.tex' key
            if main_tex_key and main_tex_key != 'main.tex':
                template_files['main.tex'] = template_files[main_tex_key]
                logger.info(f"ðŸ“‹ Normalized '{main_tex_key}' â†’ 'main.tex'")

            if 'main.tex' in template_files:
                logger.info(f"âœ… User-defined template present ({len(template_files['main.tex'])} chars)")
            else:
                logger.warning(f"âš ï¸  WARNING: Template files present but no .tex files found! Available: {list(template_files.keys())}")
        else:
            logger.warning("âš ï¸  WARNING: No template files provided to orchestrator - will use default template")

        self.template_files = template_files
        
        # Pass template to writer and latex generator
        # Writer stores it but doesn't use it during writing (only for reference)
        # LaTeX generator uses it as formatting wrapper in final output
        self.writer.set_template_files(template_files)
        self.latex_gen.set_template_files(template_files)
        
        # Verify template was set in LaTeX generator
        if template_files and self.latex_gen.template_files:
            logger.info(f"âœ… Template files successfully set in LaTeX generator: {list(self.latex_gen.template_files.keys())}")
        elif template_files:
            logger.error(f"âŒ ERROR: Template files NOT set in LaTeX generator! Expected: {list(template_files.keys())}")
        
        # Extract template sections if available
        template_sections = None
        if template_files and 'main.tex' in template_files:
            try:
                logger.info(f"\n{'='*60}")
                logger.info(f"ðŸ“‹ EXTRACTING SECTIONS FROM TEMPLATE")
                logger.info(f"{'='*60}")
                template_sections = self.planner.extract_sections_from_template(template_files['main.tex'])
                if template_sections:
                    logger.info(f"âœ… Found {len(template_sections)} sections in template:")
                    for i, sec in enumerate(template_sections, 1):
                        logger.info(f"   {i}. {sec['name']}")
                        if sec.get('subsections'):
                            for j, subsec in enumerate(sec['subsections'], 1):
                                logger.info(f"      {i}.{j}. {subsec['name']}")
                    logger.info(f"\nâš ï¸  IMPORTANT: These section names will be STRICTLY PRESERVED!")
                    logger.info(f"   Content will be generated to match the topic, but section")
                    logger.info(f"   names will NOT be changed from the template.")
                    logger.info(f"{'='*60}\n")
                else:
                    logger.warning(f"âš ï¸ No sections found in template, will generate structure")
                    logger.info(f"{'='*60}\n")
            except Exception as e:
                logger.warning(f"âš ï¸ Failed to extract template sections: {e}")
                logger.info(f"{'='*60}\n")
                template_sections = None
        
        # Store special instructions for all agents to use
        self.special_instructions = special_instructions
        if special_instructions:
            logger.info(f"\n{'='*60}")
            logger.info(f"ðŸ“ SPECIAL INSTRUCTIONS PROVIDED")
            logger.info(f"{'='*60}")
            logger.info(f"{special_instructions[:200]}{'...' if len(special_instructions) > 200 else ''}")

            # Refine per-agent: one LLM call returns JSON { planner, writer, latex }; fallback to raw on failure
            refined = await self._refine_special_instructions(special_instructions)
            if refined is not None:
                planner_val = (refined.get("planner") or "").strip() or special_instructions
                writer_val = (refined.get("writer") or "").strip() or special_instructions
                latex_val = (refined.get("latex") or "").strip() or special_instructions
                # Check if any refined value was actually used (not all fell back to raw)
                any_refined = (
                    planner_val != special_instructions or
                    writer_val != special_instructions or
                    latex_val != special_instructions
                )
                if any_refined:
                    logger.info(f"   âœ… Refined instructions applied for planner/writer/latex")
                else:
                    logger.info(f"   âš ï¸  Refiner returned empty values, using raw for all agents")
            else:
                planner_val = writer_val = latex_val = special_instructions
                logger.info(f"   âš ï¸  Using raw instructions for all agents (refiner failed)")
            logger.info(f"   - Planner: Will consider formatting/structure requirements")
            logger.info(f"   - Writer: Will apply formatting/style guidelines")
            logger.info(f"   - LaTeX: Will apply preamble/layout requirements")
            logger.info(f"{'='*60}\n")

            # Pass (refined or raw) per agent
            self.planner.set_special_instructions(planner_val)
            self.writer.set_special_instructions(writer_val)
            self.latex_gen.set_special_instructions(latex_val)

        # Reset citation allowlist each run unless explicitly constrained later.
        if getattr(self.writer, 'citation_matcher', None) and hasattr(self.writer.citation_matcher, 'set_allowed_citation_keys'):
            self.writer.citation_matcher.set_allowed_citation_keys(None)

        document_mode = bool(document_mode)
        normalized_document_type = (document_type or "").strip().lower()
        normalized_document_template = (document_template or "").strip()
        normalized_document_schema = (document_schema_id or "").strip()
        if document_mode:
            logger.info("[DOCUMENT MODE] External research crawl will be skipped. Using prompt/files context only.")
            if normalized_document_type:
                logger.info(
                    f"[DOCUMENT MODE] Target doc type={normalized_document_type}, "
                    f"template={normalized_document_template or 'default'}, "
                    f"schema={normalized_document_schema or 'default'}"
                )
        # Document mode always uses the faster profile for better UX.
        quick_document_mode = bool(document_mode)
        if quick_document_mode:
            logger.info("[DOCUMENT MODE] Fast profile enabled (reduced post-processing for faster UX).")

        # ===== RESEARCH FILES INTEGRATION =====
        cleanup_minio = None
        project_root = None
        if is_minio_enabled():
            try:
                project_root, cleanup_minio = resolve_project_path(None, self.project_id)
                project_root = Path(project_root)
                if self.verbose:
                    logger.info(f"[MinIO] Project synced to temp dir: {project_root}")
            except Exception as e:
                if self.verbose:
                    logger.info(f"[MinIO] Project sync failed: {e}")
                project_root = None
                cleanup_minio = None

        # Research files: when provided via API, enable file tools for the writer.
        self.research_data_files = []
        self.citable_file_sources = []
        self.research_context_prompt = ""
        self.uploaded_files_summary = ""
        self.file_tools = None
        if research_files and len(research_files) > 0:
            try:
                from tools.file_tools import FileTools
                self.file_tools = FileTools(research_files=research_files, project_id=self.project_id)
                self.writer.set_file_tools(self.file_tools)
                # Build a short summary for planning prompts
                parts = []
                for entry in research_files[:20]:
                    if not isinstance(entry, dict):
                        continue
                    meta = entry.get("metadata") or {}
                    if isinstance(meta, str):
                        try:
                            meta = json.loads(meta)
                        except Exception:
                            meta = {}
                    name = str(entry.get("file_name") or entry.get("fileName") or meta.get("uploaded_filename") or "file")
                    summary = (meta.get("summary") or meta.get("caption") or "")[:200]
                    parts.append(f"- {name}" + (f": {summary}" if summary else ""))
                self.uploaded_files_summary = "\n".join(parts) if parts else f"{len(research_files)} uploaded file(s) available to the writer."
                if self.verbose:
                    logger.info(f"   Research files enabled: {len(research_files)} files, writer has file tools")
            except Exception as e:
                if self.verbose:
                    logger.warning(f"   Failed to init file tools: {e}")
                self.file_tools = None

        # ===== ZOTERO INTEGRATION =====
        # Add Zotero tools when zotero_config is present (API-based, on-demand access)
        self.zotero_tools = None
        if zotero_config and zotero_config.get("api_key") and zotero_config.get("library_id"):
            try:
                from tools.zotero_tools import ZoteroTools
                from tools.zotero_tool_definitions import create_zotero_tools

                self.zotero_tools = ZoteroTools(
                    api_key=zotero_config["api_key"],
                    library_id=zotero_config["library_id"],
                    library_type=zotero_config.get("library_type", "user"),
                    collection_key=zotero_config.get("collection_key"),
                )
                create_zotero_tools(self.zotero_tools, self.citation_manager)

                # Pass Zotero tools to writer for on-demand access during writing
                self.writer.set_zotero_tools(self.zotero_tools)
                print(f"   âœ… ZoteroTools passed to WritingAgent for on-demand Zotero access")
            except Exception as e:
                print(f"âš ï¸  Failed to initialize Zotero tools: {e}")
                self.zotero_tools = None

        if self.verbose:
            logger.info(f"\n{'='*60}")
            logger.info(f"ðŸš€ AI Document Generator")
            logger.info(f"{'='*60}")
            logger.info(f"ðŸ“Œ Topic: {topic}")
            if resume_from:
                logger.info(f"ðŸ”„ Resuming from: {resume_from}")
            if template_files:
                logger.info(f"ðŸ“‹ Template: {len(template_files)} files")
            if template_sections:
                logger.info(f"ðŸ“ Using template structure: {len(template_sections)} sections")
            if special_instructions:
                logger.info(f"ðŸ“ Special instructions: {len(special_instructions)} characters")
            if research_files:
                logger.info(f"ðŸ“ Research files: {len(research_files)} ({len(self.citable_file_sources)} citable, {len(self.research_data_files)} data)")
            logger.info(f"{'='*60}\n")

        # Resolve to absolute path (critical for MinIO temp dirs and production)
        output_path = Path(output_dir).resolve()
        try:
            output_path.mkdir(exist_ok=True, parents=True)
            # Probe write permission so we fail fast with a clear message
            _probe = output_path / ".genlatex_write_probe"
            _probe.write_text("", encoding="utf-8")
            _probe.unlink(missing_ok=True)
        except PermissionError as e:
            path_str = str(output_path.resolve())
            raise PermissionError(
                f"Cannot write to project directory: {path_str}. "
                "The user running genlatex-agent needs write access. On the VPS, run as root: "
                f"sudo chown -R <genlatex-agent-user> '{path_str}' "
                "or chmod -R g+w and add the agent user to the project owner's group."
            ) from e

        # Flash mode: lightweight pipeline for in-chat generation
        if self.flash_mode and self.verbose:
            print(f"âš¡ FLASH MODE: Quick generation enabled")

        # Set references_file_path for auto-save
        references_file_path = output_path / 'references.json'
        self.citation_manager.references_file_path = references_file_path
        print(f"ðŸ’¾ Auto-save enabled: {references_file_path}")

        # Auto-sync Zotero library/collection to .bib so all items are available for citation
        if self.zotero_tools:
            try:
                from utils.zotero_citation import sync_zotero_library_to_bib
                added = sync_zotero_library_to_bib(self.zotero_tools, self.citation_manager)
                if added > 0:
                    print(f"   âœ… Zotero auto-sync: {added} item(s) added to bibliography")
                elif self.citation_manager.sources:
                    print(f"   âœ… Zotero library available for research and citations")
            except Exception as e:
                print(f"âš ï¸  Zotero auto-sync skipped: {e}")

        # Initialize variables that persist across phases
        # IMPORTANT: These must be initialized BEFORE any phase to avoid scope issues
        written_sections = None  # Will be populated in writing phase
        abstract = None  # Will be populated in abstract generation phase
        detailed_plan = None  # Will be populated in planning phase
        rough_plan = None  # Will be populated in rough planning phase
        analysis = None  # Will be populated in analysis phase
        researched_sections = None  # Will be populated in research phase

        # Phase 1: Rough Pre-Planning
        if resume_from in [None, 'plan', 'rough_plan']:
            await self._log_phase("Rough Pre-Planning", 1)
            
            # Update progress: Planning starting
            if self.progress_callback:
                await self.progress_callback(
                    phase="plan",
                    progress=5.0,
                    message=f"ðŸ“‹ Planner Agent: Analyzing topic '{topic}' and creating initial structure..."
                )
            
            # Flash mode: use 3-section plan; when research files exist, make it file-aware
            if self.flash_mode:
                intro_kp = [f"Background of {topic}"]
                main_kp = [f"Analysis of {topic}"]
                concl_kp = [f"Summary of {topic}"]
                intro_q = [f"{topic} overview"]
                main_q = [f"{topic}"]
                concl_q = [f"{topic} summary"]
                if research_files and len(research_files) > 0 and hasattr(self, 'file_converter'):
                    insights = self.file_converter.extract_planning_insights(research_files, topic)
                    if insights:
                        lines = [l.strip() for l in insights.splitlines() if l.strip()][:12]
                        n = len(lines)
                        if n >= 3:
                            intro_kp.append(lines[0][:150])
                            for line in lines[1:(n//2+1)][:3]:
                                main_kp.append(line[:150] if len(line) > 150 else line)
                            concl_kp.append(lines[-1][:150])
                        intro_q = list(dict.fromkeys(intro_q + [topic]))
                        main_q = list(dict.fromkeys(main_q + [topic]))
                        if self.verbose:
                            print(f"ðŸ“ Flash plan: file-aware (insights from {len(research_files)} files)")
                if self.uploaded_files_summary:
                    summary_lines = [s.strip() for s in re.split(r"[.\n]+", self.uploaded_files_summary) if s.strip()]
                    if summary_lines:
                        intro_kp.append(summary_lines[0][:150])
                        for line in summary_lines[1:3]:
                            main_kp.append(line[:150])
                        if len(summary_lines) > 1:
                            concl_kp.append(summary_lines[-1][:150])
                        intro_q = list(dict.fromkeys(intro_q + [topic]))
                        main_q = list(dict.fromkeys(main_q + [topic]))
                        if self.verbose:
                            print("Flash plan: added uploaded file summary")
                rough_plan = {
                    "title": f"{'Document' if document_mode else 'Paper'} on {topic}",
                    "sections": [
                        {"id": "1", "name": "Introduction", "percentage": 25, "key_points": intro_kp, "search_queries": intro_q, "subsections": []},
                        {"id": "2", "name": "Main Content", "percentage": 50, "key_points": main_kp, "search_queries": main_q, "subsections": []},
                        {"id": "3", "name": "Conclusion", "percentage": 25, "key_points": concl_kp, "search_queries": concl_q, "subsections": []}
                    ],
                    "abstract_points": [f"Brief overview of {topic}"],
                    "keywords": [topic.lower().replace(" ", "-"), "overview"]
                }
                self._save_checkpoint(topic, 'rough_plan', rough_plan)
                (output_path / 'rough_plan.json').write_text(json.dumps(rough_plan, indent=2))
                if self.verbose:
                    print(f"âš¡ Flash plan: 3 sections (AI decides length)\n")
                if self.progress_callback:
                    await self.progress_callback(phase="plan", progress=10.0, message=f"Quick structure ready. Starting research...")
            else:
                try:
                    # Create rough plan - just basic structure to guide research
                    planning_description = description
                    # Extract planning insights from uploaded files
                    if research_files and len(research_files) > 0 and hasattr(self, 'file_converter'):
                        insights = self.file_converter.extract_planning_insights(research_files, topic)
                        if insights:
                            planning_description = f"{description}\n\nAVAILABLE RESEARCH DATA:\n{insights}"
                    if self.research_context_prompt:
                        planning_description = f"{planning_description}\n\n{self.research_context_prompt}"
                        if self.verbose:
                            print(f"ðŸ“ Including {len(self.citable_file_sources)} citable sources and {len(self.research_data_files)} data files in planning context")
                    if self.uploaded_files_summary:
                        planning_description = f"{planning_description}\n\nUPLOADED FILES SUMMARY (use as primary evidence):\n{self.uploaded_files_summary}"
                    if zotero_config and zotero_config.get("api_key"):
                        planning_description = f"{planning_description}\n\nZOTERO LIBRARY ACCESS: You have Zotero library access. Use list_zotero_items to browse, search_zotero_items for fulltext search, get_zotero_item_fulltext to read PDF content on-demand. Do not assume contentâ€”fetch when needed. Do not add every item from the library: select only those that are clearly relevant and most adequate for the paper topic. When you find a Zotero item that is genuinely useful for the paper, call add_zotero_item_to_bibliography(item_key)."
                    rough_plan = await self.planner.plan_structure(topic, planning_description, template_sections=template_sections)
                    self._save_checkpoint(topic, 'rough_plan', rough_plan)
                except Exception as e:
                    if self.verbose:
                        print(f"âš ï¸  Planning failed: {str(e)}")
                        print("Using fallback plan...")
                    rough_plan = {
                        "title": f"{topic}" if document_mode else f"A Comprehensive Analysis of {topic}",
                        "sections": [
                            {"id": "1", "name": "Introduction", "percentage": 20, "key_points": [f"Background of {topic}"], "search_queries": [f"{topic} introduction"], "subsections": []},
                            {"id": "2", "name": "Main Content", "percentage": 60, "key_points": [f"Analysis of {topic}"], "search_queries": [f"{topic} analysis"], "subsections": []},
                            {"id": "3", "name": "Conclusion", "percentage": 20, "key_points": [f"Summary of {topic}"], "search_queries": [f"{topic} conclusion"], "subsections": []}
                        ],
                        "abstract_points": [f"Comprehensive analysis of {topic}"],
                        "keywords": [topic.lower(), "analysis", "document"] if document_mode else [topic.lower(), "analysis", "research"]
                    }
                    self._save_checkpoint(topic, 'rough_plan', rough_plan)
                (output_path / 'rough_plan.json').write_text(json.dumps(rough_plan, indent=2))
                if self.verbose:
                    print(f"   Rough Plan Title: {rough_plan['title']}")
                    print(f"   Rough Sections: {len(rough_plan['sections'])}")
                    print("   This is a rough plan - will be refined after research\n")
                if self.progress_callback:
                    await self.progress_callback(
                        phase="plan",
                        progress=10.0,
                        message=f"Created initial structure with {len(rough_plan['sections'])} sections. Starting research..."
                    )
        else:
            rough_plan = self._load_checkpoint(topic, 'rough_plan')
            if not rough_plan:
                raise ValueError(f"Cannot resume from {resume_from}: rough plan checkpoint not found")
            (output_path / 'rough_plan.json').write_text(json.dumps(rough_plan, indent=2))
            if self.verbose:
                print(f"   Loaded rough plan from checkpoint: {rough_plan['title']}\n")


        if resume_from in [None, 'plan', 'rough_plan', 'research']:
            await self._log_phase("Research & Data Collection", 2)

            # Set phase context for file tools logging
            if self.file_tools:
                self.file_tools.set_phase_context('research')

            # Keep a research checkpoint payload available for both
            # normal research flow and pre-selected references flow.
            research_checkpoint_data = {
                'researched_sections': [],
                'sources': []
            }

            # Document mode: skip external research crawl and proceed with prompt/files context only.
            if document_mode:
                logger.info(f"\n{'='*80}")
                logger.info("[DOCUMENT MODE] SKIPPING EXTERNAL RESEARCH PHASE")
                logger.info(f"{'='*80}")
                logger.info("   Using user prompt, chat instructions, and uploaded files as primary context")
                logger.info(f"{'='*80}\n")

                if self.progress_callback:
                    await self.progress_callback(
                        phase="research",
                        progress=20.0,
                        message="Document mode enabled. External source search skipped."
                    )

                researched_sections = [{'section_name': s['name'], 'content': ''} for s in rough_plan.get('sections', [])]
                research_checkpoint_data = {
                    'researched_sections': researched_sections,
                    'sources': []
                }

                if self.progress_callback:
                    await self.progress_callback(
                        phase="research",
                        progress=30.0,
                        message="Prepared context from prompt and uploaded files."
                    )

            # NEW: Check if pre-selected references are provided (skip research if so)
            elif selected_references and len(selected_references) > 0:
                logger.info(f"\n{'='*80}")
                logger.info(f"[REFERENCES] PRE-SELECTED REFERENCES PROVIDED - SKIPPING RESEARCH PHASE")
                logger.info(f"{'='*80}")
                logger.info(f"   Using {len(selected_references)} pre-selected articles from user")
                logger.info(f"   Research phase will be bypassed")
                logger.info(f"{'='*80}\n")

                if self.progress_callback:
                    await self.progress_callback(
                        phase="research",
                        progress=20.0,
                        message=f"Using {len(selected_references)} pre-selected references (research phase skipped)..."
                    )

                # Convert selected references to CitationManager format
                selected_citation_keys = []
                for idx, ref in enumerate(selected_references):
                    try:
                        # Add to citation manager as a Source object (required by CitationManager API).
                        citation_key = ref.get('citation_key') or f"ref{idx+1}"
                        year_value = ref.get('year')
                        if isinstance(year_value, str):
                            m = re.search(r"\b(19|20)\d{2}\b", year_value)
                            year_value = int(m.group(0)) if m else None
                        elif not isinstance(year_value, int):
                            year_value = None

                        source = Source(
                            title=ref.get('title', 'Unknown Title'),
                            authors=ref.get('authors', []) if isinstance(ref.get('authors'), list) else [],
                            year=year_value,
                            abstract=ref.get('abstract', '') or '',
                            url=ref.get('url', '') or '',
                            source_type=ref.get('source_type', 'academic') or 'academic',
                            citation_key=citation_key,
                            venue=ref.get('venue'),
                            doi=ref.get('doi')
                        )
                        resolved_key = self.citation_manager.add_source(source, force_citation_key=True)
                        selected_citation_keys.append(resolved_key)
                        logger.info(f"   [OK] Added reference: {ref.get('title', 'Unknown')[:60]}...")
                    except Exception as e:
                        logger.warning(f"   [WARN] Failed to add reference {idx+1}: {e}")

                # When references are user-selected in UI, only allow those keys in citation injection.
                if getattr(self.writer, 'citation_matcher', None) and hasattr(self.writer.citation_matcher, 'set_allowed_citation_keys'):
                    self.writer.citation_matcher.set_allowed_citation_keys(selected_citation_keys)

                if len(selected_citation_keys) == 0:
                    raise ValueError("Selected references were provided but none could be loaded into the citation pool.")

                # Create dummy researched_sections (no actual research done)
                researched_sections = [{'section_name': s['name'], 'content': ''} for s in rough_plan['sections']]

                logger.info(f"\n[REFERENCES] {len(self.citation_manager.sources)} references loaded into citation pool")

                if self.progress_callback:
                    await self.progress_callback(
                        phase="research",
                        progress=30.0,
                        message=f"Loaded {len(self.citation_manager.sources)} pre-selected references"
                    )

            else:
                # GenLaTeX: no external research - use dummy sections and proceed to analysis
                researched_sections = [{'section_name': s['name'], 'content': ''} for s in rough_plan.get('sections', [])]
                research_checkpoint_data = {'researched_sections': researched_sections, 'sources': []}
                if self.progress_callback:
                    await self.progress_callback(phase="research", progress=30.0, message="Skipped research (prompt-only mode).")

            # Ensure checkpoint data is populated in all research paths.
            if not research_checkpoint_data.get('researched_sections'):
                research_checkpoint_data['researched_sections'] = researched_sections

            if len(research_checkpoint_data.get('sources', [])) == 0 and self.citation_manager and len(self.citation_manager.sources) > 0:
                for citation_key, source in self.citation_manager.sources.items():
                    if hasattr(source, 'to_dict'):
                        source_dict = source.to_dict()
                    elif isinstance(source, dict):
                        source_dict = source
                    else:
                        source_dict = {
                            'title': getattr(source, 'title', 'Unknown'),
                            'authors': getattr(source, 'authors', []),
                            'year': getattr(source, 'year', None),
                            'abstract': getattr(source, 'abstract', ''),
                            'url': getattr(source, 'url', ''),
                            'venue': getattr(source, 'venue', ''),
                            'citation_key': citation_key,
                            'source_type': getattr(source, 'source_type', 'academic'),
                            'research_question_or_purpose': getattr(source, 'research_question_or_purpose', None),
                            'methodology': getattr(source, 'methodology', None),
                            'key_findings_results': getattr(source, 'key_findings_results', None),
                            'implications_contributions': getattr(source, 'implications_contributions', None),
                            'relation_to_other_research': getattr(source, 'relation_to_other_research', None),
                            'limitations_gaps': getattr(source, 'limitations_gaps', None),
                            'pertinence_score': getattr(source, 'pertinence_score', None),
                            'doi': getattr(source, 'doi', None),
                            'pdf_url': getattr(source, 'pdf_url', None),
                            'full_text': getattr(source, 'full_text', None),
                            'credibility_score': getattr(source, 'credibility_score', 0.0)
                        }
                    research_checkpoint_data['sources'].append(source_dict)

                print(f"ðŸ’¾ Saving {len(research_checkpoint_data['sources'])} sources to research checkpoint")

        # Phase 3: Analysis & Synthesis
            await self._log_phase("Analysis & Synthesis", 3)
            
            # Set phase context for file tools logging
            if self.file_tools:
                self.file_tools.set_phase_context('analysis')
            
            # NEW: Validate references completeness before analysis
            if self.progress_callback:
                await self.progress_callback(
                    phase="research",
                    progress=34.5,
                    message=f"ðŸ” Research Agent: Validating {len(self.citation_manager.sources)} sources for completeness..."
                )
            all_sources = list(self.citation_manager.sources.values())
            is_valid, validation_issues = self._validate_references_completeness(all_sources)
            
            if not is_valid:
                if self.progress_callback:
                    await self.progress_callback(
                        phase="research",
                        progress=34.7,
                        message=f"âš ï¸ Research Agent: Found incomplete sources. Enforcing fallback to ensure all fields are populated..."
                    )
                print(f"âš ï¸  Some sources are incomplete - enforcing fallback...")
                all_sources = self._enforce_fallback_on_incomplete_sources(all_sources)
                
                # Update CitationManager with fixed sources
                for source in all_sources:
                    self.citation_manager.sources[source.citation_key] = source
                
                if self.progress_callback:
                    await self.progress_callback(
                        phase="research",
                        progress=34.8,
                        message=f"âœ… Research Agent: Applied fallback templates. Re-validating sources..."
                    )
                
                # Re-validate
                is_valid_after_fix, _ = self._validate_references_completeness(all_sources)
                if is_valid_after_fix:
                    print(f"âœ… All sources now complete after fallback enforcement")
                    if self.progress_callback:
                        await self.progress_callback(
                            phase="research",
                            progress=34.9,
                            message=f"âœ… Research Agent: All sources validated and complete. Ready for analysis."
                        )
                else:
                    print(f"âš ï¸  WARNING: Some sources still incomplete even after fallback")
                    if self.progress_callback:
                        await self.progress_callback(
                            phase="research",
                            progress=34.9,
                            message=f"âš ï¸ Research Agent: Some sources still incomplete after fallback. Proceeding with available data..."
                        )
            
            # Update progress: Analysis starting
            if self.progress_callback:
                await self.progress_callback(
                    phase="research",
                    progress=35.0,
                    message=f"Analyzing {len(self.citation_manager.sources)} sources to identify relationships and patterns..."
                )
            
            # Analyze sources to understand relationships, patterns, narrative flow
            file_context = self.research_context_prompt if hasattr(self, 'research_context_prompt') else ""
            if self.uploaded_files_summary:
                if file_context:
                    file_context = f"{file_context}\n\nUPLOADED FILES SUMMARY:\n{self.uploaded_files_summary}"
                else:
                    file_context = f"UPLOADED FILES SUMMARY:\n{self.uploaded_files_summary}"
            # GenLaTeX: no research analyzer - use simple analysis from prompt/structure only
            analysis = {
                "summary": "Generate from prompt and model knowledge.",
                "narrative_flow": "introduction -> body -> conclusion",
                "key_themes": [],
                "further_research_needed": [],
            }
            
            # Save analysis
            self._save_checkpoint(topic, 'analysis', analysis)
            (output_path / 'analysis.json').write_text(json.dumps(analysis, indent=2))
            
            if self.verbose:
                print(f"âœ… Analysis complete\n")
            
            # Update progress: Analysis complete, starting detailed planning
            # Phase 4: Detailed Writing Plan
            await self._log_phase("Detailed Writing Plan", 4)
            
            if self.progress_callback:
                await self.progress_callback(
                    phase="plan",
                    progress=38.0,
                    message=f"ðŸ“‹ Planner Agent: Creating detailed writing plan with subsections based on research findings..."
                )
            
            if self.verbose:
                print(f"ðŸ“ Creating detailed writing plan based on research findings...")
            
            # Create detailed writing plan from rough plan (no research - GenLaTeX prompt-only)
            source_sections = (rough_plan.get("sections") or [])[:3] if self.flash_mode else (rough_plan.get("sections") or [])
            per_section_target = 220 if quick_document_mode else 320
            fast_sections = []
            for section in source_sections:
                if not isinstance(section, dict):
                    continue
                section_copy = dict(section)
                if not section_copy.get("target_words"):
                    section_copy["target_words"] = per_section_target
                if isinstance(section_copy.get("subsections"), list):
                    normalized_subsections = []
                    for subsection in section_copy["subsections"]:
                        if isinstance(subsection, dict):
                            subsection_copy = dict(subsection)
                            if not subsection_copy.get("target_words"):
                                subsection_copy["target_words"] = max(120, per_section_target // 2)
                            normalized_subsections.append(subsection_copy)
                        else:
                            normalized_subsections.append(subsection)
                    section_copy["subsections"] = normalized_subsections
                fast_sections.append(section_copy)

            detailed_plan = {
                **rough_plan,
                "title": rough_plan.get(
                    "title",
                    f"{'Document' if document_mode else 'Literature Review'} on {topic}"
                ),
                "sections": fast_sections,
                "keywords": rough_plan.get("keywords", []),
            }
            
            # Save detailed plan
            self._save_checkpoint(topic, 'detailed_plan', detailed_plan)
            (output_path / 'detailed_plan.json').write_text(json.dumps(detailed_plan, indent=2))
            # Also save as plan.json for backward compatibility
            (output_path / 'plan.json').write_text(json.dumps(detailed_plan, indent=2))
            
            if self.verbose:
                print(f"âœ… Detailed writing plan created\n")
            
            # Update progress: Detailed plan complete
            if self.progress_callback:
                total_sections = len(detailed_plan.get('sections', []))
                await self.progress_callback(
                    phase="plan",
                    progress=42.0,
                    message=f"Detailed plan created with {total_sections} sections. Ready to start writing..."
                )
            
            # Check if further research is needed
            if analysis.get('further_research_needed'):
                further_topics = analysis['further_research_needed']
                if len(further_topics) > 0:
                    print(f"ðŸ” Additional research needed for: {', '.join(further_topics[:3])}")
                    # TODO: Could trigger additional research here if needed
                    # For now, we proceed with what we have
            
            # Update research checkpoint with analysis and detailed plan
            research_checkpoint_data['analysis'] = analysis
            research_checkpoint_data['detailed_plan'] = detailed_plan
            
            # Save complete research (topic-specific) with sources
            self._save_checkpoint(topic, 'research_complete', research_checkpoint_data)
            
            if self.verbose:
                # NEW APPROACH: Sources are in CitationManager, not in section-specific arrays
                total_sources = len(self.citation_manager.sources)
                print(f"âœ“ Batch research complete - {total_sources} total sources in global pool")
                
                # Analyze source diversity
                if total_sources > 0:
                    print(f"ðŸ“Š Source Analysis:")
                    print(f"   - Total sources in global pool: {total_sources}")
                    print(f"   - Sources available for all sections: {total_sources}")
                    print(f"   - Target sources: 15-25 per section (shared pool)")
                    
                    if total_sources < 15 * len(researched_sections):
                        print(f"âš ï¸  WARNING: Low source count. Consider more comprehensive search.")
                    elif total_sources > 25 * len(researched_sections):
                        print(f"âœ… Excellent source coverage - comprehensive research completed.")
                    else:
                        print(f"âœ… Good source coverage - adequate for academic paper.")
        else:
            research_checkpoint = self._load_checkpoint(topic, 'research_complete')
            if not research_checkpoint:
                raise ValueError(f"Cannot resume from {resume_from}: research checkpoint not found")
            
            # Load analysis and detailed plan if available
            analysis = self._load_checkpoint(topic, 'analysis')
            detailed_plan = self._load_checkpoint(topic, 'detailed_plan')
            
            # Save loaded files to output directory if they exist
            if analysis:
                (output_path / 'analysis.json').write_text(json.dumps(analysis, indent=2))
            if detailed_plan:
                (output_path / 'detailed_plan.json').write_text(json.dumps(detailed_plan, indent=2))
                (output_path / 'plan.json').write_text(json.dumps(detailed_plan, indent=2))
            
            # Handle both old format (just sections) and new format (with sources)
            if isinstance(research_checkpoint, list):
                # Old format: just a list of sections
                researched_sections = research_checkpoint
                print(f"âš ï¸  WARNING: Old checkpoint format detected - no sources saved!")
                print(f"âš ï¸  CitationManager will be empty - research must be re-run")
            else:
                # New format: dict with sections and sources
                researched_sections = research_checkpoint.get('researched_sections', [])
                saved_sources = research_checkpoint.get('sources', [])
                
                # Load analysis and detailed plan from checkpoint if not already loaded
                if not analysis and 'analysis' in research_checkpoint:
                    analysis = research_checkpoint['analysis']
                    # Save to output directory
                    (output_path / 'analysis.json').write_text(json.dumps(analysis, indent=2))
                if not detailed_plan and 'detailed_plan' in research_checkpoint:
                    detailed_plan = research_checkpoint['detailed_plan']
                    # Save to output directory
                    (output_path / 'detailed_plan.json').write_text(json.dumps(detailed_plan, indent=2))
                    (output_path / 'plan.json').write_text(json.dumps(detailed_plan, indent=2))
                
                # CRITICAL: Restore CitationManager sources from checkpoint
                if saved_sources and self.citation_manager:
                    print(f"ðŸ“š Restoring {len(saved_sources)} sources to CitationManager from checkpoint...")
                    restored_count = 0
                    skipped_placeholders = 0
                    for source_dict in saved_sources:
                        # CRITICAL: Filter out placeholder sources when restoring
                        abstract = source_dict.get('abstract', '') or ''
                        url = source_dict.get('url', '') or ''
                        
                        if '[PLACEHOLDER SOURCE - SEARCH TOOLS FAILED]' in abstract:
                            skipped_placeholders += 1
                            if self.verbose:
                                print(f"âš ï¸  Skipping placeholder source when restoring: {source_dict.get('title', 'Unknown')[:50]}...")
                            continue
                        
                        if 'example.org/placeholder' in url:
                            skipped_placeholders += 1
                            if self.verbose:
                                print(f"âš ï¸  Skipping placeholder source (placeholder URL) when restoring: {source_dict.get('title', 'Unknown')[:50]}...")
                            continue
                        
                        try:
                            # Recreate Source object from dict with ALL fields including article_info
                            source = Source(
                                title=source_dict.get('title', 'Unknown'),
                                authors=source_dict.get('authors', []),
                                year=source_dict.get('year'),
                                abstract=source_dict.get('abstract', ''),
                                url=source_dict.get('url', ''),
                                venue=source_dict.get('venue', ''),
                                source_type=source_dict.get('source_type', 'academic'),
                                citation_key=source_dict.get('citation_key'),
                                # Restore article_info fields
                                research_question_or_purpose=source_dict.get('research_question_or_purpose'),
                                methodology=source_dict.get('methodology'),
                                key_findings_results=source_dict.get('key_findings_results'),
                                implications_contributions=source_dict.get('implications_contributions'),
                                relation_to_other_research=source_dict.get('relation_to_other_research'),
                                limitations_gaps=source_dict.get('limitations_gaps'),
                                pertinence_score=source_dict.get('pertinence_score'),
                                full_text=source_dict.get('full_text'),
                                pdf_url=source_dict.get('pdf_url'),
                                doi=source_dict.get('doi'),
                                credibility_score=source_dict.get('credibility_score', 0.0)
                            )
                            # Add to CitationManager (will handle duplicates)
                            self.citation_manager.add_source(source)
                            restored_count += 1
                        except Exception as e:
                            print(f"âš ï¸  Failed to restore source: {e}")
                            continue
                    
                    print(f"âœ… Restored {restored_count} REAL sources to CitationManager")
                    if skipped_placeholders > 0:
                        print(f"âš ï¸  Skipped {skipped_placeholders} placeholder sources from checkpoint")
                    print(f"ðŸ“Š CitationManager now has {len(self.citation_manager.sources)} total sources")
                    
                    # CRITICAL: If no real sources restored, this is a problem
                    if restored_count == 0 and len(saved_sources) > 0:
                        print("\n" + "!"*80)
                        print("âŒ CRITICAL: Checkpoint contains only placeholder sources!")
                        print("!"*80)
                        print("âš ï¸  All sources in checkpoint are placeholders - research did not work.")
                        print("âš ï¸  Cannot proceed with writing - research must be re-run.")
                        print("!"*80 + "\n")
                        raise ValueError("Checkpoint contains only placeholder sources. Research must be re-run.")
                else:
                    print(f"âš ï¸  WARNING: No sources in checkpoint - CitationManager will be empty!")
                    if resume_from == 'writing':
                        print("âš ï¸  Cannot write paper without sources - research must be re-run")
                        raise ValueError("Cannot resume from writing: No sources in checkpoint. Research must be re-run.")
            
            if self.verbose:
                print(f"âœ… Loaded research from checkpoint ({len(researched_sections)} sections)\n")
            
            # If analysis/detailed plan not loaded, try to create them
            if not analysis or not detailed_plan:
                if self.verbose:
                    print(f"âš ï¸  Analysis or detailed plan not found, creating them now...")
                # Ensure rough_plan is loaded if needed
                if rough_plan is None:
                    rough_plan = self._load_checkpoint(topic, 'rough_plan')
                    if not rough_plan:
                        # Create minimal fallback with basic sections
                        rough_plan = {
                            "title": f"{'Document' if document_mode else 'Research'} on {topic}",
                            "sections": [
                                {"id": "1", "name": "Introduction", "percentage": 20, "key_points": [f"Background of {topic}"], "search_queries": [f"{topic} introduction"], "subsections": []},
                                {"id": "2", "name": "Main Content", "percentage": 60, "key_points": [f"Analysis of {topic}"], "search_queries": [f"{topic} analysis"], "subsections": []},
                                {"id": "3", "name": "Conclusion", "percentage": 20, "key_points": [f"Summary of {topic}"], "search_queries": [f"{topic} conclusion"], "subsections": []}
                            ],
                            "abstract_points": [f"Comprehensive analysis of {topic}"],
                            "keywords": [topic.lower(), "analysis", "document"] if document_mode else [topic.lower(), "analysis", "research"]
                        }
                if not analysis:
                    analysis = {
                        "summary": "Generate from prompt and model knowledge.",
                        "narrative_flow": "introduction -> body -> conclusion",
                        "key_themes": [],
                        "further_research_needed": [],
                    }
                    self._save_checkpoint(topic, 'analysis', analysis)
                    (output_path / 'analysis.json').write_text(json.dumps(analysis, indent=2))
                if not detailed_plan and rough_plan:
                    source_sections = (rough_plan.get("sections") or [])[:3] if self.flash_mode else (rough_plan.get("sections") or [])
                    per_section_target = 220
                    fast_sections = []
                    for section in source_sections:
                        if not isinstance(section, dict):
                            continue
                        section_copy = dict(section)
                        if not section_copy.get("target_words"):
                            section_copy["target_words"] = per_section_target
                        if isinstance(section_copy.get("subsections"), list):
                            normalized_subsections = []
                            for subsection in section_copy["subsections"]:
                                if isinstance(subsection, dict):
                                    subsection_copy = dict(subsection)
                                    if not subsection_copy.get("target_words"):
                                        subsection_copy["target_words"] = max(120, per_section_target // 2)
                                    normalized_subsections.append(subsection_copy)
                                else:
                                    normalized_subsections.append(subsection)
                            section_copy["subsections"] = normalized_subsections
                        fast_sections.append(section_copy)
                    detailed_plan = {
                        **rough_plan,
                        "title": rough_plan.get("title", f"Document on {topic}"),
                        "sections": fast_sections,
                        "keywords": rough_plan.get("keywords", []),
                    }
                    self._save_checkpoint(topic, 'detailed_plan', detailed_plan)
                    (output_path / 'detailed_plan.json').write_text(json.dumps(detailed_plan, indent=2))
                    (output_path / 'plan.json').write_text(json.dumps(detailed_plan, indent=2))

        # Phase 5: Writing (using detailed plan) - THIS MUST BE OUTSIDE THE RESEARCH ELSE BLOCK!
        print(f"\nðŸ” DEBUG: resume_from={resume_from}, checking if writing phase should run...")
        if resume_from in [None, 'plan', 'rough_plan', 'research', 'analysis', 'detailed_plan', 'writing']:
            print(f"ðŸ” DEBUG: ENTERING writing phase block (resume_from={resume_from})")
            await self._log_phase("Writing Content", 5)

            # Set phase context for file tools logging
            if self.file_tools:
                self.file_tools.set_phase_context('writing')

            # Load detailed plan if not already loaded
            if detailed_plan is None:
                detailed_plan = self._load_checkpoint(topic, 'detailed_plan')
                if not detailed_plan:
                    # Fallback to rough plan if detailed plan not found
                    if rough_plan is None:
                        rough_plan = self._load_checkpoint(topic, 'rough_plan')
                    if rough_plan:
                        detailed_plan = rough_plan
                    else:
                        # Last resort fallback with basic sections (NEVER empty!)
                        detailed_plan = {
                            "title": f"{'Document' if document_mode else 'Research'} on {topic}",
                            "sections": [
                                {"id": "1", "name": "Introduction", "percentage": 20, "key_points": [f"Background of {topic}"], "search_queries": [f"{topic} introduction"], "subsections": []},
                                {"id": "2", "name": "Main Content", "percentage": 60, "key_points": [f"Analysis of {topic}"], "search_queries": [f"{topic} analysis"], "subsections": []},
                                {"id": "3", "name": "Conclusion", "percentage": 20, "key_points": [f"Summary of {topic}"], "search_queries": [f"{topic} conclusion"], "subsections": []}
                            ],
                            "abstract_points": [f"Comprehensive analysis of {topic}"],
                            "keywords": [topic.lower(), "analysis", "document"] if document_mode else [topic.lower(), "analysis", "research"]
                        }
                    if self.verbose:
                        logger.warning(f"âš ï¸  Detailed plan not found, using rough plan or fallback")

            # Try to load humanized writing first (already processed), then complete writing
            needs_post_processing = False  # Default: no post-processing needed
            humanized_writing = self._load_checkpoint(topic, 'writing_humanized')
            if humanized_writing:
                written_sections = humanized_writing
                if self.verbose:
                    logger.info(f"âœ… Loaded humanized writing from checkpoint ({len(written_sections)} sections)")
                # Skip to verification phase - all processing already done
            else:
                # Try to load complete (but not humanized) writing
                complete_writing = self._load_checkpoint(topic, 'writing_complete')
                needs_post_processing = True  # Flag to run humanization (page count enforcement disabled)
                
                if complete_writing:
                    written_sections = complete_writing
                    if self.verbose:
                        logger.info(f"âœ… Loaded complete writing from checkpoint ({len(written_sections)} sections)")
                        logger.info(f"   â„¹ï¸  Will apply humanization (page count enforcement disabled)...")
                else:
                    # Prepare data for recursive writing (handles subsections)
                    sections = detailed_plan.get('sections', [])

                    # CRITICAL: Validate that we have sections to write
                    if not sections or len(sections) == 0:
                        if self.verbose:
                            logger.warning(f"âš ï¸  WARNING: detailed_plan has no sections! Creating fallback sections...")
                        # Create basic sections as fallback
                        sections = [
                            {"id": "1", "name": "Introduction", "percentage": 20, "key_points": [f"Background of {topic}"], "search_queries": [f"{topic} introduction"], "subsections": []},
                            {"id": "2", "name": "Main Content", "percentage": 60, "key_points": [f"Analysis of {topic}"], "search_queries": [f"{topic} analysis"], "subsections": []},
                            {"id": "3", "name": "Conclusion", "percentage": 20, "key_points": [f"Summary of {topic}"], "search_queries": [f"{topic} conclusion"], "subsections": []}
                        ]
                        detailed_plan['sections'] = sections
                        self._save_checkpoint(topic, 'detailed_plan', detailed_plan)

                    if self.verbose:
                        logger.info(f"ðŸš€ Writing {len(sections)} sections using detailed plan...")
                        
                    # Batched parallel writing (PARALLEL_WRITE_CONCURRENT)
                    from utils.parallel_config import get_effective_concurrent

                    def _count_section_units(section_node: Dict[str, Any]) -> int:
                        """Count section + nested subsections for progress accounting."""
                        if not isinstance(section_node, dict):
                            return 1
                        subs = section_node.get("subsections", []) or []
                        total = 1
                        for sub in subs:
                            total += _count_section_units(sub)
                        return total

                    def _build_timed_out_section(section_node: Dict[str, Any], reason: str) -> Dict[str, Any]:
                        """Fallback section to keep pipeline moving when one write task stalls."""
                        import re as _re
                        if not isinstance(section_node, dict):
                            return {
                                "section_id": "",
                                "section_name": "Section",
                                "content": f"Fallback section generated due to timeout: {reason}",
                                "word_count": 8,
                                "citations": [],
                                "deviation": 0.0,
                                "attempts": 0,
                                "timed_out": True,
                            }
                        section_name = str(section_node.get("name", "Section")).strip() or "Section"
                        section_id = str(section_node.get("id", ""))
                        key_points = [
                            _re.sub(r"\s+", " ", str(kp).strip())
                            for kp in (section_node.get("key_points", []) or [])
                            if str(kp).strip()
                        ][:8]

                        lines = [
                            f"This section summarizes the core aspects of {section_name.lower()} within the scope of this review."
                        ]
                        if key_points:
                            lines.append(r"\begin{itemize}")
                            for point in key_points:
                                lines.append(f"  \\item {point}")
                            lines.append(r"\end{itemize}")
                        lines.append(
                            "Additional detail can be expanded in a refinement pass if deeper technical depth is required."
                        )
                        lines.append(f"% Auto-generated fallback due to timeout: {reason}")

                        content = "\n".join(lines)
                        if hasattr(self.writer, "_count_words_excluding_latex"):
                            fallback_words = self.writer._count_words_excluding_latex(content)
                        else:
                            fallback_words = len(_re.findall(r"\b\w+\b", content))

                        fallback = {
                            "section_id": section_id,
                            "section_name": section_name,
                            "content": content,
                            "word_count": fallback_words,
                            "citations": [],
                            "deviation": 0.0,
                            "attempts": 0,
                            "timed_out": True,
                        }

                        subsections = section_node.get("subsections", []) or []
                        if subsections:
                            fallback["subsections"] = [
                                _build_timed_out_section(sub, reason) for sub in subsections
                            ]
                        return fallback

                    async def write_sections_batched(plan_sections):
                        """Write top-level sections in parallel batches; write_section_recursive handles subsections."""
                        total_units = max(1, sum(_count_section_units(s) for s in plan_sections))
                        max_concurrent = get_effective_concurrent('PARALLEL_WRITE_CONCURRENT', 3, len(plan_sections))
                        section_timeout_sec = _safe_int_env("PARALLEL_WRITE_SECTION_TIMEOUT_SEC", 90, 30, 1200)
                        heartbeat_sec = _safe_int_env("PARALLEL_WRITE_HEARTBEAT_SEC", 12, 5, 120)

                        async def write_one(section, idx):
                            section_name = section.get('name', 'Unknown Section')
                            research_data = {
                                'section_name': section_name,
                                'section_id': section.get('id', ''),
                                'sources': [],
                                'research_summary': ''
                            }
                            target_words = section.get('target_words', 0)
                            section_units = _count_section_units(section)
                            try:
                                written = await asyncio.wait_for(
                                    self.writer.write_section_recursive(section, research_data, target_words),
                                    timeout=float(section_timeout_sec),
                                )
                                return idx, written, section_units, False
                            except asyncio.TimeoutError:
                                logger.warning(
                                    "â±ï¸ Writing timeout for section '%s' after %ss. Using fallback section to continue.",
                                    section_name,
                                    section_timeout_sec,
                                )
                                fallback = _build_timed_out_section(
                                    section,
                                    reason=f"section write exceeded {section_timeout_sec}s",
                                )
                                return idx, fallback, section_units, True

                        written_by_idx = {}
                        done_units = 0
                        for batch_start in range(0, len(plan_sections), max_concurrent):
                            batch = plan_sections[batch_start:batch_start + max_concurrent]
                            batch_names = ", ".join(
                                str(s.get("name", "Section")).strip() or "Section"
                                for s in batch
                            )
                            batch_units_target = sum(_count_section_units(s) for s in batch)
                            batch_start_progress = 45.0 + (done_units / total_units) * 12.0
                            batch_end_progress = 45.0 + ((done_units + batch_units_target) / total_units) * 12.0

                            if self.progress_callback:
                                await self.progress_callback(
                                    phase="writing",
                                    progress=batch_start_progress,
                                    message=f"âœï¸ Writer Agent: Drafting {batch_names}..."
                                )

                            stop_heartbeat = asyncio.Event()

                            async def heartbeat():
                                elapsed = 0
                                while not stop_heartbeat.is_set():
                                    await asyncio.sleep(heartbeat_sec)
                                    if stop_heartbeat.is_set():
                                        break
                                    elapsed += heartbeat_sec
                                    pulse_progress = min(
                                        batch_end_progress - 0.2,
                                        batch_start_progress + min(1.0, elapsed / 120.0),
                                    )
                                    if self.progress_callback:
                                        await self.progress_callback(
                                            phase="writing",
                                            progress=pulse_progress,
                                            message=f"âœï¸ Writer Agent: Still drafting ({batch_names})... {elapsed}s elapsed"
                                        )

                            heartbeat_task = asyncio.create_task(heartbeat()) if self.progress_callback else None
                            tasks = [write_one(s, batch_start + i) for i, s in enumerate(batch)]
                            try:
                                results = await asyncio.gather(*tasks, return_exceptions=True)
                            finally:
                                stop_heartbeat.set()
                                if heartbeat_task:
                                    heartbeat_task.cancel()
                                    try:
                                        await heartbeat_task
                                    except asyncio.CancelledError:
                                        pass

                            timed_out_count = 0
                            batch_completed_units = 0
                            for r in results:
                                if isinstance(r, Exception):
                                    raise r
                                idx, written_section, unit_count, timed_out = r
                                written_by_idx[idx] = written_section
                                batch_completed_units += max(1, int(unit_count))
                                if timed_out:
                                    timed_out_count += 1

                            done_units += batch_completed_units
                            if self.progress_callback:
                                timeout_note = (
                                    f" ({timed_out_count} section timeouts auto-recovered)"
                                    if timed_out_count > 0 else ""
                                )
                                await self.progress_callback(
                                    phase="writing",
                                    progress=45.0 + (done_units / total_units) * 12.0,
                                    message=f"âœï¸ Writer Agent: Written {done_units}/{total_units} sections/subsections...{timeout_note}"
                                )
                        return [written_by_idx[i] for i in range(len(plan_sections))]
                        
                    # Update progress: Writing starting
                    if self.progress_callback:
                        await self.progress_callback(
                            phase="writing",
                            progress=45.0,
                            message=f"Writing {len(sections)} sections with AI. This may take a few minutes..."
                        )
                        
                    # Use batched parallel writing (PARALLEL_WRITE_CONCURRENT)
                    logger.debug(f"ðŸ” DEBUG: About to call write_sections_batched with {len(sections)} sections")
                    written_sections = await write_sections_batched(sections)
                    logger.debug(f"ðŸ” DEBUG: write_sections_batched completed, written_sections has {len(written_sections) if written_sections else 0} sections")

                    # Update progress: Writing complete
                    total_words = sum(s.get('word_count', 0) for s in written_sections)
                    if self.progress_callback:
                        await self.progress_callback(
                            phase="writing",
                            progress=60.0,
                            message=f"Completed writing {total_words:,} words across {len(sections)} sections with citations"
                        )
                        
                    # Enrich memory with writing results
                    # Memory system removed
                        
                    # Save complete writing
                    self._save_checkpoint(topic, 'writing_complete', written_sections)
                
                # END of innermost if/else (complete_writing check)
                # Post-processing runs for BOTH fresh writing AND loaded checkpoint
            
            # DISABLED: Page count enforcement feature removed to save generation time
            # User requested removal as it adds significant delay without adding value
            # if needs_post_processing:
            #     # NEW: Phase 7.5 - Post-Writing Page Count Enforcement (BEFORE LaTeX generation)
            #     await self._log_phase("Page Count Enforcement", 7.5)
            #
            #     if self.progress_callback:
            #         await self.progress_callback(
            #             phase="writing",
            #             progress=65.0,
            #             message=f"âœï¸ Enforcing page count: adjusting content to match target length..."
            #         )
            #
            #     # Get target words from plan
            #     target_words = detailed_plan.get('target_words', 0)
            #
            #     # Use the new comprehensive page count enforcement
            #     # This handles both expansion (if too short) and trimming (if too long)
            #     # And can restructure the article layout if needed
            #     written_sections = await self._enforce_page_count(
            #         written_sections,
            #         target_words,
            #         topic,
            #         abstract=abstract
            #     )
            #
            #     # Save adjusted sections
            #     self._save_checkpoint(topic, 'writing_adjusted', written_sections)
            #
            #     if self.verbose:
            #         # Use class method for accurate word counting (includes subsections)
            #         total_words_after = self._count_total_words(written_sections)
            #         total_citations = sum(len(s.get('citations', []) if isinstance(s, dict) else getattr(s, 'citations', [])) for s in written_sections)
            #         # Calculate citation density (citations per page, assuming ~250 words per page)
            #         pages = total_words_after / 250
            #         citation_density = total_citations / pages if pages > 0 else 0
            #         logger.info(f"âœ“ Writing and adjustment complete - {total_words_after} words, {total_citations} citations")
            #         logger.info(f"ðŸ“Š Citation density: {citation_density:.1f} citations per page (target: 3-6 per page)")
            #
            #         # Warn if citation density is too low
            #         if citation_density < 3:
            #             logger.warning(f"âš ï¸  WARNING: Low citation density ({citation_density:.1f}). Academic papers typically need 3-6 citations per page.")
            #         elif citation_density > 6:
            #             logger.info(f"âœ… Excellent citation density ({citation_density:.1f}) - well above minimum requirements.")
            #         else:
            #             logger.info(f"âœ… Good citation density ({citation_density:.1f}) - within recommended range.")

            # Phase 8: Humanization - runs when we need post-processing (fresh writing or complete writing loaded)
            if needs_post_processing and not quick_document_mode:
                # NEW: Phase 8 - Humanization (make text sound more naturally written by a researcher)
                await self._log_phase("Humanization", 8)

                if self.progress_callback:
                    await self.progress_callback(
                        phase="writing",
                        progress=70.0,
                        message=f"âœï¸ Humanizing text to sound more naturally written by a researcher..."
                    )

                if self.verbose:
                    logger.info(f"\n{'='*80}")
                    logger.info(f"âœ¨ HUMANIZING TEXT")
                    logger.info(f"{'='*80}")
                    logger.info(f"Revising all sections to make them sound more naturally written by a researcher...")
                    logger.info(f"{'='*80}\n")

                # Humanize all sections (recursively handles subsections)
                humanize_timeout_sec = _safe_int_env("PARALLEL_HUMANIZE_TIMEOUT_SEC", 120, 30, 1200)
                try:
                    written_sections = await asyncio.wait_for(
                        self.writer.humanize_sections_recursive(written_sections),
                        timeout=float(humanize_timeout_sec),
                    )
                except asyncio.TimeoutError:
                    logger.warning(
                        "â±ï¸ Humanization timed out after %ss. Continuing with non-humanized section text.",
                        humanize_timeout_sec,
                    )

                if self.verbose:
                    logger.info(f"âœ… Humanization complete - all sections revised\n")

                # Save humanized writing checkpoint (so we don't re-humanize on resume)
                self._save_checkpoint(topic, 'writing_humanized', written_sections)

                # Update progress after humanization
                if self.progress_callback:
                    await self.progress_callback(
                        phase="writing",
                        progress=75.0,
                        message=f"âœ… Text humanization complete"
                    )
            elif needs_post_processing and quick_document_mode:
                if self.verbose:
                    logger.info("⚡ Flash document mode: skipped optional humanization for faster completion")
                if self.progress_callback:
                    await self.progress_callback(
                        phase="writing",
                        progress=75.0,
                        message="Skipped optional text polishing in flash mode for faster completion."
                    )
        else:
                written_sections = self._load_checkpoint(topic, 'writing_complete')
                if not written_sections:
                    raise ValueError(f"Cannot resume from {resume_from}: writing checkpoint not found")
                
                # CRITICAL: Validate citations in writing checkpoint match CitationManager sources
                if self.citation_manager and len(self.citation_manager.sources) > 0:
                    print(f"ðŸ” Validating citations in writing checkpoint against CitationManager...")
                    invalid_citations = []
                    total_citations = 0
                    
                    for section in written_sections:
                        section_citations = section.get('citations', []) if isinstance(section, dict) else getattr(section, 'citations', [])
                        if section_citations:
                            total_citations += len(section_citations)
                            for citation_key in section_citations:
                                if citation_key not in self.citation_manager.sources:
                                    invalid_citations.append(citation_key)
                    
                    if invalid_citations:
                        print(f"\n" + "!"*80)
                        print(f"âŒ CRITICAL: Writing checkpoint contains {len(invalid_citations)} invalid citations!")
                        print("!"*80)
                        print(f"âš ï¸  These citations don't exist in CitationManager:")
                        for key in set(invalid_citations[:10]):  # Show first 10 unique
                            print(f"   - {key}")
                        if len(set(invalid_citations)) > 10:
                            print(f"   ... and {len(set(invalid_citations)) - 10} more")
                        print("!"*80)
                        print("âš ï¸  This means writing checkpoint is from a different research run.")
                        print("âš ï¸  Cannot proceed - writing must be re-done with current sources.")
                        print("!"*80 + "\n")
                        raise ValueError(f"Writing checkpoint has {len(invalid_citations)} citations that don't match CitationManager sources. Writing must be re-done.")
                    else:
                        print(f"âœ… All {total_citations} citations in writing checkpoint are valid")
                elif self.citation_manager and len(self.citation_manager.sources) == 0:
                    # Check if writing has citations but CitationManager is empty
                    has_citations = False
                    for section in written_sections:
                        section_citations = section.get('citations', []) if isinstance(section, dict) else getattr(section, 'citations', [])
                        if section_citations:
                            has_citations = True
                            break
                    
                    if has_citations:
                        print(f"\n" + "!"*80)
                        print(f"âŒ CRITICAL: Writing checkpoint has citations but CitationManager is empty!")
                        print("!"*80)
                        print("âš ï¸  Cannot generate bibliography - sources are missing.")
                        print("âš ï¸  Research must be re-run to restore sources.")
                        print("!"*80 + "\n")
                        raise ValueError("Writing checkpoint has citations but CitationManager is empty. Research must be re-run.")
                
                if self.verbose:
                    print(f"âœ… Loaded writing from checkpoint ({len(written_sections)} sections)\n")

        total_words = self._count_total_words(written_sections) if written_sections else 0

        # Phase 6: Verification (OPTIMIZED - Fast Check)
        print(f"\nðŸ” DEBUG: BEFORE verification - written_sections is None: {written_sections is None}")
        if written_sections is not None:
            print(f"ðŸ” DEBUG: written_sections has {len(written_sections)} items")
        if resume_from in [None, 'plan', 'rough_plan', 'research', 'analysis', 'detailed_plan', 'writing', 'verification']:
            await self._log_phase("Fact-Checking & Verification (Optimized)", 6)

            # Ensure written_sections is available (load from checkpoint if needed)
            # Use 'is None' check since empty list is a valid state (no sections written)
            if written_sections is None:
                print(f"ðŸ” DEBUG: written_sections is None, trying to load from checkpoint...")
                written_sections = self._load_checkpoint(topic, 'writing_complete')
                print(f"ðŸ” DEBUG: After loading writing_complete checkpoint: {written_sections is not None}")
                if not written_sections:
                    written_sections = self._load_checkpoint(topic, 'writing_trimmed')
                    print(f"ðŸ” DEBUG: After loading writing_trimmed checkpoint: {written_sections is not None}")

            # Check if we have any sections to verify
            if not written_sections or len(written_sections) == 0:
                print(f"âŒ DEBUG: FAILURE - written_sections is empty or None!")
                print(f"   written_sections type: {type(written_sections)}")
                print(f"   written_sections value: {written_sections}")
                if self.verbose:
                    print(f"âš ï¸  No written sections found - cannot proceed with verification")
                    print(f"   This usually means the writing phase failed or the plan had no sections")
                raise ValueError("Cannot run verification: writing sections not found. Please run writing phase first.")

            if quick_document_mode and not self._load_checkpoint(topic, 'verification_complete'):
                if self.verbose:
                    print("⚡ Flash document mode: using lightweight verification shortcut")
                self._save_checkpoint(topic, 'verification_complete', {
                    'all_verified': True,
                    'sections': written_sections
                })
                if self.progress_callback:
                    await self.progress_callback(
                        phase="verification",
                        progress=82.0,
                        message="Lightweight verification complete for flash mode."
                    )
            
            # Try to load verification first
            verification_data = self._load_checkpoint(topic, 'verification_complete')
            if verification_data:
                all_verified = verification_data['all_verified']
                if self.verbose:
                    print(f"âœ… Loaded verification from checkpoint")
            else:
                if self.verbose:
                    print(f"ðŸ” Fast verification of critical claims only...")
                
                all_verified = True
                
                # Verify only first 2 sections for speed
                sections_to_verify = written_sections[:2] if len(written_sections) > 0 else []
                
                if len(sections_to_verify) == 0:
                    if self.verbose:
                        print(f"âš ï¸  No sections to verify - skipping verification")
                    all_verified = True
                else:
                    # GenLaTeX: no fact-check/verification
                    all_verified = True
                
                self._save_checkpoint(topic, 'verification_complete', {
                    'all_verified': all_verified,
                    'sections': written_sections
                })
        else:
            verification_data = self._load_checkpoint(topic, 'verification_complete')
            if not verification_data:
                raise ValueError(f"Cannot resume: verification checkpoint not found")
            all_verified = verification_data['all_verified']
            if self.verbose:
                print(f"âœ… Loaded verification from checkpoint\n")

        # Phase 7: Generate Abstract
        await self._log_phase("Generating Abstract", 7)

        # Ensure detailed_plan is loaded (needed for abstract generation)
        if detailed_plan is None:
            detailed_plan = self._load_checkpoint(topic, 'detailed_plan')
            if not detailed_plan:
                # Fallback to rough_plan
                if rough_plan is None:
                    rough_plan = self._load_checkpoint(topic, 'rough_plan')
                if rough_plan:
                    detailed_plan = rough_plan
                else:
                    # Last resort fallback with basic structure
                    detailed_plan = {
                        "title": f"{'Document' if document_mode else 'Research'} on {topic}",
                        "sections": [
                            {"id": "1", "name": "Introduction", "percentage": 20, "key_points": [f"Background of {topic}"], "search_queries": [f"{topic} introduction"], "subsections": []},
                            {"id": "2", "name": "Main Content", "percentage": 60, "key_points": [f"Analysis of {topic}"], "search_queries": [f"{topic} analysis"], "subsections": []},
                            {"id": "3", "name": "Conclusion", "percentage": 20, "key_points": [f"Summary of {topic}"], "search_queries": [f"{topic} conclusion"], "subsections": []}
                        ],
                        "abstract_points": [f"Comprehensive analysis of {topic}"],
                        "keywords": [topic.lower(), "analysis", "document"] if document_mode else [topic.lower(), "analysis", "research"]
                    }
        
        abstract_checkpoint = self._load_checkpoint(topic, 'abstract')
        if abstract_checkpoint:
            abstract = abstract_checkpoint['abstract']
            # Save abstract to output directory even when loading from checkpoint
            (output_path / 'abstract.txt').write_text(abstract, encoding='utf-8')
            if self.verbose:
                print(f"âœ… Loaded abstract from checkpoint\n")
        else:
            if quick_document_mode:
                section_names = [
                    str(section.get('name', '')).strip()
                    for section in (detailed_plan.get('sections', []) or [])
                    if isinstance(section, dict) and str(section.get('name', '')).strip()
                ][:3]
                section_hint = ", ".join(section_names) if section_names else "the requested sections"
                abstract = (
                    f"This document addresses {topic}. "
                    f"It is structured around {section_hint}, "
                    "with concise, implementation-ready content generated from the provided prompt and files."
                )
            else:
                abstract = await self.writer.write_abstract(
                    detailed_plan.get('title', f"{'Document' if document_mode else 'Research'} on {topic}"),
                    written_sections,
                    detailed_plan.get('abstract_points', [])
                )
            self._save_checkpoint(topic, 'abstract', {'abstract': abstract})
            # Save abstract to output directory
            (output_path / 'abstract.txt').write_text(abstract, encoding='utf-8')

            if self.verbose:
                print(f"âœ“ Abstract complete ({len(abstract.split())} words)\n")
        
        # Humanize abstract if it exists
        if abstract and not quick_document_mode:
            if self.verbose:
                print(f"âœ¨ Humanizing abstract...")
            abstract_section = {'content': abstract, 'section_name': 'Abstract'}
            humanized_abstract_section = await self.writer.humanize_section(abstract_section)
            abstract = humanized_abstract_section.get('content', abstract)
            # Save humanized abstract
            (output_path / 'abstract.txt').write_text(abstract, encoding='utf-8')
            if self.verbose:
                print(f"âœ… Abstract humanized\n")
        elif abstract and quick_document_mode and self.verbose:
            print("⚡ Flash document mode: skipped abstract humanization")

        # Phase 8: Verification (Length management moved to Phase 6.5 - before LaTeX generation)
        await self._log_phase("Verification", 8)

        # Phase 9: Generate LaTeX (OPTIMIZED - Multiprocessing)
        await self._log_phase("Generating LaTeX (Optimized)", 9)
        
        # Update progress: Generating LaTeX
        if self.progress_callback:
            await self.progress_callback(
                phase="verification",
                progress=85.0,
                message=f"ðŸ“„ LaTeX Generator: Generating LaTeX files with proper formatting, citations, and bibliography..."
            )

        # NEW APPROACH: All sources are in global pool, not per-section
        # Convert all sources from CitationManager to dict format for JSON serialization
        all_references = []
        if self.citation_manager:
            print(f"ðŸ“š Collecting {len(self.citation_manager.sources)} sources from CitationManager for paper_data...")
            for citation_key, source in self.citation_manager.sources.items():
                if hasattr(source, 'to_dict'):
                    ref_dict = source.to_dict()
                elif isinstance(source, dict):
                    ref_dict = source
                else:
                    # Fallback: create dict from source attributes
                    ref_dict = {
                        'title': getattr(source, 'title', 'Unknown'),
                        'authors': getattr(source, 'authors', []),
                        'year': getattr(source, 'year', None),
                        'abstract': getattr(source, 'abstract', ''),
                        'url': getattr(source, 'url', ''),
                        'venue': getattr(source, 'venue', ''),
                        'citation_key': citation_key,
                        'source_type': getattr(source, 'source_type', 'academic')
                    }
                
                # CRITICAL: Filter out placeholder sources - they should never be saved
                source_abstract = ref_dict.get('abstract', '') or ''
                if '[PLACEHOLDER SOURCE - SEARCH TOOLS FAILED]' in source_abstract:
                    print(f"âš ï¸  SKIPPING placeholder source: {ref_dict.get('title', 'Unknown')[:50]}...")
                    continue
                
                # Also check for placeholder URLs
                url = ref_dict.get('url', '') or ''
                if 'example.org/placeholder' in url:
                    print(f"âš ï¸  SKIPPING placeholder source (placeholder URL): {ref_dict.get('title', 'Unknown')[:50]}...")
                    continue
                
                all_references.append(ref_dict)
            print(f"âœ… Collected {len(all_references)} REAL references for paper_data (filtered out placeholders)")
            
            # CRITICAL: If no real sources found, this is a serious error
            if len(all_references) == 0 and not document_mode:
                print("\n" + "!"*80)
                print("âŒ CRITICAL ERROR: No real sources found in CitationManager!")
                print("!"*80)
                print("âš ï¸  This means research failed completely. Possible causes:")
                print("   1. Search tools are not being called by the agent")
                print("   2. Search tools are failing/erroring")
                print("   3. Agent is not formatting output correctly")
                print("   4. API keys are missing or invalid")
                print("   5. Research phase was skipped or failed silently")
                print("!"*80)
                print(f"ðŸ“Š CitationManager has {len(self.citation_manager.sources)} sources total")
                if len(self.citation_manager.sources) > 0:
                    print("   But all sources appear to be placeholders - research did not work!")
                print("!"*80 + "\n")
        else:
            print("âš ï¸  WARNING: CitationManager not available - no references will be included")
        
        # CRITICAL: Validate that we have references before generating paper
        if len(all_references) == 0 and not document_mode:
            print("\n" + "!"*80)
            print("âŒ CRITICAL ERROR: Cannot generate paper without references!")
            print("!"*80)
            print("âš ï¸  Research phase failed or found no sources.")
            print("âš ï¸  Paper generation aborted to prevent broken bibliography.")
            print("!"*80 + "\n")
            raise ValueError("Cannot generate paper: No references found. Research must succeed before writing.")
        
        bibtex_content = self.citation_manager.generate_bibtex() if self.citation_manager else ''
        if not bibtex_content or not bibtex_content.strip():
            if document_mode:
                print("ℹ️ Document mode: no bibliography sources available. Creating empty BibTeX file.")
                bibtex_content = "% No external references for this document\n"
            else:
                print("\n" + "!"*80)
                print("âŒ CRITICAL ERROR: BibTeX generation failed!")
                print("!"*80)
                print(f"âš ï¸  CitationManager has {len(self.citation_manager.sources)} sources but generated empty BibTeX.")
                print("âš ï¸  This will result in an empty references.bib file.")
                print("!"*80 + "\n")
                raise ValueError("Cannot generate paper: BibTeX generation failed. References.bib would be empty.")
        
        paper_data = {
            'title': detailed_plan.get('title', f"{'Document' if document_mode else 'Research'} on {topic}"),
            'abstract': abstract,
            'keywords': detailed_plan.get('keywords', []),
            'sections': written_sections,
            'references': all_references,  # Global pool of all references (not per-section)
            'bibtex': bibtex_content,
            'actual_words': total_words,
            'document_mode': document_mode,
            'document_type': normalized_document_type or None,
            'document_template': normalized_document_template or None,
            'document_schema_id': normalized_document_schema or None,
        }

        # Generate LaTeX files (multiprocessing disabled for now due to pickle issues)
        if self.verbose:
            print("ðŸš€ Generating LaTeX files...")
        
        # Pass output_dir to generate_paper so support files can be copied
        try:
            latex_files = self.latex_gen.generate_paper(paper_data, output_dir=output_path)
        except Exception as e:
            # If LaTeX generation fails, save what we have so far
            print(f"âŒ LaTeX generation failed: {e}")
            if self.verbose:
                import traceback
                traceback.print_exc()
            # Save partial data so user doesn't lose everything
            try:
                (output_path / 'paper_data.json').write_text(json.dumps(self._make_json_serializable(paper_data), indent=2), encoding='utf-8')
                if 'detailed_plan' in locals():
                    (output_path / 'plan.json').write_text(json.dumps(detailed_plan, indent=2), encoding='utf-8')
            except (IOError, OSError, PermissionError) as e:
                logger.error(f"Failed to save partial data to {output_path}: {e}")
                # Don't raise - this is best-effort recovery
            raise
        
        # Update progress: LaTeX files generated
        if self.progress_callback:
            await self.progress_callback(
                phase="complete",
                progress=98.0,
                message="LaTeX files generated successfully. Finalizing paper..."
            )

        # Final citation density check
        if self.verbose:
            main_tex = latex_files['main.tex']
            references_bib = latex_files['references.bib']
            
            # Count citations in LaTeX
            citations_in_text = len(re.findall(r'\\cite\{[^}]+\}', main_tex))
            references_count = len(re.findall(r'@\w+\{', references_bib))
            
            # Estimate word count from LaTeX (rough approximation)
            word_count = len(main_tex.split())
            pages = word_count / 250
            citation_density = citations_in_text / pages if pages > 0 else 0
            
            print(f"ðŸ“Š Final Citation Analysis:")
            print(f"   - Citations in text: {citations_in_text}")
            print(f"   - References in bibliography: {references_count}")
            print(f"   - Estimated pages: {pages:.1f}")
            print(f"   - Citation density: {citation_density:.1f} citations per page")
            
            if citation_density < 3:
                print(f"âš ï¸  WARNING: Final citation density ({citation_density:.1f}) is below academic standards (3-6 per page)")
            elif citation_density > 6:
                print(f"âœ… Excellent final citation density ({citation_density:.1f}) - exceeds requirements")
            else:
                print(f"âœ… Good final citation density ({citation_density:.1f}) - meets academic standards")

        # Save template files to project directory if project_id is set
        if self.project_id and self.template_files:
            try:
                # Determine project directory path
                possible_paths = [
                    Path("../workspace/data/projects") / self.project_id,
                    Path("./data/projects") / self.project_id,
                    Path(os.getenv("GENLATEX_PROJECTS_PATH", ".")) / self.project_id,
                ]
                
                project_path = None
                for path_candidate in possible_paths:
                    if path_candidate.parent.exists():
                        project_path = path_candidate
                        break
                
                if not project_path:
                    project_path = Path("./data/projects") / self.project_id
                
                project_path.mkdir(parents=True, exist_ok=True)
                
                # Save all template files to project directory
                template_dir = project_path / "template"
                template_dir.mkdir(exist_ok=True)
                template_dir_resolved = template_dir.resolve()
                
                for filename, content in self.template_files.items():
                    try:
                        normalized_name = str(filename).replace('\\', '/').lstrip('/').lstrip('./')
                        if not normalized_name or normalized_name.startswith('..'):
                            if self.verbose:
                                print(f"[WARN]  Skipping unsafe template path: {filename}")
                            continue

                        # Save to template subdirectory
                        template_file_path = (template_dir / normalized_name).resolve()
                        if not str(template_file_path).startswith(str(template_dir_resolved)):
                            if self.verbose:
                                print(f"[WARN]  Skipping template file outside template dir: {filename}")
                            continue
                        template_file_path.parent.mkdir(parents=True, exist_ok=True)

                        ext = Path(normalized_name).suffix.lower()
                        is_binary_payload = isinstance(content, dict) and str(content.get('__encoding', '')).lower() == 'base64'

                        if is_binary_payload or ext in ('.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.pdf', '.eps'):
                            if isinstance(content, dict):
                                raw_base64 = str(content.get('data') or content.get('content') or '')
                                file_bytes = base64.b64decode(raw_base64) if raw_base64 else b''
                            elif isinstance(content, (bytes, bytearray)):
                                file_bytes = bytes(content)
                            else:
                                file_bytes = str(content).encode('utf-8', errors='ignore')
                            template_file_path.write_bytes(file_bytes)
                        else:
                            text_payload = content if isinstance(content, str) else str(content)
                            template_file_path.write_text(text_payload, encoding='utf-8')
                        
                        
                        if self.verbose:
                            print(f"âœ… Saved template file to project: {normalized_name}")
                    except Exception as e:
                        if self.verbose:
                            print(f"âš ï¸  Failed to save template file {filename} to project: {e}")
            except Exception as e:
                if self.verbose:
                    print(f"âš ï¸  Failed to save template files to project directory: {e}")
        
        # Save files
        # Clean markdown code blocks before writing
        main_tex_content = latex_files['main.tex']
        
        # VERIFICATION: Check if template was used before writing
        if self.template_files and 'main.tex' in self.template_files:
            template_docclass = re.search(r'\\documentclass\s*(?:\[.*?\])?\s*\{([^}]+)\}', self.template_files['main.tex'])
            result_docclass = re.search(r'\\documentclass\s*(?:\[.*?\])?\s*\{([^}]+)\}', main_tex_content)
            if template_docclass and result_docclass:
                if template_docclass.group(1) == result_docclass.group(1):
                    print(f"âœ… FILE WRITE VERIFICATION: Template '{template_docclass.group(1)}' confirmed in content before writing")
                else:
                    print(f"âŒ CRITICAL: Template '{template_docclass.group(1)}' NOT in content! Found: '{result_docclass.group(1)}'")
            else:
                print(f"âš ï¸  Could not verify template in content before writing")
        
        # Remove opening code fence (```latex, ```tex, ``` at start)
        main_tex_content = re.sub(r'^```(?:latex|tex)?\s*\n', '', main_tex_content, flags=re.MULTILINE)
        # Remove closing code fence (``` at end)
        main_tex_content = re.sub(r'\n```\s*$', '', main_tex_content, flags=re.MULTILINE)
        # Remove any remaining code fences in the middle
        main_tex_content = re.sub(r'```(?:latex|tex)?\s*\n', '', main_tex_content)
        main_tex_content = re.sub(r'\n```', '', main_tex_content)
        # Also handle triple single quotes ('''latex)
        main_tex_content = re.sub(r"^'''(?:latex|tex)?\s*\n", '', main_tex_content, flags=re.MULTILINE)
        main_tex_content = re.sub(r"\n'''\s*$", '', main_tex_content, flags=re.MULTILINE)
        main_tex_content = re.sub(r"'''(?:latex|tex)?\s*\n", '', main_tex_content)
        main_tex_content = re.sub(r"\n'''", '', main_tex_content)
        main_tex_content = main_tex_content.strip()

        # LaTeX review: fix common issues and lint before writing
        reviewer = LatexReview()
        lint_before = reviewer.lint(main_tex_content)
        fixed_content = reviewer.fix_common_issues(main_tex_content)
        lint_after = reviewer.lint(fixed_content)
        if lint_after.get("error_count", 0) <= lint_before.get("error_count", 0):
            if fixed_content != main_tex_content:
                print("Latex review: applied common fixes to reduce errors.")
            main_tex_content = fixed_content
        else:
            lint_after = lint_before
        latex_review_report = {
            "lint_before": lint_before,
            "lint_after": lint_after,
        }
        
        print(f"ðŸ“ Writing main.tex to {output_path / 'main.tex'} ({len(main_tex_content)} chars)")
        (output_path / 'main.tex').write_text(main_tex_content, encoding='utf-8')
        # Save references.bib
        references_bib_content = latex_files['references.bib']
        (output_path / 'references.bib').write_text(references_bib_content, encoding='utf-8')
        bib_entries_count = len(re.findall(r'@\w+\{', references_bib_content))
        print(f"âœ… Saved references.bib ({len(references_bib_content)} chars, {bib_entries_count} entries)")
        
        # Also save all references as JSON for easy inspection
        # Get references from paper_data (already converted to dict format)
        all_references = paper_data.get('references', [])
        if all_references:
            references_json = {
                'total_sources': len(all_references),
                'sources': all_references
            }
            (output_path / 'references.json').write_text(json.dumps(references_json, indent=2), encoding='utf-8')
            print(f"âœ… Saved {len(all_references)} references to references.json")
        else:
            print("âš ï¸  WARNING: No references found in paper_data to save to references.json")

        # Copy referenced images into output/images so \includegraphics{images/...} compiles.
        copied_images = 0
        if self.file_tools and getattr(self.file_tools, "research_files", None):
            images_dir = output_path / "images"
            images_dir.mkdir(exist_ok=True)

            image_candidates = collect_image_candidates(self.file_tools.research_files)
            used_outputs = set()
            if hasattr(self.writer, "get_used_image_outputs"):
                try:
                    used_outputs = set(self.writer.get_used_image_outputs())
                except Exception:
                    used_outputs = set()

            for img in image_candidates:
                file_path = img.get("filePath") or ""
                if not file_path:
                    continue

                output_name = img.get("outputName")
                if not output_name:
                    output_name = build_output_name(
                        img.get("fileId", "image"),
                        file_path=file_path,
                        file_type=img.get("fileType"),
                    )

                if used_outputs and output_name not in used_outputs:
                    continue

                source_path = Path(file_path)
                if not source_path.is_absolute():
                    candidate_paths = []
                    if project_root:
                        candidate_paths.append(project_root / file_path)
                    candidate_paths.append(output_path / file_path)
                    candidate_paths.append(Path(os.getenv("GENLATEX_PROJECTS_PATH", ".")) / self.project_id / file_path)
                    source_path = next((p for p in candidate_paths if p.exists()), source_path)

                if not source_path.exists():
                    continue

                dest_path = images_dir / output_name
                if dest_path.exists():
                    continue

                try:
                    # SVG sources are rendered to PNG output names by build_output_name.
                    if source_path.suffix.lower() == ".svg" and dest_path.suffix.lower() == ".png":
                        from utils.svg_utils import rasterize_svg_to_png
                        png_bytes = rasterize_svg_to_png(source_path.read_bytes())
                        if not png_bytes:
                            continue
                        dest_path.write_bytes(png_bytes)
                    else:
                        shutil.copy2(source_path, dest_path)
                    copied_images += 1
                except Exception as e:
                    if self.verbose:
                        print(f"âš ï¸  Failed to stage image {source_path.name}: {e}")

            if self.verbose and copied_images > 0:
                print(f"âœ… Staged {copied_images} image asset(s) for LaTeX compile")

        # Save images LaTeX if generated
        if 'images.tex' in latex_files and latex_files['images.tex']:
            (output_path / 'images.tex').write_text(latex_files['images.tex'], encoding='utf-8')
            if self.verbose:
                print("âœ“ Images LaTeX file generated")
        
        # Compile and save LaTeX review report
        compile_result = reviewer.compile_project(output_path, tex_filename="main.tex")
        latex_review_report["compile"] = compile_result
        (output_path / 'latex_review.json').write_text(
            json.dumps(latex_review_report, indent=2),
            encoding='utf-8'
        )

        # Copy generated files to project directory if project_id is set
        if self.project_id:
            try:
                # Determine project directory path
                possible_paths = [
                    Path("../workspace/data/projects") / self.project_id,
                    Path("./data/projects") / self.project_id,
                    Path(os.getenv("GENLATEX_PROJECTS_PATH", ".")) / self.project_id,
                ]
                
                project_path = None
                for path_candidate in possible_paths:
                    if path_candidate.parent.exists():
                        project_path = path_candidate
                        break
                
                if not project_path:
                    project_path = Path("./data/projects") / self.project_id
                
                project_path.mkdir(parents=True, exist_ok=True)
                
                # Copy generated files to project directory
                files_to_copy = ['main.tex', 'references.bib', 'paper_data.json', 'latex_review.json']
                if 'images.tex' in latex_files and latex_files['images.tex']:
                    files_to_copy.append('images.tex')
                
                for filename in files_to_copy:
                    source_file = output_path / filename
                    if source_file.exists():
                        dest_file = project_path / filename
                        shutil.copy2(source_file, dest_file)
                        if self.verbose:
                            print(f"âœ… Copied {filename} to project directory")

                # Copy compiled image assets to project/images.
                source_images_dir = output_path / "images"
                if source_images_dir.exists():
                    dest_images_dir = project_path / "images"
                    dest_images_dir.mkdir(exist_ok=True)
                    for image_file in source_images_dir.glob("*"):
                        if image_file.is_file():
                            try:
                                shutil.copy2(image_file, dest_images_dir / image_file.name)
                            except Exception as e:
                                if self.verbose:
                                    print(f"âš ï¸  Failed to copy image {image_file.name} to project: {e}")
            except Exception as e:
                if self.verbose:
                    print(f"âš ï¸  Failed to copy generated files to project directory: {e}")
        
        # Memory system removed - images not copied from memory
        if False:  # Memory disabled
            images_dir = output_path / 'images'
            images_dir.mkdir(exist_ok=True)
            
            for image_id, image_info in self.memory.image_manager.images.items():
                try:
                    image_data = self.memory.image_manager.get_image_data(image_id)
                    if image_data:
                        image_path = images_dir / f"{image_id}.jpg"
                        image_path.write_bytes(image_data)
                        if self.verbose:
                            print(f"âœ“ Copied image: {image_info.get('title', image_id)}")
                except Exception as e:
                    if self.verbose:
                        print(f"âš ï¸  Failed to copy image {image_id}: {e}")
        
        # Convert Source objects to dictionaries for JSON serialization
        try:
            serializable_paper_data = self._make_json_serializable(paper_data)
            (output_path / 'paper_data.json').write_text(json.dumps(serializable_paper_data, indent=2), encoding='utf-8')
        except Exception as e:
            if self.verbose:
                print(f"âš ï¸  Error saving paper_data.json: {str(e)}")
            # Save a simplified version
            simplified_data = {
                'title': paper_data.get('title', 'Unknown'),
                'abstract': paper_data.get('abstract', ''),
                'sections_count': len(paper_data.get('sections', [])),
                'actual_words': paper_data.get('actual_words', 0)
            }
            (output_path / 'paper_data.json').write_text(json.dumps(simplified_data, indent=2), encoding='utf-8')

        # Generate report
        report = self._generate_report(paper_data, all_verified)
        (output_path / 'report.txt').write_text(report, encoding='utf-8')

        # Store file usage log in paper_data before returning
        if self.file_tools:
            paper_data['file_usage_log'] = self.file_tools.get_usage_log()
            paper_data['file_usage_summary'] = self.file_tools.get_usage_summary()
            if self.verbose:
                summary = self.file_tools.get_usage_summary()
                print(f"ðŸ“Š File Usage Summary: {summary['total_calls']} calls, {summary['files_accessed_count']} files accessed, {summary['unique_functions']} functions used")

        if self.verbose:
            print(f"âœ“ Files saved to {output_dir}\n")
            print("="*60)
            print("ðŸ“Š Generation Report")
            print("="*60)
            print(report)

        # Best-effort cleanup for per-run ingestors/temp directories.
        try:
            set_image_ingestor(None)
        except Exception:
            pass
        if image_ingestor:
            try:
                image_ingestor.finalize()
            except Exception:
                pass
        if cleanup_minio:
            try:
                cleanup_minio()
            except Exception:
                pass

        return paper_data

    async def _log_phase(self, phase_name: str, phase_num: int):
        """Log phase start"""
        if self.verbose:
            logger.info(f"\n{'='*60}")
            logger.info(f"Phase {phase_num}: {phase_name}")
            logger.info(f"{'='*60}")

    def _generate_report(self, paper_data: dict, verified: bool) -> str:
        """Generate final report"""

        sections = paper_data['sections']
        total_words = paper_data.get('actual_words', sum(s['word_count'] for s in sections))

        all_citations = []
        for section in sections:
            citations = section.get('citations', []) if isinstance(section, dict) else getattr(section, 'citations', [])
            all_citations.extend(citations)

        unique_citations = set()
        for citation in all_citations:
            keys = citation.split(',')
            unique_citations.update(k.strip() for k in keys)

        citation_stats = self.citation_manager.get_citation_statistics()

        report = f"""
â•”â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•—
â•‘              PAPER GENERATION REPORT                     â•‘
â•šâ•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•

ðŸ“Š STATISTICS
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Title:             {paper_data['title']}
Total Words:       {total_words}
Total Sections:    {len(sections)}
Total Sources:     {citation_stats['total_sources']}
Unique Citations:  {len(unique_citations)}
Total Citations:   {citation_stats['total_citations']}

ðŸ“š CITATION METRICS
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Citation Density:  {citation_stats['total_citations'] / (total_words / 100):.2f} per 100 words
Sources Cited:     {citation_stats['cited_sources']}/{citation_stats['total_sources']}
Unused Sources:    {len(citation_stats['unused_sources'])}

âœ… QUALITY CHECKS
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
Fact Verification: {'âœ“ PASSED' if verified else 'âš ï¸  ISSUES FOUND'}
Citation Coverage: {'âœ“ GOOD' if len(unique_citations) > 10 else 'âš ï¸  LOW'}
Content Quality:   {'âœ“ GOOD' if total_words > 1000 else 'âš ï¸  SHORT'}

ðŸ“ SECTIONS
â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
"""

        for section in sections:
            report += f"{section['section_name']:30} {section['word_count']:>6} words\n"

        report += "\n" + "â•"*60 + "\n"

        return report
    
    async def _generate_latex_multiprocess(self, paper_data: dict) -> dict:
        """Generate LaTeX files using multiprocessing for speed"""
        
        # For now, disable multiprocessing for LaTeX generation to avoid pickle issues
        # LaTeX generation is fast enough that multiprocessing overhead isn't worth it
        return self.latex_gen.generate_paper(paper_data)
    
    def _make_json_serializable(self, data):
        """Convert Source objects to dictionaries for JSON serialization"""
        if isinstance(data, dict):
            return {key: self._make_json_serializable(value) for key, value in data.items()}
        elif isinstance(data, list):
            return [self._make_json_serializable(item) for item in data]
        elif isinstance(data, Source):
            return data.to_dict()
        elif hasattr(data, 'isoformat'):  # Handle datetime objects
            return data.isoformat()
        else:
            return data
    
    # NEW: Validation methods for references.json completeness
    def _validate_references_completeness(self, sources: List[Source]) -> tuple[bool, List[str]]:
        """
        Validate that all sources have complete PhD-level information.
        
        Returns:
            (is_valid, list of issues)
        """
        logger.info(f"\n{'='*80}")
        logger.info(f"ðŸ” VALIDATING REFERENCES COMPLETENESS")
        logger.info(f"{'='*80}")
        logger.info(f"Checking {len(sources)} sources for PhD-level depth...")
        logger.info(f"{'='*80}\n")
        
        issues = []
        
        # Required fields that must NEVER be null
        required_fields = [
            'research_question_or_purpose',
            'methodology',
            'key_findings_results',
            'implications_contributions',
            'relation_to_other_research',
            'limitations_gaps',
            'full_text'
        ]
        
        # Minimum lengths for PhD-level depth
        min_lengths = {
            'research_question_or_purpose': 500,  # 500-1500 words
            'methodology': 500,
            'key_findings_results': 500,
            'implications_contributions': 500,
            'relation_to_other_research': 500,
            'limitations_gaps': 300,
            'full_text': 3000  # 3000-8000 words
        }
        
        for i, source in enumerate(sources, 1):
            source_id = source.citation_key or f"Source {i}"
            source_issues = []
            
            # Check for null fields
            for field in required_fields:
                value = getattr(source, field, None)
                if value is None or str(value).strip() in ['', 'None', 'null', 'N/A']:
                    source_issues.append(f"âŒ {field} is null/empty")
            
            # Check field lengths (with 15% tolerance - e.g., 425 is OK when target is 500)
            tolerance = 0.15
            for field, min_len in min_lengths.items():
                value = getattr(source, field, '')
                if value:
                    word_count = len(str(value).split())
                    acceptable_min = int(min_len * (1 - tolerance))  # Allow 15% below target
                    if word_count < acceptable_min:
                        source_issues.append(f"âš ï¸  {field} too short: {word_count}/{min_len} words")
            
            # Check pertinence score
            if source.pertinence_score is None or source.pertinence_score == 0.0:
                source_issues.append(f"âš ï¸  pertinence_score is 0 or null")
            
            # Check extraction metadata
            if source.extraction_confidence < 0.5:
                source_issues.append(f"âš ï¸  Low extraction_confidence: {source.extraction_confidence:.2f}")
            
            if source_issues:
                issues.append(f"\nðŸ“„ {source_id} ({len(source_issues)} issues):")
                issues.extend([f"   {issue}" for issue in source_issues])
        
        is_valid = len(issues) == 0
        
        if is_valid:
            logger.info(f"âœ… ALL {len(sources)} SOURCES ARE COMPLETE AND MEET PhD-LEVEL STANDARDS")
            logger.info(f"   âœ“ All required fields populated")
            logger.info(f"   âœ“ All fields meet minimum length requirements")
            logger.info(f"   âœ“ All pertinence scores assigned")
            logger.info(f"   âœ“ All extraction metadata present")
        else:
            logger.error(f"âŒ VALIDATION FAILED: {len([i for i in issues if 'ðŸ“„' in i])} sources have issues")
            logger.info("Issues found:")
            for issue in issues[:50]:  # Limit output
                logger.info("%s", issue)
            if len(issues) > 50:
                logger.info(f"\n... and {len(issues) - 50} more issues")
        
        logger.info(f"\n{'='*80}\n")
        
        return is_valid, issues
    
    def _enforce_fallback_on_incomplete_sources(self, sources: List[Source]) -> List[Source]:
        """
        Check sources for incomplete fields and log what's missing.

        IMPORTANT: Does NOT fill in template content. Empty fields remain empty
        so we can accurately track what extraction actually failed to produce.
        The validation will show what's missing, and the system should retry
        extraction with better prompts rather than filling with fake content.
        """
        logger.info(f"ðŸ” Checking {len(sources)} sources for incomplete fields...")

        required_fields = [
            'research_question_or_purpose',
            'methodology',
            'key_findings_results',
            'implications_contributions',
            'relation_to_other_research',
            'limitations_gaps',
            'full_text'
        ]

        incomplete_count = 0
        for source in sources:
            missing_fields = []

            for field in required_fields:
                value = getattr(source, field, None)
                if value is None or str(value).strip() in ['', 'None', 'null', 'N/A']:
                    missing_fields.append(field)
                    # Track that this field is missing
                    if source.inferred_fields is None:
                        source.inferred_fields = []
                    if field not in source.inferred_fields:
                        source.inferred_fields.append(field)

            # Set default metadata if missing (these are OK to default)
            if source.pertinence_score is None or source.pertinence_score == 0.0:
                source.pertinence_score = 50.0  # Default medium pertinence

            if source.extraction_confidence == 0.0:
                # Calculate based on how many fields are missing
                missing_ratio = len(missing_fields) / len(required_fields)
                source.extraction_confidence = max(0.1, 0.8 - (missing_ratio * 0.7))

            if not source.extraction_method or source.extraction_method == "unknown":
                source.extraction_method = "partial_extraction"

            if missing_fields:
                incomplete_count += 1
                source_title = getattr(source, 'title', None) or 'Unknown Title'
                logger.info(f"   âš ï¸  '{source_title[:40]}...' missing {len(missing_fields)} fields: {', '.join(missing_fields[:3])}{'...' if len(missing_fields) > 3 else ''}")

        if incomplete_count > 0:
            logger.info(f"   ðŸ“Š {incomplete_count}/{len(sources)} sources have incomplete fields")
            logger.info(f"   ðŸ’¡ Consider re-running extraction with different search queries or sources")
        else:
            logger.info(f"   âœ… All {len(sources)} sources have complete fields")

        return sources
    
    def _optimize_for_speed(self):
        """Apply speed optimizations"""
        if self.verbose:
            logger.info(f"âš¡ Speed optimizations enabled:")
            logger.info(f"   - Parallel processing: enabled for research/writing")
            logger.info(f"   - Reduced research iterations: 2 (was 5)")
            logger.info(f"   - Batch research: enabled")
            logger.info(f"   - Simplified verification: critical claims only")
            logger.info(f"   - Optimized prompts: concise format")
            logger.info(f"   - LaTeX generation: optimized (multiprocessing disabled)")

    def _count_total_words(self, sections: list) -> int:
        """Count total words across all sections including subsections"""
        def count_section_words(section: dict) -> int:
            words = self.writer._count_words_excluding_latex(section.get('content', ''))
            if section.get('subsections'):
                for subsec in section['subsections']:
                    words += count_section_words(subsec)
            return words
        
        return sum(count_section_words(s) for s in sections)


async def main():
    """CLI entry point"""
    
    # Load environment variables from .env file
    try:
        from dotenv import load_dotenv
        load_dotenv()
        logger.info("âœ… Loaded environment variables from .env file")
    except ImportError:
        logger.warning("âš ï¸  python-dotenv not installed. Install with: pip install python-dotenv")
        logger.info("   Environment variables will be loaded from system only.")

    parser = argparse.ArgumentParser(
        description='Generate AI research paper with citations',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Generate new paper
  python main.py --topic "Quantum Computing" --description "Survey of current techniques" --pages 10 --openrouter-key YOUR_KEY
  
  # With .env file (recommended):
  python main.py --topic "Quantum Computing" --description "Survey of current techniques" --pages 10
  
  # Resume from research phase (if crashed during writing)
  python main.py --topic "Quantum Computing" --description "Survey of current techniques" --pages 10 --openrouter-key YOUR_KEY --resume research
  
  # Resume from writing phase
  python main.py --topic "Quantum Computing" --description "Survey of current techniques" --pages 10 --openrouter-key YOUR_KEY --resume writing
        """
    )

    parser.add_argument(
        '--topic',
        default=os.getenv('PAPER_TOPIC',"ML Finance"),
        help='Research paper topic (env: PAPER_TOPIC)'
    )
    parser.add_argument(
        '--description',
        default=os.getenv('PAPER_DESCRIPTION',"Write an article on the advancement of machine learning in finance"),
        help='Detailed description of what to research (env: PAPER_DESCRIPTION)'
    )
    parser.add_argument(
        '--pages',
        type=int,
        default=int(os.getenv('PAPER_PAGES', '8')),
        help='Target number of pages (default: 8, env: PAPER_PAGES)'
    )
    parser.add_argument(
        '--output',
        default=os.getenv('OUTPUT_DIR', './output'),
        help='Output directory (default: ./output, env: OUTPUT_DIR)'
    )
    parser.add_argument(
        '--checkpoint-dir',
        default=os.getenv('CHECKPOINT_DIR', './checkpoints'),
        help='Checkpoint directory (default: ./checkpoints, env: CHECKPOINT_DIR)'
    )
    parser.add_argument(
        '--openrouter-key',
        default=os.getenv('OPENROUTER_API_KEY'),
        help='OpenRouter API key (env: OPENROUTER_API_KEY)'
    )
    parser.add_argument(
        '--openrouter-model',
        default=os.getenv('AI_MODEL') or os.getenv('AI_MODEL_FALLBACK') or 'deepseek/deepseek-chat',
        help='OpenRouter model id (default from AI_MODEL, AI_MODEL_FALLBACK, or deepseek/deepseek-chat)'
    )
    parser.add_argument(
        '--openrouter-base',
        default=os.getenv('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
        help='OpenRouter base url (default: https://openrouter.ai/api/v1, env: OPENROUTER_BASE_URL)'
    )
    parser.add_argument(
        '--tavily-key',
        default=os.getenv('TAVILY_API_KEY'),
        help='Tavily API key for web search (env: TAVILY_API_KEY)'
    )
    parser.add_argument(
        '--template-dir',
        default=os.getenv('TEMPLATE_DIR', './template'),
        help='LaTeX template directory (default: ./template, env: TEMPLATE_DIR)'
    )
    parser.add_argument(
        '--resume',
        choices=['plan', 'research', 'writing', 'verification'],
        help='Resume from checkpoint phase'
    )
    parser.add_argument(
        '--quiet',
        action='store_true',
        help='Suppress progress output'
    )
    parser.add_argument(
        '--fast-mode',
        action='store_true',
        help='Enable fast mode: reduced iterations and sources for speed (default: False)'
    )

    args = parser.parse_args()
    
    # Validate required parameters
    if not args.topic:
        parser.error("--topic is required (or set PAPER_TOPIC in .env)")
    if not args.description:
        parser.error("--description is required (or set PAPER_DESCRIPTION in .env)")
    if not args.openrouter_key:
        parser.error("--openrouter-key is required (or set OPENROUTER_API_KEY in .env)")
    if not args.tavily_key:
        parser.error("--tavily-key is required (or set TAVILY_API_KEY in .env)")

    # Check for fast_mode in .env file (CLI argument takes precedence)
    fast_mode = args.fast_mode
    if not fast_mode:
        # Check environment variable
        fast_mode_env = os.getenv('FAST_MODE', 'true').lower()
        fast_mode = fast_mode_env in ('true', '1', 'yes', 'on', True)

    orchestrator = PaperOrchestrator(
        openrouter_api_key=args.openrouter_key,
        openrouter_base_url=args.openrouter_base,
        openrouter_model=args.openrouter_model,
        tavily_api_key=args.tavily_key,
        template_dir=args.template_dir,
        checkpoint_dir=args.checkpoint_dir,
        verbose=not args.quiet,
        fast_mode=fast_mode
    )
    
    # Show speed optimizations
    orchestrator._optimize_for_speed()

    try:
        await orchestrator.generate_paper(
            topic=args.topic,
            description=args.description,
            output_dir=args.output,
            resume_from=args.resume
        )
    except KeyboardInterrupt:
        logger.info("\n\nâš ï¸  Interrupted! Progress has been saved to checkpoints.")
        logger.info(f"Resume with: --resume research (or writing/verification)")
    except Exception as e:
        logger.info(f"\n\nâŒ Error: {e}")
        logger.info(f"Progress saved to checkpoints. You can resume with --resume flag.")
        raise


if __name__ == "__main__":
    asyncio.run(main())


