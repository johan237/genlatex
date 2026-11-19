/**
 * Template Manager
 * Handles paper templates for different formats (IEEE, Springer, UCAMI, etc.)
 */

import fs from 'fs/promises';
import path from 'path';

export class TemplateManager {
  constructor() {
    this.templates = new Map();
    this.templatesPath = path.join(process.cwd(), 'data', 'templates');
    this.loadTemplates();
  }

  /**
   * Load all available templates
   */
  async loadTemplates() {
    try {
      await fs.mkdir(this.templatesPath, { recursive: true });
      
      // Load built-in templates
      this.loadBuiltInTemplates();
      
      // Load custom templates from filesystem
      await this.loadCustomTemplates();
    } catch (error) {
      console.warn('Could not load templates:', error.message);
    }
  }

  /**
   * Load built-in templates
   */
  loadBuiltInTemplates() {
    // IEEE Conference Template
    this.templates.set('ieee', {
      name: 'IEEE Conference',
      description: 'Standard IEEE conference paper format',
      category: 'conference',
      format: (paper) => `\\documentclass[conference]{IEEEtran}
\\IEEEoverridecommandlockouts
\\usepackage{cite}
\\usepackage{amsmath,amssymb,amsfonts}
\\usepackage{algorithmic}
\\usepackage{graphicx}
\\usepackage{textcomp}
\\usepackage{xcolor}
\\usepackage{listings}
\\usepackage{url}
\\usepackage{booktabs}
\\usepackage{multirow}

\\def\\BibTeX{{\\rm B\\kern-.05em{\\sc i\\kern-.025em b}\\kern-.08em
    T\\kern-.1667em\\lower.7ex\\hbox{E}\\kern-.125emX}}

\\begin{document}

\\title{${paper.title}}

\\author{\\IEEEauthorblockN{1\\textsuperscript{st} Author Name}
\\IEEEauthorblockA{\\textit{Department} \\\\
\\textit{Institution}\\\\
City, Country \\
email@example.com}
\\and
\\IEEEauthorblockN{2\\textsuperscript{nd} Author Name}
\\IEEEauthorblockA{\\textit{Department} \\\\
\\textit{Institution}\\\\
City, Country \\
email@example.com}
}

\\maketitle

\\begin{abstract}
${paper.abstract}
\\end{abstract}

\\begin{IEEEkeywords}
software analysis, code structure, repository intelligence, automated documentation
\\end{IEEEkeywords}

${paper.introduction}

${paper.methods}

${paper.results}

${paper.discussion}

${paper.conclusion}

${paper.figures}

${paper.code_snippets}

${paper.reproducibility}

${paper.references}

\\end{document}`,
      metadata: {
        max_pages: 8,
        max_figures: 10,
        max_tables: 5,
        required_sections: ['abstract', 'introduction', 'methods', 'results', 'conclusion'],
        optional_sections: ['discussion', 'acknowledgments', 'appendix']
      }
    });

    // Springer LNCS Template
    this.templates.set('springer-lncs', {
      name: 'Springer LNCS',
      description: 'Springer Lecture Notes in Computer Science format',
      category: 'conference',
      format: (paper) => `\\documentclass[runningheads]{llncs}

\\usepackage{graphicx}
\\usepackage{listings}
\\usepackage{url}
\\usepackage{booktabs}
\\usepackage{multirow}
\\usepackage{amsmath}
\\usepackage{amssymb}

\\begin{document}

\\title{${paper.title}}

\\author{Author Name\\inst{1}\\orcidID{0000-0000-0000-0000}}

\\authorrunning{Author Name}

\\institute{Institution Name\\
\\email{email@example.com}}

\\maketitle

\\begin{abstract}
${paper.abstract}
\\end{abstract}

\\keywords{software analysis \\and code structure \\and repository intelligence}

${paper.introduction}

${paper.methods}

${paper.results}

${paper.discussion}

${paper.conclusion}

${paper.figures}

${paper.code_snippets}

${paper.reproducibility}

${paper.references}

\\end{document}`,
      metadata: {
        max_pages: 12,
        max_figures: 15,
        max_tables: 8,
        required_sections: ['abstract', 'introduction', 'methods', 'results', 'conclusion'],
        optional_sections: ['discussion', 'acknowledgments', 'appendix']
      }
    });

    // UCAMI Template
    this.templates.set('ucami', {
      name: 'UCAMI',
      description: 'Ubiquitous Computing and Ambient Intelligence format',
      category: 'conference',
      format: (paper) => `\\documentclass{article}
\\usepackage[utf8]{inputenc}
\\usepackage{graphicx}
\\usepackage{listings}
\\usepackage{url}
\\usepackage{booktabs}
\\usepackage{multirow}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{geometry}
\\geometry{a4paper, margin=2.5cm}

\\title{${paper.title}}
\\author{Author Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
${paper.abstract}
\\end{abstract}

\\textbf{Keywords:} software analysis, code structure, repository intelligence, automated documentation

${paper.introduction}

${paper.methods}

${paper.results}

${paper.discussion}

${paper.conclusion}

${paper.figures}

${paper.code_snippets}

${paper.reproducibility}

${paper.references}

\\end{document}`,
      metadata: {
        max_pages: 10,
        max_figures: 12,
        max_tables: 6,
        required_sections: ['abstract', 'introduction', 'methods', 'results', 'conclusion'],
        optional_sections: ['discussion', 'acknowledgments', 'appendix']
      }
    });

    // ACM Template
    this.templates.set('acm', {
      name: 'ACM',
      description: 'Association for Computing Machinery format',
      category: 'conference',
      format: (paper) => `\\documentclass[sigconf]{acmart}

\\usepackage{listings}
\\usepackage{booktabs}
\\usepackage{multirow}

\\acmConference[Conference]{Conference Name}{Date}{Location}
\\acmYear{2024}
\\copyrightyear{2024}
\\acmISBN{978-1-4503-XXXX-X/18/06}
\\acmDOI{10.1145/XXXXXXX.XXXXXXX}

\\begin{document}

\\title{${paper.title}}

\\author{Author Name}
\\affiliation{\\institution{Institution Name}}
\\email{email@example.com}

\\begin{abstract}
${paper.abstract}
\\end{abstract}

\\keywords{software analysis, code structure, repository intelligence}

\\maketitle

${paper.introduction}

${paper.methods}

${paper.results}

${paper.discussion}

${paper.conclusion}

${paper.figures}

${paper.code_snippets}

${paper.reproducibility}

${paper.references}

\\end{document}`,
      metadata: {
        max_pages: 10,
        max_figures: 12,
        max_tables: 6,
        required_sections: ['abstract', 'introduction', 'methods', 'results', 'conclusion'],
        optional_sections: ['discussion', 'acknowledgments', 'appendix']
      }
    });

    // Thesis Template
    this.templates.set('thesis', {
      name: 'Thesis',
      description: 'Academic thesis format',
      category: 'thesis',
      format: (paper) => `\\documentclass[12pt]{report}
\\usepackage[utf8]{inputenc}
\\usepackage{graphicx}
\\usepackage{listings}
\\usepackage{url}
\\usepackage{booktabs}
\\usepackage{multirow}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{geometry}
\\geometry{a4paper, margin=2.5cm}

\\title{${paper.title}}
\\author{Author Name}
\\date{\\today}

\\begin{document}

\\maketitle

\\tableofcontents
\\listoffigures
\\listoftables

\\begin{abstract}
${paper.abstract}
\\end{abstract}

\\chapter{Introduction}
${paper.introduction}

\\chapter{Methodology}
${paper.methods}

\\chapter{Results}
${paper.results}

\\chapter{Discussion}
${paper.discussion}

\\chapter{Conclusion}
${paper.conclusion}

${paper.figures}

${paper.code_snippets}

${paper.reproducibility}

\\bibliographystyle{plain}
\\bibliography{references}

\\end{document}`,
      metadata: {
        max_pages: 100,
        max_figures: 50,
        max_tables: 20,
        required_sections: ['abstract', 'introduction', 'methods', 'results', 'conclusion'],
        optional_sections: ['discussion', 'acknowledgments', 'appendix']
      }
    });
  }

