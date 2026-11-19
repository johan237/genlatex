"""
Headless LaTeX compile-error fix: get fix plan from LLM and apply edits.
Used by paper generation (main.py) and can be reused by the orchestrator.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import logging

logger = logging.getLogger(__name__)

LATEX_DEBUGGER_SYSTEM = """You are an expert LaTeX debugger. Your task is to fix compilation errors intelligently.

CRITICAL RULES:
1. Analyze the error message carefully to understand what's wrong
2. Check ALL provided files (not just main.tex) - errors often come from .bib, .sty, or other files
3. Look for common issues:
   - Unescaped special characters in .bib files (&, %, $, #, _)
   - Missing or extra braces
   - Syntax errors in bibliography entries
   - Incorrect LaTeX commands
4. Fix the error in the CORRECT file (not necessarily the one mentioned in error)
5. If you find the issue, fix it immediately
6. Only ask for more information if you truly cannot determine the cause after exploring all files

MULTIPLE ERRORS HANDLING:
- When there are multiple errors, fix them ALL in one response
- Provide one edit for each error - each edit has its own old_string/new_string pair
- Edits are applied ONE AT A TIME in order, so later edits will see the result of earlier edits
- Make each old_string unique and specific enough to match exactly once
- For related errors in the same location, combine them into a single edit

OUTPUT FORMAT (JSON only):
{
  "explanation": "Brief explanation of ALL errors and fixes - include what was fixed and where (file name, line/section when possible)",
  "files_to_fix": [
    {
      "file_path": "path/to/file.ext",
      "edits": [
        {
          "old_string": "exact text to find for error 1",
          "new_string": "replacement text for error 1"
        }
      ]
    }
  ]
}

IMPORTANT:
- Escape backslashes in JSON: use \\\\ for a single backslash
- Fix errors in the file where they actually occur (often .bib files for bibliography errors)
- Be thorough - check all related files before giving up
- Fix ALL errors reported, not just the first one"""


def _add_line_numbers(content: str) -> str:
    """Add line numbers to content for precise editing."""
    lines = content.split("\n")
    return "\n".join(f"{i:4d}|{line}" for i, line in enumerate(lines, 1))


def _fix_json_escaping(json_str: str) -> str:
    """Fix common JSON escaping issues, particularly unescaped backslashes in LaTeX commands."""
    try:
        json.loads(json_str)
        return json_str
    except json.JSONDecodeError as e:
        if "Invalid \\escape" not in str(e):
            return json_str
    def escape_latex_backslashes(match: re.Match) -> str:
        full_match = match.group(0)
        return re.sub(r"(?<!\\)\\([a-zA-Z])", r"\\\\\1", full_match)
    return re.sub(r'"[^"\\]*(?:\\.[^"\\]*)*"', escape_latex_backslashes, json_str)


def _build_whitespace_fuzzy_pattern(text: str) -> Optional[str]:
    """Build a whitespace-tolerant regex pattern from text."""
    normalized = re.sub(r"\s+", " ", (text or "").strip())
    if not normalized:
        return None
    tokens = re.split(r"\s+", normalized)
    if len(tokens) < 3 and len(normalized) < 20:
        return None
    return r"\s+".join(re.escape(t) for t in tokens if t)


def _apply_fuzzy_edit(content: str, old_string: str, new_string: str) -> Tuple[str, bool]:
    """Attempt a whitespace-normalized match if exact match fails."""
    pattern = _build_whitespace_fuzzy_pattern(old_string)
    if not pattern:
        return content, False
    matches = list(re.finditer(pattern, content, flags=re.DOTALL))
    if len(matches) != 1:
        return content, False
    start, end = matches[0].span()
    return content[:start] + new_string + content[end:], True


async def get_latex_fix_plan(
    error_message: str,
    project_dir: Path,
    llm: Any,
) -> Optional[Dict[str, Any]]:
    """
    Ask the LLM for a LaTeX fix plan (files_to_fix with edits). Returns parsed JSON or None.
    """
    project_dir = Path(project_dir)
    file_contents: Dict[str, str] = {}
    for name in ["main.tex", "references.bib"]:
        p = project_dir / name
        if p.exists():
            file_contents[name] = p.read_text(encoding="utf-8", errors="replace")
    files_context = ""
    if file_contents:
        files_context = "\n\nRELATED FILES CONTENT:\n"
        for path, content in file_contents.items():
            files_context += f"\n--- File: {path} ---\n{content}\n"
    raw_content = file_contents.get("main.tex", "")
    project_structure = _add_line_numbers(raw_content) if raw_content else "No content available"
    user_prompt = f"""ERROR TO FIX:
{error_message}

CURRENT FILE: main.tex
{files_context}

PROJECT STRUCTURE:
{project_structure}

Analyze the error, explore the provided files, and fix it. Return ONLY valid JSON with your fix."""

    try:
        response = await llm.ainvoke([
            {"role": "system", "content": LATEX_DEBUGGER_SYSTEM},
            {"role": "user", "content": user_prompt},
        ])
        response_text = (response.content or "").strip()
        if response_text.startswith("```"):
            response_text = re.sub(r"^```(?:json)?\s*", "", response_text)
            response_text = re.sub(r"\s*```$", "", response_text)
        try:
            return json.loads(response_text)
        except json.JSONDecodeError:
            try:
                fixed_json = _fix_json_escaping(response_text)
                return json.loads(fixed_json)
            except json.JSONDecodeError:
                return None
    except Exception as e:
        logger.warning("get_latex_fix_plan failed: %s", e)
        return None


def apply_latex_fix_edits(project_dir: Path, fix_data: Dict[str, Any]) -> List[str]:
    """
    Apply edits from a fix plan to files under project_dir.
    Returns list of file paths that were modified.
    """
    project_dir = Path(project_dir)
    modified: List[str] = []
    files_to_fix = fix_data.get("files_to_fix") or []
    for file_fix in files_to_fix:
        file_path = file_fix.get("file_path")
        edits = file_fix.get("edits", [])
        if not file_path or not edits:
            continue
        full_path = project_dir / file_path
        if not full_path.exists():
            logger.warning("Fix target file not found: %s", full_path)
            continue
        try:
            content = full_path.read_text(encoding="utf-8", errors="replace")
            for edit in edits:
                old_s = edit.get("old_string", "")
                new_s = edit.get("new_string", "")
                if not old_s:
                    continue
                if old_s in content:
                    count = content.count(old_s)
                    content = content.replace(old_s, new_s, 1)
                    modified.append(file_path)
                else:
                    content, applied = _apply_fuzzy_edit(content, old_s, new_s)
                    if applied:
                        modified.append(file_path)
            full_path.write_text(content, encoding="utf-8")
        except Exception as e:
            logger.warning("Failed to apply edits to %s: %s", file_path, e)
    return list(dict.fromkeys(modified))
