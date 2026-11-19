"""
Ensure Zotero items are in CitationManager so \\cite{zotero_key} works in the paper.
Auto-sync: migrate selected Zotero library/collection to .bib (CitationManager).
"""

from typing import List
import re
import logging

logger = logging.getLogger(__name__)

# Max items to sync from Zotero library into bib (avoid rate limits and huge bibs)
ZOTERO_SYNC_LIMIT = 200


def _extract_item_keys_from_list_output(list_output: str) -> List[str]:
    """Parse list_items/search_items formatted output: '[KEY] Title (authors, year)' -> KEY."""
    keys = []
    for line in list_output.splitlines():
        line = line.strip()
        if not line or line.startswith("Found ") or line.startswith("No items"):
            continue
        m = re.search(r"\[([A-Za-z0-9]+)\]", line)
        if m:
            keys.append(m.group(1))
    return keys


def sync_zotero_library_to_bib(
    zotero_tools,
    citation_manager,
    limit: int = ZOTERO_SYNC_LIMIT,
) -> int:
    """
    Automatically migrate the selected Zotero library/collection into the paper's .bib
    (CitationManager). Call once at paper gen start when Zotero is connected so all
    items are available for citation without on-demand add. Returns number of items
    newly added to the bibliography.
    """
    if not zotero_tools or not citation_manager:
        return 0
    try:
        list_output = zotero_tools.list_items(limit=limit)
        if not list_output or "No items" in list_output or "Error" in list_output:
            logger.info("Zotero auto-sync: no items in library/collection")
            return 0
        keys = _extract_item_keys_from_list_output(list_output)
        if not keys:
            return 0
        already = sum(1 for k in keys if k in citation_manager.sources)
        ensure_zotero_items_in_citation_manager(zotero_tools, citation_manager, keys)
        added = sum(1 for k in keys if k in citation_manager.sources) - already
        logger.info("Zotero auto-sync: %d items in library, %d newly added to bibliography", len(keys), added)
        return added
    except Exception as e:
        logger.warning("Zotero auto-sync failed: %s", e)
        return 0


def ensure_zotero_items_in_citation_manager(zotero_tools, citation_manager, item_keys: List[str]) -> None:
    """
    For each Zotero item key, fetch BibTeX, parse to Source, and add to CitationManager
    with force_citation_key=True so \\cite{key} is valid. Skips keys already present.
    """
    if not zotero_tools or not citation_manager or not item_keys:
        return
    for item_key in item_keys:
        item_key = (item_key or "").strip()
        if not item_key:
            continue
        if item_key in citation_manager.sources:
            continue
        try:
            bibtex_str = zotero_tools.get_item_bibtex(item_key)
            if not bibtex_str or "not found" in bibtex_str.lower() or bibtex_str.strip().startswith("Error"):
                logger.warning("Zotero get_item_bibtex failed or not found for key %s: %s", item_key, (bibtex_str or "")[:80])
                continue
            from utils.sources import Source
            source = Source.from_bibtex(bibtex_str, citation_key_override=item_key)
            citation_manager.add_source(source, force_citation_key=True)
            logger.info("Added Zotero item %s to CitationManager", item_key)
        except Exception as e:
            logger.warning("Failed to add Zotero item %s to CitationManager: %s", item_key, e)
