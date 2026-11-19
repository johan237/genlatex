# utils/sources.py
from dataclasses import dataclass, field, asdict
from typing import List, Optional, Dict, Any
from datetime import datetime
import json
import re

# Import citation utilities for improved BibTeX generation
try:
    from utils.citation_utils import (
        normalize_authors,
        infer_bibtex_type,
        generate_citation_key,
        format_authors_for_bibtex,
        calculate_metadata_quality
    )
    CITATION_UTILS_AVAILABLE = True
except ImportError:
    CITATION_UTILS_AVAILABLE = False

# Import unidecode for transliterating non-Latin scripts (Cyrillic, CJK, Arabic, etc.) to ASCII
try:
    from unidecode import unidecode as _unidecode
    UNIDECODE_AVAILABLE = True
except ImportError:
    UNIDECODE_AVAILABLE = False

import logging
logger = logging.getLogger(__name__)


def sanitize_latex_unicode(text: str) -> str:
    """Sanitize non-ASCII characters in LaTeX content for pdflatex compatibility.
    
    Transliterates Cyrillic, CJK, Arabic, and other non-Latin scripts to ASCII,
    and converts common accented Latin characters to LaTeX equivalents.
    Safe to call on full LaTeX documents -- preserves LaTeX commands and structure.
    """
    if not text:
        return text
    
    # Common accented Latin → LaTeX equivalents (safe for pdflatex)
    latin_accent_map = {
        'ä': '\\"a', 'ö': '\\"o', 'ü': '\\"u', 'Ä': '\\"A', 'Ö': '\\"O', 'Ü': '\\"U',
        'é': "\\'e", 'è': '\\`e', 'ê': '\\^e', 'ë': '\\"e',
        'á': "\\'a", 'à': '\\`a', 'â': '\\^a',
        'í': "\\'i", 'ì': '\\`i', 'î': '\\^i', 'ï': '\\"i',
        'ó': "\\'o", 'ò': '\\`o', 'ô': '\\^o',
        'ú': "\\'u", 'ù': '\\`u', 'û': '\\^u',
        'ñ': '\\~n', 'Ñ': '\\~N',
        'ç': '\\c{c}', 'Ç': '\\c{C}',
        'ß': '{\\ss}',
        'ø': '{\\o}', 'Ø': '{\\O}',
        'å': '{\\aa}', 'Å': '{\\AA}',
        'æ': '{\\ae}', 'Æ': '{\\AE}',
        '…': '\\ldots',
        '–': '--',
        '—': '---',
        '\u201c': '``', '\u201d': "''",   # smart double quotes
        '\u2018': '`',  '\u2019': "'",    # smart single quotes
    }
    for char, latex_eq in latin_accent_map.items():
        text = text.replace(char, latex_eq)
    
    # Transliterate any remaining non-ASCII (Cyrillic, CJK, Arabic, etc.)
    # Process character-by-character to preserve ASCII and LaTeX commands
    if any(ord(c) > 127 for c in text):
        if UNIDECODE_AVAILABLE:
            # Only transliterate non-ASCII runs to avoid mangling LaTeX commands
            result = []
            for c in text:
                if ord(c) > 127:
                    result.append(_unidecode(c))
                else:
                    result.append(c)
            text = ''.join(result)
        else:
            # Fallback: strip remaining non-ASCII
            text = text.encode('ascii', 'ignore').decode('ascii')
    
    return text


