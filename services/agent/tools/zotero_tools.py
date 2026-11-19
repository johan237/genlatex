"""
Zotero API tools for AI to access Zotero library on-demand.
Fetches content when needed - does not save documents locally.
"""

from typing import List, Dict, Any, Optional
import logging

logger = logging.getLogger(__name__)

MAX_FULLTEXT_CHARS = 4000


class ZoteroTools:
    """Tools for AI to access Zotero library via API.

    On-demand access: fetches content when needed, never saves locally.
    Context management: truncates long fulltext for token limits.
    """

    def __init__(
        self,
        api_key: str,
        library_id: str,
        library_type: str = "user",
        collection_key: Optional[str] = None,
    ):
        self.api_key = api_key
        self.library_id = library_id
        self.library_type = library_type
        self.collection_key = collection_key
        self._zot = None

    def _get_zot(self):
        if self._zot is None:
            try:
                from pyzotero import zotero

                self._zot = zotero.Zotero(
                    self.library_id,
                    self.library_type,
                    self.api_key,
                )
            except ImportError:
                raise ImportError("pyzotero is required. Install with: pip install pyzotero")
        return self._zot

    def _format_item(self, item: Dict) -> Dict[str, Any]:
        """Extract key fields from Zotero item for display."""
        data = item.get("data", item) if isinstance(item, dict) else {}
        if isinstance(data, dict):
            creators = data.get("creators", [])
            authors = []
            for c in creators:
                if c.get("firstName") and c.get("lastName"):
                    authors.append(f"{c['firstName']} {c['lastName']}")
                elif c.get("name"):
                    authors.append(c["name"])
            year = ""
            if data.get("date"):
                try:
                    year = str(data["date"])[:4]
                except Exception:
                    year = data.get("date", "")
            return {
                "key": data.get("key", item.get("key", "")),
                "title": data.get("title", "Untitled"),
                "authors": authors,
                "year": year,
                "itemType": data.get("itemType", ""),
                "abstractNote": (data.get("abstractNote") or "")[:300],
                "publicationTitle": data.get("publicationTitle", ""),
            }
        return {"key": item.get("key", ""), "title": "Unknown"}

    def list_items(self, limit: int = 50) -> str:
        """List items in the library or collection."""
        try:
            zot = self._get_zot()
            if self.collection_key:
                items = zot.collection_items(self.collection_key, limit=limit)
            else:
                items = zot.top(limit=limit)
            if not items:
                return "No items found in Zotero library."
            lines = [f"Found {len(items)} item(s) in Zotero:\n"]
            for i, item in enumerate(items, 1):
                fmt = self._format_item(item)
                auth = ", ".join(fmt["authors"][:3])
                if len(fmt["authors"]) > 3:
                    auth += " et al."
                lines.append(f"{i}. [{fmt['key']}] {fmt['title']} ({auth}, {fmt['year']})")
            return "\n".join(lines)
        except Exception as e:
            logger.error(f"Zotero list_items error: {e}")
            return f"Error listing Zotero items: {str(e)}"

    def search_items(self, query: str, limit: int = 20) -> str:
        """Search items by query (includes fulltext when qmode=everything)."""
        try:
            zot = self._get_zot()
            if self.collection_key:
                items = zot.collection_items(
                    self.collection_key, q=query, qmode="everything", limit=limit
                )
            else:
                items = zot.items(q=query, qmode="everything", limit=limit)
            if not items:
                return f"No items found for query: {query}"
            lines = [f"Found {len(items)} item(s) for '{query}':\n"]
            for i, item in enumerate(items, 1):
                fmt = self._format_item(item)
                auth = ", ".join(fmt["authors"][:3]) if fmt["authors"] else "Unknown"
                lines.append(f"{i}. [{fmt['key']}] {fmt['title']} ({auth}, {fmt['year']})")
            return "\n".join(lines)
        except Exception as e:
            logger.error(f"Zotero search_items error: {e}")
            return f"Error searching Zotero: {str(e)}"

    def get_item_metadata(self, item_key: str) -> str:
        """Get metadata for a specific item."""
        try:
            zot = self._get_zot()
            items = zot.item(item_key)
            if not items:
                return f"Item not found: {item_key}"
            item = items[0] if isinstance(items, list) else items
            fmt = self._format_item(item)
            lines = [
                f"Title: {fmt['title']}",
                f"Authors: {', '.join(fmt['authors']) if fmt['authors'] else 'Unknown'}",
                f"Year: {fmt['year']}",
                f"Type: {fmt['itemType']}",
                f"Key: {fmt['key']}",
            ]
            if fmt.get("abstractNote"):
                lines.append(f"Abstract: {fmt['abstractNote'][:500]}...")
            if fmt.get("publicationTitle"):
                lines.append(f"Publication: {fmt['publicationTitle']}")
            return "\n".join(lines)
        except Exception as e:
            logger.error(f"Zotero get_item_metadata error: {e}")
            return f"Error getting item metadata: {str(e)}"

    def get_item_fulltext(self, item_key: str, max_chars: int = MAX_FULLTEXT_CHARS) -> str:
        """Get full-text content for an attachment item (on-demand, not saved locally)."""
        try:
            zot = self._get_zot()
            result = zot.fulltext_item(item_key)
            if not result or not isinstance(result, dict):
                return f"No fulltext found for item {item_key}. It may not be an attachment with indexed content."
            content = result.get("content", "")
            if not content:
                return f"No fulltext content for item {item_key}."
            if len(content) > max_chars:
                content = content[:max_chars] + "\n\n... [truncated; use search for specific terms]"
            return content
        except Exception as e:
            logger.error(f"Zotero get_item_fulltext error: {e}")
            return f"Error getting fulltext: {str(e)}"

    def get_item_bibtex(self, item_key: str) -> str:
        """Get BibTeX for an item."""
        try:
            zot = self._get_zot()
            zot.add_parameters(format="bibtex")
            result = zot.item(item_key)
            if not result:
                return f"Item not found: {item_key}"
            if hasattr(result, "entries"):
                import bibtexparser
                return bibtexparser.dumps(result)
            if isinstance(result, str):
                return result
            if isinstance(result, list) and result:
                entry = result[0]
                if hasattr(entry, "entries"):
                    import bibtexparser
                    return bibtexparser.dumps(entry)
                return str(entry)
            return str(result)
        except Exception as e:
            logger.error(f"Zotero get_item_bibtex error: {e}")
            return f"Error getting BibTeX: {str(e)}"
