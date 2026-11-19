// SPDX-License-Identifier: MIT

/**
 * Parse .bib file and detect syntax errors
 * @param {string} bibContent - Content of .bib file
 * @param {string} bibFilePath - Path to .bib file (for error reporting)
 * @returns {Array} Array of error objects in unified format
 */
export function parseBibFileErrors(bibContent, bibFilePath = null) {
  if (!bibContent) return [];

  const errors = [];
  const lines = bibContent.split('\n');
  
  let currentEntry = null;
  let entryStartLine = null;
  let braceDepth = 0;
  let inString = false;
  let stringChar = null;
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNumber = i + 1;
    const trimmedLine = line.trim();
    
    // Skip empty lines and comments
    if (!trimmedLine || trimmedLine.startsWith('%')) {
      continue;
    }
    
    // Track string state (handles both " and {})
    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      const prevChar = j > 0 ? line[j - 1] : '';
      
      // Handle escaped characters
      if (prevChar === '\\') {
        continue;
      }
      
      // Track string boundaries
      if (char === '"' && !inString) {
        inString = true;
        stringChar = '"';
      } else if (char === '"' && inString && stringChar === '"') {
        inString = false;
        stringChar = null;
      }
      
      // Track braces (only when not in string)
      if (!inString) {
        if (char === '{') {
          braceDepth++;
        } else if (char === '}') {
          braceDepth--;
          
          // If brace depth goes negative, we have an extra closing brace
          if (braceDepth < 0) {
            errors.push({
              type: 'error',
              severity: 'error',
              engine: 'bibtex-error-detector',
              message: 'Extra closing brace }',
              rawMessage: line,
              line: lineNumber,
              file: bibFilePath,
              category: 'syntax',
              text: '}',
              column: j + 1,
              endColumn: j + 2,
              context: lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 2))
            });
            braceDepth = 0; // Reset to prevent cascading errors
          }
        }
      }
    }
    
    // Detect entry start: @entryType{key,
    const entryMatch = trimmedLine.match(/^@(\w+)\s*\{([^,}]+)/);
    if (entryMatch) {
      const entryType = entryMatch[1].toLowerCase();
      const entryKey = entryMatch[2].trim();
      
      // Validate entry type
      const validEntryTypes = ['article', 'book', 'booklet', 'conference', 'inbook', 
                               'incollection', 'inproceedings', 'manual', 'mastersthesis',
                               'misc', 'phdthesis', 'proceedings', 'techreport', 'unpublished',
                               'string', 'preamble', 'comment'];
      
      if (!validEntryTypes.includes(entryType)) {
        errors.push({
          type: 'error',
          severity: 'error',
          engine: 'bibtex-error-detector',
          message: `Invalid entry type: @${entryType}`,
          rawMessage: line,
          line: lineNumber,
          file: bibFilePath,
          category: 'syntax',
          text: `@${entryType}`,
          column: line.indexOf('@') + 1,
          endColumn: line.indexOf('@') + entryType.length + 2,
          context: lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 2))
        });
      }
      
      currentEntry = {
        type: entryType,
        key: entryKey,
        startLine: lineNumber,
        fields: [],
        hasComma: trimmedLine.includes(',')
      };
      entryStartLine = lineNumber;
    }
    
    // Detect field: fieldName = {value} or fieldName = "value"
    if (currentEntry && trimmedLine.includes('=')) {
      const fieldMatch = trimmedLine.match(/^\s*(\w+)\s*=\s*(.+)/);
      if (fieldMatch) {
        const fieldName = fieldMatch[1].toLowerCase();
        const fieldValue = fieldMatch[2].trim();
        
        // Check for missing comma before field (except first field)
        if (currentEntry.fields.length > 0 && i > 0) {
          const prevLine = lines[i - 1].trim();
          if (prevLine && !prevLine.endsWith(',') && !prevLine.endsWith('{') && prevLine !== '') {
            errors.push({
              type: 'error',
              severity: 'error',
              engine: 'bibtex-error-detector',
              message: `Missing comma before field "${fieldName}"`,
              rawMessage: line,
              line: lineNumber,
              file: bibFilePath,
              category: 'syntax',
              text: fieldName,
              column: line.indexOf(fieldName) + 1,
              endColumn: line.indexOf(fieldName) + fieldName.length + 1,
              context: lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 2))
            });
          }
        }
        
        currentEntry.fields.push({
          name: fieldName,
          value: fieldValue,
          line: lineNumber
        });
        
        // Check for unclosed field value
        if (fieldValue.startsWith('{') && !fieldValue.includes('}')) {
          // Multi-line field value - check if it's properly closed later
          // This will be caught by brace depth check
        }
      }
    }
    
    // Detect entry end: }
    if (trimmedLine === '}' && currentEntry) {
      // Check required fields based on entry type
      const requiredFields = getRequiredFields(currentEntry.type);
      const fieldNames = currentEntry.fields.map(f => f.name);
      const missingFields = requiredFields.filter(f => !fieldNames.includes(f));
      
      if (missingFields.length > 0) {
        errors.push({
          type: 'warning',
          severity: 'warning',
          engine: 'bibtex-error-detector',
          message: `Missing required field(s) for @${currentEntry.type}: ${missingFields.join(', ')}`,
          rawMessage: line,
          line: lineNumber,
          file: bibFilePath,
          category: 'citation',
          text: null,
          column: null,
          endColumn: null,
          context: lines.slice(Math.max(entryStartLine - 1, 0), Math.min(lines.length, i + 2))
        });
      }
      
      currentEntry = null;
      entryStartLine = null;
    }
  }
  
  // Check for unclosed entries
  if (currentEntry) {
    errors.push({
      type: 'error',
      severity: 'error',
      engine: 'bibtex-error-detector',
      message: `Unclosed entry @${currentEntry.type}{${currentEntry.key}`,
      rawMessage: lines[entryStartLine - 1] || '',
      line: entryStartLine,
      file: bibFilePath,
      category: 'syntax',
      text: `@${currentEntry.type}`,
      column: null,
      endColumn: null,
      context: lines.slice(Math.max(0, entryStartLine - 2), Math.min(lines.length, entryStartLine + 5))
    });
  }
  
  // Check for unmatched braces
  if (braceDepth > 0) {
    errors.push({
      type: 'error',
      severity: 'error',
      engine: 'bibtex-error-detector',
      message: `Missing ${braceDepth} closing brace(s)`,
      rawMessage: lines[lines.length - 1] || '',
      line: lines.length,
      file: bibFilePath,
      category: 'syntax',
      text: null,
      column: null,
      endColumn: null,
      context: lines.slice(Math.max(0, lines.length - 3))
    });
  }
  
  return errors;
}

/**
 * Get required fields for a BibTeX entry type
 * @param {string} entryType - Entry type (e.g., 'article', 'book')
 * @returns {Array<string>} Array of required field names
 */
function getRequiredFields(entryType) {
  const requirements = {
    'article': ['author', 'title', 'journal', 'year'],
    'book': ['author', 'title', 'publisher', 'year'],
    'booklet': ['title'],
    'conference': ['author', 'title', 'booktitle', 'year'],
    'inbook': ['author', 'title', 'chapter', 'publisher', 'year'],
    'incollection': ['author', 'title', 'booktitle', 'publisher', 'year'],
    'inproceedings': ['author', 'title', 'booktitle', 'year'],
    'manual': ['title'],
    'mastersthesis': ['author', 'title', 'school', 'year'],
    'misc': [],
    'phdthesis': ['author', 'title', 'school', 'year'],
    'proceedings': ['title', 'year'],
    'techreport': ['author', 'title', 'institution', 'year'],
    'unpublished': ['author', 'title', 'note']
  };
  
  return requirements[entryType.toLowerCase()] || [];
}
