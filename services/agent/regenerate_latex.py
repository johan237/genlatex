#!/usr/bin/env python3
import sys
sys.path.append('.')
from utils.latex import LatexGenerator
from pathlib import Path
import json
import glob

def load_paper_data() -> dict:
    p = Path('output/paper_data.json')
    if p.exists():
        with p.open('r', encoding='utf-8') as f:
            return json.load(f)
    raise FileNotFoundError('output/paper_data.json not found')

def build_bibtex_from_sections(sections: list) -> str:
    entries = []
    seen = set()
    for sec in sections or []:
        sources = sec.get('sources', []) if isinstance(sec, dict) else getattr(sec, 'sources', [])
        for src in sources or []:
            if isinstance(src, dict):
                key = src.get('citation_key') or src.get('key') or 'unknown'
                title = src.get('title', 'Unknown Title')
                authors = src.get('authors') or []
                year = src.get('year') or ''
                venue = src.get('venue', '')
                url = src.get('url', '')
            else:
                # Handle Source objects
                key = getattr(src, 'citation_key', None) or getattr(src, 'key', None) or 'unknown'
                title = getattr(src, 'title', 'Unknown Title')
                authors = getattr(src, 'authors', [])
                year = getattr(src, 'year', '')
                venue = getattr(src, 'venue', '')
                url = getattr(src, 'url', '')
            
            if not key or key in seen:
                continue
            seen.add(key)
            
            if isinstance(authors, list):
                author_str = ' and '.join(authors)
            else:
                author_str = str(authors)
            entry = f"@misc{{{key},\n  title = {{{title}}},\n  author = {{{author_str}}},\n  year = {{{year}}},\n  howpublished = {{{venue}}},"
            if url:
                entry += f"\n  url = {{{url}}},"
            entry += "\n}\n"
            entries.append(entry)
    return "\n".join(entries)

def fallback_bibtex_from_checkpoints() -> str:
    files = sorted(glob.glob('checkpoints/*_research_complete.json'))
    if not files:
        return ''
    latest = files[-1]
    try:
        with open(latest, 'r', encoding='utf-8') as f:
            sections = json.load(f)
        return build_bibtex_from_sections(sections)
    except Exception:
        return ''

def main():
    paper_data = load_paper_data()
    latex_gen = LatexGenerator('./template')
    latex_files = latex_gen.generate_paper(paper_data)

    # If references are empty, try to rebuild from sections or checkpoints, else fallback to paper_data['bibtex']
    bib = latex_files.get('references.bib', '') or ''
    if not bib.strip():
        bib = build_bibtex_from_sections(paper_data.get('sections', []))
    if not bib.strip():
        bib = fallback_bibtex_from_checkpoints()
    if not bib.strip():
        bib = paper_data.get('bibtex', '') or ''

    # Save files
    Path('output').mkdir(exist_ok=True)
    with open('output/main.tex', 'w', encoding='utf-8') as f:
        f.write(latex_files['main.tex'])
    with open('output/references.bib', 'w', encoding='utf-8') as f:
        f.write(bib)

    print('✅ Files regenerated:')
    print('  - output/main.tex')
    print('  - output/references.bib')
    print(f"\n📄 References.bib has {len(bib)} characters")

if __name__ == '__main__':
    main()