@dataclass
class Source:
    """Unified source representation with PhD-level comprehensive fields"""
    title: str
    authors: List[str]
    year: Optional[int]
    abstract: str
    url: str
    source_type: str
    citation_key: str = ""
    citation_count: int = 0
    venue: Optional[str] = None
    doi: Optional[str] = None  # Never null - use explicit string if not available
    pdf_url: Optional[str] = None  # Never null - use explicit string if not available
    full_text: Optional[str] = None  # 3000-8000 word LLM-generated comprehensive summary
    credibility_score: float = 0.0
    retrieved_at: datetime = field(default_factory=datetime.now)
    
    # PhD-level comprehensive fields (500-1500 words each)
    research_question_or_purpose: Optional[str] = None  # 500-1000 words
    methodology: Optional[str] = None  # 800-1500 words
    key_findings_results: Optional[str] = None  # 800-1500 words
    implications_contributions: Optional[str] = None  # 600-1000 words
    relation_to_other_research: Optional[str] = None  # 600-1000 words
    limitations_gaps: Optional[str] = None  # 500-800 words
    
    # NEW: Additional deep analysis fields
    theoretical_framework: Optional[str] = None  # 600-1000 words
    key_concepts: List[str] = field(default_factory=list)  # 10-20 concepts with 50-80 word definitions
    evidence_strength: Optional[str] = None  # 300-500 words
    practical_applications: Optional[str] = None  # 400-700 words
    
    # Pertinence score (0-100)
    pertinence_score: Optional[float] = None
    
    # Extraction metadata
    extraction_confidence: float = 0.0  # 0-1 score
    extraction_method: str = "unknown"  # "abstract_analysis" | "web_search" | "llm_inference"
    inferred_fields: List[str] = field(default_factory=list)  # Fields that were LLM-inferred
    
    # Reference chaining
    references_cited: List[Dict] = field(default_factory=list)  # Papers cited by this source
    times_cited_in_collection: int = 0  # How many papers in our collection cite this
    
    def _escape_bibtex(self, text: str) -> str:
        """Escape special characters for BibTeX compatibility
        
        BibTeX requires special characters to be escaped:
        - & -> \&
        - % -> \%
        - $ -> \$
        - # -> \#
        - _ -> \_
        - { and } need special handling (they're used for grouping)
        - Unicode characters should be handled carefully
        """
        if not text:
            return ""
        
        # First, handle braces - they need to be balanced
        # Replace single braces with escaped versions, but preserve balanced pairs
        # This is a simplified approach - for complex cases, we might need more sophisticated parsing
        text = text.replace('{', '\\{').replace('}', '\\}')
        
        # Escape other special BibTeX characters
        text = text.replace('&', '\\&')
        text = text.replace('%', '\\%')
        text = text.replace('$', '\\$')
        text = text.replace('#', '\\#')
        text = text.replace('_', '\\_')
        
        # Handle common Unicode characters that cause issues
        # Convert to LaTeX equivalents
        unicode_replacements = {
            '…': '\\ldots',
            '–': '--',  # en dash
            '—': '---',  # em dash
            '"': '"',  # left double quote
            '"': '"',  # right double quote
            ''': "'",  # left single quote
            ''': "'",  # right single quote
        }
        
        for unicode_char, latex_replacement in unicode_replacements.items():
            text = text.replace(unicode_char, latex_replacement)
        
        # Common accented Latin characters → LaTeX equivalents (pdflatex-safe)
        latin_accent_replacements = {
            'ä': '\\"a', 'ö': '\\"o', 'ü': '\\"u', 'Ä': '\\"A', 'Ö': '\\"O', 'Ü': '\\"U',
            'é': "\\'e", 'è': '\\`e', 'ê': '\\^e', 'ë': '\\"e',
            'á': "\\'a", 'à': '\\`a', 'â': '\\^a',
            'í': "\\'i", 'ì': '\\`i', 'î': '\\^i', 'ï': '\\"i',
            'ó': "\\'o", 'ò': '\\`o', 'ô': '\\^o',
            'ú': "\\'u", 'ù': '\\`u', 'û': '\\^u',
            'ñ': '\\~n', 'Ñ': '\\~N',
            'ç': '\\c{c}', 'Ç': '\\c{C}',
            'ß': '{\\ss}',
            'ø': '{\\o}', 'Ø': '{\\O}',
            'å': '{\\aa}', 'Å': '{\\AA}',
            'æ': '{\\ae}', 'Æ': '{\\AE}',
        }
        for char, latex_eq in latin_accent_replacements.items():
            text = text.replace(char, latex_eq)
        
        # Transliterate any remaining non-ASCII characters (Cyrillic, CJK, Arabic, etc.)
        # This is the critical fix: pdflatex cannot handle these characters
        if UNIDECODE_AVAILABLE:
            text = _unidecode(text)
        else:
            # Fallback: strip any remaining non-ASCII characters
            text = text.encode('ascii', 'ignore').decode('ascii')
        
        return text
    
    def _extract_website_name(self, url: str) -> str:
        """Extract website/organization name from URL"""
        if not url:
            return None
        
        try:
            from urllib.parse import urlparse
            parsed = urlparse(url)
            domain = parsed.netloc or parsed.path
            
            # Remove www. prefix
            domain = domain.replace('www.', '')
            
            # Extract main domain name (e.g., 'scholar.google.com' -> 'Google Scholar')
            # Common domain mappings
            domain_mappings = {
                'scholar.google.com': 'Google Scholar',
                'arxiv.org': 'arXiv',
                'pubmed.ncbi.nlm.nih.gov': 'PubMed',
                'ieee.org': 'IEEE',
                'acm.org': 'ACM',
                'springer.com': 'Springer',
                'nature.com': 'Nature',
                'science.org': 'Science',
                'weforum.org': 'World Economic Forum',
                'unesco.org': 'UNESCO',
                'who.int': 'World Health Organization',
                'edu.gov': 'U.S. Department of Education',
            }
            
            # Check mappings first
            if domain in domain_mappings:
                return domain_mappings[domain]
            
            # Extract organization name from domain
            # Split by dots and take the main part
            parts = domain.split('.')
            if len(parts) >= 2:
                # Get the main domain (e.g., 'example' from 'example.com')
                main_part = parts[-2] if parts[-1] in ['com', 'org', 'edu', 'gov', 'net', 'io'] else parts[0]
                # Capitalize and format
                return main_part.replace('-', ' ').title()
            
            return domain.title()
        except Exception:
            return None
    
    def to_bibtex(self) -> str:
        """Convert to BibTeX entry with proper character escaping and smart type inference"""

        # Use citation utilities if available for better type inference
        if CITATION_UTILS_AVAILABLE:
            return self._to_bibtex_with_utils()
        else:
            return self._to_bibtex_legacy()

    def _to_bibtex_with_utils(self) -> str:
        """Generate BibTeX using citation_utils for better type inference and author handling"""
        # Build metadata dict for type inference
        metadata = {
            "title": self.title,
            "authors": self.authors,
            "year": self.year,
            "journal": self.venue,
            "venue": self.venue,
            "doi": self.doi,
            "url": self.url,
            "source_type": self.source_type,
            "abstract": self.abstract,
        }

        # Force @misc for BibTeX compatibility.
        entry_type = "misc"

        # Normalize and format authors
        normalized_authors = normalize_authors(self.authors, self.source_type)

        # Handle missing authors - use fallbacks
        if normalized_authors == ["Unknown"]:
            # Try to get author from venue first (for articles)
            if self.venue:
                authors_str = self._escape_bibtex(self.venue)
            # Then try website name from URL
            elif self.url:
                website_name = self._extract_website_name(self.url)
                if website_name:
                    authors_str = self._escape_bibtex(website_name)
                else:
                    authors_str = "Unknown"
            else:
                authors_str = "Unknown"
        else:
            # Format authors for BibTeX (join with " and ")
            authors_str = format_authors_for_bibtex(
                [self._escape_bibtex(a) for a in normalized_authors]
            )

        # Build BibTeX entry
        bib = f"@{entry_type}{{{self.citation_key},\n"
        bib += f"  title = {{{self._escape_bibtex(self.title)}}},\n"
        bib += f"  author = {{{authors_str}}},\n"

        if self.year:
            bib += f"  year = {{{self.year}}},\n"

        # Add venue field based on entry type
        if self.venue:
            if entry_type == "article":
                bib += f"  journal = {{{self._escape_bibtex(self.venue)}}},\n"
            elif entry_type == "inproceedings":
                bib += f"  booktitle = {{{self._escape_bibtex(self.venue)}}},\n"
            else:
                bib += f"  howpublished = {{{self._escape_bibtex(self.venue)}}},\n"

        if self.doi:
            bib += f"  doi = {{{self._escape_bibtex(str(self.doi))}}},\n"

        if self.url:
            escaped_url = str(self.url).replace('&', '\\&').replace('#', '\\#').replace('%', '\\%')
            bib += f"  url = {{{escaped_url}}},\n"

        bib += "}\n"
        return bib

    def _to_bibtex_legacy(self) -> str:
        """Legacy BibTeX generation (fallback if citation_utils not available)"""
        # Handle missing authors - use fallbacks
        if not self.authors or all(a.lower() in ['unknown', 'unknown author', 'unknown authors', ''] for a in self.authors):
            # Try to get author from venue first (for articles)
            if self.venue:
                authors_str = self._escape_bibtex(self.venue)
            # Then try website name from URL
            elif self.url:
                website_name = self._extract_website_name(self.url)
                if website_name:
                    authors_str = self._escape_bibtex(website_name)
                else:
                    # Last resort: use domain from URL
                    try:
                        from urllib.parse import urlparse
                        domain = urlparse(self.url).netloc.replace('www.', '')
                        authors_str = self._escape_bibtex(domain.title())
                    except (ValueError, AttributeError) as e:
                        logger.debug(f"Failed to parse domain from URL {self.url}: {e}")
                        authors_str = "Unknown"
            else:
                authors_str = "Unknown"
        else:
            # Escape authors individually, then join
            escaped_authors = [self._escape_bibtex(author) for author in self.authors if author and author.lower() not in ['unknown', 'unknown author', 'unknown authors']]
            if escaped_authors:
                authors_str = " and ".join(escaped_authors)
            else:
                # Fallback if all authors were filtered out
                if self.venue:
                    authors_str = self._escape_bibtex(self.venue)
                elif self.url:
                    website_name = self._extract_website_name(self.url)
                    authors_str = self._escape_bibtex(website_name) if website_name else "Unknown"
                else:
                    authors_str = "Unknown"

        entry_type = "misc"

        bib = f"@{entry_type}{{{self.citation_key},\n"
        bib += f"  title = {{{self._escape_bibtex(self.title)}}},\n"
        bib += f"  author = {{{authors_str}}},\n"

        if self.year:
            bib += f"  year = {{{self.year}}},\n"
        if self.venue:
            bib += f"  howpublished = {{{self._escape_bibtex(self.venue)}}},\n"
        if self.doi:
            # DOI usually doesn't need escaping, but be safe
            bib += f"  doi = {{{self._escape_bibtex(str(self.doi))}}},\n"
        if self.url:
            # URLs typically don't need escaping, but escape special chars just in case
            # We'll escape &, #, % which are common in URLs
            escaped_url = str(self.url).replace('&', '\\&').replace('#', '\\#').replace('%', '\\%')
            bib += f"  url = {{{escaped_url}}},\n"

        bib += "}\n"
        return bib
    
    def to_dict(self) -> Dict:
        """Convert to dictionary for JSON serialization"""
        data = asdict(self)
        # Convert datetime to string for JSON serialization
        if 'retrieved_at' in data and hasattr(data['retrieved_at'], 'isoformat'):
            data['retrieved_at'] = data['retrieved_at'].isoformat()
        return data
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'Source':
        """Create Source from dictionary"""
        # Handle datetime conversion
        if 'retrieved_at' in data and isinstance(data['retrieved_at'], str):
            data['retrieved_at'] = datetime.fromisoformat(data['retrieved_at'])
        return cls(**data)

    @classmethod
    def from_bibtex(cls, bibtex_str: str, citation_key_override: Optional[str] = None) -> 'Source':
        """Create Source from a BibTeX string (e.g. from Zotero get_item_bibtex).
        citation_key_override: use this as citation_key (e.g. Zotero item key).
        """
        import bibtexparser
        db = bibtexparser.loads(bibtex_str)
        if not db.entries:
            raise ValueError("BibTeX string has no entries")
        entry = db.entries[0]
        title = (entry.get("title") or "Unknown").strip()
        if title.startswith("{") and title.endswith("}"):
            title = title[1:-1]
        author_str = entry.get("author") or ""
        authors = [a.strip() for a in re.split(r"\s+and\s+", author_str, flags=re.IGNORECASE) if a.strip()]
        year_raw = entry.get("year") or ""
        year = None
        if year_raw:
            try:
                m = re.search(r"\d{4}", str(year_raw))
                year = int(m.group(0)) if m else None
            except (ValueError, AttributeError):
                pass
        venue = entry.get("journal") or entry.get("booktitle") or ""
        url = entry.get("url") or ""
        doi = entry.get("doi") or ""
        abstract = entry.get("abstract") or ""
        citation_key = citation_key_override or entry.get("ID") or entry.get("id") or ""
        return cls(
            title=title,
            authors=authors if authors else ["Unknown"],
            year=year,
            abstract=abstract,
            url=url,
            source_type="zotero",
            citation_key=citation_key,
            venue=venue or None,
            doi=doi or None,
        )

    def __json__(self):
        """JSON serialization support"""
        return self.to_dict()

@dataclass
class Section:
    """Section structure"""
    id: str
    name: str
    key_points: List[str]
    search_queries: List[str]
    percentage: float = 0.0
    target_words: int = 0
    subsections: List['Section'] = field(default_factory=list)
    content: str = ""
    sources: List[Source] = field(default_factory=list)
    word_count: int = 0
