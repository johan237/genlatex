"""
Test helper functions and utilities
"""

import tempfile
import shutil
import json
import base64
from pathlib import Path
from typing import Dict, Any, List, Optional
# Memory system removed - no MemoryManager/SourceType/ActionType


class TestDataGenerator:
    """Generate test data for various scenarios"""
    
    @staticmethod
    def generate_text_content(length: int = 100) -> str:
        """Generate text content of specified length"""
        words = [
            "machine", "learning", "artificial", "intelligence", "quantum", "computing",
            "neural", "networks", "algorithms", "data", "science", "research",
            "analysis", "model", "training", "prediction", "classification",
            "regression", "clustering", "optimization", "deep", "supervised",
            "unsupervised", "reinforcement", "natural", "language", "processing"
        ]
        
        content = []
        for i in range(length):
            content.append(words[i % len(words)])
        
        return " ".join(content)
    
    @staticmethod
    def generate_file_content(size_kb: int = 1) -> bytes:
        """Generate file content of specified size"""
        content = TestDataGenerator.generate_text_content(size_kb * 10)
        return content.encode('utf-8')
    
    @staticmethod
    def generate_image_data() -> bytes:
        """Generate test image data (1x1 pixel PNG)"""
        return base64.b64decode(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
        )
    
    @staticmethod
    def generate_memory_episodes(count: int = 10) -> List[Dict[str, Any]]:
        """Generate memory-like episodes for testing (memory system removed; string source_type)"""
        episodes = []
        for i in range(count):
            episode = {
                "content": TestDataGenerator.generate_text_content(50),
                "source_type": "generation" if i % 2 == 0 else "search",
                "source_ref": f"test_ref_{i}",
                "importance_score": 0.5 + (i % 5) * 0.1,
                "confidence": 0.8 + (i % 3) * 0.05
            }
            episodes.append(episode)
        return episodes
    
    @staticmethod
    def generate_paper_data() -> Dict[str, Any]:
        """Generate sample paper data for testing"""
        return {
            "title": "Advanced Machine Learning Techniques in Quantum Computing",
            "abstract": "This paper explores the intersection of machine learning and quantum computing, presenting novel algorithms and their applications in various domains.",
            "keywords": ["machine learning", "quantum computing", "algorithms", "artificial intelligence"],
            "sections": [
                {
                    "section_name": "Introduction",
                    "section_id": "intro",
                    "content": "The field of quantum machine learning has emerged as a promising area of research, combining the power of quantum computing with machine learning algorithms."
                },
                {
                    "section_name": "Related Work",
                    "section_id": "related",
                    "content": "Previous research in quantum machine learning has focused on various aspects including quantum neural networks and quantum optimization algorithms."
                },
                {
                    "section_name": "Methodology",
                    "section_id": "method",
                    "content": "Our approach utilizes quantum circuits to implement machine learning algorithms, leveraging quantum superposition and entanglement for enhanced computational capabilities."
                },
                {
                    "section_name": "Results",
                    "section_id": "results",
                    "content": "Experimental results demonstrate significant improvements in computational efficiency and accuracy compared to classical machine learning approaches."
                },
                {
                    "section_name": "Conclusion",
                    "section_id": "conclusion",
                    "content": "This work contributes to the growing field of quantum machine learning and opens new avenues for future research in quantum-enhanced artificial intelligence."
                }
            ]
        }


class TestMemoryManager:
    """Stub: memory system removed. Use generate_memory_episodes for episode-like test data."""

    @staticmethod
    def create_test_memory(project_id: str = "test-project", with_data: bool = True):
        """Memory system removed - returns None. Kept for test compatibility."""
        return None

    @staticmethod
    def populate_memory(memory, num_episodes: int = 20) -> None:
        """Memory system removed - no-op."""
        pass

    @staticmethod
    def cleanup_memory(memory) -> None:
        """Memory system removed - no-op."""
        pass


class TestAssertions:
    """Custom assertions for testing"""
    
    @staticmethod
    def assert_memory_stats(stats: Dict[str, Any], expected_counts: Dict[str, int] = None) -> None:
        """Assert memory statistics structure and values"""
        required_keys = ["episodic_count", "semantic_count", "vector_count", "image_count", "file_count"]
        
        for key in required_keys:
            assert key in stats, f"Missing key in stats: {key}"
            assert isinstance(stats[key], int), f"Stats key {key} should be int, got {type(stats[key])}"
            assert stats[key] >= 0, f"Stats key {key} should be non-negative, got {stats[key]}"
        
        if expected_counts:
            for key, expected_value in expected_counts.items():
                assert key in stats, f"Expected key {key} not found in stats"
                assert stats[key] == expected_value, f"Expected {key} to be {expected_value}, got {stats[key]}"
    
    @staticmethod
    def assert_context_structure(context: Dict[str, Any]) -> None:
        """Assert context structure"""
        required_keys = ["episodes", "semantic_results", "vector_results"]
        
        for key in required_keys:
            assert key in context, f"Missing key in context: {key}"
            assert isinstance(context[key], list), f"Context key {key} should be list, got {type(context[key])}"
    
    @staticmethod
    def assert_episode_structure(episode: Any) -> None:
        """Assert episode structure"""
        assert hasattr(episode, 'source_type'), "Episode missing source_type"
        assert hasattr(episode, 'action'), "Episode missing action"
        assert hasattr(episode, 'summary'), "Episode missing summary"
        assert hasattr(episode, 'source_ref'), "Episode missing source_ref"
        assert hasattr(episode, 'importance_score'), "Episode missing importance_score"
        assert hasattr(episode, 'confidence'), "Episode missing confidence"
        
        assert 0 <= episode.importance_score <= 1, f"Invalid importance_score: {episode.importance_score}"
        assert 0 <= episode.confidence <= 1, f"Invalid confidence: {episode.confidence}"
    
    @staticmethod
    def assert_file_info_structure(file_info: Dict[str, Any]) -> None:
        """Assert file info structure"""
        required_keys = ["file_hash", "filename", "file_path", "size", "content_type"]
        
        for key in required_keys:
            assert key in file_info, f"Missing key in file_info: {key}"
        
        assert isinstance(file_info["size"], int), "File size should be int"
        assert file_info["size"] > 0, "File size should be positive"
        assert len(file_info["file_hash"]) > 0, "File hash should not be empty"
    
    @staticmethod
    def assert_image_info_structure(image_info: Dict[str, Any]) -> None:
        """Assert image info structure"""
        required_keys = ["image_id", "title", "description", "category", "content_type"]
        
        for key in required_keys:
            assert key in image_info, f"Missing key in image_info: {key}"
        
        assert len(image_info["image_id"]) > 0, "Image ID should not be empty"
        assert image_info["category"] in ["figures", "tables", "diagrams"], f"Invalid category: {image_info['category']}"


