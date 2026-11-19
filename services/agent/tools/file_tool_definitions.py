"""
LangChain tool definitions for research FileTools (document generation writer).
"""

import json
from typing import Any, List, Optional

from langchain_core.tools import tool


def create_file_tools(file_tools_instance) -> List[Any]:
    """
    Create LangChain tools from a FileTools instance.
    Used by the writer agent to gather file context per section.
    """
    if not file_tools_instance or not getattr(file_tools_instance, "research_files", None):
        return []

    @tool
    def list_available_files(
        file_types: Optional[str] = None,
        keywords: Optional[str] = None,
        limit: int = 50,
    ) -> str:
        """Lists research files. Optional: file_types (JSON array of strings), keywords (JSON array), limit (int)."""
        ft = json.loads(file_types) if isinstance(file_types, str) and file_types.strip() else None
        kw = json.loads(keywords) if isinstance(keywords, str) and keywords.strip() else None
        return file_tools_instance.list_available_files(file_types=ft, keywords=kw, limit=limit)

    @tool
    def search_files(
        query: str,
        file_types: Optional[str] = None,
        limit: int = 10,
    ) -> str:
        """Searches file metadata by query. Optional: file_types (JSON array), limit (int)."""
        ft = json.loads(file_types) if isinstance(file_types, str) and file_types.strip() else None
        data = file_tools_instance.search_files(query=query, file_types=ft, limit=limit)
        return json.dumps(data, indent=2) if data else "No matching files."

    @tool
    def get_file_metadata(file_id: str) -> str:
        """Gets detailed metadata for a file by file_id."""
        return file_tools_instance.get_file_metadata(file_id=file_id)

    @tool
    def read_file_content(
        file_id: str,
        max_lines: Optional[int] = None,
        format: str = "text",
    ) -> str:
        """Reads file content. Optional: max_lines (int), format ('text')."""
        result = file_tools_instance.read_file_content(
            file_id=file_id, max_lines=max_lines, format=format
        )
        if isinstance(result, dict):
            return result.get("content", str(result))
        return str(result)

    @tool
    def search_file_content(
        file_id: str,
        query: str,
        context_lines: int = 3,
    ) -> str:
        """Searches within a file's content. Returns matching excerpts with context."""
        return file_tools_instance.search_file_content(
            file_id=file_id, query=query, context_lines=context_lines
        )

    return [
        list_available_files,
        search_files,
        get_file_metadata,
        read_file_content,
        search_file_content,
    ]
