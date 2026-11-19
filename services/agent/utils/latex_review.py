from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List


class LatexReview:
    """Lint, fix common issues, and optionally compile LaTeX documents."""

    _CMD_FIXES = [
        "item",
        "begin",
        "end",
        "section",
        "subsection",
        "subsubsection",
        "paragraph",
        "subparagraph",
        "cite",
        "label",
        "ref",
        "emph",
        "textbf",
        "textit",
        "underline",
    ]

    def lint(self, content: str) -> Dict[str, Any]:
        if not content:
            return {
                "issues": [],
                "error_count": 0,
                "warning_count": 0,
                "info_count": 0,
            }

        issues: List[Dict[str, Any]] = []
        stripped = self._strip_comments(content)

        # Unmatched braces (ignore escaped braces)
        open_count = 0
        close_count = 0
        for i, ch in enumerate(stripped):
            if ch == '{' and (i == 0 or stripped[i - 1] != '\\'):
                open_count += 1
            elif ch == '}' and (i == 0 or stripped[i - 1] != '\\'):
                close_count += 1
        if open_count != close_count:
            issues.append({
                "rule": "unmatched_braces",
                "severity": "error",
                "line": 1,
                "column": 1,
                "message": f"Unmatched braces: {open_count} open, {close_count} close",
            })

        # Unmatched environments
        env_counts: Dict[str, int] = {}
        for env in re.findall(r'\\begin\{([^}]+)\}', stripped):
            env_counts[env] = env_counts.get(env, 0) + 1
        for env in re.findall(r'\\end\{([^}]+)\}', stripped):
            env_counts[env] = env_counts.get(env, 0) - 1
        for env, diff in env_counts.items():
            if diff != 0:
                idx = stripped.find(f"\\begin{{{env}}}") if diff > 0 else stripped.find(f"\\end{{{env}}}")
                line, col = self._line_col(stripped, idx if idx >= 0 else 0)
                issues.append({
                    "rule": "unmatched_environments",
                    "severity": "error",
                    "line": line,
                    "column": col,
                    "message": f"Unmatched environment '{env}': {abs(diff)} missing \\begin/\\end",
                })

        # textbackslash artifacts for common commands
        tb_match = re.search(r'\\textbackslash\{\}\s*([A-Za-z]+)', stripped)
        if tb_match and tb_match.group(1) in self._CMD_FIXES:
            line, col = self._line_col(stripped, tb_match.start())
            issues.append({
                "rule": "textbackslash_artifacts",
                "severity": "error",
                "line": line,
                "column": col,
                "message": "Found textbackslash command artifacts in LaTeX output",
            })

        # Misbraced sections like \subsection}{Title}
        misbrace = re.search(r'(\\(sub)*section)\}\s*\{', stripped)
        if misbrace:
            line, col = self._line_col(stripped, misbrace.start())
            issues.append({
                "rule": "misbraced_sections",
                "severity": "error",
                "line": line,
                "column": col,
                "message": "Misbraced section command detected",
            })

        counts = {
            "error_count": len([i for i in issues if i["severity"] == "error"]),
            "warning_count": len([i for i in issues if i["severity"] == "warning"]),
            "info_count": len([i for i in issues if i["severity"] == "info"]),
        }
        return {**counts, "issues": issues}

    def fix_common_issues(self, content: str) -> str:
        if not content:
            return content

        pre, body, post = self._split_document(content)
        body = self._fix_textbackslash_command_tokens(body)
        body = self._fix_misbraced_section_commands(body)
        body = self._fix_double_begin_enumerate(body)
        body = self._fix_itemize_with_embedded_enumerate_items(body)
        body = self._remove_duplicate_section_heading_lines(body)
        return pre + body + post

    def compile_project(self, project_dir: Path, tex_filename: str = "main.tex") -> Dict[str, Any]:
        project_dir = Path(project_dir)
        tex_path = project_dir / tex_filename
        if not tex_path.exists():
            return {"status": "skipped", "reason": "main.tex not found"}

        pdflatex = shutil.which("pdflatex")
        if not pdflatex:
            return {"status": "skipped", "reason": "pdflatex not found"}

        content = tex_path.read_text(encoding="utf-8", errors="replace")
        bib_info = self._detect_bibliography(content)

        env = os.environ.copy()
        path_sep = ";" if os.name == "nt" else ":"
        env["TEXINPUTS"] = f".{path_sep}{str(project_dir)}{path_sep}" + env.get("TEXINPUTS", "")
        env["BIBINPUTS"] = f".{path_sep}{str(project_dir)}{path_sep}" + env.get("BIBINPUTS", "")
        env["BSTINPUTS"] = f".{path_sep}{str(project_dir)}{path_sep}" + env.get("BSTINPUTS", "")

        log_parts: List[str] = []

        def run_cmd(cmd: List[str], name: str) -> int:
            proc = subprocess.run(
                cmd,
                cwd=str(project_dir),
                env=env,
                capture_output=True,
                text=True,
                timeout=120,
            )
            log_parts.append(f"## {name}\n{proc.stdout}\n{proc.stderr}")
            return proc.returncode

        base_name = tex_filename.replace(".tex", "")
        pass1 = run_cmd([pdflatex, "-interaction=nonstopmode", "-halt-on-error", tex_filename], "pdflatex-pass1")
        if pass1 != 0:
            return self._compile_result("failed", log_parts, missing_bib=None)

        missing_bib = None
        if bib_info["has_bib"]:
            if bib_info["system"] == "biblatex":
                if bib_info["backend"] == "biber":
                    bib_cmd = shutil.which("biber")
                    if not bib_cmd:
                        missing_bib = "biber"
                    else:
                        run_cmd([bib_cmd, base_name], "biber")
                else:
                    bib_cmd = shutil.which("bibtex")
                    if not bib_cmd:
                        missing_bib = "bibtex"
                    else:
                        run_cmd([bib_cmd, base_name], "bibtex")
            else:
                bib_cmd = shutil.which("bibtex")
                if not bib_cmd:
                    missing_bib = "bibtex"
                else:
                    run_cmd([bib_cmd, base_name], "bibtex")

            run_cmd([pdflatex, "-interaction=nonstopmode", "-halt-on-error", tex_filename], "pdflatex-pass2")
            run_cmd([pdflatex, "-interaction=nonstopmode", "-halt-on-error", tex_filename], "pdflatex-pass3")

        pdf_path = project_dir / base_name
        pdf_path = pdf_path.with_suffix(".pdf")
        if pdf_path.exists():
            return self._compile_result("success", log_parts, missing_bib=missing_bib, pdf_path=str(pdf_path))

        return self._compile_result("failed", log_parts, missing_bib=missing_bib)

    def _compile_result(self, status: str, log_parts: List[str], missing_bib: str | None, pdf_path: str | None = None) -> Dict[str, Any]:
        log_text = "\n".join(log_parts)
        log_tail = log_text[-4000:] if log_text else ""
        result = {
            "status": status,
            "log_tail": log_tail,
        }
        if missing_bib:
            result["missing_bib_processor"] = missing_bib
        if pdf_path:
            result["pdf_path"] = pdf_path
        return result

    def _detect_bibliography(self, content: str) -> Dict[str, Any]:
        result = {"has_bib": False, "system": "none", "backend": None}
        if re.search(r'\\usepackage.*?\{biblatex\}', content, flags=re.DOTALL) or re.search(
            r'\\usepackage\[[^\]]*biblatex[^\]]*\]', content, flags=re.DOTALL
        ):
            result["system"] = "biblatex"
            result["has_bib"] = True
            backend_match = re.search(r'backend\s*=\s*([A-Za-z]+)', content)
            result["backend"] = backend_match.group(1).lower() if backend_match else "biber"
        elif re.search(r'\\bibliographystyle|\\bibliography\{', content):
            result["system"] = "bibtex"
            result["has_bib"] = True
        return result

    def _strip_comments(self, content: str) -> str:
        lines = []
        for line in content.splitlines():
            buf = []
            i = 0
            while i < len(line):
                if line[i] == '%' and (i == 0 or line[i - 1] != '\\'):
                    break
                buf.append(line[i])
                i += 1
            lines.append("".join(buf))
        return "\n".join(lines)

    def _line_col(self, content: str, index: int) -> tuple[int, int]:
        if index < 0:
            return (1, 1)
        line = content.count("\n", 0, index) + 1
        last_newline = content.rfind("\n", 0, index)
        col = index - last_newline if last_newline >= 0 else index + 1
        return (line, col)

    def _split_document(self, content: str) -> tuple[str, str, str]:
        begin_match = re.search(r'\\begin\{document\}', content)
        end_match = re.search(r'\\end\{document\}', content)
        if begin_match and end_match and begin_match.start() < end_match.start():
            pre = content[:begin_match.end()]
            body = content[begin_match.end():end_match.start()]
            post = content[end_match.start():]
            return pre, body, post
        return "", content, ""

    def _fix_textbackslash_command_tokens(self, s: str) -> str:
        for cmd in self._CMD_FIXES:
            s = re.sub(
                rf"\\textbackslash\{{\}}\s*{cmd}\b",
                rf"\\{cmd}",
                s,
            )
        return s

    def _fix_misbraced_section_commands(self, s: str) -> str:
        s = re.sub(r"(\\(sub)*section)\}\s*\{", r"\1{", s)
        s = re.sub(r"(\\subsubsection)\}\s*\{", r"\1{", s)
        s = re.sub(r"(\\paragraph)\}\s*\{", r"\1{", s)
        s = re.sub(r"(\\(sub)*section\*)\}\s*\{", r"\1{", s)
        s = re.sub(r"(\\subsubsection\*)\}\s*\{", r"\1{", s)

        def close_unclosed(m: re.Match) -> str:
            line = m.group(0)
            if line.count("{") > line.count("}"):
                return line + "}"
            return line

        s = re.sub(r"^(\\(sub)*section\*?\{[^\n]*)$", close_unclosed, s, flags=re.MULTILINE)
        s = re.sub(r"^(\\subsubsection\*?\{[^\n]*)$", close_unclosed, s, flags=re.MULTILINE)
        s = re.sub(r"^(\\paragraph\*?\{[^\n]*)$", close_unclosed, s, flags=re.MULTILINE)
        return s

    def _fix_double_begin_enumerate(self, s: str) -> str:
        s = re.sub(
            r"(\\begin\{enumerate\}\s*\n)\s*\\begin\{enumerate\}\s*\n",
            r"\1",
            s,
            flags=re.MULTILINE,
        )
        s = re.sub(
            r"(\\begin\{itemize\}\s*\n)\s*\\begin\{itemize\}\s*\n",
            r"\1",
            s,
            flags=re.MULTILINE,
        )
        return s

    def _fix_itemize_with_embedded_enumerate_items(self, s: str) -> str:
        s = re.sub(
            r"(\\begin\{itemize\}\s*\n)(?:\s*\n)*\\begin\{enumerate\}\s*\n",
            r"\1",
            s,
            flags=re.MULTILINE,
        )
        s = re.sub(
            r"\\end\{enumerate\}\s*\n(?:\s*\n)*(\\end\{itemize\})",
            r"\1",
            s,
            flags=re.MULTILINE,
        )
        return s

    def _remove_duplicate_section_heading_lines(self, s: str) -> str:
        lines = s.split("\n")
        out: List[str] = []
        last_section = None
        blank_buffer: List[str] = []

        section_re = re.compile(r"^\s*\\section\{([^}]+)\}\s*$")

        for ln in lines:
            m = section_re.match(ln)
            if m:
                title = m.group(1).strip()
                if title == last_section:
                    continue
                out.extend(blank_buffer)
                blank_buffer = []
                out.append(ln)
                last_section = title
                continue

            if ln.strip() == "":
                blank_buffer.append(ln)
            else:
                out.extend(blank_buffer)
                blank_buffer = []
                out.append(ln)

        out.extend(blank_buffer)
        return "\n".join(out)

    def apply_fixes_from_log(self, project_dir: Path, log_tail: str) -> Dict[str, Any]:
        """
        Parse compile log and apply rule-based fixes (e.g. unescaped special chars in .bib).
        Returns {"applied": [list of file paths modified], "message": "..."}.
        """
        project_dir = Path(project_dir)
        applied: List[str] = []
        log_lower = (log_tail or "").lower()

        # Detect which file is implicated: (filename.tex) or (references.bib) in log
        file_mentioned = None
        for name in ["references.bib", "main.tex"]:
            if f"({name}" in log_tail or f" {name}" in log_tail or f".bib)" in log_tail and name.endswith(".bib"):
                if name.endswith(".bib"):
                    file_mentioned = "references.bib"
                else:
                    file_mentioned = name
                break
        if not file_mentioned and ("bibliography" in log_lower or ".bib" in log_lower or "bibtex" in log_lower):
            file_mentioned = "references.bib"

        # Rule: unescaped & % # _ $ in .bib (alignment tab, illegal character, undefined control sequence)
        if file_mentioned == "references.bib" and (
            "alignment tab" in log_lower
            or "illegal character" in log_lower
            or "undefined control sequence" in log_lower
            or "misplaced" in log_lower
        ):
            bib_path = project_dir / "references.bib"
            if bib_path.exists():
                content = bib_path.read_text(encoding="utf-8", errors="replace")
                original = content
                # In BibTeX, inside {...} values, unescaped & % # _ $ must be escaped
                def escape_bib_braced(m: re.Match) -> str:
                    inner = m.group(1)
                    for char, esc in [("&", "\\&"), ("%", "\\%"), ("#", "\\#"), ("_", "\\_"), ("$", "\\$")]:
                        inner = re.sub(r"(?<!\\)" + re.escape(char), esc, inner)
                    return "{" + inner + "}"

                content = re.sub(r"\{([^{}]*)\}", escape_bib_braced, content)
                if content != original:
                    bib_path.write_text(content, encoding="utf-8")
                    applied.append("references.bib")
                    return {"applied": applied, "message": "Escaped special characters in references.bib"}

        return {"applied": applied, "message": "no rule matched" if not applied else "applied fixes"}
