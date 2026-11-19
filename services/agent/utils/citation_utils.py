# utils/citation_utils.py
"""
Citation Utilities for GenLaTeX Agent

This module provides utilities for:
1. Author normalization from different API formats
2. BibTeX entry type inference from metadata
3. Citation key generation with uniqueness checking
4. Metadata quality scoring

These utilities help ensure high-quality BibTeX entries with proper
author names, correct entry types, and meaningful citation keys.
"""

import re
import hashlib
from typing import List, Dict, Any, Optional, Set, Tuple
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)


# =============================================================================
# AUTHOR NORMALIZATION
# =============================================================================

def normalize_authors(raw_authors: Any, source_type: str = "unknown") -> List[str]:
    """
    Convert any author format from different APIs to a standard list of author names.

    Each search API returns authors in different formats:
    - Semantic Scholar: [{"name": "John Smith"}, ...]
    - arXiv: [arxiv.Result.Author objects] or strings
    - Europe PMC: "Smith J, Doe J, Brown A" (string)
    - DOAJ: {"author": [{"name": "John Smith"}]}
    - Google Scholar (scraped): "J Smith, J Doe - Nature, 2024"
    - PubMed: Various formats

    Args:
        raw_authors: Author data in any format
        source_type: Source API type for format-specific parsing

    Returns:
        List of normalized author names as strings
    """
    if not raw_authors:
        return ["Unknown"]

    normalized = []

    # Handle string input (common for scraped/concatenated authors)
    if isinstance(raw_authors, str):
        normalized = _parse_author_string(raw_authors, source_type)

    # Handle list input
    elif isinstance(raw_authors, list):
        for author in raw_authors:
            if not author:
                continue

            # Dict with name field (Semantic Scholar, DOAJ)
            if isinstance(author, dict):
                name = author.get("name") or author.get("fullName") or author.get("authorName", "")
                if name:
                    normalized.append(_clean_author_name(name))

            # arxiv.Result.Author object
            elif hasattr(author, 'name'):
                normalized.append(_clean_author_name(str(author.name)))

            # Plain string
            elif isinstance(author, str):
                cleaned = _clean_author_name(author)
                if cleaned:
                    normalized.append(cleaned)

    # Handle dict input (some APIs return a dict directly)
    elif isinstance(raw_authors, dict):
        # DOAJ format: {"author": [...]}
        if "author" in raw_authors:
            return normalize_authors(raw_authors["author"], source_type)
        # Direct name
        elif "name" in raw_authors:
            normalized.append(_clean_author_name(raw_authors["name"]))

    # Filter out invalid entries and duplicates while preserving order
    seen = set()
    result = []
    for name in normalized:
        if name and name.lower() not in ("unknown", "unknown author", "et al", "et al.", ""):
            name_lower = name.lower()
            if name_lower not in seen:
                seen.add(name_lower)
                result.append(name)

    return result if result else ["Unknown"]


def _parse_author_string(author_str: str, source_type: str) -> List[str]:
    """Parse author string into list of names"""
    if not author_str:
        return []

    # Google Scholar format: "J Smith, J Doe - Nature, 2024"
    # Remove venue info after dash
    if " - " in author_str:
        author_str = author_str.split(" - ")[0]

    # Remove common suffixes
    author_str = re.sub(r'\s*\(?\d{4}\)?$', '', author_str)  # Remove year
    author_str = re.sub(r'\s*et\s+al\.?\s*$', '', author_str, flags=re.IGNORECASE)  # Remove "et al"

    # Split by common separators
    # Try "and" first (BibTeX style)
    if re.search(r'\s+and\s+', author_str, re.IGNORECASE):
        parts = re.split(r'\s+and\s+', author_str, flags=re.IGNORECASE)
    # Try semicolon
    elif ';' in author_str:
        parts = author_str.split(';')
    # Try comma (but be careful with "Last, First" format)
    elif ', ' in author_str:
        # Check if it's "Last, First" format or comma-separated list
        # "Last, First" typically has exactly one comma per author
        comma_count = author_str.count(',')
        if comma_count == 1 and not re.search(r',\s*[A-Z][a-z]+\s*,', author_str):
            # Likely "Last, First" format
            parts = [author_str]
        else:
            # Multiple authors separated by commas
            # Try to detect "Last, First, Last, First" vs "First Last, First Last"
            parts = author_str.split(',')
            # Merge pairs if they look like "Last, First"
            parts = _merge_last_first_pairs(parts)
    else:
        parts = [author_str]

    return [_clean_author_name(p) for p in parts if p.strip()]


