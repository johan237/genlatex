"""
Pydantic models for API request/response validation.
These models define the structure of data exchanged between the client and the API.
"""

from pydantic import BaseModel, Field, validator
from typing import List, Optional, Dict, Any, Union
from datetime import datetime
from enum import Enum
from fastapi import UploadFile


class PaperPhase(str, Enum):
    """Enumeration of document generation phases."""
    PLAN = "plan"
    RESEARCH = "research"
    WRITING = "writing"
    VERIFICATION = "verification"
    COMPLETE = "complete"


class PaperStatus(str, Enum):
    """Enumeration of document generation status."""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


# Document-first aliases (keep legacy names for compatibility)
DocumentPhase = PaperPhase
DocumentStatus = PaperStatus


# Request Models
class PaperGenerationRequest(BaseModel):
    """Request model for generating a new document."""
    topic: str = Field(..., description="Document prompt or title", max_length=200)  # Legacy field name
    description: str = Field(..., description="Detailed instructions for what to generate", min_length=20, max_length=20000)
    output_dir: Optional[str] = Field(default="./output", description="Output directory for generated files")
    resume_from: Optional[PaperPhase] = Field(default=None, description="Phase to resume from if resuming")
    project_id: Optional[str] = Field(default="genlatex-agent", description="Project ID", min_length=1, max_length=100)
    fast_mode: bool = Field(default=False, description="Enable fast mode: reduced iterations and sources for speed")
    flash_mode: bool = Field(default=False, description="Enable flash mode: minimal research and quick write for in-chat generation")
    document_type: Optional[str] = Field(default=None, description="Document type (e.g. slides, report, letter, cv)")
    document_template: Optional[str] = Field(default=None, description="Requested template identifier")
    document_schema_id: Optional[str] = Field(default=None, description="Requested document schema identifier")
    research_files: Optional[List[Dict[str, Any]]] = Field(default_factory=list, description="Processed research files for tool access (file_id, file_name, metadata, extracted content)")
    
    class Config:
        json_schema_extra = {
            "example": {
                "topic": "Quantum Machine Learning for Drug Discovery",
                "description": "Create a professional technical report about quantum computing applications in drug discovery, with clear sections, tables, and references.",
                "output_dir": "./output",
                "resume_from": None,
                "project_id": "quantum-ml-document",
                "document_type": "report",
                "document_template": "technical_report",
                "document_schema_id": "report_technical",
                "attached_files": []
            }
        }


class SectionPlanRequest(BaseModel):
    """Request model for planning a single section"""
    section_id: str = Field(..., description="Section identifier")
    name: str = Field(..., description="Section name")
    key_points: List[str] = Field(..., description="Key points to cover in this section")
    search_queries: List[str] = Field(..., description="Search queries for research")
    percentage: float = Field(..., description="Percentage of total paper content", ge=0, le=100)


class ResearchRequest(BaseModel):
    """Request model for researching a section"""
    section: SectionPlanRequest = Field(..., description="Section to research")
    topic: str = Field(..., description="Overall paper topic for context")
    max_sources: int = Field(default=10, description="Maximum number of sources to find", ge=1, le=50)


class WritingRequest(BaseModel):
    """Request model for writing a section"""
    section_info: SectionPlanRequest = Field(..., description="Section information")
    research_data: Dict[str, Any] = Field(..., description="Research data for the section")


class VerificationRequest(BaseModel):
    """Request model for verifying content"""
    content: str = Field(..., description="Content to verify", min_length=50)
    sources: List[Dict[str, Any]] = Field(..., description="Sources to verify against")
    section_name: str = Field(..., description="Name of the section being verified")


# Response Models
class SourceModel(BaseModel):
    """Model for source information"""
    title: str = Field(..., description="Source title")
    authors: List[str] = Field(..., description="List of authors")
    year: Optional[int] = Field(default=None, description="Publication year")
    abstract: str = Field(..., description="Source abstract")
    url: str = Field(..., description="Source URL")
    source_type: str = Field(..., description="Type of source (academic, web, etc.)")
    citation_key: str = Field(..., description="Citation key for referencing")
    venue: Optional[str] = Field(default=None, description="Publication venue")
    doi: Optional[str] = Field(default=None, description="Digital Object Identifier")
    credibility_score: float = Field(default=0.0, description="Credibility score (0-1)")


