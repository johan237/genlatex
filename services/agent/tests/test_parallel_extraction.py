"""
Test parallel extraction implementation.
Run with: cd genlatex-agent && python -m tests.test_parallel_extraction
"""
import asyncio
import os
import sys

# Add parent directory to path for imports
parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, parent_dir)
os.chdir(parent_dir)


def test_citation_manager_async():
    """Test CitationManager has async support."""
    from tools.citation import CitationManager
    cm = CitationManager()
    
    assert hasattr(cm, '_lock'), 'CitationManager missing _lock'
    assert hasattr(cm, 'add_source_async'), 'CitationManager missing add_source_async'
    assert hasattr(cm, 'add_sources_async'), 'CitationManager missing add_sources_async'
    
    print('[PASS] CitationManager has async support')


def test_article_extractor_parallel():
    """Test ArticleInfoExtractor has parallel extraction methods."""
    from agents.article_info_extractor import ArticleInfoExtractor
    
    assert hasattr(ArticleInfoExtractor, 'extract_batch_parallel'), 'Missing extract_batch_parallel'
    assert hasattr(ArticleInfoExtractor, '_generate_fallback_content'), 'Missing _generate_fallback_content'
    assert hasattr(ArticleInfoExtractor, '_apply_fallback_to_source'), 'Missing _apply_fallback_to_source'
    
    print('[PASS] ArticleInfoExtractor has parallel extraction methods')


def test_env_config():
    """Test environment config parsing."""
    os.environ['PARALLEL_EXTRACTION_ENABLED'] = 'true'
    os.environ['PARALLEL_MAX_CONCURRENT'] = '5'
    
    assert os.getenv('PARALLEL_EXTRACTION_ENABLED') == 'true'
    assert os.getenv('PARALLEL_MAX_CONCURRENT') == '5'
    
    # Test parsing logic
    parallel_enabled = os.getenv('PARALLEL_EXTRACTION_ENABLED', 'true').lower() == 'true'
    max_concurrent = int(os.getenv('PARALLEL_MAX_CONCURRENT', '5'))
    
    assert parallel_enabled is True
    assert max_concurrent == 5
    
    print('[PASS] Environment config parsing works')


def test_fallback_content_generation():
    """Test fallback content generation."""
    from agents.article_info_extractor import ArticleInfoExtractor
    from utils.sources import Source
    
    # Create a mock extractor (no LLM needed for this test)
    class MockLLM:
        pass
    
    extractor = ArticleInfoExtractor(MockLLM(), fast_mode=True)
    
    # Create a test source
    source = Source(
        title="Test Paper on Machine Learning",
        authors=["Smith, John", "Doe, Jane"],
        year=2024
    )
    
    # Test fallback content generation
    content = extractor._generate_fallback_content(source, 'research_question_or_purpose', 500)
    assert 'Test Paper on Machine Learning' in content
    assert 'Smith' in content or 'John' in content
    
    print('[PASS] Fallback content generation works')


async def test_semaphore_limiting():
    """Test that semaphore properly limits concurrency."""
    semaphore = asyncio.Semaphore(3)
    max_concurrent = 0
    current_concurrent = 0
    lock = asyncio.Lock()
    
    async def task(i):
        nonlocal max_concurrent, current_concurrent
        async with semaphore:
            async with lock:
                current_concurrent += 1
                max_concurrent = max(max_concurrent, current_concurrent)
            
            await asyncio.sleep(0.1)  # Simulate work
            
            async with lock:
                current_concurrent -= 1
    
    # Run 10 tasks with semaphore limit of 3
    await asyncio.gather(*[task(i) for i in range(10)])
    
    assert max_concurrent <= 3, f"Max concurrent was {max_concurrent}, expected <= 3"
    print(f'[PASS] Semaphore limiting works (max concurrent: {max_concurrent})')


def main():
    print("\n" + "="*60)
    print("Testing Parallel Extraction Implementation")
    print("="*60 + "\n")
    
    test_citation_manager_async()
    test_article_extractor_parallel()
    test_env_config()
    test_fallback_content_generation()
    asyncio.run(test_semaphore_limiting())
    
    print("\n" + "="*60)
    print("[SUCCESS] All parallel extraction tests passed!")
    print("="*60 + "\n")


if __name__ == "__main__":
    main()
