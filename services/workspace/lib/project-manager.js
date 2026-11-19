// SPDX-License-Identifier: MIT

import fs from 'fs/promises';
import path from 'path';

/**
 * Default project structure for different document types
 */
const PROJECT_TEMPLATES = {
  article: {
    name: 'Scientific Article',
    description: 'Standard scientific article with biblatex support',
    files: {
      'main.tex': `\\documentclass[11pt,a4paper]{article}

% ------------------------------------------------------------
% Essential Packages
% ------------------------------------------------------------
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}

% Math and symbols
\\usepackage{amsmath,amssymb,amsthm}

% Graphics and figures
\\usepackage{graphicx}
\\usepackage{float}
\\usepackage{caption}
\\usepackage{subcaption}

% Tables
\\usepackage{booktabs}
\\usepackage{array}
\\usepackage{multirow}

% Links and references
\\usepackage{hyperref}
\\usepackage[capitalise]{cleveref}

% Bibliography with biblatex
\\usepackage[backend=biber,style=ieee,sorting=none]{biblatex}
\\addbibresource{references.bib}

% ------------------------------------------------------------
% Metadata
% ------------------------------------------------------------
\\title{Your Article Title}
\\author{Your Name \\\\ \\textit{Your Institution} \\\\ \\textit{email@example.com}}
\\date{\\today}

% ------------------------------------------------------------
% Document
% ------------------------------------------------------------
\\begin{document}

\\maketitle

\\begin{abstract}
Your abstract goes here. Provide a concise summary of your research.
\\end{abstract}

\\section{Introduction}
\\label{sec:introduction}

Your introduction goes here \\cite{example2024}.

\\section{Methods}
\\label{sec:methods}

Describe your methods.

\\section{Results}
\\label{sec:results}

Present your results.

\\section{Discussion}
\\label{sec:discussion}

Discuss your findings.

\\section{Conclusion}
\\label{sec:conclusion}

Conclude your article.

% ------------------------------------------------------------
% Bibliography
% ------------------------------------------------------------
\\printbibliography

\\end{document}
`,
      'references.bib': `@article{example2024,
  title = {Example Article Title},
  author = {Author, First and Author, Second},
  year = {2024},
  journal = {Example Journal},
  volume = {1},
  number = {1},
  pages = {1--10},
  doi = {10.1234/example.2024.001}
}

@book{example_book2023,
  title = {Example Book Title},
  author = {Book, Author},
  year = {2023},
  publisher = {Example Publisher},
  address = {City, Country},
  isbn = {978-0-123456-78-9}
}

@inproceedings{example_conference2024,
  title = {Example Conference Paper},
  author = {Conference, Author},
  year = {2024},
  booktitle = {Proceedings of Example Conference},
  pages = {100--105},
  organization = {Example Organization}
}
`,
      'README.md': `# LaTeX Article Project

This project uses biblatex for bibliography management.

## Compilation

The project will automatically compile with the following sequence:
1. LaTeX (generate .aux and .bcf files)
2. Biber (process bibliography)
3. LaTeX (incorporate bibliography)
4. LaTeX (resolve cross-references)

## Requirements

- TeX Live or MiKTeX (pdflatex)
- Biber (for bibliography processing)

## Files

- \`main.tex\` - Main document file
- \`references.bib\` - Bibliography database
- \`README.md\` - This file
`
    }
  },

  report: {
    name: 'Technical Report',
    description: 'Technical report with chapters and bibliography',
    files: {
      'main.tex': `\\documentclass[11pt,a4paper]{report}

% ------------------------------------------------------------
% Essential Packages
% ------------------------------------------------------------
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}

% Math and symbols
\\usepackage{amsmath,amssymb,amsthm}

% Graphics and figures
\\usepackage{graphicx}
\\usepackage{float}
\\usepackage{caption}
\\usepackage{subcaption}

% Tables
\\usepackage{booktabs}
\\usepackage{array}

% Links and references
\\usepackage{hyperref}
\\usepackage[capitalise]{cleveref}

% Bibliography with biblatex
\\usepackage[backend=biber,style=ieee,sorting=none]{biblatex}
\\addbibresource{references.bib}

% ------------------------------------------------------------
% Metadata
% ------------------------------------------------------------
\\title{Technical Report Title}
\\author{Your Name}
\\date{\\today}

% ------------------------------------------------------------
% Document
% ------------------------------------------------------------
\\begin{document}

\\maketitle
\\tableofcontents

\\chapter{Introduction}
\\label{chap:introduction}

Introduction content goes here.

\\chapter{Background}
\\label{chap:background}

Background information and literature review \\cite{example2024}.

\\chapter{Methodology}
\\label{chap:methodology}

Describe your methodology.

\\chapter{Results}
\\label{chap:results}

Present your results.

\\chapter{Conclusion}
\\label{chap:conclusion}

Conclude your report.

% ------------------------------------------------------------
% Bibliography
% ------------------------------------------------------------
\\printbibliography

\\end{document}
`,
      'references.bib': `@article{example2024,
  title = {Example Reference},
  author = {Author, Name},
  year = {2024},
  journal = {Journal Name},
  volume = {1},
  pages = {1--10}
}
`,
      'README.md': `# Technical Report Project

This is a LaTeX report with biblatex bibliography support.
`
    }
  },

  presentation: {
    name: 'Beamer Presentation',
    description: 'Presentation slides using Beamer class',
    files: {
      'main.tex': `\\documentclass{beamer}

% Theme
\\usetheme{Madrid}
\\usecolortheme{default}

% Packages
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{graphicx}

% No bibliography package for simple presentations
% Add biblatex if needed

% ------------------------------------------------------------
% Metadata
% ------------------------------------------------------------
\\title{Presentation Title}
\\author{Your Name}
\\institute{Your Institution}
\\date{\\today}

% ------------------------------------------------------------
% Document
% ------------------------------------------------------------
\\begin{document}

\\frame{\\titlepage}

\\begin{frame}
\\frametitle{Outline}
\\tableofcontents
\\end{frame}

\\section{Introduction}
\\begin{frame}
\\frametitle{Introduction}
\\begin{itemize}
  \\item Point 1
  \\item Point 2
  \\item Point 3
\\end{itemize}
\\end{frame}

\\section{Main Content}
\\begin{frame}
\\frametitle{Main Content}
Content goes here.
\\end{frame}

\\section{Conclusion}
\\begin{frame}
\\frametitle{Conclusion}
\\begin{itemize}
  \\item Summary point 1
  \\item Summary point 2
\\end{itemize}
\\end{frame}

\\begin{frame}
\\frametitle{Thank You}
\\centering
Thank you for your attention!

\\vspace{1cm}

Questions?
\\end{frame}

\\end{document}
`,
      'README.md': `# Beamer Presentation Project

This is a LaTeX Beamer presentation.
`
    }
  },

  thesis: {
    name: 'Thesis/Dissertation',
    description: 'Full thesis with multiple chapters and biblatex',
    files: {
      'main.tex': `\\documentclass[12pt,a4paper,oneside]{book}

% ------------------------------------------------------------
% Essential Packages
% ------------------------------------------------------------
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{lmodern}

% Margins
\\usepackage[top=2.5cm,bottom=2.5cm,left=3cm,right=2.5cm]{geometry}

% Line spacing
\\usepackage{setspace}
\\onehalfspacing

% Math and symbols
\\usepackage{amsmath,amssymb,amsthm}

% Graphics and figures
\\usepackage{graphicx}
\\usepackage{float}
\\usepackage{caption}
\\usepackage{subcaption}

% Tables
\\usepackage{booktabs}
\\usepackage{longtable}

% Links and references
\\usepackage{hyperref}
\\usepackage[capitalise]{cleveref}

% Bibliography with biblatex
\\usepackage[backend=biber,style=authoryear,sorting=nyt]{biblatex}
\\addbibresource{references.bib}

% Appendix
\\usepackage[toc,page]{appendix}

% ------------------------------------------------------------
% Metadata
% ------------------------------------------------------------
\\title{Thesis Title}
\\author{Your Name}
\\date{\\today}

% ------------------------------------------------------------
% Document
% ------------------------------------------------------------
\\begin{document}

% Front matter
\\frontmatter
\\maketitle

\\chapter*{Abstract}
\\addcontentsline{toc}{chapter}{Abstract}
Your abstract goes here.

\\chapter*{Acknowledgements}
\\addcontentsline{toc}{chapter}{Acknowledgements}
Your acknowledgements go here.

\\tableofcontents
\\listoffigures
\\listoftables

% Main matter
\\mainmatter

\\chapter{Introduction}
\\label{chap:introduction}

Introduction content \\cite{example2024}.

\\chapter{Literature Review}
\\label{chap:literature}

Literature review content.

\\chapter{Methodology}
\\label{chap:methodology}

Methodology content.

\\chapter{Results}
\\label{chap:results}

Results content.

\\chapter{Discussion}
\\label{chap:discussion}

Discussion content.

\\chapter{Conclusion}
\\label{chap:conclusion}

Conclusion content.

% Back matter
\\backmatter

% Bibliography
\\printbibliography[heading=bibintoc]

% Appendices
\\begin{appendices}
\\chapter{Additional Data}
\\label{app:data}

Appendix content.

\\end{appendices}

\\end{document}
`,
      'references.bib': `@article{example2024,
  title = {Example Article for Thesis},
  author = {Author, First and Author, Second},
  year = {2024},
  journal = {Example Journal},
  volume = {10},
  number = {2},
  pages = {100--120}
}
`,
      'README.md': `# Thesis Project

This is a comprehensive thesis template with biblatex bibliography.
`
    }
  }
};

