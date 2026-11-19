"""
File Tools for AI Chat System
Read, write, edit, and list files in projects
"""

import os
import re
import hashlib
from pathlib import Path
from typing import Any, Dict, Optional, List
import logging

from ..base import Tool, ToolResult, ExecutionContext

logger = logging.getLogger(__name__)


def _hash_content(content: str) -> str:
    """Generate SHA-256 hash of content for version tracking."""
    return hashlib.sha256(content.encode('utf-8')).hexdigest()


class ReadFileTool(Tool):
    """Read contents of a file"""
    
    name = "read_file"
    description = "Read the contents of a file in the project. Use this to examine code, documents, or any text file."
    parameters = {
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Path to the file relative to project root"
            },
            "offset": {
                "type": "integer",
                "description": "Line number to start reading from (1-indexed, optional)"
            },
            "limit": {
                "type": "integer",
                "description": "Maximum number of lines to read (optional)"
            }
        },
        "required": ["file_path"]
    }
    
    async def execute(self, params: Dict[str, Any], context: ExecutionContext) -> ToolResult:
        file_path = params.get("file_path")
        offset = params.get("offset", 1)
        limit = params.get("limit")
        
        if not file_path:
            return ToolResult(success=False, error="file_path is required")
        
        # Resolve full path
        full_path = Path(context.project_path) / file_path
        
        if not full_path.exists():
            return ToolResult(success=False, error=f"File not found: {file_path}")
        
        if not full_path.is_file():
            return ToolResult(success=False, error=f"Not a file: {file_path}")
        
        try:
            with open(full_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            # Apply offset and limit
            start_idx = max(0, offset - 1)  # Convert to 0-indexed
            if limit:
                end_idx = start_idx + limit
                lines = lines[start_idx:end_idx]
            else:
                lines = lines[start_idx:]
            
            content = ''.join(lines)
            
            return ToolResult(
                success=True,
                result={
                    "content": content,
                    "file_path": file_path,
                    "total_lines": len(lines),
                    "start_line": offset
                }
            )
        except Exception as e:
            return ToolResult(success=False, error=f"Failed to read file: {str(e)}")


class WriteFileTool(Tool):
    """Write or overwrite a file"""
    
    name = "write_file"
    description = "Write content to a file, creating it if it doesn't exist or overwriting if it does."
    parameters = {
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Path to the file relative to project root"
            },
            "content": {
                "type": "string",
                "description": "Content to write to the file"
            }
        },
        "required": ["file_path", "content"]
    }
    
    async def execute(self, params: Dict[str, Any], context: ExecutionContext) -> ToolResult:
        file_path = params.get("file_path")
        content = params.get("content")
        
        if not file_path:
            return ToolResult(success=False, error="file_path is required")
        if content is None:
            return ToolResult(success=False, error="content is required")
        
        # Resolve full path
        full_path = Path(context.project_path) / file_path
        
        try:
            # Create parent directories if needed
            full_path.parent.mkdir(parents=True, exist_ok=True)

            with open(full_path, 'w', encoding='utf-8') as f:
                f.write(content)

            # Generate content hash for version tracking
            # This allows frontend to update its version cache immediately
            content_hash = _hash_content(content)

            return ToolResult(
                success=True,
                result={
                    "file_path": file_path,
                    "bytes_written": len(content.encode('utf-8')),
                    "version": content_hash  # Include version hash for conflict prevention
                }
            )
        except Exception as e:
            return ToolResult(success=False, error=f"Failed to write file: {str(e)}")


class EditFileTool(Tool):
    """Apply surgical edits to a file using old_string -> new_string replacement"""
    
    name = "edit_file"
    description = "Apply precise edits to a file by replacing specific text. Provide the exact text to find and what to replace it with."
    parameters = {
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Path to the file relative to project root"
            },
            "old_string": {
                "type": "string",
                "description": "The exact text to find and replace (must be unique in the file)"
            },
            "new_string": {
                "type": "string",
                "description": "The text to replace old_string with"
            }
        },
        "required": ["file_path", "old_string", "new_string"]
    }
    
    async def execute(self, params: Dict[str, Any], context: ExecutionContext) -> ToolResult:
        file_path = params.get("file_path")
        old_string = params.get("old_string")
        new_string = params.get("new_string")
        
        if not file_path:
            return ToolResult(success=False, error="file_path is required")
        if old_string is None:
            return ToolResult(success=False, error="old_string is required")
        if new_string is None:
            return ToolResult(success=False, error="new_string is required")
        
        # Resolve full path
        full_path = Path(context.project_path) / file_path
        
        if not full_path.exists():
            return ToolResult(success=False, error=f"File not found: {file_path}")
        
        try:
            with open(full_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            # Check if old_string exists
            count = content.count(old_string)
            if count == 0:
                return ToolResult(
                    success=False,
                    error=f"old_string not found in file. Make sure the text matches exactly."
                )
            if count > 1:
                return ToolResult(
                    success=False,
                    error=f"old_string found {count} times. It must be unique. Add more context to make it unique."
                )
            
            # Apply the edit
            new_content = content.replace(old_string, new_string, 1)
            
            with open(full_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            
            # Include version hash for frontend conflict prevention
            content_hash = _hash_content(new_content)
            return ToolResult(
                success=True,
                result={
                    "file_path": file_path,
                    "chars_removed": len(old_string),
                    "chars_added": len(new_string),
                    "version": content_hash
                }
            )
        except Exception as e:
            return ToolResult(success=False, error=f"Failed to edit file: {str(e)}")


class ListDirectoryTool(Tool):
    """List files and directories in a project path"""
    
    name = "list_directory"
    description = "List files and directories in a path. Use this to explore the project structure."
    parameters = {
        "type": "object",
        "properties": {
            "path": {
                "type": "string",
                "description": "Path relative to project root (empty string or '.' for root)"
            },
            "recursive": {
                "type": "boolean",
                "description": "Whether to list recursively (default: false)"
            }
        },
        "required": []
    }
    
    async def execute(self, params: Dict[str, Any], context: ExecutionContext) -> ToolResult:
        path = params.get("path", ".")
        recursive = params.get("recursive", False)
        
        # Resolve full path
        full_path = Path(context.project_path) / path
        
        if not full_path.exists():
            return ToolResult(success=False, error=f"Path not found: {path}")
        
        if not full_path.is_dir():
            return ToolResult(success=False, error=f"Not a directory: {path}")
        
        try:
            items = []
            
            if recursive:
                for item in full_path.rglob("*"):
                    if item.is_file():
                        rel_path = item.relative_to(full_path)
                        items.append({
                            "path": str(rel_path),
                            "type": "file",
                            "size": item.stat().st_size
                        })
            else:
                for item in full_path.iterdir():
                    rel_path = item.relative_to(full_path)
                    items.append({
                        "path": str(rel_path),
                        "type": "directory" if item.is_dir() else "file",
                        "size": item.stat().st_size if item.is_file() else None
                    })
            
            # Sort: directories first, then files
            items.sort(key=lambda x: (x["type"] == "file", x["path"]))
            
            return ToolResult(
                success=True,
                result={
                    "path": path,
                    "items": items,
                    "count": len(items)
                }
            )
        except Exception as e:
            return ToolResult(success=False, error=f"Failed to list directory: {str(e)}")
