"""
GenLaTeX Document API Package

This package provides a FastAPI-based REST API for prompt-first LaTeX document generation.
It includes endpoints for generation, verification, search, and project file management.

Modules:
    - main: FastAPI application and route definitions
    - models: Pydantic models for request/response validation
    - services: Business logic and service layer
    - dependencies: Dependency injection and configuration
    - exceptions: Custom exception classes
"""

__version__ = "1.0.0"
__author__ = "GenLaTeX Team"
__email__ = "team@genlatex.com"

from .models import *
from .exceptions import *
from .services import DocumentService, PaperService, SystemService

__all__ = [
    "DocumentService",
    "PaperService",
    "SystemService",
    "PaperGeneratorError",
    "PaperNotFoundError",
    "PaperGenerationError",
    "ValidationError",
    "ConfigurationError",
    "ServiceUnavailableError",
    "RateLimitError",
    "AuthenticationError",
    "AuthorizationError",
    "SearchError",
    "CitationError",
    "LaTeXGenerationError",
    "CheckpointError",
    "TimeoutError",
    "ResourceExhaustedError",
    "ExternalServiceError",
    "FileOperationError",
    "ConcurrentOperationError",
]