class SectionModel(BaseModel):
    """Model for paper section"""
    section_id: str = Field(..., description="Section identifier")
    section_name: str = Field(..., description="Section name")
    content: str = Field(..., description="Section content")
    word_count: int = Field(..., description="Word count of the section")
    citations: List[str] = Field(default_factory=list, description="List of citation keys used")
    sources: List[SourceModel] = Field(default_factory=list, description="Sources used in this section")
    subsections: List['SectionModel'] = Field(default_factory=list, description="Subsections")


class PaperPlanModel(BaseModel):
    """Model for paper plan"""
    title: str = Field(..., description="Paper title")
    sections: List[SectionPlanRequest] = Field(..., description="List of sections")
    abstract_points: List[str] = Field(default_factory=list, description="Key points for abstract")
    keywords: List[str] = Field(default_factory=list, description="Keywords for the paper")


class VerificationResultModel(BaseModel):
    """Model for verification results"""
    section: str = Field(..., description="Section name")
    total_claims: int = Field(..., description="Total number of claims checked")
    verified_claims: int = Field(..., description="Number of verified claims")
    issues: List[Dict[str, Any]] = Field(default_factory=list, description="List of verification issues")
    uncited_claims: List[str] = Field(default_factory=list, description="Claims without citations")
    passed: bool = Field(..., description="Whether verification passed")


class CitationStatsModel(BaseModel):
    """Model for citation statistics"""
    total_sources: int = Field(..., description="Total number of sources")
    cited_sources: int = Field(..., description="Number of sources that were cited")
    total_citations: int = Field(..., description="Total number of citations")
    unused_sources: List[str] = Field(default_factory=list, description="Sources that were never cited")
    citation_density: float = Field(..., description="Citations per 100 words")


class PaperDataModel(BaseModel):
    """Model for complete generated document data."""
    title: str = Field(..., description="Document title")
    abstract: str = Field(..., description="Document abstract or summary")
    keywords: List[str] = Field(default_factory=list, description="Keywords")
    sections: List[SectionModel] = Field(..., description="Paper sections")
    bibtex: str = Field(..., description="BibTeX references")
    actual_words: int = Field(..., description="Actual word count")
    citation_stats: CitationStatsModel = Field(..., description="Citation statistics")


class PaperGenerationResponse(BaseModel):
    """Response model for document generation.
    API contract: status responses use error_message (not 'error') when generation failed.
    GET /papers/{id}/content returns body with 'content' (not 'latex_content') for LaTeX text.
    """
    paper_id: str = Field(..., description="Unique identifier for the generation job")
    status: PaperStatus = Field(..., description="Current generation status")
    phase: PaperPhase = Field(..., description="Current phase of generation")
    progress: float = Field(..., description="Progress percentage (0-100)")
    message: Optional[str] = Field(default=None, description="Detailed status message")
    paper_data: Optional[PaperDataModel] = Field(default=None, description="Generated paper data")
    error_message: Optional[str] = Field(default=None, description="Error message if generation failed (canonical field)")
    created_at: datetime = Field(..., description="Creation timestamp")
    updated_at: datetime = Field(..., description="Last update timestamp")
    output_files: Dict[str, str] = Field(default_factory=dict, description="Generated output files")


# Document-first aliases
DocumentGenerationRequest = PaperGenerationRequest
DocumentDataModel = PaperDataModel
DocumentGenerationResponse = PaperGenerationResponse


class SearchRequest(BaseModel):
    """Request model for search operations"""
    query: str = Field(..., description="Search query", min_length=3, max_length=500)
    max_results: int = Field(default=5, description="Maximum number of results", ge=1, le=20)
    search_type: str = Field(default="academic", description="Type of search (academic, web, arxiv)")
    project_id: Optional[str] = Field(default="genlatex-agent", description="Project ID", min_length=1, max_length=100)


