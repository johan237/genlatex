/**
 * Project Templates Manager
 * Pre-built templates for different research types
 */

import fs from 'fs/promises';
import path from 'path';
import { getProjectPath } from './files.js';

export class ProjectTemplatesManager {
  constructor() {
    this.templates = new Map();
    this.loadTemplates();
  }

  /**
   * Load built-in templates
   */
  loadTemplates() {
    // Academic Paper Template
    this.templates.set('academic_paper', {
      id: 'academic_paper',
      name: 'Academic Paper',
      description: 'Standard academic paper template with sections for introduction, methods, results, and conclusion',
      category: 'academic',
      files: {
        'main.tex': this.getAcademicPaperTemplate(),
        'references.bib': this.getReferencesTemplate()
      },
      metadata: {
        author: 'Your Name',
        title: 'Your Paper Title',
        abstract: 'Brief description of your research',
        keywords: 'keyword1, keyword2, keyword3'
      }
    });

    // Thesis Template
    this.templates.set('thesis', {
      id: 'thesis',
      name: 'PhD Thesis',
      description: 'Comprehensive thesis template with chapters, appendices, and bibliography',
      category: 'academic',
      files: {
        'main.tex': this.getThesisTemplate(),
        'chapters/introduction.tex': this.getIntroductionChapter(),
        'chapters/methodology.tex': this.getMethodologyChapter(),
        'chapters/results.tex': this.getResultsChapter(),
        'chapters/conclusion.tex': this.getConclusionChapter(),
        'appendices/appendix_a.tex': this.getAppendixTemplate(),
        'references.bib': this.getReferencesTemplate()
      },
      metadata: {
        author: 'Your Name',
        title: 'Your Thesis Title',
        degree: 'Doctor of Philosophy',
        department: 'Your Department',
        university: 'Your University',
        year: new Date().getFullYear().toString()
      }
    });

    // Conference Paper Template
    this.templates.set('conference_paper', {
      id: 'conference_paper',
      name: 'Conference Paper',
      description: 'IEEE-style conference paper template with strict formatting requirements',
      category: 'academic',
      files: {
        'main.tex': this.getConferencePaperTemplate(),
        'references.bib': this.getReferencesTemplate()
      },
      metadata: {
        author: 'Your Name',
        title: 'Your Conference Paper Title',
        conference: 'Conference Name',
        year: new Date().getFullYear().toString()
      }
    });

    // Technical Report Template
    this.templates.set('technical_report', {
      id: 'technical_report',
      name: 'Technical Report',
      description: 'Professional technical report template with executive summary and detailed sections',
      category: 'professional',
      files: {
        'main.tex': this.getTechnicalReportTemplate(),
        'references.bib': this.getReferencesTemplate()
      },
      metadata: {
        author: 'Your Name',
        title: 'Technical Report Title',
        organization: 'Your Organization',
        reportNumber: 'TR-001',
        date: new Date().toISOString().split('T')[0]
      }
    });

    // Research Proposal Template
    this.templates.set('research_proposal', {
      id: 'research_proposal',
      name: 'Research Proposal',
      description: 'Comprehensive research proposal template with budget, timeline, and methodology',
      category: 'academic',
      files: {
        'main.tex': this.getResearchProposalTemplate(),
        'references.bib': this.getReferencesTemplate()
      },
      metadata: {
        author: 'Your Name',
        title: 'Research Proposal Title',
        institution: 'Your Institution',
        fundingAgency: 'Funding Agency',
        proposalNumber: 'PROP-001'
      }
    });

    // Book Chapter Template
    this.templates.set('book_chapter', {
      id: 'book_chapter',
      name: 'Book Chapter',
      description: 'Template for contributing a chapter to an edited book',
      category: 'academic',
      files: {
        'main.tex': this.getBookChapterTemplate(),
        'references.bib': this.getReferencesTemplate()
      },
      metadata: {
        author: 'Your Name',
        title: 'Chapter Title',
        bookTitle: 'Book Title',
        editor: 'Editor Name',
        publisher: 'Publisher Name',
        year: new Date().getFullYear().toString()
      }
    });

    // Software Documentation Template
    this.templates.set('software_docs', {
      id: 'software_docs',
      name: 'Software Documentation',
      description: 'Template for documenting software projects with API references and user guides',
      category: 'technical',
      files: {
        'main.tex': this.getSoftwareDocsTemplate(),
        'sections/installation.tex': this.getInstallationSection(),
        'sections/api.tex': this.getAPISection(),
        'sections/examples.tex': this.getExamplesSection()
      },
      metadata: {
        projectName: 'Your Software Project',
        version: '1.0.0',
        author: 'Your Name',
        license: 'MIT License'
      }
    });

    // Lab Report Template
    this.templates.set('lab_report', {
      id: 'lab_report',
      name: 'Lab Report',
      description: 'Template for laboratory reports with experimental procedures and results',
      category: 'academic',
      files: {
        'main.tex': this.getLabReportTemplate(),
        'references.bib': this.getReferencesTemplate()
      },
      metadata: {
        author: 'Your Name',
        title: 'Lab Report Title',
        course: 'Course Name',
        instructor: 'Instructor Name',
        date: new Date().toISOString().split('T')[0]
      }
    });
  }

