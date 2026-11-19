"""
Dependency injection for the FastAPI application.
This module provides dependency functions for accessing services and configuration.
"""

import os
from typing import Optional

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from dotenv import load_dotenv

# Lazy imports for services - only import when actually needed
# This allows memory endpoints to work without langchain installed
try:
    from api.services import PaperService, SystemService
    SERVICES_AVAILABLE = True
except ImportError:
    SERVICES_AVAILABLE = False
    PaperService = None
    SystemService = None

from api.models import APIConfig

# Load environment variables from .env file
load_dotenv()

# Security
security = HTTPBearer(auto_error=False)

# Global service instances (singleton pattern)
_paper_service: Optional[PaperService] = None
_system_service: Optional[SystemService] = None


def get_config() -> APIConfig:
    """Get API configuration from environment variables"""
    return APIConfig(
        openrouter_api_key=os.getenv("OPENROUTER_API_KEY", ""),
        tavily_api_key=os.getenv("TAVILY_API_KEY"),
        template_dir=os.getenv("TEMPLATE_DIR", "./template"),
        checkpoint_dir=os.getenv("CHECKPOINT_DIR", "./checkpoints"),
        output_dir=os.getenv("OUTPUT_DIR", "./output"),
        max_concurrent_papers=int(os.getenv("MAX_CONCURRENT_PAPERS", "5")),
        request_timeout=int(os.getenv("REQUEST_TIMEOUT", "300"))
    )


def get_paper_service() -> PaperService:
    """Get document generation service instance (singleton)."""
    if not SERVICES_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="Document service requires langchain. Install with: pip install langchain langchain-openai"
        )
    global _paper_service
    if _paper_service is None:
        _paper_service = PaperService()
    return _paper_service


def get_system_service() -> SystemService:
    """Get system service instance (singleton)"""
    if not SERVICES_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="System service requires langchain. Install with: pip install langchain langchain-openai"
        )
    global _system_service
    if _system_service is None:
        _system_service = SystemService()
    return _system_service


def verify_api_key(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)) -> bool:
    """
    Verify API key for protected endpoints.
    For now, this is a placeholder - you can implement proper API key validation.
    """
    # In a production environment, you would:
    # 1. Validate the API key against a database
    # 2. Check rate limits
    # 3. Log access attempts
    # 4. Return appropriate error responses
    
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # For now, accept any non-empty token
    # Replace this with actual API key validation
    if not credentials.credentials or len(credentials.credentials.strip()) < 10:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API key",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return True


def require_openrouter_key() -> str:
    """Require OpenRouter API key to be configured"""
    key = os.getenv("OPENROUTER_API_KEY")
    if not key:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="OpenRouter API key not configured. Please set OPENROUTER_API_KEY environment variable."
        )
    return key


def require_tavily_key() -> Optional[str]:
    """Require Tavily API key to be configured (optional)"""
    tavily_key = os.getenv("TAVILY_API_KEY")
    if not tavily_key:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Tavily API key required for web search. Please set TAVILY_API_KEY environment variable."
        )
    return tavily_key


def check_service_health(service_name: str):
    """Check if a service is healthy"""
    def _check():
        if service_name == "paper":
            service = get_paper_service()
            if not service.orchestrator:
                raise HTTPException(
                    status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                    detail="Paper service is not available"
                )
        elif service_name == "search":
            raise HTTPException(
                status_code=status.HTTP_410_GONE,
                detail="Search service has been removed (GenLaTeX prompt-only mode)"
            )
        elif service_name == "system":
            # System service is always available
            pass
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unknown service: {service_name}"
            )
    
    return _check


def validate_paper_id(paper_id: str) -> str:
    """Validate paper ID format"""
    if not paper_id or len(paper_id.strip()) < 3:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid paper ID format"
        )
    
    # Check for valid characters (alphanumeric, hyphens, underscores)
    import re
    if not re.match(r'^[a-zA-Z0-9_-]+$', paper_id):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Paper ID contains invalid characters"
        )
    
    return paper_id.strip()


def validate_file_type(file_type: str) -> str:
    """Validate file type for downloads"""
    allowed_types = ["latex", "bibtex", "json", "report", "pdf"]
    
    if file_type not in allowed_types:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid file type. Allowed types: {', '.join(allowed_types)}"
        )
    
    return file_type


def get_rate_limit_info():
    """Get rate limiting information (placeholder)"""
    # In a production environment, you would:
    # 1. Check current rate limits
    # 2. Return remaining requests
    # 3. Return reset time
    # 4. Implement actual rate limiting logic
    
    return {
        "requests_remaining": 1000,
        "reset_time": "2024-01-01T00:00:00Z",
        "rate_limit": 1000
    }


def log_request_info(endpoint: str, method: str):
    """Log request information for monitoring"""
    import logging
    logger = logging.getLogger(__name__)
    
    def _log():
        logger.info(f"{method} {endpoint} - Request received")
    
    return _log


# Dependency for checking if the service is in maintenance mode
def check_maintenance_mode():
    """Check if the service is in maintenance mode"""
    maintenance_mode = os.getenv("MAINTENANCE_MODE", "false").lower() == "true"
    
    if maintenance_mode:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Service is currently in maintenance mode. Please try again later."
        )


# Dependency for checking API version compatibility
def check_api_version(version: str = "1.0.0"):
    """Check API version compatibility"""
    def _check():
        # In a production environment, you would:
        # 1. Check the requested version against supported versions
        # 2. Return appropriate error if version is not supported
        # 3. Log version usage for analytics
        
        supported_versions = ["1.0.0"]
        
        if version not in supported_versions:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Unsupported API version: {version}. Supported versions: {', '.join(supported_versions)}"
            )
    
    return _check
