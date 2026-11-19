"""
Sample data fixtures for testing
"""

import base64
from typing import Dict, Any, List


class SampleData:
    """Sample data for testing"""
    
    # Sample text content
    SAMPLE_TEXT = "This is a sample text content for testing purposes. It contains various words and phrases that can be used to test text processing functionality."
    
    # Sample paper data
    SAMPLE_PAPER = {
        "title": "Advanced Machine Learning Techniques in Quantum Computing",
        "abstract": "This paper explores the intersection of machine learning and quantum computing, presenting novel algorithms and their applications in various domains including optimization, pattern recognition, and data analysis.",
        "keywords": ["machine learning", "quantum computing", "algorithms", "artificial intelligence", "optimization"],
        "sections": [
            {
                "section_name": "Introduction",
                "section_id": "intro",
                "content": "The field of quantum machine learning has emerged as a promising area of research, combining the power of quantum computing with machine learning algorithms to solve complex problems more efficiently."
            },
            {
                "section_name": "Related Work",
                "section_id": "related",
                "content": "Previous research in quantum machine learning has focused on various aspects including quantum neural networks, quantum optimization algorithms, and quantum-enhanced data processing techniques."
            },
            {
                "section_name": "Methodology",
                "section_id": "method",
                "content": "Our approach utilizes quantum circuits to implement machine learning algorithms, leveraging quantum superposition and entanglement for enhanced computational capabilities and improved performance."
            },
            {
                "section_name": "Results",
                "section_id": "results",
                "content": "Experimental results demonstrate significant improvements in computational efficiency and accuracy compared to classical machine learning approaches, with particular advantages in optimization and pattern recognition tasks."
            },
            {
                "section_name": "Conclusion",
                "section_id": "conclusion",
                "content": "This work contributes to the growing field of quantum machine learning and opens new avenues for future research in quantum-enhanced artificial intelligence and computational methods."
            }
        ]
    }
    
    # Sample file content
    SAMPLE_FILE_CONTENT = b"This is a sample file content for testing file upload and processing functionality. It contains various types of data that can be used to test different file handling scenarios."
    
    # Sample image data (1x1 pixel PNG)
    SAMPLE_IMAGE_DATA = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="
    )
    
    # Sample search results
    SAMPLE_SEARCH_RESULTS = [
        {
            "title": "Quantum Machine Learning: A Survey",
            "authors": ["John Doe", "Jane Smith"],
            "year": 2023,
            "abstract": "A comprehensive survey of quantum machine learning techniques and their applications in various domains.",
            "url": "https://example.com/paper1",
            "source_type": "academic",
            "relevance_score": 0.95
        },
        {
            "title": "Neural Networks in Quantum Computing",
            "authors": ["Alice Johnson", "Bob Wilson"],
            "year": 2022,
            "abstract": "Exploration of neural network architectures adapted for quantum computing environments.",
            "url": "https://example.com/paper2",
            "source_type": "academic",
            "relevance_score": 0.87
        },
        {
            "title": "Quantum Algorithms for Optimization",
            "authors": ["Charlie Brown", "Diana Prince"],
            "year": 2023,
            "abstract": "Novel quantum algorithms for solving optimization problems in machine learning.",
            "url": "https://example.com/paper3",
            "source_type": "academic",
            "relevance_score": 0.82
        }
    ]
    
    # Sample memory episodes
    SAMPLE_MEMORY_EPISODES = [
        {
            "content": "Machine learning algorithms use statistical methods to enable computers to learn from data without being explicitly programmed.",
            "source_type": "generation",
            "source_ref": "ml_intro",
            "importance_score": 0.9,
            "confidence": 0.95
        },
        {
            "content": "Quantum computing utilizes quantum mechanical phenomena such as superposition and entanglement to perform computations.",
            "source_type": "search",
            "source_ref": "quantum_search",
            "importance_score": 0.8,
            "confidence": 0.85
        },
        {
            "content": "Deep learning is a subset of machine learning that uses neural networks with multiple layers to model and understand complex patterns.",
            "source_type": "generation",
            "source_ref": "dl_intro",
            "importance_score": 0.7,
            "confidence": 0.9
        },
        {
            "content": "Natural language processing combines computational linguistics with machine learning to enable computers to understand and process human language.",
            "source_type": "search",
            "source_ref": "nlp_search",
            "importance_score": 0.75,
            "confidence": 0.88
        },
        {
            "content": "Computer vision enables machines to interpret and understand visual information from the world around them.",
            "source_type": "generation",
            "source_ref": "cv_intro",
            "importance_score": 0.65,
            "confidence": 0.92
        }
    ]
    
    # Sample file data
    SAMPLE_FILES = [
        {
            "filename": "research_paper.pdf",
            "content": b"Sample PDF content for testing file upload functionality.",
            "content_type": "application/pdf"
        },
        {
            "filename": "data_analysis.csv",
            "content": b"Name,Age,City,Occupation\nJohn,25,NYC,Engineer\nJane,30,LA,Designer\nBob,35,Chicago,Manager",
            "content_type": "text/csv"
        },
        {
            "filename": "code_example.py",
            "content": b"def hello_world():\n    print('Hello, World!')\n    return 'success'",
            "content_type": "text/x-python"
        },
        {
            "filename": "document.txt",
            "content": b"This is a sample text document for testing file processing and text extraction functionality.",
            "content_type": "text/plain"
        },
        {
            "filename": "config.json",
            "content": b'{"name": "test_config", "version": "1.0", "settings": {"debug": true, "timeout": 30}}',
            "content_type": "application/json"
        }
    ]
    
    # Sample image data
    SAMPLE_IMAGES = [
        {
            "title": "Machine Learning Architecture",
            "description": "A diagram showing the architecture of a machine learning system",
            "category": "figures",
            "data": SAMPLE_IMAGE_DATA
        },
        {
            "title": "Quantum Circuit Diagram",
            "description": "A quantum circuit diagram showing qubit operations",
            "category": "diagrams",
            "data": SAMPLE_IMAGE_DATA
        },
        {
            "title": "Data Flow Chart",
            "description": "A flowchart showing data processing pipeline",
            "category": "figures",
            "data": SAMPLE_IMAGE_DATA
        },
        {
            "title": "Performance Metrics Table",
            "description": "A table showing performance metrics for different algorithms",
            "category": "tables",
            "data": SAMPLE_IMAGE_DATA
        }
    ]
    
    # Sample API requests
    SAMPLE_API_REQUESTS = {
        "paper_generation": {
            "topic": "Quantum Machine Learning",
            "description": "A comprehensive study of quantum machine learning algorithms and their applications",
            "num_pages": 10,
            "project_id": "quantum-ml-research"
        },
        "search_request": {
            "query": "quantum machine learning algorithms",
            "max_results": 5,
            "search_type": "academic",
            "project_id": "quantum-ml-research"
        },
        "memory_acquire": {
            "content": "Quantum machine learning combines quantum computing with machine learning techniques",
            "source_type": "generation",
            "project_id": "quantum-ml-research",
            "importance_score": 0.9,
            "confidence": 0.95
        }
    }
    
    # Sample LaTeX content
    SAMPLE_LATEX_CONTENT = {
        "main_tex": r"""
\documentclass{article}
\usepackage[utf8]{inputenc}
\usepackage{graphicx}
\usepackage{float}

\title{Advanced Machine Learning Techniques in Quantum Computing}
\author{AI Research Agent}
\date{\today}

\begin{document}

\maketitle

\begin{abstract}
This paper explores the intersection of machine learning and quantum computing, presenting novel algorithms and their applications in various domains.
\end{abstract}

\section{Introduction}
The field of quantum machine learning has emerged as a promising area of research, combining the power of quantum computing with machine learning algorithms.

\section{Methodology}
Our approach utilizes quantum circuits to implement machine learning algorithms, leveraging quantum superposition and entanglement.

\section{Results}
Experimental results demonstrate significant improvements in computational efficiency and accuracy.

\section{Conclusion}
This work contributes to the growing field of quantum machine learning and opens new avenues for future research.

\end{document}
        """,
        "references_bib": r"""
@misc{quantum_ml_2023,
  title={Quantum Machine Learning: A Survey},
  author={Doe, John and Smith, Jane},
  howpublished={Quantum Computing Journal},
  year={2023},
  volume={1},
  pages={1-20}
}

@misc{neural_quantum_2022,
  title={Neural Networks in Quantum Computing},
  author={Johnson, Alice and Wilson, Bob},
  howpublished={AI Research},
  year={2022},
  volume={15},
  pages={45-60}
}
        """
    }
    
    # Sample project configurations
    SAMPLE_PROJECTS = [
        {
            "project_id": "quantum-ml-research",
            "title": "Quantum Machine Learning Research",
            "description": "Research project focusing on quantum machine learning algorithms"
        },
        {
            "project_id": "nlp-analysis",
            "title": "Natural Language Processing Analysis",
            "description": "Analysis of NLP techniques and their applications"
        },
        {
            "project_id": "computer-vision-study",
            "title": "Computer Vision Study",
            "description": "Study of computer vision algorithms and implementations"
        }
    ]
    
    # Sample error scenarios
    SAMPLE_ERRORS = {
        "invalid_project_id": {
            "project_id": "invalid@project#id",
            "expected_error": "Invalid project ID format"
        },
        "empty_content": {
            "content": "",
            "expected_error": "Content cannot be empty"
        },
        "invalid_file_type": {
            "filename": "test.exe",
            "expected_error": "File type not allowed"
        },
        "file_too_large": {
            "filename": "large_file.txt",
            "size": 100 * 1024 * 1024,  # 100MB
            "expected_error": "File too large"
        }
    }
    
    @classmethod
    def get_sample_text(cls, length: int = 100) -> str:
        """Get sample text of specified length"""
        if length <= len(cls.SAMPLE_TEXT):
            return cls.SAMPLE_TEXT[:length]
        
        # Repeat sample text to reach desired length
        repetitions = (length // len(cls.SAMPLE_TEXT)) + 1
        return (cls.SAMPLE_TEXT * repetitions)[:length]
    
    @classmethod
    def get_sample_file_content(cls, size_kb: int = 1) -> bytes:
        """Get sample file content of specified size"""
        target_size = size_kb * 1024
        content = cls.SAMPLE_FILE_CONTENT
        
        if len(content) >= target_size:
            return content[:target_size]
        
        # Repeat content to reach desired size
        repetitions = (target_size // len(content)) + 1
        return (content * repetitions)[:target_size]
    
    @classmethod
    def get_sample_memory_episode(cls, index: int = 0) -> Dict[str, Any]:
        """Get sample memory episode by index"""
        if 0 <= index < len(cls.SAMPLE_MEMORY_EPISODES):
            return cls.SAMPLE_MEMORY_EPISODES[index]
        return cls.SAMPLE_MEMORY_EPISODES[0]
    
    @classmethod
    def get_sample_file(cls, index: int = 0) -> Dict[str, Any]:
        """Get sample file by index"""
        if 0 <= index < len(cls.SAMPLE_FILES):
            return cls.SAMPLE_FILES[index]
        return cls.SAMPLE_FILES[0]
    
    @classmethod
    def get_sample_image(cls, index: int = 0) -> Dict[str, Any]:
        """Get sample image by index"""
        if 0 <= index < len(cls.SAMPLE_IMAGES):
            return cls.SAMPLE_IMAGES[index]
        return cls.SAMPLE_IMAGES[0]
    
    @classmethod
    def get_sample_project(cls, index: int = 0) -> Dict[str, Any]:
        """Get sample project by index"""
        if 0 <= index < len(cls.SAMPLE_PROJECTS):
            return cls.SAMPLE_PROJECTS[index]
        return cls.SAMPLE_PROJECTS[0]
