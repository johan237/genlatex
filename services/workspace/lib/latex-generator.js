import { AIModelClient } from './aimodel-client.js';
import { MemoryStrategy } from './memory-strategy.js';

/**
 * LaTeX Generator
 * Generates LaTeX documents based on processed file content and project information
 */
class LaTeXGenerator {
  constructor() {
    this.aiModelClient = new AIModelClient();
  }

  /**
   * Generate LaTeX document from project content
   * @param {Object} projectData - Project information
   * @param {Object} contentSummary - Processed file content summary
   * @param {string} projectType - Type of project (research, review, etc.)
   * @param {Object} templateData - Optional template data {content, parsed, path}
   * @returns {Promise<Object>} Generated LaTeX content and metadata
   */
  async generateLaTeX(projectData, contentSummary, projectType = 'research', templateData = null) {
    try {
      console.log('🤖 Generating LaTeX from project content...');
      
      if (templateData) {
        console.log('📋 Using template:', templateData.path);
      }
      
      // Retrieve relevant memory context
      let memoryContext = '';
      if (projectData.projectId) {
        try {
          const memoryStrategy = new MemoryStrategy(projectData.projectId);
          const memories = await memoryStrategy.getMemoryForState('planning', projectData);
          memoryContext = memoryStrategy.formatMemoryForPrompt(memories, 'planning');
          console.log(`🧠 Retrieved ${memories.length} relevant memories for planning`);
        } catch (memoryError) {
          console.warn('⚠️ Memory retrieval failed, continuing without memory:', memoryError);
        }
      }
      
      // Prepare context for LLM
      const context = this.prepareContext(projectData, contentSummary, projectType, templateData, memoryContext);
      
      // Generate LaTeX content
      const latexContent = await this.generateContent(context, templateData, memoryContext);
      
      // Generate bibliography (skip if template uses biblatex/natbib)
      let bibliography = '';
      if (!templateData || templateData.parsed?.bibliographyStyle.type === 'thebibliography') {
        bibliography = await this.generateBibliography(contentSummary.references, templateData);
      }
      
      // Combine everything
      const fullDocument = this.combineDocument(latexContent, bibliography, projectData, templateData);
      
      return {
        success: true,
        latex: fullDocument,
        metadata: {
          projectType,
          sections: this.extractSections(fullDocument),
          references: contentSummary.references.length,
          wordCount: this.estimateWordCount(fullDocument),
          generatedAt: new Date().toISOString(),
          usedTemplate: !!templateData,
          usedMemory: memoryContext.length > 0
        }
      };
      
    } catch (error) {
      console.error('❌ Error generating LaTeX:', error);
      return {
        success: false,
        error: error.message,
        latex: this.getFallbackTemplate(projectData)
      };
    }
  }

  /**
   * Prepare context for LLM generation
   * @param {Object} projectData - Project information
   * @param {Object} contentSummary - Processed file content
   * @param {string} projectType - Type of project
   * @param {Object} templateData - Optional template data
   * @param {string} memoryContext - Optional memory context
   * @returns {Object} Prepared context
   */
  prepareContext(projectData, contentSummary, projectType, templateData = null, memoryContext = '') {
    const context = {
      projectName: projectData.name,
      description: projectData.description,
      projectType: projectType,
      projectId: projectData.projectId,
      templateData: templateData,
      memoryContext: memoryContext,
      fileSummary: contentSummary.summary,
      keyFiles: contentSummary.keyFiles,
      references: contentSummary.references,
      content: (contentSummary.content || '').substring(0, 8000), // Limit content length
      totalFiles: contentSummary.totalFiles,
      processedFiles: contentSummary.processedFiles
    };

    return context;
  }

  /**
   * Generate LaTeX content using LLM
   * @param {Object} context - Prepared context
   * @param {Object} templateData - Optional template data
   * @param {string} memoryContext - Optional memory context
   * @returns {Promise<string>} Generated LaTeX content
   */
  async generateContent(context, templateData = null, memoryContext = '') {
    let systemPrompt = this.getSystemPrompt(context.projectType);
    
    // Add memory context to prompt if available
    if (memoryContext) {
      systemPrompt += `\n\n${memoryContext}\n\n`;
      systemPrompt += `INSTRUCTIONS FOR USING MEMORY:\n`;
      systemPrompt += `- Use information from memory context to inform your content generation\n`;
      systemPrompt += `- Cite sources from memory when relevant (use \\cite{} commands)\n`;
      systemPrompt += `- Reference methods, algorithms, or frameworks mentioned in memory\n`;
      systemPrompt += `- Ensure generated content aligns with information in memory\n`;
    }
    
    // Add template structure to prompt if available
    if (templateData && templateData.parsed) {
      const parsed = templateData.parsed;
      systemPrompt += `\n\nTEMPLATE STRUCTURE TO FOLLOW:\n`;
      systemPrompt += `- Document Class: \\documentclass[${parsed.documentClass.options.join(',')}]{${parsed.documentClass.name}}\n`;
      systemPrompt += `- Packages (${parsed.packages.length} total):\n`;
      parsed.packages.forEach(pkg => {
        const opts = pkg.options.length > 0 ? `[${pkg.options.join(',')}]` : '';
        systemPrompt += `  \\usepackage${opts}{${pkg.name}}\n`;
      });
      systemPrompt += `- Bibliography Style: ${parsed.bibliographyStyle.type} (${parsed.bibliographyStyle.style})\n`;
      if (parsed.structure.length > 0) {
        systemPrompt += `- Document Structure: ${parsed.structure.length} sections\n`;
        parsed.structure.slice(0, 10).forEach(sec => {
          systemPrompt += `  ${sec.type}: ${sec.title}\n`;
        });
      }
      systemPrompt += `\nIMPORTANT: Follow the template's document class, packages, and bibliography style exactly.\n`;
      systemPrompt += `Remove any placeholder content but maintain the structure and formatting.\n`;
    }
    
    const userPrompt = this.getUserPrompt(context);

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ];