def _merge_last_first_pairs(parts: List[str]) -> List[str]:
    """Merge 'Last, First' pairs from a comma-split list"""
    result = []
    i = 0
    while i < len(parts):
        part = parts[i].strip()
        # Check if next part looks like a first name (short, starts with capital)
        if i + 1 < len(parts):
            next_part = parts[i + 1].strip()
            # If current is a single word and next starts with capital letter
            if (len(part.split()) == 1 and
                next_part and next_part[0].isupper() and
                len(next_part.split()) <= 2):
                # Merge as "First Last" (reverse the BibTeX "Last, First" format)
                result.append(f"{next_part} {part}")
                i += 2
                continue
        result.append(part)
        i += 1
    return result


def _clean_author_name(name: str) -> str:
    """Clean and normalize a single author name"""
    if not name:
        return ""

    # Strip whitespace
    name = name.strip()

    # Remove numbers and common artifacts
    name = re.sub(r'\d+', '', name)  # Remove numbers
    name = re.sub(r'\s*\([^)]*\)', '', name)  # Remove parenthetical info
    name = re.sub(r'\s*<[^>]*>', '', name)  # Remove email/angle brackets
    name = re.sub(r'\s{2,}', ' ', name)  # Collapse multiple spaces

    # Remove common prefixes/suffixes
    name = re.sub(r'^(Dr\.?|Prof\.?|Mr\.?|Ms\.?|Mrs\.?)\s+', '', name, flags=re.IGNORECASE)
    name = re.sub(r',?\s*(Jr\.?|Sr\.?|III|II|IV|PhD|MD|MSc)$', '', name, flags=re.IGNORECASE)

    name = name.strip(' .,;')

    # Skip if too short or looks invalid
    if len(name) < 2 or name.lower() in ('unknown', 'anonymous', 'n/a', 'na'):
        return ""

    return name


def format_authors_for_bibtex(authors: List[str]) -> str:
    """Format author list for BibTeX (join with ' and ')"""
    if not authors or authors == ["Unknown"]:
        return "Unknown"
    return " and ".join(authors)


# =============================================================================
# BIBTEX TYPE INFERENCE
# =============================================================================

@dataclass
class BibtexTypeResult:
    """Result of BibTeX type inference"""
    entry_type: str
    confidence: float  # 0-1
    reason: str


