# agents/planner.py
from langchain_openai import ChatOpenAI
from langchain.prompts import ChatPromptTemplate
from langchain.output_parsers import PydanticOutputParser
from pydantic import BaseModel, Field
from typing import List, Optional, Dict, DefaultDict
import json
from langchain_core.prompts import PromptTemplate

# =============================================================================
# Document Planner — AI decides structure based on requested document type
# =============================================================================


class SectionPlan(BaseModel):
    """Plan for a single section"""
    id: str = Field(description="Section ID like '1.2.1'")
    name: str = Field(description="Section name")
    key_points: List[str] = Field(description="Key points to cover")
    search_queries: List[str] = Field(description="Search queries for this section")
    percentage: float = Field(description="Percentage of paper content")
    subsections: List['SectionPlan'] = Field(default_factory=list)

class PaperPlan(BaseModel):
    """Complete paper plan"""
    title: str
    sections: List[SectionPlan]
    abstract_points: List[str]
    keywords: List[str]

# Allow recursive model
SectionPlan.model_rebuild()

class PaperPlanner:
    """Agent to plan document structure"""

    def __init__(self, llm: ChatOpenAI, words_per_page: int = None):
        self.llm = llm
        self.special_instructions = None
        self.image_context = None

    def set_special_instructions(self, instructions: Optional[str]):
        """Set special formatting/style instructions to consider during planning"""
        self.special_instructions = instructions

    def set_image_context(self, image_context: Optional[str]):
        """Set available image context for planning and placement."""
        self.image_context = image_context
    
    def extract_sections_from_template(self, template_content: str) -> List[Dict]:
        """Extract section structure from LaTeX template"""
        import re
        sections = []
        
        # Find all section commands
        section_pattern = r'\\(section|subsection|subsubsection)\{([^}]+)\}'
        matches = re.finditer(section_pattern, template_content)
        
        section_id = 0
        subsection_id = 0
        subsubsection_id = 0
        current_section = None
        current_subsection = None
        
        for match in matches:
            level = match.group(1)
            name = match.group(2).strip()
            
            if level == 'section':
                section_id += 1
                subsection_id = 0
                subsubsection_id = 0
                current_section = {
                    'id': str(section_id),
                    'name': name,
                    'key_points': [f'Content for {name}'],
                    'search_queries': [f'{name}'],
                    'percentage': 0,  # Will be calculated later
                    'subsections': []
                }
                sections.append(current_section)
                current_subsection = None
                
            elif level == 'subsection' and current_section:
                subsection_id += 1
                subsubsection_id = 0
                current_subsection = {
                    'id': f'{section_id}.{subsection_id}',
                    'name': name,
                    'key_points': [f'Content for {name}'],
                    'search_queries': [f'{name}'],
                    'percentage': 0,
                    'subsections': []
                }
                current_section['subsections'].append(current_subsection)
                
            elif level == 'subsubsection' and current_subsection:
                subsubsection_id += 1
                subsubsub = {
                    'id': f'{section_id}.{subsection_id}.{subsubsection_id}',
                    'name': name,
                    'key_points': [f'Content for {name}'],
                    'search_queries': [f'{name}'],
                    'percentage': 0,
                    'subsections': []
                }
                current_subsection['subsections'].append(subsubsub)
        
        # Calculate percentages based on number of sections
        if sections:
            base_percentage = 100.0 / len(sections)
            for section in sections:
                section['percentage'] = base_percentage
        
        return sections
    
    # agents/planner.py

    def _infer_document_mode(self, topic: str, description: str) -> str:
        text = f"{topic}\n{description}".lower()
        if any(k in text for k in ["slide", "presentation", "powerpoint", "deck", "beamer"]):
            return "slides"
        if any(k in text for k in ["cv", "resume", "curriculum vitae"]):
            return "cv"
        if any(k in text for k in ["invoice", "billing", "quotation"]):
            return "invoice"
        if any(k in text for k in ["cover letter", "motivation letter", "recommendation letter", "letter"]):
            return "letter"
        if any(k in text for k in ["proposal", "grant"]):
            return "proposal"
        if any(k in text for k in ["report", "financial", "technical", "business report", "audit"]):
            return "report"
        if any(k in text for k in ["specification", "manual", "design doc", "architecture", "api"]):
            return "technical"
        return "article"

    async def plan_structure(self, topic: str, description: str, template_sections: Optional[List[Dict]] = None) -> dict:
        """Plan structure for a general-purpose LaTeX document."""

        print(f"[PLANNER] Planning structure for: {topic} (document-first mode)")

        # If template sections are provided, use them directly
        if template_sections and len(template_sections) > 0:
            print(f"📋 Using template structure with {len(template_sections)} sections")
            return await self._create_plan_from_template(topic, template_sections)

        document_mode = self._infer_document_mode(topic, description)
        base_prompt = f"""You are an expert document planner for LaTeX generation.

    Topic: {{topic}}
    Description: {{description}}
    Detected document mode: {document_mode}

    === STRUCTURE GUIDELINES ===
    Build a practical structure for the requested document type and user intent.
    Keep structure specific, usable, and easy to compile in LaTeX.

    - For reports/technical/business docs: include goal-oriented sections (e.g., executive summary, scope, method, findings, recommendations).
    - For slides: create concise slide sections with clear progression and short key points.
    - For CV/resume: include profile, experience, education, skills, projects/publications as relevant.
    - For letters: include context, purpose, core points, and closing.
    - For invoices/proposals: include required transactional fields and summary blocks.
    - For generic articles/documents: use a coherent intro-body-conclusion structure.

    SECTION ALLOCATION:
    - Allocate percentages by practical importance (sum must be 100%).
    - Avoid research-only structures unless user explicitly asks for research-paper style.

    INTERPRETATION GUIDELINES:
    - Prefer the user's explicit request over assumptions.
    - If details are missing, create a safe default structure that can be refined later.
    - Keep section names domain-appropriate and actionable."""

        # Add special instructions if provided
        if self.special_instructions:
            base_prompt += f"""

    SPECIAL FORMATTING/STYLE REQUIREMENTS:
    {self.special_instructions}

    IMPORTANT: Consider these requirements when planning the structure."""

        if self.image_context:
            base_prompt += f"""

    AVAILABLE IMAGE ASSETS:
    {self.image_context}

    IMPORTANT: Plan sections to place these images logically within the paper."""

        base_prompt += """

    Create a JSON structure with:
    1. Title (clear and professional)
    2. Sections with:
       - id (e.g., "1", "2", "3")
       - name (appropriate for the detected document mode)
       - percentage of total document (must sum to 100%)
       - key_points (list of concrete content requirements)
       - search_queries (short helper queries that can enrich content if needed)
       - subsections (optional, can be nested for complex documents)

    There is no fixed template - use your expertise to create the best structure for this document.

    IMPORTANT: Return ONLY the JSON object, no markdown, no explanations, no code blocks.

    Example format:
    {{
    "title": "Paper Title Here",
    "sections": [
        {{
        "id": "1",
        "name": "Your Section Name",
        "percentage": 15,
        "key_points": ["point1", "point2"],
        "search_queries": ["query1", "query2"],
        "subsections": []
        }}
    ]
    }}"""

        template = PromptTemplate(
            template=base_prompt,
            input_variables=["topic", "description"]
        )

        chain = template | self.llm

        response = await chain.ainvoke({
            "topic": topic,
            "description": description
        })
        
        content = response.content
        
        # Clean up the response - remove markdown code blocks and extra text
        content = content.strip()
        
        # Remove markdown code blocks if present
        if content.startswith("```json"):
            content = content[7:]  # Remove ```json
        elif content.startswith("```"):
            content = content[3:]  # Remove ```
        
        if content.endswith("```"):
            content = content[:-3]  # Remove trailing ```
        
        content = content.strip()
        
        # Find the JSON object (starts with { and ends with })
        start_idx = content.find('{')
        end_idx = content.rfind('}')
        
        if start_idx == -1 or end_idx == -1:
            raise ValueError("No valid JSON object found in response")
        
        content = content[start_idx:end_idx+1]
        
        try:
            # Additional JSON cleaning
            content = self._clean_json_content(content)
            plan = json.loads(content)
        except json.JSONDecodeError as e:
            print("Failed to parse JSON. Raw content:")
            print(f"Content length: {len(content)}")
            print(f"Content: {repr(content)}")
            print(f"JSON Error: {str(e)}")
            
            # Try to create a fallback plan
            print("Creating fallback plan...")
            plan = self._create_fallback_plan(topic, description)
        except Exception as e:
            print(f"Unexpected error in JSON parsing: {str(e)}")
            print("Creating fallback plan...")
            plan = self._create_fallback_plan(topic, description)
        
        # Validate the plan structure
        required_keys = ['title', 'sections']
        if not all(key in plan for key in required_keys):
            raise ValueError(f"Plan missing required keys. Has: {plan.keys()}")

        # Log the AI-determined structure
        print(f"[PLANNER] AI planned {len(plan['sections'])} sections")
        for section in plan['sections']:
            section_name = section.get('name', 'Unknown')
            pct = section.get('percentage', 0)
            print(f"[PLANNER]   - {section_name} ({pct}%)")

        return plan
    
    async def _create_plan_from_template(self, topic: str, template_sections: List[Dict]) -> dict:
        """Create plan using template STRUCTURE (not content) - Generate appropriate section names for topic"""
        # Count the template structure (how many sections, subsections)
        section_count = len(template_sections)
        has_subsections = any(sec.get('subsections') for sec in template_sections)
        
        print(f"📋 Template detected with {section_count} sections")
        print(f"⚠️  NOTE: Using template FORMAT only - generating topic-appropriate section names")
        
        # Now generate a NORMAL plan for the topic, but respect the template's section COUNT
        # This way we get topic-relevant section names but keep the template's structure size
        return await self.plan_structure(topic, f"Generate {section_count} main sections", template_sections=None)
    
    def _clean_json_content(self, content: str) -> str:
        """Clean JSON content to handle common issues"""
        
        # Remove any non-printable characters
        content = ''.join(char for char in content if char.isprintable() or char.isspace())
        
        # Remove any trailing commas before closing braces/brackets
        import re
        content = re.sub(r',(\s*[}\]])', r'\1', content)
        
        # Remove any comments (though JSON shouldn't have them)
        content = re.sub(r'//.*?\n', '', content)
        content = re.sub(r'/\*.*?\*/', '', content, flags=re.DOTALL)
        
        return content.strip()
    
    def _create_fallback_plan(self, topic: str, description: str) -> dict:
        """Create a fallback plan when JSON parsing fails."""
        doc_mode = self._infer_document_mode(topic, description)

        if doc_mode == "slides":
            sections = [
                {
                    "id": "1",
                    "name": "Title and Objective",
                    "percentage": 20,
                    "key_points": ["Presentation objective", "Audience context", "Agenda overview"],
                    "search_queries": [f"{topic} overview slides"],
                    "subsections": []
                },
                {
                    "id": "2",
                    "name": "Core Content",
                    "percentage": 60,
                    "key_points": ["Main points", "Evidence or examples", "Visual explanation cues"],
                    "search_queries": [f"{topic} key points"],
                    "subsections": []
                },
                {
                    "id": "3",
                    "name": "Summary and Next Steps",
                    "percentage": 20,
                    "key_points": ["Takeaways", "Recommended actions", "Closing note"],
                    "search_queries": [f"{topic} summary"],
                    "subsections": []
                }
            ]
        elif doc_mode in {"cv"}:
            sections = [
                {
                    "id": "1",
                    "name": "Profile",
                    "percentage": 15,
                    "key_points": ["Target role", "Professional summary", "Core strengths"],
                    "search_queries": [f"{topic} CV profile"],
                    "subsections": []
                },
                {
                    "id": "2",
                    "name": "Experience",
                    "percentage": 40,
                    "key_points": ["Role history", "Impact metrics", "Relevant achievements"],
                    "search_queries": [f"{topic} experience achievements"],
                    "subsections": []
                },
                {
                    "id": "3",
                    "name": "Education and Skills",
                    "percentage": 30,
                    "key_points": ["Education credentials", "Technical skills", "Tools and methods"],
                    "search_queries": [f"{topic} skills"],
                    "subsections": []
                },
                {
                    "id": "4",
                    "name": "Projects and Additional Information",
                    "percentage": 15,
                    "key_points": ["Selected projects", "Publications/certifications if applicable", "Interests or extras"],
                    "search_queries": [f"{topic} projects portfolio"],
                    "subsections": []
                }
            ]
        elif doc_mode in {"letter"}:
            sections = [
                {
                    "id": "1",
                    "name": "Opening",
                    "percentage": 25,
                    "key_points": ["Recipient context", "Purpose of letter", "Professional tone setup"],
                    "search_queries": [f"{topic} letter opening"],
                    "subsections": []
                },
                {
                    "id": "2",
                    "name": "Main Message",
                    "percentage": 55,
                    "key_points": ["Core points to communicate", "Supporting details", "Requested outcome"],
                    "search_queries": [f"{topic} letter body"],
                    "subsections": []
                },
                {
                    "id": "3",
                    "name": "Closing",
                    "percentage": 20,
                    "key_points": ["Clear call to action", "Polite close", "Signature block"],
                    "search_queries": [f"{topic} letter closing"],
                    "subsections": []
                }
            ]
        else:
            sections = [
                {
                    "id": "1",
                    "name": "Executive Summary",
                    "percentage": 15,
                    "key_points": ["Purpose", "Scope", "Top findings or goals"],
                    "search_queries": [f"{topic} executive summary"],
                    "subsections": []
                },
                {
                    "id": "2",
                    "name": "Background and Context",
                    "percentage": 20,
                    "key_points": ["Context", "Problem or need", "Constraints or assumptions"],
                    "search_queries": [f"{topic} background context"],
                    "subsections": []
                },
                {
                    "id": "3",
                    "name": "Main Analysis",
                    "percentage": 40,
                    "key_points": ["Core content", "Comparisons or data", "Interpretation and implications"],
                    "search_queries": [f"{topic} analysis findings"],
                    "subsections": []
                },
                {
                    "id": "4",
                    "name": "Recommendations",
                    "percentage": 15,
                    "key_points": ["Actionable recommendations", "Implementation considerations", "Risks and mitigations"],
                    "search_queries": [f"{topic} recommendations"],
                    "subsections": []
                },
                {
                    "id": "5",
                    "name": "Conclusion",
                    "percentage": 10,
                    "key_points": ["Key takeaway", "Next steps", "Final statement"],
                    "search_queries": [f"{topic} conclusion"],
                    "subsections": []
                }
            ]

        abstract_points = [
            f"Purpose and scope of {topic}",
            "Main deliverables or findings",
            "Primary takeaway for the target audience"
        ]

        keywords = [topic.lower(), doc_mode, "document", "latex"]

        return {
            "title": f"{topic}",
            "sections": sections,
            "abstract_points": abstract_points,
            "keywords": keywords
        }

    def _calculate_subsection_words(self, subsections: List[Dict], parent_words: int):
        """Recursively calculate word targets for subsections"""
        if not subsections:
            return
        
        total_percentage = sum(s.get('percentage', 0) for s in subsections)
        if total_percentage == 0:
            # Distribute evenly if no percentages
            words_per_section = parent_words // len(subsections)
            for subsection in subsections:
                subsection['target_words'] = words_per_section
        else:
            for subsection in subsections:
                percentage = subsection.get('percentage', 0)
                subsection['target_words'] = int(parent_words * percentage / total_percentage)
                
                # Recurse for nested subsections
                if 'subsections' in subsection and subsection['subsections']:
                    self._calculate_subsection_words(
                        subsection['subsections'], 
                        subsection['target_words']
                    )

    
    def _calculate_word_counts(self, plan: dict, total_words: int) -> dict:
        """Recursively calculate word counts from percentages"""
        
        for section in plan['sections']:
            section_words = int((section['percentage'] / 100.0) * total_words)
            section['target_words'] = section_words
            
            if section.get('subsections'):
                section = self._distribute_words(section, section_words)
        
        return plan
    
    def _distribute_words(self, section: dict, parent_words: int) -> dict:
        """Distribute words to subsections"""

        subsections = section['subsections']
        if not subsections:
            return section

        words_per_sub = parent_words // len(subsections)

        for subsec in subsections:
            subsec['target_words'] = words_per_sub
            if subsec.get('subsections'):
                subsec = self._distribute_words(subsec, words_per_sub)

        return section

    def _redistribute_section_words(self, sections: List[dict], target_total: int) -> List[dict]:
        """Redistribute word allocations to match target exactly"""
        current_total = sum(s.get('target_words', 0) for s in sections)
        if current_total == 0:
            return sections

        scale_factor = target_total / current_total

        redistributed_sections = []
        for section in sections:
            new_section = section.copy()
            current_words = section.get('target_words', 0)
            new_section['target_words'] = int(current_words * scale_factor)
            redistributed_sections.append(new_section)

        # Adjust rounding errors by adding/subtracting from largest section
        difference = target_total - sum(s['target_words'] for s in redistributed_sections)
        if difference != 0 and redistributed_sections:
            largest_section = max(redistributed_sections, key=lambda s: s.get('target_words', 0))
            largest_section['target_words'] += difference
            print(f"[PLANNER] Adjusted {largest_section.get('name', 'Unknown')} by {difference} words for exact match")

        return redistributed_sections