class SearchResultModel(BaseModel):
    """Model for search results"""
    title: str = Field(..., description="Result title")
    authors: List[str] = Field(default_factory=list, description="Authors")
    year: Optional[int] = Field(default=None, description="Publication year")
    abstract: str = Field(..., description="Abstract or summary")
    url: str = Field(..., description="Source URL")
    source_type: str = Field(..., description="Type of source")
    relevance_score: float = Field(default=0.0, description="Relevance score (0-1)")


class SearchResponse(BaseModel):
    """Response model for search operations"""
    query: str = Field(..., description="Original search query")
    results: List[SearchResultModel] = Field(..., description="Search results")
    total_results: int = Field(..., description="Total number of results found")
    search_time: float = Field(..., description="Search time in seconds")


class HealthResponse(BaseModel):
    """Response model for health check"""
    status: str = Field(..., description="Service status")
    version: str = Field(..., description="API version")
    timestamp: datetime = Field(..., description="Health check timestamp")
    dependencies: Dict[str, str] = Field(..., description="Dependency status")


class ErrorResponse(BaseModel):
    """Response model for errors"""
    error: str = Field(..., description="Error type")
    message: str = Field(..., description="Error message")
    details: Optional[Dict[str, Any]] = Field(default=None, description="Additional error details")
    timestamp: datetime = Field(..., description="Error timestamp")


# Update forward references
SectionModel.model_rebuild()


# Configuration Models
class APIConfig(BaseModel):
    """API configuration model"""
    openrouter_api_key: str = Field(..., description="OpenRouter API key")
    openrouter_base_url: str = Field(default="https://openrouter.ai/api/v1", description="OpenRouter base URL")
    openrouter_model: str = Field(default="deepseek/deepseek-chat", description="OpenRouter model ID (override with AI_MODEL env)")
    tavily_api_key: Optional[str] = Field(default=None, description="Tavily API key for web search")
    template_dir: str = Field(default="./template", description="LaTeX template directory")
    checkpoint_dir: str = Field(default="./checkpoints", description="Checkpoint directory")
    output_dir: str = Field(default="./output", description="Default output directory")
    max_concurrent_papers: int = Field(default=5, description="Maximum concurrent paper generations")
    request_timeout: int = Field(default=300, description="Request timeout in seconds")


class SystemInfo(BaseModel):
    """System information model"""
    api_version: str = Field(..., description="API version")
    python_version: str = Field(..., description="Python version")
    dependencies: Dict[str, str] = Field(..., description="Dependency versions")
    system_resources: Dict[str, Any] = Field(..., description="System resource information")
    active_papers: int = Field(..., description="Number of active paper generations")
    total_papers_generated: int = Field(..., description="Total papers generated")


# New API endpoint models for /api/genlatex-agent/
class ContextModel(BaseModel):
    """Context model for API requests"""
    projectId: Optional[str] = Field(default=None, description="Project ID")
    chatHistory: Optional[List[Dict[str, Any]]] = Field(default_factory=list, description="Chat history")
    mentionedFiles: Optional[List[Dict[str, Any]]] = Field(default_factory=list, description="Mentioned files")


class GenLatexAgentRequest(BaseModel):
    """Base request model for genlatex-agent endpoints"""
    prompt: str = Field(..., description="User's request or prompt")
    content: Optional[str] = Field(default=None, description="Current document content")
    context: Optional[ContextModel] = Field(default=None, description="Additional context")
    fast_mode: bool = Field(default=False, description="Enable fast mode: reduced iterations and sources for speed")
    
    class Config:
        json_schema_extra = {
            "example": {
                "prompt": "Generate a paper on machine learning in healthcare",
                "content": "Some existing content here...",
                "context": {
                    "projectId": "my-project",
                    "chatHistory": [],
                    "mentionedFiles": []
                }
            }
        }


class GenLatexAgentResponse(BaseModel):
    """Base response model for genlatex-agent endpoints"""
    success: bool = Field(..., description="Whether the request was successful")
    result: str = Field(..., description="The generated or processed content")
    error: Optional[str] = Field(default=None, description="Error message if failed")


