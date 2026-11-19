# agents/citation_matcher.py
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
from typing import List, Dict, Optional
import re
import json

# Import Source type for type hints
try:
    from utils.sources import Source
except ImportError:
    # Fallback if Source is not available
    Source = object


class CitationMatcher:
    """Intelligent citation matching using LLM to match written content to sources"""
    
    def __init__(self, llm: ChatOpenAI, citation_manager):
        self.llm = llm
        self.citation_manager = citation_manager
        # Track citation usage to ensure balanced distribution
        self.citation_usage_count = {}  # citation_key -> count
        # Optional allowlist to force citation injection from specific keys only.
        self.allowed_citation_keys = None

    def set_allowed_citation_keys(self, keys: Optional[List[str]] = None) -> None:
        """Restrict citations to provided keys; pass None to clear restriction."""
        if keys is None:
            self.allowed_citation_keys = None
            return
        self.allowed_citation_keys = {str(k).strip() for k in keys if str(k).strip()}
    
    async def match_and_inject_citations(self, content: str, section_name: str = "") -> str:
        """
        Match written content to sources and inject citations intelligently.
        
        Args:
            content: Written content without citations
            section_name: Name of the section (for context)
        
        Returns:
            Content with citations injected
        """
        if not self.citation_manager or len(self.citation_manager.sources) == 0:
            print("??  No sources available in CitationManager - skipping citation matching")
            return content
        
        # Get all sources from CitationManager
        all_sources = list(self.citation_manager.sources.values())
        if self.allowed_citation_keys is not None:
            all_sources = [
                source for source in all_sources
                if getattr(source, 'citation_key', None) in self.allowed_citation_keys
            ]
        
        if not all_sources:
            print("??  CitationManager is empty - no citations to match")
            return content
        
        print(f"?? Matching citations for section '{section_name}' using {len(all_sources)} sources...")
        
        # Split content into paragraphs (preserve structure)
        paragraphs = self._split_into_paragraphs(content)
        
        if not paragraphs:
            return content
        
        # Match citations for each paragraph
        content_with_citations = []
        total_matched = 0
        
        for i, paragraph in enumerate(paragraphs):
            if not paragraph.strip() or paragraph.strip().startswith('\\'):
                # Skip empty paragraphs and LaTeX commands
                content_with_citations.append(paragraph)
                continue
            
            # Find relevant sources for this paragraph (pass usage counts to prioritize unused sources)
            relevant_keys = await self._find_relevant_sources(
                paragraph, 
                all_sources, 
                section_name,
                usage_counts=self.citation_usage_count
            )
            
            if relevant_keys:
                # Inject citations naturally into the paragraph
                paragraph_with_citations = self._inject_citations(paragraph, relevant_keys)
                content_with_citations.append(paragraph_with_citations)
                total_matched += len(relevant_keys)
                print(f"   Paragraph {i+1}: Matched {len(relevant_keys)} citation(s): {', '.join(relevant_keys[:3])}{'...' if len(relevant_keys) > 3 else ''}")
            else:
                content_with_citations.append(paragraph)
        
        # Count unique citations actually injected
        unique_citations = set()
        for para in content_with_citations:
            citations = re.findall(r'\\cite\{([^}]+)\}', para)
            for match in citations:
                keys = [k.strip() for k in match.split(',')]
                unique_citations.update(keys)
        
        print(f"? Citation matching complete: {total_matched} total citation instances matched across {len(unique_citations)} unique sources")
        
        # NEW: Ensure all sources are used at least once
        if len(unique_citations) < len(all_sources):
            unused_sources = [s.citation_key for s in all_sources if s.citation_key not in unique_citations]
            print(f"??  {len(unused_sources)} sources not yet cited: {', '.join(unused_sources[:5])}{'...' if len(unused_sources) > 5 else ''}")
            
            # Add unused sources to suitable paragraphs
            if unused_sources and content_with_citations:
                # Distribute unused sources across paragraphs (prefer longer paragraphs)
                unused_idx = 0
                for i in range(len(content_with_citations)):
                    if unused_idx >= len(unused_sources):
                        break
                    
                    para = content_with_citations[i]
                    # Find suitable paragraphs (not too short, not LaTeX commands)
                    if para.strip() and not para.strip().startswith('\\') and len(para.split()) > 30:
                        # Add ONLY 1 unused source per paragraph (reduced from 2 to prevent bloat)
                        sources_to_add = unused_sources[unused_idx:unused_idx + 1]
                        unused_idx += len(sources_to_add)
                        
                        # Inject citations
                        para_clean = para.rstrip()
                        if para_clean.endswith('.'):
                            para_clean = para_clean[:-1] + ' ' + self._format_citations(sources_to_add) + '.'
                        elif para_clean.endswith(('!', '?')):
                            para_clean = para_clean[:-1] + ' ' + self._format_citations(sources_to_add) + para_clean[-1]
                        else:
                            para_clean += ' ' + self._format_citations(sources_to_add)
                        
                        content_with_citations[i] = para_clean
                        unique_citations.update(sources_to_add)
                        print(f"   ? Added {len(sources_to_add)} unused source(s) to paragraph {i+1}: {', '.join(sources_to_add)}")
                
                # If still have unused sources, add them to the last paragraph
                if unused_idx < len(unused_sources):
                    remaining = unused_sources[unused_idx:]
                    if content_with_citations:
                        last_para = content_with_citations[-1]
                        if last_para.strip() and not last_para.strip().startswith('\\'):
                            last_para_clean = last_para.rstrip()
                            if last_para_clean.endswith('.'):
                                last_para_clean = last_para_clean[:-1] + ' ' + self._format_citations(remaining) + '.'
                            else:
                                last_para_clean += ' ' + self._format_citations(remaining)
                            content_with_citations[-1] = last_para_clean
                            unique_citations.update(remaining)
                            print(f"   ? Added {len(remaining)} remaining unused source(s) to last paragraph: {', '.join(remaining)}")
                
                print(f"? Ensured all {len(all_sources)} sources are cited (was {len(unique_citations) - len(unused_sources) + unused_idx}, now {len(unique_citations)})")
        
        # Rejoin paragraphs
        return '\n\n'.join(content_with_citations)
    
    def _split_into_paragraphs(self, content: str) -> List[str]:
        """Split content into paragraphs while preserving LaTeX structure"""
        # Split by double newlines (paragraph breaks)
        paragraphs = content.split('\n\n')
        
        # Filter out empty paragraphs and merge LaTeX commands with their content
        result = []
        i = 0
        while i < len(paragraphs):
            para = paragraphs[i].strip()
            
            # If it's a LaTeX command block, merge with next paragraph
            if para.startswith('\\') and not para.startswith('\\cite'):
                if i + 1 < len(paragraphs):
                    result.append(para + '\n\n' + paragraphs[i + 1].strip())
                    i += 2
                    continue
            
            if para:
                result.append(para)
            i += 1
        
        return result if result else [content]
    
    async def _find_relevant_sources(
        self, 
        paragraph: str, 
        all_sources: List[Source], 
        section_name: str = "",
        usage_counts: Dict[str, int] = None
    ) -> List[str]:
        """
        Use LLM to find which sources are relevant to a paragraph.
        
        Args:
            paragraph: The paragraph text to match
            all_sources: List of all available sources
            section_name: Name of the section for context
            usage_counts: Dictionary of citation_key -> usage count (to prioritize unused sources)
        
        Returns list of citation keys that match the paragraph content.
        """
        # Create source summaries for the LLM
        source_summaries = []
        for source in all_sources:
            # Create concise summary of each source
            summary = f"[{source.citation_key}] {source.title}\n"
            summary += f"Summary: {source.abstract[:300] if source.abstract else 'No abstract available'}...\n"
            if source.authors:
                summary += f"Authors: {', '.join(source.authors[:3])}"
                if len(source.authors) > 3:
                    summary += " et al."
            if source.year:
                summary += f", Year: {source.year}"
            
            # Add usage count if available (to help prioritize unused sources)
            if usage_counts and source.citation_key in usage_counts:
                usage = usage_counts[source.citation_key]
                summary += f" (Used {usage} time{'s' if usage != 1 else ''})"
            else:
                summary += " (Not yet used)"
            
            source_summaries.append(summary)
        
        # Limit to reasonable number of sources to avoid context overflow
        # Use all sources if reasonable, otherwise sample
        max_sources_for_matching = 50
        if len(source_summaries) > max_sources_for_matching:
            # Use first max_sources_for_matching (they're already in CitationManager order)
            source_summaries = source_summaries[:max_sources_for_matching]
            print(f"   ??  Limiting to {max_sources_for_matching} sources for matching (out of {len(all_sources)} total)")
        
        # Create prompt for LLM - SELECTIVE citation matching (not inclusive!)
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an academic citation expert. Your task is to identify which sources from a research pool are MOST RELEVANT to a given paragraph of text.

