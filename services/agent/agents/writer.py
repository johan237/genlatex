# agents/writer.py
"""
WritingAgent (LaTeX-safe)

Key fixes vs your current version:
- Your prompts SHOW WRONG LaTeX (e.g., \\begin{{itemize}}, \\cite{{key}}). The model copies that and produces broken LaTeX.
- Your generated sample shows classic failures caused by that: \\textbackslash{}subsection..., \\subsection}{...}, nested enumerate duplication, itemize/enumerate mixing, duplicate \\section blocks, etc.
- Your current AI “fix latex mistakes” step can *add* errors (LLMs often hallucinate braces/environments).
- This rewrite:
  1) Uses prompts with correct LaTeX examples (\begin{itemize}, \cite{key})
  2) Adds a deterministic LaTeX sanitizer that fixes the most common structural breakages your pipeline creates
  3) Keeps your async flow + citation matcher integration
  4) Makes “LLM LaTeX fixing” optional (default OFF) because it’s a frequent source of new syntax bugs
"""

from __future__ import annotations

import asyncio
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_core.prompts import MessagesPlaceholder

from utils.image_assets import collect_image_candidates


# -----------------------------
# Deterministic LaTeX sanitizer
# -----------------------------

@dataclass
class LatexSanitizerConfig:
    """
    Conservative, deterministic cleanups only.
    We do NOT attempt to fully "parse" LaTeX—just fix common corruptions we saw in your output.
    """
    remove_markdown_fences: bool = True
    fix_textbackslash_commands: bool = True
    fix_misbraced_sections: bool = True
    fix_double_begin_enumerate: bool = True
    fix_itemize_enumerate_mix: bool = True
    remove_duplicate_section_titles: bool = True


class LatexSanitizer:
    """
    Fixes common model-induced LaTeX syntax breakages.
    This is intentionally rule-based to avoid introducing new LLM errors.
    """

    # Commands that are commonly broken as \textbackslash{}command
    _CMD_FIXES = [
        "item",
        "begin",
        "end",
        "section",
        "subsection",
        "subsubsection",
        "paragraph",
        "subparagraph",
        "cite",
        "label",
        "ref",
        "emph",
        "textbf",
        "textit",
        "underline",
    ]

    def __init__(self, cfg: Optional[LatexSanitizerConfig] = None):
        self.cfg = cfg or LatexSanitizerConfig()

    def clean(self, content: str) -> str:
        if not content:
            return content

        x = content

        if self.cfg.remove_markdown_fences:
            x = self._remove_markdown_fences(x)

        # Normalize newlines a bit
        x = x.replace("\r\n", "\n").replace("\r", "\n")

        if self.cfg.fix_textbackslash_commands:
            x = self._fix_textbackslash_command_tokens(x)

        if self.cfg.fix_misbraced_sections:
            x = self._fix_misbraced_section_commands(x)

        if self.cfg.fix_double_begin_enumerate:
            x = self._fix_double_begin_enumerate(x)

        if self.cfg.fix_itemize_enumerate_mix:
            x = self._fix_itemize_with_embedded_enumerate_items(x)

        if self.cfg.remove_duplicate_section_titles:
            x = self._remove_duplicate_section_heading_lines(x)

        # Light cleanup of excessive blank lines
        x = re.sub(r"\n{4,}", "\n\n\n", x).strip()

        return x

    @staticmethod
    def _remove_markdown_fences(content: str) -> str:
        # Remove ```latex ... ``` or ``` ... ```
        content = re.sub(r"^\s*```(?:latex|tex)?\s*\n", "", content, flags=re.IGNORECASE)
        content = re.sub(r"\n\s*```\s*$", "", content)
        # Remove any stray mid fences
        content = re.sub(r"\n\s*```(?:latex|tex)?\s*\n", "\n", content, flags=re.IGNORECASE)
        content = re.sub(r"\n\s*```\s*\n", "\n", content)
        return content.strip()

    def _fix_textbackslash_command_tokens(self, s: str) -> str:
        # Convert "\textbackslash{}subsection" -> "\subsection"
        # Accept variants with spaces: \textbackslash{} subsection
        for cmd in self._CMD_FIXES:
            s = re.sub(
                rf"\\textbackslash\{{\}}\s*{cmd}\b",
                rf"\\{cmd}",
                s,
            )
        # Also fix the common typo: "\textbackslash{}subsection\textit{{" → "\subsection\textit{"
        # We'll let the misbrace fixer handle the braces.
        return s

    @staticmethod
    def _fix_misbraced_section_commands(s: str) -> str:
        """
        Fix patterns like:
          \subsection}\{Title\}   -> \subsection{Title}
          \subsubsection}\{Title\} -> \subsubsection{Title}
          \subsection}\{Title\} with extra braces
          \subsection}\{Acceleration of ...\}
        """
        # \subsection}\{... -> \subsection{...
        s = re.sub(r"(\\(sub)*section)\}\s*\{", r"\1{", s)
        s = re.sub(r"(\\subsubsection)\}\s*\{", r"\1{", s)
        s = re.sub(r"(\\paragraph)\}\s*\{", r"\1{", s)

        # Fix malformed starred forms: \subsection*}\{ -> \subsection*{
        s = re.sub(r"(\\(sub)*section\*)\}\s*\{", r"\1{", s)
        s = re.sub(r"(\\subsubsection\*)\}\s*\{", r"\1{", s)

        # Fix \subsection}\{Title (missing closing brace)
        # If a line starts with \subsection{ and has no closing }, try to close at end-of-line
        def close_unclosed(m: re.Match) -> str:
            line = m.group(0)
            if line.count("{") > line.count("}"):
                return line + "}"
            return line

        s = re.sub(r"^(\\(sub)*section\*?\{[^\n]*)$", close_unclosed, s, flags=re.MULTILINE)
        s = re.sub(r"^(\\subsubsection\*?\{[^\n]*)$", close_unclosed, s, flags=re.MULTILINE)
        s = re.sub(r"^(\\paragraph\*?\{[^\n]*)$", close_unclosed, s, flags=re.MULTILINE)

        return s

    @staticmethod
    def _fix_double_begin_enumerate(s: str) -> str:
        """
        You had:
          \begin{enumerate}
          \begin{enumerate}
              \item ...
          ...
        Collapse consecutive duplicates.
        """
        s = re.sub(
            r"(\\begin\{enumerate\}\s*\n)\s*\\begin\{enumerate\}\s*\n",
            r"\1",
            s,
            flags=re.MULTILINE,
        )
        s = re.sub(
            r"(\\begin\{itemize\}\s*\n)\s*\\begin\{itemize\}\s*\n",
            r"\1",
            s,
            flags=re.MULTILINE,
        )
        return s

    @staticmethod
    def _fix_itemize_with_embedded_enumerate_items(s: str) -> str:
        """
        Common corruption in your sample:
          \begin{itemize}
          \begin{enumerate}
              \textbackslash{}item ...
        That becomes:
          \begin{itemize}
              \item ...
        i.e., remove the inner enumerate wrapper if it's immediately inside itemize
        and there are no enumerate-specific constructs other than \item lines.

        We keep this conservative: only remove a nested enumerate that begins
        immediately after \begin{itemize} (allow blank lines).
        """
        # Remove \begin{enumerate} right after \begin{itemize}
        s = re.sub(
            r"(\\begin\{itemize\}\s*\n)(?:\s*\n)*\\begin\{enumerate\}\s*\n",
            r"\1",
            s,
            flags=re.MULTILINE,
        )
        # Remove matching \end{enumerate} right before \end{itemize}
        s = re.sub(
            r"\\end\{enumerate\}\s*\n(?:\s*\n)*(\\end\{itemize\})",
            r"\1",
            s,
            flags=re.MULTILINE,
        )
        return s

    @staticmethod
    def _remove_duplicate_section_heading_lines(s: str) -> str:
        """
        You had patterns like:
          \section{Introduction}
          ...
          \section{Introduction}
          Introduction text...
        If the model repeats a \section{X} line twice within a short distance, remove the later one.

        Conservative heuristic: remove consecutive duplicates (ignoring blank lines).
        """
        lines = s.split("\n")
        out: List[str] = []
        last_section: Optional[str] = None
        blank_buffer: List[str] = []

        section_re = re.compile(r"^\s*\\section\{([^}]+)\}\s*$")

        for ln in lines:
            m = section_re.match(ln)
            if m:
                title = m.group(1).strip()
                # Flush buffered blanks before deciding
                if title == last_section:
                    # drop duplicate section line, but keep blank buffer
                    # (do nothing)
                    continue
                # keep blanks then line
                out.extend(blank_buffer)
                blank_buffer = []
                out.append(ln)
                last_section = title
                continue

            if ln.strip() == "":
                blank_buffer.append(ln)
            else:
                out.extend(blank_buffer)
                blank_buffer = []
                out.append(ln)

        out.extend(blank_buffer)
        return "\n".join(out)


# -----------------------------
# Writing Agent
# -----------------------------

