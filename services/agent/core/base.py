"""
Core Tool System for AI Chat
Base classes for defining and executing tools
"""

from abc import ABC, abstractmethod
from typing import Any, Optional, Dict, List
from pydantic import BaseModel, Field
import logging

logger = logging.getLogger(__name__)


class ToolResult(BaseModel):
    """Result from tool execution"""
    success: bool
    result: Any = None
    error: Optional[str] = None
    
    class Config:
        arbitrary_types_allowed = True


class ExecutionContext(BaseModel):
    """Context for tool execution"""
    project_id: str
    project_path: str  # Resolved path to project files
    active_file: Optional[str] = None
    selection: Optional[Dict[str, Any]] = None  # {start, end, text}
    cursor_position: Optional[Dict[str, Any]] = None  # {lineNumber, column, offset, lineContent, textBeforeCursor, textAfterCursor}
    current_document: Optional[str] = None
    highlighted_files: List[str] = Field(default_factory=list)
    research_files: List[Dict[str, Any]] = Field(default_factory=list)
    tagged_imported_file_ids: List[str] = Field(default_factory=list)
    conversation_history: List[Dict[str, str]] = Field(default_factory=list)
    zotero_config: Optional[Dict[str, Any]] = None  # {api_key, library_id, library_type, collection_key}

    class Config:
        arbitrary_types_allowed = True


class Tool(ABC):
    """Base class for all tools"""
    name: str
    description: str
    parameters: Dict[str, Any]  # JSON Schema for parameters
    
    @abstractmethod
    async def execute(self, params: Dict[str, Any], context: ExecutionContext) -> ToolResult:
        """Execute the tool with given parameters and context"""
        pass
    
    def get_definition(self) -> Dict[str, Any]:
        """Get OpenAI-style function definition for AI context"""
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters
        }


class ToolRegistry:
    """Registry for managing available tools"""
    
    def __init__(self):
        self._tools: Dict[str, Tool] = {}
    
    def register(self, tool: Tool) -> None:
        """Register a tool"""
        self._tools[tool.name] = tool
        logger.info(f"Registered tool: {tool.name}")
    
    def get(self, name: str) -> Optional[Tool]:
        """Get a tool by name"""
        return self._tools.get(name)
    
    def get_all(self) -> List[Tool]:
        """Get all registered tools"""
        return list(self._tools.values())
    
    def get_definitions(self) -> List[Dict[str, Any]]:
        """Get all tool definitions for AI context"""
        return [tool.get_definition() for tool in self._tools.values()]
    
    def get_names(self) -> List[str]:
        """Get all tool names"""
        return list(self._tools.keys())
    
    async def execute(self, name: str, params: Dict[str, Any], context: ExecutionContext) -> ToolResult:
        """Execute a tool by name"""
        tool = self.get(name)
        if not tool:
            return ToolResult(success=False, error=f"Tool '{name}' not found")
        
        try:
            return await tool.execute(params, context)
        except Exception as e:
            logger.error(f"Tool execution error ({name}): {e}")
            return ToolResult(success=False, error=str(e))


def create_default_registry() -> ToolRegistry:
    """Create a registry with default tools (search tools removed - GenLaTeX prompt-only)"""
    from .tools.file_tools import ReadFileTool, WriteFileTool, EditFileTool, ListDirectoryTool
    from .tools.latex_tools import CompileLatexTool

    registry = ToolRegistry()
    registry.register(ReadFileTool())
    registry.register(WriteFileTool())
    registry.register(EditFileTool())
    registry.register(ListDirectoryTool())
    registry.register(CompileLatexTool())
    return registry
