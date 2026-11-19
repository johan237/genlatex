/**
 * LaTeX Section Parser
 * Detects and extracts LaTeX document sections with boundaries
 */

export class LaTeXSectionParser {
  /**
   * Detect all sections in a LaTeX document
   * @param {string} fileContent - Full LaTeX file content
   * @returns {Array} Array of section objects with boundaries
   */
  detectSections(fileContent) {
    const sections = [];
    const lines = fileContent.split('\n');
    let currentPos = 0;

    // Find preamble (everything before \begin{document})
    const beginDocMatch = fileContent.match(/\\begin\{document\}/);
    if (beginDocMatch) {
      const beginLine = fileContent.substring(0, beginDocMatch.index).split('\n').length - 1;
      sections.push({
        type: 'preamble',
        start: 0,
        end: beginDocMatch.index,
        content: fileContent.substring(0, beginDocMatch.index),
        beginLine: 0,
        endLine: beginLine
      });
      currentPos = beginDocMatch.index + beginDocMatch[0].length;
    }

    // Find abstract
    const abstractMatch = fileContent.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/);
    if (abstractMatch) {
      const startPos = fileContent.indexOf(abstractMatch[0]);
      const endPos = startPos + abstractMatch[0].length;
      const beginLine = fileContent.substring(0, startPos).split('\n').length - 1;
      const endLine = fileContent.substring(0, endPos).split('\n').length - 1;
      
      sections.push({
        type: 'abstract',
        name: 'Abstract',
        start: startPos,
        end: endPos,
        content: abstractMatch[0],
        innerContent: abstractMatch[1].trim(),
        beginLine: beginLine,
        endLine: endLine
      });
    }