  /**
   * Create project from template
   */
  async createProjectFromTemplate(projectId, templateId, options = {}) {
    try {
      const template = this.templates.get(templateId);
      if (!template) {
        return {
          success: false,
          error: `Template '${templateId}' not found`
        };
      }

      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      await fs.mkdir(projectPath, { recursive: true });

      const createdFiles = [];

      // Create files from template
      for (const [filePath, content] of Object.entries(template.files)) {
        const fullPath = path.join(projectPath, filePath);
        
        if (content === 'directory') {
          await fs.mkdir(fullPath, { recursive: true });
          createdFiles.push(filePath);
        } else {
          // Replace placeholders in content
          let fileContent = content;
          const metadata = { ...template.metadata, ...options.metadata };
          
          for (const [key, value] of Object.entries(metadata)) {
            const placeholder = `{{${key}}}`;
            fileContent = fileContent.replace(new RegExp(placeholder, 'g'), value);
          }
          
          // Create directory if needed
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, fileContent, 'utf-8');
          createdFiles.push(filePath);
        }
      }

      // Create project metadata
      const projectMetadata = {
        templateId,
        templateName: template.name,
        createdAt: new Date().toISOString(),
        metadata: { ...template.metadata, ...options.metadata },
        files: createdFiles
      };

      const metadataPath = path.join(projectPath, 'project_metadata.json');
      await fs.writeFile(metadataPath, JSON.stringify(projectMetadata, null, 2));

      return {
        success: true,
        projectId,
        template: template.name,
        filesCreated: createdFiles,
        metadata: projectMetadata
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Get available templates
   */
  getAvailableTemplates() {
    const templates = Array.from(this.templates.values()).map(template => ({
      id: template.id,
      name: template.name,
      description: template.description,
      category: template.category,
      metadata: template.metadata
    }));

    return {
      success: true,
      templates,
      totalTemplates: templates.length,
      categories: [...new Set(templates.map(t => t.category))]
    };
  }

  /**
   * Get template by ID
   */
  getTemplate(templateId) {
    const template = this.templates.get(templateId);
    if (!template) {
      return {
        success: false,
        error: `Template '${templateId}' not found`
      };
    }

    return {
      success: true,
      template: {
        id: template.id,
        name: template.name,
        description: template.description,
        category: template.category,
        files: Object.keys(template.files),
        metadata: template.metadata
      }
    };
  }

  /**
   * Get templates by category
   */
  getTemplatesByCategory(category) {
    const templates = Array.from(this.templates.values())
      .filter(template => template.category === category)
      .map(template => ({
        id: template.id,
        name: template.name,
        description: template.description,
        metadata: template.metadata
      }));

    return {
      success: true,
      templates,
      category,
      totalTemplates: templates.length
    };
  }

  /**
   * Return default main.tex content (academic paper with placeholders replaced by safe defaults).
   * Used when ZIP import contains no .tex file so the project has a valid main.tex.
   */
  getDefaultMainTexContent() {
    let content = this.getAcademicPaperTemplate();
    const defaults = {
      title: 'Your Title',
      author: 'Your Name',
      abstract: 'Brief description of your research.',
      keywords: 'keyword1, keyword2, keyword3'
    };
    for (const [key, value] of Object.entries(defaults)) {
      content = content.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    }
    return content;
  }

  /**
   * Template content generators
   */
  getAcademicPaperTemplate() {
    return `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amsfonts,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{url}
\\usepackage{hyperref}

\\title{{{title}}}
\\author{{{author}}}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
{{abstract}}
\\end{abstract}

\\textbf{Keywords:} {{keywords}}

\\section{Introduction}
% Write your introduction here

\\section{Related Work}
% Review of related work

\\section{Methodology}
% Describe your methods

\\section{Results}
% Present your results

\\section{Discussion}
% Discuss your findings

\\section{Conclusion}
% Conclude your paper

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}`;
  }

  getThesisTemplate() {
    return `\\documentclass[12pt]{report}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amsfonts,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{url}
\\usepackage{hyperref}
\\usepackage{geometry}
\\geometry{margin=2.5cm}

\\title{{{title}}}
\\author{{{author}}}
\\date{\\today}

\\begin{document}

\\maketitle

\\tableofcontents
\\listoffigures
\\listoftables

\\begin{abstract}
% Write your abstract here
\\end{abstract}

\\chapter{Introduction}
\\input{chapters/introduction}

\\chapter{Literature Review}
% Review of literature

\\chapter{Methodology}
\\input{chapters/methodology}

\\chapter{Results}
\\input{chapters/results}

\\chapter{Discussion}
% Discuss your findings

\\chapter{Conclusion}
\\input{chapters/conclusion}

\\appendix
\\chapter{Appendix A}
\\input{appendices/appendix_a}

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}`;
  }

  getConferencePaperTemplate() {
    return `\\documentclass[conference]{IEEEtran}
\\IEEEoverridecommandlockouts
\\usepackage{cite}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{algorithmic}
\\usepackage{graphicx}
\\usepackage{textcomp}
\\usepackage{xcolor}

\\def\\BibTeX{{\\rm B\\kern-.05em{\\sc i\\kern-.025em b}\\kern-.08em
    T\\kern-.1667em\\lower.7ex\\hbox{E}\\kern-.125emX}}

\\begin{document}

\\title{{{title}}}

\\author{\\IEEEauthorblockN{1\\textsuperscript{st} {{author}}}
\\IEEEauthorblockA{\\textit{Department} \\\\
\\textit{Institution}\\\\
City, Country \\
email@example.com}
}

\\maketitle

\\begin{abstract}
{{abstract}}
\\end{abstract}

\\begin{IEEEkeywords}
{{keywords}}
\\end{IEEEkeywords}

\\section{Introduction}
% Write your introduction here

\\section{Related Work}
% Review of related work

\\section{Methodology}
% Describe your methods

\\section{Results}
% Present your results

\\section{Discussion}
% Discuss your findings

\\section{Conclusion}
% Conclude your paper

\\begin{thebibliography}{99}
\\bibitem{ref1}
Sample reference
\\end{thebibliography}

\\end{document}`;
  }

  getTechnicalReportTemplate() {
    return `\\documentclass[11pt,a4paper]{report}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amsfonts,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{url}
\\usepackage{hyperref}

\\title{{{title}}}
\\author{{{author}}}
\\date{{{date}}}

\\begin{document}

\\maketitle

\\tableofcontents

\\chapter{Executive Summary}
% Write executive summary here

\\chapter{Introduction}
% Introduction to the report

\\chapter{Background}
% Background information

\\chapter{Methodology}
% Methodology used

\\chapter{Results}
% Results and findings

\\chapter{Discussion}
% Discussion of results

\\chapter{Conclusions and Recommendations}
% Conclusions and recommendations

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}`;
  }

  getResearchProposalTemplate() {
    return `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amsfonts,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{url}
\\usepackage{hyperref}

\\title{{{title}}}
\\author{{{author}}}
\\date{\\today}

\\begin{document}

\\maketitle

\\section{Abstract}
% Write your abstract here

\\section{Introduction}
% Introduction and problem statement

\\section{Literature Review}
% Review of relevant literature

\\section{Research Questions and Objectives}
% State your research questions and objectives

\\section{Methodology}
% Describe your research methodology

\\section{Expected Outcomes}
% Describe expected outcomes

\\section{Timeline}
% Provide research timeline

\\section{Budget}
% Provide budget breakdown

\\section{References}
\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}`;
  }

  getBookChapterTemplate() {
    return `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amsfonts,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{url}
\\usepackage{hyperref}

\\title{{{title}}}
\\author{{{author}}}

\\begin{document}

\\maketitle

\\section{Introduction}
% Write your introduction here

\\section{Main Content}
% Main content of your chapter

\\section{Conclusion}
% Conclude your chapter

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}`;
  }

  getSoftwareDocsTemplate() {
    return `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amsfonts,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{url}
\\usepackage{hyperref}
\\usepackage{listings}

\\title{{{projectName}} Documentation}
\\author{{{author}}}
\\date{Version {{version}}}

\\begin{document}

\\maketitle

\\tableofcontents

\\section{Introduction}
% Introduction to your software

\\section{Installation}
\\input{sections/installation}

\\section{Quick Start}
% Quick start guide

\\section{API Reference}
\\input{sections/api}

\\section{Examples}
\\input{sections/examples}

\\section{Troubleshooting}
% Common issues and solutions

\\section{License}
% License information: {{license}}

\\end{document}`;
  }

  getLabReportTemplate() {
    return `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amsfonts,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{url}
\\usepackage{hyperref}

\\title{{{title}}}
\\author{{{author}}}
\\date{{{date}}}

\\begin{document}

\\maketitle

\\section{Abstract}
% Write your abstract here

\\section{Introduction}
% Introduction and objectives

\\section{Methodology}
% Experimental procedure

\\section{Results}
% Present your results

\\section{Discussion}
% Discuss your findings

\\section{Conclusion}
% Conclude your report

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}`;
  }

  getIntroductionChapter() {
    return `\\chapter{Introduction}

\\section{Background}
% Write background information here

\\section{Problem Statement}
% State the problem

\\section{Research Objectives}
% State your research objectives

\\section{Thesis Outline}
% Outline the structure of your thesis`;
  }

  getMethodologyChapter() {
    return `\\chapter{Methodology}

\\section{Research Design}
% Describe your research design

\\section{Data Collection}
% Describe data collection methods

\\section{Data Analysis}
% Describe data analysis methods

\\section{Limitations}
% Discuss limitations of your methodology`;
  }

  getResultsChapter() {
    return `\\chapter{Results}

\\section{Overview}
% Overview of results

\\section{Detailed Results}
% Present detailed results

\\section{Statistical Analysis}
% Present statistical analysis

\\section{Summary}
% Summary of results`;
  }

  getConclusionChapter() {
    return `\\chapter{Conclusion}

\\section{Summary of Findings}
% Summarize your findings

\\section{Contributions}
% Discuss your contributions

\\section{Limitations}
% Discuss limitations

\\section{Future Work}
% Suggest future work`;
  }

  getAppendixTemplate() {
    return `\\chapter{Appendix A}

\\section{Additional Data}
% Additional data and materials

\\section{Code Listings}
% Code listings if applicable`;
  }

  getReferencesTemplate() {
    return `@article{example2023,
  title={Example Article},
  author={Doe, John and Smith, Jane},
  journal={Example Journal},
  year={2023},
  volume={1},
  number={1},
  pages={1--10}
}

@book{example2022,
  title={Example Book},
  author={Johnson, Bob},
  publisher={Example Publisher},
  year={2022}
}`;
  }

  getInstallationSection() {
    return `\\section{Installation}

\\subsection{Requirements}
% List system requirements

\\subsection{Installation Steps}
% Provide installation steps

\\subsection{Verification}
% How to verify installation`;
  }

  getAPISection() {
    return `\\section{API Reference}

\\subsection{Core Functions}
% Document core functions

\\subsection{Configuration}
% Document configuration options

\\subsection{Examples}
% Provide API examples`;
  }

  getExamplesSection() {
    return `\\section{Examples}

\\subsection{Basic Usage}
% Basic usage examples

\\subsection{Advanced Usage}
% Advanced usage examples

\\subsection{Common Patterns}
% Common usage patterns`;
  }
}