def infer_bibtex_type(metadata: Dict[str, Any]) -> BibtexTypeResult:
    """
    Infer the most appropriate BibTeX entry type from metadata.

    BibTeX types:
    - article: Journal article
    - inproceedings: Conference paper
    - book: Complete book
    - inbook: Chapter in a book
    - techreport: Technical report
    - phdthesis/mastersthesis: Thesis
    - online/misc: Web resource or unknown

    Args:
        metadata: Dictionary with fields like title, journal, venue, booktitle,
                 doi, url, arxiv_id, source_type, etc.

    Returns:
        BibtexTypeResult with entry_type, confidence, and reason
    """
    # Extract relevant fields
    journal = metadata.get("journal") or metadata.get("venue") or ""
    booktitle = metadata.get("booktitle") or ""
    doi = metadata.get("doi") or ""
    url = metadata.get("url") or ""
    source_type = metadata.get("source_type", "").lower()
    title = metadata.get("title", "").lower()
    publisher = metadata.get("publisher") or ""
    isbn = metadata.get("isbn") or ""
    arxiv_id = metadata.get("arxiv_id") or ""

    # Check URL for hints
    url_lower = url.lower()

    # Priority 1: Has journal name -> article
    if journal:
        journal_lower = journal.lower()
        # Check if it's actually a conference proceedings
        conf_keywords = ['conference', 'proceedings', 'symposium', 'workshop', 'congress']
        if any(kw in journal_lower for kw in conf_keywords):
            return BibtexTypeResult("inproceedings", 0.9, f"Journal name indicates conference: {journal}")
        return BibtexTypeResult("article", 0.95, f"Has journal: {journal}")

    # Priority 2: Has booktitle -> inproceedings (conference)
    if booktitle:
        return BibtexTypeResult("inproceedings", 0.9, f"Has booktitle: {booktitle}")

    # Priority 3: Conference indicators in title/source
    conf_patterns = [
        r'\bconference\b', r'\bproceedings\b', r'\bsymposium\b',
        r'\bworkshop\b', r'\bicml\b', r'\bneurips\b', r'\biclr\b',
        r'\bcvpr\b', r'\biccv\b', r'\beccv\b', r'\bacl\b', r'\bemnlp\b',
        r'\baaai\b', r'\bijcai\b', r'\bsigir\b', r'\bkdd\b'
    ]
    for pattern in conf_patterns:
        if re.search(pattern, title) or re.search(pattern, source_type):
            return BibtexTypeResult("inproceedings", 0.85, f"Conference keyword in title/source")

    # Priority 4: arXiv -> article (preprint)
    if arxiv_id or 'arxiv' in url_lower or source_type == 'arxiv':
        return BibtexTypeResult("article", 0.8, "arXiv preprint")

    # Priority 5: Has DOI -> likely formal publication
    if doi:
        # DOI format can hint at type
        if 'conf' in doi.lower() or 'proc' in doi.lower():
            return BibtexTypeResult("inproceedings", 0.85, f"DOI indicates conference: {doi}")
        return BibtexTypeResult("article", 0.8, f"Has DOI: {doi}")

    # Priority 6: Book indicators
    if isbn or (publisher and not journal):
        return BibtexTypeResult("book", 0.75, f"Has ISBN or publisher without journal")

    # Priority 7: Thesis indicators
    thesis_patterns = [r'\bthesis\b', r'\bdissertation\b', r'\bphd\b', r'\bmaster\'?s?\b']
    for pattern in thesis_patterns:
        if re.search(pattern, title):
            if 'phd' in title or 'doctoral' in title:
                return BibtexTypeResult("phdthesis", 0.85, "Title indicates PhD thesis")
            elif 'master' in title:
                return BibtexTypeResult("mastersthesis", 0.85, "Title indicates Master's thesis")

    # Priority 8: Technical report indicators
    if re.search(r'\btechnical\s+report\b', title) or 'techreport' in source_type:
        return BibtexTypeResult("techreport", 0.8, "Technical report indicator")

    # Priority 9: Source type hints
    source_type_mapping = {
        'semantic_scholar': 'article',
        'pubmed': 'article',
        'europe_pmc': 'article',
        'doaj': 'article',
        'biorxiv': 'article',
        'medrxiv': 'article',
        'springer': 'article',
        'sciencedirect': 'article',
        'nature': 'article',
        'science': 'article',
    }
    if source_type in source_type_mapping:
        return BibtexTypeResult(source_type_mapping[source_type], 0.7, f"Source type: {source_type}")

    # Priority 10: URL-based detection
    if url:
        if any(x in url_lower for x in ['scholar.google', 'ieee.org', 'acm.org', 'springer', 'nature.com', 'science.org']):
            return BibtexTypeResult("article", 0.6, f"Academic URL: {url[:50]}")
        if url_lower.endswith('.pdf'):
            return BibtexTypeResult("article", 0.5, "PDF URL")

    # Default: online/misc
    if url:
        return BibtexTypeResult("online", 0.4, "Has URL but no other indicators")

    return BibtexTypeResult("misc", 0.3, "Insufficient metadata for type inference")


# =============================================================================
# CITATION KEY GENERATION
# =============================================================================

