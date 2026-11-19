export const TOOLS_LIST = [
  { id: "table-to-latex", name: "Table to LaTeX", description: "Paste CSV or Excel data and get a LaTeX table (tabular/booktabs).", href: "/tools/table-to-latex", defaultFilename: "table.tex" },
  { id: "doi-to-bibtex", name: "DOI to BibTeX", description: "Enter a DOI or arXiv/PubMed URL and get a BibTeX entry.", href: "/tools/doi-to-bibtex", defaultFilename: "references.bib" },
  { id: "equation-to-latex", name: "Plain-language equation to LaTeX", description: "Describe an equation in words and get LaTeX code.", href: "/tools/equation-to-latex", defaultFilename: "equation.tex" },
  { id: "pdf-equation-extractor", name: "PDF equation extractor", description: "Extract equations from a PDF as LaTeX.", href: "/tools/pdf-equation-extractor", defaultFilename: "equations.tex" },
  { id: "word-to-latex", name: "Word to LaTeX", description: "Convert a Word document to LaTeX.", href: "/tools/word-to-latex", defaultFilename: "main.tex" },
  { id: "latex-formatter", name: "LaTeX formatter & validator", description: "Format messy LaTeX and check for common errors.", href: "/tools/latex-formatter", defaultFilename: "main.tex" },
  { id: "arxiv-to-latex", name: "arXiv to structured LaTeX", description: "Turn an arXiv paper into structured LaTeX (title, abstract, sections).", href: "/tools/arxiv-to-latex", defaultFilename: "main.tex" },
  { id: "abstract-generator", name: "Abstract generator", description: "Generate an abstract from your title and topic.", href: "/tools/abstract-generator", defaultFilename: "abstract.tex" },
  { id: "thesis-statement-generator", name: "Thesis statement generator", description: "Generate thesis statements from your topic or question.", href: "/tools/thesis-statement-generator", defaultFilename: "thesis.tex" },
] as const;

export type ToolSlug = (typeof TOOLS_LIST)[number]["id"];

export function getToolBySlug(slug: string) {
  return TOOLS_LIST.find((t) => t.id === slug) ?? null;
}
