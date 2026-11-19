"""
Research file tools for document generation.
Provides in-memory access to uploaded research files (metadata + extracted content)
for the writer agent via list_available_files, search_files, get_file_metadata,
read_file_content, search_file_content.
"""

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Optional


def _normalize_file_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    """Normalize a research file entry to a consistent shape with file_id, file_name, file_type, full_text."""
    if not isinstance(entry, dict):
        return {}
    file_id = str(entry.get("file_id") or entry.get("fileId") or "")
    metadata = entry.get("metadata") or {}
    if isinstance(metadata, str):
        try:
            metadata = json.loads(metadata)
        except Exception:
            metadata = {}
    if not isinstance(metadata, dict):
        metadata = {}
    file_name = str(
        entry.get("file_name") or entry.get("fileName")
        or metadata.get("uploaded_filename") or metadata.get("file_name")
        or "uploaded-file"
    )
    file_type = str(
        entry.get("file_type") or entry.get("fileType")
        or Path(file_name).suffix.lower().lstrip(".")
        or "file"
    )
    extracted = (
        entry.get("extracted_content")
        or metadata.get("extracted_content")
        or metadata.get("extractedContent")
    )
    full_text = ""
    if isinstance(extracted, dict):
        full_text = (
            extracted.get("full_text")
            or extracted.get("extracted_text")
            or extracted.get("content")
            or ""
        )
    elif isinstance(extracted, str):
        full_text = extracted
    if not full_text:
        full_text = metadata.get("preview_text") or metadata.get("summary") or metadata.get("caption") or ""
    return {
        "file_id": file_id or f"file-{hash(file_name) % 10**8}",
        "file_name": file_name,
        "file_type": file_type,
        "metadata": metadata,
        "full_text": (full_text or "").strip(),
    }