class MakePaperResponse(BaseModel):
    """Response model for make-paper endpoint"""
    success: bool = Field(..., description="Whether the request was successful")
    result: str = Field(..., description="Generated paper content")
    citations: Optional[List[Dict[str, Any]]] = Field(default_factory=list, description="Citations used")
    paper_id: Optional[str] = Field(default=None, description="Paper ID for tracking")
    error: Optional[str] = Field(default=None, description="Error message if failed")


class ReviewArticleResponse(BaseModel):
    """Response model for review-article endpoint"""
    success: bool = Field(..., description="Whether the request was successful")
    result: str = Field(..., description="Review content")
    suggestions: Optional[List[Dict[str, Any]]] = Field(default_factory=list, description="Review suggestions")
    error: Optional[str] = Field(default=None, description="Error message if failed")


class FactCheckResponse(BaseModel):
    """Response model for fact-check endpoint"""
    success: bool = Field(..., description="Whether the request was successful")
    result: str = Field(..., description="Fact-check results")
    verifiedFacts: Optional[List[Dict[str, Any]]] = Field(default_factory=list, description="Verified facts")
    issues: Optional[List[Dict[str, Any]]] = Field(default_factory=list, description="Issues found")
    error: Optional[str] = Field(default=None, description="Error message if failed")


class AddCitationResponse(BaseModel):
    """Response model for add-citation endpoint"""
    success: bool = Field(..., description="Whether the request was successful")
    result: str = Field(..., description="Content with added citations")
    citations: Optional[List[Dict[str, Any]]] = Field(default_factory=list, description="Added citations")
    error: Optional[str] = Field(default=None, description="Error message if failed")


# Chat API Models
class ChatContext(BaseModel):
    """Context for chat request"""
    active_file: Optional[str] = Field(default=None, description="Currently active file path")
    selection: Optional[Dict[str, Any]] = Field(default=None, description="Selected text: {start, end, text}")
    cursor_position: Optional[Dict[str, Any]] = Field(default=None, description="Cursor position: {lineNumber, column, offset, lineContent, textBeforeCursor, textAfterCursor}")
    current_document: Optional[str] = Field(default=None, description="Current document content")
    mentioned_files: List[str] = Field(default_factory=list, description="Files mentioned in the message")
    highlighted_files: List[str] = Field(default_factory=list, description="Highlighted/mentioned files (priority)")
    research_files: List[Dict[str, Any]] = Field(default_factory=list, description="Research files metadata for tool access")
    tagged_imported_file_ids: List[str] = Field(default_factory=list, description="Imported (research) file IDs user tagged via @")
    conversation_history: List[Dict[str, str]] = Field(default_factory=list, description="Previous messages")
    zotero_config: Optional[Dict[str, Any]] = Field(default=None, description="Zotero API config: api_key, library_id, library_type, collection_key")


class ChatRequest(BaseModel):
    """Request model for unified chat endpoint.

    The AI intelligently decides whether to edit documents or respond conversationally
    based on the user's message - no mode switching required.
    """
    message: str = Field(..., description="User message", min_length=1)
    project_id: str = Field(default="", description="Project ID")
    project_path: Optional[str] = Field(default=None, description="Absolute path to project dir (from Next.js)")
    context: Optional[ChatContext] = Field(default=None, description="Chat context")
    stream: bool = Field(default=True, description="Whether to stream response")

    class Config:
        json_schema_extra = {
            "example": {
                "message": "Change the title to 'Machine Learning in Healthcare'",
                "project_id": "my-project",
                "context": {
                    "active_file": "main.tex",
                    "selection": None,
                    "current_document": "\\documentclass{article}..."
                },
                "stream": True
            }
        }


class ChatResponse(BaseModel):
    """Response model for non-streaming chat"""
    success: bool = Field(..., description="Whether the request was successful")
    response: str = Field(default="", description="Response text")
    code: Optional[str] = Field(default=None, description="Code to apply (for execute mode)")
    files_modified: List[str] = Field(default_factory=list, description="Files that were modified")
    error: Optional[str] = Field(default=None, description="Error message if failed")