def generate_citation_key(
    metadata: Dict[str, Any],
    existing_keys: Optional[Set[str]] = None
) -> str:
    """
    Generate a unique, meaningful citation key.

    Format: {first_author_lastname}{year}{keyword}
    Examples: vaswani2017attention, he2016deep, brown2020language

    Args:
        metadata: Dictionary with authors, year, title
        existing_keys: Set of existing keys to avoid collisions

    Returns:
        Unique citation key string
    """
    existing_keys = existing_keys or set()

    # Extract first author's last name
    authors = metadata.get("authors", [])
    last_name = _extract_last_name(authors)

    # Get year
    year = _extract_year(metadata.get("year"))

    # Extract a keyword from title
    keyword = _extract_title_keyword(metadata.get("title", ""))

    # Build base key
    base_key = f"{last_name}{year}{keyword}"

    # Ensure it's valid (no special chars, reasonable length)
    base_key = re.sub(r'[^a-zA-Z0-9]', '', base_key)

    if not base_key or base_key in ("", "unknown", "unknownpaper"):
        # Fallback: use hash of title
        title = metadata.get("title", "untitled")
        base_key = f"ref{abs(hash(title)) % 100000}"

    # Truncate if too long
    base_key = base_key[:40]

    # Ensure uniqueness
    final_key = base_key
    suffix = 1
    while final_key.lower() in {k.lower() for k in existing_keys}:
        if suffix <= 26:
            final_key = f"{base_key}{chr(96 + suffix)}"  # a, b, c, ...
        else:
            final_key = f"{base_key}{suffix}"
        suffix += 1

    return final_key


def _extract_last_name(authors: Any) -> str:
    """Extract last name from first author"""
    if not authors:
        return "unknown"

    first_author = authors[0] if isinstance(authors, list) else str(authors)

    # Handle dict format
    if isinstance(first_author, dict):
        first_author = first_author.get("name", "unknown")

    # Handle Author objects
    if hasattr(first_author, 'name'):
        first_author = str(first_author.name)

    first_author = str(first_author).strip()

    if not first_author or first_author.lower() in ("unknown", "unknown author"):
        return "unknown"

    # Handle "Last, First" format
    if "," in first_author:
        last_name = first_author.split(",")[0].strip()
    else:
        # Get last word as last name
        parts = first_author.split()
        last_name = parts[-1] if parts else "unknown"

    # Clean the name
    last_name = re.sub(r'[^a-zA-Z]', '', last_name).lower()

    return last_name if last_name else "unknown"


def _extract_year(year_value: Any) -> str:
    """Extract 4-digit year from various formats"""
    if not year_value:
        return ""

    year_str = str(year_value)

    # Find 4-digit year
    match = re.search(r'(19|20)\d{2}', year_str)
    if match:
        return match.group(0)

    return ""


def _extract_title_keyword(title: str) -> str:
    """Extract a significant keyword from title"""
    if not title:
        return ""

    title = title.lower()

    # Remove punctuation and split
    words = re.findall(r'\b[a-z]{4,}\b', title)

    # Stop words to skip
    stop_words = {
        'a', 'an', 'the', 'of', 'for', 'and', 'or', 'in', 'on', 'to', 'with',
        'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had',
        'this', 'that', 'these', 'those', 'from', 'into', 'through', 'during',
        'before', 'after', 'above', 'below', 'between', 'under', 'again',
        'further', 'then', 'once', 'here', 'there', 'when', 'where', 'why',
        'how', 'all', 'each', 'few', 'more', 'most', 'other', 'some', 'such',
        'only', 'same', 'than', 'very', 'can', 'will', 'just', 'should',
        'using', 'based', 'towards', 'toward', 'approach', 'approaches',
        'study', 'studies', 'analysis', 'method', 'methods', 'paper', 'papers',
        'work', 'works', 'novel', 'new', 'improved', 'efficient', 'effective'
    }

    # Find first significant word
    for word in words:
        if word not in stop_words:
            return word

    # Fallback: first word over 3 chars
    return words[0] if words else ""


