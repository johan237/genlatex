"""
Custom exceptions for the AI Research Paper Generator API.
This module defines custom exception classes for better error handling.
"""

from typing import Optional, Dict, Any


class PaperGeneratorError(Exception):
    """Base exception for paper generator errors"""
    
    def __init__(self, message: str, details: Optional[Dict[str, Any]] = None):
        self.message = message
        self.details = details or {}
        super().__init__(self.message)


class PaperNotFoundError(PaperGeneratorError):
    """Exception raised when a paper is not found"""
    
    def __init__(self, paper_id: str):
        super().__init__(
            f"Paper with ID '{paper_id}' not found",
            {"paper_id": paper_id}
        )


class PaperGenerationError(PaperGeneratorError):
    """Exception raised when paper generation fails"""
    
    def __init__(self, message: str, phase: Optional[str] = None, details: Optional[Dict[str, Any]] = None):
        self.phase = phase
        super().__init__(message, details)


class ValidationError(PaperGeneratorError):
    """Exception raised when input validation fails"""
    
    def __init__(self, message: str, field: Optional[str] = None, value: Optional[Any] = None):
        self.field = field
        self.value = value
        super().__init__(
            message,
            {"field": field, "value": value}
        )


class ConfigurationError(PaperGeneratorError):
    """Exception raised when configuration is invalid"""
    
    def __init__(self, message: str, config_key: Optional[str] = None):
        self.config_key = config_key
        super().__init__(
            message,
            {"config_key": config_key}
        )


class ServiceUnavailableError(PaperGeneratorError):
    """Exception raised when a required service is unavailable"""
    
    def __init__(self, service_name: str, message: Optional[str] = None):
        self.service_name = service_name
        error_message = message or f"Service '{service_name}' is unavailable"
        super().__init__(
            error_message,
            {"service_name": service_name}
        )


class RateLimitError(PaperGeneratorError):
    """Exception raised when rate limit is exceeded"""
    
    def __init__(self, limit: int, reset_time: Optional[str] = None):
        self.limit = limit
        self.reset_time = reset_time
        super().__init__(
            f"Rate limit exceeded. Limit: {limit} requests",
            {"limit": limit, "reset_time": reset_time}
        )


class AuthenticationError(PaperGeneratorError):
    """Exception raised when authentication fails"""
    
    def __init__(self, message: str = "Authentication failed"):
        super().__init__(message, {"error_type": "authentication"})


class AuthorizationError(PaperGeneratorError):
    """Exception raised when authorization fails"""
    
    def __init__(self, message: str = "Authorization failed", resource: Optional[str] = None):
        self.resource = resource
        super().__init__(
            message,
            {"error_type": "authorization", "resource": resource}
        )


class SearchError(PaperGeneratorError):
    """Exception raised when search operations fail"""
    
    def __init__(self, message: str, query: Optional[str] = None, search_type: Optional[str] = None):
        self.query = query
        self.search_type = search_type
        super().__init__(
            message,
            {"query": query, "search_type": search_type}
        )


class CitationError(PaperGeneratorError):
    """Exception raised when citation operations fail"""
    
    def __init__(self, message: str, source_id: Optional[str] = None):
        self.source_id = source_id
        super().__init__(
            message,
            {"source_id": source_id}
        )


class LaTeXGenerationError(PaperGeneratorError):
    """Exception raised when LaTeX generation fails"""
    
    def __init__(self, message: str, section: Optional[str] = None):
        self.section = section
        super().__init__(
            message,
            {"section": section}
        )


class CheckpointError(PaperGeneratorError):
    """Exception raised when checkpoint operations fail"""
    
    def __init__(self, message: str, paper_id: Optional[str] = None, phase: Optional[str] = None):
        self.paper_id = paper_id
        self.phase = phase
        super().__init__(
            message,
            {"paper_id": paper_id, "phase": phase}
        )


class TimeoutError(PaperGeneratorError):
    """Exception raised when operations timeout"""
    
    def __init__(self, message: str, timeout_seconds: Optional[int] = None):
        self.timeout_seconds = timeout_seconds
        super().__init__(
            message,
            {"timeout_seconds": timeout_seconds}
        )


class ResourceExhaustedError(PaperGeneratorError):
    """Exception raised when system resources are exhausted"""
    
    def __init__(self, message: str, resource_type: Optional[str] = None):
        self.resource_type = resource_type
        super().__init__(
            message,
            {"resource_type": resource_type}
        )


class ExternalServiceError(PaperGeneratorError):
    """Exception raised when external service calls fail"""
    
    def __init__(self, message: str, service_name: str, status_code: Optional[int] = None):
        self.service_name = service_name
        self.status_code = status_code
        super().__init__(
            message,
            {"service_name": service_name, "status_code": status_code}
        )


class FileOperationError(PaperGeneratorError):
    """Exception raised when file operations fail"""
    
    def __init__(self, message: str, file_path: Optional[str] = None, operation: Optional[str] = None):
        self.file_path = file_path
        self.operation = operation
        super().__init__(
            message,
            {"file_path": file_path, "operation": operation}
        )


class ConcurrentOperationError(PaperGeneratorError):
    """Exception raised when concurrent operations conflict"""
    
    def __init__(self, message: str, operation_type: Optional[str] = None):
        self.operation_type = operation_type
        super().__init__(
            message,
            {"operation_type": operation_type}
        )
