"""
LangChain tool definitions for ChatToolkit.
Converts ChatToolkit class methods to LangChain @tool decorators for agent use.

These tools are optimized for chat interactions with:
- User-friendly output formatting
- Context awareness
- Conversational follow-ups (add these, undo, etc.)
"""

import json
import re
from typing import Optional, List
from langchain_core.tools import tool


def create_chat_tools(chat_toolkit_instance):
    """
    Create LangChain tools from ChatToolkit instance.

    Args:
        chat_toolkit_instance: Instance of ChatToolkit class

    Returns:
        List of LangChain tool objects
    """

    @tool
    def find_articles(
        topic: str,
        count: int = 4,
        focus: str = "recent",
        max_results: Optional[int] = None,
    ) -> str:
        """
        Find academic articles on a topic for the user to potentially cite.
        Returns formatted results with options to add to bibliography.

        Args:
            topic: What to search for (e.g., "machine learning for climate modeling")
            count: Number of articles to find (default: 4, max: 10)
            focus: Search focus - "recent" (2020+), "foundational" (highly cited),
                   "review" (review papers), "methodology" (methods papers)
            max_results: Alias for count; if provided, overrides count.

        Returns:
            Formatted list of articles with add-to-bibliography prompt
        """
        try:
            n = (max_results if max_results is not None else count)
            n = min(max(1, n), 10)  # Clamp between 1-10
            return chat_toolkit_instance.find_articles(
                topic=topic,
                count=n,
                focus=focus,
                exclude_existing=True
            )
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def quick_search(query: str) -> str:
        """
        Fast search returning 3 results. Use for quick lookups when user
        just wants a brief answer or a few references.

        Args:
            query: Search query

        Returns:
            Formatted quick results
        """
        try:
            return chat_toolkit_instance.quick_search(query)
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def search_my_files(query: str, file_types: Optional[str] = None) -> str:
        """
        Search the user's uploaded research files for specific information.
        Use this when the user asks about their own files/uploads.

        Args:
            query: What to search for in the files
            file_types: Optional JSON array of file types to filter (e.g., '["pdf", "csv"]')

        Returns:
            Formatted list of matching files with summaries
        """
        try:
            file_types_list = None
            if file_types:
                if isinstance(file_types, list):
                    file_types_list = file_types
                else:
                    file_types_list = json.loads(file_types)

            return chat_toolkit_instance.search_my_files(
                query=query,
                file_types=file_types_list
            )
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def quick_fact_check(claim: str) -> str:
        """
        Quickly verify a factual claim by searching academic sources.
        Returns whether the claim appears supported, partially supported, or inconclusive.

        Args:
            claim: The claim to verify (e.g., "Neural networks can achieve 95% accuracy on ImageNet")

        Returns:
            Verification result with supporting sources
        """
        try:
            return chat_toolkit_instance.quick_fact_check(claim)
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def add_to_bibliography(article_numbers: Optional[str] = None) -> str:
        """
        Add articles from the last search to the user's bibliography.
        Call this when user says "add these", "add to bibliography", "add 1 and 3", etc.

        Args:
            article_numbers: Which articles to add. Options:
                - None or "all": Add all articles from last search
                - "1,2,3" or "1 and 3": Add specific articles by number

        Returns:
            Confirmation with undo option
        """
        try:
            indices = None
            if article_numbers and article_numbers.lower() not in ["all", "these", "them"]:
                # Parse numbers from input like "1,2,3" or "1 and 3" or "1, 3"
                numbers = re.findall(r'\d+', article_numbers)
                if numbers:
                    indices = [int(n) for n in numbers]

            return chat_toolkit_instance.add_to_bibliography(article_indices=indices)
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def undo_bibliography_add() -> str:
        """
        Undo the last addition to the bibliography.
        Call this when user says "undo", "remove last added", "take those back", etc.

        Returns:
            Confirmation of what was removed
        """
        try:
            return chat_toolkit_instance.undo_last_add()
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def show_bibliography(limit: int = 10) -> str:
        """
        Show the user's current bibliography entries.
        Call when user asks "what's in my bibliography", "show references", etc.

        Args:
            limit: Maximum entries to show (default: 10)

        Returns:
            Formatted bibliography list
        """
        try:
            return chat_toolkit_instance.show_bibliography(limit=limit)
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def find_specific_article(description: str) -> str:
        """
        Find a specific article by title, author name, or description.
        Use this when user asks for a particular paper, e.g.:
        - "Find the Attention Is All You Need paper"
        - "Find Vaswani 2017 transformer paper"
        - "Find the original BERT paper"

        Args:
            description: Paper title, author+year, or description

        Returns:
            Best matching paper with citation key and options to use it
        """
        try:
            return chat_toolkit_instance.find_specific_article(description)
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def use_article(article_index: int = 1) -> str:
        """
        Add an article from the last search to bibliography AND get the citation command.
        Call this when user says "use this", "cite this", "use article 2", etc.

        Args:
            article_index: Which article from last search (1-indexed, default 1)

        Returns:
            Confirmation + citation command ready to use
        """
        try:
            return chat_toolkit_instance.use_article(
                article_index=article_index,
                insert_cite=True
            )
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def get_existing_citations() -> str:
        """
        Show citation keys already available in the bibliography.
        Call when user asks "what citations do I have", "show my cite keys", etc.

        Returns:
            List of citation keys user can use with \\cite{key}
        """
        try:
            return chat_toolkit_instance.get_existing_citations()
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def search_and_cite(topic: str, count: int = 1) -> str:
        """
        Quick workflow to find citation(s) for a topic.
        Use when user says "I need a citation for X" or "find me something to cite about X".

        Args:
            topic: What to find citations for
            count: How many citations needed (default 1)

        Returns:
            Found article(s) with ready-to-use citation commands
        """
        try:
            return chat_toolkit_instance.search_and_cite(topic=topic, count=count)
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def list_my_files() -> str:
        """
        List all of the user's uploaded research files.
        Call when user asks "what files do I have", "show my uploads", etc.

        Returns:
            Formatted file list grouped by type
        """
        try:
            return chat_toolkit_instance.list_my_files()
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def summarize_file(file_id: str) -> str:
        """
        Get a detailed summary of an uploaded research file.
        Use when user wants to know what a specific file contains.

        Args:
            file_id: The file identifier (from list_my_files or search_my_files)

        Returns:
            Comprehensive summary with key points and metadata
        """
        try:
            return chat_toolkit_instance.summarize_file(file_id)
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def read_project_file(
        file_path: str,
        max_lines: Optional[int] = None
    ) -> str:
        """
        Read a file from the PROJECT directory (e.g., abstract.txt, main.tex, chapters/intro.tex).
        Use this when the user asks about a project file they highlighted or mentioned.
        Project files are in the project folder - NOT uploaded research files (those use read_file_content with file_id).

        Args:
            file_path: Path relative to project root (e.g., "abstract.txt", "chapters/intro.tex")
            max_lines: Optional limit on lines to read (default: full file)

        Returns:
            File content
        """
        try:
            return chat_toolkit_instance.read_project_file(
                file_path=file_path,
                max_lines=max_lines
            )
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def read_imported_and_tagged_files(query: Optional[str] = None) -> str:
        """
        Read and retrieve content from imported (research) and tagged (highlighted) files.
        Use when the user asks to "use my imported files", "use tagged files", or "retrieve from imported/tagged".

        Args:
            query: Optional search query. If provided, search within imported files; otherwise return content.

        Returns:
            Combined content from tagged and imported files, or search results when query is provided.
        """
        try:
            return chat_toolkit_instance.read_imported_and_tagged_files(query=query)
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def read_file_content(
        file_id: str,
        section: Optional[str] = None,
        page: Optional[int] = None
    ) -> str:
        """
        Read content from an UPLOADED RESEARCH file (PDF, etc.) by file_id.
        Use list_my_files first to get file_ids. Do NOT use for project files like abstract.txt - use read_project_file instead.

        Args:
            file_id: The file to read (from list_my_files)
            section: Optional section/keyword to search for within the file
            page: Optional page number (for PDFs)

        Returns:
            File content or search matches
        """
        try:
            return chat_toolkit_instance.read_file_section(
                file_id=file_id,
                section=section,
                page=page
            )
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def insert_citation_in_document(
        after_text: str,
        cite_key: Optional[str] = None,
        target_file: Optional[str] = None
    ) -> str:
        """
        Insert a \\cite{} command directly into the user's LaTeX document.
        This actually edits the document file.

        Call this when user says:
        - "insert the citation after [text]"
        - "add the citation after [text]"
        - "put \\cite{key} after [text]"
        - "cite it after [text]"

        Args:
            after_text: The EXACT text from the document after which to insert the citation.
                       Must be unique in the document. Copy this exactly from the document.
            cite_key: Citation key to insert (optional - uses last added article if not specified)
            target_file: The .tex file to edit (optional - auto-detects main.tex if not specified)

        Returns:
            Confirmation of insertion (includes line number and citation key for traceability) or error message with guidance
        """
        try:
            result = chat_toolkit_instance.insert_citation_in_document(
                cite_key=cite_key,
                after_text=after_text,
                target_file=target_file
            )

            if isinstance(result, dict):
                if result.get("success"):
                    return result.get("message", "Citation inserted successfully.")
                else:
                    error = result.get("error", "Unknown error")
                    action = result.get("action_needed", "")
                    cite_cmd = result.get("cite_command", "")

                    if action == "find_article":
                        return f"⚠️ {error}\n\nUse 'find [paper name]' first, then 'use this' to get a citation key."
                    elif action == "specify_location":
                        return f"⚠️ {error}\n\nYour citation command is: `{cite_cmd}`"
                    elif action == "more_context":
                        return f"⚠️ {error}\n\nThe text appears multiple times. Please provide a longer, unique snippet."
                    elif action == "correct_text":
                        return f"⚠️ {error}\n\nMake sure to copy the exact text from your document."
                    else:
                        return f"⚠️ {error}"
            return str(result)
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def insert_at_cursor(
        text: str,
        target_file: Optional[str] = None
    ) -> str:
        """
        Insert text/LaTeX content at the user's current cursor position in the document.
        The cursor position is automatically tracked from the Monaco editor.

        Call this when user says:
        - "insert [text] here"
        - "add [content] at cursor"
        - "put this here"
        - "insert at my cursor"
        - Any request to insert content "here" or "at cursor"

        Args:
            text: The text or LaTeX content to insert at cursor position.
                  Can be plain text, LaTeX commands, equations, etc.
            target_file: The .tex file to edit (optional - uses active file if not specified)

        Returns:
            Confirmation of insertion with position details, or error message
        """
        try:
            # Get cursor position from context (injected by orchestrator)
            cursor_position = getattr(chat_toolkit_instance, '_current_cursor_position', None)

            result = chat_toolkit_instance.insert_at_cursor(
                text=text,
                cursor_position=cursor_position,
                target_file=target_file
            )

            if isinstance(result, dict):
                if result.get("success"):
                    return result.get("message", "Text inserted successfully.")
                else:
                    error = result.get("error", "Unknown error")
                    action = result.get("action_needed", "")

                    if action == "set_cursor":
                        return f"⚠️ {error}\n\nClick in your document where you want to insert the text, then ask again."
                    elif action == "update_cursor":
                        return f"⚠️ {error}\n\nPlease click at the desired position in your document."
                    else:
                        return f"⚠️ {error}"
            return str(result)
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def insert_text_in_document(
        text: str,
        after_text: Optional[str] = None,
        target_file: Optional[str] = None
    ) -> str:
        """
        Insert any text/LaTeX content into the document. Supports two modes:
        1. At cursor position (preferred - just say "insert here")
        2. After specific text (say "insert after [exact text]")

        Call this when user says:
        - "insert [text] here" (uses cursor position)
        - "add [content] after [specific text]"
        - "put [LaTeX] after the introduction"
        - Any request to insert content at a specific location

        Args:
            text: The text or LaTeX content to insert.
            after_text: The EXACT text after which to insert (optional).
                       If not provided, inserts at cursor position.
            target_file: The .tex file to edit (optional - auto-detects if not specified)

        Returns:
            Confirmation of insertion (includes line range and citation keys used for traceability) or error message with guidance
        """
        try:
            # Get cursor position from context (injected by orchestrator)
            cursor_position = getattr(chat_toolkit_instance, '_current_cursor_position', None)

            result = chat_toolkit_instance.insert_text_in_document(
                text=text,
                after_text=after_text,
                cursor_position=cursor_position,
                target_file=target_file
            )

            if isinstance(result, dict):
                if result.get("success"):
                    return result.get("message", "Text inserted successfully.")
                else:
                    error = result.get("error", "Unknown error")
                    action = result.get("action_needed", "")

                    if action == "specify_location":
                        return f"⚠️ {error}"
                    elif action == "more_context":
                        return f"⚠️ {error}\n\nProvide a longer, unique text snippet, or click at the position and say 'insert here'."
                    elif action == "correct_text":
                        return f"⚠️ {error}\n\nMake sure to copy the exact text from your document."
                    else:
                        return f"⚠️ {error}"
            return str(result)
        except Exception as e:
            return json.dumps({"error": str(e)})

    @tool
    def list_project_files(
        path: str = ".",
        recursive: bool = False
    ) -> str:
        """
        List files in the project directory.
        Use this early in the conversation to understand the project structure.
        Shows .tex files, .bib files, and directories.

        Call this when:
        - Starting a conversation to understand the project
        - User asks "what files do I have in my project"
        - You need to know which .tex or .bib file to edit

        Args:
            path: Directory path relative to project root (default: "." for root)
            recursive: Whether to list subdirectories recursively (default: False)

        Returns:
            Formatted list of project files grouped by type
        """
        try:
            return chat_toolkit_instance.list_project_files(
                path=path,
                recursive=recursive
            )
        except Exception as e:
            return json.dumps({"error": str(e)})

    # Return list of all chat tools
    return [
        # Project tools
        list_project_files,
        read_project_file,
        read_imported_and_tagged_files,
        # Search tools
        find_articles,
        quick_search,
        search_my_files,
        find_specific_article,
        search_and_cite,
        # Analysis tools
        quick_fact_check,
        # Bibliography tools
        add_to_bibliography,
        undo_bibliography_add,
        show_bibliography,
        get_existing_citations,
        use_article,
        # Citation insertion
        insert_citation_in_document,
        # Cursor-based insertion tools
        insert_at_cursor,
        insert_text_in_document,
        # File tools
        list_my_files,
        summarize_file,
        read_file_content,
    ]


def create_search_tools_for_chat():
    """
    Search tools removed (GenLaTeX prompt-only mode). Returns empty list.
    """
    return []