# =============================================================================
# METADATA QUALITY SCORING
# =============================================================================

def calculate_metadata_quality(metadata: Dict[str, Any]) -> Tuple[float, Dict[str, bool]]:
    """
    Calculate a quality score for metadata completeness.

    Returns:
        Tuple of (score 0-1, dict of field_name -> is_present)
    """
    fields = {
        'title': bool(metadata.get('title')),
        'authors': bool(metadata.get('authors')) and metadata.get('authors') != ["Unknown"],
        'year': bool(metadata.get('year')),
        'journal_or_venue': bool(metadata.get('journal') or metadata.get('venue') or metadata.get('booktitle')),
        'doi': bool(metadata.get('doi')),
        'url': bool(metadata.get('url')),
        'abstract': bool(metadata.get('abstract')),
    }

    # Weighted scoring
    weights = {
        'title': 0.2,
        'authors': 0.25,
        'year': 0.15,
        'journal_or_venue': 0.2,
        'doi': 0.1,
        'url': 0.05,
        'abstract': 0.05,
    }

    score = sum(weights[field] for field, present in fields.items() if present)

    return score, fields


def get_metadata_suggestions(metadata: Dict[str, Any]) -> List[str]:
    """Get suggestions for improving metadata quality"""
    score, fields = calculate_metadata_quality(metadata)
    suggestions = []

    if not fields['authors']:
        suggestions.append("Missing or unknown authors - consider manual verification")
    if not fields['year']:
        suggestions.append("Missing publication year")
    if not fields['journal_or_venue']:
        suggestions.append("Missing journal/venue information - entry will be @misc")
    if not fields['doi']:
        suggestions.append("No DOI available - URL will be used instead")

    if score < 0.5:
        suggestions.append(f"Low metadata quality ({score:.0%}) - citation may be incomplete")

    return suggestions


# =============================================================================
# HELPER FUNCTIONS FOR INTEGRATION
# =============================================================================

def create_source_from_search_result(
    result: Dict[str, Any],
    source_type: str,
    existing_keys: Optional[Set[str]] = None
) -> Dict[str, Any]:
    """
    Create a normalized source dict from a search result.

    This is a convenience function that applies all normalizations.

    Args:
        result: Raw search result dictionary
        source_type: Type of source API
        existing_keys: Existing citation keys to avoid collisions

    Returns:
        Normalized source dictionary ready for Source creation
    """
    # Normalize authors
    raw_authors = result.get("authors") or result.get("author") or []
    authors = normalize_authors(raw_authors, source_type)

    # Build metadata for type inference
    metadata = {
        "title": result.get("title", ""),
        "authors": authors,
        "year": result.get("year") or result.get("published") or result.get("publicationDate"),
        "journal": result.get("journal") or result.get("venue") or result.get("journalName"),
        "booktitle": result.get("booktitle") or result.get("conferenceName"),
        "doi": result.get("doi") or result.get("DOI"),
        "url": result.get("url") or result.get("link"),
        "source_type": source_type,
        "abstract": result.get("abstract") or result.get("summary") or "",
        "arxiv_id": result.get("arxiv_id") or result.get("paperId"),
        "publisher": result.get("publisher"),
        "isbn": result.get("isbn"),
    }

    # Infer BibTeX type
    type_result = infer_bibtex_type(metadata)

    # Generate citation key
    citation_key = generate_citation_key(metadata, existing_keys)

    # Calculate quality
    quality_score, _ = calculate_metadata_quality(metadata)

    return {
        "title": metadata["title"],
        "authors": authors,
        "year": _extract_year(metadata["year"]) or None,
        "venue": metadata["journal"] or metadata["booktitle"],
        "doi": metadata["doi"],
        "url": metadata["url"],
        "abstract": metadata["abstract"],
        "source_type": source_type,
        "citation_key": citation_key,
        "bibtex_type": type_result.entry_type,
        "bibtex_type_confidence": type_result.confidence,
        "metadata_quality": quality_score,
    }
