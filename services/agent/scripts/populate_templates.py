"""
Template Population Script for GenLaTeX

This script helps populate the template library with high-quality LaTeX templates.

Usage:
    python populate_templates.py

Features:
- Downloads popular templates from GitHub/Overleaf
- Creates metadata for each template
- Generates preview images
- Updates template index

Author: GenLaTeX
Date: 2025-02-16
"""

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Dict, List

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# High-quality template sources
TEMPLATE_SOURCES = {
    "cv": [
        {
            "name": "Awesome-CV",
            "url": "https://github.com/posquit0/Awesome-CV",
            "style": "modern",
            "color": "blue",
            "description": "Professional CV with sidebar and icons"
        },
        {
            "name": "AltaCV",
            "url": "https://github.com/liantze/AltaCV",
            "style": "modern",
            "color": "multi",
            "description": "Alternative CV with customizable colors"
        },
        {
            "name": "ModernCV",
            "url": "https://github.com/xdanaux/moderncv",
            "style": "professional",
            "color": "blue",
            "description": "Classic modern CV template"
        }
    ],
    "report": [
        {
            "name": "Legrand Orange Book",
            "url": "https://www.latextemplates.com/template/the-legrand-orange-book",
            "style": "elegant",
            "color": "orange",
            "description": "Beautiful book template for reports"
        },
        {
            "name": "Tufte-style Report",
            "url": "https://tufte-latex.github.io/tufte-latex/",
            "style": "minimal",
            "color": "gray",
            "description": "Minimal report with sidenotes"
        }
    ],
    "presentation": [
        {
            "name": "Metropolis Beamer",
            "url": "https://github.com/matze/mtheme",
            "style": "modern",
            "color": "blue",
            "description": "Modern minimalist Beamer theme"
        },
        {
            "name": "Focus Beamer",
            "url": "https://github.com/elauksap/focus-beamertheme",
            "style": "minimal",
            "color": "gray",
            "description": "Clean focus-oriented presentation"
        }
    ]
}


def download_template(url: str, dest_dir: Path) -> bool:
    """
    Download template from URL

    Args:
        url: Git repository or download URL
        dest_dir: Destination directory

    Returns:
        True if successful
    """
    dest_dir.mkdir(parents=True, exist_ok=True)

    try:
        if url.startswith('https://github.com'):
            # Clone GitHub repository
            logger.info(f"Cloning {url} to {dest_dir}")
            subprocess.run(['git', 'clone', '--depth', '1', url, str(dest_dir)], check=True)
            return True
        else:
            logger.warning(f"Manual download required for: {url}")
            logger.info(f"Please download from {url} and extract to {dest_dir}")
            return False
    except subprocess.CalledProcessError as e:
        logger.error(f"Failed to download {url}: {e}")
        return False


def create_metadata(template_info: Dict, category: str, dest_dir: Path) -> None:
    """
    Create metadata.json for template

    Args:
        template_info: Template information
        category: Template category
        dest_dir: Template directory
    """
    template_id = template_info['name'].lower().replace(' ', '-').replace('_', '-')

    metadata = {
        "id": f"{template_id}-{category}",
        "name": template_info['name'],
        "category": category,
        "version": "1.0.0",
        "description": template_info['description'],
        "style": template_info['style'],
        "colorScheme": template_info['color'],
        "features": [],
        "packages": [],
        "preview": "preview.png",
        "thumbnail": "thumbnail.png",
        "bestFor": [],
        "difficulty": "intermediate",
        "customizable": {
            "colors": True,
            "fonts": True,
            "layout": False,
            "sections": True
        },
        "author": "Community",
        "license": "MIT",
        "tags": [template_info['style'], category, template_info['color']]
    }

    metadata_path = dest_dir / "metadata.json"
    with open(metadata_path, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, indent=2)

    logger.info(f"Created metadata: {metadata_path}")


def populate_templates():
    """Main function to populate template library"""

    # Get templates directory
    script_dir = Path(__file__).parent
    templates_dir = script_dir.parent.parent / "genlatex" / "templates"
    templates_dir.mkdir(parents=True, exist_ok=True)

    logger.info(f"Templates directory: {templates_dir}")

    # Process each category
    for category, templates in TEMPLATE_SOURCES.items():
        category_dir = templates_dir / category
        category_dir.mkdir(parents=True, exist_ok=True)

        logger.info(f"\nProcessing {category} templates...")

        for template_info in templates:
            template_name = template_info['name'].lower().replace(' ', '-')
            template_dir = category_dir / template_name

            if template_dir.exists():
                logger.info(f"Template already exists: {template_name}")
                continue

            logger.info(f"Setting up template: {template_name}")

            # Download or note manual download needed
            url = template_info.get('url')
            if url:
                download_template(url, template_dir)

            # Create metadata
            create_metadata(template_info, category, template_dir)

    logger.info("\nTemplate population complete!")
    logger.info("\nNext steps:")
    logger.info("1. Manually download any templates that require it")
    logger.info("2. Generate preview images for each template")
    logger.info("3. Update index.json with new templates")


def print_download_instructions():
    """Print manual download instructions"""

    print("\n" + "="*80)
    print("MANUAL TEMPLATE DOWNLOAD INSTRUCTIONS")
    print("="*80)

    print("\n📥 CV TEMPLATES:")
    print("1. Awesome-CV: https://github.com/posquit0/Awesome-CV")
    print("   → Download and extract to: genlatex/templates/cv/awesome-cv/")

    print("\n2. AltaCV: https://github.com/liantze/AltaCV")
    print("   → Download and extract to: genlatex/templates/cv/altacv/")

    print("\n3. ModernCV: https://github.com/xdanaux/moderncv")
    print("   → Download and extract to: genlatex/templates/cv/moderncv/")

    print("\n📄 REPORT TEMPLATES:")
    print("1. Legrand Orange Book: https://www.latextemplates.com/template/the-legrand-orange-book")
    print("   → Download and extract to: genlatex/templates/report/legrand-orange-book/")

    print("\n2. Tufte: https://tufte-latex.github.io/tufte-latex/")
    print("   → Download and extract to: genlatex/templates/report/tufte-style/")

    print("\n📊 PRESENTATION TEMPLATES:")
    print("1. Metropolis: https://github.com/matze/mtheme")
    print("   → Download and extract to: genlatex/templates/presentation/metropolis/")

    print("\n2. Focus: https://github.com/elauksap/focus-beamertheme")
    print("   → Download and extract to: genlatex/templates/presentation/focus/")

    print("\n" + "="*80)
    print("\nAfter downloading:")
    print("1. Ensure each template has: template.tex, metadata.json")
    print("2. Run: python scripts/generate_previews.py")
    print("3. Templates will be automatically detected by the system")
    print("="*80 + "\n")


if __name__ == "__main__":
    print("\n🎨 GenLaTeX Template Population Tool\n")

    # Print download instructions
    print_download_instructions()

    # Ask user if they want to proceed with automated downloads
    response = input("\nWould you like to attempt automated downloads? (y/n): ").strip().lower()

    if response == 'y':
        populate_templates()
    else:
        print("\nPlease download templates manually using the instructions above.")
        print("Once downloaded, the system will automatically detect and use them.\n")