  /**
   * Load custom templates from filesystem
   */
  async loadCustomTemplates() {
    try {
      const templateDirs = await fs.readdir(this.templatesPath, { withFileTypes: true });
      
      for (const dir of templateDirs) {
        if (dir.isDirectory()) {
          const templatePath = path.join(this.templatesPath, dir.name);
          const configPath = path.join(templatePath, 'template.json');
          
          try {
            const configContent = await fs.readFile(configPath, 'utf-8');
            const config = JSON.parse(configContent);
            
            // Load template file
            const templateFile = path.join(templatePath, 'template.tex');
            const templateContent = await fs.readFile(templateFile, 'utf-8');
            
            this.templates.set(dir.name, {
              ...config,
              format: (paper) => this.interpolateTemplate(templateContent, paper),
              custom: true
            });
          } catch (error) {
            console.warn(`Could not load custom template ${dir.name}:`, error.message);
          }
        }
      }
    } catch (error) {
      console.warn('Could not load custom templates:', error.message);
    }
  }

  /**
   * Interpolate template with paper content
   */
  interpolateTemplate(template, paper) {
    let result = template;
    
    // Replace placeholders
    result = result.replace(/\\{\\{title\\}\\}/g, paper.title || '');
    result = result.replace(/\\{\\{abstract\\}\\}/g, paper.abstract || '');
    result = result.replace(/\\{\\{introduction\\}\\}/g, paper.introduction || '');
    result = result.replace(/\\{\\{methods\\}\\}/g, paper.methods || '');
    result = result.replace(/\\{\\{results\\}\\}/g, paper.results || '');
    result = result.replace(/\\{\\{discussion\\}\\}/g, paper.discussion || '');
    result = result.replace(/\\{\\{conclusion\\}\\}/g, paper.conclusion || '');
    result = result.replace(/\\{\\{figures\\}\\}/g, paper.figures || '');
    result = result.replace(/\\{\\{code_snippets\\}\\}/g, paper.code_snippets || '');
    result = result.replace(/\\{\\{reproducibility\\}\\}/g, paper.reproducibility || '');
    result = result.replace(/\\{\\{references\\}\\}/g, paper.references || '');
    
    return result;
  }

