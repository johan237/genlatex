"""
Create metadata.json files for downloaded templates

Usage: python scripts/create_metadata.py
"""

import json
import os
import sys
from pathlib import Path

# Set UTF-8 encoding for console output
if sys.platform == 'win32':
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

# Metadata definitions for downloaded templates
TEMPLATE_METADATA = {
    # CV Templates
    "cv/awesome-cv": {
        "id": "awesome-cv",
        "name": "Awesome CV",
        "category": "cv",
        "version": "1.0.0",
        "description": "A modern CV template with icons, sidebar, and professional styling. Perfect for tech professionals.",
        "style": "modern",
        "colorScheme": "blue",
        "features": ["sidebar", "icons", "timeline", "two-column", "customizable-colors"],
        "packages": ["fontawesome5", "xcolor", "geometry", "hyperref"],
        "preview": "preview.png",
        "thumbnail": "thumbnail.png",
        "bestFor": ["software-engineers", "designers", "product-managers", "tech-professionals"],
        "difficulty": "beginner",
        "customizable": {
            "colors": True,
            "fonts": True,
            "layout": False,
            "sections": True
        },
        "author": "Claud D. Park",
        "license": "LaTeX Project Public License",
        "tags": ["modern", "professional", "icons", "tech", "colorful", "sidebar"]
    },
    "cv/altacv": {
        "id": "altacv",
        "name": "AltaCV",
        "category": "cv",
        "version": "1.0.0",
        "description": "Alternative CV template with timeline, skill bars, and modern layout. Highly customizable colors.",
        "style": "modern",
        "colorScheme": "multi",
        "features": ["timeline", "skill-bars", "icons", "customizable-colors", "sidebar"],
        "packages": ["fontawesome5", "tikz", "xcolor", "geometry"],
        "preview": "preview.png",
        "thumbnail": "thumbnail.png",
        "bestFor": ["designers", "creative-professionals", "developers", "managers"],
        "difficulty": "intermediate",
        "customizable": {
            "colors": True,
            "fonts": True,
            "layout": True,
            "sections": True
        },
        "author": "LianTze Lim",
        "license": "LaTeX Project Public License",
        "tags": ["modern", "creative", "timeline", "colorful", "customizable"]
    },
    "cv/moderncv": {
        "id": "moderncv",
        "name": "ModernCV",
        "category": "cv",
        "version": "1.0.0",
        "description": "Classic modern CV template with multiple style variations. Well-established and widely used.",
        "style": "professional",
        "colorScheme": "blue",
        "features": ["multiple-styles", "icons", "professional", "classic"],
        "packages": ["moderncv", "fontawesome5"],
        "preview": "preview.png",
        "thumbnail": "thumbnail.png",
        "bestFor": ["professionals", "academics", "managers", "consultants"],
        "difficulty": "beginner",
        "customizable": {
            "colors": True,
            "fonts": True,
            "layout": False,
            "sections": True
        },
        "author": "Xavier Danaux",
        "license": "LaTeX Project Public License",
        "tags": ["professional", "classic", "modern", "established", "icons"]
    },
    "cv/deedy-resume": {
        "id": "deedy-resume",
        "name": "Deedy Resume",
        "category": "cv",
        "version": "1.0.0",
        "description": "Single-page elegant resume with clean typography and minimal design. Perfect for one-page resumes.",
        "style": "minimal",
        "colorScheme": "gray",
        "features": ["single-page", "minimal", "elegant", "clean-typography"],
        "packages": ["fontspec", "geometry", "hyperref"],
        "preview": "preview.png",
        "thumbnail": "thumbnail.png",
        "bestFor": ["students", "entry-level", "job-seekers", "minimal-design"],
        "difficulty": "beginner",
        "customizable": {
            "colors": True,
            "fonts": True,
            "layout": False,
            "sections": True
        },
        "author": "Debarghya Das",
        "license": "Apache License 2.0",
        "tags": ["minimal", "elegant", "single-page", "clean", "simple"]
    },

    # Presentation Templates
    "presentation/metropolis": {
        "id": "metropolis-presentation",
        "name": "Metropolis Beamer Theme",
        "category": "presentation",
        "version": "1.0.0",
        "description": "Modern minimalist Beamer theme inspired by Google's Material Design. Clean and professional.",
        "style": "modern",
        "colorScheme": "blue",
        "features": ["minimal", "modern", "material-design", "clean"],
        "packages": ["beamer", "tikz", "xcolor"],
        "preview": "preview.png",
        "thumbnail": "thumbnail.png",
        "bestFor": ["business", "tech-talks", "conferences", "academic"],
        "difficulty": "beginner",
        "customizable": {
            "colors": True,
            "fonts": True,
            "layout": False,
            "sections": True
        },
        "author": "Matthias Vogelgesang",
        "license": "Creative Commons",
        "tags": ["modern", "minimal", "material-design", "professional", "clean"]
    },
    "presentation/focus": {
        "id": "focus-presentation",
        "name": "Focus Beamer Theme",
        "category": "presentation",
        "version": "1.0.0",
        "description": "Clean, focused Beamer theme with minimal distractions. Perfect for technical presentations.",
        "style": "minimal",
        "colorScheme": "gray",
        "features": ["minimal", "clean", "focused", "technical"],
        "packages": ["beamer", "tikz"],
        "preview": "preview.png",
        "thumbnail": "thumbnail.png",
        "bestFor": ["academic", "technical", "research", "conferences"],
        "difficulty": "beginner",
        "customizable": {
            "colors": True,
            "fonts": True,
            "layout": False,
            "sections": True
        },
        "author": "Pasquale Africa",
        "license": "GPL-3.0",
        "tags": ["minimal", "focused", "clean", "technical", "academic"]
    },
    "presentation/auriga": {
        "id": "auriga-presentation",
        "name": "Auriga Beamer Theme",
        "category": "presentation",
        "version": "1.0.0",
        "description": "Beautiful modern Beamer theme with elegant styling. Great for professional presentations.",
        "style": "elegant",
        "colorScheme": "blue",
        "features": ["elegant", "modern", "professional", "beautiful"],
        "packages": ["beamer", "tikz", "xcolor"],
        "preview": "preview.png",
        "thumbnail": "thumbnail.png",
        "bestFor": ["business", "corporate", "professional", "keynotes"],
        "difficulty": "intermediate",
        "customizable": {
            "colors": True,
            "fonts": True,
            "layout": False,
            "sections": True
        },
        "author": "Anish Athalye",
        "license": "MIT",
        "tags": ["elegant", "modern", "professional", "beautiful", "corporate"]
    },

    # Report Templates
    "report/eisvogel": {
        "id": "eisvogel-report",
        "name": "Eisvogel Report",
        "category": "report",
        "version": "1.0.0",
        "description": "Beautiful Pandoc LaTeX template for reports and documents. Clean, professional, with custom title page.",
        "style": "professional",
        "colorScheme": "blue",
        "features": ["custom-title-page", "professional", "clean", "modern"],
        "packages": ["geometry", "xcolor", "listings", "tcolorbox"],
        "preview": "preview.png",
        "thumbnail": "thumbnail.png",
        "bestFor": ["business-reports", "technical-docs", "white-papers", "documentation"],
        "difficulty": "intermediate",
        "customizable": {
            "colors": True,
            "fonts": True,
            "layout": True,
            "sections": True
        },
        "author": "Pascal Wagler",
        "license": "BSD-3-Clause",
        "tags": ["professional", "modern", "clean", "business", "technical"]
    },
    # IEEE template removed - repository not found
    # You can add it back if you find the correct repo or download manually
}