    try {
      const response = await this.aiModelClient.chat(messages, {
        temperature: 0.7,
        max_tokens: 4000
      });

      // Handle the structured response from AIModelClient
      if (response.success && response.content) {
        return response.content;
      } else if (response.error) {
        throw new Error(`LLM API error: ${response.error}`);
      } else {
        // Fallback for direct content response
        return response.content || response;
      }
    } catch (error) {
      console.error('❌ LLM generation failed:', error);
      throw new Error(`LLM generation failed: ${error.message}`);
    }
  }

  /**
   * Get system prompt based on project type
   * @param {string} projectType - Type of project
   * @returns {string} System prompt
   */
  getSystemPrompt(projectType) {
    const basePrompt = `You are an expert LaTeX document generator. Your task is to create a well-structured, academic-quality LaTeX document based on the provided project information and file content.

Requirements:
1. Generate complete LaTeX document with proper structure
2. Include relevant sections based on project type
3. Use proper LaTeX formatting and commands
4. Include citations and references where appropriate
5. Make the content coherent and well-organized
6. Use academic writing style
7. Include proper LaTeX packages and document class

Project Type: ${projectType}`;

    const typeSpecificPrompts = {
      research: `
For a research article, include:
- Abstract
- Introduction
- Methodology/Implementation
- Results/Analysis
- Discussion
- Conclusion
- References

Focus on the technical implementation and findings from the code analysis.`,
      
      review: `
For a review article, include:
- Abstract
- Introduction
- Literature Review
- Analysis of Technologies/Methods Used
- Comparison and Evaluation
- Conclusion
- References

Focus on analyzing and comparing different approaches found in the code.`,
      
      project: `
For a project report, include:
- Abstract
- Introduction
- Project Overview
- Technical Implementation
- Features and Functionality
- Testing and Results
- Conclusion
- References

Focus on the project's purpose, implementation, and outcomes.`,
      
      blog: `
For a blog post, include:
- Introduction
- Main Content (with subsections)
- Examples and Code Snippets
- Conclusion
- References

Use a more casual, informative tone while maintaining technical accuracy.`
    };

    return basePrompt + (typeSpecificPrompts[projectType] || typeSpecificPrompts.research);
  }

  /**
   * Get user prompt with project context
   * @param {Object} context - Project context
   * @returns {string} User prompt
   */
  getUserPrompt(context) {
    return `Please generate a LaTeX document for the following project:

Project Name: ${context.projectName || 'Untitled Project'}
Description: ${context.description || 'No description provided'}
Project Type: ${context.projectType || 'research'}

File Analysis Summary:
${context.fileSummary || 'No file analysis available'}

Key Files Found:
${(context.keyFiles || []).map(f => `- ${f.name} (${f.language}, ${f.lines} lines)`).join('\n')}

References Found:
${(context.references || []).slice(0, 10).map(r => `- ${r.type}: ${r.value}`).join('\n')}

Content Sample:
${(context.content || '').substring(0, 2000)}...

Please generate a complete LaTeX document that:
1. Reflects the actual content and purpose of this project
2. Includes relevant technical details from the code analysis
3. Uses proper academic structure
4. Incorporates the found references appropriately
5. Is well-written and coherent

Generate the complete LaTeX document now.`;
  }

  /**
   * Generate bibliography from references
   * @param {Array} references - Array of reference objects
   * @returns {Promise<string>} Generated bibliography
   */
  async generateBibliography(references) {
    if (!references || references.length === 0) {
      return this.getDefaultBibliography();
    }

    try {
      const systemPrompt = `You are an expert at creating LaTeX bibliographies. Generate a proper bibliography section with the given references.`;
      
      const userPrompt = `Please create a LaTeX bibliography section for these references:

${references.map((ref, index) => `${index + 1}. ${ref.type}: ${ref.value} (from ${ref.source})`).join('\n')}

Generate a proper \\begin{thebibliography} section with appropriate formatting.`;

      const messages = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ];

      const response = await this.aiModelClient.chat(messages, {
        temperature: 0.3,
        max_tokens: 2000
      });

      // Handle the structured response from AIModelClient
      if (response.success && response.content) {
        return response.content;
      } else if (response.error) {
        console.error('❌ Bibliography generation API error:', response.error);
        return this.getDefaultBibliography();
      } else {
        // Fallback for direct content response
        return response.content || response;
      }
    } catch (error) {
      console.error('❌ Bibliography generation failed:', error);
      return this.getDefaultBibliography();
    }
  }

  /**
   * Get default bibliography template
   * @returns {string} Default bibliography
   */
  getDefaultBibliography() {
    return `\\begin{thebibliography}{99}
\\bibitem{ref1} Project Documentation and Code Analysis
\\bibitem{ref2} Technical Implementation Details
\\end{thebibliography}`;
  }

  /**
   * Combine LaTeX document parts
   * @param {string} content - Main content
   * @param {string} bibliography - Bibliography section
   * @param {Object} projectData - Project data
   * @returns {string} Complete LaTeX document
   */
  combineDocument(content, bibliography, projectData, templateData = null) {
    // If template is provided, use its preamble
    if (templateData && templateData.parsed) {
      const parsed = templateData.parsed;
      
      // Build preamble from template
      let preamble = templateData.parsed.preamble;
      
      // If template already has full content, use it directly (it should be in main.tex already)
      if (templateData.content) {
        // Template has been used to replace main.tex, so just return the generated content
        // The template structure should already be in place
        return content;
      }
      
      // Otherwise combine with template structure
      return `${preamble}

\\begin{document}

${content}

${bibliography}

\\end{document}`;
    }
    
    // Default behavior without template
    const documentClass = this.getDocumentClass(projectData.type);
    const packages = this.getRequiredPackages();
    
    return `\\documentclass{${documentClass}}

${packages}

\\title{${projectData.name || 'Untitled Project'}}
\\author{Generated by GenLaTeX}
\\date{\\today}

\\begin{document}

\\maketitle

${content}

${bibliography}

\\end{document}`;
  }

  /**
   * Get document class based on project type
   * @param {string} projectType - Project type
   * @returns {string} LaTeX document class
   */
  getDocumentClass(projectType) {
    const classes = {
      research: 'article',
      review: 'article', 
      project: 'report',
      blog: 'article'
    };
    
    return classes[projectType] || 'article';
  }

  /**
   * Get required LaTeX packages
   * @returns {string} Package declarations
   */
  getRequiredPackages() {
    return `\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath}
\\usepackage{amsfonts}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\usepackage{url}
\\usepackage{listings}
\\usepackage{xcolor}
\\usepackage{geometry}
\\geometry{top=0.5in, bottom=1in, left=1in, right=1in}`;
  }

  /**
   * Extract sections from LaTeX document
   * @param {string} latex - LaTeX content
   * @returns {Array} Array of sections
   */
  extractSections(latex) {
    if (!latex) return [];
    
    const sectionRegex = /\\(?:section|subsection|subsubsection)\*?\{([^}]+)\}/g;
    const sections = [];
    let match;
    
    while ((match = sectionRegex.exec(latex)) !== null) {
      sections.push(match[1]);
    }
    
    return sections;
  }

  /**
   * Estimate word count from LaTeX content
   * @param {string} latex - LaTeX content
   * @returns {number} Estimated word count
   */
  estimateWordCount(latex) {
    if (!latex) return 0;
    
    // Remove LaTeX commands and count words
    const text = latex
      .replace(/\\[a-zA-Z]+\{[^}]*\}/g, '') // Remove commands with braces
      .replace(/\\[a-zA-Z]+/g, '') // Remove other commands
      .replace(/[{}]/g, '') // Remove braces
      .replace(/\s+/g, ' ') // Normalize whitespace
      .trim();
    
    return text.split(' ').filter(word => word.length > 0).length;
  }

  /**
   * Get fallback template when generation fails
   * @param {Object} projectData - Project data
   * @returns {string} Fallback LaTeX template
   */
  getFallbackTemplate(projectData) {
    return `\\documentclass{article}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath}
\\usepackage{amsfonts}
\\usepackage{amssymb}
\\usepackage{graphicx}
\\usepackage{hyperref}
\\usepackage{url}
\\usepackage{geometry}
\\geometry{top=0.5in, bottom=1in, left=1in, right=1in}

\\title{${projectData.name || 'Untitled Project'}}
\\author{Generated by GenLaTeX}
\\date{\\today}

\\begin{document}

\\maketitle

\\begin{abstract}
${projectData.description || 'This document was generated from project files and content analysis.'}
\\end{abstract}

\\section{Introduction}
This document presents an analysis of the project: ${projectData.name || 'Untitled Project'}.

\\section{Project Overview}
${projectData.description || 'The project details and implementation are described below.'}

\\section{Conclusion}
This analysis provides insights into the project structure and implementation.

\\begin{thebibliography}{99}
\\bibitem{ref1} Project Documentation and Code Analysis
\\end{thebibliography}

\\end{document}`;
  }
}

export default LaTeXGenerator;