  /**
   * Get all available templates
   */
  getTemplates() {
    return Array.from(this.templates.entries()).map(([id, template]) => ({
      id,
      ...template
    }));
  }

  /**
   * Get template by ID
   */
  getTemplate(id) {
    return this.templates.get(id);
  }

  /**
   * Apply template to paper
   */
  applyTemplate(paper, templateId) {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template '${templateId}' not found`);
    }
    
    return template.format(paper);
  }

  /**
   * Create custom template
   */
  async createCustomTemplate(id, config, templateContent) {
    try {
      const templateDir = path.join(this.templatesPath, id);
      await fs.mkdir(templateDir, { recursive: true });
      
      // Save template configuration
      const configPath = path.join(templateDir, 'template.json');
      await fs.writeFile(configPath, JSON.stringify(config, null, 2));
      
      // Save template content
      const templatePath = path.join(templateDir, 'template.tex');
      await fs.writeFile(templatePath, templateContent);
      
      // Reload templates
      await this.loadCustomTemplates();
      
      return {
        success: true,
        message: 'Custom template created successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Delete custom template
   */
  async deleteCustomTemplate(id) {
    try {
      const template = this.templates.get(id);
      if (!template || !template.custom) {
        throw new Error('Template not found or not custom');
      }
      
      const templateDir = path.join(this.templatesPath, id);
      await fs.rm(templateDir, { recursive: true, force: true });
      
      // Remove from memory
      this.templates.delete(id);
      
      return {
        success: true,
        message: 'Custom template deleted successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Validate paper against template requirements
   */
  validatePaper(paper, templateId) {
    const template = this.templates.get(templateId);
    if (!template) {
      return {
        valid: false,
        errors: [`Template '${templateId}' not found`]
      };
    }
    
    const validation = {
      valid: true,
      errors: [],
      warnings: []
    };
    
    const metadata = template.metadata;
    
    // Check required sections
    if (metadata.required_sections) {
      for (const section of metadata.required_sections) {
        if (!paper[section] || paper[section].trim() === '') {
          validation.valid = false;
          validation.errors.push(`Missing required section: ${section}`);
        }
      }
    }
    
    // Check page limits (estimated)
    const estimatedPages = this.estimatePages(paper);
    if (metadata.max_pages && estimatedPages > metadata.max_pages) {
      validation.warnings.push(`Estimated pages (${estimatedPages}) exceeds limit (${metadata.max_pages})`);
    }
    
    // Check figure limits
    const figureCount = this.countFigures(paper);
    if (metadata.max_figures && figureCount > metadata.max_figures) {
      validation.warnings.push(`Number of figures (${figureCount}) exceeds limit (${metadata.max_figures})`);
    }
    
    return validation;
  }

  /**
   * Estimate number of pages
   */
  estimatePages(paper) {
    let totalWords = 0;
    
    const sections = ['abstract', 'introduction', 'methods', 'results', 'discussion', 'conclusion'];
    for (const section of sections) {
      if (paper[section]) {
        totalWords += paper[section].split(/\s+/).length;
      }
    }
    
    // Estimate ~250 words per page
    return Math.ceil(totalWords / 250);
  }

  /**
   * Count figures in paper
   */
  countFigures(paper) {
    let count = 0;
    
    const content = Object.values(paper).join(' ');
    const figureRegex = /\\begin\{figure\}/g;
    const matches = content.match(figureRegex);
    
    return matches ? matches.length : 0;
  }

  /**
   * Get template categories
   */
  getCategories() {
    const categories = new Set();
    
    for (const template of this.templates.values()) {
      categories.add(template.category);
    }
    
    return Array.from(categories);
  }

  /**
   * Get templates by category
   */
  getTemplatesByCategory(category) {
    return this.getTemplates().filter(template => template.category === category);
  }

  /**
   * Export template
   */
  async exportTemplate(id, exportPath) {
    try {
      const template = this.templates.get(id);
      if (!template) {
        throw new Error(`Template '${id}' not found`);
      }
      
      const templateDir = path.join(this.templatesPath, id);
      const exportDir = path.join(exportPath, id);
      
      // Copy template directory
      await this.copyDirectory(templateDir, exportDir);
      
      return {
        success: true,
        message: 'Template exported successfully',
        path: exportDir
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Import template
   */
  async importTemplate(importPath, id) {
    try {
      const templateDir = path.join(this.templatesPath, id);
      
      // Copy template directory
      await this.copyDirectory(importPath, templateDir);
      
      // Reload templates
      await this.loadCustomTemplates();
      
      return {
        success: true,
        message: 'Template imported successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Copy directory recursively
   */
  async copyDirectory(src, dest) {
    await fs.mkdir(dest, { recursive: true });
    
    const entries = await fs.readdir(src, { withFileTypes: true });
    
    for (const entry of entries) {
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      
      if (entry.isDirectory()) {
        await this.copyDirectory(srcPath, destPath);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}
