/**
 * Template Parser for LaTeX files
 * Extracts document structure, packages, and metadata from LaTeX templates
 * Intelligently cleans sample content while preserving structure
 */

export class TemplateParser {
  /**
   * Parse a LaTeX template and extract all relevant information
   * @param {string} texContent - The LaTeX content to parse
   * @returns {object} Parsed template information
   */
  parseTemplate(texContent) {
    if (!texContent || typeof texContent !== 'string') {
      return null;
    }

    return {
      documentClass: this.extractDocumentClass(texContent),
      packages: this.extractPackages(texContent),
      bibliographyStyle: this.extractBibliographyStyle(texContent),
      preamble: this.extractPreamble(texContent),
      structure: this.extractDocumentStructure(texContent),
      metadata: this.getTemplateMetadata(texContent)
    };
  }

  /**
   * Score a .tex file to determine if it's a good main template candidate
   * Higher score = better candidate
   * @param {string} content - LaTeX content
   * @param {string} fileName - Name of the file
   * @returns {number} Score (higher = better main template candidate)
   */
  scoreTemplateCandidate(content, fileName) {
    let score = 0;
    const lowerName = fileName.toLowerCase();
    const lowerContent = content.toLowerCase();
    
    // File name scoring
    if (lowerName === 'main.tex') score += 100;
    else if (lowerName.includes('template')) score += 50;
    else if (lowerName.includes('sample')) score += 30;
    else if (lowerName.includes('example')) score += 20;
    else if (lowerName.includes('bare')) score += 40; // IEEE bare templates
    
    // Penalize "how-to" and documentation files
    if (lowerName.includes('how-to') || lowerName.includes('howto')) score -= 200;
    if (lowerName.includes('readme') || lowerName.includes('instruction')) score -= 150;
    if (lowerName.includes('guide')) score -= 100;
    if (lowerName.includes('new_') && lowerName.includes('how')) score -= 200; // New_IEEEtran_how-to
    
    // Content scoring - must have document structure
    if (content.includes('\\documentclass')) score += 50;
    if (content.includes('\\begin{document}')) score += 50;
    if (content.includes('\\end{document}')) score += 25;
    
    // Penalize if it looks like documentation
    if (lowerContent.includes('this template') && lowerContent.includes('shows how')) score -= 100;
    if (lowerContent.includes('instructions for')) score -= 80;
    if (lowerContent.includes('this article illustrates')) score -= 80;
    if (lowerContent.includes('this document is intended')) score -= 100;
    
    // Prefer files with common academic structure elements
    if (content.includes('\\maketitle')) score += 20;
    if (content.includes('\\begin{abstract}')) score += 30;
    if (content.includes('\\section{')) score += 20;
    if (content.includes('\\bibliography') || content.includes('\\printbibliography')) score += 15;
    
    // Penalize extremely long files (likely documentation)
    const lineCount = content.split('\n').length;
    if (lineCount > 2000) score -= 50;
    if (lineCount > 5000) score -= 100;
    
    // Prefer moderately sized templates (100-500 lines typical for templates)
    if (lineCount >= 50 && lineCount <= 500) score += 30;
    
    return score;
  }

  /**
   * Clean sample/placeholder content from template while preserving structure
   * This is the MAIN cleaning function - thoroughly removes all sample content
   * @param {string} content - LaTeX content
   * @returns {string} Cleaned content with structure preserved
   */
  cleanTemplateContent(content) {
    if (!content || typeof content !== 'string') {
      return content;
    }

    // Split into preamble and document body
    const beginDocMatch = content.match(/\\begin\s*\{document\}/);
    if (!beginDocMatch) {
      return content; // No document body found, return as-is
    }

    const preambleEnd = beginDocMatch.index;
    let preamble = content.substring(0, preambleEnd + beginDocMatch[0].length);
    let body = content.substring(preambleEnd + beginDocMatch[0].length);

    // Clean preamble: remove sample metadata but keep structure
    preamble = this._cleanPreamble(preamble);

    // Clean body: remove sample content but keep section structure
    body = this._cleanBody(body);

    return preamble + body;
  }