/**
 * Initialize a new project with a specific template
 */
export async function initializeProject(projectDir, templateType = 'article') {
  const template = PROJECT_TEMPLATES[templateType];

  if (!template) {
    throw new Error(`Unknown template type: ${templateType}. Available: ${Object.keys(PROJECT_TEMPLATES).join(', ')}`);
  }

  console.log(`📁 Initializing ${template.name} project...`);
  console.log(`   ${template.description}`);

  // Create project directory if it doesn't exist
  try {
    await fs.mkdir(projectDir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }

  // Create all template files
  for (const [filename, content] of Object.entries(template.files)) {
    const filePath = path.join(projectDir, filename);
    await fs.writeFile(filePath, content, 'utf-8');
    console.log(`   ✅ Created ${filename}`);
  }

  // Create .gitignore
  const gitignore = `# LaTeX build artifacts
*.aux
*.bbl
*.bcf
*.blg
*.log
*.out
*.toc
*.lof
*.lot
*.fls
*.fdb_latexmk
*.synctex.gz
*.run.xml
*.xdv

# Output PDFs (optional - remove if you want to track PDFs)
*.pdf

# OS files
.DS_Store
Thumbs.db
`;

  await fs.writeFile(path.join(projectDir, '.gitignore'), gitignore, 'utf-8');
  console.log(`   ✅ Created .gitignore`);

  console.log(`\n✅ Project initialized successfully at: ${projectDir}`);
  console.log(`\n📝 To compile: run your LaTeX compiler on main.tex`);

  return {
    success: true,
    projectDir,
    template: templateType,
    files: Object.keys(template.files)
  };
}

/**
 * Validate project structure
 */
export async function validateProject(projectDir) {
  const validation = {
    valid: true,
    mainTexExists: false,
    bibliographyExists: false,
    errors: [],
    warnings: []
  };

  // Check for main.tex
  try {
    await fs.access(path.join(projectDir, 'main.tex'));
    validation.mainTexExists = true;
  } catch {
    validation.valid = false;
    validation.errors.push('main.tex not found');
  }

  // Check for bibliography files
  const bibFiles = ['references.bib', 'bibliography.bib', 'refs.bib'];
  for (const bibFile of bibFiles) {
    try {
      await fs.access(path.join(projectDir, bibFile));
      validation.bibliographyExists = true;
      break;
    } catch {
      // Continue checking
    }
  }

  // Check if main.tex uses biblatex
  if (validation.mainTexExists) {
    try {
      const mainContent = await fs.readFile(path.join(projectDir, 'main.tex'), 'utf-8');
      const usesBiblatex = /\\usepackage.*\{biblatex\}/i.test(mainContent);
      const hasBibresource = /\\addbibresource/i.test(mainContent);

      if (usesBiblatex && !hasBibresource) {
        validation.warnings.push('biblatex package is loaded but no \\addbibresource command found');
      }

      if (usesBiblatex && hasBibresource && !validation.bibliographyExists) {
        validation.warnings.push('biblatex configured but no .bib file found');
      }
    } catch (err) {
      validation.warnings.push('Could not read main.tex');
    }
  }

  return validation;
}

/**
 * Clean build artifacts
 */
export async function cleanProject(projectDir) {
  const artifactPatterns = [
    '*.aux', '*.bbl', '*.bcf', '*.blg', '*.log', '*.out',
    '*.toc', '*.lof', '*.lot', '*.fls', '*.fdb_latexmk',
    '*.synctex.gz', '*.run.xml', '*.xdv'
  ];

  console.log('🧹 Cleaning build artifacts...');

  let cleaned = 0;

  try {
    const files = await fs.readdir(projectDir);

    for (const file of files) {
      const ext = path.extname(file);
      const shouldDelete = artifactPatterns.some(pattern => {
        const regex = new RegExp('^' + pattern.replace('*', '.*') + '$');
        return regex.test(file);
      });

      if (shouldDelete) {
        try {
          await fs.unlink(path.join(projectDir, file));
          console.log(`   🗑️  Deleted ${file}`);
          cleaned++;
        } catch (err) {
          console.warn(`   ⚠️  Could not delete ${file}: ${err.message}`);
        }
      }
    }

    console.log(`\n✅ Cleaned ${cleaned} artifact(s)`);
  } catch (err) {
    console.error(`❌ Error cleaning project: ${err.message}`);
  }

  return cleaned;
}

/**
 * List available templates
 */
export function listTemplates() {
  console.log('\n📋 Available Project Templates:\n');

  for (const [key, template] of Object.entries(PROJECT_TEMPLATES)) {
    console.log(`   ${key.padEnd(15)} - ${template.name}`);
    console.log(`   ${' '.repeat(17)} ${template.description}`);
    console.log();
  }
}

/**
 * Get template info
 */
export function getTemplate(templateType) {
  return PROJECT_TEMPLATES[templateType] || null;
}

/**
 * Check if directory is a valid LaTeX project
 */
export async function isLatexProject(dirPath) {
  try {
    const files = await fs.readdir(dirPath);
    return files.some(f => f.endsWith('.tex'));
  } catch {
    return false;
  }
}