class WritingAgent:
    """Agent to write paper content with citations (LaTeX-safe)."""

    def __init__(
        self,
        llm: ChatOpenAI,
        citation_manager=None,
        citation_matcher=None,
        verbose: bool = False,
        temperature: float = 0.5,
        enable_llm_latex_fix: bool = False,  # default OFF: deterministic sanitizer is safer
        sanitizer: Optional[LatexSanitizer] = None,
    ):
        self.llm = llm.bind(temperature=temperature)
        self._abstract_cache: Dict[str, str] = {}
        self.citation_manager = citation_manager
        self.citation_matcher = citation_matcher
        self.template_files = None
        self.template_structure = None
        self.verbose = verbose
        self.special_instructions = None
        self.file_tools = None  # FileTools for on-demand file access during writing
        self.zotero_tools = None  # ZoteroTools for on-demand Zotero library access during writing
        self._used_image_outputs: set = set()

        self.enable_llm_latex_fix = enable_llm_latex_fix
        self.sanitizer = sanitizer or LatexSanitizer()

    def set_special_instructions(self, instructions: Optional[str]):
        """Set special formatting/style instructions to follow during writing"""
        self.special_instructions = instructions

    def set_file_tools(self, file_tools):
        """Set FileTools for on-demand access to research data files during writing"""
        self.file_tools = file_tools
        if file_tools and self.verbose:
            print(f"📁 WritingAgent: FileTools set with {len(file_tools.research_files)} data files available")

    def set_zotero_tools(self, zotero_tools):
        """Set ZoteroTools for on-demand access to Zotero library during writing"""
        self.zotero_tools = zotero_tools
        if zotero_tools and self.verbose:
            print(f"📚 WritingAgent: ZoteroTools set for on-demand Zotero library access")

    def _get_relevant_file_data(self, section_name: str, key_points: list) -> str:
        """Get relevant data from uploaded files for this section.

        Searches files by metadata and content, then reads content. For files with
        extracted content (e.g. PDFs), also searches within content for better snippets.
        Returns formatted context string for the LLM.
        """
        if not self.file_tools or not self.file_tools.research_files:
            return ""

        # Build search query from section name and key points
        search_terms = [section_name] + (key_points[:5] if key_points else [])
        query = " ".join(search_terms)

        # Search files (now content-aware: uses full text when available)
        search_results = self.file_tools.search_files(query, limit=8)

        # If no metadata/content matches, still include first few files so the writer has something to use
        if not search_results and self.file_tools.research_files:
            search_results = [
                {
                    'fileId': f.get('fileId'),
                    'fileName': f.get('fileName', 'Unknown'),
                    'relevanceScore': 0.5
                }
                for f in self.file_tools.research_files[:5]
            ]

        if not search_results:
            return ""

        file_context_parts = ["\n=== UPLOADED RESEARCH DATA ==="]
        file_context_parts.append("The following data from uploaded files may be relevant to this section. Use it substantively in your writing.\n")

        files_read = 0
        max_files = 5  # Allow more files so key data is not missed
        max_chars_per_file = 4000  # More content per file for richer use
        max_lines_per_file = 100

        for result in search_results:
            if files_read >= max_files:
                break

            file_id = result.get('fileId')
            file_name = result.get('fileName', 'Unknown')
            try:
                relevance = float(result.get('relevanceScore', 0))
            except (TypeError, ValueError):
                relevance = 0.5

            if not file_id:
                continue

            # Include files with any relevance; low threshold so sparse metadata still gets content
            if relevance < 0.1 and result.get('relevanceScore') is not None:
                continue

            # Prefer content search for files with extracted content (PDFs): get section-specific snippets
            content = None
            if self.file_tools.has_extracted_content(file_id):
                search_in_content = self.file_tools.search_extracted_content(
                    file_id, query, context_chars=300
                )
                if not search_in_content.get('error') and search_in_content.get('matches'):
                    parts = [
                        m.get('context', '') for m in search_in_content['matches'][:5]
                    ]
                    content = "\n\n".join(parts)
            if not content:
                content_result = self.file_tools.read_file_content(
                    file_id, max_lines=max_lines_per_file
                )
                if content_result and 'content' in content_result and not content_result.get('error'):
                    content = content_result['content']

            if content and content.strip():
                if len(content) > max_chars_per_file:
                    content = content[:max_chars_per_file] + "\n... [truncated]"

                file_context_parts.append(f"\n📄 FILE: {file_name} (relevance: {relevance:.0%})")
                file_context_parts.append("---")
                file_context_parts.append(content)
                file_context_parts.append("---\n")
                files_read += 1

        if files_read == 0:
            return ""

        file_context_parts.append("=== END RESEARCH DATA ===\n")
        file_context_parts.append("INSTRUCTION: Use this data substantively in your writing. Cite specific findings, numbers, or quotes where relevant. Do not summarize vaguely—incorporate concrete details from the files.")

        return "\n".join(file_context_parts)

    def _get_relevant_image_context(self, section_name: str, key_points: list, search_queries: Optional[list] = None):
        """Select relevant images and build context block for the LLM."""
        if not self.file_tools or not self.file_tools.research_files:
            return "", []

        images = collect_image_candidates(self.file_tools.research_files)
        images = [img for img in images if img.get("filePath") and Path(img["filePath"]).exists()]
        if not images:
            return "", []

        key_points_list = key_points if isinstance(key_points, list) else ([key_points] if key_points else [])
        search_queries_list = search_queries if isinstance(search_queries, list) else ([search_queries] if search_queries else [])
        safe_section = section_name if isinstance(section_name, str) else str(section_name or "")

        terms = [safe_section] + (key_points_list[:6] if key_points_list else [])
        if search_queries_list:
            terms += search_queries_list[:4]

        phrase_terms = []
        for t in terms:
            if isinstance(t, str):
                norm = re.sub(r"\s+", " ", t.strip().lower())
                if norm:
                    phrase_terms.append(norm)

        stopwords = {
            "the", "and", "or", "of", "for", "to", "in", "on", "with", "a", "an", "by",
            "from", "based", "using", "use", "study", "analysis", "overview", "introduction",
            "background", "section", "paper", "research"
        }
        token_terms = set()
        for term in phrase_terms:
            for part in re.findall(r"[a-z0-9]+", term):
                if len(part) <= 2 or part in stopwords:
                    continue
                token_terms.add(part)

        def score_image(img: Dict[str, Any]) -> tuple[int, int]:
            meta = img.get("metadata") or {}
            analysis = meta.get("image_analysis") or meta.get("imageAnalysis") or {}
            tags = analysis.get("tags") if isinstance(analysis.get("tags"), list) else []
            keywords = meta.get("keywords") if isinstance(meta.get("keywords"), list) else []
            caption = analysis.get("caption") or ""
            summary = meta.get("summary") or ""
            about = meta.get("about") or ""
            ocr_text = analysis.get("ocr_text") or ""
            file_name = img.get("fileName") or ""

            haystack = " ".join(
                str(p) for p in [
                    caption,
                    summary,
                    about,
                    ocr_text,
                    " ".join(tags),
                    " ".join(keywords),
                    file_name,
                ]
            ).lower()

            score = 0
            for term in phrase_terms:
                if term and term in haystack:
                    score += 3
            for term in token_terms:
                if term in haystack:
                    score += 1

            image_type = (analysis.get("image_type") or "").lower()
            if image_type in {"diagram", "chart", "graph", "flowchart", "architecture", "table", "model", "pipeline", "framework"}:
                score += 2
            elif image_type in {"photo", "portrait", "screenshot"}:
                score -= 1

            if caption:
                score += 1

            quality = len(caption) + len(tags) * 5 + len(ocr_text)
            return score, quality

        scored = []
        for img in images:
            if img["outputName"] in self._used_image_outputs:
                continue
            score, quality = score_image(img)
            if score > 0:
                scored.append((score, quality, img))

        scored.sort(key=lambda x: (x[0], x[1]), reverse=True)
        selected = [img for _, _, img in scored[:2]]

        # Fallback: pick the highest-quality image with metadata if nothing matched.
        if not selected:
            quality_ranked = []
            for img in images:
                if img["outputName"] in self._used_image_outputs:
                    continue
                score, quality = score_image(img)
                if quality > 0:
                    quality_ranked.append((quality, img))
            quality_ranked.sort(key=lambda x: x[0], reverse=True)
            selected = [img for _, img in quality_ranked[:1]]

        # Final fallback: include one unused image even without captions/metadata,
        # but only if no images have been used yet.
        if not selected and not self._used_image_outputs:
            for img in images:
                if img["outputName"] in self._used_image_outputs:
                    continue
                selected = [img]
                break

        if not selected:
            return "", []

        lines = [
            "=== IMAGE ASSETS (USE INLINE IF RELEVANT) ===",
            "Use these images inline with LaTeX figure environments.",
            "Use the exact file path shown in \\includegraphics{...}.",
        ]
        for img in selected:
            meta = img.get("metadata") or {}
            analysis = meta.get("image_analysis") or meta.get("imageAnalysis") or {}
            caption = analysis.get("caption") or meta.get("summary") or ""
            image_type = analysis.get("image_type", "figure")
            tags = ", ".join(analysis.get("tags", []) or [])
            lines.append(f"- file: {img['latexPath']}")
            if caption:
                lines.append(f"  caption: {caption}")
            lines.append(f"  type: {image_type}")
            if tags:
                lines.append(f"  tags: {tags}")
        lines.append("=== END IMAGE ASSETS ===")

        return "\n".join(["", *lines]) + "\n", selected

    def _escape_latex_text(self, text: str) -> str:
        if not text:
            return ""
        replacements = [
            ("\\", "\\\\"),
            ("&", "\\&"),
            ("%", "\\%"),
            ("$", "\\$"),
            ("#", "\\#"),
            ("_", "\\_"),
            ("{", "\\{"),
            ("}", "\\}"),
        ]
        out = text
        for old, new in replacements:
            out = out.replace(old, new)
        return out

    def _append_missing_images(self, content: str, selected: List[Dict[str, Any]]) -> str:
        if not selected:
            return content
        if "\\includegraphics" in content:
            return content

        blocks = []
        for img in selected[:1]:
            analysis = (img.get("metadata") or {}).get("image_analysis") or {}
            caption = analysis.get("caption") or "Figure"
            label = f"fig:{img['outputName'].split('.')[0]}"
            blocks.append("\\begin{figure}[htbp]")
            blocks.append("\\centering")
            blocks.append(f"\\includegraphics[width=0.8\\textwidth]{{{img['latexPath']}}}")
            blocks.append(f"\\caption{{{self._escape_latex_text(caption)}}}")
            blocks.append(f"\\label{{{self._escape_latex_text(label)}}}")
            blocks.append("\\end{figure}")

        if not blocks:
            return content
        return content.rstrip() + "\n\n" + "\n".join(blocks) + "\n"

    def _normalize_image_references(
        self,
        content: str,
        selected: List[Dict[str, Any]],
        all_images: List[Dict[str, Any]]
    ) -> str:
        """Ensure \\includegraphics paths reference available images.

        If an image path is unknown but we have available images, replace it with
        a real path. If no images exist, remove the includegraphics line to avoid
        missing-file errors.
        """
        matches = list(re.finditer(r"\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}", content))
        if not matches:
            return content

        available = selected or all_images or []
        available = [img for img in available if img.get("filePath") and Path(img["filePath"]).exists()]
        if not available:
            return re.sub(r"\\includegraphics(?:\[[^\]]*\])?\{[^}]+\}\n?", "", content)

        allowed = {img.get("latexPath") for img in available if img.get("latexPath")}
        replacement_pool = [img.get("latexPath") for img in available if img.get("latexPath")]
        if not replacement_pool:
            return content

        def pick_replacement(idx: int) -> str:
            return replacement_pool[idx % len(replacement_pool)]

        updated = content
        offset = 0
        for idx, match in enumerate(matches):
            original_path = match.group(1)
            if original_path in allowed:
                continue
            repl = pick_replacement(idx)
            start = match.start(1) + offset
            end = match.end(1) + offset
            updated = updated[:start] + repl + updated[end:]
            offset += len(repl) - (end - start)

        return updated

    def _track_used_images(self, content: str) -> None:
        matches = re.findall(r"\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}", content)
        for path in matches:
            name = Path(path).name.strip()
            if name:
                self._used_image_outputs.add(name)

    def get_used_image_outputs(self) -> List[str]:
        """Return list of output image filenames referenced in generated content."""
        return sorted(self._used_image_outputs)

    def reset_used_images(self) -> None:
        """Reset tracked image usage (call once per paper generation)."""
        self._used_image_outputs = set()

    async def _gather_file_context_with_tools(self, section_name: str, key_points: list) -> str:
        """Use an agent with file tools to gather additional context for this section.
        Runs when file_tools is set; merges with _get_relevant_file_data for richer context.
        """
        if not self.file_tools or not self.file_tools.research_files:
            return ""

        try:
            from tools.file_tool_definitions import create_file_tools
            file_tool_list = create_file_tools(self.file_tools)
            if not file_tool_list:
                return ""

            prompt = ChatPromptTemplate.from_messages([
                ("system", "You have access to file tools. Use list_available_files, then read_file_content or search_file_content to get content. Return only relevant content excerpts for the section, no other text."),
                ("human", "{input}"),
                MessagesPlaceholder(variable_name="agent_scratchpad"),
            ])
            agent = create_tool_calling_agent(self.llm, file_tool_list, prompt)
            executor = AgentExecutor(agent=agent, tools=file_tool_list, verbose=False, max_iterations=5, handle_parsing_errors=True)

            query = " ".join([section_name] + (key_points[:3] if key_points else []))
            msg = f"For section '{section_name}' and key points {key_points[:3] if key_points else []}, use the file tools to get relevant content. Return only the content excerpts that are relevant to this section (no preamble)."
            result = await executor.ainvoke({"input": msg})
            out = (result.get("output") or "").strip()
            if out and len(out) > 100:
                return "\n=== ADDITIONAL FILE CONTENT (from file tools) ===\n" + out[:3500] + ("\n... [truncated]" if len(out) > 3500 else "")
        except Exception as e:
            if self.verbose:
                print(f"   ⚠️ Agent-gathered file context failed: {e}")
        return ""

    def _get_relevant_zotero_data(self, section_name: str, key_points: list) -> str:
        """Get relevant data from Zotero library for this section.

        Searches Zotero based on section name and key points, ensures those items
        are in CitationManager so \\cite{key} works, returns formatted context.
        """
        if not self.zotero_tools:
            return ""

        search_terms = [section_name] + (key_points[:3] if key_points else [])
        query = " ".join(search_terms)

        try:
            search_results = self.zotero_tools.search_items(query=query, limit=5)
            if not search_results or "No items found" in str(search_results):
                return ""

            search_results_str = str(search_results)
            extracted_keys = re.findall(r"\[([A-Za-z0-9]+)\]", search_results_str)
            if self.citation_manager and extracted_keys:
                from utils.zotero_citation import ensure_zotero_items_in_citation_manager
                ensure_zotero_items_in_citation_manager(
                    self.zotero_tools, self.citation_manager, extracted_keys
                )

            zotero_context_parts = ["\n=== ZOTERO LIBRARY DATA ==="]
            zotero_context_parts.append("The following references from your Zotero library may be relevant to this section:\n")

            # Parse the search results (formatted string from ZoteroTools)
            lines = search_results_str.strip().split("\n")
            items_shown = 0
            max_items = 3

            for line in lines:
                if items_shown >= max_items:
                    break
                if line.strip() and not line.startswith("---"):
                    zotero_context_parts.append(line)
                    if "[" in line and "]" in line:
                        items_shown += 1

            if items_shown == 0:
                return ""

            zotero_context_parts.append("=== END ZOTERO DATA ===\n")
            zotero_context_parts.append("INSTRUCTION: Do not cite all available references. Select which articles are most adequate for this section—not every article may be useful. Use these Zotero references only where they are clearly relevant and useful. Add citations via \\cite{key} using the item keys shown. Ensure each cited paper is actually relevant.")

            return "\n".join(zotero_context_parts)
        except Exception:
            return ""

    # -----------------------------
    # Template parsing
    # -----------------------------

    def set_template_files(self, template_files=None):
        """Set template files for this generation session."""
        self.template_files = template_files
        if template_files and "main.tex" in template_files:
            self.template_structure = self._parse_template(template_files["main.tex"])

    def _parse_template(self, template_content: str) -> dict:
        """Parse LaTeX template to extract structure including citation style."""
        structure = {
            "documentclass": None,
            "packages": [],
            "has_abstract": False,
            "has_bibliography": False,
            "citation_style": None,
            "citation_system": None,  # 'biblatex' or 'bibtex'
        }

        # Document class
        doc_class_match = re.search(
            r"\\documentclass\s*(?:\[(.*?)\])?\s*\{(.*?)\}",
            template_content,
        )
        if doc_class_match:
            structure["documentclass"] = {
                "options": doc_class_match.group(1).split(",") if doc_class_match.group(1) else [],
                "class": doc_class_match.group(2),
            }

        # Packages
        package_matches = re.findall(r"\\usepackage\s*(?:\[(.*?)\])?\s*\{(.*?)\}", template_content)
        for opts, pkg in package_matches:
            structure["packages"].append({"name": pkg, "options": opts.split(",") if opts else []})

            if pkg == "biblatex":
                structure["citation_system"] = "biblatex"
                if opts:
                    style_match = re.search(r"style=([^,\]]+)", opts)
                    if style_match:
                        structure["citation_style"] = style_match.group(1).strip()
                    else:
                        low = opts.lower()
                        if "ieee" in low:
                            structure["citation_style"] = "ieee"
                        elif "apa" in low:
                            structure["citation_style"] = "apa"
                        elif "chicago" in low:
                            structure["citation_style"] = "chicago"
                        elif "authoryear" in low:
                            structure["citation_style"] = "authoryear"
                        elif "numeric" in low:
                            structure["citation_style"] = "numeric"

        structure["has_abstract"] = r"\begin{abstract}" in template_content

        # Bibtex bibliography
        if r"\bibliography{" in template_content or r"\begin{thebibliography}" in template_content:
            structure["has_bibliography"] = True
            structure["citation_system"] = "bibtex"
            bibstyle_match = re.search(r"\\bibliographystyle\{([^}]+)\}", template_content)
            if bibstyle_match:
                structure["citation_style"] = bibstyle_match.group(1).strip()
            else:
                doc_class = (structure.get("documentclass") or {}).get("class", "")
                low = template_content.lower()
                if "ieeetran" in doc_class or "ieee" in low:
                    structure["citation_style"] = "ieee"
                elif "acm" in low:
                    structure["citation_style"] = "ACM-Reference-Format"
                elif "elsarticle" in low:
                    structure["citation_style"] = "elsarticle-num"
                else:
                    structure["citation_style"] = "plain"

        if r"\printbibliography" in template_content:
            structure["has_bibliography"] = True
            if not structure["citation_system"]:
                structure["citation_system"] = "biblatex"

        if not structure["citation_style"]:
            structure["citation_style"] = "plain"

        return structure

    # -----------------------------
    # Section writing
    # -----------------------------

    def _count_words_excluding_latex(self, content: str) -> int:
        """
        Count words excluding LaTeX commands and special characters.
        Only counts actual content words, not markup.
        """
        import re

        # Remove LaTeX commands (e.g., \textbf, \cite{...}, \section{...})
        # Keep content within braces
        text = content

        # Remove comments
        text = re.sub(r'%.*?$', '', text, flags=re.MULTILINE)

        # Remove \command patterns but keep their content
        # e.g., \textbf{hello} -> hello
        text = re.sub(r'\\[a-zA-Z]+\*?\{([^}]*)\}', r'\1', text)

        # Remove standalone commands like \\ or \item
        text = re.sub(r'\\[a-zA-Z]+\*?', ' ', text)

        # Remove special characters that aren't part of words
        text = re.sub(r'[{}\\$&%#_~^]', ' ', text)

        # Count words
        words = text.split()
        return len(words)

    async def _outline_section_cot(self, section_name: str, key_points: list, summary: str) -> str:
        """Simple CoT: one short step to outline key claims/citations before writing. Returns 3-5 bullet lines or empty."""
        if not key_points and not (summary or "").strip():
            return ""
        try:
            from langchain.prompts import ChatPromptTemplate
            prompt = ChatPromptTemplate.from_messages([
                ("system", "You are a writing assistant. Reply with only 3-5 one-line bullet points: key claims or citations to use in this section. No preamble, no LaTeX."),
                ("human", "Section: {section_name}\nKey points: {key_points}\nResearch summary (excerpt): {summary}"),
            ])
            chain = prompt | self.llm
            key_pt = "\n".join(f"- {k}" for k in (key_points or [])[:8])
            summary_excerpt = (summary or "")[:800].strip()
            out = await chain.ainvoke({
                "section_name": section_name,
                "key_points": key_pt or "(none)",
                "summary": summary_excerpt or "(none)",
            })
            text = (out.content or "").strip()
            if text and len(text) > 20:
                return text[:600]
        except Exception:
            pass
        return ""

    async def write_section(self, section_info: dict, research_data: dict, target_words: int = 0) -> dict:
        """Write a section based on research - STRICTLY using provided section name. AI writes as much as needed."""

        section_name = section_info.get("section_name", section_info.get("name", "Unknown Section"))
        key_points = section_info.get("key_points", [])
        section_queries = section_info.get("search_queries", [])
        summary = research_data.get("research_summary", "")

        if self.verbose:
            if target_words > 0:
                print(f"✍️  Writing section: '{section_name}' (soft guide: ~{target_words} words)")
            else:
                print(f"✍️  Writing section: '{section_name}' (AI decides length)")
            print(f"   ℹ️  Write as comprehensively as the topic warrants")

        # Pull ALL sources from CitationManager for context
        all_sources = []
        if self.citation_manager and hasattr(self.citation_manager, 'sources'):
            all_sources = list(self.citation_manager.sources.values())
        sources_text = await self._format_sources_async(all_sources[:30]) if all_sources else ""

        if self.verbose:
            if all_sources:
                print(f"   📚 Sources available in global pool: {len(all_sources)}")
            else:
                print(f"   ⚠️  No sources available in CitationManager pool")

        # Get relevant data from uploaded research files (on-demand access)
        file_data_context = self._get_relevant_file_data(section_name, key_points)
        # Optional: agent-gathered file context for richer use of file tools
        if self.file_tools and self.file_tools.research_files:
            try:
                extra = await self._gather_file_context_with_tools(section_name, key_points)
                if extra:
                    file_data_context = (file_data_context or "") + "\n\n" + extra
                    if self.verbose:
                        print(f"   📁 Added agent-gathered file context for section")
            except Exception:
                pass
        if file_data_context and self.verbose:
            print(f"   📁 Retrieved relevant data from uploaded files for section context")

        # Get relevant data from Zotero library (on-demand access)
        zotero_data_context = self._get_relevant_zotero_data(section_name, key_points)
        if zotero_data_context and self.verbose:
            print(f"   📚 Retrieved relevant data from Zotero library for section context")

        image_context, selected_images = self._get_relevant_image_context(section_name, key_points, section_queries)
        if image_context and self.verbose:
            print(f"   🖼️ Retrieved relevant images for section context ({len(selected_images)} selected)")

        # Simple CoT: optional outline step when we have key points or research summary
        section_outline = ""
        if key_points or (summary or "").strip():
            section_outline = await self._outline_section_cot(section_name, key_points, summary)
            if section_outline and self.verbose:
                print(f"   📋 CoT outline: {len(section_outline)} chars")

        # Write freely — no strict word count enforcement
        writing_target = target_words  # Purely advisory, 0 means unrestricted
        
        # No retries — write once naturally
        MAX_REGENERATION_ATTEMPTS = 0
        WORD_TOLERANCE = 1.0  # Accept any length

        attempt = 0
        content = ""
        word_count = 0
        best_content = ""
        best_deviation = float('inf')

        while attempt <= MAX_REGENERATION_ATTEMPTS:
            if self.verbose and attempt > 0:
                print(f"   🔄 Attempt {attempt + 1}/{MAX_REGENERATION_ATTEMPTS + 1} (previous: {word_count} words, target: {writing_target})")

            # Use writing_target for initial generation, but show final target_words in prompt
            prompt = self._build_section_prompt(
                has_sources=bool(sources_text.strip()),
                attempt=attempt,
                previous_word_count=word_count if attempt > 0 else None,
                target_words=writing_target if attempt == 0 else target_words,  # Use writing_target first, then actual target
                final_target_words=target_words  # Always show final target for context
            )

            chain = prompt | self.llm

            # Combine summary with file data, Zotero context, and image context if available
            combined_summary = summary
            if file_data_context:
                combined_summary = f"{combined_summary}\n\n{file_data_context}"
            if zotero_data_context:
                combined_summary = f"{combined_summary}\n\n{zotero_data_context}"
            if image_context:
                combined_summary = f"{combined_summary}\n\n{image_context}"
            if section_outline:
                combined_summary = f"{combined_summary}\n\nOutline to follow (key claims/citations):\n{section_outline}"

            payload: Dict[str, Any] = {
                "section_name": section_name,
                "target_words": target_words,
                "key_points": "\n".join(f"- {kp}" for kp in key_points) if key_points else "- (none provided)",
                "summary": combined_summary,
                "sources": sources_text,
            }

            response = await chain.ainvoke(payload)
            content = response.content or ""

            # Deterministic cleanup FIRST
            content = self.sanitizer.clean(content)

            # Optional LLM LaTeX fix (OFF by default)
            if self.enable_llm_latex_fix:
                content = await self._llm_fix_latex(content)
                content = self.sanitizer.clean(content)  # sanitize again after LLM

            # Count words - FIXED: Exclude LaTeX commands from count
            word_count = self._count_words_excluding_latex(content)
            deviation = abs(word_count - target_words) / target_words if target_words > 0 else 0

            if self.verbose:
                if target_words > 0:
                    print(f"   📊 Generated {word_count} words (guide: {target_words}, deviation: {deviation*100:.1f}%)")
                else:
                    print(f"   📊 Generated {word_count} words (unrestricted)")

            # Track best attempt
            if deviation < best_deviation:
                best_deviation = deviation
                best_content = content

            # Check if within tolerance
            if deviation <= WORD_TOLERANCE:
                if self.verbose:
                    print(f"   ✅ Section '{section_name}' within target tolerance")
                break
            elif attempt < MAX_REGENERATION_ATTEMPTS:
                if self.verbose:
                    shortage = target_words - word_count
                    if shortage > 0:
                        print(f"   ⚠️  Too short by {shortage} words, regenerating with expansion prompt...")
                    else:
                        print(f"   ⚠️  Too long by {-shortage} words, regenerating with concision prompt...")
                attempt += 1
            else:
                if self.verbose:
                    print(f"   ⚠️  Final attempt, accepting with {deviation*100:.1f}% deviation")
                # Use best attempt
                content = best_content
                word_count = self._count_words_excluding_latex(content)  # Use proper word counting
                break

        # Citation matching
        used_citation_keys: List[str] = []
        if self.citation_matcher:
            if self.verbose:
                print(f"   🔍 Matching citations for '{section_name}'...")
            content = await self.citation_matcher.match_and_inject_citations(content, section_name)
            used_citation_keys = self._extract_valid_citation_keys(content)
            if self.verbose:
                print(f"   ✅ Matched {len(used_citation_keys)} unique citations")
        else:
            # If model inserted cites anyway, keep only valid ones
            used_citation_keys = self._extract_valid_citation_keys(content)

        # Image path normalization and optional figure insertion
        if self.file_tools and self.file_tools.research_files:
            all_images = collect_image_candidates(self.file_tools.research_files)
            content = self._normalize_image_references(content, selected_images, all_images)
            content = self._append_missing_images(content, selected_images)
            self._track_used_images(content)

        # Final word count after citation matching - FIXED: Exclude LaTeX commands
        final_word_count = self._count_words_excluding_latex(content)

        result = {
            "section_id": section_info.get("section_id", section_info.get("id", "")),
            "section_name": section_name,
            "content": content,
            "word_count": final_word_count,
            "citations": used_citation_keys,
            "deviation": abs(final_word_count - target_words) / target_words if target_words > 0 else 0,
            "attempts": attempt + 1,
        }

        if self.verbose:
            print(f"   📋 Final: {final_word_count} words ({result['deviation']*100:.1f}% deviation)")

        # NOTE: Auto-refine removed - word count adjustment happens in post-writing phase
        # This allows the writer to write naturally without strict enforcement
        return result

    def _build_section_prompt(self, has_sources: bool, attempt: int = 0, previous_word_count: int = None, target_words: int = 0, final_target_words: int = None) -> ChatPromptTemplate:
        """
        IMPORTANT FIX:
        - Your old prompts show WRONG LaTeX: \\begin{{itemize}} and \\cite{{key}}
          which encourages the model to output broken syntax.
        - This prompt shows correct LaTeX examples only.
        - WORD COUNT ENFORCEMENT: Adjust prompt based on attempt and previous results
        """
        system_rules = r"""
You are an expert document writer producing VALID LaTeX content.

ABSOLUTE LaTeX RULES:
1) Output MUST be valid LaTeX (not Markdown).
2) Use single backslashes for commands: \begin{{...}}, \end{{...}}, \item, \textbf{{...}}, \textit{{...}}.
3) Use single braces for arguments: \section{{Title}} (NOT double braces).
4) Escape special characters in normal text: & -> \&, % -> \%, $ -> \$, # -> \#, _ -> \_.
5) Do NOT write the words "backslash" or "backlash". If you must show a backslash character in text, use \textbackslash{{}} ONLY as a literal symbol.
6) Do NOT output malformed section commands like \subsection}}{{Title}} or \textbackslash{{}}subsection.
7) Lists:
   - itemize: \begin{{itemize}} \item ... \end{{itemize}}
   - enumerate: \begin{{enumerate}} \item ... \end{{enumerate}}
8) OPTIONAL PRESENTATION: If it meaningfully improves clarity, you may include LaTeX tables, formulas/equations, algorithm blocks, or other structures that improve presentation. Use them sparingly and only when helpful; do NOT force them.
9) IMPORTANT: Return CONTENT ONLY. Do NOT include \section{{...}} lines in the output.
10) ENGLISH AND ASCII ONLY: All text output MUST be in English using Latin/ASCII characters. Do NOT include any Cyrillic, Chinese, Arabic, or other non-Latin script characters. If referencing non-English author names or terms, transliterate them to Latin characters (e.g., "Ivanov" not "Иванов").

DOCUMENT WRITING RULES:
- Write in a practical, professional tone suitable for the requested section.
- Prefer concrete details, clear structure, and readable formatting.
- Avoid research-paper defaults unless the section explicitly requires them.
- For CV/letter/report/slides style sections, adapt the writing style accordingly.
"""

        # LENGTH GUIDANCE: Only include word targets if one was provided; otherwise write freely
        if target_words and target_words > 0:
            word_count_instruction = f"""

LENGTH GUIDANCE (soft):
Aim for roughly {target_words} words, but this is only a guideline.
- Write enough to cover all key points with appropriate depth
- Do NOT pad with filler content or unnecessary repetition
- Quality and thoroughness matter more than hitting an exact count"""
        else:
            word_count_instruction = """

LENGTH GUIDANCE:
Write as comprehensively as the topic warrants.
- Cover all key points with appropriate depth and detail
- Do NOT pad with filler content or unnecessary repetition
- Do NOT artificially limit length — write as much as needed to thoroughly cover the material"""

        system_rules += word_count_instruction

        # Add special instructions if provided
        if self.special_instructions:
            system_rules += f"""

SPECIAL FORMATTING/STYLE REQUIREMENTS:
{self.special_instructions}

IMPORTANT: Follow these instructions carefully while maintaining valid LaTeX syntax."""

        if has_sources:
            extra = r"""
CITATIONS:
- Do NOT add \cite{{...}} yourself in this step.
- Write naturally; citations will be injected automatically later.
- If you refer to sources, do it in prose without adding LaTeX citation commands yourself.
"""
        else:
            extra = r"""
SOURCING:
- No explicit sources were provided. Use neutral, defensible wording.
- Do not fabricate references, datasets, or claims.
"""

        if target_words and target_words > 0:
            length_line = f"Soft length guide: ~{target_words} words. Write naturally — thoroughness matters more than hitting an exact count."
        else:
            length_line = "Write as comprehensively as needed. There is no word count restriction."

        user_msg = r"""Write section: {section_name}

""" + length_line + r"""

Key points to cover:
{key_points}

{sources_block}

OUTPUT FORMAT REQUIREMENTS:
- LaTeX only (no Markdown).
- Content only (no \section{{...}}).
- Use correct environments for lists if needed.
- Cover key points clearly and completely for this document section.
"""

        sources_block = "Available sources (for your background knowledge):\n{sources}" if has_sources else ""
        user_msg = user_msg.replace("{sources_block}", sources_block)

        return ChatPromptTemplate.from_messages(
            [
                ("system", system_rules + extra),
                ("user", user_msg),
            ]
        )

    def _extract_valid_citation_keys(self, content: str) -> List[str]:
        if not self.citation_manager or not hasattr(self.citation_manager, 'sources'):
            return []
        keys = set()
        cites = re.findall(r"\\cite\{([^}]+)\}", content)
        for block in cites:
            for k in [x.strip() for x in block.split(",")]:
                if k and k in self.citation_manager.sources:
                    keys.add(k)
        return sorted(keys)

    # -----------------------------
    # Section recursion / parallel
    # -----------------------------

    async def write_section_recursive(self, section: dict, research: dict, target_words: int = 0) -> dict:
        section_info = {
            "section_name": section.get("name", "Unknown Section"),
            "section_id": section.get("id", ""),
            "key_points": section.get("key_points", []),
        }

        result = await self.write_section(section_info, research, target_words)

        if section.get("subsections"):
            subsection_results = []
            research_subsections = research.get("subsections", [])

            for i, subsec in enumerate(section["subsections"]):
                sub_research = research_subsections[i] if i < len(research_subsections) else research
                sub_target = subsec.get("target_words", 0)

                sub_result = await self.write_section_recursive(subsec, sub_research, sub_target)
                subsection_results.append(sub_result)

            result["subsections"] = subsection_results

        return result

    def _escape_braces_for_template(self, text: str) -> str:
        """Escape curly braces in text so LangChain ChatPromptTemplate doesn't interpret them as variables.

        LaTeX content contains many curly braces (e.g., \\cite{key}, \\begin{itemize}) which
        ChatPromptTemplate would try to interpret as template variables, causing errors like:
        'Input to ChatPromptTemplate is missing variables {'', 'key1, key2'}'

        This method doubles all curly braces: { -> {{ and } -> }}
        """
        if not text:
            return text
        # Double all curly braces to escape them for the template
        return text.replace('{', '{{').replace('}', '}}')

    def _unescape_braces(self, text: str) -> str:
        """Restore escaped braces back to single braces after template processing.

        This reverses _escape_braces_for_template: {{ -> { and }} -> }
        """
        if not text:
            return text
        return text.replace('{{', '{').replace('}}', '}')

    async def humanize_section(self, section: dict) -> dict:
        """
        Humanize a section's content to make it sound more like it was written by a researcher
        rather than an AI agent. Preserves LaTeX structure and citations.

        Args:
            section: Section dict with 'content' field

        Returns:
            Section dict with humanized content
        """
        if not section.get('content'):
            return section

        content = section['content']

        # Skip humanization only for very short fragments (e.g. single line)
        word_count = self._count_words_excluding_latex(content)
        if word_count < 25:
            return section

        try:
            # CRITICAL FIX: Escape curly braces in content to prevent ChatPromptTemplate
            # from interpreting LaTeX braces like \cite{key} as template variables.
            # We pass the content directly in the message rather than as a variable.

            # Double curly braces so LangChain does not treat \\cite{key} etc. as template variables
            system_message = """You are an expert academic editor. Your job is to revise academic text so it reads as if written by an experienced human researcher—confident, natural, and slightly idiosyncratic. The goal is text that is indistinguishable from a skilled human draft.

CRITICAL (never break these):
1. Preserve ALL LaTeX commands exactly (\\cite{{}}, \\section{{}}, \\begin{{}}, \\end{{}}, etc.)
2. Preserve ALL citations exactly (\\cite{{key1, key2}})—do not add or remove any
3. Keep the same meaning, facts, and structure
4. Do not change LaTeX formatting or section organization

AVOID these AI-typical patterns (replace or rephrase when you see them):
- "Furthermore", "Moreover", "Additionally", "In addition" at sentence starts (use varied openings)
- "It is important to note", "It should be noted", "It is worth noting"
- "In conclusion", "To summarize", "In summary" as stock phrases
- "This paper explores", "This section discusses", "This study examines" (rephrase more directly)
- "Comprehensive", "robust", "leverage", "utilize" (prefer "thorough", "strong", "use", "use")
- Overly parallel list structures (e.g. every bullet starting with the same grammar)
- Long, uniform sentence length—vary short and long sentences
- Repetitive paragraph openings (e.g. multiple paragraphs starting with "The...")

DO these to humanise the text:
- Vary sentence length and structure: mix short punchy sentences with longer, nuanced ones
- Vary paragraph openings: use "We argue...", "Evidence suggests...", direct statements, or a short transition
- Use natural academic voice: occasional "we" where appropriate, confident but not stiff
- Add subtle transitions and connections that feel organic, not template-like
- Choose slightly more specific or varied vocabulary (avoid the same adjectives repeated)
- Let the rhythm feel human: occasional asymmetry in lists, a short aside, or a clearer cause-effect link
- Prefer active voice and concrete phrasing where it fits; avoid passive or vague constructions when a direct form reads better

WHAT NOT TO CHANGE:
- LaTeX commands, citations (\\cite{{}}), section structure, technical terms, definitions, factual content, or overall meaning.

Return ONLY the revised LaTeX text. No explanations, no markdown, no code fences."""

            # Escape braces in content for the template, then build user message
            escaped_content = self._escape_braces_for_template(content)
            user_message = f"""Revise this academic text so it reads as if a human researcher wrote it—natural, varied, and confident. Preserve all LaTeX and citations exactly.

{escaped_content}"""

            prompt = ChatPromptTemplate.from_messages([
                ("system", system_message),
                ("user", user_message)
            ])

            # Use slightly higher temperature for humanization to encourage more natural variation
            humanize_llm = self.llm.bind(temperature=0.65)
            chain = prompt | humanize_llm
            # No variables needed since content is already embedded in the user message
            response = await chain.ainvoke({})
            humanized_content = response.content if hasattr(response, 'content') else str(response)
            
            # Clean markdown code blocks if present
            humanized_content = self.sanitizer.clean(humanized_content)
            
            # Create updated section
            humanized_section = section.copy()
            humanized_section['content'] = humanized_content
            
            if self.verbose:
                print(f"   ✨ Humanized section: {section.get('section_name', 'Unknown')}")
            
            return humanized_section
            
        except Exception as e:
            if self.verbose:
                print(f"   ⚠️  Humanization failed for section {section.get('section_name', 'Unknown')}: {e}")
            # Return original section on error
            return section

    async def _humanize_one_section_full(self, section: dict) -> dict:
        """Humanize one section and all its subsections recursively (subsections sequential within section)."""
        humanized_section = await self.humanize_section(section)
        if section.get('subsections'):
            humanized_subsections = []
            for subsec in section['subsections']:
                humanized_subsec = await self._humanize_one_section_full(subsec)
                humanized_subsections.append(humanized_subsec)
            humanized_section['subsections'] = humanized_subsections
        return humanized_section

    async def humanize_sections_recursive(self, sections: List[dict]) -> List[dict]:
        """
        Humanize all sections recursively (including subsections).
        Top-level sections processed in parallel batches (PARALLEL_HUMANIZE_CONCURRENT).
        """
        from utils.parallel_config import get_effective_concurrent

        max_concurrent = get_effective_concurrent('PARALLEL_HUMANIZE_CONCURRENT', 5, len(sections))
        humanized = []

        for batch_start in range(0, len(sections), max_concurrent):
            batch = sections[batch_start:batch_start + max_concurrent]
            tasks = [self._humanize_one_section_full(s) for s in batch]
            batch_results = await asyncio.gather(*tasks, return_exceptions=True)
            for r in batch_results:
                if isinstance(r, Exception):
                    if self.verbose:
                        print(f"   ⚠️  Humanization batch error: {r}")
                    raise r
                humanized.append(r)

        return humanized

    async def write_sections_parallel(self, sections: List[dict], research_data: List[dict], target_words: List[int]) -> List[dict]:
        """Write sections in parallel batches using PARALLEL_WRITE_CONCURRENT."""
        from utils.parallel_config import get_effective_concurrent
        max_concurrent = get_effective_concurrent('PARALLEL_WRITE_CONCURRENT', 3, len(sections))
        all_results: List[dict] = []

        if len(sections) > max_concurrent:
            if self.verbose:
                print(f"⚠️ Processing {len(sections)} sections in batches of {max_concurrent}...")
            for i in range(0, len(sections), max_concurrent):
                batch_sections = sections[i : i + max_concurrent]
                batch_research = research_data[i : i + max_concurrent]
                batch_targets = target_words[i : i + max_concurrent]

                tasks = []
                for sec, res, tgt in zip(batch_sections, batch_research, batch_targets):
                    section_info = {
                        "section_name": sec.get("name", "Unknown Section"),
                        "section_id": sec.get("id", ""),
                        "key_points": sec.get("key_points", []),
                    }
                    tasks.append(self.write_section(section_info, res, tgt))

                batch_results = await asyncio.gather(*tasks, return_exceptions=True)
                for r in batch_results:
                    if isinstance(r, Exception):
                        raise r
                all_results.extend(batch_results)

                if self.verbose:
                    total_batches = (len(sections) - 1) // max_concurrent + 1
                    print(f"✅ Completed batch {i // max_concurrent + 1}/{total_batches}")
        else:
            tasks = []
            for sec, res, tgt in zip(sections, research_data, target_words):
                section_info = {
                    "section_name": sec.get("name", "Unknown Section"),
                    "section_id": sec.get("id", ""),
                    "key_points": sec.get("key_points", []),
                }
                tasks.append(self.write_section(section_info, res, tgt))

            batch_results = await asyncio.gather(*tasks, return_exceptions=True)
            for r in batch_results:
                if isinstance(r, Exception):
                    raise r
            all_results = list(batch_results)

        return all_results

    # -----------------------------
    # Abstract summarization / sources formatting
    # -----------------------------

    async def _summarize_abstract(self, abstract: str) -> str:
        if abstract in self._abstract_cache:
            return self._abstract_cache[abstract]

        if not abstract:
            self._abstract_cache[abstract] = ""
            return ""

        if len(abstract) <= 100:
            self._abstract_cache[abstract] = abstract
            return abstract

        summarizer_prompt = ChatPromptTemplate.from_messages(
            [
                ("system", "Summarize this academic abstract in 50-100 characters focusing on the main contribution."),
                ("user", "Abstract:\n{abstract}\n\nVery concise summary (50-100 chars):"),
            ]
        )
        chain = summarizer_prompt | self.llm
        response = await chain.ainvoke({"abstract": abstract})
        summary = (response.content or "").strip()
        if len(summary) > 100:
            summary = summary[:97] + "..."
        self._abstract_cache[abstract] = summary
        return summary

    async def _summarize_abstracts(self, abstracts: List[str]) -> List[str]:
        return await asyncio.gather(*[self._summarize_abstract(a or "") for a in abstracts])

    async def _format_sources_async(self, sources: List[Any]) -> str:
        formatted: List[str] = []
        abstracts: List[str] = []
        items: List[Any] = []

        for i, source in enumerate(sources, 1):
            if isinstance(source, dict):
                abs_text = source.get("abstract", "") or ""
            else:
                abs_text = getattr(source, "abstract", "") or ""
            abstracts.append(abs_text)
            items.append((i, source))

        summaries = await self._summarize_abstracts(abstracts)

        for (i, source), summary in zip(items, summaries):
            if isinstance(source, dict):
                citation_key = source.get("citation_key", "unknown")
                title = source.get("title", "N/A")
                authors = source.get("authors", []) or []
                year = source.get("year", "")
                venue = source.get("venue", "")
            else:
                citation_key = getattr(source, "citation_key", "unknown")
                title = getattr(source, "title", "N/A")
                authors = getattr(source, "authors", []) or []
                year = getattr(source, "year", "")
                venue = getattr(source, "venue", "")

            txt = f"{i}. [{citation_key}]\n"
            txt += f"   Title: {title}\n"
            if authors:
                a3 = authors[:3] if isinstance(authors, list) else [str(authors)]
                txt += f"   Authors: {', '.join(map(str, a3))}{'...' if isinstance(authors, list) and len(authors) > 3 else ''}\n"
            if year:
                txt += f"   Year: {year}\n"
            txt += f"   Abstract: {summary}\n"
            if venue:
                txt += f"   Venue: {venue}\n"
            formatted.append(txt)

        return "\n".join(formatted)

    async def write_abstract(self, title: str, sections_content: List[dict], abstract_points: List[str]) -> str:
        sections_summary = []
        for section in sections_content:
            preview = (section.get("content") or "")[:400]
            sections_summary.append(f"{section.get('section_name','Section')}: {preview}...")

        prompt = ChatPromptTemplate.from_messages(
            [
                ("system", "Write a compelling academic abstract. Plain text only. No LaTeX. No citations."),
                (
                    ("user"),
                    """Write an abstract (150-250 words) for this paper:

Title: {title}

Key points:
{abstract_points}

Paper content summary:
{sections_summary}

Structure:
1) Background (1-2 sentences)
2) Gap (1 sentence)
3) Method (2-3 sentences)
4) Findings (2-3 sentences)
5) Implications (1-2 sentences)

Return plain text only:""",
                ),
            ]
        )
        chain = prompt | self.llm
        response = await chain.ainvoke(
            {
                "title": title,
                "abstract_points": "\n".join(f"- {pt}" for pt in abstract_points),
                "sections_summary": "\n\n".join(sections_summary),
            }
        )
        return (response.content or "").strip()

    # -----------------------------
    # Word-count refinement (keeps cites)
    # -----------------------------

    async def _trim_subsections_holistically(self, section: dict, target_words: int, min_subsection_words: int = 100) -> dict:
        """
        Holistically trim subsections within a section.
        Analyzes the entire section structure and trims subsections proportionally,
        ensuring no subsection becomes too small.
        
        Args:
            section: Section dict with 'subsections' list
            target_words: Target word count for entire section
            min_subsection_words: Minimum words per subsection (default 100)
        
        Returns:
            Trimmed section dict
        """
        section_name = section.get('section_name', 'Unknown Section')
        current_words = self._count_words_excluding_latex(section.get('content', ''))
        
        # Count words in subsections recursively
        def count_subsection_words(subsec: dict) -> int:
            words = self._count_words_excluding_latex(subsec.get('content', ''))
            if subsec.get('subsections'):
                for s in subsec['subsections']:
                    words += count_subsection_words(s)
            return words
        
        # Get all subsections (flatten recursively)
        def get_all_subsections(sec: dict, level: int = 0) -> List[tuple]:
            """Returns list of (subsection_dict, level, parent_words)"""
            subsections = []
            if sec.get('subsections'):
                parent_words = self._count_words_excluding_latex(sec.get('content', ''))
                for subsec in sec['subsections']:
                    subsec_words = count_subsection_words(subsec)
                    subsections.append((subsec, level, subsec_words))
                    # Recursively get nested subsections
                    subsections.extend(get_all_subsections(subsec, level + 1))
            return subsections
        
        all_subsections = get_all_subsections(section)
        
        # Calculate total words including all subsections
        total_subsection_words = sum(words for _, _, words in all_subsections)
        section_intro_words = self._count_words_excluding_latex(section.get('content', ''))
        current_words = section_intro_words + total_subsection_words
        
        # If no subsections, trim the section intro content itself
        if not all_subsections:
            if current_words > target_words:
                if self.verbose:
                    print(f"   🔧 Section '{section_name}' has no subsections - trimming intro content: {current_words} → {target_words} words")
                trimmed_section = await self._refine_section_to_target(section, target_words, tolerance=0.05)
                trimmed_section['word_count'] = self._count_words_excluding_latex(trimmed_section.get('content', ''))
                return trimmed_section
            return section
        
        # If section is already at or below target, return as-is
        if current_words <= target_words:
            return section
        
        # Calculate excess words
        excess_words = current_words - target_words
        
        # Sort subsections by word count (descending) - trim largest first for efficiency
        # This ensures we trim from subsections that have the most content to trim
        all_subsections.sort(key=lambda x: x[2], reverse=True)
        
        # If trimming would make subsections too small, trim proportionally
        # Calculate proportional trim ratio
        target_subsection_words = target_words - section_intro_words
        
        # Ensure we don't trim below minimum - calculate if trimming is feasible
        min_total_subsection_words = min_subsection_words * len(all_subsections)
        if target_subsection_words < min_total_subsection_words:
            # Can't trim enough without violating minimum - adjust target
            target_subsection_words = min_total_subsection_words
            target_words = section_intro_words + target_subsection_words
            if self.verbose:
                print(f"   ⚠️  Cannot trim below minimum ({min_subsection_words} words/subsection). Adjusted target to {target_words} words.")
        
        trim_ratio = target_subsection_words / total_subsection_words if total_subsection_words > 0 else 1.0
        
        # Trim each subsection proportionally (largest first)
        trimmed_count = 0
        total_trimmed_words = 0
        for subsec, level, subsec_words in all_subsections:
            if subsec_words < min_subsection_words:
                # Skip very small subsections - they're already at minimum
                continue
            
            new_target = max(min_subsection_words, int(subsec_words * trim_ratio))
            
            if new_target < subsec_words:
                # Trim this subsection
                trim_amount = subsec_words - new_target
                if self.verbose:
                    indent = "  " * (level + 1)
                    print(f"{indent}🔧 Trimming subsection '{subsec.get('section_name', 'Unknown')}': {subsec_words} → {new_target} words (-{trim_amount} words)")
                
                trimmed_subsec = await self._refine_section_to_target(subsec, new_target, tolerance=0.05)
                
                # Update the subsection in place (need to find and update in nested structure)
                self._update_subsection_in_section(section, subsec, trimmed_subsec)
                trimmed_count += 1
                total_trimmed_words += trim_amount
        
        # Recalculate section word count
        section['word_count'] = self._count_words_excluding_latex(section.get('content', ''))
        if section.get('subsections'):
            for subsec in section['subsections']:
                section['word_count'] += self._count_subsection_total_words(subsec)
        
        if self.verbose and trimmed_count > 0:
            final_words = section['word_count']
            print(f"   ✅ Holistically trimmed {trimmed_count} subsections in '{section_name}': {current_words} → {final_words} words (trimmed {total_trimmed_words} words total)")
        
        return section
    
    def _update_subsection_in_section(self, section: dict, old_subsec: dict, new_subsec: dict):
        """Recursively update a subsection in the nested structure"""
        if section.get('subsections'):
            for i, subsec in enumerate(section['subsections']):
                if subsec.get('id') == old_subsec.get('id'):
                    section['subsections'][i] = new_subsec
                    return
                # Recursively check nested subsections
                self._update_subsection_in_section(subsec, old_subsec, new_subsec)
    
    def _count_subsection_total_words(self, subsec: dict) -> int:
        """Recursively count words in subsection and all nested subsections"""
        words = self._count_words_excluding_latex(subsec.get('content', ''))
        if subsec.get('subsections'):
            for s in subsec['subsections']:
                words += self._count_subsection_total_words(s)
        return words

    async def _refine_section_to_target(self, section: dict, target_words: int, tolerance: float = 0.05) -> dict:
        """
        Intelligently refine section to hit target word count.
        IMPROVED: Ratio-based refinement for precise single-pass adjustment.
        """
        current_words = section.get("word_count", 0)
        content = section.get("content", "")
        section_name = section.get("section_name", "Unknown Section")

        if target_words < 50 or target_words == 0:
            return section

        deviation = abs(current_words - target_words) / target_words
        if deviation <= tolerance:
            if self.verbose:
                print(f"✓ '{section_name}' within target ({current_words}/{target_words}, {deviation*100:.1f}%)")
            return section

        # RATIO-BASED REFINEMENT: Calculate exact ratio needed for single-pass adjustment
        ratio = target_words / current_words if current_words > 0 else 1.0
        needs_expansion = ratio > 1.0
        
        if needs_expansion:
            expand_pct = (ratio - 1) * 100
            instruction = (
                f"Expand to EXACTLY {target_words} words (current: {current_words}, need +{expand_pct:.1f}%).\n"
                f"STRATEGY: Add {expand_pct:.0f}% more content by:\n"
                f"1. Expanding explanations with more detail\n"
                f"2. Adding concrete examples and illustrations\n"
                f"3. Providing deeper analysis and context\n"
                f"4. Including supporting evidence and reasoning\n"
                f"Preserve ALL citations and LaTeX commands. Do NOT repeat content - add NEW substance."
            )
        else:
            trim_pct = (1 - ratio) * 100
            instruction = (
                f"Trim to EXACTLY {target_words} words (current: {current_words}, need -{trim_pct:.1f}%).\n"
                f"STRATEGY: Remove {trim_pct:.0f}% of content by:\n"
                f"1. Removing redundant phrases and wordy transitions\n"
                f"2. Condensing long explanations into concise statements\n"
                f"3. Eliminating excessive adjectives and filler words\n"
                f"4. Simplifying complex sentences without losing meaning\n"
                f"CRITICAL: Keep ALL key findings, claims, citations, and LaTeX formatting.\n"
                f"Be precise: remove exactly {trim_pct:.0f}% of words, not more, not less."
            )

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    r"""You are an academic LaTeX editor.

HARD RULES:
- Preserve LaTeX validity.
- Preserve ALL \cite{{...}} exactly.
- Do NOT introduce malformed \subsection}}{{...}} or \textbackslash{{}}subsection.
- Return ONLY the refined LaTeX content (no explanations).""",
                ),
                (
                    "user",
                    """Section: {section_name}
Current words: {current_words}
Target words: {target_words}
Instruction: {instruction}

Content:
{content}

Refined content:""",
                ),
            ]
        )

        try:
            chain = prompt | self.llm
            resp = await chain.ainvoke(
                {
                    "section_name": section_name,
                    "current_words": current_words,
                    "target_words": target_words,
                    "instruction": instruction,
                    "content": content,
                }
            )
            refined = (resp.content or "").strip()
            refined = self.sanitizer.clean(refined)
            section["content"] = refined
            section["word_count"] = self._count_words_excluding_latex(refined)  # Use proper word counting
            return section
        except Exception as e:
            if self.verbose:
                print(f"⚠️ Refinement failed for '{section_name}': {e}")
            return section

    # -----------------------------
    # Optional: LLM-based LaTeX fixing
    # -----------------------------

    async def _llm_fix_latex(self, content: str) -> str:
        """
        Optional. If you enable this, it runs AFTER sanitizer.
        Still risky, but sometimes helps with escaping.
        """
        fix_prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    r"""You are a strict LaTeX syntax corrector.

RULES:
- Fix ONLY syntax/escaping issues; do not rewrite meaning.
- Never output \textbackslash{{}}subsection, \subsection}}{{...}}, or double-braced \begin{{...}}.
- Preserve existing \cite{{...}} exactly.
- Return LaTeX only (no markdown fences, no explanations).""",
                ),
                ("user", "Fix this LaTeX:\n\n{latex}\n\nReturn fixed LaTeX:"),
            ]
        )
        chain = fix_prompt | self.llm
        resp = await chain.ainvoke({"latex": content})
        return (resp.content or "").strip()

    # -----------------------------
    # Iterative refinement features
    # -----------------------------

    def _load_references_for_section(self, paper_ids: List[str], references_file_path: str | None = None) -> Dict[str, Any]:
        if not references_file_path:
            references_file_path = str(Path("output/references.json"))

        refs_path = Path(references_file_path)
        if not refs_path.exists():
            if self.verbose:
                print(f"⚠️ references.json not found at {refs_path}")
            return {}

        try:
            data = json.loads(refs_path.read_text(encoding="utf-8"))
            sources = data.get("sources", [])
            relevant: Dict[str, Any] = {}

            for src in sources:
                ck = src.get("citation_key", "")
                if ck in paper_ids:
                    relevant[ck] = {
                        "title": src.get("title", ""),
                        "authors": src.get("authors", []),
                        "year": src.get("year", ""),
                        "abstract": src.get("abstract", ""),
                        "research_question": src.get("research_question_or_purpose", ""),
                        "methodology": src.get("methodology", ""),
                        "key_findings": src.get("key_findings_results", ""),
                        "implications": src.get("implications_contributions", ""),
                        "full_text": src.get("full_text", ""),
                    }
            return relevant
        except Exception as e:
            if self.verbose:
                print(f"⚠️ Error loading references: {e}")
            return {}

    def _load_analysis_graph(self, analysis_file_path: str | None = None) -> Dict[str, Any]:
        if not analysis_file_path:
            analysis_file_path = str(Path("output/analysis.json"))

        p = Path(analysis_file_path)
        if not p.exists():
            return {}
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception as e:
            if self.verbose:
                print(f"⚠️ Error loading analysis graph: {e}")
            return {}

    async def write_section_iterative(
        self,
        section_info: dict,
        research_data: dict,
        target_words: int,
        references_file_path: str | None = None,
        max_iterations: int = 2,
    ) -> dict:
        section_name = section_info.get("section_name", section_info.get("name", "Unknown Section"))
        papers_to_reference = section_info.get("papers_to_reference", [])

        if self.verbose:
            print(f"✍️ Iterative section: '{section_name}' ({max_iterations} iterations)")

        _ = self._load_references_for_section(papers_to_reference, references_file_path)

        draft_result = await self.write_section(section_info, research_data, target_words)
        draft_content = draft_result.get("content", "")

        for it in range(max_iterations):
            gaps = await self._identify_information_gaps(draft_content, section_info)
            if not gaps:
                break

            additional_refs = self._query_references_for_gaps(gaps, references_file_path)
            if not additional_refs:
                break

            draft_content = await self._refine_draft(draft_content, section_info, additional_refs, gaps)
            draft_content = self.sanitizer.clean(draft_content)

        draft_result["content"] = draft_content
        draft_result["word_count"] = self._count_words_excluding_latex(draft_content)
        return draft_result

    async def _identify_information_gaps(self, draft: str, section_info: Dict[str, Any]) -> List[str]:
        section_name = section_info.get("section_name", section_info.get("name", "Unknown"))
        key_points = section_info.get("key_points", [])

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    "Return a JSON array (2-4 items) of specific information gaps for the draft. JSON only.",
                ),
                (
                    "user",
                    "Section: {section_name}\n\nKey points:\n{key_points}\n\nDraft (truncated):\n{draft}\n\nJSON array only:",
                ),
            ]
        )

        try:
            chain = prompt | self.llm
            resp = await chain.ainvoke(
                {
                    "section_name": section_name,
                    "key_points": "\n".join(f"- {pt}" for pt in key_points) if key_points else "- (none)",
                    "draft": (draft[:2000] + "...") if len(draft) > 2000 else draft,
                }
            )
            txt = (resp.content or "").strip()
            txt = self._strip_code_fence_json(txt)
            arr = json.loads(txt)
            return arr if isinstance(arr, list) else []
        except Exception as e:
            if self.verbose:
                print(f"⚠️ Gap detection failed: {e}")
            return []

    def _query_references_for_gaps(self, gaps: List[str], references_file_path: str | None = None) -> Dict[str, Any]:
        if not references_file_path:
            references_file_path = str(Path("output/references.json"))

        p = Path(references_file_path)
        if not p.exists():
            return {}

        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            sources = data.get("sources", [])

            additional: Dict[str, Any] = {}
            for gap in gaps:
                gap_lower = gap.lower()
                keywords = [k for k in re.split(r"\s+", gap_lower) if k]

                for src in sources:
                    ck = src.get("citation_key", "")
                    if not ck or ck in additional:
                        continue

                    searchable = (
                        str(src.get("title", "")).lower()
                        + " "
                        + str(src.get("research_question_or_purpose", "")).lower()
                        + " "
                        + str(src.get("key_findings_results", "")).lower()
                    )

                    matches = sum(1 for kw in keywords if kw in searchable)
                    if keywords and matches >= max(1, len(keywords) // 2):
                        additional[ck] = {
                            "title": src.get("title", ""),
                            "key_findings": (src.get("key_findings_results", "") or "")[:500],
                            "gap_addressed": gap,
                        }
                        if len(additional) >= 5:
                            break

                if len(additional) >= 5:
                    break

            return additional
        except Exception as e:
            if self.verbose:
                print(f"⚠️ Reference query failed: {e}")
            return {}

    async def _refine_draft(self, draft: str, section_info: Dict[str, Any], additional_refs: Dict[str, Any], gaps: List[str]) -> str:
        section_name = section_info.get("section_name", section_info.get("name", "Unknown"))

        refs_text = ""
        for ck, ref in additional_refs.items():
            refs_text += f"\n[{ck}] {ref.get('title','')}\n"
            refs_text += f"Key Findings: {ref.get('key_findings','')}\n"
            refs_text += f"Addresses: {ref.get('gap_addressed','')}\n"

        prompt = ChatPromptTemplate.from_messages(
            [
                (
                    "system",
                    r"""Refine the draft by integrating the provided reference info.

RULES:
- Maintain LaTeX validity.
- Add citations as \cite{{key}}.
- Do NOT create malformed subsection commands.
- Return LaTeX content only.""",
                ),
                (
                    "user",
                    "Section: {section_name}\n\nDraft:\n{draft}\n\nGaps:\n{gaps}\n\nRefs:\n{refs}\n\nRefined LaTeX:",
                ),
            ]
        )

        try:
            chain = prompt | self.llm
            resp = await chain.ainvoke(
                {
                    "section_name": section_name,
                    "draft": draft,
                    "gaps": "\n".join(f"- {g}" for g in gaps),
                    "refs": refs_text,
                }
            )
            return (resp.content or "").strip()
        except Exception as e:
            if self.verbose:
                print(f"⚠️ Draft refinement failed: {e}")
            return draft

    # -----------------------------
    # Helpers
    # -----------------------------

    @staticmethod
    def _strip_code_fence_json(txt: str) -> str:
        # Remove ```json ... ``` or ``` ... ```
        txt = re.sub(r"^\s*```json\s*", "", txt, flags=re.IGNORECASE).strip()
        txt = re.sub(r"^\s*```\s*", "", txt).strip()
        txt = re.sub(r"\s*```\s*$", "", txt).strip()
        return txt
