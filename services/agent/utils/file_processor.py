"""
File Content Processor for LaTeX Generation
Processes project files and extracts content for LaTeX document generation
Equivalent to frontend FileContentProcessor
"""

import os
import re
from pathlib import Path
from typing import Dict, List, Optional, Any
from datetime import datetime


class FileContentProcessor:
    """Process files in a directory and extract content for LaTeX generation"""
    
    def __init__(self):
        self.supported_extensions = {
            # Code files
            '.js': 'javascript',
            '.ts': 'typescript',
            '.py': 'python',
            '.java': 'java',
            '.cpp': 'cpp',
            '.c': 'c',
            '.cs': 'csharp',
            '.php': 'php',
            '.rb': 'ruby',
            '.go': 'go',
            '.rs': 'rust',
            '.swift': 'swift',
            '.kt': 'kotlin',
            '.scala': 'scala',
            '.r': 'r',
            '.m': 'matlab',
            '.jl': 'julia',
            
            # Data files
            '.json': 'json',
            '.xml': 'xml',
            '.yaml': 'yaml',
            '.yml': 'yaml',
            '.csv': 'csv',
            '.tsv': 'tsv',
            '.sql': 'sql',
            
            # Documentation
            '.md': 'markdown',
            '.txt': 'text',
            '.rst': 'restructuredtext',
            '.tex': 'latex',
            '.bib': 'bibtex',
            
            # Configuration
            '.conf': 'config',
            '.cfg': 'config',
            '.ini': 'config',
            '.toml': 'toml',
            '.env': 'env',
            
            # Other
            '.html': 'html',
            '.css': 'css',
            '.scss': 'scss',
            '.sass': 'sass',
            '.less': 'less'
        }
    
    def process_directory(self, directory_path: str, max_file_size: int = 1024 * 1024, max_files: int = 50) -> Dict[str, Any]:
        """Process all files in a directory and extract content
        
        Args:
            directory_path: Path to the directory
            max_file_size: Maximum file size in bytes (default: 1MB)
            max_files: Maximum number of files to process (default: 50)
            
        Returns:
            Dictionary containing processed content summary
        """
        try:
            print(f'📁 Processing directory: {directory_path}')
            
            files = self._get_all_files(directory_path)
            processed_files = []
            content_summary = {
                'totalFiles': len(files),
                'processedFiles': 0,
                'skippedFiles': 0,
                'fileTypes': {},
                'keyFiles': [],
                'content': '',
                'references': [],
                'errors': []
            }
            
            processed_count = 0
            
            for file_path in files:
                if processed_count >= max_files:
                    print(f'⚠️ Reached maximum file limit: {max_files}')
                    break
                
                try:
                    file_info = self._process_file(file_path, max_file_size)
                    if file_info:
                        processed_files.append(file_info)
                        processed_count += 1
                        
                        # Update content summary
                        content_summary['processedFiles'] += 1
                        ext = file_info['extension']
                        content_summary['fileTypes'][ext] = content_summary['fileTypes'].get(ext, 0) + 1
                        
                        # Add key files
                        if self._is_key_file(file_info['name']):
                            content_summary['keyFiles'].append(file_info)
                        
                        # Accumulate content
                        if file_info.get('content'):
                            content_summary['content'] += f"\n\n=== {file_info['name']} ===\n{file_info['content']}"
                        
                        # Extract references from content
                        references = self._extract_references(file_info.get('content', ''), file_info['name'])
                        content_summary['references'].extend(references)
                    else:
                        content_summary['skippedFiles'] += 1
                except Exception as error:
                    print(f'❌ Error processing file {file_path}: {str(error)}')
                    content_summary['errors'].append({
                        'file': file_path,
                        'error': str(error)
                    })
                    content_summary['skippedFiles'] += 1
            
            # Generate summary
            content_summary['summary'] = self._generate_summary(content_summary)
            content_summary['processedFiles'] = processed_files
            
            print(f'✅ Processed {processed_count} files, skipped {content_summary["skippedFiles"]} files')
            return content_summary
            
        except Exception as error:
            print(f'❌ Error processing directory: {error}')
            raise
    
    def _get_all_files(self, dir_path: str) -> List[str]:
        """Get all files in a directory recursively"""
        files = []
        
        try:
            path = Path(dir_path)
            if not path.exists():
                return files
            
            for entry in path.rglob('*'):
                # Skip hidden files and common ignore patterns
                if entry.name.startswith('.') or \
                   entry.name in ['node_modules', '__pycache__', '.git', 'venv', 'env', 'dist', 'build']:
                    continue
                
                if entry.is_file():
                    files.append(str(entry))
        except Exception as error:
            print(f'❌ Error reading directory {dir_path}: {str(error)}')
        
        return files
    
    def _process_file(self, file_path: str, max_file_size: int) -> Optional[Dict[str, Any]]:
        """Process a single file and extract content"""
        try:
            path = Path(file_path)
            
            # Skip if file is too large
            if path.stat().st_size > max_file_size:
                print(f'⚠️ Skipping large file: {file_path} ({path.stat().st_size} bytes)')
                return None
            
            file_name = path.name
            extension = path.suffix.lower()
            
            # Skip unsupported files
            if extension not in self.supported_extensions:
                return None
            
            # Read file content
            try:
                content = path.read_text(encoding='utf-8', errors='ignore')
            except UnicodeDecodeError:
                # Try with different encoding
                try:
                    content = path.read_text(encoding='latin-1', errors='ignore')
                except Exception:
                    return None
            
            return {
                'name': file_name,
                'path': str(file_path),
                'extension': extension,
                'size': path.stat().st_size,
                'language': self.supported_extensions.get(extension, 'unknown'),
                'content': content,
                'lines': len(content.split('\n')),
                'lastModified': datetime.fromtimestamp(path.stat().st_mtime).isoformat()
            }
            
        except Exception as error:
            print(f'❌ Error reading file {file_path}: {str(error)}')
            return None
    
    def _is_key_file(self, file_name: str) -> bool:
        """Check if a file is considered 'key' (important for understanding the project)"""
        key_patterns = [
            r'^readme',
            r'^main\.',
            r'^index\.',
            r'^app\.',
            r'^server\.',
            r'^package\.json$',
            r'^requirements\.txt$',
            r'^pom\.xml$',
            r'^build\.gradle$',
            r'^cargo\.toml$',
            r'^go\.mod$',
            r'^composer\.json$',
            r'^gemfile$',
            r'^setup\.py$',
            r'^makefile$',
            r'^dockerfile$',
            r'^\.env$',
            r'^config\.',
            r'^settings\.'
        ]
        
        return any(re.match(pattern, file_name, re.IGNORECASE) for pattern in key_patterns)
    
    def _extract_references(self, content: str, file_name: str) -> List[Dict[str, Any]]:
        """Extract references from file content"""
        references = []
        
        if not content:
            return references
        
        # Extract URLs
        url_pattern = r'https?://[^\s<>"{}|\\^`\[\]]+'
        urls = re.findall(url_pattern, content)
        
        for url in urls:
            references.append({
                'type': 'url',
                'value': url,
                'source': file_name,
                'context': self._get_context_around(content, url)
            })
        
        # Extract citations (various formats)
        citation_patterns = [
            (r'\[([^\]]+)\]\(([^)]+)\)', 'markdown'),  # Markdown links
            (r'@(\w+)', 'at_citation'),  # @citations
            (r'cite\{([^}]+)\}', 'latex'),  # LaTeX citations
            (r'\\cite\{([^}]+)\}', 'latex_escaped')  # LaTeX citations with backslash
        ]
        
        for pattern, ref_type in citation_patterns:
            matches = re.finditer(pattern, content)
            for match in matches:
                references.append({
                    'type': 'citation',
                    'value': match.group(1) if match.lastindex else match.group(0),
                    'source': file_name,
                    'context': self._get_context_around(content, match.group(0))
                })
        
        # Extract academic references
        academic_patterns = [
            (r'(?:et al\.|et al)', 'et_al'),
            (r'(?:doi:|DOI:)\s*([^\s]+)', 'doi'),
            (r'(?:arxiv:|arXiv:)\s*([^\s]+)', 'arxiv'),
            (r'(?:pubmed:|PMID:)\s*([^\s]+)', 'pubmed')
        ]
        
        for pattern, ref_type in academic_patterns:
            matches = re.finditer(pattern, content)
            for match in matches:
                references.append({
                    'type': 'academic',
                    'value': match.group(1) if match.lastindex else match.group(0),
                    'source': file_name,
                    'context': self._get_context_around(content, match.group(0))
                })
        
        return references
    
    def _get_context_around(self, content: str, match: str, context_length: int = 100) -> str:
        """Get context around a match in content"""
        if not content or not match:
            return ''
        
        index = content.find(match)
        if index == -1:
            return ''
        
        start = max(0, index - context_length)
        end = min(len(content), index + len(match) + context_length)
        
        return content[start:end].strip()
    
    def _generate_summary(self, content_summary: Dict[str, Any]) -> str:
        """Generate a summary of the processed content"""
        processed_count = content_summary['processedFiles']
        file_types = content_summary['fileTypes']
        key_files = content_summary['keyFiles']
        references = content_summary['references']
        
        summary = f"Project Analysis Summary:\n"
        summary += f"- Total files processed: {processed_count}\n"
        summary += f"- File types found: {', '.join(file_types.keys())}\n"
        
        if key_files:
            summary += f"- Key files identified: {', '.join(f['name'] for f in key_files)}\n"
        
        if references:
            url_refs = sum(1 for r in references if r['type'] == 'url')
            citation_refs = sum(1 for r in references if r['type'] == 'citation')
            academic_refs = sum(1 for r in references if r['type'] == 'academic')
            
            summary += f"- References found: {len(references)} total\n"
            summary += f"  - URLs: {url_refs}\n"
            summary += f"  - Citations: {citation_refs}\n"
            summary += f"  - Academic: {academic_refs}\n"
        
        return summary
