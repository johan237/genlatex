# utils/latex.py
from typing import List, Dict, Optional, Any
from pathlib import Path
import re
import sys
import os
import base64

class LatexGenerator:
    """Generate LaTeX files from paper data"""

    def __init__(self, template_dir: str, memory_manager=None, citation_manager=None, llm=None):
        self.template_dir = Path(template_dir)
        self.memory_manager = memory_manager
        self.citation_manager = citation_manager
        self.llm = llm  # LLM for AI-based template substitution
        self.template_files = None
        self.template_structure = None
        self.special_instructions = None  # Special instructions for LaTeX generation
    
    def set_template_files(self, template_files=None):
        """Set custom template files for this generation session.

        This method accepts template files and finds the main template to use.
        It searches for:
        1. main.tex (case-insensitive)
        2. Any other .tex file if main.tex is not found

        The found template is normalized to 'main.tex' key for consistent access.
        """
        self.template_files = template_files
        if template_files:
            print(f"ðŸ“‹ LaTeX generator received {len(template_files)} template files: {list(template_files.keys())}")

            # Step 1: Case-insensitive lookup for main.tex
            main_tex_key = None
            for key in template_files.keys():
                if key.lower() == 'main.tex':
                    main_tex_key = key
                    break

            # Step 2: If no main.tex, find ANY .tex file
            if not main_tex_key:
                tex_files = [key for key in template_files.keys() if key.lower().endswith('.tex')]
                if tex_files:
                    # Prefer files with common template names
                    preferred_names = ['template.tex', 'paper.tex', 'document.tex', 'article.tex']
                    for preferred in preferred_names:
                        for tex_file in tex_files:
                            if tex_file.lower() == preferred:
                                main_tex_key = tex_file
                                print(f"ðŸ“‹ Found template file: '{main_tex_key}' (preferred name match)")
                                break
                        if main_tex_key:
                            break

                    # If still not found, use the first .tex file
                    if not main_tex_key:
                        main_tex_key = tex_files[0]
                        print(f"ðŸ“‹ Using first .tex file as template: '{main_tex_key}'")

            if main_tex_key:
                # Normalize to 'main.tex' key for consistent access
                if main_tex_key != 'main.tex':
                    template_files['main.tex'] = template_files[main_tex_key]
                    print(f"ðŸ“‹ Normalized '{main_tex_key}' â†’ 'main.tex'")

                # Validate that the content looks like a LaTeX template
                content = self._template_payload_as_text('main.tex', template_files['main.tex'])
                if content is None:
                    print("[WARN]  main.tex payload could not be decoded as text")
                    self.template_structure = None
                    return
                template_files['main.tex'] = content
                if '\\documentclass' in content or '\\begin{document}' in content:
                    print(f"[OK] Parsing user-defined template structure from {main_tex_key} ({len(content)} chars)")
                    self.template_structure = self._parse_template_structure(content)
                    print(f"[OK] Template structure parsed: style={self.template_structure.get('template_style', 'unknown')}")
                else:
                    print(f"[WARN]  File '{main_tex_key}' doesn't appear to be a valid LaTeX template (no \\documentclass found)")
                    print(f"   Content preview: {content[:200]}...")
                    self.template_structure = None

            else:
                print(f"âš ï¸  Template files received but no .tex files found! Available: {list(template_files.keys())}")
                self.template_structure = None
        else:
            print("âš ï¸  No template files provided to LaTeX generator")
            self.template_structure = None
    
    def set_special_instructions(self, instructions: Optional[str]):
        """Set special instructions to be applied during LaTeX generation"""
        self.special_instructions = instructions
        if instructions:
            print(f"ðŸ“ LaTeX generator received special instructions ({len(instructions)} chars)")
        else:
            print("ðŸ“ LaTeX generator: No special instructions provided")

    @staticmethod
    def _decode_template_base64(payload: Any) -> Optional[bytes]:
        if not isinstance(payload, dict):
            return None
        encoding = str(payload.get("__encoding") or payload.get("encoding") or "").lower()
        if encoding != "base64":
            return None
        raw = payload.get("data")
        if raw is None:
            raw = payload.get("content")
        if raw is None:
            return None
        try:
            return base64.b64decode(str(raw))
        except Exception:
            return None

    @classmethod
    def _template_payload_as_text(cls, filename: str, payload: Any) -> Optional[str]:
        if isinstance(payload, str):
            return payload
        if isinstance(payload, (bytes, bytearray)):
            return bytes(payload).decode("utf-8", errors="ignore")
        decoded = cls._decode_template_base64(payload)
        if decoded is not None:
            return decoded.decode("utf-8", errors="ignore")
        print(f"âš ï¸  Unsupported text payload type for template file: {filename}")
        return None

    @classmethod
    def _template_payload_as_bytes(cls, payload: Any) -> Optional[bytes]:
        if isinstance(payload, (bytes, bytearray)):
            return bytes(payload)
        decoded = cls._decode_template_base64(payload)
        if decoded is not None:
            return decoded
        if isinstance(payload, str):
            return payload.encode("utf-8", errors="ignore")
        return None

    @staticmethod
    def normalize_support_file_content(filename: str, content: str) -> str:
        """Normalize template support files to avoid double-spaced line endings."""
        if not isinstance(content, str):
            return content
        ext = Path(filename).suffix.lower()
        support_exts = {'.sty', '.cls', '.bst', '.bib', '.def', '.fd', '.cfg'}
        if ext not in support_exts:
            return content
        normalized = content.replace('\r\n', '\n').replace('\r', '\n')
        lines = normalized.split('\n')
        if not lines:
            return normalized
        blank = sum(1 for line in lines if not line.strip())
        non_blank = len(lines) - blank
        if non_blank and blank >= non_blank * 0.7:
            collapsed = []
            prev_blank = False
            for line in lines:
                is_blank = not line.strip()
                if is_blank and prev_blank:
                    continue
                collapsed.append(line)
                prev_blank = is_blank
            normalized = '\n'.join(collapsed)
        return normalized

    @staticmethod
    def is_valid_support_file_content(filename: str, content: str) -> bool:
        """Validate that support file content is appropriate for its file type.

        Prevents document content (e.g. main.tex) from being written as .cls or .sty files,
        which causes LaTeX compilation errors (e.g. 'Two \\documentclass commands').

        Only rejects if \\documentclass or \\begin{document} appears on a non-comment line
        (avoids false positives for valid files with these strings in comments).
        """
        if not isinstance(content, str) or not content.strip():
            return True  # Let other validation handle empty content
        ext = Path(filename).suffix.lower()
        if ext not in ('.cls', '.sty'):
            return True
        lines = content[:4000].split('\n')
        for line in lines:
            stripped = line.strip()
            if not stripped:
                continue
            if stripped.startswith('%'):
                continue  # skip comment lines - user's valid file may document usage
            if '\\documentclass' in stripped or '\\begin{document}' in stripped:
                return False
        return True

    def _parse_template_structure(self, template_content):
        """Parse template to extract complete structure including all formatting elements

        This method performs comprehensive extraction of:
        - Document class with all options
        - All packages with their options
        - Custom commands (\\newcommand, \\renewcommand, \\def, etc.)
        - Custom environments (\\newenvironment, \\renewenvironment)
        - Math operators (\\DeclareMathOperator)
        - \\input and \\include file dependencies
        - Required class/style files (.cls, .sty, .bst)
        - Bibliography configuration
        - Page layout and font settings
        - Template style detection
        """
        structure = {
            'documentclass': None,
            'packages': [],
            'preamble': '',
            'has_bibliography': False,
            'citation_style': None,
            'citation_system': None,  # 'biblatex' or 'bibtex'
            'custom_commands': [],
            'custom_environments': [],
            'math_operators': [],
            'input_files': [],         # Files referenced via \input
            'include_files': [],       # Files referenced via \include
            'required_class_files': [],  # .cls files needed
            'required_style_files': [],  # .sty files needed
            'required_bst_files': [],    # .bst files needed
            'required_bib_files': [],    # .bib files referenced
            'page_layout': {},
            'font_settings': {},
            'template_style': 'standard',  # 'ieee', 'acm', 'standard', 'custom'
            'title_format': None,
            'author_format': None,
            'abstract_format': None,
            'section_format': None,
            'tikz_libraries': [],       # TikZ libraries loaded
            'color_definitions': [],    # Custom colors defined
        }
        
        # Extract document class with full options
        doc_class_match = re.search(r'\\documentclass\s*(?:\[(.*?)\])?\s*\{(.*?)\}', template_content)
        if doc_class_match:
            options_str = doc_class_match.group(1) if doc_class_match.group(1) else ''
            class_name = doc_class_match.group(2).strip()
            structure['documentclass'] = {
                'options': [opt.strip() for opt in options_str.split(',')] if options_str else [],
                'class': class_name,
                'full_command': doc_class_match.group(0)
            }
            # Track if this is a custom class file that might need to be included
            if class_name not in ['article', 'report', 'book', 'letter', 'beamer', 'memoir', 'scrartcl', 'scrbook', 'scrreprt']:
                structure['required_class_files'].append(f"{class_name}.cls")
        
        # Extract all packages with full options (preserve exact format)
        # Handle both single package and multiple packages in one usepackage
        package_matches = re.findall(r'\\usepackage\s*(?:\[(.*?)\])?\s*\{([^}]+)\}', template_content)
        for opts, pkg_list in package_matches:
            # Split multiple packages (e.g., \usepackage{amsmath,amssymb})
            packages = [p.strip() for p in pkg_list.split(',')]
            for pkg in packages:
                if not pkg:
                    continue
                pkg_info = {
                    'name': pkg,
                    'options': [opt.strip() for opt in opts.split(',')] if opts else [],
                    'full_command': f"\\usepackage[{opts}]{{{pkg}}}" if opts else f"\\usepackage{{{pkg}}}"
                }
                structure['packages'].append(pkg_info)

                # Track custom style files that aren't standard LaTeX packages
                # Common LaTeX packages that don't need external files
                standard_packages = {
                    'amsmath', 'amssymb', 'amsfonts', 'amsthm', 'graphicx', 'graphics',
                    'hyperref', 'url', 'inputenc', 'fontenc', 'babel', 'geometry',
                    'color', 'xcolor', 'listings', 'verbatim', 'fancyhdr', 'fancyvrb',
                    'float', 'caption', 'subcaption', 'booktabs', 'array', 'tabularx',
                    'longtable', 'multirow', 'multicol', 'enumerate', 'enumitem',
                    'tikz', 'pgfplots', 'algorithm', 'algorithmic', 'algpseudocode',
                    'natbib', 'biblatex', 'cite', 'times', 'mathptmx', 'helvet',
                    'courier', 'lmodern', 'microtype', 'setspace', 'parskip',
                    'titlesec', 'tocloft', 'appendix', 'lastpage', 'lipsum',
                    'blindtext', 'siunitx', 'textcomp', 'gensymb', 'soul', 'ulem',
                    'xspace', 'etoolbox', 'ifthen', 'calc', 'fp', 'pgf', 'pdfpages',
                    'pdflscape', 'rotating', 'wrapfig', 'subfig', 'subfigure',
                    'authblk', 'abstract', 'titling', 'footmisc', 'endnotes',
                    'csquotes', 'datetime', 'datetime2', 'comment', 'todonotes',
                    'cleveref', 'nameref', 'varioref', 'placeins', 'afterpage',
                }
                if pkg.lower() not in standard_packages:
                    structure['required_style_files'].append(f"{pkg}.sty")

                # Check if biblatex is used
                if pkg == 'biblatex':
                    structure['citation_system'] = 'biblatex'
                    # Extract biblatex style from options
                    if opts:
                        # Look for style=... in options
                        style_match = re.search(r'style=([^,\]]+)', opts)
                        if style_match:
                            structure['citation_style'] = style_match.group(1).strip()
                        # Common biblatex styles
                        elif 'ieee' in opts.lower():
                            structure['citation_style'] = 'ieee'
                        elif 'apa' in opts.lower():
                            structure['citation_style'] = 'apa'
                        elif 'chicago' in opts.lower():
                            structure['citation_style'] = 'chicago'
                        elif 'authoryear' in opts.lower():
                            structure['citation_style'] = 'authoryear'
                        elif 'numeric' in opts.lower():
                            structure['citation_style'] = 'numeric'

                # Track TikZ libraries
                if pkg == 'tikz':
                    tikz_lib_matches = re.findall(r'\\usetikzlibrary\s*\{([^}]+)\}', template_content)
                    for libs in tikz_lib_matches:
                        structure['tikz_libraries'].extend([l.strip() for l in libs.split(',')])
        
        # Extract complete preamble (everything before \begin{document})
        begin_doc_match = re.search(r'\\begin\{document\}', template_content)
        if begin_doc_match:
            structure['preamble'] = template_content[:begin_doc_match.start()].strip()
        else:
            # If no \begin{document} found, assume entire content is preamble
            structure['preamble'] = template_content.strip()
        
        # Extract custom commands and definitions with full definition
        # Match \newcommand, \renewcommand, \providecommand with arguments
        cmd_pattern = r'(\\(?:newcommand|renewcommand|providecommand)\*?\s*(?:\{\\?[a-zA-Z@]+\}|\\[a-zA-Z@]+)\s*(?:\[\d+\])?\s*(?:\[[^\]]*\])?\s*\{)'
        for match in re.finditer(cmd_pattern, template_content):
            start = match.start()
            # Find the full command including body with balanced braces
            depth = 0
            i = match.end() - 1  # Start at the opening brace
            while i < len(template_content):
                if template_content[i] == '{':
                    depth += 1
                elif template_content[i] == '}':
                    depth -= 1
                    if depth == 0:
                        full_cmd = template_content[start:i+1]
                        # Extract command name
                        name_match = re.search(r'\\(?:newcommand|renewcommand|providecommand)\*?\s*\{?(\\[a-zA-Z@]+)', full_cmd)
                        if name_match:
                            structure['custom_commands'].append({
                                'name': name_match.group(1),
                                'full_definition': full_cmd
                            })
                        break
                i += 1

        # Extract \def commands
        def_pattern = r'(\\def\s*\\[a-zA-Z@]+\s*(?:#\d)*\s*\{)'
        for match in re.finditer(def_pattern, template_content):
            start = match.start()
            depth = 0
            i = match.end() - 1
            while i < len(template_content):
                if template_content[i] == '{':
                    depth += 1
                elif template_content[i] == '}':
                    depth -= 1
                    if depth == 0:
                        full_cmd = template_content[start:i+1]
                        name_match = re.search(r'\\def\s*(\\[a-zA-Z@]+)', full_cmd)
                        if name_match:
                            structure['custom_commands'].append({
                                'name': name_match.group(1),
                                'full_definition': full_cmd
                            })
                        break
                i += 1

        # Extract DeclareMathOperator
        math_op_matches = re.findall(r'(\\DeclareMathOperator\*?\s*\{(\\[a-zA-Z]+)\}\s*\{[^}]*\})', template_content)
        for full_def, name in math_op_matches:
            structure['math_operators'].append({
                'name': name,
                'full_definition': full_def
            })

        # Extract custom environments
        env_pattern = r'(\\(?:newenvironment|renewenvironment)\s*\{([a-zA-Z]+)\})'
        for match in re.finditer(env_pattern, template_content):
            env_name = match.group(2)
            # Get the full environment definition (can be complex with multiple braced groups)
            start = match.start()
            # Find 3 balanced brace groups for \newenvironment{name}{begin}{end}
            brace_count = 0
            i = match.end()
            groups_found = 0
            while i < len(template_content) and groups_found < 2:
                if template_content[i] == '{':
                    if brace_count == 0:
                        groups_found += 0  # Just entering a group
                    brace_count += 1
                elif template_content[i] == '}':
                    brace_count -= 1
                    if brace_count == 0:
                        groups_found += 1
                i += 1
            full_def = template_content[start:i]
            structure['custom_environments'].append({
                'name': env_name,
                'full_definition': full_def
            })

        # Extract color definitions
        color_def_matches = re.findall(r'(\\definecolor\s*\{([^}]+)\}\s*\{[^}]+\}\s*\{[^}]+\})', template_content)
        for full_def, color_name in color_def_matches:
            structure['color_definitions'].append({
                'name': color_name,
                'full_definition': full_def
            })

        # Extract \input and \include files
        input_matches = re.findall(r'\\input\s*\{([^}]+)\}', template_content)
        for input_file in input_matches:
            input_file = input_file.strip()
            # Add .tex extension if not present
            if not input_file.endswith('.tex') and '.' not in input_file:
                input_file += '.tex'
            structure['input_files'].append(input_file)

        include_matches = re.findall(r'\\include\s*\{([^}]+)\}', template_content)
        for include_file in include_matches:
            include_file = include_file.strip()
            # \include automatically adds .tex
            if not include_file.endswith('.tex'):
                include_file += '.tex'
            structure['include_files'].append(include_file)
        
        # Extract page layout settings
        geometry_match = re.search(r'\\geometry\s*(?:\[(.*?)\])', template_content)
        if geometry_match:
            structure['page_layout']['geometry'] = geometry_match.group(1)
        
        pagestyle_match = re.search(r'\\pagestyle\s*\{(.*?)\}', template_content)
        if pagestyle_match:
            structure['page_layout']['pagestyle'] = pagestyle_match.group(1)
        
        # Extract font settings
        font_family_match = re.search(r'\\fontfamily\s*\{(.*?)\}', template_content)
        if font_family_match:
            structure['font_settings']['family'] = font_family_match.group(1)
        
        # Detect template style
        template_lower = template_content.lower()
        if 'ieeetran' in template_lower or r'\IEEEauthorblockN' in template_content:
            structure['template_style'] = 'ieee'
        elif 'acm' in template_lower or 'acmart' in template_lower:
            structure['template_style'] = 'acm'
        elif 'elsarticle' in template_lower:
            structure['template_style'] = 'elsarticle'
        else:
            structure['template_style'] = 'standard'
        
        # Extract title format pattern
        title_match = re.search(r'\\title\s*(\[.*?\])?\s*\{(.*?)\}', template_content, re.DOTALL)
        if title_match:
            structure['title_format'] = title_match.group(0)
        
        # Extract author format pattern (handle various formats)
        if r'\IEEEauthorblockN' in template_content:
            # IEEE format
            author_match = re.search(r'\\author\s*\{(.*?)\}', template_content, re.DOTALL)
            if author_match:
                structure['author_format'] = 'ieee'
        elif r'\author{' in template_content or r'\author[' in template_content:
            # Standard format - capture the full author command
            author_match = re.search(r'\\author\s*(\[.*?\])?\s*\{(.*?)\}', template_content, re.DOTALL)
            if author_match:
                structure['author_format'] = author_match.group(0)
        # If no author found, that's fine - template might not have one yet
        
        # Extract abstract format
        abstract_match = re.search(r'\\begin\{abstract\}(.*?)\\end\{abstract\}', template_content, re.DOTALL)
        if abstract_match:
            structure['abstract_format'] = 'standard'
        elif r'\begin{IEEEkeywords}' in template_content:
            structure['abstract_format'] = 'ieee'
        
        # Extract section formatting (check for custom section commands)
        if r'\section*' in template_content:
            structure['section_format'] = 'starred'
        else:
            structure['section_format'] = 'numbered'
        
        # Check if template has existing sections
        section_regex = r'\\(section|subsection|subsubsection)\s*\{'
        has_sections = bool(re.search(section_regex, template_content))
        structure['has_sections'] = has_sections
        
        # Check for bibliography and extract citation style
        if r'\bibliography{' in template_content or r'\begin{thebibliography}' in template_content:
            structure['has_bibliography'] = True
            structure['citation_system'] = 'bibtex'

            # Extract \bibliography{...} to find .bib files
            bib_match = re.search(r'\\bibliography\{([^}]+)\}', template_content)
            if bib_match:
                bib_files = [b.strip() for b in bib_match.group(1).split(',')]
                for bib_file in bib_files:
                    if not bib_file.endswith('.bib'):
                        bib_file += '.bib'
                    structure['required_bib_files'].append(bib_file)

            # Extract \bibliographystyle{...}
            bibstyle_match = re.search(r'\\bibliographystyle\{([^}]+)\}', template_content)
            if bibstyle_match:
                style = bibstyle_match.group(1).strip()
                structure['citation_style'] = style
                # Track non-standard .bst files
                standard_bst = {'plain', 'abbrv', 'alpha', 'unsrt', 'acm', 'ieeetr', 'siam', 'apalike', 'apa'}
                if style.lower() not in standard_bst:
                    structure['required_bst_files'].append(f"{style}.bst")
            else:
                # Try to infer from document class or packages
                doc_class = structure.get('documentclass', {}).get('class', '')
                if 'IEEEtran' in doc_class or 'ieee' in template_content.lower():
                    structure['citation_style'] = 'IEEEtran'
                    structure['required_bst_files'].append('IEEEtran.bst')
                elif 'acm' in template_content.lower():
                    structure['citation_style'] = 'ACM-Reference-Format'
                    structure['required_bst_files'].append('ACM-Reference-Format.bst')
                elif 'elsarticle' in template_content.lower():
                    structure['citation_style'] = 'elsarticle-num'
                    structure['required_bst_files'].append('elsarticle-num.bst')
                else:
                    structure['citation_style'] = 'plain'  # Default

        # Check for biblatex \printbibliography
        if r'\printbibliography' in template_content:
            structure['has_bibliography'] = True
            if not structure['citation_system']:
                structure['citation_system'] = 'biblatex'

        # Extract \addbibresource for biblatex
        addbib_matches = re.findall(r'\\addbibresource\s*\{([^}]+)\}', template_content)
        for bib_file in addbib_matches:
            bib_file = bib_file.strip()
            if not bib_file.endswith('.bib'):
                bib_file += '.bib'
            structure['required_bib_files'].append(bib_file)
            structure['has_bibliography'] = True
            structure['citation_system'] = 'biblatex'

        # Default citation style if not found
        if not structure['citation_style']:
            structure['citation_style'] = 'plain'  # Default fallback

        # Remove duplicates from file lists
        structure['required_class_files'] = list(set(structure['required_class_files']))
        structure['required_style_files'] = list(set(structure['required_style_files']))
        structure['required_bst_files'] = list(set(structure['required_bst_files']))
        structure['required_bib_files'] = list(set(structure['required_bib_files']))
        structure['input_files'] = list(set(structure['input_files']))
        structure['include_files'] = list(set(structure['include_files']))

        # Log extracted dependencies
        all_deps = (
            structure['required_class_files'] +
            structure['required_style_files'] +
            structure['required_bst_files'] +
            structure['required_bib_files'] +
            structure['input_files'] +
            structure['include_files']
        )
        if all_deps:
            print(f"ðŸ“‹ Template dependencies detected:")
            if structure['required_class_files']:
                print(f"   Class files: {structure['required_class_files']}")
            if structure['required_style_files']:
                print(f"   Style files: {structure['required_style_files']}")
            if structure['required_bst_files']:
                print(f"   BST files: {structure['required_bst_files']}")
            if structure['required_bib_files']:
                print(f"   BIB files: {structure['required_bib_files']}")
            if structure['input_files']:
                print(f"   Input files: {structure['input_files']}")
            if structure['include_files']:
                print(f"   Include files: {structure['include_files']}")
        if structure['custom_commands']:
            print(f"   Custom commands: {len(structure['custom_commands'])} defined")
        if structure['custom_environments']:
            print(f"   Custom environments: {len(structure['custom_environments'])} defined")

        return structure
    
    def _clean_markdown_code_blocks(self, content: str) -> str:
        """Remove markdown code blocks (```latex, ```tex, ```) from content"""
        # FIX: Removed redundant 'import re' - already imported at module level
        # Remove opening code fence (```latex, ```tex, ``` at start)
        content = re.sub(r'^```(?:latex|tex)?\s*\n', '', content, flags=re.MULTILINE)
        # Remove closing code fence (``` at end)
        content = re.sub(r'\n```\s*$', '', content, flags=re.MULTILINE)
        # Remove any remaining code fences in the middle
        content = re.sub(r'```(?:latex|tex)?\s*\n', '', content)
        content = re.sub(r'\n```', '', content)
        # Also handle triple single quotes ('''latex)
        content = re.sub(r"^'''(?:latex|tex)?\s*\n", '', content, flags=re.MULTILINE)
        content = re.sub(r"\n'''\s*$", '', content, flags=re.MULTILINE)
        content = re.sub(r"'''(?:latex|tex)?\s*\n", '', content)
        content = re.sub(r"\n'''", '', content)
        return content.strip()

    def _ensure_package(self, latex_content: str, package: str) -> str:
        """Ensure a \\usepackage{...} line exists in the preamble."""
        if not latex_content:
            return latex_content
        pkg_pattern = re.compile(rf"\\usepackage(?:\[[^\]]*\])?\{{{re.escape(package)}\}}")
        if pkg_pattern.search(latex_content):
            return latex_content

        docclass_match = re.search(r"\\documentclass[^\n]*\n", latex_content)
        insert_at = docclass_match.end() if docclass_match else 0
        insert_line = f"\\usepackage{{{package}}}\n"
        return latex_content[:insert_at] + insert_line + latex_content[insert_at:]
    
    def _apply_special_instructions_to_latex(self, latex_content: str, paper_data: dict) -> str:
        """Apply special instructions to LaTeX document using AI
        
        This method uses the LLM to interpret special instructions and modify
        the LaTeX document accordingly (preamble, packages, structure, formatting).
        
        Args:
            latex_content: The generated LaTeX document
            paper_data: Paper data dictionary (title/name, abstract, sections, etc.)
                       Can be either paper_data (from generation) or project_data (from files)
        
        Returns:
            Modified LaTeX content with special instructions applied
        """
        if not self.special_instructions or not self.llm:
            return latex_content
        
        try:
            from langchain.prompts import ChatPromptTemplate
            
            print(f"ðŸ“ Applying special instructions to LaTeX document...")
            
            system_prompt = """You are a LaTeX expert. Your task is to modify a LaTeX document according to special instructions provided by the user.

CRITICAL RULES:
1. Interpret the special instructions and apply them to the LaTeX document
2. You may need to:
   - Add or modify packages in the preamble
   - Change document class or its options
   - Modify formatting, layout, or structure
   - Add custom commands or environments
   - Adjust citation style or bibliography settings
   - Apply specific formatting requirements
3. Preserve all existing content (title, abstract, sections, bibliography)
4. Only modify the preamble, document class, packages, and formatting - do NOT change the actual content
5. Return ONLY the complete modified LaTeX document, no explanations
6. Ensure the document is valid LaTeX that will compile correctly"""
            
            # Extract title/name and abstract from paper_data (handle both formats)
            title = paper_data.get('title') or paper_data.get('name', '')
            abstract = paper_data.get('abstract') or paper_data.get('description', '')
            num_sections = len(paper_data.get('sections', []))
            
            prompt = ChatPromptTemplate.from_messages([
                ("system", system_prompt),
                ("user", """Current LaTeX Document:
{latex}

Special Instructions:
{instructions}

Paper Information:
- Title: {title}
- Abstract: {abstract}
- Sections: {num_sections} sections

Apply the special instructions to modify the LaTeX document. Focus on:
- Preamble (document class, packages, custom commands)
- Document structure and formatting
- Layout and styling requirements

Return the complete modified LaTeX document.""")
            ])
            
            chain = prompt | self.llm
            response = chain.invoke({
                "latex": latex_content,
                "instructions": self.special_instructions,
                "title": title,
                "abstract": abstract[:500] if abstract else '',
                "num_sections": num_sections
            })
            
            result = response.content if hasattr(response, 'content') else str(response)
            
            # Clean markdown code blocks if present
            result = self._clean_markdown_code_blocks(result)
            
            if result and result.strip():
                print(f"âœ… Special instructions applied successfully")
                return result.strip()
            else:
                print(f"âš ï¸  Special instructions application returned empty, using original LaTeX")
                return latex_content
            
        except Exception as e:
            print(f"âš ï¸  Failed to apply special instructions: {e}")
            import traceback
            traceback.print_exc()
            # Return original content on error
            return latex_content
    
    def generate_paper(self, paper_data: dict, output_dir: Optional[Path] = None) -> dict:
        """Generate complete LaTeX files with support for custom templates

        This method:
        1. Validates the template (if provided)
        2. Generates main.tex using the template structure
        3. Generates references.bib from citations
        4. Copies/creates all required support files (.sty, .cls, .bst, etc.)

        Args:
            paper_data: Dictionary containing paper data (title, abstract, sections, etc.)
            output_dir: Optional output directory path to copy support files to

        Returns:
            Dictionary with 'main.tex', 'references.bib', and any additional support files
        """

        # CRITICAL: Verify template files are still set before generation
        if self.template_files:
            print(f"ðŸ” Pre-generation check: Template files present: {list(self.template_files.keys())}")
            if 'main.tex' in self.template_files:
                main_tex_preview = self._template_payload_as_text('main.tex', self.template_files['main.tex']) or ''
                print(f"âœ… Pre-generation check: main.tex confirmed ({len(main_tex_preview)} chars)")

                # Validate template and log any issues
                validation = self.validate_template()
                if validation['errors']:
                    print(f"âŒ Template validation errors:")
                    for error in validation['errors']:
                        print(f"   - {error}")
                if validation['warnings']:
                    print(f"âš ï¸  Template validation warnings:")
                    for warning in validation['warnings']:
                        print(f"   - {warning}")
                if validation['suggestions']:
                    print(f"ðŸ’¡ Suggestions:")
                    for suggestion in validation['suggestions']:
                        print(f"   - {suggestion}")

                # Log template dependencies
                deps = self.get_template_dependencies()
                if deps['custom_definitions']['commands']:
                    print(f"ðŸ“‹ Template custom commands: {', '.join(deps['custom_definitions']['commands'][:5])}" +
                          (f" (+{len(deps['custom_definitions']['commands'])-5} more)" if len(deps['custom_definitions']['commands']) > 5 else ""))
                if deps['custom_definitions']['environments']:
                    print(f"ðŸ“‹ Template custom environments: {', '.join(deps['custom_definitions']['environments'])}")
            else:
                print(f"âš ï¸  Pre-generation check: main.tex MISSING! Available: {list(self.template_files.keys())}")
        else:
            print("âš ï¸  Pre-generation check: NO template files set!")

        main_tex = self._generate_main_tex(paper_data)
        # Clean any markdown code blocks that might have been introduced
        main_tex = self._clean_markdown_code_blocks(main_tex)

        # Apply special instructions to LaTeX if provided
        if self.special_instructions:
            main_tex = self._apply_special_instructions_to_latex(main_tex, paper_data)

        # Ensure graphicx if images are used
        if "\\includegraphics" in main_tex:
            main_tex = self._ensure_package(main_tex, "graphicx")

        # Repair common regex-replacement artifacts where leading backslashes were dropped.
        main_tex = self._repair_dropped_command_backslashes(main_tex)

        # Safety net: malformed templates/runs can miss bibliography or \end{document}.
        # Always recover a compilable tail before returning files.
        main_tex = self._ensure_document_tail(main_tex)

        references_bib = self._generate_bibtex_from_sources(paper_data)

        # Memory system removed - no images from memory
        images_latex = ""

        # Copy template support files to output directory if provided
        if output_dir and self.template_files:
            self._copy_template_support_files(Path(output_dir))

        # Build result with all generated files
        result = {
            'main.tex': main_tex,
            'references.bib': references_bib,
            'images.tex': images_latex
        }

        # Include any additional template files in the result
        # (these are also copied to output_dir but included here for completeness)
        if self.template_files:
            support_extensions = ['.sty', '.cls', '.bst', '.def', '.fd', '.cfg']
            for filename, content in self.template_files.items():
                if filename.lower() != 'main.tex':
                    ext = Path(filename).suffix.lower()
                    if ext in support_extensions:
                        result[filename] = content

        return result

    def _ensure_document_tail(self, content: str) -> str:
        """Ensure output keeps bibliography + document termination.

        This guards against malformed custom templates (or interrupted previous outputs)
        where trailing bibliography/end-document commands are missing.
        """
        if not content:
            return content

        text = str(content).replace("\r\n", "\n").replace("\r", "\n")

        # Ensure \end{document} exists.
        has_end_document = bool(re.search(r"\\end\{document\}", text))
        if not has_end_document:
            text = text.rstrip() + "\n\n\\end{document}\n"

        # Detect any bibliography system already present.
        has_any_bib = bool(
            re.search(r"\\printbibliography|\\bibliography\{|\\begin\{thebibliography\}", text)
        )
        if not has_any_bib:
            end_match = re.search(r"\\end\{document\}", text)
            if end_match:
                bib_block = "\n\\bibliographystyle{plain}\n\\bibliography{references}\n\n"
                text = text[:end_match.start()] + bib_block + text[end_match.start():]
            else:
                # Defensive fallback (should not happen after has_end_document repair above)
                text = text.rstrip() + "\n\n\\bibliographystyle{plain}\n\\bibliography{references}\n\n\\end{document}\n"

        return text

    def _repair_dropped_command_backslashes(self, content: str) -> str:
        """Repair lines where command-leading backslashes were dropped (e.g., 'itle{' -> '\\title{')."""
        if not content:
            return content

        text = str(content)
        repairs = [
            (r"(?m)^([ \t]*)itle(\s*(?:\[[^\]]*\])?\s*\{)", r"\1\\title\2"),
            (r"(?m)^([ \t]*)uthor(\s*(?:\[[^\]]*\])?\s*\{)", r"\1\\author\2"),
            (r"(?m)^([ \t]*)ate(\s*(?:\[[^\]]*\])?\s*\{)", r"\1\\date\2"),
            (r"(?m)^([ \t]*)egin(\s*\{document\})", r"\1\\begin\2"),
            (r"(?m)^([ \t]*)nd(\s*\{document\})", r"\1\\end\2"),
        ]
        for pattern, replacement in repairs:
            text = re.sub(pattern, replacement, text)
        return self._dedupe_preamble_metadata_commands(text)

    def _dedupe_preamble_metadata_commands(self, content: str) -> str:
        """Keep only one \\title/\\author/\\date command in preamble (prefer the last occurrence)."""
        begin_match = re.search(r"\\begin\{document\}", content)
        if not begin_match:
            return content

        preamble = content[:begin_match.start()]
        rest = content[begin_match.start():]
        lines = preamble.splitlines()
        cmd_pattern = re.compile(r"^\s*\\(title|author|date)\b", flags=re.IGNORECASE)

        seen = set()
        kept_reversed: List[str] = []
        for line in reversed(lines):
            m = cmd_pattern.match(line)
            if m:
                cmd = m.group(1).lower()
                if cmd in seen:
                    continue
                seen.add(cmd)
            kept_reversed.append(line)

        cleaned_preamble = "\n".join(reversed(kept_reversed))
        if cleaned_preamble and not cleaned_preamble.endswith("\n"):
            cleaned_preamble += "\n"
        return cleaned_preamble + rest
    
    def _generate_main_tex(self, data: dict) -> str:
        """Generate main.tex using custom template if available"""
        
        # If custom template files are provided, use them
        # BUG FIX: Check both that key exists AND content is non-empty
        template_content = None
        template_filename = None
        
        # First, try to find main.tex
        if self.template_files and 'main.tex' in self.template_files:
            template_content = self._template_payload_as_text('main.tex', self.template_files.get('main.tex', ''))
            if template_content and template_content.strip():
                template_filename = 'main.tex'
                print(f"âœ… Using custom template: main.tex ({len(template_content)} chars)")
            else:
                print(f"âš ï¸  Template 'main.tex' key exists but content is empty!")
        
        # If main.tex not found, look for ANY .tex file
        if not template_content and self.template_files:
            for filename in self.template_files.keys():
                if filename.endswith('.tex'):
                    candidate_content = self._template_payload_as_text(filename, self.template_files.get(filename, ''))
                    if candidate_content and candidate_content.strip():
                        template_content = candidate_content
                        template_filename = filename
                        print(f"âœ… Using custom template: {filename} (renamed to main.tex) ({len(template_content)} chars)")
                        # Store it as main.tex for consistency
                        if 'main.tex' not in self.template_files:
                            self.template_files['main.tex'] = template_content
                        break
        
        if template_content and template_filename:
            return self._generate_from_custom_template(data)
        else:
            if self.template_files:
                print(f"âš ï¸  Template files exist but no valid .tex file found. Available: {list(self.template_files.keys())}")
            else:
                print("âš ï¸  No template files provided - using default template")
        
        # Otherwise use default template from template_dir based on document type
        template_file = self._resolve_default_template_name(data)
        template_path = self.template_dir / template_file
        if not template_path.exists():
            template_path = self.template_dir / 'main.tex'
        template = template_path.read_text(encoding='utf-8')

        # Replace placeholders
        template = template.replace('{{TITLE}}', self._escape_latex(data['title']))
        template = template.replace('{{AUTHOR}}', 'Generated by GenLaTeX AI')
        template = template.replace('{{AFFILIATION}}', 'GenLaTeX')
        template = template.replace('{{EMAIL}}', 'support@genlatex.com')
        template = template.replace('{{DATE}}', '\\today')
        
        # Replace abstract (clean up markdown formatting)
        abstract = self._clean_abstract(data['abstract'])
        template = template.replace('{{ABSTRACT}}', abstract)
        
        # Replace keywords
        keywords = ', '.join(data.get('keywords', []))
        template = template.replace('{{KEYWORDS}}', keywords)
        
        # Check if template has sections - if so, don't generate headers
        template_has_sections = self._template_has_sections(template)
        
        # Generate sections (special handling for slides/beamer)
        doc_type = str(data.get('document_type') or '').lower()
        if doc_type in {'slides', 'presentation', 'beamer'}:
            sections_latex = self._generate_slides_content(data.get('sections', []))
        else:
            sections_latex = self._generate_sections_recursive(
                data['sections'],
                generate_headers=not template_has_sections
            )
        
        # Replace content placeholder or individual section placeholders
        if '{{CONTENT}}' in template:
            template = template.replace('{{CONTENT}}', sections_latex)
        else:
            # Handle individual section placeholders
            template = self._replace_individual_sections(template, data['sections'], template_has_sections)
        
        return template

    def _resolve_default_template_name(self, data: dict) -> str:
        doc_type = str(data.get('document_type') or '').strip().lower()
        template_hint = str(data.get('document_template') or '').strip().lower()

        if doc_type in {'slides', 'presentation', 'beamer'}:
            return 'slides.tex'
        if doc_type == 'letter':
            return 'letter.tex'
        if doc_type == 'cv':
            return 'cv.tex'
        if doc_type == 'invoice':
            return 'invoice.tex'
        if doc_type in {'report', 'business', 'technical', 'proposal'}:
            return 'report.tex'

        if 'slide' in template_hint or 'beamer' in template_hint:
            return 'slides.tex'
        if 'letter' in template_hint:
            return 'letter.tex'
        if 'cv' in template_hint or 'resume' in template_hint:
            return 'cv.tex'
        if 'invoice' in template_hint:
            return 'invoice.tex'
        if 'report' in template_hint or 'proposal' in template_hint:
            return 'report.tex'

        return 'main.tex'

    def _generate_slides_content(self, sections: List[dict]) -> str:
        """Generate beamer frame content from sections."""
        parts: List[str] = []
        for section in sections or []:
            section_name = section.get('section_name', section.get('name', 'Slide'))
            section_content = section.get('content', '').strip()
            parts.append(f"\\section{{{self._escape_latex(section_name)}}}")
            parts.append(f"\\begin{{frame}}{{{self._escape_latex(section_name)}}}")
            if section_content:
                # Remove top-level headings the writer may have produced.
                section_content = re.sub(r'^\\section\{[^}]*\}\s*', '', section_content, flags=re.MULTILINE)
                section_content = re.sub(r'^\\subsection\{[^}]*\}\s*', '', section_content, flags=re.MULTILINE)
                parts.append(self._escape_latex(section_content))
            else:
                parts.append("\\begin{itemize}\n\\item Add key points here.\n\\end{itemize}")
            parts.append("\\end{frame}")
            parts.append("")
        return "\n".join(parts).strip() + "\n"
    
    def _extract_bib_style_from_template(self, template_content):
        """Extract bibliography style from template"""
        # Look for \bibliographystyle{...}
        match = re.search(r'\\bibliographystyle\{([^}]+)\}', template_content)
        if match:
            return match.group(1)
        
        # Default based on document class
        if 'IEEEtran' in template_content:
            return 'IEEEtran'
        elif 'acm' in template_content.lower():
            return 'ACM-Reference-Format'
        elif 'elsarticle' in template_content:
            return 'elsarticle-num'
        
        return 'plain'
    
    def _populate_template_with_content(self, template_content, generated_sections, paper_data):
        """
        Insert AI-generated content into template structure
        STRICTLY preserves template structure - only replaces content within sections
        """
        result = template_content
        
        print(f"\nðŸ“‹ Populating template with {len(generated_sections)} sections...")
        
        # Replace title if template has {{TITLE}} or similar placeholder
        title = self._escape_latex(paper_data['title'])
        result = re.sub(r'\{\{TITLE\}\}', title, result)
        # Match title with potential nested braces (improved to handle complex titles)
        title_pattern = r'\\title\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}'
        if re.search(title_pattern, result):
            # Use callable replacement so "\title" is not interpreted as "\t" (tab).
            replacement_title = f"\\title{{{title}}}"
            result = re.sub(title_pattern, lambda m, t=replacement_title: t, result, count=1)
            print(f"âœ… Replaced title")
        
        # Replace abstract if template has one
        if paper_data.get('abstract'):
            abstract = self._clean_abstract(paper_data['abstract'])
            # Find abstract section and replace content
            abstract_pattern = r'(\\begin\{abstract\})(.*?)(\\end\{abstract\})'
            if re.search(abstract_pattern, result, flags=re.DOTALL):
                result = re.sub(abstract_pattern, lambda m: f'{m.group(1)}\n{abstract}\n{m.group(3)}', result, flags=re.DOTALL)
                print(f"âœ… Replaced abstract")
        
        # Replace keywords if template has them - handle ANY keyword format
        # Extract keywords from data, or generate from title if missing
        keywords_list = paper_data.get('keywords', [])
        if not keywords_list and paper_data.get('title'):
            # Generate keywords from title if missing
            title = paper_data.get('title', '')
            # FIX: Removed redundant 'import re' - already imported at module level
            # Remove common words and extract meaningful terms
            title_words = re.findall(r'\b[A-Z][a-z]+\b', title)  # Capitalized words
            keywords_list = [word.lower() for word in title_words[:5]]  # Take first 5 meaningful words
        
        if keywords_list:
            keywords = ', '.join(keywords_list)
            replaced = False
            # 1. IEEE keywords environment
            keywords_pattern = r'(\\begin\{IEEEkeywords\})(.*?)(\\end\{IEEEkeywords\})'
            if re.search(keywords_pattern, result, flags=re.DOTALL):
                result = re.sub(keywords_pattern, lambda m: f'{m.group(1)}\n{keywords}\n{m.group(3)}', result, flags=re.DOTALL)
                print(f"âœ… Replaced IEEE keywords")
                replaced = True
            # 2. ACM keywords environment
            elif re.search(r'\\begin\{keywords\}', result, re.DOTALL):
                acm_keywords_pattern = r'(\\begin\{keywords\})(.*?)(\\end\{keywords\})'
                result = re.sub(acm_keywords_pattern, lambda m: f'{m.group(1)}\n{keywords}\n{m.group(3)}', result, flags=re.DOTALL)
                print(f"âœ… Replaced ACM keywords")
                replaced = True
            # 3. Any other keywords environment (generic)
            elif re.search(r'\\begin\{.*keywords.*\}', result, re.DOTALL):
                generic_keywords_pattern = r'(\\begin\{.*keywords.*\})(.*?)(\\end\{.*keywords.*\})'
                result = re.sub(generic_keywords_pattern, lambda m: f'{m.group(1)}\n{keywords}\n{m.group(3)}', result, flags=re.DOTALL)
                print(f"âœ… Replaced keywords (generic environment)")
                replaced = True
            # 4. Standard \textbf{Keywords:} format (with or without \noindent)
            if not replaced and re.search(r'\\noindent\s*\\textbf\{Keywords?:\}', result, flags=re.IGNORECASE):
                keywords_pattern = r'\\noindent\s*\\textbf\{Keywords?:\}\s*[^\n]*'
                result = re.sub(keywords_pattern, lambda m: f"\\noindent\\textbf{{Keywords:}} {keywords}", result, flags=re.IGNORECASE)
                print(f"âœ… Replaced keywords (\\noindent\\textbf format)")
                replaced = True
            elif not replaced and re.search(r'\\textbf\{Keywords?:\}', result, flags=re.IGNORECASE):
                keywords_pattern = r'\\textbf\{Keywords?:\}\s*[^\n]*'
                result = re.sub(keywords_pattern, lambda m: f"\\textbf{{Keywords:}} {keywords}", result, flags=re.IGNORECASE)
                print(f"âœ… Replaced keywords (\\textbf format)")
                replaced = True
            # 5. \keywords command
            if not replaced and re.search(r'\\keywords\{', result):
                keywords_pattern = r'\\keywords\{[^}]*\}'
                result = re.sub(keywords_pattern, lambda m: f'\\keywords{{{keywords}}}', result)
                print(f"âœ… Replaced keywords (\\keywords command)")
                replaced = True
        
        # Create a mapping of section names to their content for easy lookup
        # Handle both dict and object types, normalize section names
        section_map = {}
        for section in generated_sections:
            # Get section name - handle both dict and object
            if isinstance(section, dict):
                section_name = section.get('section_name', section.get('name', ''))
                section_content = section.get('content', '')
            else:
                section_name = getattr(section, 'section_name', getattr(section, 'name', ''))
                section_content = getattr(section, 'content', '')
            
            # Normalize section name (strip whitespace, handle case-insensitive matching)
            if section_name:
                section_name = section_name.strip()
                # Store both original and normalized versions for flexible matching
                if section_name and section_content:
                    section_map[section_name] = section_content
                    # Also store lowercase version for case-insensitive matching
                    section_map[section_name.lower()] = section_content
        
        print(f"ðŸ“ Section map has {len(section_map)} sections to populate:")
        for name in section_map.keys():
            print(f"   - {name}")
        
        # Extract all sections from template to find exact matches
        all_template_sections = []
        section_regex = r'\\(section|subsection|subsubsection)\s*\{([^}]+)\}'
        for match in re.finditer(section_regex, result):
            level = match.group(1)
            name = match.group(2).strip()
            all_template_sections.append((level, name))
        
        print(f"ðŸ“‹ Template has {len(all_template_sections)} sections:")
        for level, name in all_template_sections:
            print(f"   - \\{level}{{{name}}}")
        
        # For each template section, try to find matching generated content
        replaced_count = 0
        for level, template_section_name in all_template_sections:
            # Normalize template section name
            template_section_name = template_section_name.strip()
            
            # Try to find exact match first (case-sensitive)
            content = None
            if template_section_name in section_map:
                content = section_map[template_section_name]
            # Try case-insensitive match
            elif template_section_name.lower() in section_map:
                content = section_map[template_section_name.lower()]
            # Try partial match (if template has "Introduction" and generated has "1. Introduction")
            else:
                for gen_name in section_map.keys():
                    if gen_name.lower() == template_section_name.lower():
                        content = section_map[gen_name]
                        break
                    # Check if template name is contained in generated name or vice versa
                    elif template_section_name.lower() in gen_name.lower() or gen_name.lower() in template_section_name.lower():
                        # Prefer longer match
                        if abs(len(gen_name) - len(template_section_name)) < 5:  # Similar length
                            content = section_map[gen_name]
                            break
            
            if content:
                escaped_name = re.escape(template_section_name)
                
                # Pattern that captures the section command and everything until the next section/end
                pattern = f'(\\\\{level}\\s*\\{{{escaped_name}\\}})(.*?)(?=\\\\section|\\\\subsection|\\\\subsubsection|\\\\bibliography|\\\\begin\\{{thebibliography\\}}|\\\\end\\{{document\\}}|\\Z)'
                
                if re.search(pattern, result, flags=re.DOTALL):
                    # DO NOT escape content - it's already valid LaTeX from writer.
                    # Use callable replacement so backslashes in content are treated literally.
                    result = re.sub(
                        pattern,
                        lambda m, c=content: f"{m.group(1)}\n\n{c}\n\n",
                        result,
                        flags=re.DOTALL,
                        count=1
                    )
                    replaced_count += 1
                    print(f"âœ… Populated \\{level}{{{template_section_name}}}")
                else:
                    print(f"âš ï¸  Could not find location for \\{level}{{{template_section_name}}}")
            else:
                print(f"âš ï¸  No generated content for template section: {template_section_name}")
        
        print(f"\nâœ¨ Successfully populated {replaced_count}/{len(all_template_sections)} template sections")
        
        # If we didn't replace any sections, something went wrong
        if replaced_count == 0 and len(all_template_sections) > 0:
            print(f"âŒ ERROR: No sections were populated! Section names may not match.")
            print(f"   Generated sections: {list(section_map.keys())}")
            print(f"   Template sections: {[name for _, name in all_template_sections]}")
        
        return result
    
    def _generate_from_custom_template(self, data: dict) -> str:
        """Generate LaTeX using custom uploaded template - USE TEMPLATE FILE DIRECTLY
        
        This method takes the actual template file and replaces content in place,
        preserving the template's exact structure, formatting, and style.
        
        CRITICAL: If template has existing sections, populate them. Otherwise, insert new sections.
        """
        
        # Get the full template file - this is our base
        template_content = self._template_payload_as_text('main.tex', self.template_files.get('main.tex', '')) or ''
        if not template_content:
            # No template content available, fall back to default (but avoid recursion)
            # Use default template from template_dir
            template = (self.template_dir / 'main.tex').read_text()
            template = template.replace('{{TITLE}}', self._escape_latex(data['title']))
            template = template.replace('{{AUTHOR}}', 'AI Research Agent')
            template = template.replace('{{AFFILIATION}}', 'AI Research Laboratory')
            template = template.replace('{{EMAIL}}', 'ai@research.com')
            template = template.replace('{{DATE}}', '\\today')
            abstract = self._clean_abstract(data['abstract'])
            template = template.replace('{{ABSTRACT}}', abstract)
            keywords = ', '.join(data.get('keywords', []))
            template = template.replace('{{KEYWORDS}}', keywords)
            
            # Check if template has sections - if so, don't generate headers
            template_has_sections = self._template_has_sections(template)
            sections_latex = self._generate_sections_recursive(
                data['sections'],
                generate_headers=not template_has_sections
            )
            if '{{CONTENT}}' in template:
                template = template.replace('{{CONTENT}}', sections_latex)
            else:
                template = self._replace_individual_sections(template, data['sections'], template_has_sections)
            return template
        
        # If template_structure is None, create a minimal one to avoid errors
        if not self.template_structure:
            print("âš ï¸  Template structure not parsed, using template file directly with minimal structure")
            self.template_structure = {
                'template_style': 'standard',
                'has_bibliography': False,
                'citation_system': 'bibtex',
                'citation_style': 'plain'
            }
        
        print("ðŸ“‹ Using template file DIRECTLY - replacing content in place")
        print(f"ðŸ“ Template style: {self.template_structure.get('template_style', 'standard')}")
        
        # AI substitution can truncate long documents; keep deterministic mode by default.
        ai_template_substitution_enabled = str(
            os.getenv("LATEX_TEMPLATE_AI_SUBSTITUTION", "false")
        ).lower() in ("1", "true", "yes", "on")

        # Try AI-based substitution first only when explicitly enabled.
        if self.llm and ai_template_substitution_enabled:
            try:
                print("ðŸ¤– Attempting AI-based template substitution...")
                result = self._ai_substitute_template(template_content, data)
                if result:
                    print("âœ… AI-based substitution successful")
                    return result
                else:
                    print("âš ï¸  AI substitution returned empty, falling back to regex")
            except Exception as e:
                print(f"âš ï¸  AI substitution failed: {e}, falling back to regex")
        elif self.llm and not ai_template_substitution_enabled:
            print("â„¹ï¸  AI template substitution disabled; using deterministic substitution")
        
        # Fallback to regex-based substitution
        print("ðŸ“ Using regex-based template substitution")
        # Start with the template as-is
        result = template_content

        # Replace title in place (find \title{...} and replace content)
        # Handle nested braces in title (e.g., \title{Title with {nested} braces})
        title_pattern = r'\\title\s*(\[.*?\])?\s*\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}'
        new_title = f"\\title{{{self._escape_latex(data['title'])}}}"
        if re.search(title_pattern, result):
            # Use callable replacement so "\title" is not interpreted as "\t" (tab).
            result = re.sub(title_pattern, lambda m, t=new_title: t, result, count=1)
        else:
            # If no title found, try to insert after \documentclass or before \begin{document}
            begin_doc = re.search(r'\\begin\{document\}', result)
            if begin_doc:
                result = result[:begin_doc.start()] + f"{new_title}\n\n" + result[begin_doc.start():]
        
        # Replace abstract in place
        if data.get('abstract'):
            abstract = self._clean_abstract(data['abstract'])
            # Find abstract environment and replace content
            abstract_pattern = r'\\begin\{abstract\}(.*?)\\end\{abstract\}'
            if re.search(abstract_pattern, result, re.DOTALL):
                # Use lambda to avoid escape sequence issues in replacement string
                result = re.sub(abstract_pattern, lambda m: f"\\begin{{abstract}}\n{abstract}\n\\end{{abstract}}", result, flags=re.DOTALL)
            else:
                # If no abstract found, try to insert after \maketitle
                maketitle_match = re.search(r'\\maketitle', result)
                if maketitle_match:
                    insert_pos = maketitle_match.end()
                    result = result[:insert_pos] + f"\n\n\\begin{{abstract}}\n{abstract}\n\\end{{abstract}}\n" + result[insert_pos:]
        
        # Replace keywords in place - handle ANY keyword format
        # Extract keywords from data, or generate from title if missing
        keywords_list = data.get('keywords', [])
        if not keywords_list and data.get('title'):
            # Generate keywords from title if missing
            title = data.get('title', '')
            # FIX: Removed redundant 'import re' - already imported at module level
            # Remove common words and extract meaningful terms
            title_words = re.findall(r'\b[A-Z][a-z]+\b', title)  # Capitalized words
            keywords_list = [word.lower() for word in title_words[:5]]  # Take first 5 meaningful words
        
        if keywords_list:
            keywords = ', '.join(keywords_list)
            replaced = False
            # Try various keyword formats (in order of specificity)
            # 1. IEEE keywords environment
            ieee_keywords_pattern = r'\\begin\{IEEEkeywords\}(.*?)\\end\{IEEEkeywords\}'
            if re.search(ieee_keywords_pattern, result, re.DOTALL):
                result = re.sub(ieee_keywords_pattern, lambda m: f"\\begin{{IEEEkeywords}}\n{keywords}\n\\end{{IEEEkeywords}}", result, flags=re.DOTALL)
                print(f"âœ… Replaced IEEE keywords")
                replaced = True
            # 2. ACM keywords environment
            elif re.search(r'\\begin\{keywords\}', result, re.DOTALL):
                acm_keywords_pattern = r'\\begin\{keywords\}(.*?)\\end\{keywords\}'
                result = re.sub(acm_keywords_pattern, lambda m: f"\\begin{{keywords}}\n{keywords}\n\\end{{keywords}}", result, flags=re.DOTALL)
                print(f"âœ… Replaced ACM keywords")
                replaced = True
            # 3. Any other keywords environment (generic)
            elif re.search(r'\\begin\{.*keywords.*\}', result, re.DOTALL):
                generic_keywords_pattern = r'(\\begin\{.*keywords.*\})(.*?)(\\end\{.*keywords.*\})'
                result = re.sub(generic_keywords_pattern, lambda m: f'{m.group(1)}\n{keywords}\n{m.group(3)}', result, flags=re.DOTALL)
                print(f"âœ… Replaced keywords (generic environment)")
                replaced = True
            # 4. Standard \textbf{Keywords:} format (with or without \noindent)
            if not replaced and re.search(r'\\noindent\s*\\textbf\{Keywords?:\}', result, flags=re.IGNORECASE):
                keywords_pattern = r'\\noindent\s*\\textbf\{Keywords?:\}\s*[^\n]*'
                result = re.sub(keywords_pattern, lambda m: f"\\noindent\\textbf{{Keywords:}} {keywords}", result, flags=re.IGNORECASE)
                print(f"âœ… Replaced keywords (\\noindent\\textbf format)")
                replaced = True
            elif not replaced and re.search(r'\\textbf\{Keywords?:\}', result, flags=re.IGNORECASE):
                keywords_pattern = r'\\textbf\{Keywords?:\}\s*[^\n]*'
                result = re.sub(keywords_pattern, lambda m: f"\\textbf{{Keywords:}} {keywords}", result, flags=re.IGNORECASE)
                print(f"âœ… Replaced keywords (\\textbf format)")
                replaced = True
            # 5. \keywords command
            if not replaced and re.search(r'\\keywords\{', result):
                keywords_pattern = r'\\keywords\{[^}]*\}'
                result = re.sub(keywords_pattern, lambda m: f"\\keywords{{{keywords}}}", result)
                print(f"âœ… Replaced keywords (\\keywords command)")
                replaced = True
            # 6. Insert after abstract if no keywords found
            if not replaced:
                abstract_end = result.find('\\end{abstract}')
                if abstract_end != -1:
                    insert_pos = abstract_end + len('\\end{abstract}')
                    result = result[:insert_pos] + f"\n\n\\noindent\\textbf{{Keywords:}} {keywords}\n" + result[insert_pos:]
                    print(f"âœ… Inserted keywords after abstract")
        
        # CRITICAL: Check if template has existing sections
        template_has_sections = self._template_has_sections(result)
        
        if template_has_sections:
            # Template HAS sections - use populate method to preserve section structure
            section_regex = r'\\(section|subsection|subsubsection)\s*\{([^}]+)\}'
            template_sections = list(re.finditer(section_regex, result))
            print(f"ðŸ“‹ Template has {len(template_sections)} existing sections - will populate them")
            # Extract generated sections from data
            generated_sections = data.get('sections', [])
            result = self._populate_template_with_content(result, generated_sections, data)
        else:
            # Template has NO sections - generate new sections and insert
            print("ðŸ“‹ Template has no existing sections - will insert generated sections")
            sections_latex = self._generate_sections_recursive(data['sections'], generate_headers=True)
            
            # Find where to insert sections
            begin_doc_match = re.search(r'\\begin\{document\}', result)
            if not begin_doc_match:
                return result
            
            # Find the position after \maketitle and before any existing sections
            maketitle_match = re.search(r'\\maketitle', result)
            if maketitle_match:
                after_maketitle = maketitle_match.end()
            else:
                after_maketitle = begin_doc_match.end()
            
            # Find where existing content ends (before bibliography or \end{document})
            bib_match = re.search(r'\\bibliography\{|\\printbibliography|\\begin\{thebibliography\}', result)
            end_doc_match = re.search(r'\\end\{document\}', result)
            
            if bib_match:
                # Replace everything between after_maketitle and bibliography with new sections
                result = result[:after_maketitle] + "\n\n" + sections_latex + "\n\n" + result[bib_match.start():]
            elif end_doc_match:
                # Replace everything between after_maketitle and \end{document} with new sections
                # But preserve bibliography commands if they exist before \end{document}
                before_end = end_doc_match.start()
                # Check if there's bibliography stuff right before \end{document}
                bib_style_match = re.search(r'\\bibliographystyle\{[^}]+\}', result[before_end-200:before_end])
                if bib_style_match:
                    # Keep bibliography commands
                    bib_start = before_end - 200 + bib_style_match.start()
                    result = result[:after_maketitle] + "\n\n" + sections_latex + "\n\n" + result[bib_start:]
                else:
                    # No bibliography, just insert sections before \end{document}
                    result = result[:after_maketitle] + "\n\n" + sections_latex + "\n\n" + result[before_end:]
            else:
                # No \end{document} found, append sections
                result = result.rstrip() + "\n\n" + sections_latex + "\n\n\\end{document}\n"
        
        # Ensure bibliography is present if template expects it
        if self.template_structure.get('has_bibliography'):
            citation_system = self.template_structure.get('citation_system', 'bibtex')
            citation_style = self.template_structure.get('citation_style', 'plain')
            
            # Check if bibliography already exists
            if not re.search(r'\\bibliography\{|\\printbibliography', result):
                # Add bibliography before \end{document}
                end_doc_match = re.search(r'\\end\{document\}', result)
                if end_doc_match:
                    if citation_system == 'biblatex':
                        bib_cmd = f"\n\\printbibliography\n"
                    else:
                        bib_cmd = f"\n\\bibliographystyle{{{citation_style}}}\n\\bibliography{{references}}\n"
                    result = result[:end_doc_match.start()] + bib_cmd + result[end_doc_match.start():]
        
        # FINAL VERIFICATION: Ensure template content is preserved
        # Check that result still contains template's documentclass (proves template was used)
        original_docclass = None
        if template_content:
            docclass_match = re.search(r'\\documentclass\s*(?:\[.*?\])?\s*\{([^}]+)\}', template_content)
            if docclass_match:
                original_docclass = docclass_match.group(1)
        
        if original_docclass:
            result_docclass_match = re.search(r'\\documentclass\s*(?:\[.*?\])?\s*\{([^}]+)\}', result)
            if result_docclass_match and result_docclass_match.group(1) == original_docclass:
                print(f"âœ… FINAL VERIFICATION: Template documentclass '{original_docclass}' preserved in output")
                print(f"âœ… Output length: {len(result)} chars, Template length: {len(template_content)} chars")
            else:
                print(f"âŒ CRITICAL ERROR: Template documentclass '{original_docclass}' NOT found in result!")
                print(f"   Result documentclass: {result_docclass_match.group(1) if result_docclass_match else 'NOT FOUND'}")
                print(f"   Result length: {len(result)} chars")
                print(f"   Template length: {len(template_content)} chars")
                print(f"   First 200 chars of result: {result[:200]}")
                print(f"   First 200 chars of template: {template_content[:200]}")
        else:
            print(f"âš ï¸  WARNING: Could not extract documentclass from template!")
        
        return result
    
    def _template_has_sections(self, template_content: str) -> bool:
        """Check if template already contains section commands"""
        section_regex = r'\\(section|subsection|subsubsection)\s*\{'
        return bool(re.search(section_regex, template_content))
    
    def _ai_substitute_template(self, template_content: str, data: dict) -> Optional[str]:
        """Use AI to intelligently substitute content into template
        
        This method uses an LLM to understand the template structure and
        insert content while preserving all formatting, commands, and structure.
        
        CRITICAL: If template has sections, do NOT generate \section{} commands.
        Only provide content keyed by section name.
        """
        if not self.llm:
            return None
        
        try:
            from langchain.prompts import ChatPromptTemplate
            
            # Check if template has existing sections
            template_has_sections = self._template_has_sections(template_content)
            
            # Prepare sections content
            # If template has sections, provide content only (no \section{} commands)
            # If template has no sections, provide full section structure
            sections_text = ""
            sections_dict = {}
            
            for section in data.get('sections', []):
                if isinstance(section, dict):
                    name = section.get('section_name', section.get('name', ''))
                    content = section.get('content', '')
                else:
                    name = getattr(section, 'section_name', getattr(section, 'name', ''))
                    content = getattr(section, 'content', '')
                
                if name and content:
                    if template_has_sections:
                        # Template has sections - provide content only, keyed by name
                        sections_dict[name] = content
                        sections_text += f"\n\nSection: {name}\nContent: {content}\n"
                    else:
                        # Template has no sections - generate full structure
                        sections_text += f"\n\n\\section{{{name}}}\n{content}\n"
            
            # Build system prompt based on whether template has sections
            if template_has_sections:
                system_prompt = """You are a LaTeX expert. Your task is to insert content into a LaTeX template while preserving ALL formatting, commands, packages, and structure.

CRITICAL RULES:
1. Preserve the EXACT template structure - don't change documentclass, packages, or preamble
2. The template ALREADY has section headers (\section{{}}, \subsection{{}}, etc.) - DO NOT add new ones
3. Replace ONLY the content within existing sections - match section names and insert content only
4. Do NOT generate \section{{}}, \subsection{{}}, or \subsubsection{{}} commands - they already exist in template
5. Preserve all custom commands, environments, and formatting
6. Keep bibliography commands exactly as they are
7. Return ONLY the complete LaTeX document, no explanations"""
            else:
                system_prompt = """You are a LaTeX expert. Your task is to insert content into a LaTeX template while preserving ALL formatting, commands, packages, and structure.

CRITICAL RULES:
1. Preserve the EXACT template structure - don't change documentclass, packages, or preamble
2. Replace ONLY the content (title, abstract, keywords, sections) - keep all LaTeX commands
3. The template has NO sections - insert new sections with \section{{}} commands as provided
4. Preserve all custom commands, environments, and formatting
5. Keep bibliography commands exactly as they are
6. Return ONLY the complete LaTeX document, no explanations"""
            
            prompt = ChatPromptTemplate.from_messages([
                ("system", system_prompt),
                ("user", """Template:
{template}

Content to insert:
Title: {title}
Abstract: {abstract}
Keywords: {keywords}
Sections: {sections}

Insert the content into the template, preserving all formatting and structure. Return the complete LaTeX document.""")
            ])
            
            chain = prompt | self.llm
            response = chain.invoke({
                "template": template_content,
                "title": data.get('title', ''),
                "abstract": data.get('abstract', ''),
                "keywords": ', '.join(data.get('keywords', [])),
                "sections": sections_text
            })
            
            result = response.content if hasattr(response, 'content') else str(response)
            
            # Clean markdown code blocks if present
            result = self._clean_markdown_code_blocks(result)
            
            return result.strip() if result else None
            
        except Exception as e:
            print(f"âŒ AI substitution error: {e}")
            import traceback
            traceback.print_exc()
            return None
    
    def _copy_template_support_files(self, output_dir: Path):
        """Copy template support files and create missing required files

        This method:
        1. Copies all support files (.sty, .cls, .bst, .bib, .def, .fd, .cfg) from template
        2. Copies \input and \include referenced files
        3. Creates stub files for missing dependencies that are referenced but not provided

        Args:
            output_dir: Path to output directory where files should be copied
        """
        if not self.template_files:
            return

        output_dir.mkdir(parents=True, exist_ok=True)
        copied_files = []
        created_files = []

        # Support file extensions to copy
        text_support_extensions = {'.sty', '.cls', '.bst', '.bib', '.def', '.fd', '.cfg', '.tex'}
        binary_support_extensions = {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.pdf', '.eps'}

        # First, copy all provided template files (except main.tex which is generated)
        for filename, content in self.template_files.items():
            if filename.lower() == 'main.tex':
                continue  # Skip main.tex as it's generated

            file_ext = Path(filename).suffix.lower()
            if file_ext in text_support_extensions:
                try:
                    text_payload = self._template_payload_as_text(filename, content)
                    if text_payload is None:
                        print(f"[WARN]  Skipping {filename}: text payload could not be decoded")
                        continue
                    normalized_content = self.normalize_support_file_content(filename, text_payload)
                    # Validate: reject .cls/.sty files that contain document content (prevents main.tex being written as IEEEtran.cls)
                    if not self.is_valid_support_file_content(filename, normalized_content):
                        print(f"âš ï¸  Skipping {filename}: content appears to be a LaTeX document, not a valid class/style file")
                        continue
                    # Handle subdirectories in filename
                    dest_path = output_dir / filename
                    dest_path.parent.mkdir(parents=True, exist_ok=True)

                    # Only copy if file doesn't exist or is different
                    if not dest_path.exists():
                        dest_path.write_text(normalized_content, encoding='utf-8')
                        copied_files.append(filename)
                        print(f"âœ“ Copied template file: {filename}")
                    else:
                        existing = dest_path.read_text(encoding='utf-8')
                        existing = self.normalize_support_file_content(filename, existing)
                        if existing != normalized_content:
                            dest_path.write_text(normalized_content, encoding='utf-8')
                            copied_files.append(filename)
                            print(f"âœ“ Updated template file: {filename}")
                except Exception as e:
                    print(f"âš ï¸  Failed to copy file {filename}: {e}")
            elif file_ext in binary_support_extensions:
                try:
                    bytes_payload = self._template_payload_as_bytes(content)
                    if not bytes_payload:
                        print(f"[WARN]  Skipping {filename}: binary payload could not be decoded")
                        continue

                    dest_path = output_dir / filename
                    dest_path.parent.mkdir(parents=True, exist_ok=True)

                    if not dest_path.exists():
                        dest_path.write_bytes(bytes_payload)
                        copied_files.append(filename)
                        print(f"[OK] Copied template binary: {filename}")
                    else:
                        existing_bytes = dest_path.read_bytes()
                        if existing_bytes != bytes_payload:
                            dest_path.write_bytes(bytes_payload)
                            copied_files.append(filename)
                            print(f"[OK] Updated template binary: {filename}")
                except Exception as e:
                    print(f"[WARN]  Failed to copy binary file {filename}: {e}")

        # Check for missing required files and create stubs if needed
        if self.template_structure:
            missing_files = self._check_missing_dependencies(output_dir)

            for missing_file in missing_files:
                try:
                    file_path = output_dir / missing_file
                    file_path.parent.mkdir(parents=True, exist_ok=True)

                    if not file_path.exists():
                        stub_content = self._create_stub_file(missing_file)
                        if stub_content:
                            file_path.write_text(stub_content, encoding='utf-8')
                            created_files.append(missing_file)
                            print(f"âœ“ Created stub file: {missing_file}")
                except Exception as e:
                    print(f"âš ï¸  Failed to create stub for {missing_file}: {e}")

        # Summary
        if copied_files:
            print(f"ðŸ“‹ Copied {len(copied_files)} template support files")
        if created_files:
            print(f"ðŸ“‹ Created {len(created_files)} stub files for missing dependencies")
        if not copied_files and not created_files:
            print("ðŸ“‹ No template support files to copy or create")

    def _check_missing_dependencies(self, output_dir: Path) -> List[str]:
        """Check for missing files required by the template

        Args:
            output_dir: Directory to check for existing files

        Returns:
            List of missing file names
        """
        if not self.template_structure:
            return []

        missing = []

        # Check all required file types
        all_required = (
            self.template_structure.get('required_class_files', []) +
            self.template_structure.get('required_style_files', []) +
            self.template_structure.get('required_bst_files', []) +
            self.template_structure.get('input_files', []) +
            self.template_structure.get('include_files', [])
        )

        # Note: We don't check required_bib_files here since we generate references.bib
        provided_keys = set(self.template_files.keys()) if self.template_files else set()
        provided_basenames = {Path(key).name for key in provided_keys}

        for required_file in all_required:
            # Check if file exists in template_files or output_dir
            normalized_required = str(required_file).replace('\\', '/')
            if normalized_required in provided_keys or Path(normalized_required).name in provided_basenames:
                continue
            file_path = output_dir / normalized_required
            if not file_path.exists():
                missing.append(normalized_required)

        return missing

    def _create_stub_file(self, filename: str) -> Optional[str]:
        """Create a stub file for a missing dependency

        Args:
            filename: Name of the file to create

        Returns:
            Content for the stub file, or None if can't create
        """
        ext = Path(filename).suffix.lower()
        name = Path(filename).stem

        if ext == '.sty':
            # Create a minimal .sty file
            return f"""% Stub style file: {filename}
% This file was auto-generated because it was referenced but not provided.
% Replace with actual package content if needed.

\\NeedsTeXFormat{{LaTeX2e}}
\\ProvidesPackage{{{name}}}[Auto-generated stub package]

% Add package definitions here
\\endinput
"""

        elif ext == '.cls':
            # Create a minimal .cls file based on article
            return f"""% Stub class file: {filename}
% This file was auto-generated because it was referenced but not provided.
% Replace with actual class content if needed.

\\NeedsTeXFormat{{LaTeX2e}}
\\ProvidesClass{{{name}}}[Auto-generated stub class]

% Load base class
\\LoadClass{{article}}

% Add class customizations here
\\endinput
"""

        elif ext == '.bst':
            # Can't easily create .bst files, return None
            print(f"âš ï¸  Cannot auto-generate .bst file: {filename}")
            print(f"   Please provide this file or use a standard bibliography style")
            return None

        elif ext == '.tex':
            # Create an empty .tex file with a comment
            return f"""% Stub file: {filename}
% This file was auto-generated because it was referenced via \\input or \\include.
% Replace with actual content if needed.

% Content placeholder
"""

        elif ext == '.bib':
            # Create an empty .bib file
            return f"""% Bibliography file: {filename}
% This file was auto-generated. Add your BibTeX entries here.

"""

        else:
            return None

    def get_template_dependencies(self) -> Dict[str, Any]:
        """Get all template dependencies and their status

        Returns a dictionary with:
        - required_files: All files required by the template
        - provided_files: Files that were provided in template_files
        - missing_files: Files that are required but not provided
        - custom_definitions: Custom commands and environments that will be preserved

        This method is useful for:
        1. Checking what files are needed before generation
        2. Warning users about missing dependencies
        3. Ensuring the template will compile correctly
        """
        if not self.template_structure:
            return {
                'required_files': [],
                'provided_files': list(self.template_files.keys()) if self.template_files else [],
                'missing_files': [],
                'custom_definitions': {'commands': [], 'environments': [], 'math_operators': []}
            }

        # Collect all required files
        required = set()
        required.update(self.template_structure.get('required_class_files', []))
        required.update(self.template_structure.get('required_style_files', []))
        required.update(self.template_structure.get('required_bst_files', []))
        required.update(self.template_structure.get('input_files', []))
        required.update(self.template_structure.get('include_files', []))
        # Don't include .bib files as we generate references.bib

        # Check what's provided
        provided = set(self.template_files.keys()) if self.template_files else set()

        # Find missing files
        missing = required - provided

        return {
            'required_files': list(required),
            'provided_files': list(provided),
            'missing_files': list(missing),
            'custom_definitions': {
                'commands': [cmd.get('name', '') for cmd in self.template_structure.get('custom_commands', [])],
                'environments': [env.get('name', '') for env in self.template_structure.get('custom_environments', [])],
                'math_operators': [op.get('name', '') for op in self.template_structure.get('math_operators', [])]
            },
            'tikz_libraries': self.template_structure.get('tikz_libraries', []),
            'color_definitions': [c.get('name', '') for c in self.template_structure.get('color_definitions', [])]
        }

    def validate_template(self) -> Dict[str, Any]:
        """Validate the template and check for potential issues

        Returns:
            Dictionary with validation results including:
            - is_valid: Whether the template is usable
            - warnings: List of potential issues
            - errors: List of critical problems
            - suggestions: Recommendations for fixing issues
        """
        result = {
            'is_valid': True,
            'warnings': [],
            'errors': [],
            'suggestions': []
        }

        if not self.template_files:
            result['errors'].append("No template files provided")
            result['is_valid'] = False
            return result

        if 'main.tex' not in self.template_files:
            result['errors'].append("No main.tex file found in template")
            result['is_valid'] = False
            return result

        template_content = self._template_payload_as_text('main.tex', self.template_files.get('main.tex', '')) or ''

        # Check for document class
        if '\\documentclass' not in template_content:
            result['errors'].append("Template missing \\documentclass declaration")
            result['is_valid'] = False

        # Check for begin/end document
        if '\\begin{document}' not in template_content:
            result['errors'].append("Template missing \\begin{document}")
            result['is_valid'] = False

        if '\\end{document}' not in template_content:
            result['warnings'].append("Template missing \\end{document} - will be added automatically")

        # Check dependencies
        deps = self.get_template_dependencies()
        if deps['missing_files']:
            for missing in deps['missing_files']:
                ext = Path(missing).suffix.lower()
                if ext == '.cls':
                    result['warnings'].append(f"Custom class file '{missing}' not provided - stub will be created")
                    result['suggestions'].append(f"Provide the actual {missing} file for best results")
                elif ext == '.sty':
                    result['warnings'].append(f"Custom style file '{missing}' not provided - stub will be created")
                elif ext == '.bst':
                    result['errors'].append(f"Bibliography style file '{missing}' not provided and cannot be auto-generated")
                    result['suggestions'].append(f"Provide {missing} or use a standard bibliography style (plain, abbrv, etc.)")
                    result['is_valid'] = False
                elif ext == '.tex':
                    result['warnings'].append(f"Input file '{missing}' not provided - empty stub will be created")

        # Check for custom definitions that need preservation
        if deps['custom_definitions']['commands']:
            result['suggestions'].append(
                f"Template defines {len(deps['custom_definitions']['commands'])} custom commands - these will be preserved"
            )

        return result

    def _generate_bibtex_from_sources(self, paper_data: dict) -> str:
        """Generate BibTeX from CitationManager (single source of truth)"""
        
        # Primary: Use CitationManager if available
        if self.citation_manager and hasattr(self.citation_manager, 'generate_bibtex'):
            bibtex = self.citation_manager.generate_bibtex()
            source_count = len(self.citation_manager.sources)
            
            if bibtex and bibtex.strip():
                print(f"âœ… Generated BibTeX from CitationManager: {source_count} sources")
                return self._normalize_bibtex_entry_types(bibtex)
            else:
                print(f"âš ï¸  WARNING: CitationManager has {source_count} sources but generated empty BibTeX")
                # Fall through to fallback
        
        # Fallback: Use paper_data['bibtex'] if CitationManager unavailable
        if paper_data.get('bibtex'):
            print(f"âš ï¸  CitationManager unavailable, using BibTeX from paper_data")
            return self._normalize_bibtex_entry_types(paper_data['bibtex'])

        # Fallback: Build BibTeX from sources embedded in paper_data (sections/references)
        source_dicts = self._collect_source_dicts_from_paper_data(paper_data)
        if source_dicts:
            bibtex = self._build_bibtex_from_dicts(source_dicts)
            if bibtex:
                print(f"âš ï¸  CitationManager unavailable, built BibTeX from paper_data sources ({len(source_dicts)} sources)")
                return self._normalize_bibtex_entry_types(bibtex)

        # Last resort: No BibTeX available
        print("âŒ ERROR: No BibTeX available - CitationManager unavailable and paper_data has no sources")
        return ""

    def _normalize_bibtex_entry_types(self, bibtex: str) -> str:
        if not bibtex:
            return bibtex

        def replace_entry_type(match: re.Match) -> str:
            entry_type = match.group(1).lower()
            if entry_type in ("misc", "comment", "preamble", "string"):
                return match.group(0)
            return "@misc{"

        return re.sub(r"@([A-Za-z]+)\s*\{", replace_entry_type, bibtex)

    def _collect_source_dicts_from_paper_data(self, paper_data: dict) -> List[Dict[str, Any]]:
        """Collect source dicts from paper_data references and section sources."""
        sources: List[Dict[str, Any]] = []
        seen = set()

        for src in paper_data.get('references', []) or []:
            if isinstance(src, dict):
                key = src.get('citation_key') or src.get('key')
                if key and key in seen:
                    continue
                if key:
                    seen.add(key)
                sources.append(src)

        for section in paper_data.get('sections', []) or []:
            for src in section.get('sources', []) or []:
                if not isinstance(src, dict):
                    continue
                key = src.get('citation_key') or src.get('key')
                if key and key in seen:
                    continue
                if key:
                    seen.add(key)
                sources.append(src)

        return sources

    def _build_bibtex_from_dicts(self, sources: List[Dict[str, Any]]) -> str:
        """Build BibTeX entries from source dicts (fallback when CitationManager is missing)."""
        try:
            from utils.sources import Source
        except Exception:
            Source = None

        entries = []
        seen = set()

        for src in sources:
            if not isinstance(src, dict):
                continue
            key = src.get('citation_key') or src.get('key')
            if not key:
                title = src.get('title') or 'Reference'
                key = re.sub(r'[^A-Za-z0-9]+', '', title)[:24] or 'ref'
            if key in seen:
                continue
            seen.add(key)

            authors = src.get('authors', []) or []
            if isinstance(authors, str):
                authors = [a.strip() for a in re.split(r'\s+and\s+|,', authors) if a.strip()]

            year = src.get('year')
            if isinstance(year, str):
                m = re.search(r'\d{4}', year)
                year = int(m.group(0)) if m else None

            data = {
                "title": src.get('title', 'Unknown'),
                "authors": authors,
                "year": year,
                "abstract": src.get('abstract', '') or '',
                "url": src.get('url', '') or '',
                "venue": src.get('venue') or src.get('journal') or src.get('booktitle'),
                "source_type": src.get('source_type', 'academic'),
                "citation_key": key,
            }

            if Source:
                try:
                    entries.append(Source.from_dict(data).to_bibtex())
                    continue
                except Exception:
                    pass

            # Minimal fallback if Source fails
            author_str = " and ".join(authors) if authors else "Unknown"
            bib = [f"@misc{{{key},"]
            bib.append(f"  title = {{{data['title']}}},")
            bib.append(f"  author = {{{author_str}}},")
            if year:
                bib.append(f"  year = {{{year}}},")
            if data.get('venue'):
                bib.append(f"  howpublished = {{{data['venue']}}},")
            if data.get('url'):
                bib.append(f"  url = {{{data['url']}}},")
            bib.append("}")
            entries.append("\n".join(bib))

        return "\n\n".join(entries)
    
    def _generate_sections_recursive(
        self,
        sections: List[dict],
        level: int = 1,
        generate_headers: bool = True
    ) -> str:
        """Recursively generate sections
        
        Args:
            sections: List of section dicts
            level: Section level (1=section, 2=subsection, etc.)
            generate_headers: If False, only generate content (no \section{} commands)
                             Use False when template already has section headers
        """
        
        commands = ['section', 'subsection', 'subsubsection', 'paragraph']
        cmd = commands[min(level - 1, len(commands) - 1)]
        
        latex_parts = []
        
        for section in sections:
            section_latex = ""
            
            # Get section data safely
            section_name = section.get('section_name', section.get('name', 'Unknown Section'))
            section_id = section.get('section_id', section.get('id', ''))
            section_content = section.get('content', '')
            
            # Strip section headers from content if they exist (LLM sometimes includes them despite instructions)
            # FIX: Removed redundant 'import re' - already imported at module level
            # Remove \section, \subsection, \subsubsection commands that match this section's name
            # Remove section command with matching name
            section_content = re.sub(
                rf'\\{cmd}\{{[^}}]*{re.escape(section_name)}[^}}]*\}}\s*\\label{{[^}}]*}}\s*\n?\s*',
                '',
                section_content,
                flags=re.IGNORECASE
            )
            # Remove any section command at the start (even if name doesn't match exactly)
            section_content = re.sub(
                rf'^\\{cmd}\{{[^}}]*\}}\s*\\label{{[^}}]*}}\s*\n?\s*',
                '',
                section_content,
                flags=re.IGNORECASE | re.MULTILINE
            )
            # Also remove section commands without labels
            section_content = re.sub(
                rf'^\\{cmd}\{{[^}}]*\}}\s*\n?\s*',
                '',
                section_content,
                flags=re.IGNORECASE | re.MULTILINE
            )
            section_content = section_content.strip()
            # Sanitize: escape special chars (e.g. R&D -> R\&D) while preserving LaTeX commands
            section_content = self._escape_latex(section_content)

            # Only generate section header if requested (template has no sections)
            if generate_headers:
                section_latex = f"\\{cmd}{{{self._escape_latex(section_name)}}}\n"
                if section_id:
                    section_latex += f"\\label{{sec:{section_id}}}\n\n"
                else:
                    section_latex += "\n"
            
            section_latex += section_content + "\n\n"
            
            # Subsections
            if section.get('subsections'):
                section_latex += self._generate_sections_recursive(
                    section['subsections'],
                    level + 1,
                    generate_headers=generate_headers
                )
            
            latex_parts.append(section_latex)
        
        return "\n".join(latex_parts)
    
    def _escape_latex(self, text: str) -> str:
        """Escape special LaTeX characters while protecting LaTeX commands.

        This keeps existing LaTeX commands intact (including \item, math macros,
        and commands with optional args) while escaping special characters in
        normal text segments. It also protects common math and verbatim blocks.
        """
        if not text:
            return ""

        # FIRST: Convert markdown to LaTeX
        text = self._convert_markdown_to_latex(text)

        def find_balanced(text, start, open_char, close_char):
            """Find end position of balanced delimiters starting at 'start'."""
            if start >= len(text) or text[start] != open_char:
                return start
            depth = 0
            i = start
            while i < len(text):
                if text[i] == open_char:
                    depth += 1
                elif text[i] == close_char:
                    depth -= 1
                    if depth == 0:
                        return i + 1
                elif text[i] == '\\' and i + 1 < len(text):
                    i += 1  # Skip escaped char
                i += 1
            return len(text)

        def collect_protected_spans(text):
            spans = []
            patterns = [
                r'(?<!\\)\$\$.*?(?<!\\)\$\$',
                r'(?<!\\)\$(?!\$).*?(?<!\\)\$',
                r'\\\[.*?\\\]',
                r'\\\(.*?\\\)',
                r'\\begin\{(equation\*?|align\*?|gather\*?|multline\*?|eqnarray\*?|displaymath|math)\}.*?\\end\{\1\}',
                r'\\begin\{(verbatim\*?|lstlisting|minted)\}.*?\\end\{\1\}',
            ]
            for pattern in patterns:
                for match in re.finditer(pattern, text, flags=re.DOTALL):
                    spans.append((match.start(), match.end()))
            spans.sort()
            # Merge overlaps
            merged = []
            for start, end in spans:
                if not merged or start > merged[-1][1]:
                    merged.append([start, end])
                else:
                    merged[-1][1] = max(merged[-1][1], end)
            return [(s, e) for s, e in merged]

        protected_spans = collect_protected_spans(text)
        protected_idx = 0

        def next_protected_start(i):
            nonlocal protected_idx
            while protected_idx < len(protected_spans) and protected_spans[protected_idx][1] <= i:
                protected_idx += 1
            if protected_idx < len(protected_spans) and protected_spans[protected_idx][0] == i:
                return protected_spans[protected_idx]
            return None

        # Find all LaTeX commands and protected spans
        segments = []
        i = 0

        while i < len(text):
            protected = next_protected_start(i)
            if protected:
                segments.append((protected[0], protected[1], True))
                i = protected[1]
                protected_idx += 1
                continue

            if text[i] == '\\' and i + 1 < len(text):
                next_char = text[i + 1]

                # Simple escaped special characters or line breaks
                if next_char in '\\{}&$#_%~^':
                    segments.append((i, i + 2, True))
                    i += 2
                    continue

                # Math delimiters like \[ \] \( \)
                if next_char in '[]()':
                    segments.append((i, i + 2, True))
                    i += 2
                    continue

                # Command name
                if next_char.isalpha() or next_char == '@':
                    j = i + 1
                    while j < len(text) and (text[j].isalpha() or text[j] == '@'):
                        j += 1
                    if j < len(text) and text[j] == '*':
                        j += 1

                    end = j
                    # Capture immediate optional/required args without whitespace
                    while end < len(text) and text[end] in '[{':
                        if text[end] == '[':
                            end = find_balanced(text, end, '[', ']')
                        else:
                            end = find_balanced(text, end, '{', '}')

                    segments.append((i, end, True))
                    i = end
                    continue

            i += 1

        # Build merged segments with regular text
        merged = []
        last_end = 0

        for start, end, is_cmd in segments:
            if start > last_end:
                merged.append((last_end, start, False))
            merged.append((start, end, True))
            last_end = end

        if last_end < len(text):
            merged.append((last_end, len(text), False))

        # Escape only non-command segments
        result = []
        for start, end, is_cmd in merged:
            segment = text[start:end]
            if is_cmd:
                result.append(segment)
            else:
                escaped = []
                for char in segment:
                    if char == '\\':
                        escaped.append(r'\textbackslash{}')
                    elif char == '{':
                        escaped.append(r'\{')
                    elif char == '}':
                        escaped.append(r'\}')
                    elif char == '&':
                        escaped.append(r'\&')
                    elif char == '%':
                        escaped.append(r'\%')
                    elif char == '$':
                        escaped.append(r'\$')
                    elif char == '#':
                        escaped.append(r'\#')
                    elif char == '_':
                        escaped.append(r'\_')
                    elif char == '~':
                        escaped.append(r'\textasciitilde{}')
                    elif char == '^':
                        escaped.append(r'\^{}')
                    else:
                        escaped.append(char)
                result.append(''.join(escaped))

        return ''.join(result)
    
    def _convert_markdown_to_latex(self, text: str) -> str:
        """Convert markdown formatting to LaTeX"""

        lines = text.split('\n')
        result = []
        list_mode = None  # None, "itemize", or "enumerate"

        for line in lines:
            bullet_match = re.match(r'^\s*[-*]\s+(.+)$', line)
            ordered_match = re.match(r'^\s*\d+[.)]\s+(.+)$', line)

            if bullet_match or ordered_match:
                target = "itemize" if bullet_match else "enumerate"
                if list_mode != target:
                    if list_mode:
                        result.append(f'\\end{{{list_mode}}}')
                    result.append(f'\\begin{{{target}}}')
                    list_mode = target
                content = bullet_match.group(1) if bullet_match else ordered_match.group(1)
                result.append(f'    \\item {content}')
                continue

            if list_mode:
                result.append(f'\\end{{{list_mode}}}')
                list_mode = None
            result.append(line)

        if list_mode:
            result.append(f'\\end{{{list_mode}}}')

        text = '\n'.join(result)

        # Convert markdown bold (**text**)
        text = re.sub(r'\*\*(.+?)\*\*', r'\\textbf{\1}', text)

        # Convert markdown italic (*text*)
        text = re.sub(r'(?<!\*)\*([^*]+?)\*(?!\*)', r'\\textit{\1}', text)

        return text

    def _escape_plain_text(self, text: str) -> str:
        """Escape LaTeX special characters in plain text (no LaTeX commands expected)."""
        if not text:
            return ""
        escaped = []
        for char in text:
            if char == '\\':
                escaped.append(r'\textbackslash{}')
            elif char == '{':
                escaped.append(r'\{')
            elif char == '}':
                escaped.append(r'\}')
            elif char == '&':
                escaped.append(r'\&')
            elif char == '%':
                escaped.append(r'\%')
            elif char == '$':
                escaped.append(r'\$')
            elif char == '#':
                escaped.append(r'\#')
            elif char == '_':
                escaped.append(r'\_')
            elif char == '~':
                escaped.append(r'\textasciitilde{}')
            elif char == '^':
                escaped.append(r'\^{}')
            else:
                escaped.append(char)
        return ''.join(escaped)
    
    def _clean_abstract(self, abstract: str) -> str:
        """Clean up abstract formatting (remove markdown, fix LaTeX)"""
        if not abstract:
            return ""
        
        # Remove markdown headers (line-start only)
        abstract = re.sub(r'^\s*#+\s*', '', abstract, flags=re.MULTILINE)
        
        # If it already contains LaTeX commands, assume it's LaTeX and avoid re-escaping
        if re.search(r'\\[A-Za-z]+', abstract):
            abstract = abstract.replace('\r\n', '\n').replace('\r', '\n').strip()
            if abstract and not abstract.endswith('.'):
                abstract += '.'
            return abstract

        # Escape plain text before markdown conversion so special chars are safe
        abstract = self._escape_plain_text(abstract)

        # Convert markdown bold/italic to LaTeX
        abstract = re.sub(r'\*\*(.+?)\*\*', r'\\textbf{\1}', abstract)
        abstract = re.sub(r'(?<!\*)\*([^*]+?)\*(?!\*)', r'\\textit{\1}', abstract)
        
        # Fix line breaks - preserve paragraph breaks but convert single newlines to spaces
        abstract = abstract.replace('\n\n', ' PARAGRAPH_BREAK ')
        abstract = abstract.replace('\n', ' ')
        abstract = abstract.replace(' PARAGRAPH_BREAK ', '\n\n')
        
        # Clean up extra spaces
        abstract = re.sub(r'\s+', ' ', abstract).strip()
        
        # Ensure proper sentence structure
        if abstract and not abstract.endswith('.'):
            abstract += '.'
        
        return abstract
    
    def _replace_individual_sections(self, template: str, sections: List[dict], template_has_sections: bool = False) -> str:
        """Replace individual section placeholders in template
        
        Args:
            template: Template string
            sections: List of section dicts
            template_has_sections: If True, template already has section headers - don't generate new ones
        """
        
        # Check if template has sections (if not provided)
        if not template_has_sections:
            template_has_sections = self._template_has_sections(template)
        
        # Generate sections dynamically from the actual paper data
        sections_latex = ""
        
        for section in sections:
            if isinstance(section, dict):
                section_name = section.get('section_name', section.get('name', ''))
                section_content = section.get('content', '')
                section_id = section.get('section_id', '')
            else:
                section_name = getattr(section, 'section_name', getattr(section, 'name', ''))
                section_content = getattr(section, 'content', '')
                section_id = getattr(section, 'section_id', '')
            
            if section_name and section_content:
                # Strip section headers from content if they exist (LLM sometimes includes them despite instructions)
                # FIX: Removed redundant 'import re' - already imported at module level
                # Remove section command with matching name
                section_content = re.sub(
                    rf'\\section\{{[^}}]*{re.escape(section_name)}[^}}]*\}}\s*\\label{{[^}}]*}}\s*\n?\s*',
                    '',
                    section_content,
                    flags=re.IGNORECASE
                )
                # Remove any section command at the start (even if name doesn't match exactly)
                section_content = re.sub(
                    r'^\\section\{[^}]*\}\s*\\label\{[^}]*\}\s*\n?\s*',
                    '',
                    section_content,
                    flags=re.IGNORECASE | re.MULTILINE
                )
                # Also remove section commands without labels
                section_content = re.sub(
                    r'^\\section\{[^}]*\}\s*\n?\s*',
                    '',
                    section_content,
                    flags=re.IGNORECASE | re.MULTILINE
                )
                section_content = section_content.strip()
                section_content = self._escape_latex(section_content)

                # Only add section header if template has no sections
                if not template_has_sections:
                    sections_latex += f"\\section{{{self._escape_latex(section_name)}}}\n"
                    sections_latex += f"\\label{{sec:{section_id}}}\n\n"
                
                sections_latex += f"{section_content}\n\n"
                
                # Add subsections if they exist
                if section.get('subsections'):
                    sections_latex += self._generate_sections_recursive(
                        section['subsections'],
                        level=2,  # Start at subsection level
                        generate_headers=not template_has_sections
                    )
        
        # Replace the entire sections area with our generated content
        # Find the sections area in the template
        start_marker = "% ------------------------------------------------------------\n% Sections\n% ------------------------------------------------------------"
        end_marker = "% ------------------------------------------------------------\n% References\n% ------------------------------------------------------------"
        
        start_idx = template.find(start_marker)
        end_idx = template.find(end_marker)
        
        if start_idx != -1 and end_idx != -1:
            # Replace everything between the markers
            before_sections = template[:start_idx + len(start_marker)]
            after_sections = template[end_idx:]
            template = before_sections + "\n\n" + sections_latex + after_sections
        
        return template
    
    async def generate_from_project_files(
        self,
        project_data: Dict[str, Any],
        content_summary: Dict[str, Any],
        project_type: str = 'research',
        template_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Generate LaTeX document from project files (equivalent to frontend LaTeXGenerator.generateLaTeX)
        
        Args:
            project_data: Project information (name, description, id, etc.)
            content_summary: Processed file content summary from FileContentProcessor
            project_type: Type of project (research, review, etc.)
            template_data: Optional template data {content, parsed, path}
            
        Returns:
            Dictionary with success, latex content, and metadata
        """
        try:
            print('ðŸ¤– Generating LaTeX from project content...')
            
            if template_data:
                print(f'ðŸ“‹ Using template: {template_data.get("path", "unknown")}')
            
            if not self.llm:
                raise ValueError("LLM not initialized. Cannot generate LaTeX from files.")
            
            # Prepare context for LLM
            context = self._prepare_context(project_data, content_summary, project_type, template_data)
            
            # Generate LaTeX content
            latex_content = await self._generate_content_from_files(context, template_data)
            
            # Generate bibliography (skip if template uses biblatex/natbib)
            bibliography = ''
            if not template_data or template_data.get('parsed', {}).get('bibliographyStyle', {}).get('type') == 'thebibliography':
                bibliography = await self._generate_bibliography_from_references(content_summary.get('references', []), template_data)
            
            # Combine everything
            full_document = self._combine_document_from_files(latex_content, bibliography, project_data, template_data)
            
            # Apply special instructions to LaTeX if provided
            if self.special_instructions:
                full_document = self._apply_special_instructions_to_latex(full_document, project_data)
            
            return {
                'success': True,
                'latex': full_document,
                'metadata': {
                    'projectType': project_type,
                    'sections': self._extract_sections(full_document),
                    'references': len(content_summary.get('references', [])),
                    'wordCount': self._estimate_word_count(full_document),
                    'generatedAt': str(Path(__file__).stat().st_mtime),  # Use file modification time as proxy
                    'usedTemplate': bool(template_data),
                    'usedMemory': False  # Memory system removed
                }
            }
            
        except Exception as error:
            print(f'âŒ Error generating LaTeX: {error}')
            import traceback
            traceback.print_exc()
            return {
                'success': False,
                'error': str(error),
                'latex': self._get_fallback_template(project_data)
            }
    
    def _prepare_context(
        self,
        project_data: Dict[str, Any],
        content_summary: Dict[str, Any],
        project_type: str,
        template_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Prepare context for LLM generation"""
        return {
            'projectName': project_data.get('name', 'Untitled Project'),
            'description': project_data.get('description', ''),
            'projectType': project_type,
            'projectId': project_data.get('id', project_data.get('projectId', '')),
            'templateData': template_data,
            'fileSummary': content_summary.get('summary', ''),
            'keyFiles': content_summary.get('keyFiles', []),
            'references': content_summary.get('references', []),
            'content': (content_summary.get('content', '') or '')[:8000],  # Limit content length
            'totalFiles': content_summary.get('totalFiles', 0),
            'processedFiles': content_summary.get('processedFiles', [])
        }
    
    async def _generate_content_from_files(
        self,
        context: Dict[str, Any],
        template_data: Optional[Dict[str, Any]] = None
    ) -> str:
        """Generate LaTeX content using LLM from file context"""
        system_prompt = self._get_system_prompt_for_files(context['projectType'])
        
        # Add template structure to prompt if available
        if template_data and template_data.get('parsed'):
            parsed = template_data['parsed']
            system_prompt += f"\n\nTEMPLATE STRUCTURE TO FOLLOW:\n"
            system_prompt += f"- Document Class: \\documentclass[{','.join(parsed.get('documentClass', {}).get('options', []))}]{{{parsed.get('documentClass', {}).get('name', 'article')}}}\n"
            system_prompt += f"- Packages ({len(parsed.get('packages', []))} total):\n"
            for pkg in parsed.get('packages', []):
                opts = f"[{','.join(pkg.get('options', []))}]" if pkg.get('options') else ''
                system_prompt += f"  \\usepackage{opts}{{{pkg.get('name', '')}}}\n"
            system_prompt += f"- Bibliography Style: {parsed.get('bibliographyStyle', {}).get('type', 'unknown')} ({parsed.get('bibliographyStyle', {}).get('style', 'unknown')})\n"
            if parsed.get('structure'):
                system_prompt += f"- Document Structure: {len(parsed['structure'])} sections\n"
                for sec in parsed['structure'][:10]:
                    system_prompt += f"  {sec.get('type', 'section')}: {sec.get('title', '')}\n"
            system_prompt += "\nIMPORTANT: Follow the template's document class, packages, and bibliography style exactly.\n"
            system_prompt += "Remove any placeholder content but maintain the structure and formatting.\n"
        
        user_prompt = self._get_user_prompt_for_files(context)
        
        # Call LLM
        from langchain_core.messages import HumanMessage, SystemMessage
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt)
        ]
        
        try:
            response = await self.llm.ainvoke(messages)
            content = response.content if hasattr(response, 'content') else str(response)
            
            # Clean markdown code blocks if present
            content = self._clean_markdown_code_blocks(content)
            
            return content.strip()
        except Exception as error:
            print(f'âŒ LLM generation failed: {error}')
            raise Exception(f'LLM generation failed: {str(error)}')
    
    def _get_system_prompt_for_files(self, project_type: str) -> str:
        """Get system prompt based on project type"""
        base_prompt = """You are an expert LaTeX document generator. Your task is to create a well-structured, academic-quality LaTeX document based on the provided project information and file content.

Requirements:
1. Generate complete LaTeX document with proper structure
2. Include relevant sections based on project type
3. Use proper LaTeX formatting and commands
4. Include citations and references where appropriate
5. Make the content coherent and well-organized
6. Use academic writing style
7. Include proper LaTeX packages and document class

Project Type: """ + project_type
        
        type_specific_prompts = {
            'research': """
For a research article, include:
- Abstract
- Introduction
- Methodology/Implementation
- Results/Analysis
- Discussion
- Conclusion
- References

Focus on the technical implementation and findings from the code analysis.""",
            
            'review': """
For a review article, include:
- Abstract
- Introduction
- Literature Review
- Analysis of Technologies/Methods Used
- Comparison and Evaluation
- Conclusion
- References

Focus on analyzing and comparing different approaches found in the code.""",
            
            'project': """
For a project report, include:
- Abstract
- Introduction
- Project Overview
- Technical Implementation
- Features and Functionality
- Testing and Results
- Conclusion
- References

Focus on the project's purpose, implementation, and outcomes.""",
            
            'blog': """
For a blog post, include:
- Introduction
- Main Content (with subsections)
- Examples and Code Snippets
- Conclusion
- References

Use a more casual, informative tone while maintaining technical accuracy."""
        }
        
        return base_prompt + type_specific_prompts.get(project_type, type_specific_prompts['research'])
    
    def _get_user_prompt_for_files(self, context: Dict[str, Any]) -> str:
        """Get user prompt with project context"""
        key_files_str = '\n'.join([
            f"- {f.get('name', 'unknown')} ({f.get('language', 'unknown')}, {f.get('lines', 0)} lines)"
            for f in context.get('keyFiles', [])[:10]
        ])
        
        references_str = '\n'.join([
            f"- {r.get('type', 'unknown')}: {r.get('value', 'unknown')}"
            for r in context.get('references', [])[:10]
        ])
        
        return f"""Please generate a LaTeX document for the following project:

Project Name: {context.get('projectName', 'Untitled Project')}
Description: {context.get('description', 'No description provided')}
Project Type: {context.get('projectType', 'research')}

File Analysis Summary:
{context.get('fileSummary', 'No file analysis available')}

Key Files Found:
{key_files_str if key_files_str else 'No key files found'}

References Found:
{references_str if references_str else 'No references found'}

Content Sample:
{context.get('content', '')[:2000]}...

Please generate a complete LaTeX document that:
1. Reflects the actual content and purpose of this project
2. Includes relevant technical details from the code analysis
3. Uses proper academic structure
4. Incorporates the found references appropriately
5. Is well-written and coherent

Generate the complete LaTeX document now."""
    
    async def _generate_bibliography_from_references(
        self,
        references: List[Dict[str, Any]],
        template_data: Optional[Dict[str, Any]] = None
    ) -> str:
        """Generate bibliography from references"""
        if not references:
            return self._get_default_bibliography()
        
        try:
            system_prompt = "You are an expert at creating LaTeX bibliographies. Generate a proper bibliography section with the given references."
            
            user_prompt = "Please create a LaTeX bibliography section for these references:\n\n"
            for i, ref in enumerate(references[:20], 1):  # Limit to 20 references
                user_prompt += f"{i}. {ref.get('type', 'unknown')}: {ref.get('value', 'unknown')} (from {ref.get('source', 'unknown')})\n"
            user_prompt += "\nGenerate a proper \\begin{thebibliography} section with appropriate formatting."
            
            from langchain_core.messages import HumanMessage, SystemMessage
            messages = [
                SystemMessage(content=system_prompt),
                HumanMessage(content=user_prompt)
            ]
            
            response = await self.llm.ainvoke(messages)
            content = response.content if hasattr(response, 'content') else str(response)
            
            # Clean markdown code blocks
            content = self._clean_markdown_code_blocks(content)
            
            return content.strip()
        except Exception as error:
            print(f'âŒ Bibliography generation failed: {error}')
            return self._get_default_bibliography()
    
    def _get_default_bibliography(self) -> str:
        """Get default bibliography template"""
        return """\\begin{thebibliography}{99}
\\bibitem{ref1} Project Documentation and Code Analysis
\\bibitem{ref2} Technical Implementation Details
\\end{thebibliography}"""
    
    def _combine_document_from_files(
        self,
        content: str,
        bibliography: str,
        project_data: Dict[str, Any],
        template_data: Optional[Dict[str, Any]] = None
    ) -> str:
        """Combine LaTeX document parts"""
        # If template is provided, use its preamble
        if template_data and template_data.get('parsed'):
            parsed = template_data['parsed']
            
            # Build preamble from template
            preamble = parsed.get('preamble', '')
            
            # If template already has full content, use it directly
            if template_data.get('content'):
                return content
            
            # Otherwise combine with template structure
            return f"""{preamble}

\\begin{{document}}

{content}

{bibliography}

\\end{{document}}"""
        
        # Default behavior without template
        document_class = self._get_document_class_for_files(project_data.get('type', 'research'))
        packages = self._get_required_packages()
        
        return f"""\\documentclass{{{document_class}}}

{packages}

\\title{{{self._escape_latex(project_data.get('name', 'Untitled Project'))}}}
\\author{{Generated by GenLaTeX}}
\\date{{\\today}}

\\begin{{document}}

\\maketitle

{content}

{bibliography}

\\end{{document}}"""
    
    def _get_document_class_for_files(self, project_type: str) -> str:
        """Get document class based on project type"""
        classes = {
            'research': 'article',
            'review': 'article',
            'project': 'report',
            'blog': 'article'
        }
        return classes.get(project_type, 'article')
    
    def _get_required_packages(self) -> str:
        """Get required LaTeX packages"""
        return """\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath}
\\usepackage{amsfonts}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\usepackage{url}
\\usepackage{listings}
\\usepackage{xcolor}
\\usepackage{geometry}
\\geometry{top=0.5in, bottom=1in, left=1in, right=1in}"""
    
    def _extract_sections(self, latex: str) -> List[str]:
        """Extract sections from LaTeX document"""
        if not latex:
            return []
        
        section_regex = r'\\(?:section|subsection|subsubsection)\*?\{([^}]+)\}'
        sections = []
        for match in re.finditer(section_regex, latex):
            sections.append(match.group(1))
        
        return sections
    
    def _estimate_word_count(self, latex: str) -> int:
        """Estimate word count from LaTeX content"""
        if not latex:
            return 0
        
        # Remove LaTeX commands and count words
        text = latex
        text = re.sub(r'\\[a-zA-Z]+\{[^}]*\}', '', text)  # Remove commands with braces
        text = re.sub(r'\\[a-zA-Z]+', '', text)  # Remove other commands
        text = re.sub(r'[{}]', '', text)  # Remove braces
        text = re.sub(r'\s+', ' ', text)  # Normalize whitespace
        text = text.strip()
        
        return len(text.split()) if text else 0
    
    def _get_fallback_template(self, project_data: Dict[str, Any]) -> str:
        """Get fallback template when generation fails"""
        return f"""\\documentclass{{article}}

\\usepackage[utf8]{{inputenc}}
\\usepackage[T1]{{fontenc}}
\\usepackage{{amsmath}}
\\usepackage{{amsfonts}}
\\usepackage{{amssymb}}
\\usepackage{{graphicx}}
\\usepackage{{hyperref}}
\\usepackage{{url}}
\\usepackage{{geometry}}
\\geometry{{top=0.5in, bottom=1in, left=1in, right=1in}}

\\title{{{self._escape_latex(project_data.get('name', 'Untitled Project'))}}}
\\author{{Generated by GenLaTeX}}
\\date{{\\today}}

\\begin{{document}}

\\maketitle

\\begin{{abstract}}
{project_data.get('description', 'This document was generated from project files and content analysis.')}
\\end{{abstract}}

\\section{{Introduction}}
This document presents an analysis of the project: {self._escape_latex(project_data.get('name', 'Untitled Project'))}.

\\section{{Project Overview}}
{project_data.get('description', 'The project details and implementation are described below.')}

\\section{{Conclusion}}
This analysis provides insights into the project structure and implementation.

\\begin{{thebibliography}}{{99}}
\\bibitem{{ref1}} Project Documentation and Code Analysis
\\end{{thebibliography}}

\\end{{document}}"""

    def _generate_images_from_memory(self, paper_data: dict) -> str:
        """Generate LaTeX code for images from memory system (DISABLED - memory system removed)"""
        # Memory system removed - always return empty
        return ""
