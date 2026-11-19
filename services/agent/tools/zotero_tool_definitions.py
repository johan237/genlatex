"""
LangChain tool definitions for ZoteroTools
Converts ZoteroTools class methods to LangChain @tool decorators for agent use
"""

from typing import Optional
from langchain_core.tools import tool


def create_zotero_tools(zotero_tools_instance, citation_manager=None):
    """
    Create LangChain tools from ZoteroTools instance.

    Args:
        zotero_tools_instance: Instance of ZoteroTools class
        citation_manager: Optional CitationManager; when set, adds add_zotero_item_to_bibliography tool

    Returns:
        List of LangChain tool objects
    """

    @tool
    def list_zotero_items(limit: int = 50) -> str:
        """
        List items in the user's Zotero library or selected collection.
        Use this to browse available references before searching or reading fulltext.

        Args:
            limit: Maximum number of items to return (default: 50)

        Returns:
            Formatted list of Zotero items with key, title, authors, year
        """
        try:
            return zotero_tools_instance.list_items(limit=limit)
        except Exception as e:
            return f"Error: {str(e)}"

    @tool
    def search_zotero_items(query: str, limit: int = 20) -> str:
        """
        Search Zotero library by query. Includes full-text search (PDF content, notes).
        Use when user asks for articles on a topic or to find specific papers.

        Args:
            query: Search query (e.g., 'machine learning', 'transformer architecture')
            limit: Maximum results (default: 20)

        Returns:
            Formatted list of matching items with key, title, authors, year
        """
        try:
            return zotero_tools_instance.search_items(query=query, limit=limit)
        except Exception as e:
            return f"Error: {str(e)}"

    @tool
    def get_zotero_item_fulltext(item_key: str) -> str:
        """
        Get full-text content of a Zotero attachment (e.g., PDF) by item key.
        Call on-demand when you need to read the actual content. Do not assume content - fetch when needed.
        For long documents, content is truncated; use search for specific terms.

        Args:
            item_key: Zotero item key (from list_zotero_items or search_zotero_items)

        Returns:
            Full-text content of the attachment (truncated if very long)
        """
        try:
            return zotero_tools_instance.get_item_fulltext(item_key)
        except Exception as e:
            return f"Error: {str(e)}"

    @tool
    def get_zotero_item_bibtex(item_key: str) -> str:
        """
        Get BibTeX entry for a Zotero item. Use when adding citations to bibliography.

        Args:
            item_key: Zotero item key (from list_zotero_items or search_zotero_items)

        Returns:
            BibTeX string for the item
        """
        try:
            return zotero_tools_instance.get_item_bibtex(item_key)
        except Exception as e:
            return f"Error: {str(e)}"

    @tool
    def get_zotero_item_metadata(item_key: str) -> str:
        """
        Get metadata for a Zotero item (title, authors, abstract, etc.).

        Args:
            item_key: Zotero item key

        Returns:
            Formatted metadata string
        """
        try:
            return zotero_tools_instance.get_item_metadata(item_key)
        except Exception as e:
            return f"Error: {str(e)}"

    tools_list = [
        list_zotero_items,
        search_zotero_items,
        get_zotero_item_metadata,
        get_zotero_item_fulltext,
        get_zotero_item_bibtex,
    ]

    if citation_manager is not None:

        @tool
        def add_zotero_item_to_bibliography(item_key: str) -> str:
            """
            Add a Zotero item to the paper bibliography so it can be cited with \\cite{item_key}.
            Call this when you find a relevant Zotero item that should be cited in the paper.

            Args:
                item_key: Zotero item key (from list_zotero_items or search_zotero_items)

            Returns:
                Success or error message
            """
            try:
                key = (item_key or "").strip()
                if not key:
                    return "Error: item_key is empty"
                from utils.zotero_citation import ensure_zotero_items_in_citation_manager
                ensure_zotero_items_in_citation_manager(
                    zotero_tools_instance, citation_manager, [key]
                )
                if key in citation_manager.sources:
                    return f"Added Zotero item {key} to bibliography. You can cite it with \\cite{{{key}}}"
                return f"Could not add Zotero item {key} (not found or error fetching BibTeX)"
            except Exception as e:
                return f"Error adding Zotero item to bibliography: {str(e)}"

        tools_list.append(add_zotero_item_to_bibliography)

    return tools_list