def create_metadata_files():
    """Create metadata.json for all downloaded templates"""

    # Get templates directory
    script_dir = Path(__file__).parent
    templates_dir = script_dir.parent.parent / "genlatex" / "templates"

    if not templates_dir.exists():
        print(f"❌ Templates directory not found: {templates_dir}")
        print(f"   Script dir: {script_dir}")
        print(f"   Looking for: {templates_dir}")
        return

    print(f"📁 Templates directory: {templates_dir}")
    print(f"   Absolute path: {templates_dir.resolve()}")

    # List what's actually in the directory
    print(f"\n📂 Directory contents:")
    try:
        for item in templates_dir.iterdir():
            if item.is_dir() and not item.name.startswith('.'):
                subdirs = [d.name for d in item.iterdir() if d.is_dir()]
                print(f"   {item.name}/: {', '.join(subdirs) if subdirs else '(empty)'}")
    except Exception as e:
        print(f"   Error listing directory: {e}")

    print(f"\n{'='*60}")
    print("Creating metadata files...")
    print(f"{'='*60}\n")

    created = 0
    skipped = 0
    errors = 0

    for template_path, metadata in TEMPLATE_METADATA.items():
        full_path = templates_dir / template_path
        metadata_file = full_path / "metadata.json"

        # Check if template directory exists
        if not full_path.exists():
            print(f"⏭️  Skipped (not downloaded): {template_path}")
            skipped += 1
            continue

        # Check if metadata already exists
        if metadata_file.exists():
            print(f"✓ Already exists: {template_path}/metadata.json")
            skipped += 1
            continue

        # Create metadata file
        try:
            with open(metadata_file, 'w', encoding='utf-8') as f:
                json.dump(metadata, f, indent=2)
            print(f"✅ Created: {template_path}/metadata.json")
            created += 1
        except Exception as e:
            print(f"❌ Error creating {template_path}/metadata.json: {e}")
            errors += 1

    print(f"\n{'='*60}")
    print("Summary:")
    print(f"{'='*60}")
    print(f"✅ Created: {created}")
    print(f"⏭️  Skipped: {skipped}")
    print(f"❌ Errors: {errors}")
    print(f"\n{'='*60}\n")

    if created > 0:
        print("🎉 Metadata files created successfully!")
        print("\nNext steps:")
        print("1. Test template selection: python -c \"from core.template_selector import TemplateSelector; s = TemplateSelector(); print(s._get_all_templates())\"")
        print("2. Generate preview images (optional)")
        print("3. Update template index if needed")
    else:
        print("ℹ️  No new metadata files were created.")
        if skipped > 0:
            print("   All templates already have metadata files.")


if __name__ == "__main__":
    print("\n🎨 GenLaTeX Metadata Creator\n")
    create_metadata_files()