class FileTools:
    """
    In-memory research file access for the writer agent.
    Expects research_files as list of dicts with file_id, file_name, metadata, extracted_content.
    """

    def __init__(self, research_files: Optional[List[Dict[str, Any]]] = None, project_id: Optional[str] = None):
        self.project_id = project_id or ""
        raw = list(research_files or [])
        self.research_files = [_normalize_file_entry(e) for e in raw if isinstance(e, dict)]
        self._phase_context: Optional[str] = None

    def set_phase_context(self, context: Optional[str]) -> None:
        """Optional: set context string for logging (e.g. section name)."""
        self._phase_context = context

    def list_available_files(
        self,
        file_types: Optional[List[str]] = None,
        keywords: Optional[List[str]] = None,
        limit: int = 50,
    ) -> str:
        """List research files with optional filters. Returns JSON-like summary."""
        rows = []
        for f in self.research_files[:limit]:
            ft = (f.get("file_type") or "").lower()
            if file_types and ft not in [t.lower().lstrip(".") for t in file_types]:
                continue
            meta = f.get("metadata") or {}
            kw = meta.get("keywords") or []
            if isinstance(kw, str):
                kw = [kw]
            if keywords and not any(k.lower() in " ".join(kw).lower() for k in keywords):
                continue
            rows.append({
                "file_id": f["file_id"],
                "file_name": f["file_name"],
                "file_type": f["file_type"],
                "summary": (meta.get("summary") or meta.get("caption") or "")[:300],
            })
        return json.dumps(rows, indent=2) if rows else "No research files match the filters."

    def search_files(
        self,
        query: str,
        file_types: Optional[List[str]] = None,
        limit: int = 10,
    ) -> List[Dict[str, Any]]:
        """Search file metadata/summaries by query. Returns list of dicts (fileId, fileName, relevanceScore) for writer compatibility."""
        if not query or not query.strip():
            out = []
            for f in self.research_files[:limit]:
                out.append({
                    "file_id": f["file_id"], "file_name": f["file_name"],
                    "fileId": f["file_id"], "fileName": f["file_name"],
                    "relevanceScore": 0.5,
                })
            return out
        q = query.strip().lower()
        scored = []
        for f in self.research_files:
            ft = (f.get("file_type") or "").lower()
            if file_types and ft not in [t.lower().lstrip(".") for t in file_types]:
                continue
            meta = f.get("metadata") or {}
            text = " ".join([
                str(f.get("file_name") or ""),
                str(meta.get("summary") or ""),
                str(meta.get("caption") or ""),
                str(meta.get("keywords") or ""),
                f.get("full_text", "")[:2000],
            ]).lower()
            if q in text:
                scored.append((1.0, f))
            else:
                words = q.split()
                hits = sum(1 for w in words if w in text)
                if hits > 0:
                    scored.append((hits / max(len(words), 1), f))
        scored.sort(key=lambda x: -x[0])
        return [
            {
                "file_id": f["file_id"], "file_name": f["file_name"],
                "fileId": f["file_id"], "fileName": f["file_name"],
                "relevanceScore": round(score, 2),
            }
            for score, f in scored[:limit]
        ]

    def get_file_metadata(self, file_id: str) -> str:
        """Return full metadata for a file."""
        for f in self.research_files:
            if (f.get("file_id") or "").strip() == (file_id or "").strip():
                meta = dict(f.get("metadata") or {})
                return json.dumps({
                    "file_id": f["file_id"],
                    "file_name": f["file_name"],
                    "file_type": f["file_type"],
                    "metadata": meta,
                    "content_preview": (f.get("full_text") or "")[:500],
                }, indent=2)
        return json.dumps({"error": f"File not found: {file_id}"})

    def has_extracted_content(self, file_id: str) -> bool:
        """True if this file has extractable text content (for writer compatibility)."""
        for f in self.research_files:
            if (f.get("file_id") or "").strip() == (file_id or "").strip():
                return bool((f.get("full_text") or "").strip())
        return False

    def search_extracted_content(
        self,
        file_id: str,
        query: str,
        context_chars: int = 300,
    ) -> Dict[str, Any]:
        """Search within file content; return {matches: [{context: "..."}]} for writer compatibility."""
        for f in self.research_files:
            if (f.get("file_id") or "").strip() != (file_id or "").strip():
                continue
            text = f.get("full_text") or ""
            if not query or not query.strip():
                return {"matches": [{"context": text[:context_chars]}]} if text else {"matches": []}
            try:
                pattern = re.compile(re.escape(query.strip()), re.IGNORECASE)
            except Exception:
                pattern = re.compile(re.escape(query.strip()))
            matches = []
            for m in pattern.finditer(text):
                start = max(0, m.start() - context_chars // 2)
                end = min(len(text), m.end() + context_chars // 2)
                matches.append({"context": text[start:end]})
                if len(matches) >= 10:
                    break
            return {"matches": matches}
        return {"error": f"File not found: {file_id}", "matches": []}

    def read_file_content(
        self,
        file_id: str,
        max_lines: Optional[int] = None,
        format: str = "text",
    ) -> Any:
        """Read file content. Returns str for tool; dict with 'content' key for writer compatibility."""
        for f in self.research_files:
            if (f.get("file_id") or "").strip() != (file_id or "").strip():
                continue
            text = f.get("full_text") or ""
            if max_lines is not None and max_lines > 0:
                lines = text.splitlines()
                text = "\n".join(lines[: max_lines])
            text = text or "(No extracted content for this file.)"
            return {"content": text, "file_id": file_id}
        return {"error": f"File not found: {file_id}", "content": ""}

    def search_file_content(
        self,
        file_id: str,
        query: str,
        context_lines: int = 3,
    ) -> str:
        """Search within a file's content; return matching excerpts with context."""
        for f in self.research_files:
            if (f.get("file_id") or "").strip() != (file_id or "").strip():
                continue
            text = f.get("full_text") or ""
            if not query or not query.strip():
                return text[:3000] + ("..." if len(text) > 3000 else "")
            q = query.strip()
            try:
                pattern = re.compile(re.escape(q), re.IGNORECASE)
            except Exception:
                pattern = re.compile(re.escape(q))
            lines = text.splitlines()
            out = []
            for i, line in enumerate(lines):
                if pattern.search(line):
                    start = max(0, i - context_lines)
                    end = min(len(lines), i + context_lines + 1)
                    block = "\n".join(lines[start:end])
                    out.append(block)
                    if len(out) >= 10:
                        break
            return "\n---\n".join(out) if out else f"(No matches for '{query}' in this file.)"
        return f"(File not found: {file_id})"