    // Find all sections, subsections, and subsubsections
    const sectionPatterns = [
      { regex: /\\section\*?\{([^}]+)\}/g, type: 'section' },
      { regex: /\\subsection\*?\{([^}]+)\}/g, type: 'subsection' },
      { regex: /\\subsubsection\*?\{([^}]+)\}/g, type: 'subsubsection' }
    ];

    for (const pattern of sectionPatterns) {
      let match;
      while ((match = pattern.regex.exec(fileContent)) !== null) {
        const startPos = match.index;
        const sectionTitle = match[1];
        
        // Find the end of this section (next section of same or higher level, or end of document)
        let endPos = fileContent.length;
        
        // Look for next section marker
        const remainingContent = fileContent.substring(startPos + match[0].length);
        const nextSectionMatch = remainingContent.match(/\\(?:section|subsection|subsubsection|chapter)\*?\{/);
        if (nextSectionMatch) {
          endPos = startPos + match[0].length + nextSectionMatch.index;
        } else {
          // Look for \end{document}
          const endDocMatch = remainingContent.match(/\\end\{document\}/);
          if (endDocMatch) {
            endPos = startPos + match[0].length + endDocMatch.index;
          }
        }

        const beginLine = fileContent.substring(0, startPos).split('\n').length - 1;
        const endLine = fileContent.substring(0, endPos).split('\n').length - 1;

        sections.push({
          type: pattern.type,
          name: sectionTitle,
          start: startPos,
          end: endPos,
          content: fileContent.substring(startPos, endPos),
          beginLine: beginLine,
          endLine: endLine
        });
      }
    }

    // Find other common environments
    const environmentPatterns = [
      'introduction',
      'conclusion',
      'acknowledgments',
      'appendix',
      'references',
      'bibliography'
    ];

    for (const envName of environmentPatterns) {
      const envRegex = new RegExp(`\\\\begin\\{${envName}\\}([\\s\\S]*?)\\\\end\\{${envName}\\}`, 'gi');
      let match;
      while ((match = envRegex.exec(fileContent)) !== null) {
        const startPos = match.index;
        const endPos = startPos + match[0].length;
        const beginLine = fileContent.substring(0, startPos).split('\n').length - 1;
        const endLine = fileContent.substring(0, endPos).split('\n').length - 1;

        sections.push({
          type: envName,
          name: envName.charAt(0).toUpperCase() + envName.slice(1),
          start: startPos,
          end: endPos,
          content: match[0],
          innerContent: match[1].trim(),
          beginLine: beginLine,
          endLine: endLine
        });
      }
    }

    // Sort sections by start position
    sections.sort((a, b) => a.start - b.start);

    return sections;
  }

  /**
   * Find a specific section by name or type
   * @param {string} fileContent - Full LaTeX file content
   * @param {string} sectionIdentifier - Section name or type (e.g., 'abstract', 'introduction', 'Section 1')
   * @returns {Object|null} Section object or null if not found
   */
  findSection(fileContent, sectionIdentifier) {
    const sections = this.detectSections(fileContent);
    const lowerIdentifier = sectionIdentifier.toLowerCase().trim();

    // Try exact type match first
    let section = sections.find(s => s.type.toLowerCase() === lowerIdentifier);
    if (section) return section;

    // Try name match
    section = sections.find(s => s.name && s.name.toLowerCase().includes(lowerIdentifier));
    if (section) return section;

    // Try partial match on type
    section = sections.find(s => s.type.toLowerCase().includes(lowerIdentifier));
    if (section) return section;

    // Try finding by section number (e.g., "section 1", "section 2")
    const sectionNumberMatch = lowerIdentifier.match(/section\s*(\d+)/);
    if (sectionNumberMatch) {
      const sectionNum = parseInt(sectionNumberMatch[1]);
      const allSections = sections.filter(s => s.type === 'section');
      if (sectionNum > 0 && sectionNum <= allSections.length) {
        return allSections[sectionNum - 1];
      }
    }

    return null;
  }

  /**
   * Extract section boundaries for a specific environment type
   * @param {string} fileContent - Full LaTeX file content
   * @param {string} sectionType - Type like 'abstract', 'section', etc.
   * @returns {Object|null} Boundaries object or null
   */
  extractSectionBoundaries(fileContent, sectionType) {
    const section = this.findSection(fileContent, sectionType);
    if (!section) return null;

    return {
      start: section.start,
      end: section.end,
      beginLine: section.beginLine,
      endLine: section.endLine
    };
  }

  /**
   * Identify modification scope from user request
   * @param {string} userRequest - User's modification request
   * @param {string} fileContent - Full LaTeX file content
   * @returns {Object} Scope information
   */
  identifyModificationScope(userRequest, fileContent) {
    const lowerRequest = userRequest.toLowerCase();

    // Pattern matching for common modification requests
    const patterns = [
      { regex: /\b(?:increase|expand|extend|enlarge|lengthen|grow)\s+(?:the\s+)?abstract\b/i, section: 'abstract', scope: 'section' },
      { regex: /\b(?:modify|edit|change|update|fix)\s+(?:the\s+)?abstract\b/i, section: 'abstract', scope: 'section' },
      { regex: /\babstract\b/i, section: 'abstract', scope: 'section' },
      
      { regex: /\b(?:introduction|intro)\b/i, section: 'introduction', scope: 'section' },
      { regex: /\bconclusion\b/i, section: 'conclusion', scope: 'section' },
      { regex: /\backnowledgments?\b/i, section: 'acknowledgments', scope: 'section' },
      
      { regex: /\bsection\s+(\d+)\b/i, section: null, scope: 'section' }, // Will be filled by match
      { regex: /\b(?:first|1st)\s+section\b/i, section: 'section 1', scope: 'section' },
      { regex: /\b(?:second|2nd)\s+section\b/i, section: 'section 2', scope: 'section' },
      { regex: /\b(?:third|3rd)\s+section\b/i, section: 'section 3', scope: 'section' },
    ];

    for (const pattern of patterns) {
      const match = lowerRequest.match(pattern.regex);
      if (match) {
        let sectionName = pattern.section;
        
        // Handle section number matches
        if (pattern.regex.toString().includes('(\\d+)') && match[1]) {
          sectionName = `section ${match[1]}`;
        }

        const sectionInfo = this.findSection(fileContent, sectionName);
        
        if (sectionInfo) {
          return {
            scope: pattern.scope,
            sectionName: sectionName,
            start: sectionInfo.start,
            end: sectionInfo.end,
            sectionType: sectionInfo.type,
            confidence: 0.9
          };
        }
      }
    }

    // Default: full document modification
    return {
      scope: 'full',
      sectionName: null,
      start: 0,
      end: fileContent.length,
      confidence: 0.5
    };
  }

  /**
   * Get line number from byte position
   * @param {string} content - File content
   * @param {number} bytePosition - Byte position
   * @returns {number} Line number (0-indexed)
   */
  getLineNumber(content, bytePosition) {
    return content.substring(0, bytePosition).split('\n').length - 1;
  }

  /**
   * Get byte position from line number
   * @param {string} content - File content
   * @param {number} lineNumber - Line number (0-indexed)
   * @returns {number} Byte position
   */
  getBytePosition(content, lineNumber) {
    const lines = content.split('\n');
    let position = 0;
    for (let i = 0; i < lineNumber && i < lines.length; i++) {
      position += lines[i].length + 1; // +1 for newline
    }
    return position;
  }
}

