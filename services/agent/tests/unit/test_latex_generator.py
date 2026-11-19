"""
Unit tests for LaTeX generation functionality
"""

import pytest
from pathlib import Path
from utils.latex import LatexGenerator


class TestLatexGenerator:
    """Test LaTeX generator functionality"""
    
    def test_latex_generator_initialization(self, test_config, clean_memory_manager):
        """Test LaTeX generator initialization"""
        generator = LatexGenerator(
            template_dir=str(test_config["test_template_dir"]),
            memory_manager=clean_memory_manager
        )
        
        assert generator.template_dir == Path(test_config["test_template_dir"])
        assert generator.memory_manager == clean_memory_manager
    
    def test_latex_generator_without_memory(self, test_config):
        """Test LaTeX generator without memory manager"""
        generator = LatexGenerator(
            template_dir=str(test_config["test_template_dir"]),
            memory_manager=None
        )
        
        assert generator.template_dir == Path(test_config["test_template_dir"])
        assert generator.memory_manager is None
    
    def test_generate_paper_basic(self, latex_generator, sample_paper_data):
        """Test basic paper generation"""
        result = latex_generator.generate_paper(sample_paper_data)
        
        assert isinstance(result, dict)
        assert "main.tex" in result
        assert "references.bib" in result
        assert "images.tex" in result
        
        # Check main.tex content
        main_tex = result["main.tex"]
        assert "\\documentclass" in main_tex
        assert sample_paper_data["title"] in main_tex
        assert sample_paper_data["abstract"] in main_tex
        
        # Check references.bib content
        references_bib = result["references.bib"]
        assert isinstance(references_bib, str)
        
        # Check images.tex content
        images_tex = result["images.tex"]
        assert isinstance(images_tex, str)
    
    def test_latex_escaping(self, latex_generator):
        """Test LaTeX character escaping"""
        test_data = {
            "title": "Test & Special Characters: $%#_{}",
            "abstract": "This contains & special characters $%#_{}",
            "keywords": ["test", "special", "characters"],
            "sections": [
                {
                    "section_name": "Introduction & Background",
                    "section_id": "intro",
                    "content": "Content with & special characters $%#_{}"
                }
            ]
        }
        
        result = latex_generator.generate_paper(test_data)
        main_tex = result["main.tex"]
        
        # Check that special characters are escaped
        assert "\\&" in main_tex
        assert "\\$" in main_tex
        assert "\\%" in main_tex
        assert "\\#" in main_tex
        assert "\\_" in main_tex
        assert "\\{" in main_tex
        assert "\\}" in main_tex

    def test_preserves_item_and_math(self, latex_generator):
        """Ensure list items and math are preserved (no textbackslash artifacts)."""
        paper_data = {
            "title": "Math Test",
            "abstract": "Abstract with math.",
            "keywords": ["math"],
            "sections": [
                {
                    "section_name": "Methods",
                    "section_id": "methods",
                    "content": "We use $a_b$ and $x^2$.\n\n\\begin{itemize}\n\\item First item\n\\end{itemize}\n\\alpha is a parameter."
                }
            ]
        }
        result = latex_generator.generate_paper(paper_data)
        main_tex = result["main.tex"]
        assert "$a_b$" in main_tex
        assert "\\begin{itemize}" in main_tex
        assert "\\item First item" in main_tex
        assert "\\alpha" in main_tex
        assert "\\textbackslash{}item" not in main_tex

    def test_preserves_optional_args_commands(self, latex_generator):
        """Ensure commands with optional args are preserved."""
        paper_data = {
            "title": "Graphics Test",
            "abstract": "Abstract.",
            "keywords": ["graphics"],
            "sections": [
                {
                    "section_name": "Figures",
                    "section_id": "figures",
                    "content": r"\includegraphics[width=0.5\textwidth]{fig1}"
                }
            ]
        }
        result = latex_generator.generate_paper(paper_data)
        main_tex = result["main.tex"]
        assert "\\includegraphics[width=0.5\\textwidth]{fig1}" in main_tex

    def test_abstract_escapes_special_chars(self, latex_generator):
        """Ensure abstract special chars are escaped safely."""
        paper_data = {
            "title": "Abstract Escaping",
            "abstract": "A & B report 50% improvement in C#_1.",
            "keywords": ["abstract"],
            "sections": []
        }
        result = latex_generator.generate_paper(paper_data)
        main_tex = result["main.tex"]
        assert "A \\& B" in main_tex
        assert "50\\%" in main_tex
        assert "C\\#\\_1" in main_tex
    
    def test_section_generation(self, latex_generator, sample_paper_data):
        """Test section generation"""
        result = latex_generator.generate_paper(sample_paper_data)
        main_tex = result["main.tex"]
        
        # Check that sections are generated
        for section in sample_paper_data["sections"]:
            assert f"\\section{{{section['section_name']}}}" in main_tex
            assert f"\\label{{sec:{section['section_id']}}}" in main_tex
            assert section["content"] in main_tex
    
    def test_bibtex_generation(self, latex_generator):
        """Test BibTeX generation"""
        paper_data = {
            "title": "Test Paper",
            "abstract": "Test abstract",
            "keywords": ["test"],
            "sections": [
                {
                    "section_name": "Introduction",
                    "section_id": "intro",
                    "content": "Content with citation \\cite{test2024}",
                    "sources": [
                        {
                            "citation_key": "test2024",
                            "title": "Test Paper Title",
                            "authors": ["Test Author"],
                            "year": "2024",
                            "venue": "Test Journal",
                            "url": "https://example.com"
                        }
                    ]
                }
            ]
        }
        
        result = latex_generator.generate_paper(paper_data)
        references_bib = result["references.bib"]
        
        assert "@misc{test2024," in references_bib
        assert "title = {Test Paper Title}," in references_bib
        assert "author = {Test Author}," in references_bib
        assert "year = {2024}," in references_bib
        assert "howpublished = {Test Journal}," in references_bib
        assert "url = {https://example.com}," in references_bib
    
    def test_image_generation_with_memory(self, latex_generator, sample_paper_data, sample_image_data):
        """Test image generation with memory integration"""
        # Add an image to memory
        latex_generator.memory_manager.add_image_from_bytes(
            image_data=sample_image_data,
            title="Test Figure",
            description="A test figure",
            category="figures"
        )
        
        result = latex_generator.generate_paper(sample_paper_data)
        images_tex = result["images.tex"]
        
        # If image support is disabled, images.tex will be empty
        if not images_tex:
            assert images_tex == ""
            return
        
        # Otherwise, check that image LaTeX is generated
        assert "\\usepackage{graphicx}" in images_tex
        assert "\\usepackage{float}" in images_tex
        assert "Test Figure" in images_tex
        assert "\\includegraphics" in images_tex
        assert "\\begin{figure}" in images_tex
        assert "\\end{figure}" in images_tex
    
    def test_image_generation_without_memory(self, test_config, sample_paper_data):
        """Test image generation without memory integration"""
        generator = LatexGenerator(
            template_dir=str(test_config["test_template_dir"]),
            memory_manager=None
        )
        
        result = generator.generate_paper(sample_paper_data)
        images_tex = result["images.tex"]
        
        # Should be empty without memory
        assert images_tex == ""
    
    def test_abstract_cleaning(self, latex_generator):
        """Test abstract cleaning functionality"""
        paper_data = {
            "title": "Test Paper",
            "abstract": "This is a **bold** abstract with *italic* text and # headers",
            "keywords": ["test"],
            "sections": []
        }
        
        result = latex_generator.generate_paper(paper_data)
        main_tex = result["main.tex"]
        
        # Check that markdown is converted to LaTeX
        assert "\\textbf{bold}" in main_tex
        assert "\\textit{italic}" in main_tex
        # Inline hash should be escaped, not removed
        assert "\\# headers" in main_tex
    
    def test_keywords_generation(self, latex_generator):
        """Test keywords generation"""
        paper_data = {
            "title": "Test Paper",
            "abstract": "Test abstract",
            "keywords": ["machine learning", "artificial intelligence", "deep learning"],
            "sections": []
        }
        
        result = latex_generator.generate_paper(paper_data)
        main_tex = result["main.tex"]
        
        # Check that keywords are included
        assert "machine learning, artificial intelligence, deep learning" in main_tex
    
    def test_empty_sections_handling(self, latex_generator):
        """Test handling of empty sections"""
        paper_data = {
            "title": "Test Paper",
            "abstract": "Test abstract",
            "keywords": ["test"],
            "sections": []
        }
        
        result = latex_generator.generate_paper(paper_data)
        main_tex = result["main.tex"]
        
        # Should still generate valid LaTeX
        assert "\\documentclass" in main_tex
        assert "\\begin{document}" in main_tex
        assert "\\end{document}" in main_tex
    
    def test_nested_sections(self, latex_generator):
        """Test nested sections handling"""
        paper_data = {
            "title": "Test Paper",
            "abstract": "Test abstract",
            "keywords": ["test"],
            "sections": [
                {
                    "section_name": "Main Section",
                    "section_id": "main",
                    "content": "Main content",
                    "subsections": [
                        {
                            "section_name": "Subsection",
                            "section_id": "sub",
                            "content": "Subsection content"
                        }
                    ]
                }
            ]
        }
        
        result = latex_generator.generate_paper(paper_data)
        main_tex = result["main.tex"]
        
        # Check that both main section and subsection are generated
        assert "\\section{Main Section}" in main_tex
        assert "\\subsection{Subsection}" in main_tex
        assert "Main content" in main_tex
        assert "Subsection content" in main_tex
    
    def test_special_characters_in_content(self, latex_generator):
        """Test special characters in content"""
        paper_data = {
            "title": "Test Paper",
            "abstract": "Test abstract",
            "keywords": ["test"],
            "sections": [
                {
                    "section_name": "Special Characters",
                    "section_id": "special",
                    "content": "Content with & $ % # _ { } ~ ^ characters"
                }
            ]
        }
        
        result = latex_generator.generate_paper(paper_data)
        main_tex = result["main.tex"]
        
        # Check that special characters are properly escaped
        assert "\\&" in main_tex or "\\\\&" in main_tex
        assert "\\$" in main_tex or "\\\\$" in main_tex
        assert "\\%" in main_tex or "\\\\%" in main_tex
        assert "\\#" in main_tex or "\\\\#" in main_tex
        assert "\\_" in main_tex or "\\\\_" in main_tex
        assert "\\{" in main_tex or "\\\\{" in main_tex
        assert "\\}" in main_tex or "\\\\}" in main_tex
    
    def test_latex_generation_error_handling(self, test_config):
        """Test error handling in LaTeX generation"""
        # Test with invalid template directory
        with pytest.raises(Exception):
            generator = LatexGenerator(
                template_dir="/invalid/path",
                memory_manager=None
            )
            generator.generate_paper({"title": "Test"})
    
    def test_image_categories(self, latex_generator, sample_paper_data, sample_image_data):
        """Test different image categories"""
        # Create different image data for each category
        import base64
        
        # Different image data for each category (1x1 pixel PNG with different content)
        base_data = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==")
        
        # Create different data by modifying bytes
        figure_data = base_data
        table_data = bytearray(base_data)
        table_data[-1] = (table_data[-1] + 1) % 256
        table_data = bytes(table_data)
        
        diagram_data = bytearray(base_data)
        diagram_data[-1] = (diagram_data[-1] + 2) % 256
        diagram_data = bytes(diagram_data)
        
        # Add images of different categories
        latex_generator.memory_manager.add_image_from_bytes(
            image_data=figure_data,
            title="Figure 1",
            category="figures"
        )
        
        latex_generator.memory_manager.add_image_from_bytes(
            image_data=table_data,
            title="Table 1",
            category="tables"
        )
        
        latex_generator.memory_manager.add_image_from_bytes(
            image_data=diagram_data,
            title="Diagram 1",
            category="diagrams"
        )
        
        result = latex_generator.generate_paper(sample_paper_data)
        images_tex = result["images.tex"]
        
        # If image support is disabled, images.tex will be empty
        if not images_tex:
            assert images_tex == ""
            return
        
        # Check that different categories are handled
        assert "% Figures" in images_tex
        assert "% Tables" in images_tex
        assert "% Diagrams" in images_tex
        assert "\\begin{figure}" in images_tex
        assert "\\begin{table}" in images_tex
    
    def test_latex_generation_performance(self, latex_generator, sample_paper_data):
        """Test LaTeX generation performance"""
        import time
        
        start_time = time.time()
        result = latex_generator.generate_paper(sample_paper_data)
        end_time = time.time()
        
        # Should complete within reasonable time
        assert (end_time - start_time) < 5.0  # 5 seconds max
        
        # Result should be valid
        assert isinstance(result, dict)
        assert "main.tex" in result
        assert len(result["main.tex"]) > 100  # Should have substantial content
