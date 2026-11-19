"""
Pytest configuration and fixtures for the GenLaTeX Agent test suite
"""

import pytest
import tempfile
import shutil
import os
import sys
from pathlib import Path
from typing import Generator, Dict, Any
import json
import base64

# Add the project root to the path
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

# Memory system removed - no MemoryManager/SourceType/ActionType
from utils.latex import LatexGenerator


@pytest.fixture(scope="session")
def test_config() -> Dict[str, Any]:
    """Test configuration"""
    return {
        "test_project_id": "test-project",
        "test_storage_dir": tempfile.mkdtemp(prefix="genlatex_test_"),
        "test_output_dir": tempfile.mkdtemp(prefix="genlatex_output_"),
        "test_template_dir": project_root / "template",
        "max_test_files": 10,
        "test_timeout": 30,
    }


@pytest.fixture(scope="function")
def sample_paper_data() -> Dict[str, Any]:
    """Sample paper data for testing"""
    return {
        "title": "Test Research Paper",
        "abstract": "This is a test abstract for the research paper",
        "keywords": ["test", "research", "paper"],
        "sections": [
            {
                "section_name": "Introduction",
                "section_id": "intro",
                "content": "This is the introduction section content"
            },
            {
                "section_name": "Methodology",
                "section_id": "method",
                "content": "This is the methodology section content"
            }
        ]
    }


@pytest.fixture(scope="function")
def sample_image_data() -> bytes:
    """Sample image data (1x1 pixel PNG)"""
    return base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    )


@pytest.fixture(scope="function")
def sample_file_data() -> bytes:
    """Sample file data for testing"""
    return b"This is a test file content for file upload testing"


@pytest.fixture(scope="function")
def latex_generator(test_config: Dict[str, Any]) -> LatexGenerator:
    """Create a LaTeX generator (memory system removed - no memory_manager)"""
    return LatexGenerator(
        template_dir=str(test_config["test_template_dir"]),
        memory_manager=None
    )


@pytest.fixture(scope="session", autouse=True)
def setup_test_environment():
    """Setup test environment"""
    # Create test directories
    test_dirs = [
        "test_output",
        "test_checkpoints",
        "test_uploads"
    ]
    
    for dir_name in test_dirs:
        Path(dir_name).mkdir(exist_ok=True)
    
    yield
    
    # Cleanup test directories
    for dir_name in test_dirs:
        shutil.rmtree(dir_name, ignore_errors=True)


@pytest.fixture(scope="function")
def mock_api_keys() -> Dict[str, str]:
    """Mock API keys for testing"""
    return {
        "OPENROUTER_API_KEY": "test_openrouter_key",
        "TAVILY_API_KEY": "test_tavily_key",
        "OPENROUTER_BASE_URL": "https://openrouter.ai/api/v1",
        "AI_MODEL": "deepseek/deepseek-chat"
    }


@pytest.fixture(scope="function", autouse=True)
def mock_env_vars(mock_api_keys: Dict[str, str]):
    """Mock environment variables for testing"""
    original_env = {}
    
    # Store original values
    for key in mock_api_keys:
        original_env[key] = os.environ.get(key)
    
    # Set mock values
    for key, value in mock_api_keys.items():
        os.environ[key] = value
    
    yield
    
    # Restore original values
    for key, original_value in original_env.items():
        if original_value is None:
            os.environ.pop(key, None)
        else:
            os.environ[key] = original_value


class TestDataFactory:
    """Factory for creating test data"""
    
    @staticmethod
    def create_memory_episode(
        content: str = "Test content",
        source_type: str = "generation",
        source_ref: str = "test_ref",
        importance_score: float = 0.5,
        confidence: float = 0.5
    ) -> Dict[str, Any]:
        """Create a memory-like episode (memory system removed; string source_type)"""
        return {
            "content": content,
            "source_type": source_type,
            "source_ref": source_ref,
            "importance_score": importance_score,
            "confidence": confidence
        }
    
    @staticmethod
    def create_search_result(
        title: str = "Test Paper",
        authors: list = None,
        abstract: str = "Test abstract",
        url: str = "https://example.com",
        relevance_score: float = 0.8
    ) -> Dict[str, Any]:
        """Create a search result"""
        if authors is None:
            authors = ["Test Author"]
        
        return {
            "title": title,
            "authors": authors,
            "abstract": abstract,
            "url": url,
            "relevance_score": relevance_score
        }
    
    @staticmethod
    def create_paper_request(
        topic: str = "Test Topic",
        description: str = "Test description",
        num_pages: int = 5,
        project_id: str = "test-project"
    ) -> Dict[str, Any]:
        """Create a paper generation request"""
        return {
            "topic": topic,
            "description": description,
            "num_pages": num_pages,
            "project_id": project_id
        }


@pytest.fixture
def test_data_factory() -> TestDataFactory:
    """Test data factory fixture"""
    return TestDataFactory()
