# agents/writing_planner.py
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
from typing import List, Dict, Optional
from utils.sources import Source
import json
import logging

logger = logging.getLogger(__name__)


class WritingPlanner:
    """
    Create detailed writing plan with DEEP hierarchical subsections.
    No arbitrary depth limits - go as deep as the content requires (4-5+ levels).
    """
    
    def __init__(self, llm: ChatOpenAI):
        self.llm = llm
    
    async def create_writing_plan(
        self,
        rough_plan: Dict,
        sources: List[Source],
        analysis: Dict,
        topic: str,
        description: str = ""
    ) -> Dict:
        """
        Create detailed writing plan with deep hierarchical structure.
        
        Uses analysis_graph (especially novel_synthesis) to inform structure.
        Creates sections -> subsections -> sub-subsections (AS MANY LEVELS AS NEEDED).
        """
        print(f"\n{'='*80}")
        print(f"📝 CREATING DEEP HIERARCHICAL WRITING PLAN")
        print(f"{'='*80}")
        print(f"Based on {len(sources)} sources and comprehensive analysis")
        print(f"No depth limits - will create as many subsection levels as needed")
        print(f"{'='*80}\n")
        
        # Extract novel synthesis for integration
        novel_synthesis = analysis.get('novel_synthesis', {})
        
        # Format comprehensive context for planning
        planning_context = self._build_planning_context(
            sources, analysis, rough_plan, novel_synthesis
        )
        
        prompt = ChatPromptTemplate.from_messages([
            ("system", """You are an expert academic writing planner. Create a DETAILED HIERARCHICAL plan with AS MANY subsection levels as needed.

CRITICAL REQUIREMENTS:
1. Create DEEP hierarchy: sections -> subsections -> sub-subsections (go 4-5+ levels deep where content warrants it)
2. NO arbitrary depth limits - structure should match content complexity
3. Each level should have:
   - 5-12 detailed key points (2-3 sentences each)
   - Specific papers to reference (citation keys)
   - Arguments to make with evidence
   - Clear narrative flow
   - Appropriate depth for each topic area

4. Integrate insights from novel_synthesis where appropriate
5. Base structure on ACTUAL research findings, not assumptions

HIERARCHICAL STRUCTURE:
{{
  "title": "Refined evidence-based title",
  "sections": [
    {{
      "id": "1",
      "name": "Introduction",
      "key_points": [
        "Point 1: Establish context (2-3 sentences with specific direction)",
        "Point 2: Identify the problem (2-3 sentences)",
        ...  // 8-12 detailed points total
      ],
      "papers_to_reference": ["Smith2020", "Jones2021", "Brown2022"],
      "arguments_to_make": [
        "Argument 1: The pandemic created unprecedented disruption",
        "Evidence: Cite Smith2020 (X statistic), Jones2021 (Y finding)"
      ],
      "narrative_flow": "Start broad -> narrow to specific problem -> preview key findings",
      "subsections": [
        {{
          "id": "1.1",
          "name": "Background and Context",
          "key_points": [...],
          "papers_to_reference": [...],
          "arguments_to_make": [...],
          "subsections": [
            {{
              "id": "1.1.1",
              "name": "Pre-pandemic Educational Landscape",
              "key_points": [...],
              "papers_to_reference": [...],
              "subsections": [
                {{
                  "id": "1.1.1.1",
                  "name": "Digital Infrastructure Before COVID-19",
                  "key_points": ["Point 1...", "Point 2..."],
                  "papers_to_reference": ["Paper7", "Paper12"],
                  "subsections": []  // Can go even deeper if needed
                }}
              ]
            }}
          ]
        }}
      ]
    }}
  ],
  "synthesis_integration": {{
    "novel_insights_to_highlight": ["Where to integrate Insight 1", "Where to integrate Insight 2"],
    "hypotheses_to_present": ["Where to present Hypothesis 1"],
    "recommended_directions_to_discuss": ["Where to discuss Direction 1"]
  }}
}}

IMPORTANT:
- DON'T limit yourself to 2-3 levels. Go 4-5+ levels deep where appropriate.
- Each subsection can have its own subsections recursively
- Depth should match content complexity
- All levels need rich metadata (key_points, papers, arguments)
- Return ONLY valid JSON, no markdown"""),
            ("user", f"""Create deep hierarchical writing plan:

Topic: {topic.replace('{', '{{').replace('}', '}}') if topic else ''}
Description: {description.replace('{', '{{').replace('}', '}}') if description else ''}

{planning_context.replace('{', '{{').replace('}', '}}') if planning_context else ''}

Create a detailed plan with AS MANY subsection levels as needed (4-5+ levels where appropriate).
Each level should be rich with metadata. Return JSON only.""")
        ])
        
        try:
            chain = prompt | self.llm
            response = await chain.ainvoke({})
            
            content_text = response.content.strip()
            
            # Extract JSON
            if "```json" in content_text:
                content_text = content_text.split("```json")[1].split("```")[0].strip()
            elif "```" in content_text:
                content_text = content_text.split("```")[1].split("```")[0].strip()
            
            try:
                detailed_plan = json.loads(content_text)
                
                # Validate and ensure all required fields
                detailed_plan = self._validate_and_enrich_plan(detailed_plan, rough_plan, topic)
                
                # Calculate word counts recursively if the AI provided target_words
                total_words = detailed_plan.get('target_words', rough_plan.get('target_words', 0))
                if total_words > 0:
                    detailed_plan = self._calculate_word_counts_recursive(detailed_plan, total_words)
                
                # Validate depth
                max_depth = self._get_max_depth(detailed_plan.get('sections', []))
                
                print(f"✅ DEEP HIERARCHICAL PLAN CREATED:")
                print(f"   📄 Title: {detailed_plan.get('title', 'Unknown')}")
                print(f"   📑 Top-level sections: {len(detailed_plan.get('sections', []))}")
                print(f"   🔢 Maximum depth: {max_depth} levels")
                tw = detailed_plan.get('target_words', 0)
                if tw > 0:
                    print(f"   📊 AI-suggested words: {tw}")
                else:
                    print(f"   📊 Length: AI decides freely")
                
                # Warn if no section goes beyond 2 levels
                if max_depth <= 2:
                    print(f"   ⚠️  WARNING: No section goes beyond 2 levels. Consider adding deeper structure.")
                else:
                    print(f"   ✅ Good depth: Plan has {max_depth} levels of hierarchy")
                
                # Show structure preview
                print(f"\n   📋 Structure Preview:")
                self._print_structure_preview(detailed_plan.get('sections', []), indent=2)
                print()
                
                return detailed_plan
                
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse JSON from writing plan: {e}")
                logger.error(f"Response preview: {content_text[:500]}")
                print(f"⚠️  Using rough plan as fallback")
                return rough_plan
                
        except Exception as e:
            logger.error(f"Error creating writing plan: {e}")
            print(f"⚠️  Using rough plan as fallback")
            return rough_plan
    
    def _build_planning_context(
        self,
        sources: List[Source],
        analysis: Dict,
        rough_plan: Dict,
        novel_synthesis: Dict
    ) -> str:
        """Build comprehensive context for planning."""
        context_parts = []
        
        # Rough plan context
        rough_sections = [s.get('name', '') for s in rough_plan.get('sections', [])]
        context_parts.append(f"Initial Rough Plan Sections: {', '.join(rough_sections)}")
        context_parts.append(f"Initial Sections: {len(rough_sections)}\n")
        
        # Analysis context
        context_parts.append(f"Research Understanding:\n{analysis.get('understanding', '')[:500]}...\n")
        context_parts.append(f"Key Themes: {', '.join(analysis.get('themes', []))}")
        context_parts.append(f"Main Arguments: {', '.join(analysis.get('main_arguments', []))}\n")
        
        # Clusters from relationship graph
        clusters = analysis.get('clusters', [])
        if clusters:
            context_parts.append(f"Thematic Clusters ({len(clusters)}):")
            for cluster in clusters[:5]:
                context_parts.append(f"  - {cluster.get('theme', 'Unknown')}: {len(cluster.get('papers', []))} papers")
            context_parts.append("")
        
        # Novel synthesis insights
        if novel_synthesis:
            insights = novel_synthesis.get('emergent_insights', [])
            if insights:
                context_parts.append(f"Emergent Insights to Integrate ({len(insights)}):")
                for i, insight in enumerate(insights[:3], 1):
                    context_parts.append(f"  {i}. {insight.get('insight', '')[:150]}...")
                context_parts.append("")
            
            hypotheses = novel_synthesis.get('bold_hypotheses', [])
            if hypotheses:
                context_parts.append(f"Bold Hypotheses to Present ({len(hypotheses)}):")
                for i, hyp in enumerate(hypotheses[:2], 1):
                    context_parts.append(f"  {i}. {hyp.get('hypothesis', '')[:100]}...")
                context_parts.append("")
        
        # Sources summary
        context_parts.append(f"Available Sources: {len(sources)} papers")
        sorted_sources = sorted([s for s in sources if s.pertinence_score], 
                              key=lambda x: x.pertinence_score or 0, reverse=True)
        context_parts.append("Top 5 Most Pertinent:")
        for i, source in enumerate(sorted_sources[:5], 1):
            context_parts.append(f"  {i}. [{source.citation_key}] {source.title} ({source.pertinence_score:.1f}/100)")
        
        return "\n".join(context_parts)
    
    def _deduplicate_sections(self, sections: List[Dict], seen_names: set = None) -> List[Dict]:
        """
        Remove duplicate sections by normalized name.
        Keeps the first occurrence of each section name.
        Applies recursively to subsections.
        
        Args:
            sections: List of section dictionaries
            seen_names: Set of already seen normalized section names (for tracking across recursion)
        
        Returns:
            Deduplicated list of sections
        """
        if seen_names is None:
            seen_names = set()
        
        deduplicated = []
        removed_count = 0
        
        for section in sections:
            # Normalize section name: lowercase, strip whitespace, remove common prefixes
            name = section.get('name', section.get('section_name', 'Unknown'))
            normalized_name = name.lower().strip()
            
            # Remove common numeric prefixes like "1. ", "1.1 ", etc.
            import re
            normalized_name = re.sub(r'^\d+(\.\d+)*\s*', '', normalized_name)
            normalized_name = normalized_name.strip()
            
            if normalized_name in seen_names:
                # Skip duplicate
                removed_count += 1
                logger.warning(f"Removing duplicate section: '{name}' (normalized: '{normalized_name}')")
                continue
            
            seen_names.add(normalized_name)
            
            # Recursively deduplicate subsections
            if section.get('subsections'):
                section['subsections'] = self._deduplicate_sections(
                    section['subsections'], 
                    seen_names.copy()  # Use copy to allow same names in different branches
                )
            
            deduplicated.append(section)
        
        if removed_count > 0:
            print(f"   ⚠️  Removed {removed_count} duplicate section(s)")
        
        return deduplicated

    def _validate_and_enrich_plan(self, plan: Dict, rough_plan: Dict, topic: str) -> Dict:
        """Validate and enrich plan with required fields."""
        if 'title' not in plan:
            plan['title'] = rough_plan.get('title', topic)

        # Ensure sections exist and are not empty
        if 'sections' not in plan or not plan.get('sections'):
            plan['sections'] = rough_plan.get('sections', [])
        
        # Deduplicate sections to prevent duplicate section names
        if plan.get('sections'):
            plan['sections'] = self._deduplicate_sections(plan['sections'])

        # CRITICAL: If sections are still empty, create fallback sections (no word targets — AI writes freely)
        if not plan.get('sections') or len(plan['sections']) == 0:
            plan['sections'] = [
                {"id": "1", "name": "Introduction", "percentage": 20, "key_points": [f"Background of {topic}"], "search_queries": [f"{topic} introduction"], "subsections": []},
                {"id": "2", "name": "Literature Review", "percentage": 25, "key_points": [f"Current research on {topic}"], "search_queries": [f"{topic} research"], "subsections": []},
                {"id": "3", "name": "Methodology and Analysis", "percentage": 35, "key_points": [f"Analysis of {topic}"], "search_queries": [f"{topic} analysis"], "subsections": []},
                {"id": "4", "name": "Conclusion", "percentage": 20, "key_points": [f"Summary of {topic}"], "search_queries": [f"{topic} conclusion"], "subsections": []}
            ]
            logger.warning(f"Created fallback sections for plan - original plan had no sections")
        if 'keywords' not in plan or not plan.get('keywords'):
            # Extract keywords from rough_plan or generate from title
            plan['keywords'] = rough_plan.get('keywords', [])
            if not plan['keywords']:
                # Generate keywords from title
                title = plan.get('title', topic)
                import re
                # Extract meaningful capitalized words from title
                title_words = re.findall(r'\b[A-Z][a-z]+\b', title)
                # Filter out common words and take first 5-7 meaningful terms
                common_words = {'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from'}
                keywords = [word.lower() for word in title_words if word.lower() not in common_words][:7]
                if not keywords:
                    # Fallback: use topic words
                    topic_words = topic.lower().split()
                    keywords = [w for w in topic_words if len(w) > 3][:5]
                plan['keywords'] = keywords
        if 'synthesis_integration' not in plan:
            plan['synthesis_integration'] = {}
        
        return plan
    
    def _calculate_word_counts_recursive(self, plan: Dict, total_words: int) -> Dict:
        """Recursively calculate target word counts for all levels."""
        sections = plan.get('sections', [])
        if not sections:
            return plan
        
        # Calculate based on percentages if available
        total_percentage = sum(s.get('percentage', 0) for s in sections)
        
        if total_percentage > 0:
            for section in sections:
                percentage = section.get('percentage', 0)
                section['target_words'] = int((percentage / total_percentage) * total_words)
                
                # Recursively calculate for subsections
                if section.get('subsections'):
                    section = self._calculate_subsection_words(section, section['target_words'])
        else:
            # Equal distribution if no percentages
            words_per_section = total_words // len(sections)
            for section in sections:
                section['target_words'] = words_per_section
                if section.get('subsections'):
                    section = self._calculate_subsection_words(section, section['target_words'])
        
        plan['sections'] = sections
        return plan
    
    def _calculate_subsection_words(self, section: Dict, section_words: int) -> Dict:
        """Recursively calculate word counts for subsections."""
        subsections = section.get('subsections', [])
        if not subsections:
            return section
        
        # Distribute words among subsections
        words_per_subsection = section_words // len(subsections)
        
        for subsection in subsections:
            subsection['target_words'] = words_per_subsection
            # Recursively handle deeper levels
            if subsection.get('subsections'):
                subsection = self._calculate_subsection_words(subsection, subsection['target_words'])
        
        section['subsections'] = subsections
        return section
    
    def _get_max_depth(self, sections: List[Dict], current_depth: int = 1) -> int:
        """Get maximum depth of hierarchy."""
        if not sections:
            return current_depth
        
        max_depth = current_depth
        for section in sections:
            if section.get('subsections'):
                depth = self._get_max_depth(section['subsections'], current_depth + 1)
                max_depth = max(max_depth, depth)
        
        return max_depth
    
    def _print_structure_preview(self, sections: List[Dict], indent: int = 0, max_items: int = 3):
        """Print hierarchical structure preview."""
        for i, section in enumerate(sections[:max_items], 1):
            prefix = " " * indent
            section_id = section.get('id', '?')
            section_name = section.get('name', 'Unknown')
            target_words = section.get('target_words', 0)
            key_points_count = len(section.get('key_points', []))
            
            print(f"{prefix}{section_id}. {section_name} ({target_words}w, {key_points_count} points)")
            
            # Recursively print subsections
            if section.get('subsections'):
                self._print_structure_preview(section['subsections'], indent + 4, max_items=2)
        
        if len(sections) > max_items:
            prefix = " " * indent
            print(f"{prefix}... and {len(sections) - max_items} more")