CRITICAL REQUIREMENTS:
1. Select ONLY the 1-2 MOST RELEVANT sources per paragraph (academic papers typically cite 1-2 sources per paragraph, not more)
2. Be SELECTIVE - only include sources that DIRECTLY support or relate to the MAIN claims/ideas in the paragraph
3. Return ONLY the citation keys (e.g., "Saad2024Artificial") as a JSON array
4. If no sources are directly relevant, return an empty array []
5. MAXIMUM 2 sources per paragraph - prefer quality over quantity
6. Prioritize sources that haven't been used much yet (check usage counts - prefer "Not yet used" or low usage counts)
7. Do NOT cite sources that are only tangentially related - be strict about relevance

Return format: JSON array of citation keys, e.g., ["key1", "key2"] or ["key1"] or []"""),
            ("user", """Analyze this paragraph and determine which 1-2 sources from the pool are MOST RELEVANT.

Section Context: {section_name}

Paragraph to analyze:
{paragraph}

Available Sources Pool:
{source_summaries}

Citation Usage So Far:
{usage_info}

Return a JSON array of MAXIMUM 2 citation keys that are MOST DIRECTLY relevant to this paragraph. Be SELECTIVE - only include sources that directly support the main claims. Prioritize sources that haven't been used much yet.""")
        ])
        
        # Format usage info for the prompt
        usage_info = "None" if not usage_counts else json.dumps(usage_counts, indent=2)
        
        try:
            chain = prompt | self.llm
            response = await chain.ainvoke({
                "paragraph": paragraph[:1000],  # Limit paragraph length
                "source_summaries": "\n\n".join(source_summaries),
                "section_name": section_name,
                "usage_info": usage_info
            })
            
            # Parse JSON response
            content = response.content.strip()
            
            # Extract JSON from markdown code blocks if present
            if "```json" in content:
                content = content.split("```json")[1].split("```")[0].strip()
            elif "```" in content:
                content = content.split("```")[1].split("```")[0].strip()
            
            # Parse JSON
            try:
                citation_keys = json.loads(content)
                if not isinstance(citation_keys, list):
                    citation_keys = []
            except json.JSONDecodeError:
                # Try to extract citation keys from text
                citation_keys = re.findall(r'"([^"]+)"', content)
                if not citation_keys:
                    # Try without quotes
                    citation_keys = re.findall(r'(\w+\d{4}\w+)', content)
            
            # Validate citation keys exist in CitationManager
            valid_keys = []
            for key in citation_keys:
                if key in self.citation_manager.sources:
                    valid_keys.append(key)
                else:
                    print(f"   ??  Citation key '{key}' not found in CitationManager, skipping")
            
            # Sort by usage (prefer unused sources)
            if usage_counts:
                valid_keys.sort(key=lambda k: usage_counts.get(k, 0))
            
            # LIMIT to MAX 2 citations per paragraph (academic standard)
            valid_keys = valid_keys[:2]
            
            return valid_keys
            
        except Exception as e:
            print(f"   ??  Error matching citations for paragraph: {e}")
            return []
    
    def _inject_citations(self, paragraph: str, citation_keys: List[str]) -> str:
        """
        Inject citations naturally into a paragraph - SIMPLIFIED: add at end only.
        
        Strategy:
        - Add citations at the end of the paragraph (academic standard)
        - MAX 2 citations per paragraph
        - Do NOT distribute across sentences (reduces citation bloat)
        """
        if not citation_keys:
            return paragraph
        
        # LIMIT to 2 citations max
        citation_keys = citation_keys[:2]
        
        # Record citations in CitationManager for statistics and track usage
        if self.citation_manager:
            for key in citation_keys:
                self.citation_manager.record_citation(key)
                # Track usage for balanced distribution
                self.citation_usage_count[key] = self.citation_usage_count.get(key, 0) + 1
        
        # Remove any existing citations first (clean slate)
        paragraph = re.sub(r'\\cite\{[^}]+\}', '', paragraph)
        
        # SIMPLIFIED: Add citations at the end of the paragraph only
        paragraph = paragraph.rstrip()
        if paragraph.endswith('.'):
            paragraph = paragraph[:-1] + ' ' + self._format_citations(citation_keys) + '.'
        elif paragraph.endswith(('!', '?')):
            paragraph = paragraph[:-1] + ' ' + self._format_citations(citation_keys) + paragraph[-1]
        else:
            paragraph += ' ' + self._format_citations(citation_keys)
        
        return paragraph
    
    def _format_citations(self, citation_keys: List[str]) -> str:
        """Format citation keys as LaTeX cite command"""
        if not citation_keys:
            return ""
        
        if len(citation_keys) == 1:
            return f"\\cite{{{citation_keys[0]}}}"
        else:
            return f"\\cite{{{', '.join(citation_keys)}}}"