class TestPerformance:
    """Performance testing utilities"""
    
    @staticmethod
    def measure_time(func, *args, **kwargs) -> tuple:
        """Measure execution time of a function"""
        import time
        
        start_time = time.time()
        result = func(*args, **kwargs)
        end_time = time.time()
        
        execution_time = end_time - start_time
        return result, execution_time
    
    @staticmethod
    def assert_performance(execution_time: float, max_time: float, operation_name: str = "operation") -> None:
        """Assert performance requirements"""
        assert execution_time < max_time, f"{operation_name} took {execution_time:.2f}s, expected < {max_time}s"
    
    @staticmethod
    def benchmark_operations(operations: List[tuple], iterations: int = 10) -> Dict[str, float]:
        """Benchmark multiple operations"""
        results = {}
        
        for op_name, op_func, *args in operations:
            times = []
            
            for _ in range(iterations):
                _, execution_time = TestPerformance.measure_time(op_func, *args)
                times.append(execution_time)
            
            avg_time = sum(times) / len(times)
            min_time = min(times)
            max_time = max(times)
            
            results[op_name] = {
                "avg": avg_time,
                "min": min_time,
                "max": max_time,
                "total": sum(times)
            }
        
        return results


class TestDataValidator:
    """Validate test data"""
    
    @staticmethod
    def validate_project_id(project_id: str) -> bool:
        """Validate project ID format"""
        if not isinstance(project_id, str):
            return False
        
        if len(project_id) == 0 or len(project_id) > 100:
            return False
        
        # Check for invalid characters
        import re
        if not re.match(r'^[a-zA-Z0-9\-_]+$', project_id):
            return False
        
        return True
    
    @staticmethod
    def validate_content(content: str) -> bool:
        """Validate content"""
        if not isinstance(content, str):
            return False
        
        if len(content) == 0:
            return False
        
        return True
    
    @staticmethod
    def validate_file_data(file_content: bytes, filename: str) -> bool:
        """Validate file data"""
        if not isinstance(file_content, bytes):
            return False
        
        if len(file_content) == 0:
            return False
        
        if not isinstance(filename, str) or len(filename) == 0:
            return False
        
        # Check file extension
        valid_extensions = ['.txt', '.pdf', '.doc', '.docx', '.csv', '.json', '.xml', '.py', '.js', '.html', '.css']
        file_ext = Path(filename).suffix.lower()
        
        if file_ext not in valid_extensions:
            return False
        
        return True
    
    @staticmethod
    def validate_image_data(image_data: bytes) -> bool:
        """Validate image data"""
        if not isinstance(image_data, bytes):
            return False
        
        if len(image_data) == 0:
            return False
        
        # Check for common image signatures
        image_signatures = [
            b'\x89PNG',  # PNG
            b'\xff\xd8\xff',  # JPEG
            b'GIF87a',  # GIF87a
            b'GIF89a',  # GIF89a
            b'RIFF',  # WebP (starts with RIFF)
        ]
        
        for signature in image_signatures:
            if image_data.startswith(signature):
                return True
        
        return False


class TestCleanup:
    """Test cleanup utilities"""
    
    @staticmethod
    def cleanup_temp_directories() -> None:
        """Cleanup temporary directories"""
        import tempfile
        import os
        
        temp_dir = tempfile.gettempdir()
        
        for item in os.listdir(temp_dir):
            if item.startswith(('test_memory_', 'memory_test_', 'genlatex_test_')):
                item_path = os.path.join(temp_dir, item)
                if os.path.isdir(item_path):
                    shutil.rmtree(item_path, ignore_errors=True)
    
    @staticmethod
    def cleanup_test_files() -> None:
        """Cleanup test files"""
        test_files = [
            "test_output",
            "test_checkpoints",
            "test_uploads"
        ]
        
        for file_path in test_files:
            if Path(file_path).exists():
                shutil.rmtree(file_path, ignore_errors=True)
