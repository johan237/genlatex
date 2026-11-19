"""
LaTeX Tools for AI Chat System
Compile, validate, and analyze LaTeX documents
"""

import os
import subprocess
import tempfile
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional
import logging
import re

from ..base import Tool, ToolResult, ExecutionContext

logger = logging.getLogger(__name__)


class CompileLatexTool(Tool):
    """Compile LaTeX and return errors/warnings"""
    
    name = "compile_latex"
    description = "Compile a LaTeX file and return any errors or warnings. Use this to check if a document compiles correctly."
    parameters = {
        "type": "object",
        "properties": {
            "file_path": {
                "type": "string",
                "description": "Path to the .tex file relative to project root"
            }
        },
        "required": ["file_path"]
    }
    
    async def execute(self, params: Dict[str, Any], context: ExecutionContext) -> ToolResult:
        file_path = params.get("file_path")
        
        if not file_path:
            return ToolResult(success=False, error="file_path is required")
        
        # Resolve full path
        full_path = Path(context.project_path) / file_path
        
        if not full_path.exists():
            return ToolResult(success=False, error=f"File not found: {file_path}")
        
        if not file_path.endswith('.tex'):
            return ToolResult(success=False, error="File must be a .tex file")
        
        try:
            # Try to compile using pdflatex
            result = self._compile_with_pdflatex(full_path)
            return result
        except FileNotFoundError:
            # pdflatex not available, do syntax check only
            return self._syntax_check_only(full_path)
        except Exception as e:
            return ToolResult(success=False, error=f"Compilation failed: {str(e)}")
    
    def _compile_with_pdflatex(self, tex_path: Path) -> ToolResult:
        """Compile using pdflatex"""
        # Create a temporary directory for compilation
        with tempfile.TemporaryDirectory() as tmpdir:
            # Copy the tex file and any related files
            shutil.copy(tex_path, tmpdir)
            
            # Copy bib files if they exist
            for bib_file in tex_path.parent.glob("*.bib"):
                shutil.copy(bib_file, tmpdir)
            
            # Copy sty files if they exist
            for sty_file in tex_path.parent.glob("*.sty"):
                shutil.copy(sty_file, tmpdir)
            
            tex_name = tex_path.name
            
            # Run pdflatex
            try:
                result = subprocess.run(
                    ["pdflatex", "-interaction=nonstopmode", "-halt-on-error", tex_name],
                    cwd=tmpdir,
                    capture_output=True,
                    text=True,
                    timeout=60
                )
                
                # Parse the output for errors and warnings
                errors, warnings = self._parse_latex_output(result.stdout + result.stderr)
                
                if result.returncode == 0:
                    return ToolResult(
                        success=True,
                        result={
                            "compiled": True,
                            "errors": [],
                            "warnings": warnings,
                            "message": "Compilation successful" if not warnings else f"Compilation successful with {len(warnings)} warning(s)"
                        }
                    )
                else:
                    return ToolResult(
                        success=True,  # Tool succeeded, but compilation had errors
                        result={
                            "compiled": False,
                            "errors": errors,
                            "warnings": warnings,
                            "message": f"Compilation failed with {len(errors)} error(s)"
                        }
                    )
            except subprocess.TimeoutExpired:
                return ToolResult(success=False, error="Compilation timed out after 60 seconds")
    
    def _syntax_check_only(self, tex_path: Path) -> ToolResult:
        """Perform basic syntax check without compilation"""
        try:
            with open(tex_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            errors = []
            warnings = []
            lines = content.split('\n')
            
            # Track environments for matching
            env_stack = []
            
            for line_num, line in enumerate(lines, 1):
                # Check for common LaTeX errors
                
                # Unmatched braces (simple check)
                open_braces = line.count('{') - line.count('\\{')
                close_braces = line.count('}') - line.count('\\}')
                if open_braces != close_braces:
                    # This might be intentional (multi-line), so make it a warning
                    pass
                
                # Check for \begin without matching \end
                begin_match = re.findall(r'\\begin\{(\w+)\}', line)
                end_match = re.findall(r'\\end\{(\w+)\}', line)
                
                for env in begin_match:
                    env_stack.append((env, line_num))
                
                for env in end_match:
                    if env_stack and env_stack[-1][0] == env:
                        env_stack.pop()
                    elif env_stack:
                        errors.append({
                            "line": line_num,
                            "message": f"Mismatched environment: expected \\end{{{env_stack[-1][0]}}}, got \\end{{{env}}}",
                            "type": "error"
                        })
                    else:
                        errors.append({
                            "line": line_num,
                            "message": f"Unexpected \\end{{{env}}} without matching \\begin",
                            "type": "error"
                        })
                
                # Check for common mistakes
                if '\\being{' in line:
                    errors.append({
                        "line": line_num,
                        "message": "Typo: \\being should be \\begin",
                        "type": "error"
                    })
                
                if '\\ned{' in line or '\\en{' in line:
                    errors.append({
                        "line": line_num,
                        "message": "Typo: possible misspelling of \\end",
                        "type": "error"
                    })
            
            # Check for unclosed environments
            for env, line_num in env_stack:
                errors.append({
                    "line": line_num,
                    "message": f"Unclosed environment: \\begin{{{env}}} never closed",
                    "type": "error"
                })
            
            return ToolResult(
                success=True,
                result={
                    "compiled": False,
                    "syntax_check_only": True,
                    "errors": errors,
                    "warnings": warnings,
                    "message": f"Syntax check completed. Found {len(errors)} error(s). (pdflatex not available for full compilation)"
                }
            )
        except Exception as e:
            return ToolResult(success=False, error=f"Syntax check failed: {str(e)}")
    
    def _parse_latex_output(self, output: str) -> tuple[List[Dict], List[Dict]]:
        """Parse LaTeX output for errors and warnings"""
        errors = []
        warnings = []
        
        lines = output.split('\n')
        current_error = None
        
        for i, line in enumerate(lines):
            # Error patterns
            error_match = re.match(r'! (.+)', line)
            if error_match:
                current_error = {
                    "message": error_match.group(1),
                    "type": "error"
                }
                continue
            
            # Line number for error
            if current_error:
                line_match = re.match(r'l\.(\d+)', line)
                if line_match:
                    current_error["line"] = int(line_match.group(1))
                    errors.append(current_error)
                    current_error = None
            
            # Warning patterns
            warning_match = re.match(r'LaTeX Warning: (.+)', line)
            if warning_match:
                warnings.append({
                    "message": warning_match.group(1),
                    "type": "warning"
                })
            
            # Overfull/Underfull warnings
            box_warning = re.match(r'(Overfull|Underfull) \\[hv]box .+ at lines? (\d+)', line)
            if box_warning:
                warnings.append({
                    "message": f"{box_warning.group(1)} box",
                    "line": int(box_warning.group(2)),
                    "type": "warning"
                })
        
        return errors, warnings
