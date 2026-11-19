"""
Template Selector Service for GenLaTeX

Intelligently selects the best template based on:
- Document type (CV, report, presentation, etc.)
- Style keywords (modern, minimal, creative, etc.)
- Color preferences
- User requirements

Author: GenLaTeX
Date: 2025-02-16
"""

import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


class TemplateSelector:
    """Selects and customizes LaTeX templates based on user requirements"""

    def __init__(self, templates_dir: Optional[Path] = None):
        """
        Initialize template selector

        Args:
            templates_dir: Path to templates directory (default: ../templates)
        """
        if templates_dir is None:
            # Default to genlatex/templates (one level up from genlatex-agent)
            self.templates_dir = Path(__file__).parent.parent.parent / "genlatex" / "templates"
        else:
            self.templates_dir = Path(templates_dir)

        self.template_index = self._load_template_index()
        self.templates_cache = {}

        logger.info(f"Template selector initialized with {len(self._get_all_templates())} templates")

    def _load_template_index(self) -> Dict[str, Any]:
        """Load template index from JSON"""
        index_path = self.templates_dir / "index.json"

        if not index_path.exists():
            logger.warning(f"Template index not found at {index_path}")
            return {"categories": {}, "colorSchemes": {}, "styleKeywords": {}}

        try:
            with open(index_path, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load template index: {e}")
            return {"categories": {}, "colorSchemes": {}, "styleKeywords": {}}

    def _get_all_templates(self) -> List[Dict[str, Any]]:
        """Get all available templates with metadata"""
        templates = []

        for category_dir in self.templates_dir.iterdir():
            if not category_dir.is_dir() or category_dir.name.startswith('.'):
                continue

            # Skip special directories
            if category_dir.name in ['styles', 'assets']:
                continue

            for template_dir in category_dir.iterdir():
                if not template_dir.is_dir():
                    continue

                metadata_path = template_dir / "metadata.json"
                if not metadata_path.exists():
                    continue

                try:
                    with open(metadata_path, 'r', encoding='utf-8') as f:
                        metadata = json.load(f)
                        metadata['path'] = str(template_dir)
                        templates.append(metadata)
                except Exception as e:
                    logger.warning(f"Failed to load template metadata from {metadata_path}: {e}")

        return templates

    def detect_document_type(self, prompt: str) -> str:
        """
        Detect document type from user prompt

        Args:
            prompt: User's prompt/request

        Returns:
            Document category: cv, report, presentation, letter, or article
        """
        prompt_lower = prompt.lower()

        # CV/Resume keywords
        if any(kw in prompt_lower for kw in ['cv', 'resume', 'curriculum vitae', 'curriculum', 'vitae']):
            return 'cv'

        # Presentation keywords
        if any(kw in prompt_lower for kw in ['presentation', 'slides', 'powerpoint', 'beamer', 'slideshow', 'ppt']):
            return 'presentation'

        # Letter keywords
        if any(kw in prompt_lower for kw in ['letter', 'cover letter', 'application', 'correspondence']):
            return 'letter'

        # Report keywords
        if any(kw in prompt_lower for kw in ['report', 'document', 'white paper', 'whitepaper', 'analysis']):
            return 'report'

        # Article/Paper keywords
        if any(kw in prompt_lower for kw in ['paper', 'article', 'publication', 'thesis', 'dissertation']):
            return 'article'

        # Default to article
        return 'article'

    def extract_style_keywords(self, prompt: str) -> List[str]:
        """
        Extract style keywords from prompt

        Args:
            prompt: User's prompt

        Returns:
            List of detected style keywords
        """
        prompt_lower = prompt.lower()
        detected_styles = []

        style_patterns = {
            'modern': r'\b(modern|contemporary|fresh|updated|current)\b',
            'minimal': r'\b(minimal|minimalist|simple|clean|uncluttered)\b',
            'creative': r'\b(creative|unique|artistic|colorful|bold|innovative)\b',
            'corporate': r'\b(corporate|business|professional|formal|enterprise)\b',
            'academic': r'\b(academic|scholarly|research|traditional)\b',
            'elegant': r'\b(elegant|sophisticated|refined|classy|polished)\b'
        }

        for style, pattern in style_patterns.items():
            if re.search(pattern, prompt_lower):
                detected_styles.append(style)

        return detected_styles if detected_styles else ['professional']  # Default

    def extract_color_preference(self, prompt: str) -> Optional[str]:
        """
        Extract color preference from prompt

        Args:
            prompt: User's prompt

        Returns:
            Color name or None
        """
        prompt_lower = prompt.lower()

        color_keywords = {
            'blue': r'\b(blue|navy|azure)\b',
            'purple': r'\b(purple|violet|lavender)\b',
            'green': r'\b(green|emerald|teal)\b',
            'red': r'\b(red|crimson|scarlet)\b',
            'orange': r'\b(orange|amber)\b',
            'gray': r'\b(gray|grey|silver)\b',
            'black': r'\b(black|dark)\b'
        }

        for color, pattern in color_keywords.items():
            if re.search(pattern, prompt_lower):
                return color

        return None

    def rank_templates(
        self,
        templates: List[Dict[str, Any]],
        style_keywords: List[str],
        color_preference: Optional[str] = None
    ) -> List[Tuple[Dict[str, Any], float]]:
        """
        Rank templates by relevance score

        Args:
            templates: List of template metadata
            style_keywords: Detected style keywords
            color_preference: Preferred color scheme

        Returns:
            List of (template, score) tuples, sorted by score descending
        """
        scored_templates = []

        for template in templates:
            score = 0.0

            # Style match (50% weight)
            template_style = template.get('style', '')
            if template_style in style_keywords:
                score += 50.0

            # Tags match (30% weight)
            template_tags = template.get('tags', [])
            matching_tags = set(template_tags) & set(style_keywords)
            score += len(matching_tags) * 10.0

            # Color match (20% weight)
            if color_preference:
                template_color = template.get('colorScheme', '')
                if template_color == color_preference:
                    score += 20.0

            scored_templates.append((template, score))

        # Sort by score descending
        scored_templates.sort(key=lambda x: x[1], reverse=True)

        return scored_templates

    def select_template(
        self,
        prompt: str,
        document_type: Optional[str] = None,
        style_preference: Optional[str] = None,
        color_preference: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Select the best template based on user requirements

        Args:
            prompt: User's prompt/request
            document_type: Explicit document type (or auto-detect)
            style_preference: Explicit style preference
            color_preference: Explicit color preference

        Returns:
            Selected template metadata or None
        """
        # Detect document type if not provided
        if document_type is None:
            document_type = self.detect_document_type(prompt)

        logger.info(f"Selecting template for document type: {document_type}")

        # Get templates for this category
        all_templates = self._get_all_templates()
        category_templates = [t for t in all_templates if t.get('category') == document_type]

        if not category_templates:
            logger.warning(f"No templates found for category: {document_type}")
            return None

        # Extract preferences from prompt if not provided
        if style_preference is None:
            style_keywords = self.extract_style_keywords(prompt)
        else:
            style_keywords = [style_preference]

        if color_preference is None:
            color_preference = self.extract_color_preference(prompt)

        logger.info(f"Style keywords: {style_keywords}, Color: {color_preference}")

        # Rank and select best template
        ranked_templates = self.rank_templates(category_templates, style_keywords, color_preference)

        if not ranked_templates:
            return None

        best_template, best_score = ranked_templates[0]
        logger.info(f"Selected template: {best_template.get('name')} (score: {best_score})")

        return best_template

    def load_template_content(self, template: Dict[str, Any]) -> str:
        """
        Load template LaTeX content

        Args:
            template: Template metadata

        Returns:
            Template LaTeX content
        """
        template_path = Path(template['path']) / 'template.tex'

        if not template_path.exists():
            raise FileNotFoundError(f"Template file not found: {template_path}")

        with open(template_path, 'r', encoding='utf-8') as f:
            return f.read()

    def get_theme_files(self, template: Dict[str, Any]) -> list:
        """
        Get list of theme/style files that need to be copied to project

        Args:
            template: Template metadata

        Returns:
            List of (source_path, dest_path) tuples for files to copy
        """
        template_path = Path(template['path'])
        files_to_copy = []

        # Check for Beamer theme files
        if template['category'] == 'presentation':
            template_id = template.get('id', '')

            # Focus theme files
            if 'focus' in template_id.lower():
                sty_files = [
                    'beamerthemefocus.sty',
                    'beamercolorthemefocus.sty',
                    'beamerfontthemefocus.sty',
                    'beamerinnerthemefocus.sty',
                    'beamerouterthemefocus.sty'
                ]
                for sty_file in sty_files:
                    src = template_path / sty_file
                    if src.exists():
                        files_to_copy.append((str(src), sty_file))

            # Auriga theme files
            elif 'auriga' in template_id.lower():
                sty_files = [
                    'beamerthemeauriga.sty',
                    'beamercolorthemeauriga.sty'
                ]
                for sty_file in sty_files:
                    src = template_path / sty_file
                    if src.exists():
                        files_to_copy.append((str(src), sty_file))

        return files_to_copy

    def customize_template(
        self,
        template_content: str,
        color_scheme: Optional[str] = None,
        custom_colors: Optional[Dict[str, str]] = None
    ) -> str:
        """
        Customize template with colors and other options

        Args:
            template_content: Original template LaTeX
            color_scheme: Named color scheme from index
            custom_colors: Custom RGB color definitions

        Returns:
            Customized template content
        """
        customized = template_content

        # Apply named color scheme
        if color_scheme and color_scheme in self.template_index.get('colorSchemes', {}):
            scheme = self.template_index['colorSchemes'][color_scheme]

            # Convert hex to RGB and inject colors
            for color_name, hex_value in scheme.items():
                if hex_value.startswith('#'):
                    r = int(hex_value[1:3], 16)
                    g = int(hex_value[3:5], 16)
                    b = int(hex_value[5:7], 16)

                    # Replace color definition if exists
                    color_pattern = rf'\\definecolor{{{color_name}}}{{RGB}}{{[^}}]+}}'
                    color_def = f'\\definecolor{{{color_name}}}{{RGB}}{{{r}, {g}, {b}}}'

                    if re.search(color_pattern, customized):
                        customized = re.sub(color_pattern, color_def, customized)

        # Apply custom colors
        if custom_colors:
            for color_name, rgb_value in custom_colors.items():
                color_pattern = rf'\\definecolor{{{color_name}}}{{RGB}}{{[^}}]+}}'
                color_def = f'\\definecolor{{{color_name}}}{{RGB}}{{{rgb_value}}}'

                if re.search(color_pattern, customized):
                    customized = re.sub(color_pattern, color_def, customized)

        return customized

    def fill_template(
        self,
        template_content: str,
        data: Dict[str, Any]
    ) -> str:
        """
        Fill template placeholders with user data

        Args:
            template_content: Template with placeholders like {{NAME}}
            data: Dictionary of data to fill

        Returns:
            Filled template content
        """
        filled = template_content

        # Replace all {{PLACEHOLDER}} with data
        for key, value in data.items():
            placeholder = f'{{{{{key}}}}}'
            filled = filled.replace(placeholder, str(value))

        # Remove any remaining unfilled placeholders (replace with empty string)
        filled = re.sub(r'\{\{[A-Z_]+\}\}', '', filled)

        return filled


# Convenience function for direct use
def select_and_customize_template(
    prompt: str,
    data: Dict[str, Any],
    document_type: Optional[str] = None,
    color_scheme: Optional[str] = None
) -> Optional[str]:
    """
    One-step template selection and customization

    Args:
        prompt: User's request
        data: Data to fill in template
        document_type: Explicit document type (optional)
        color_scheme: Named color scheme (optional)

    Returns:
        Complete LaTeX document or None
    """
    selector = TemplateSelector()

    # Select template
    template = selector.select_template(prompt, document_type=document_type)

    if not template:
        logger.error("No suitable template found")
        return None

    # Load template content
    template_content = selector.load_template_content(template)

    # Customize colors
    if color_scheme:
        template_content = selector.customize_template(template_content, color_scheme=color_scheme)

    # Fill with data
    final_content = selector.fill_template(template_content, data)

    return final_content
