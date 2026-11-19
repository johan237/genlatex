/**
 * Simple LaTeX formatter: indent \begin/\end, normalize blank lines, trim.
 */

export function formatLatex(latex: string): string {
  const lines = latex.split(/\r?\n/);
  const out: string[] = [];
  let indent = 0;
  const indentStep = "  ";

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") {
      out.push("");
      continue;
    }

    const beginMatch = trimmed.match(/^\\begin\s*\{([^}]+)\}/);
    const endMatch = trimmed.match(/^\\end\s*\{([^}]+)\}/);

    if (endMatch) {
      indent = Math.max(0, indent - 1);
    }

    out.push(indentStep.repeat(indent) + trimmed);

    if (beginMatch) {
      indent += 1;
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
