# tools/citation.py
from typing import Dict, List, Optional, Set
from pathlib import Path
from utils.sources import Source
import re
import json
import os
import asyncio

# Try to import fcntl for Unix file locking (not available on Windows)
try:
    import fcntl
    HAS_FCNTL = True
except ImportError:
    HAS_FCNTL = False
    # Windows doesn't have fcntl, file locking will be skipped

# Import citation utilities for improved key generation
try:
    from utils.citation_utils import (
        generate_citation_key,
        normalize_authors,
        calculate_metadata_quality,
        get_metadata_suggestions
    )
    CITATION_UTILS_AVAILABLE = True
except ImportError:
    CITATION_UTILS_AVAILABLE = False

class CitationManager:
    """Manage citations and generate BibTeX with auto-save to references.json
    
    Thread-safe for concurrent async access via add_source_async().
    """
    
    def __init__(self, references_file_path: Optional[Path] = None):
        self.sources: Dict[str, Source] = {}
        self.citation_counts: Dict[str, int] = {}
        self._source_signatures: Dict[str, str] = {}  # Track sources by content signature
        self.references_file_path = references_file_path  # Path to auto-save references.json
        self._lock = asyncio.Lock()  # Async lock for thread-safe parallel access
    
    def _get_source_signature(self, source: Source) -> str:
        """Generate a unique signature for a source based on its content"""
        # Normalize title and authors for comparison
        title = (source.title or '').lower().strip()
        authors_str = '|'.join(sorted([a.lower().strip() for a in (source.authors or [])]))
        year = str(source.year or '')
        venue = (source.venue or '').lower().strip()
        
        # Create signature from title, authors, year, and venue
        signature = f"{title}|{authors_str}|{year}|{venue}"
        return signature
    
    def add_source(self, source: Source, force_citation_key: bool = False) -> str:
        """Add source and return citation key. Prevents duplicates by content. Auto-saves to references.json.
        When force_citation_key=True (e.g. for Zotero items), use source.citation_key as-is and skip deduplication."""
        if force_citation_key:
            if source.citation_key and source.citation_key in self.sources:
                return source.citation_key
            if not source.citation_key:
                source.citation_key = self._generate_key(source)
            self.sources[source.citation_key] = source
            self.citation_counts[source.citation_key] = 0
            signature = self._get_source_signature(source)
            self._source_signatures[signature] = source.citation_key
            if self.references_file_path:
                self.save_to_file(self.references_file_path)
            return source.citation_key

        # Check if source already exists by content signature
        signature = self._get_source_signature(source)
        if signature in self._source_signatures:
            # Source already exists, return existing citation key
            existing_key = self._source_signatures[signature]
            print(f"⚠️  Duplicate source detected (title: {source.title[:50]}...), using existing citation key: {existing_key}")
            return existing_key
        
        if not source.citation_key:
            source.citation_key = self._generate_key(source)
        
        # Ensure unique key
        base_key = source.citation_key
        counter = 1
        while source.citation_key in self.sources:
            source.citation_key = f"{base_key}{counter}"
            counter += 1
        
        # Add source and track signature
        self.sources[source.citation_key] = source
        self.citation_counts[source.citation_key] = 0
        self._source_signatures[signature] = source.citation_key
        
        # Auto-save to references.json
        if self.references_file_path:
            self.save_to_file(self.references_file_path)
        
        return source.citation_key
    
    async def add_source_async(self, source: Source, force_citation_key: bool = False) -> str:
        """Thread-safe async version of add_source for parallel processing.
        
        Use this method when adding sources from multiple concurrent tasks.
        The lock ensures no race conditions in duplicate detection or key generation.
        """
        async with self._lock:
            return self.add_source(source, force_citation_key)
    
    async def add_sources_async(self, sources: List[Source]) -> List[str]:
        """Thread-safe async version of add_sources for parallel processing."""
        results = []
        for source in sources:
            key = await self.add_source_async(source)
            results.append(key)
        return results

    async def update_source_async(self, source: Source) -> None:
        """Thread-safe async update of existing source. Use when mutating from parallel tasks.
        Does not save to file (final save happens at paper generation)."""
        async with self._lock:
            if source.citation_key and source.citation_key in self.sources:
                self.sources[source.citation_key] = source

    def add_sources(self, sources: List[Source]) -> List[str]:
        """Add multiple sources"""
        return [self.add_source(s) for s in sources]
    
    def record_citation(self, citation_key: str):
        """Record that a citation was used"""
        if citation_key in self.citation_counts:
            self.citation_counts[citation_key] += 1
    
    def generate_bibtex(self) -> str:
        """Generate BibTeX file content with deduplication"""
        
        entries = []
        seen_signatures = set()
        
        for key, source in self.sources.items():
            # Double-check for duplicates by signature
            signature = self._get_source_signature(source)
            if signature in seen_signatures:
                print(f"⚠️  Skipping duplicate BibTeX entry for citation key: {key} (title: {source.title[:50]}...)")
                continue
            
            seen_signatures.add(signature)
            bibtex_entry = source.to_bibtex()
            if bibtex_entry and bibtex_entry.strip():
                entries.append(bibtex_entry)
        
        print(f"✅ Generated BibTeX with {len(entries)} unique entries (from {len(self.sources)} sources)")
        return "\n\n".join(entries) + "\n" if entries else ""
    
    def get_unused_sources(self) -> List[str]:
        """Get sources that were never cited"""
        return [key for key, count in self.citation_counts.items() if count == 0]
    
    def get_citation_statistics(self) -> dict:
        """Get citation statistics"""
        stats = {
            'total_sources': len(self.sources),
            'cited_sources': len([k for k, c in self.citation_counts.items() if c > 0]),
            'total_citations': sum(self.citation_counts.values()),
            'unused_sources': self.get_unused_sources()
        }

        # Add metadata quality analysis if citation_utils available
        if CITATION_UTILS_AVAILABLE:
            quality_scores = []
            low_quality_sources = []

            for key, source in self.sources.items():
                metadata = {
                    "title": source.title,
                    "authors": source.authors,
                    "year": source.year,
                    "journal": source.venue,
                    "venue": source.venue,
                    "doi": source.doi,
                    "url": source.url,
                    "abstract": source.abstract,
                }
                score, _ = calculate_metadata_quality(metadata)
                quality_scores.append(score)

                if score < 0.5:
                    suggestions = get_metadata_suggestions(metadata)
                    low_quality_sources.append({
                        'key': key,
                        'title': source.title[:50] + '...' if len(source.title) > 50 else source.title,
                        'score': score,
                        'suggestions': suggestions
                    })

            if quality_scores:
                stats['average_metadata_quality'] = sum(quality_scores) / len(quality_scores)
                stats['low_quality_count'] = len(low_quality_sources)
                if low_quality_sources:
                    stats['low_quality_sources'] = low_quality_sources[:5]  # Top 5

        return stats
    
    def _generate_key(self, source: Source) -> str:
        """Generate citation key from source using improved algorithm"""

        # Use citation_utils if available for better key generation
        if CITATION_UTILS_AVAILABLE:
            metadata = {
                "title": source.title,
                "authors": source.authors,
                "year": source.year,
            }
            # Get existing keys to ensure uniqueness
            existing_keys = set(self.sources.keys())
            return generate_citation_key(metadata, existing_keys)

        # Fallback to legacy key generation
        if source.authors:
            first_author = source.authors[0].split()[-1]
        else:
            first_author = "Unknown"

        year = source.year if source.year else "nd"

        # Get first significant word from title
        title_words = re.findall(r'\w+', source.title)
        title_word = title_words[0] if title_words else "paper"

        key = f"{first_author}{year}{title_word}".replace(' ', '')
        return key[:30]
    
    def save_to_file(self, path: Path):
        """
        Save all sources to references.json atomically with file locking.
        Includes all enhanced PhD-level fields.
        """
        try:
            # Convert all sources to dict format
            sources_data = []
            for key, source in self.sources.items():
                source_dict = source.to_dict()
                sources_data.append(source_dict)
            
            # Create output structure
            from datetime import datetime
            output = {
                'total_sources': len(sources_data),
                'sources': sources_data,
                'generated_at': datetime.now().isoformat()
            }
            
            # Ensure parent directory exists
            path.parent.mkdir(parents=True, exist_ok=True)
            
            # Write atomically using temporary file
            temp_path = path.with_suffix('.tmp')
            with open(temp_path, 'w', encoding='utf-8') as f:
                # Try to get file lock (Unix only, will fail gracefully on Windows)
                # Lock file on Unix systems (skip on Windows)
                if HAS_FCNTL:
                    try:
                        fcntl.flock(f.fileno(), fcntl.LOCK_EX)
                    except (AttributeError, OSError):
                        pass  # File locking failed
                
                json.dump(output, f, indent=2, ensure_ascii=False)
                f.flush()
                os.fsync(f.fileno())  # Ensure data written to disk
                
                # Release lock
                # Unlock file on Unix systems (skip on Windows)
                if HAS_FCNTL:
                    try:
                        fcntl.flock(f.fileno(), fcntl.LOCK_UN)
                    except (AttributeError, OSError):
                        pass
            
            # Atomic rename
            temp_path.replace(path)
            
            # Log success (but not too verbosely)
            if len(sources_data) % 5 == 0 or len(sources_data) < 5:
                print(f"💾 Saved {len(sources_data)} sources to {path.name}")
                
        except Exception as e:
            print(f"⚠️  Failed to save references.json: {e}")
    
    def load_from_file(self, path: Path):
        """Load sources from references.json"""
        try:
            if not path.exists():
                print(f"⚠️  references.json not found at {path}")
                return
            
            with open(path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            sources_data = data.get('sources', [])
            
            print(f"📂 Loading {len(sources_data)} sources from {path.name}...")
            
            for source_dict in sources_data:
                source = Source.from_dict(source_dict)
                
                # Add to manager (but don't trigger auto-save to avoid recursion)
                if not source.citation_key:
                    source.citation_key = self._generate_key(source)
                
                # Ensure unique key
                base_key = source.citation_key
                counter = 1
                while source.citation_key in self.sources:
                    source.citation_key = f"{base_key}{counter}"
                    counter += 1
                
                signature = self._get_source_signature(source)
                self.sources[source.citation_key] = source
                self.citation_counts[source.citation_key] = 0
                self._source_signatures[signature] = source.citation_key
            
            print(f"✅ Loaded {len(self.sources)} sources from {path.name}")
            
        except Exception as e:
            print(f"⚠️  Failed to load references.json: {e}")
