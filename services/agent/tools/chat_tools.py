"""
Chat-optimized tools with context awareness and user-friendly output.

These tools wrap the raw search and file tools to provide a better chat experience:
- Human-readable output formatting
- Context awareness (current project, existing refs)
- Stateful tracking for follow-up commands ("add these", "undo")
- Smart defaults for conversational use
"""

import json
import os
import re
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from pathlib import Path

logger = logging.getLogger(__name__)

# GenLaTeX prompt-only mode: search and file RAG tools removed
_STUB_MSG = "Search and file tools are not available (GenLaTeX prompt-only mode)."


class ChatToolkit:
    """
    Chat-optimized tools with context awareness and friendly output.

    Maintains state for conversational flows like:
    - "Find 4 articles on X" → "Add these to bibliography"
    - "Add article 1 and 3" (from last search)
    - "Undo" (remove last added)
    """

    def __init__(
        self,
        project_id: str,
        project_path: str,
        research_files: List[Dict] = None,
        existing_refs: List[Dict] = None,
        highlighted_files: Optional[List[str]] = None,
    ):
        self.project_id = project_id
        self.project_path = project_path
        self.research_files = research_files or []
        self.existing_refs = existing_refs or []
        self.highlighted_files = highlighted_files or []

        # Stateful tracking for conversational flows
        self.last_search_results = []  # For "add these" follow-ups
        self.last_added = []  # For undo functionality
        self.session_searches = []  # Track all searches in session

        # Load existing references if available
        self._load_existing_refs()

    def _load_existing_refs(self):
        """Load existing references from references.json if available"""
        if self.existing_refs:
            return

        refs_paths = [
            Path(self.project_path) / "references.json",
            Path(self.project_path) / "output" / "references.json"
        ]

        for refs_path in refs_paths:
            if refs_path.exists():
                try:
                    with open(refs_path, 'r', encoding='utf-8') as f:
                        data = json.load(f)
                        self.existing_refs = data if isinstance(data, list) else data.get('sources', [])
                        logger.info(f"Loaded {len(self.existing_refs)} existing references")
                        return
                except Exception as e:
                    logger.warning(f"Could not load references from {refs_path}: {e}")

    def _get_existing_titles(self) -> set:
        """Get set of existing reference titles for deduplication"""
        titles = set()
        for ref in self.existing_refs:
            if isinstance(ref, dict):
                title = ref.get('title', '').lower().strip()
                if title:
                    titles.add(title)
        return titles

    def _format_article_for_chat(self, article: Dict, index: int) -> str:
        """Format a single article for chat display"""
        title = article.get('title', 'Untitled')
        authors = article.get('authors', [])
        if isinstance(authors, list):
            if len(authors) > 2:
                author_str = f"{authors[0]} et al."
            elif authors:
                author_str = ", ".join(authors)
            else:
                author_str = "Unknown authors"
        else:
            author_str = str(authors)

        year = article.get('year', 'Unknown')
        abstract = article.get('abstract', article.get('snippet', ''))
        if abstract and len(abstract) > 200:
            abstract = abstract[:200] + "..."

        citations = article.get('citations', article.get('citationCount', ''))
        url = article.get('url', '')
        venue = article.get('venue', article.get('journal', ''))

        lines = [f"**{index}. {title}** ({author_str}, {year})"]

        if venue:
            lines.append(f"   📚 {venue}")

        if abstract:
            lines.append(f"   {abstract}")

        meta_parts = []
        if citations:
            meta_parts.append(f"Cited by: {citations}")
        if url:
            meta_parts.append(f"[View]({url})")

        if meta_parts:
            lines.append(f"   {' | '.join(meta_parts)}")

        return "\n".join(lines)

    # =========================================================================
    # SEARCH TOOLS
    # =========================================================================

    def find_articles(
        self,
        topic: str,
        count: int = 4,
        focus: str = "recent",
        exclude_existing: bool = True
    ) -> str:
        """
        Find articles for the user to potentially cite.

        Args:
            topic: What to search for
            count: How many articles to return (default 4)
            focus: "recent" (2020+), "foundational" (highly cited),
                   "review" (review papers), "methodology" (methods focus)
            exclude_existing: Whether to exclude articles already in bibliography

        Returns:
            Formatted markdown with articles and action prompts
        """
        return _STUB_MSG
        try:
            from tools.search import (
                _search_semantic_scholar_impl,
                _search_arxiv_impl,
            )

            # Adjust search based on focus
            search_count = count * 3  # Get more to filter

            results = []

            # Primary search
            try:
                ss_results = _search_semantic_scholar_impl(topic, max_results=search_count)
                results.extend(self._parse_search_results(ss_results, "Semantic Scholar"))
            except Exception as e:
                logger.warning(f"Semantic Scholar search failed: {e}")

            # Secondary search for coverage
            if len(results) < count:
                try:
                    arxiv_results = _search_arxiv_impl(topic, max_results=search_count)
                    results.extend(self._parse_search_results(arxiv_results, "arXiv"))
                except Exception as e:
                    logger.warning(f"arXiv search failed: {e}")

            # Internal retry with shortened query when both SS and arXiv return nothing
            if not results:
                shortened = self._shorten_topic(topic)
                if shortened and shortened.lower().strip() != topic.lower().strip():
                    logger.info(f"find_articles retry with shortened topic: '{shortened}' (original: '{topic}')")
                    try:
                        ss_retry = _search_semantic_scholar_impl(shortened, max_results=search_count)
                        results.extend(self._parse_search_results(ss_retry, "Semantic Scholar"))
                    except Exception as e:
                        logger.warning(f"Semantic Scholar retry failed: {e}")
                    if len(results) < count:
                        try:
                            arxiv_retry = _search_arxiv_impl(shortened, max_results=search_count)
                            results.extend(self._parse_search_results(arxiv_retry, "arXiv"))
                        except Exception as e:
                            logger.warning(f"arXiv retry failed: {e}")

            if not results:
                return f"No articles found for '{topic}'. Try a different search term or broader topic."

            # Filter by focus
            results = self._filter_by_focus(results, focus)

            # Exclude existing references
            if exclude_existing:
                existing_titles = self._get_existing_titles()
                results = [
                    r for r in results
                    if r.get('title', '').lower().strip() not in existing_titles
                ]

            # Deduplicate by title
            seen_titles = set()
            unique_results = []
            for r in results:
                title_key = r.get('title', '').lower().strip()
                if title_key and title_key not in seen_titles:
                    seen_titles.add(title_key)
                    unique_results.append(r)

            # Take top results
            final_results = unique_results[:count]

            if not final_results:
                return f"No new articles found for '{topic}' (all results already in your bibliography)."

            # Store for follow-up commands
            self.last_search_results = final_results
            self.session_searches.append({
                'topic': topic,
                'results': final_results,
                'timestamp': datetime.now().isoformat()
            })

            # Format output
            lines = [f"Found {len(final_results)} relevant articles on **{topic}**:\n"]

            for i, article in enumerate(final_results, 1):
                lines.append(self._format_article_for_chat(article, i))
                lines.append("")

            lines.append("---")
            lines.append("*Say \"add these\" to add all, or \"add 1 and 3\" to add specific articles to your bibliography.*")

            return "\n".join(lines)

        except Exception as e:
            logger.error(f"find_articles error: {e}")
            return f"Error searching for articles: {str(e)}"

    def _shorten_topic(self, topic: str, max_words: int = 4) -> Optional[str]:
        """Build a shorter, broader query from topic for retry. Drops stopwords, keeps first 2–4 significant words."""
        if not topic or not topic.strip():
            return None
        stop = {"the", "a", "an", "of", "on", "in", "to", "for", "and", "or", "with", "as", "at", "by", "from"}
        words = [w for w in topic.strip().split() if w.lower() not in stop]
        if not words:
            words = topic.strip().split()
        keep = " ".join(words[:max_words]).strip()
        return keep if keep else None

    def _parse_search_results(self, raw_results: str, source: str) -> List[Dict]:
        """Parse raw search results into structured format"""
        articles = []

        if not raw_results or "Error" in raw_results or "No results" in raw_results:
            return articles

        # Parse the text-based format from search tools
        current_article = {}

        for line in raw_results.split('\n'):
            line = line.strip()

            if line.startswith('Title:'):
                if current_article.get('title'):
                    current_article['source'] = source
                    articles.append(current_article)
                current_article = {'title': line[6:].strip()}
            elif line.startswith('Authors:'):
                authors_str = line[8:].strip()
                current_article['authors'] = [a.strip() for a in authors_str.split(',')]
            elif line.startswith('Year:'):
                year_str = line[5:].strip()
                try:
                    current_article['year'] = int(year_str) if year_str.isdigit() else year_str
                except (ValueError, TypeError) as e:
                    logger.debug(f"Failed to parse year '{year_str}': {e}")
                    current_article['year'] = year_str
            elif line.startswith('Abstract:'):
                current_article['abstract'] = line[9:].strip()
            elif line.startswith('URL:'):
                current_article['url'] = line[4:].strip()
            elif line.startswith('Venue:'):
                current_article['venue'] = line[6:].strip()
            elif line.startswith('Citations:'):
                try:
                    current_article['citations'] = int(line[10:].strip())
                except (ValueError, TypeError) as e:
                    logger.debug(f"Failed to parse citations from '{line}': {e}")
            elif line == '---':
                if current_article.get('title'):
                    current_article['source'] = source
                    articles.append(current_article)
                current_article = {}

        # Don't forget the last article
        if current_article.get('title'):
            current_article['source'] = source
            articles.append(current_article)

        return articles

    def _filter_by_focus(self, results: List[Dict], focus: str) -> List[Dict]:
        """Filter and sort results based on focus"""
        if focus == "recent":
            # Prefer papers from 2020+
            def sort_key(r):
                year = r.get('year', 0)
                if isinstance(year, str):
                    try:
                        year = int(year)
                    except (ValueError, TypeError):
                        year = 0
                return -year  # Negative for descending
            results.sort(key=sort_key)

        elif focus == "foundational":
            # Prefer highly cited papers
            def sort_key(r):
                return -(r.get('citations', 0) or 0)
            results.sort(key=sort_key)

        elif focus == "review":
            # Prefer papers with "review" or "survey" in title
            def has_review(r):
                title = r.get('title', '').lower()
                return 'review' in title or 'survey' in title
            results.sort(key=lambda r: (not has_review(r), -(r.get('citations', 0) or 0)))

        elif focus == "methodology":
            # Prefer papers with method-related terms
            def has_method(r):
                title = r.get('title', '').lower()
                abstract = r.get('abstract', '').lower()
                terms = ['method', 'approach', 'technique', 'algorithm', 'framework', 'model']
                return any(t in title or t in abstract for t in terms)
            results.sort(key=lambda r: (not has_method(r), -(r.get('citations', 0) or 0)))

        return results

    def quick_search(self, query: str) -> str:
        """
        Fast search returning 3 results. Use for quick lookups.

        Args:
            query: Search query

        Returns:
            Formatted results
        """
        return self.find_articles(query, count=3, exclude_existing=False)

    def search_my_files(self, query: str, file_types: List[str] = None) -> str:
        """
        Search only the user's uploaded research files.

        Args:
            query: What to search for
            file_types: Optional filter by file type (e.g., ["pdf", "csv"])

        Returns:
            Formatted results with file matches
        """
        return _STUB_MSG
        if not self.research_files:
            return "You don't have any uploaded research files. Upload files to search within them."

        try:
            from tools.file_tools import FileTools

            file_tools = FileTools(self.project_id, self.research_files)
            results = file_tools.search_files(query, file_types=file_types, limit=10)

            if not results:
                return f"No matches found for '{query}' in your research files."

            lines = [f"Found {len(results)} file(s) matching **{query}**:\n"]

            for i, file_info in enumerate(results, 1):
                file_name = file_info.get('fileName', 'Unknown')
                file_type = file_info.get('fileType', '')
                relevance = file_info.get('relevanceScore', 0)
                summary = file_info.get('summary', '')
                keywords = file_info.get('keywords', [])

                lines.append(f"**{i}. {file_name}** ({file_type})")
                if summary:
                    lines.append(f"   {summary[:150]}...")
                if keywords:
                    lines.append(f"   Keywords: {', '.join(keywords[:5])}")
                lines.append(f"   Relevance: {relevance:.0%}")
                lines.append("")

            lines.append("---")
            lines.append("*Say \"read file 1\" or \"search in file 2 for [term]\" for more details.*")

            return "\n".join(lines)

        except Exception as e:
            logger.error(f"search_my_files error: {e}")
            return f"Error searching files: {str(e)}"

    # =========================================================================
    # ANALYSIS TOOLS
    # =========================================================================

    def quick_fact_check(self, claim: str) -> str:
        """
        Fast verification of a single claim.

        Args:
            claim: The claim to verify

        Returns:
            Verification result with sources
        """
        return _STUB_MSG
        try:
            from tools.search import _search_semantic_scholar_impl

            # Search for evidence (SS only; minimal change)
            results = []

            try:
                ss_results = _search_semantic_scholar_impl(claim, max_results=5)
                results.extend(self._parse_search_results(ss_results, "Semantic Scholar"))
            except Exception:
                pass

            if not results:
                return f"""
**Fact Check: {claim[:100]}{'...' if len(claim) > 100 else ''}**

⚠️ Could not find academic sources to verify this claim.

Recommendations:
- This claim may need primary source verification
- Consider searching with different keywords
- Check if this is a recent finding not yet in academic databases
"""

            # Analyze results for relevance
            relevant_count = 0
            supporting = []

            for r in results[:5]:
                title = r.get('title', '').lower()
                abstract = r.get('abstract', '').lower()
                claim_words = set(claim.lower().split())

                # Simple relevance check
                matches = sum(1 for w in claim_words if w in title or w in abstract)
                if matches >= len(claim_words) * 0.3:
                    relevant_count += 1
                    supporting.append(r)

            if relevant_count >= 2:
                status = "✅ **Likely Supported**"
                explanation = "Found multiple academic sources discussing this topic."
            elif relevant_count == 1:
                status = "⚠️ **Partially Supported**"
                explanation = "Found limited academic support. Consider additional verification."
            else:
                status = "❓ **Inconclusive**"
                explanation = "Could not find direct academic support for this claim."

            lines = [
                f"**Fact Check:** {claim[:100]}{'...' if len(claim) > 100 else ''}",
                "",
                status,
                explanation,
                ""
            ]

            if supporting:
                lines.append("**Related Sources:**")
                for i, source in enumerate(supporting[:3], 1):
                    lines.append(f"{i}. {source.get('title', 'Unknown')} ({source.get('year', 'N/A')})")

            return "\n".join(lines)

        except Exception as e:
            logger.error(f"quick_fact_check error: {e}")
            return f"Error checking fact: {str(e)}"

    def summarize_file(self, file_id: str) -> str:
        """
        Get a summary of an uploaded research file.

        Args:
            file_id: The file ID to summarize

        Returns:
            Human-readable summary of the file
        """
        return _STUB_MSG
        if not self.research_files:
            return "No research files available."

        try:
            from tools.file_tools import FileTools

            file_tools = FileTools(self.project_id, self.research_files)
            metadata = file_tools.get_file_metadata(file_id)

            if 'error' in metadata:
                return f"Could not find file: {metadata['error']}"

            file_name = metadata.get('fileName', 'Unknown')
            file_type = metadata.get('fileType', '')
            meta = metadata.get('metadata', {})

            lines = [f"## {file_name}\n"]

            if meta.get('about'):
                lines.append(f"**About:** {meta['about']}\n")

            if meta.get('summary'):
                lines.append(f"**Summary:** {meta['summary']}\n")

            if meta.get('keyPoints'):
                lines.append("**Key Points:**")
                for point in meta['keyPoints'][:5]:
                    lines.append(f"- {point}")
                lines.append("")

            if meta.get('keywords'):
                lines.append(f"**Keywords:** {', '.join(meta['keywords'][:10])}\n")

            if meta.get('statistics'):
                stats = meta['statistics']
                lines.append("**Statistics:**")
                for key, value in list(stats.items())[:5]:
                    lines.append(f"- {key}: {value}")

            return "\n".join(lines)

        except Exception as e:
            logger.error(f"summarize_file error: {e}")
            return f"Error summarizing file: {str(e)}"

    # =========================================================================
    # BIBLIOGRAPHY TOOLS
    # =========================================================================

    def add_to_bibliography(
        self,
        article_indices: List[int] = None,
        articles: List[Dict] = None
    ) -> str:
        """
        Add articles to the bibliography.

        Args:
            article_indices: Which articles from last search to add (1-indexed).
                            If None, adds all from last search.
            articles: Directly provide articles to add (overrides indices)

        Returns:
            Confirmation message with undo option
        """
        # Determine which articles to add
        if articles:
            to_add = articles
        elif article_indices:
            if not self.last_search_results:
                return "No recent search results. Search for articles first, then add them."

            to_add = []
            for idx in article_indices:
                if 1 <= idx <= len(self.last_search_results):
                    to_add.append(self.last_search_results[idx - 1])
                else:
                    return f"Invalid article number: {idx}. Last search had {len(self.last_search_results)} results."
        else:
            # Add all from last search
            if not self.last_search_results:
                return "No recent search results. Search for articles first, then add them."
            to_add = self.last_search_results

        if not to_add:
            return "No articles to add."

        try:
            # Generate BibTeX entries
            bibtex_entries = []
            added_articles = []

            for article in to_add:
                bibtex = self._generate_bibtex(article)
                if bibtex:
                    bibtex_entries.append(bibtex)
                    added_articles.append(article)

            if not bibtex_entries:
                return "Could not generate bibliography entries for the selected articles."

            # Find and update .bib file
            bib_path = self._find_or_create_bib_file()

            with open(bib_path, 'a', encoding='utf-8') as f:
                f.write("\n\n" + "\n\n".join(bibtex_entries))

            # Ensure main .tex has \bibliographystyle and \bibliography so citations resolve (not [?])
            self._ensure_bibliography_commands()

            # Update tracking
            self.last_added = added_articles
            self.existing_refs.extend(added_articles)

            # Format confirmation
            lines = [f"✅ Added {len(added_articles)} article(s) to bibliography:\n"]

            for article in added_articles:
                authors = article.get('authors', ['Unknown'])
                if isinstance(authors, list) and authors:
                    author = authors[0]
                else:
                    author = str(authors)
                year = article.get('year', 'N/A')
                title = article.get('title', 'Untitled')
                lines.append(f"- {author} ({year}): {title[:60]}{'...' if len(title) > 60 else ''}")

            lines.append("")
            lines.append(f"*Bibliography updated: {bib_path.name}*")
            lines.append("*Say \"undo\" to remove these articles.*")

            return "\n".join(lines)

        except Exception as e:
            logger.error(f"add_to_bibliography error: {e}")
            return f"Error adding to bibliography: {str(e)}"

    def _generate_bibtex(self, article: Dict) -> str:
        """Generate a BibTeX entry for an article"""
        # Create citation key
        authors = article.get('authors', ['unknown'])
        if isinstance(authors, list) and authors:
            first_author = authors[0].split(',')[0].split()[-1].lower()
        else:
            first_author = 'unknown'

        year = article.get('year', 'XXXX')
        title_words = article.get('title', 'untitled').split()[:2]
        title_part = ''.join(w.lower() for w in title_words if w.isalpha())

        cite_key = f"{first_author}{year}{title_part}"
        cite_key = re.sub(r'[^a-zA-Z0-9]', '', cite_key)

        # Build entry
        lines = [f"@misc{{{cite_key},"]

        if article.get('title'):
            lines.append(f"  title = {{{article['title']}}},")

        if article.get('authors'):
            if isinstance(article['authors'], list):
                authors_str = " and ".join(article['authors'])
            else:
                authors_str = str(article['authors'])
            lines.append(f"  author = {{{authors_str}}},")

        if article.get('year'):
            lines.append(f"  year = {{{article['year']}}},")

        if article.get('venue') or article.get('journal'):
            journal = article.get('venue') or article.get('journal')
            lines.append(f"  howpublished = {{{journal}}},")

        if article.get('url'):
            lines.append(f"  url = {{{article['url']}}},")

        if article.get('abstract'):
            # Escape special characters in abstract
            abstract = article['abstract'].replace('{', '\\{').replace('}', '\\}')
            lines.append(f"  abstract = {{{abstract}}},")

        lines.append("}")

        return "\n".join(lines)

    def _find_or_create_bib_file(self) -> Path:
        """Find existing .bib file or create a new one"""
        project_path = Path(self.project_path)

        # Look for existing .bib files
        bib_files = list(project_path.glob("*.bib"))

        if bib_files:
            # Use the first one (usually references.bib or main.bib)
            return bib_files[0]

        # Create new references.bib
        new_bib = project_path / "references.bib"
        new_bib.write_text("% Bibliography generated by GenLaTeX\n", encoding='utf-8')
        return new_bib

    def _find_main_tex(self) -> Path:
        """Find main .tex file (main.tex, paper.tex, or first .tex in project root)."""
        project_path = Path(self.project_path)
        tex_files = list(project_path.glob("*.tex"))
        if not tex_files:
            out_dir = project_path / "output"
            if out_dir.is_dir():
                tex_files = list(out_dir.glob("*.tex"))
        if not tex_files:
            return None
        for preferred in ["main.tex", "paper.tex", "document.tex"]:
            for tf in tex_files:
                if tf.name.lower() == preferred:
                    return tf
        return tex_files[0]

    def _ensure_bibliography_commands(self) -> None:
        """
        Ensure the main .tex has \\bibliographystyle{...} and \\bibliography{...} before \\end{document}.
        Skips if biblatex (\\addbibresource, \\printbibliography) is used. Run after adding to .bib
        so citations resolve instead of showing [?].
        """
        tex_path = self._find_main_tex()
        if not tex_path or not tex_path.exists():
            return
        try:
            with open(tex_path, 'r', encoding='utf-8') as f:
                content = f.read()
        except Exception as e:
            logger.warning(f"_ensure_bibliography_commands: could not read {tex_path}: {e}")
            return

        # Skip if biblatex
        if re.search(r'\\usepackage.*?\{biblatex\}', content) or '\\addbibresource{' in content or '\\printbibliography' in content:
            return

        has_style = bool(re.search(r'\\bibliographystyle\s*\{', content))
        has_bib = bool(re.search(r'\\bibliography\s*\{', content))
        if has_style and has_bib:
            return

        bib_path = self._find_or_create_bib_file()
        bib_stem = bib_path.stem  # e.g. "references" for references.bib

        # Insert before \end{document}
        end_doc = re.search(r'\\end\s*\{\s*document\s*\}', content, re.IGNORECASE)
        if not end_doc:
            return
        insert_pos = end_doc.start()
        new_block = []
        if not has_style:
            new_block.append(f"\\bibliographystyle{{plain}}")
        if not has_bib:
            new_block.append(f"\\bibliography{{{bib_stem}}}")
        if not new_block:
            return
        insert_text = "\n" + "\n".join(new_block) + "\n\n"
        new_content = content[:insert_pos] + insert_text + content[insert_pos:]

        try:
            with open(tex_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            logger.info(f"Added \\bibliographystyle/\\bibliography to {tex_path.name} (bib stem: {bib_stem})")
        except Exception as e:
            logger.warning(f"_ensure_bibliography_commands: could not write {tex_path}: {e}")

    def undo_last_add(self) -> str:
        """
        Remove the last added articles from bibliography.

        Returns:
            Confirmation message
        """
        if not self.last_added:
            return "Nothing to undo. No articles were recently added."

        try:
            bib_path = self._find_or_create_bib_file()

            # Read current content
            with open(bib_path, 'r', encoding='utf-8') as f:
                content = f.read()

            # Remove last added entries (by title matching)
            removed_count = 0
            for article in self.last_added:
                title = article.get('title', '')
                if title:
                    # Find and remove the entry containing this title
                    pattern = rf'@\w+\{{[^}}]+,\s*title\s*=\s*\{{{re.escape(title)}\}}[^@]*\}}'
                    new_content, count = re.subn(pattern, '', content, flags=re.IGNORECASE | re.DOTALL)
                    if count > 0:
                        content = new_content
                        removed_count += 1

            # Write back
            with open(bib_path, 'w', encoding='utf-8') as f:
                f.write(content.strip())

            # Update tracking
            for article in self.last_added:
                if article in self.existing_refs:
                    self.existing_refs.remove(article)

            undone = self.last_added
            self.last_added = []

            return f"✅ Removed {removed_count} article(s) from bibliography.\n\nRemoved:\n" + "\n".join(
                f"- {a.get('title', 'Unknown')[:60]}" for a in undone
            )

        except Exception as e:
            logger.error(f"undo_last_add error: {e}")
            return f"Error undoing: {str(e)}"

    def show_bibliography(self, limit: int = 10) -> str:
        """
        Show current bibliography entries.

        Args:
            limit: Maximum entries to show

        Returns:
            Formatted bibliography list
        """
        if not self.existing_refs:
            return "Your bibliography is empty. Use 'find articles' to search and add references."

        lines = [f"**Your Bibliography** ({len(self.existing_refs)} entries)\n"]

        for i, ref in enumerate(self.existing_refs[:limit], 1):
            if isinstance(ref, dict):
                title = ref.get('title', 'Untitled')
                authors = ref.get('authors', ['Unknown'])
                if isinstance(authors, list) and authors:
                    author = authors[0]
                else:
                    author = str(authors)
                year = ref.get('year', 'N/A')
                lines.append(f"{i}. {author} ({year}): {title[:50]}{'...' if len(title) > 50 else ''}")

        if len(self.existing_refs) > limit:
            lines.append(f"\n... and {len(self.existing_refs) - limit} more")

        return "\n".join(lines)

    # =========================================================================
    # ADVANCED CITATION TOOLS
    # =========================================================================

    def find_specific_article(self, description: str) -> str:
        """
        Find a specific article by title, author, or detailed description.
        Returns the single best match with option to use it immediately.

        Args:
            description: Paper title, "Author Year" format, or description
                        e.g., "Attention Is All You Need"
                        e.g., "Vaswani 2017 transformer"
                        e.g., "the original BERT paper by Devlin"

        Returns:
            Single best match with citation key and use option
        """
        return _STUB_MSG
        try:
            from tools.search import _search_semantic_scholar_impl

            # Search with the description
            results = _search_semantic_scholar_impl(description, max_results=5)
            parsed = self._parse_search_results(results, "Semantic Scholar")

            if not parsed:
                return f"Could not find a paper matching: '{description}'\n\nTry:\n- Using the exact paper title\n- Author name + year (e.g., 'Vaswani 2017')\n- Key terms from the title"

            # Score results by relevance to description
            description_lower = description.lower()
            desc_words = set(description_lower.split())

            scored = []
            for article in parsed:
                score = 0
                title = article.get('title', '').lower()
                authors = ' '.join(article.get('authors', [])).lower()

                # Exact title match gets highest score
                if description_lower in title or title in description_lower:
                    score += 100

                # Word overlap
                title_words = set(title.split())
                score += len(desc_words & title_words) * 10

                # Author match
                for word in desc_words:
                    if word in authors:
                        score += 20

                # Year match
                year = str(article.get('year', ''))
                if year in description:
                    score += 15

                scored.append((score, article))

            # Get best match
            scored.sort(reverse=True, key=lambda x: x[0])
            best = scored[0][1]

            # Store as single-item result for "use this" follow-up
            self.last_search_results = [best]

            # Generate citation key preview
            cite_key = self._generate_cite_key(best)

            # Format output
            lines = [
                f"**Found:** {best.get('title', 'Unknown')}",
                f"**Authors:** {', '.join(best.get('authors', ['Unknown'])[:3])}{'...' if len(best.get('authors', [])) > 3 else ''}",
                f"**Year:** {best.get('year', 'N/A')}",
                f"**Venue:** {best.get('venue', 'N/A')}",
                f"**Citation Key:** `{cite_key}`",
                "",
            ]

            if best.get('abstract'):
                abstract = best['abstract'][:200] + '...' if len(best.get('abstract', '')) > 200 else best.get('abstract', '')
                lines.append(f"**Abstract:** {abstract}")
                lines.append("")

            if best.get('url'):
                lines.append(f"[View Paper]({best['url']})")
                lines.append("")

            lines.append("---")
            lines.append("**Actions:**")
            lines.append(f"- Say **\"add this\"** to add to bibliography")
            lines.append(f"- Say **\"cite this\"** or **\"use this here\"** to add to bibliography AND insert `\\cite{{{cite_key}}}` at your cursor")

            # Show alternatives if confidence is low
            if len(scored) > 1 and scored[0][0] < 50:
                lines.append("")
                lines.append("**Other possibilities:**")
                for i, (score, alt) in enumerate(scored[1:3], 2):
                    lines.append(f"{i}. {alt.get('title', 'Unknown')[:50]}... ({alt.get('year', 'N/A')})")

            return "\n".join(lines)

        except Exception as e:
            logger.error(f"find_specific_article error: {e}")
            return f"Error finding article: {str(e)}"

    def _generate_cite_key(self, article: Dict) -> str:
        """Generate a citation key for an article"""
        authors = article.get('authors', ['unknown'])
        if isinstance(authors, list) and authors:
            first_author = authors[0].split(',')[0].split()[-1].lower()
        else:
            first_author = 'unknown'

        year = article.get('year', 'XXXX')
        title_words = article.get('title', 'untitled').split()[:2]
        title_part = ''.join(w.lower() for w in title_words if w.isalpha())

        cite_key = f"{first_author}{year}{title_part}"
        return re.sub(r'[^a-zA-Z0-9]', '', cite_key)

    def use_article(
        self,
        article_index: int = 1,
        insert_cite: bool = True,
        cite_location: str = None
    ) -> str:
        """
        Use an article from the last search: add to bibliography AND optionally
        insert a \\cite{} command.

        Args:
            article_index: Which article from last search (1-indexed, default 1)
            insert_cite: Whether to insert \\cite{} command (default True)
            cite_location: Where to insert - "cursor", "selection", or specific text
                          If None, returns the cite command for user to place

        Returns:
            Confirmation with the citation command
        """
        if not self.last_search_results:
            return "No recent search results. Use 'find [paper description]' first."

        if article_index < 1 or article_index > len(self.last_search_results):
            return f"Invalid article number. Last search had {len(self.last_search_results)} result(s)."

        article = self.last_search_results[article_index - 1]

        # Add to bibliography
        add_result = self.add_to_bibliography(article_indices=[article_index])

        if "Error" in add_result:
            return add_result

        # Generate cite command
        cite_key = self._generate_cite_key(article)
        cite_command = f"\\cite{{{cite_key}}}"

        lines = [
            add_result,
            "",
            "---",
            f"**Citation command:** `{cite_command}`",
            "",
        ]

        if insert_cite:
            lines.append(f"Copy and paste `{cite_command}` where you want to cite this paper.")
            lines.append("")
            lines.append("Or tell me where to insert it:")
            lines.append("- \"Insert after [some text]\"")
            lines.append("- \"Add citation to the introduction\"")
        else:
            lines.append(f"Use `{cite_command}` to cite this paper in your document.")

        # Store cite key for potential follow-up insertion
        self._last_cite_key = cite_key
        self._last_cite_article = article

        return "\n".join(lines)

    def insert_citation_in_document(
        self,
        cite_key: str = None,
        after_text: str = None,
        target_file: str = None
    ) -> Dict[str, Any]:
        """
        Actually insert a \\cite{} command into the document by editing the file.

        Args:
            cite_key: Citation key to insert (or uses last added if None)
            after_text: Specific text after which to insert the citation.
                       The citation will be inserted immediately after this text.
            target_file: The .tex file to edit. If None, finds the main .tex file.

        Returns:
            Dict with success status and edit details for the orchestrator to apply,
            or error message if insertion failed.
        """
        # Use last cite key if not provided
        if not cite_key:
            cite_key = getattr(self, '_last_cite_key', None)

        if not cite_key:
            return {
                "success": False,
                "error": "No citation key specified. Use 'find [paper]' and 'use this' first, or specify a citation key.",
                "action_needed": "find_article"
            }

        if not after_text:
            cite_command = f"\\cite{{{cite_key}}}"
            return {
                "success": False,
                "error": f"Please specify where to insert the citation. Tell me the exact text to insert after.",
                "cite_command": cite_command,
                "action_needed": "specify_location"
            }

        cite_command = f"\\cite{{{cite_key}}}"
        project_path = Path(self.project_path)

        # Find the target .tex file
        if target_file:
            tex_path = project_path / target_file
            if not tex_path.exists():
                return {
                    "success": False,
                    "error": f"File not found: {target_file}",
                    "action_needed": "specify_file"
                }
        else:
            # Find main .tex file
            tex_files = list(project_path.glob("*.tex"))
            if not tex_files:
                # Check in output directory
                tex_files = list((project_path / "output").glob("*.tex"))

            if not tex_files:
                return {
                    "success": False,
                    "error": "No .tex files found in project. Please specify the target file.",
                    "action_needed": "specify_file"
                }

            # Prefer main.tex or paper.tex
            tex_path = None
            for preferred in ["main.tex", "paper.tex", "document.tex"]:
                for tf in tex_files:
                    if tf.name.lower() == preferred:
                        tex_path = tf
                        break
                if tex_path:
                    break

            if not tex_path:
                tex_path = tex_files[0]

        try:
            # Read the file
            with open(tex_path, 'r', encoding='utf-8') as f:
                content = f.read()

            # Find the after_text in the content - try exact, stripped, then normalized whitespace
            if after_text not in content:
                after_stripped = after_text.strip() if after_text else ""
                if after_stripped and after_stripped in content:
                    after_text = after_stripped
                else:
                    # Try fuzzy match (ignore extra whitespace)
                    normalized_search = re.sub(r'\s+', ' ', (after_text or "").strip())
                    normalized_content = re.sub(r'\s+', ' ', content)
                    if normalized_search and normalized_search in normalized_content:
                        # Find the actual position in original content
                        pattern = r'\s+'.join(re.escape(word) for word in (after_text or "").split())
                        match = re.search(pattern, content)
                        if match:
                            after_text = match.group(0)
                        else:
                            return {
                                "success": False,
                                "error": f"Could not find the text '{after_text[:50]}...' in {tex_path.name}. Please provide exact text from your document.",
                                "action_needed": "correct_text",
                                "file_checked": tex_path.name
                            }
                    else:
                        return {
                            "success": False,
                            "error": f"Could not find the text '{after_text[:50]}...' in {tex_path.name}. Please provide exact text from your document.",
                            "action_needed": "correct_text",
                            "file_checked": tex_path.name
                        }

            # Check for uniqueness
            count = content.count(after_text)
            if count > 1:
                return {
                    "success": False,
                    "error": f"The text '{after_text[:50]}...' appears {count} times. Please provide more context to make it unique.",
                    "action_needed": "more_context",
                    "occurrences": count
                }

            # Insert the citation after the text
            # Check if there's already a citation right after
            position = content.find(after_text) + len(after_text)
            insert_start = position  # for traceability; overwritten in append case

            # Check what comes next
            remaining = content[position:position + 20]
            if remaining.strip().startswith("\\cite{"):
                # Already has a citation, append to it
                # Find the closing brace
                cite_end = content.find("}", position)
                if cite_end != -1:
                    # Insert before the closing brace with a comma
                    new_content = content[:cite_end] + ", " + cite_key + content[cite_end:]
                    action_type = "appended_to_existing"
                    insert_start = cite_end
                else:
                    new_content = content[:position] + " " + cite_command + content[position:]
                    action_type = "inserted"
            else:
                # Insert space + cite command
                # Check if we need a space
                if content[position:position+1] in [" ", "\n", ".", ",", ")", "]"]:
                    insert_text = cite_command
                else:
                    insert_text = " " + cite_command

                new_content = content[:position] + insert_text + content[position:]
                action_type = "inserted"

            # Write the file
            with open(tex_path, 'w', encoding='utf-8') as f:
                f.write(new_content)

            # Ensure main .tex has \bibliographystyle and \bibliography so citations resolve (not [?])
            self._ensure_bibliography_commands()

            # Traceability: 1-based line number of insertion in new file
            line = new_content[:insert_start].count('\n') + 1
            msg = f"✅ Citation `{cite_command}` {action_type} in {tex_path.name}. Inserted at line {line}. Citation key: {cite_key}."
            return {
                "success": True,
                "message": msg,
                "file": tex_path.name,
                "cite_key": cite_key,
                "cite_command": cite_command,
                "action": action_type,
                "location": f"after '{after_text[:40]}...'" if len(after_text) > 40 else f"after '{after_text}'",
                "line": line,
            }

        except Exception as e:
            logger.error(f"insert_citation_in_document error: {e}")
            return {
                "success": False,
                "error": f"Error editing file: {str(e)}",
                "action_needed": "retry"
            }

    def insert_citation(
        self,
        cite_key: str = None,
        location_description: str = None,
        after_text: str = None
    ) -> str:
        """
        Insert a \\cite{} command into the document.
        If after_text is provided, actually edits the document.
        Otherwise returns instructions for the user.

        Args:
            cite_key: Citation key to use (or uses last added if None)
            location_description: Natural language description of where to insert
                                 e.g., "in the introduction", "after the methodology section"
            after_text: Specific text after which to insert the citation

        Returns:
            Result of insertion or instructions for the edit
        """
        # If we have specific text, actually do the edit
        if after_text:
            result = self.insert_citation_in_document(
                cite_key=cite_key,
                after_text=after_text
            )

            if result.get("success"):
                return result.get("message", "Citation inserted successfully.")
            else:
                error = result.get("error", "Unknown error")
                action = result.get("action_needed", "")

                if action == "more_context":
                    return f"⚠️ {error}\n\nPlease provide a longer, unique snippet of text from your document."
                elif action == "correct_text":
                    return f"⚠️ {error}\n\nMake sure to copy the exact text from your document."
                else:
                    return f"⚠️ {error}"

        # Use last cite key if not provided
        if not cite_key:
            cite_key = getattr(self, '_last_cite_key', None)

        if not cite_key:
            return "No citation key specified. Use 'find [paper]' and 'use this' first, or specify a citation key."

        cite_command = f"\\cite{{{cite_key}}}"

        if location_description:
            return f"""**Citation:** `{cite_command}`
**Requested location:** {location_description}

To insert this citation, tell me the exact text to insert after. For example:
- "Insert after 'neural networks have shown remarkable progress'"
- "Insert after 'as shown in previous studies'"

Or copy and paste the citation manually: `{cite_command}`"""

        else:
            return f"""**Citation ready:** `{cite_command}`

To insert this citation in your document, tell me where:
- "Insert after [exact text from your document]"

Or copy and paste `{cite_command}` where you want it."""

    def get_existing_citations(self) -> str:
        """
        Show citation keys already in the .bib file.
        Helps user know what's available to cite.

        Returns:
            List of existing citation keys
        """
        try:
            bib_path = self._find_or_create_bib_file()

            with open(bib_path, 'r', encoding='utf-8') as f:
                content = f.read()

            # Extract citation keys
            keys = re.findall(r'@\w+\{([^,]+),', content)

            if not keys:
                return "Your bibliography (.bib file) is empty. Use 'find articles' to add some."

            lines = [f"**Citation keys in your bibliography** ({len(keys)} entries):\n"]

            for key in keys[:20]:
                lines.append(f"- `\\cite{{{key}}}`")

            if len(keys) > 20:
                lines.append(f"\n... and {len(keys) - 20} more")

            lines.append("")
            lines.append("Use any of these in your document with `\\cite{key}`")

            return "\n".join(lines)

        except Exception as e:
            logger.error(f"get_existing_citations error: {e}")
            return f"Error reading bibliography: {str(e)}"

    def search_and_cite(self, topic: str, count: int = 1) -> str:
        """
        Quick workflow: search for article(s) on a topic and prepare citation.
        Ideal for "I need a citation for [topic]" requests.

        Args:
            topic: What to find a citation for
            count: How many citations needed (default 1)

        Returns:
            Found article(s) with ready-to-use citations
        """
        if count == 1:
            # Use specific article finder for single citation
            result = self.find_specific_article(topic)
            return result
        else:
            # Use regular find for multiple
            result = self.find_articles(topic, count=count, focus="foundational")

            if "No articles found" in result or "Error" in result:
                return result

            # Add instruction for batch citation
            result += "\n\n**Quick cite:** Say \"add all and cite\" to add these to bibliography and get all citation commands."

            return result

    # =========================================================================
    # FILE TOOLS
    # =========================================================================

    def list_my_files(self) -> str:
        """
        List all uploaded research files.

        Returns:
            Formatted file list
        """
        return _STUB_MSG
        if not self.research_files:
            return "You haven't uploaded any research files yet. Upload PDFs, CSVs, or other documents to reference them in chat."

        try:
            from tools.file_tools import FileTools

            file_tools = FileTools(self.project_id, self.research_files)
            files = file_tools.list_available_files(limit=20)

            lines = [f"**Your Research Files** ({len(files)} files)\n"]

            # Group by file type
            by_type = {}
            for f in files:
                file_type = f.get('fileType', 'other')
                if file_type not in by_type:
                    by_type[file_type] = []
                by_type[file_type].append(f)

            for file_type, type_files in by_type.items():
                lines.append(f"**{file_type.upper()}** ({len(type_files)})")
                for f in type_files:
                    name = f.get('fileName', 'Unknown')
                    about = f.get('about', '')
                    if about:
                        about = f" - {about[:50]}{'...' if len(about) > 50 else ''}"
                    lines.append(f"  • {name}{about}")
                lines.append("")

            lines.append("*Use 'summarize file [name]' or 'search my files for [term]' to explore.*")

            return "\n".join(lines)

        except Exception as e:
            logger.error(f"list_my_files error: {e}")
            return f"Error listing files: {str(e)}"

    def read_file_section(
        self,
        file_id: str,
        section: str = None,
        page: int = None
    ) -> str:
        """
        Read a specific section or page from a file.

        Args:
            file_id: File to read
            section: Section name/keyword to find
            page: Page number (for PDFs)

        Returns:
            File content
        """
        return _STUB_MSG
        if not self.research_files:
            return "No research files available."

        try:
            from tools.file_tools import FileTools

            file_tools = FileTools(self.project_id, self.research_files)

            if page:
                result = file_tools.read_page_range(file_id, page, page)
            elif section:
                result = file_tools.search_file_content(file_id, section, context_lines=10)
            else:
                result = file_tools.read_file_content(file_id, max_lines=100)

            if 'error' in result:
                return f"Could not read file: {result['error']}"

            if 'matches' in result:
                # Search results
                matches = result.get('matches', [])
                if not matches:
                    return f"No matches for '{section}' in this file."

                lines = [f"**Found {len(matches)} match(es) for '{section}':**\n"]
                for i, match in enumerate(matches[:5], 1):
                    lines.append(f"**Match {i}** (line {match.get('lineNumber', 'N/A')}):")
                    lines.append(f"```\n{match.get('content', '')}\n```")
                    lines.append("")

                return "\n".join(lines)
            else:
                # Direct content
                content = result.get('content', '')
                file_name = result.get('fileName', 'Unknown')

                if len(content) > 2000:
                    content = content[:2000] + "\n\n... (truncated)"

                return f"**Content from {file_name}:**\n\n```\n{content}\n```"

        except Exception as e:
            logger.error(f"read_file_section error: {e}")
            return f"Error reading file: {str(e)}"

    # =========================================================================
    # PROJECT STRUCTURE TOOLS
    # =========================================================================

    # =========================================================================
    # CURSOR-BASED INSERTION TOOLS
    # =========================================================================

    def insert_at_cursor(
        self,
        text: str,
        cursor_position: Dict[str, Any] = None,
        target_file: str = None
    ) -> Dict[str, Any]:
        """
        Insert text at the current cursor position in the document.
        The cursor position is provided by the frontend from Monaco editor.

        Args:
            text: The text/LaTeX content to insert at cursor
            cursor_position: Dict with lineNumber, column, offset, lineContent,
                           textBeforeCursor, textAfterCursor from Monaco editor
            target_file: The .tex file to edit. If None, uses active file or finds main .tex

        Returns:
            Dict with success status and details
        """
        if not cursor_position:
            return {
                "success": False,
                "error": "No cursor position available. Please click in the document where you want to insert text.",
                "action_needed": "set_cursor"
            }

        project_path = Path(self.project_path)

        # Determine target file
        if target_file:
            tex_path = project_path / target_file
            if not tex_path.exists():
                return {
                    "success": False,
                    "error": f"File not found: {target_file}",
                    "action_needed": "specify_file"
                }
        else:
            # Find main .tex file
            tex_files = list(project_path.glob("*.tex"))
            if not tex_files:
                tex_files = list((project_path / "output").glob("*.tex"))

            if not tex_files:
                return {
                    "success": False,
                    "error": "No .tex files found in project. Please specify the target file.",
                    "action_needed": "specify_file"
                }

            # Prefer main.tex, paper.tex, document.tex
            tex_path = None
            for preferred in ["main.tex", "paper.tex", "document.tex"]:
                for tf in tex_files:
                    if tf.name.lower() == preferred:
                        tex_path = tf
                        break
                if tex_path:
                    break

            if not tex_path:
                tex_path = tex_files[0]

        try:
            # Read current file content
            with open(tex_path, 'r', encoding='utf-8') as f:
                content = f.read()

            # Use the offset from cursor position for precise insertion
            offset = cursor_position.get('offset')
            line_number = cursor_position.get('lineNumber')
            column = cursor_position.get('column')

            if offset is not None:
                # Direct offset-based insertion (most accurate)
                if offset < 0 or offset > len(content):
                    return {
                        "success": False,
                        "error": f"Invalid cursor offset: {offset}. Document length is {len(content)}.",
                        "action_needed": "update_cursor"
                    }

                new_content = content[:offset] + text + content[offset:]

            elif line_number is not None and column is not None:
                # Line/column based insertion
                lines = content.split('\n')

                if line_number < 1 or line_number > len(lines):
                    return {
                        "success": False,
                        "error": f"Invalid line number: {line_number}. Document has {len(lines)} lines.",
                        "action_needed": "update_cursor"
                    }

                target_line_idx = line_number - 1  # 0-indexed
                target_line = lines[target_line_idx]

                # Clamp column to valid range
                col_idx = min(max(0, column - 1), len(target_line))

                # Insert text at position
                new_line = target_line[:col_idx] + text + target_line[col_idx:]
                lines[target_line_idx] = new_line
                new_content = '\n'.join(lines)

            else:
                return {
                    "success": False,
                    "error": "Cursor position missing required fields (offset or lineNumber/column).",
                    "action_needed": "update_cursor"
                }

            # Write the updated content
            with open(tex_path, 'w', encoding='utf-8') as f:
                f.write(new_content)

            # Prepare context info for response
            line_content = cursor_position.get('lineContent', '')
            text_before = cursor_position.get('textBeforeCursor', '')[-30:] if cursor_position.get('textBeforeCursor') else ''

            return {
                "success": True,
                "message": f"✅ Inserted text at cursor position (line {line_number}, column {column}) in {tex_path.name}",
                "file": tex_path.name,
                "file_path": str(tex_path.relative_to(project_path)),
                "inserted_text": text[:100] + ('...' if len(text) > 100 else ''),
                "position": {
                    "line": line_number,
                    "column": column,
                    "context": f"...{text_before}[INSERTED]{line_content[column-1:column+20] if line_content else ''}"
                }
            }

        except Exception as e:
            logger.error(f"insert_at_cursor error: {e}")
            return {
                "success": False,
                "error": f"Error inserting text: {str(e)}",
                "action_needed": "retry"
            }

    def insert_text_in_document(
        self,
        text: str,
        after_text: str = None,
        cursor_position: Dict[str, Any] = None,
        target_file: str = None
    ) -> Dict[str, Any]:
        """
        Insert any text into the document. Supports two modes:
        1. At cursor position (if cursor_position provided)
        2. After specific text (if after_text provided)

        Args:
            text: The text/LaTeX content to insert
            after_text: Specific text after which to insert (if not using cursor)
            cursor_position: Cursor position from Monaco editor (preferred if available)
            target_file: The .tex file to edit

        Returns:
            Dict with success status and details
        """
        # Prefer cursor-based insertion if cursor position is available
        if cursor_position and cursor_position.get('offset') is not None:
            return self.insert_at_cursor(
                text=text,
                cursor_position=cursor_position,
                target_file=target_file
            )

        # Fall back to text-based insertion
        if not after_text:
            return {
                "success": False,
                "error": "Please specify where to insert: either place your cursor there, or tell me the exact text to insert after.",
                "action_needed": "specify_location"
            }

        project_path = Path(self.project_path)

        # Find target file (same logic as insert_at_cursor)
        if target_file:
            tex_path = project_path / target_file
            if not tex_path.exists():
                return {
                    "success": False,
                    "error": f"File not found: {target_file}",
                    "action_needed": "specify_file"
                }
        else:
            tex_files = list(project_path.glob("*.tex"))
            if not tex_files:
                tex_files = list((project_path / "output").glob("*.tex"))

            if not tex_files:
                return {
                    "success": False,
                    "error": "No .tex files found in project.",
                    "action_needed": "specify_file"
                }

            tex_path = None
            for preferred in ["main.tex", "paper.tex", "document.tex"]:
                for tf in tex_files:
                    if tf.name.lower() == preferred:
                        tex_path = tf
                        break
                if tex_path:
                    break

            if not tex_path:
                tex_path = tex_files[0]

        try:
            with open(tex_path, 'r', encoding='utf-8') as f:
                content = f.read()

            # Find the after_text - try exact match, then stripped, then normalized whitespace
            if after_text not in content:
                # Try stripped version (LLM may add trailing/leading whitespace)
                after_stripped = after_text.strip() if after_text else ""
                if after_stripped and after_stripped in content:
                    after_text = after_stripped
                else:
                    # Try with normalized whitespace
                    normalized_search = re.sub(r'\s+', ' ', (after_text or "").strip())
                    normalized_content = re.sub(r'\s+', ' ', content)
                    if normalized_search and normalized_search in normalized_content:
                        pattern = r'\s+'.join(re.escape(word) for word in (after_text or "").split())
                        match = re.search(pattern, content)
                        if match:
                            after_text = match.group(0)
                        else:
                            return {
                                "success": False,
                                "error": f"Could not find the text '{after_text[:50]}...' in {tex_path.name}.",
                                "action_needed": "correct_text"
                            }
                    else:
                        return {
                            "success": False,
                            "error": f"Could not find the text '{after_text[:50]}...' in {tex_path.name}.",
                            "action_needed": "correct_text"
                        }

            # Check uniqueness
            count = content.count(after_text)
            if count > 1:
                return {
                    "success": False,
                    "error": f"The text appears {count} times. Please provide more context or place your cursor at the exact position.",
                    "action_needed": "more_context",
                    "occurrences": count
                }

            # Insert the text
            position = content.find(after_text) + len(after_text)
            new_content = content[:position] + text + content[position:]

            with open(tex_path, 'w', encoding='utf-8') as f:
                f.write(new_content)

            # Traceability: line range (1-based) in new file
            line_start = content[:position].count('\n') + 1
            line_end = line_start + max(0, text.count('\n'))

            # Parse \cite{key} and \cite{key1,key2,...} from inserted text
            cite_matches = re.findall(r'\\cite\{([^}]+)\}', text)
            citation_keys = []
            for m in cite_matches:
                for k in (x.strip() for x in m.split(',')):
                    if k and k not in citation_keys:
                        citation_keys.append(k)
            keys_str = ', '.join(citation_keys) if citation_keys else 'none'

            msg = f"✅ Inserted text after '{after_text[:40]}...' in {tex_path.name}. Inserted at lines {line_start}–{line_end}. Citation keys used: {keys_str}."
            return {
                "success": True,
                "message": msg,
                "file": tex_path.name,
                "file_path": str(tex_path.relative_to(project_path)),
                "inserted_text": text[:100] + ('...' if len(text) > 100 else ''),
                "location": f"after '{after_text[:40]}...'" if len(after_text) > 40 else f"after '{after_text}'",
                "line_start": line_start,
                "line_end": line_end,
                "citation_keys": citation_keys,
            }

        except Exception as e:
            logger.error(f"insert_text_in_document error: {e}")
            return {
                "success": False,
                "error": f"Error inserting text: {str(e)}",
                "action_needed": "retry"
            }

    def read_project_file(self, file_path: str, max_lines: Optional[int] = None) -> str:
        """
        Read the contents of a file in the project directory.
        Use this when the user asks about a specific project file (e.g., "what does abstract.txt contain").
        Project files are .tex, .bib, .txt, etc. in the project - NOT uploaded research files.

        Args:
            file_path: Path to the file relative to project root (e.g., "abstract.txt", "chapters/intro.tex")
            max_lines: Optional limit on lines to read (default: read full file)

        Returns:
            File content or error message
        """
        project_path = Path(self.project_path)
        full_path = project_path / file_path

        if not full_path.exists():
            return f"File not found: {file_path}"

        if not full_path.is_file():
            return f"Not a file: {file_path}"

        try:
            with open(full_path, 'r', encoding='utf-8', errors='replace') as f:
                lines = f.readlines()

            if max_lines:
                lines = lines[:max_lines]
                content = ''.join(lines)
                if len(lines) >= max_lines:
                    content += f"\n... (truncated, showing first {max_lines} lines)"
            else:
                content = ''.join(lines)

            return f"--- File: {file_path} ---\n{content}"
        except Exception as e:
            return f"Error reading {file_path}: {str(e)}"

    def list_project_files(self, path: str = ".", recursive: bool = False) -> str:
        """
        List files in the project directory.
        Use this to understand what files exist (especially .tex and .bib files).

        Args:
            path: Directory path relative to project root (default: "." for root)
            recursive: Whether to list recursively (default: False)

        Returns:
            Formatted list of project files
        """
        project_path = Path(self.project_path)
        target_path = project_path / path

        if not target_path.exists():
            return f"Path not found: {path}"

        if not target_path.is_dir():
            return f"Not a directory: {path}"

        try:
            items = []

            if recursive:
                for item in target_path.rglob("*"):
                    if item.is_file():
                        rel_path = item.relative_to(project_path)
                        items.append({
                            "path": str(rel_path),
                            "type": "file",
                            "ext": item.suffix,
                            "size": item.stat().st_size
                        })
            else:
                for item in target_path.iterdir():
                    rel_path = item.relative_to(project_path)
                    if item.is_file():
                        items.append({
                            "path": str(rel_path),
                            "type": "file",
                            "ext": item.suffix,
                            "size": item.stat().st_size
                        })
                    else:
                        items.append({
                            "path": str(rel_path),
                            "type": "directory"
                        })

            # Sort: directories first, then files
            items.sort(key=lambda x: (x["type"] == "file", x["path"]))

            if not items:
                return f"Directory '{path}' is empty."

            # Group by type for nice output
            lines = [f"**Project Files** ({len(items)} items in `{path}`)\n"]

            # Highlight important files
            tex_files = [i for i in items if i.get("ext") == ".tex"]
            bib_files = [i for i in items if i.get("ext") == ".bib"]
            dirs = [i for i in items if i["type"] == "directory"]
            other_files = [i for i in items if i["type"] == "file" and i.get("ext") not in [".tex", ".bib"]]

            if tex_files:
                lines.append("**LaTeX files (.tex):**")
                for f in tex_files:
                    size_kb = f.get("size", 0) / 1024
                    lines.append(f"  • {f['path']} ({size_kb:.1f} KB)")
                lines.append("")

            if bib_files:
                lines.append("**Bibliography files (.bib):**")
                for f in bib_files:
                    size_kb = f.get("size", 0) / 1024
                    lines.append(f"  • {f['path']} ({size_kb:.1f} KB)")
                lines.append("")

            if dirs:
                lines.append("**Directories:**")
                for d in dirs:
                    lines.append(f"  📁 {d['path']}/")
                lines.append("")

            if other_files and len(other_files) <= 10:
                lines.append("**Other files:**")
                for f in other_files[:10]:
                    lines.append(f"  • {f['path']}")
                if len(other_files) > 10:
                    lines.append(f"  ... and {len(other_files) - 10} more")
            elif other_files:
                lines.append(f"**Other files:** {len(other_files)} files")

            return "\n".join(lines)

        except Exception as e:
            logger.error(f"list_project_files error: {e}")
            return f"Error listing files: {str(e)}"

    def read_imported_and_tagged_files(self, query: Optional[str] = None) -> str:
        """
        Read and retrieve content from imported (research) and tagged (highlighted) files.
        Use when the user asks to "use my imported files", "use tagged files", or "retrieve from imported/tagged".

        Args:
            query: Optional search query. If provided, search within imported files; otherwise return content.

        Returns:
            Combined content from tagged and imported files, or search results when query is provided.
        """
        if self.research_files:
            return _STUB_MSG
        CAP_TAGGED = 50_000
        CAP_IMPORTED = 50_000
        blocks = []

        # Tagged (highlighted) files
        if self.highlighted_files:
            tagged_parts = []
            tagged_len = 0
            for path in self.highlighted_files:
                if tagged_len >= CAP_TAGGED:
                    tagged_parts.append("\n... (tagged content truncated)")
                    break
                try:
                    out = self.read_project_file(path, max_lines=200)
                    if out and "not found" not in out.lower() and "not a file" not in out.lower():
                        tagged_parts.append(out)
                        tagged_len += len(out)
                except Exception as e:
                    logger.warning(f"read_imported_and_tagged_files tagged {path}: {e}")
                    tagged_parts.append(f"--- {path}: Error reading ({e}) ---")
            if tagged_parts:
                blocks.append("## Tagged (highlighted) files\n\n" + "\n\n".join(tagged_parts))

        # Imported (research) files
        if self.research_files:
            try:
                from tools.file_tools import FileTools

                ft = FileTools(self.project_id, self.research_files)
                if query and str(query).strip():
                    results = ft.search_files(query, limit=20)
                    if not results:
                        blocks.append("## Search in imported\n\nNo matches found for your query.")
                    else:
                        lines = [f"**Search in imported files for \"{query}\"** ({len(results)} match(es))\n"]
                        for i, r in enumerate(results, 1):
                            name = r.get("fileName", "Unknown")
                            sid = r.get("fileId", "")
                            rev = r.get("relevanceScore", 0)
                            summary = (r.get("summary") or "")[:150]
                            lines.append(f"{i}. **{name}** (id: {sid}) — relevance {rev:.0%}")
                            if summary:
                                lines.append(f"   {summary}...")
                            lines.append("")
                        lines.append("*Use read_file_content(file_id) to read a file, or search_my_files for more.*")
                        blocks.append("## Search in imported\n\n" + "\n".join(lines))
                else:
                    imported_parts = []
                    imported_len = 0
                    for f in self.research_files:
                        if imported_len >= CAP_IMPORTED:
                            imported_parts.append("\n... (imported content truncated)")
                            break
                        fid = f.get("fileId")
                        fname = f.get("fileName", "unknown")
                        if not fid:
                            continue
                        try:
                            res = ft.read_file_content(fid, max_lines=100)
                            if "error" in res:
                                imported_parts.append(f"--- {fname}: {res['error']} ---")
                            else:
                                cnt = (res.get("content") or "")[:8000]
                                if cnt:
                                    imported_parts.append(f"--- File: {fname} (id: {fid}) ---\n{cnt}")
                                    imported_len += len(cnt)
                        except Exception as e:
                            logger.warning(f"read_imported_and_tagged_files imported {fid}: {e}")
                            imported_parts.append(f"--- {fname}: Error reading ({e}) ---")
                    if imported_parts:
                        blocks.append("## Imported (research) files\n\n" + "\n\n".join(imported_parts))
            except Exception as e:
                logger.error(f"read_imported_and_tagged_files: {e}")
                blocks.append(f"## Imported files\n\nError: {e}")

        if not blocks:
            return "No imported or tagged files available. Add research files or tag (highlight) project files for context, then try again."

        return "\n\n".join(blocks)


def detect_query_complexity(message: str, has_research_files: bool = False) -> int:
    """
    Detect query complexity and return appropriate max_tool_iterations.

    More generous limits to allow the AI to try multiple approaches and
    complete complex tasks without hitting tool limits prematurely.

    Args:
        message: User's message
        has_research_files: Whether user has research files

    Returns:
        Recommended max iterations (minimum 8 for most tasks)
    """
    message_lower = message.lower()

    # Complex analysis/generation requests - need many iterations
    complex_keywords = [
        "analyze", "comprehensive", "thorough", "detailed", "compare",
        "synthesize", "all", "every", "complete", "full", "generate",
        "write", "create", "draft", "compose"
    ]
    if any(kw in message_lower for kw in complex_keywords):
        return 24

    # Add references / add content / section + references / pertinent content (high round count)
    if (
        ("add" in message_lower and "references" in message_lower)
        or ("add" in message_lower and "content" in message_lower)
        or ("add" in message_lower and "section" in message_lower)
        or ("section" in message_lower and "references" in message_lower)
        or ("pertinent" in message_lower and ("content" in message_lower or "section" in message_lower))
        or ("talk about" in message_lower)
        or ("discuss" in message_lower)
        or ("write about" in message_lower)
    ):
        return 24

    # Action-oriented keywords - user wants something done
    action_keywords = [
        "add", "insert", "put", "place", "change", "modify", "update",
        "fix", "improve", "enhance", "expand", "reduce", "shorten",
        "populate", "fill", "include"
    ]
    if any(kw in message_lower for kw in action_keywords):
        return 16

    # Search/find multiple articles
    search_keywords = ["find", "search", "articles", "papers", "sources", "references", "cite", "citation"]
    quantity_patterns = [
        r'\d+\s*(more\s*)?(articles?|papers?|sources?)',
        r'(several|multiple|some|few|many)\s*(articles?|papers?|sources?)'
    ]

    if any(kw in message_lower for kw in search_keywords):
        for pattern in quantity_patterns:
            if re.search(pattern, message_lower):
                return 16
        return 12

    # File-related queries
    file_keywords = ["file", "uploaded", "my files", "research files", "document", "imported"]
    if any(kw in message_lower for kw in file_keywords) and has_research_files:
        return 12

    # Simple questions - still give enough room
    simple_keywords = ["what is", "explain", "how does", "why", "?"]
    if any(kw in message_lower for kw in simple_keywords):
        return 8

    # Default - be generous to allow retries and multiple approaches
    return 10 if has_research_files else 8