  /**
   * Clean preamble - replace sample titles/authors with placeholders
   * Remove all sample-specific content, keep only structure definitions
   * @private
   */
  _cleanPreamble(preamble) {
    // Replace title with placeholder
    preamble = preamble.replace(
      /\\title\s*\{[^}]*\}/g, 
      '\\title{Your Paper Title Here}'
    );
    
    // Replace author with placeholder - handle multi-line author blocks
    preamble = preamble.replace(
      /\\author\s*\{[\s\S]*?\}(?=\s*(?:\\(?!author)|%|\n\n))/g,
      '\\author{Author Name}'
    );
    
    // Handle IEEE author blocks (single and multi-column)
    preamble = preamble.replace(
      /\\IEEEauthorblockN\s*\{[^}]*\}/g,
      '\\IEEEauthorblockN{Author Name}'
    );
    preamble = preamble.replace(
      /\\IEEEauthorblockA\s*\{[\s\S]*?\}/g,
      '\\IEEEauthorblockA{Affiliation\\\\Email}'
    );
    
    // Handle \and for multiple authors
    preamble = preamble.replace(/\\and[\s\S]*?(?=\\author|\\IEEEauthorblockN|\\begin\{document\})/g, '');
    
    // Replace date if present
    preamble = preamble.replace(
      /\\date\s*\{[^}]*\}/g,
      '\\date{\\today}'
    );
    
    // Remove thanks/footnotes with sample content
    preamble = preamble.replace(
      /\\thanks\s*\{[^}]*\}/g,
      ''
    );
    
    // Remove IEEEpeerreviewmaketitle if present (IEEE specific)
    // Keep it but it will be handled properly
    
    // Remove sample keywords
    preamble = preamble.replace(
      /\\IEEEkeywords\s*\{[^}]*\}/g,
      '\\IEEEkeywords{keyword1, keyword2, keyword3}'
    );
    
    // Clean up excessive blank lines
    preamble = preamble.replace(/\n{3,}/g, '\n\n');

    return preamble;
  }

  /**
   * Clean document body - remove ALL sample content, keep section structure
   * @private
   */
  _cleanBody(body) {
    // Find the end of document
    const endDocMatch = body.match(/\\end\s*\{document\}/);
    if (!endDocMatch) {
      return body;
    }

    const endDocIndex = body.indexOf(endDocMatch[0]);
    let mainBody = body.substring(0, endDocIndex);
    const endDoc = body.substring(endDocIndex);

    // Clean abstract - keep structure but remove sample text
    mainBody = mainBody.replace(
      /\\begin\{abstract\}[\s\S]*?\\end\{abstract\}/g,
      '\\begin{abstract}\n% Your abstract here\n\\end{abstract}'
    );
    
    // Clean IEEEkeywords
    mainBody = mainBody.replace(
      /\\begin\{IEEEkeywords\}[\s\S]*?\\end\{IEEEkeywords\}/g,
      '\\begin{IEEEkeywords}\nkeyword1, keyword2, keyword3\n\\end{IEEEkeywords}'
    );

    // Extract important structural commands before sections
    const preSection = this._extractPreSectionCommands(mainBody);
    
    // Extract section structure
    const sections = this._extractSectionStructure(mainBody);
    
    // Build clean body
    let cleanedBody = '\n' + preSection;
    
    // Add sections with placeholder content
    for (const section of sections) {
      cleanedBody += `\n${section.command}\n`;
      cleanedBody += `% ${section.type} content here\n\n`;
    }
    
    // Handle bibliography - extract the style/command
    const bibStyle = this._extractBibliographyCommand(mainBody);
    if (bibStyle) {
      cleanedBody += '\n' + bibStyle + '\n';
    }

    // Clean up excessive blank lines
    cleanedBody = cleanedBody.replace(/\n{3,}/g, '\n\n');

    return cleanedBody + '\n' + endDoc;
  }
  
  /**
   * Extract important commands that appear before sections (maketitle, etc.)
   * @private
   */
  _extractPreSectionCommands(body) {
    const commands = [];
    
    // Find content before first section
    const firstSectionMatch = body.match(/\\(?:section|chapter)\s*(?:\*)?(?:\[[^\]]*\])?\s*\{/);
    const preSection = firstSectionMatch ? body.substring(0, firstSectionMatch.index) : body;
    
    // Extract important commands
    if (preSection.includes('\\maketitle')) {
      commands.push('\\maketitle');
    }
    if (preSection.includes('\\IEEEpeerreviewmaketitle')) {
      commands.push('\\IEEEpeerreviewmaketitle');
    }
    if (preSection.includes('\\tableofcontents')) {
      commands.push('\\tableofcontents');
    }
    if (preSection.includes('\\listoffigures')) {
      commands.push('\\listoffigures');
    }
    if (preSection.includes('\\listoftables')) {
      commands.push('\\listoftables');
    }
    
    return commands.join('\n');
  }
  
  /**
   * Extract section structure from body
   * @private
   */
  _extractSectionStructure(body) {
    const sections = [];
    
    // Match all section-level commands with their titles
    const sectionRegex = /(\\(?:chapter|section|subsection|subsubsection)\s*(?:\*)?(?:\[[^\]]*\])?\s*\{[^}]*\})/g;
    let match;
    
    while ((match = sectionRegex.exec(body)) !== null) {
      const command = match[1];
      let type = 'Section';
      
      if (command.startsWith('\\chapter')) type = 'Chapter';
      else if (command.startsWith('\\subsubsection')) type = 'Subsubsection';
      else if (command.startsWith('\\subsection')) type = 'Subsection';
      else if (command.startsWith('\\section')) type = 'Section';
      
      sections.push({ command, type });
    }
    
    return sections;
  }
  
  /**
   * Extract bibliography command/style from body
   * @private
   */
  _extractBibliographyCommand(body) {
    // Check for bibliographystyle + bibliography
    const styleMatch = body.match(/\\bibliographystyle\s*\{([^}]*)\}/);
    const bibMatch = body.match(/\\bibliography\s*\{([^}]*)\}/);
    
    if (styleMatch && bibMatch) {
      return `\\bibliographystyle{${styleMatch[1]}}\n\\bibliography{references}`;
    }
    
    // Check for printbibliography (biblatex)
    if (body.includes('\\printbibliography')) {
      const printMatch = body.match(/\\printbibliography(?:\[[^\]]*\])?/);
      return printMatch ? printMatch[0] : '\\printbibliography';
    }
    
    // Check for thebibliography environment
    if (body.includes('\\begin{thebibliography}')) {
      return '\\begin{thebibliography}{99}\n% Add your references here\n\\end{thebibliography}';
    }
    
    // Default to standard bibliography
    return '\\bibliographystyle{IEEEtran}\n\\bibliography{references}';
  }

  /**
   * Check if a file is likely a "how-to" or documentation file (not a usable template)
   * @param {string} content - LaTeX content
   * @param {string} fileName - Name of the file
   * @returns {boolean} True if file appears to be documentation
   */
  isDocumentationFile(content, fileName) {
    const lowerName = fileName.toLowerCase();
    const lowerContent = content.toLowerCase();
    
    // Check file name
    if (lowerName.includes('how-to') || lowerName.includes('howto')) return true;
    if (lowerName.includes('readme') || lowerName.includes('instruction')) return true;
    if (lowerName.includes('guide') || lowerName.includes('manual')) return true;
    if (lowerName.startsWith('new_') && lowerName.includes('how')) return true;
    
    // Check content patterns that indicate documentation
    const docPatterns = [
      'this template shows',
      'how to use this',
      'instructions for authors',
      'user guide',
      'getting started',
      'this document describes',
      'this article illustrates',
      'this document is intended',
      'please refer to',
      'for more information',
      'the following sections describe'
    ];
    
    for (const pattern of docPatterns) {
      if (lowerContent.includes(pattern)) return true;
    }
    
    return false;
  }
  
  /**
   * Check if a file should be excluded from template (documentation, samples with too much content)
   * @param {string} fileName - Name of the file
   * @returns {boolean} True if file should be excluded
   */
  shouldExcludeFile(fileName) {
    const lowerName = fileName.toLowerCase();
    
    // Exclude documentation files
    if (lowerName.includes('how-to') || lowerName.includes('howto')) return true;
    if (lowerName.includes('readme')) return true;
    if (lowerName.includes('instruction')) return true;
    if (lowerName.includes('guide')) return true;
    if (lowerName.startsWith('new_') && lowerName.includes('how')) return true;
    
    // Exclude PDF files (they're not usable as templates)
    if (lowerName.endsWith('.pdf')) return true;
    
    // Exclude backup files
    if (lowerName.endsWith('.bak') || lowerName.endsWith('~')) return true;
    
    return false;
  }
  
  /**
   * Clean a .bib file - remove sample entries, keep structure
   * @param {string} content - BibTeX content
   * @returns {string} Cleaned content
   */
  cleanBibFile(content) {
    if (!content || typeof content !== 'string') {
      return content;
    }
    
    // Return a clean template bib file
    return `% References
% Add your BibTeX entries here

@article{example,
  author = {Author, A.},
  title = {Example Article Title},
  journal = {Journal Name},
  year = {2024},
  volume = {1},
  pages = {1--10}
}
`;
  }

  /**
   * Extract document class and options
   * @param {string} content - LaTeX content
   * @returns {object} Document class information
   */
  extractDocumentClass(content) {
    const classRegex = /\\documentclass\s*(?:\[(.*?)\])?\s*\{(.*?)\}/;
    const match = content.match(classRegex);
    
    if (match) {
      return {
        name: match[2].trim(),
        options: match[1] ? match[1].split(',').map(opt => opt.trim()) : []
      };
    }
    
    return null;
  }

  /**
   * Extract all packages with their options
   * @param {string} content - LaTeX content
   * @returns {array} Array of package objects
   */
  extractPackages(content) {
    const packageRegex = /\\usepackage\s*(?:\[(.*?)\])?\s*\{(.*?)\}/g;
    const packages = [];
    let match;

    while ((match = packageRegex.exec(content)) !== null) {
      const packageNames = match[2].split(',').map(p => p.trim());
      const options = match[1] ? match[1].split(',').map(opt => opt.trim()) : [];

      packageNames.forEach(name => {
        packages.push({
          name: name,
          options: options
        });
      });
    }

    return packages;
  }

  /**
   * Detect bibliography style and type
   * @param {string} content - LaTeX content
   * @returns {object} Bibliography style information
   */
  extractBibliographyStyle(content) {
    // Check for biblatex
    const biblatexMatch = content.match(/\\usepackage\s*(?:\[(.*?)\])?\s*\{biblatex\}/);
    if (biblatexMatch) {
      const options = biblatexMatch[1] ? biblatexMatch[1].split(',').map(opt => opt.trim()) : [];
      const styleOption = options.find(opt => opt.startsWith('style='));
      const style = styleOption ? styleOption.split('=')[1] : 'numeric';
      
      return {
        type: 'biblatex',
        style: style,
        options: options
      };
    }

    // Check for natbib
    const natbibMatch = content.match(/\\usepackage\s*(?:\[(.*?)\])?\s*\{natbib\}/);
    if (natbibMatch) {
      const options = natbibMatch[1] ? natbibMatch[1].split(',').map(opt => opt.trim()) : [];
      
      return {
        type: 'natbib',
        style: options.includes('numbers') ? 'numbers' : 'authoryear',
        options: options
      };
    }

    // Check for \bibliographystyle command
    const bibStyleMatch = content.match(/\\bibliographystyle\s*\{(.*?)\}/);
    if (bibStyleMatch) {
      return {
        type: 'bibtex',
        style: bibStyleMatch[1].trim(),
        options: []
      };
    }

    // Check for thebibliography environment
    if (content.includes('\\begin{thebibliography}')) {
      return {
        type: 'thebibliography',
        style: 'manual',
        options: []
      };
    }

    return {
      type: 'none',
      style: 'none',
      options: []
    };
  }

  /**
   * Extract preamble (everything before \begin{document})
   * @param {string} content - LaTeX content
   * @returns {string} Preamble content
   */
  extractPreamble(content) {
    const beginDocMatch = content.match(/\\begin\s*\{document\}/);
    if (beginDocMatch) {
      return content.substring(0, beginDocMatch.index).trim();
    }
    return content.trim();
  }

  /**
   * Extract document structure (sections, chapters, etc.)
   * @param {string} content - LaTeX content
   * @returns {array} Array of structure elements
   */
  extractDocumentStructure(content) {
    const structure = [];
    
    // Extract chapters
    const chapterRegex = /\\chapter\s*(?:\[(.*?)\])?\s*\{(.*?)\}/g;
    let match;
    while ((match = chapterRegex.exec(content)) !== null) {
      structure.push({
        type: 'chapter',
        title: match[2].trim(),
        shortTitle: match[1] ? match[1].trim() : null,
        level: 0
      });
    }

    // Extract sections
    const sectionRegex = /\\section\s*(?:\[(.*?)\])?\s*\{(.*?)\}/g;
    while ((match = sectionRegex.exec(content)) !== null) {
      structure.push({
        type: 'section',
        title: match[2].trim(),
        shortTitle: match[1] ? match[1].trim() : null,
        level: 1
      });
    }

    // Extract subsections
    const subsectionRegex = /\\subsection\s*(?:\[(.*?)\])?\s*\{(.*?)\}/g;
    while ((match = subsectionRegex.exec(content)) !== null) {
      structure.push({
        type: 'subsection',
        title: match[2].trim(),
        shortTitle: match[1] ? match[1].trim() : null,
        level: 2
      });
    }

    // Extract subsubsections
    const subsubsectionRegex = /\\subsubsection\s*(?:\[(.*?)\])?\s*\{(.*?)\}/g;
    while ((match = subsubsectionRegex.exec(content)) !== null) {
      structure.push({
        type: 'subsubsection',
        title: match[2].trim(),
        shortTitle: match[1] ? match[1].trim() : null,
        level: 3
      });
    }

    return structure;
  }

  /**
   * Extract template metadata
   * @param {string} content - LaTeX content
   * @returns {object} Template metadata
   */
  getTemplateMetadata(content) {
    return {
      hasTitle: content.includes('\\title{') || content.includes('\\maketitle'),
      hasAuthor: content.includes('\\author{'),
      hasDate: content.includes('\\date{'),
      hasAbstract: content.includes('\\begin{abstract}'),
      hasTableOfContents: content.includes('\\tableofcontents'),
      hasListOfFigures: content.includes('\\listoffigures'),
      hasListOfTables: content.includes('\\listoftables'),
      hasBibliography: content.includes('\\bibliography{') || 
                      content.includes('\\printbibliography') ||
                      content.includes('\\begin{thebibliography}'),
      hasAppendix: content.includes('\\appendix') || content.includes('\\begin{appendix}'),
      documentLength: content.length,
      lineCount: content.split('\n').length
    };
  }

  /**
   * Remove placeholder content while keeping structure
   * @param {string} content - LaTeX content
   * @returns {string} Content with placeholders removed
   */
  removeContent(content) {
    // This is a helper method for future use
    // It removes content between sections but keeps the structure
    return content
      .replace(/\\begin\{document\}[\s\S]*?\\section/g, '\\begin{document}\n\n\\section')
      .replace(/\\section\{[^}]+\}[\s\S]*?(?=\\section|\\end\{document\})/g, (match) => {
        return match.split('\n')[0] + '\n\n';
      });
  }
}