"""
            if not all_images:
                return ""
            
            latex_code = []
            latex_code.append("% Images from memory system")
            latex_code.append("\\usepackage{graphicx}")
            latex_code.append("\\usepackage{float}")
            latex_code.append("")
            
            # Group images by category
            figures = [img for img in all_images if img.get('category') == 'figures']
            tables = [img for img in all_images if img.get('category') == 'tables']
            diagrams = [img for img in all_images if img.get('category') == 'diagrams']
            
            # Generate figures
            if figures:
                latex_code.append("% Figures")
                for i, img in enumerate(figures):  # Use all available figures
                    figure_id = f"fig:memory_{i+1}"
                    caption = img.get('latex_caption', img.get('title', f'Figure {i+1}'))
                    label = img.get('latex_label', figure_id)
                    
                    latex_code.append(f"\\begin{{figure}}[H]")
                    latex_code.append(f"\\centering")
                    latex_code.append(f"\\includegraphics[width=0.8\\textwidth]{{images/{img['image_id']}.jpg}}")
                    latex_code.append(f"\\caption{{{self._escape_latex(caption)}}}")
                    latex_code.append(f"\\label{{{label}}}")
                    latex_code.append(f"\\end{{figure}}")
                    latex_code.append("")
            
            # Generate tables (if any)
            if tables:
                latex_code.append("% Tables")
                for i, img in enumerate(tables):  # Use all available tables
                    table_id = f"tab:memory_{i+1}"
                    caption = img.get('latex_caption', img.get('title', f'Table {i+1}'))
                    label = img.get('latex_label', table_id)
                    
                    latex_code.append(f"\\begin{{table}}[H]")
                    latex_code.append(f"\\centering")
                    latex_code.append(f"\\caption{{{self._escape_latex(caption)}}}")
                    latex_code.append(f"\\label{{{label}}}")
                    latex_code.append(f"\\begin{{tabular}}{{l|l}}")
                    latex_code.append(f"\\hline")
                    latex_code.append(f"Description & {self._escape_latex(img.get('description', 'N/A'))} \\\\")
                    latex_code.append(f"\\hline")
                    latex_code.append(f"\\end{{tabular}}")
                    latex_code.append(f"\\end{{table}}")
                    latex_code.append("")
            
            # Generate diagrams
            if diagrams:
                latex_code.append("% Diagrams")
                for i, img in enumerate(diagrams):  # Use all available diagrams
                    diagram_id = f"diag:memory_{i+1}"
                    caption = img.get('latex_caption', img.get('title', f'Diagram {i+1}'))
                    label = img.get('latex_label', diagram_id)
                    
                    latex_code.append(f"\\begin{{figure}}[H]")
                    latex_code.append(f"\\centering")
                    latex_code.append(f"\\includegraphics[width=0.6\\textwidth]{{images/{img['image_id']}.jpg}}")
                    latex_code.append(f"\\caption{{{self._escape_latex(caption)}}}")
                    latex_code.append(f"\\label{{{label}}}")
                    latex_code.append(f"\\end{{figure}}")
                    latex_code.append("")
            
            return "\n".join(latex_code)
            
        except Exception as e:
            import logging
            logging.warning(f"Failed to generate images from memory: {e}")
            return ""
"""
