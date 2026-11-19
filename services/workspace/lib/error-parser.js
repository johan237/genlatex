// SPDX-License-Identifier: MIT

import { packageManager } from './package-manager.js';

/**
 * Extract missing packages from compilation log
 * @param {string} logText - LaTeX compilation log (pdflatex)
 * @returns {Array<string>} Array of missing package names
 */
export function extractMissingPackages(logText) {
  return packageManager.detectMissingPackages(logText);
}

/**
 * Extract file path from log line with improved handling
 * Handles absolute paths, paths with spaces, subdirectories, and various formats
 * @param {string} line - Log line to parse
 * @returns {string|null} Extracted file path or null
 */
function extractFilePath(line) {
  // Pattern 1: (./path/to/file.tex) or (path/to/file.tex)
  let match = line.match(/\((?:\.\/)?([^)]+\.(?:tex|sty|cls|bib))/);
  if (match) {
    return match[1];
  }
  
  // Pattern 2: Absolute paths like (C:/path/to/file.tex) or (/path/to/file.tex)
  match = line.match(/\(([A-Z]:[^)]+\.(?:tex|sty|cls|bib))\)/i);
  if (match) {
    return match[1];
  }
  
  // Pattern 3: Paths with spaces: (./path with spaces/file.tex)
  match = line.match(/\((?:\.\/)?([^)]+\.(?:tex|sty|cls|bib))/);
  if (match) {
    return match[1];
  }
  
  // Pattern 4: File name without parentheses
  match = line.match(/([a-zA-Z0-9_\-\.\/\\]+\.(?:tex|sty|cls|bib))/);
  if (match && !match[1].includes(' ')) {
    return match[1];
  }
  
  return null;
}

/**
 * Track file stack for includes (\input, \include commands)
 * @param {string[]} lines - All log lines
 * @param {number} currentIndex - Current line index
 * @returns {string|null} Current file name from stack
 */
function getCurrentFileFromStack(lines, currentIndex) {
  // Look backwards for file markers
  for (let j = Math.max(0, currentIndex - 10); j < currentIndex; j++) {
    const filePath = extractFilePath(lines[j]);
    if (filePath) {
      return filePath;
    }
  }
  return null;
}

/**
 * Extract context lines around error
 * @param {string[]} lines - All log lines
 * @param {number} errorIndex - Index of error line
 * @param {number} contextSize - Number of context lines (default: 7)
 * @returns {string[]} Context lines
 */
function extractErrorContext(lines, errorIndex, contextSize = 7) {
  const start = Math.max(0, errorIndex - Math.floor(contextSize / 2));
  const end = Math.min(lines.length, errorIndex + Math.ceil(contextSize / 2) + 1);
  return lines.slice(start, end);
}

/**
 * Normalize problematic text from the log so it's more likely to match the source line.
 * - Trims whitespace
 * - Strips one surrounding double or single quote (LaTeX often wraps the bad part in quotes)
 * @param {string} raw - Raw text from "l.123 <text>" line
 * @returns {string} Normalized text for matching in editor
 */
function normalizeProblematicText(raw) {
  if (!raw || typeof raw !== 'string') return raw || '';
  let s = raw.trim();
  // Strip one surrounding quote pair so "snippet" or 'snippet' becomes snippet
  if ((s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
      (s.startsWith("'") && s.endsWith("'") && s.length >= 2)) {
    s = s.slice(1, -1).trim();
  }
  return s;
}

/**
 * Parse LaTeX compilation logs to extract error information
 * Works with pdflatex and other LaTeX compilers.
 * Follows standard LaTeX error format:
 * ! Error message
 * l.123 <problematic text>
 */
export function parsePdfLaTeXErrors(logText) {
  if (!logText) return [];

  const errors = [];
  const lines = logText.split('\n');
  const fileStack = []; // Track file includes
  let currentFile = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let lineNumber = null;
    let fileName = null;

    const detectedFile = extractFilePath(line);
    if (detectedFile) {
      currentFile = detectedFile;
    }

    // Track file includes (\input, \include)
    if (/\\input\{|\\include\{/.test(line)) {
      const fileMatch = line.match(/\\(?:input|include)\{([^}]+)\}/);
      if (fileMatch) {
        fileStack.push(fileMatch[1] + (fileMatch[1].endsWith('.tex') ? '' : '.tex'));
      }
    }

    // Match LaTeX error pattern: "! Error message"
    if (line.startsWith('!')) {
      const errorMessage = line.replace(/^!\s*/, '').trim();
      let problematicText = null;
      let contextLines = [];

      // Look for line number indicator in next few lines (increased from 5 to 7)
      for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
        const nextLine = lines[j];
        
        // Match "l.123" pattern with optional problematic text
        const lineMatch = nextLine.match(/^l\.(\d+)(?:\s+(.+))?/);
        if (lineMatch) {
          lineNumber = parseInt(lineMatch[1]);
          if (lineMatch[2]) {
            problematicText = normalizeProblematicText(lineMatch[2]);
          }
          // Extract more context around the error
          contextLines = extractErrorContext(lines, i, 7);
          break;
        }
      }

      // Try to extract file name with improved extraction
      // First check file stack (for includes)
      if (fileStack.length > 0) {
        fileName = fileStack[fileStack.length - 1];
      } else {
        // Look in previous lines with wider search (increased from 3 to 5)
        for (let j = Math.max(0, i - 5); j < i; j++) {
          const prevLine = lines[j];
          const extractedPath = extractFilePath(prevLine);
          if (extractedPath) {
            fileName = extractedPath;
            break;
          }
        }
      }
      
      // Fallback: get current file from stack
      if (!fileName) {
        fileName = getCurrentFileFromStack(lines, i);
      }
      if (!fileName && currentFile) {
        fileName = currentFile;
      }

      errors.push({
        type: 'error',
        engine: 'pdflatex',
        message: errorMessage,
        rawMessage: line,
        line: lineNumber,
        file: fileName,
        severity: 'error',
        text: problematicText || null,
        column: problematicText ? 1 : null,
        startColumn: problematicText ? 1 : null,
        endColumn: problematicText ? (problematicText.length + 1) : null,
        context: contextLines
      });
    }
    
    // Match "LaTeX Error:" patterns (case insensitive, with or without !)
    else if (/^!?\s*LaTeX\s+Error:/i.test(line)) {
      const errorMessage = line.replace(/^!?\s*LaTeX\s+Error:\s*/i, '').trim();
      let problematicText = null;
      let contextLines = [];

      // Look for line number in next few lines (increased from 5 to 7)
      for (let j = i + 1; j < Math.min(i + 7, lines.length); j++) {
        const nextLine = lines[j];
        const lineMatch = nextLine.match(/^l\.(\d+)(?:\s+(.+))?/);
        if (lineMatch) {
          lineNumber = parseInt(lineMatch[1]);
          if (lineMatch[2]) {
            problematicText = normalizeProblematicText(lineMatch[2]);
          }
          contextLines = extractErrorContext(lines, i, 7);
          break;
        }
      }

      // Try to extract file name with improved extraction
      if (fileStack.length > 0) {
        fileName = fileStack[fileStack.length - 1];
      } else {
        for (let j = Math.max(0, i - 5); j < i; j++) {
          const prevLine = lines[j];
          const extractedPath = extractFilePath(prevLine);
          if (extractedPath) {
            fileName = extractedPath;
            break;
          }
        }
      }
      
      if (!fileName) {
        fileName = getCurrentFileFromStack(lines, i);
      }
      if (!fileName && currentFile) {
        fileName = currentFile;
      }

      errors.push({
        type: 'error',
        engine: 'pdflatex',
        message: 'LaTeX Error: ' + errorMessage,
        rawMessage: line,
        line: lineNumber,
        file: fileName,
        severity: 'error',
        text: problematicText || null,
        column: problematicText ? 1 : null,
        startColumn: problematicText ? 1 : null,
        endColumn: problematicText ? (problematicText.length + 1) : null,
        context: contextLines
      });
    }
    
    // Match citation scanning errors (critical)
    else if (/file ended while scanning use of \\citation/i.test(line)) {
      const errorMessage = line.trim();
      const contextLines = extractErrorContext(lines, i, 7);
      
      // Try to extract line number from context (increased search range)
      for (let j = Math.max(0, i - 7); j < Math.min(i + 7, lines.length); j++) {
        const contextLine = lines[j];
        if (!lineNumber) {
          const lineMatch = contextLine.match(/^l\.(\d+)/);
          if (lineMatch) {
            lineNumber = parseInt(lineMatch[1]);
          }
        }
        if (!fileName) {
          const extractedPath = extractFilePath(contextLine);
          if (extractedPath) {
            fileName = extractedPath;
          }
        }
      }
      
      if (!fileName && fileStack.length > 0) {
        fileName = fileStack[fileStack.length - 1];
      }
      if (!fileName && currentFile) {
        fileName = currentFile;
      }
      
      errors.push({
        type: 'error',
        engine: 'pdflatex',
        message: 'File ended while scanning use of \\citation',
        rawMessage: errorMessage,
        line: lineNumber,
        file: fileName,
        severity: 'error',
        text: null,
        column: null,
        startColumn: null,
        endColumn: null,
        context: contextLines
      });
    }
    
    // Match "Fatal error" and "Emergency stop"
    else if (/Fatal\s+error/i.test(line) || /Emergency\s+stop/i.test(line)) {
      const errorMessage = line.trim();
      const contextLines = extractErrorContext(lines, i, 7);
      
      // Try to extract file and line from surrounding context (increased range)
      for (let j = Math.max(0, i - 7); j < Math.min(i + 7, lines.length); j++) {
        const contextLine = lines[j];
        
        // Look for line numbers
        if (!lineNumber) {
          const lineMatch = contextLine.match(/^l\.(\d+)/);
          if (lineMatch) {
            lineNumber = parseInt(lineMatch[1]);
          }
        }
        
        // Look for file names with improved extraction
        if (!fileName) {
          const extractedPath = extractFilePath(contextLine);
          if (extractedPath) {
            fileName = extractedPath;
          }
        }
      }
      
      if (!fileName && fileStack.length > 0) {
        fileName = fileStack[fileStack.length - 1];
      }
      if (!fileName && currentFile) {
        fileName = currentFile;
      }
      
      errors.push({
        type: 'error',
        engine: 'pdflatex',
        message: errorMessage,
        rawMessage: line,
        line: lineNumber,
        file: fileName,
        severity: 'error',
        text: null,
        column: null,
        startColumn: null,
        endColumn: null,
        context: contextLines
      });
    }
    
    // Match "error: program not found" (biber/external tool errors)
    else if (/^error:\s+program not found/i.test(line)) {
      // This is a system error, not a LaTeX error - usually means biber is missing
      // We should treat this as ignorable since we have a workaround
      errors.push({
        type: 'warning',
        engine: 'system',
        message: 'External tool (biber) not found - using fallback bibliography support',
        rawMessage: line,
        line: null,
        file: null,
        severity: 'warning',
        isIgnorable: true, // Mark as ignorable since we have a workaround
        text: null,
        column: null,
        startColumn: null,
        endColumn: null,
        context: []
      });
    }

    // Match warning patterns
    else if (line.includes('Warning:') || line.includes('warning:')) {
      const warningMessage = line.trim();

      // Look for line number in the warning message
      const lineMatch = warningMessage.match(/line[s]?\s+(\d+)(?:--(\d+))?/i);
      if (lineMatch) {
        lineNumber = parseInt(lineMatch[1]);
      }

      // Classify warning severity
      let severity = 'warning';
      let isIgnorable = false;
      
      // Overfull/Underfull hbox/vbox warnings are cosmetic - not critical
      if (/(?:Overfull|Underfull)\s+\\[hv]box/i.test(warningMessage)) {
        severity = 'info';
        isIgnorable = true;
      }
      
      // Citation warnings are important but not critical
      if (/citation.*undefined/i.test(warningMessage) || /reference.*undefined/i.test(warningMessage)) {
        severity = 'warning';
      }
      
      // Citation scanning errors are critical
      if (/file ended while scanning use of \\citation/i.test(warningMessage)) {
        severity = 'error';
        isIgnorable = false;
      }

      errors.push({
        type: 'warning',
        engine: 'pdflatex',
        message: warningMessage,
        rawMessage: line,
        line: lineNumber,
        file: null,
        severity: severity,
        isIgnorable: isIgnorable,
        text: null,
        column: null,
        startColumn: null,
        endColumn: null,
        context: extractErrorContext(lines, i, 5)
      });
    }

    // Detect missing package errors (can appear in any line)
    const missingPackagePatterns = [
      /File\s+[`'"]?([a-zA-Z0-9_-]+)\.sty['"]?\s+not\s+found/i,
      /Package\s+([a-zA-Z0-9_-]+)\s+not\s+found/i,
      /LaTeX\s+Error:\s*File\s+[`'"]?([a-zA-Z0-9_-]+)\.(?:sty|cls)['"]?\s+not\s+found/i,
      /!\s+LaTeX\s+Error:\s*File\s+[`'"]?([a-zA-Z0-9_-]+)\.(?:sty|cls)['"]?\s+not\s+found/i,
      /Missing\s+file:\s+([a-zA-Z0-9_-]+)\.(?:sty|cls)/i,
      /I\s+can't\s+find\s+file\s+[`'"]?([a-zA-Z0-9_-]+)\.(?:sty|cls)['"]?/i,
      /cannot\s+find\s+[`'"]?([a-zA-Z0-9_-]+)\.(?:sty|cls)['"]?/i,
      /unable\s+to\s+load\s+package\s+[`'"]?([a-zA-Z0-9_-]+)['"]?/i,
      /package\s+[`'"]?([a-zA-Z0-9_-]+)['"]?\s+is\s+not\s+installed/i,
      /([a-zA-Z0-9_-]+)\.sty\s+not\s+loadable/i
    ];

    for (const pattern of missingPackagePatterns) {
      const match = line.match(pattern);
      if (match && match[1]) {
        const packageName = match[1].trim();
        // Skip false positives
        if (packageName && 
            packageName !== 'inputenc' && 
            packageName !== 'fontenc' &&
            packageName.length > 1 &&
            !errors.some(e => e.missingPackage === packageName)) {
          
          // Try to extract line number from context if not already set
          if (lineNumber === null) {
            const lineMatch = line.match(/line\s+(\d+)/i);
            if (lineMatch) {
              lineNumber = parseInt(lineMatch[1]);
            }
          }
          
          errors.push({
            type: 'error',
            engine: 'pdflatex',
            message: `Missing package: ${packageName}`,
            rawMessage: line,
            line: lineNumber,
            file: fileName,
            severity: 'error',
            text: null,
            column: null,
            startColumn: null,
            endColumn: null,
            missingPackage: packageName,
            isMissingPackage: true,
            context: extractErrorContext(lines, i, 5)
          });
        }
      }
    }
  }

  // Remove duplicates with improved deduplication
  return deduplicateErrors(errors);
}

/**
 * Parse BibTeX compilation logs (.blg files) to extract error information
 * @param {string} blgContent - Content of the .blg file
 * @param {string} auxContent - Content of the .aux file (for line number mapping)
 * @param {string} projectDir - Project directory for file path normalization
 * @returns {Array} Array of error objects
 */
export function parseBibTeXErrors(blgContent, auxContent = '', projectDir = '') {
  if (!blgContent) return [];

  const errors = [];
  const lines = blgContent.split('\n');
  
  // Enhanced citation-to-line mapping from .aux file
  const citationLineMap = new Map(); // citation key -> line number
  const citationFileMap = new Map(); // citation key -> source file
  const citationContextMap = new Map(); // citation key -> context info
  
  if (auxContent) {
    const auxLines = auxContent.split('\n');
    let currentFile = null;
    const fileStack = []; // Track nested file includes
    
    auxLines.forEach((line, index) => {
      // Track file changes in .aux (handles nested includes)
      const fileMatch = line.match(/\\@input\{([^}]+)\}/);
      if (fileMatch) {
        const auxFile = fileMatch[1];
        const texFile = auxFile.replace(/\.aux$/, '.tex');
        fileStack.push(currentFile); // Save previous file
        currentFile = texFile;
      }
      
      // Track file end (pop from stack)
      if (/^\\relax\s*$/.test(line) && fileStack.length > 0) {
        currentFile = fileStack.pop();
      }
      
      // Map citation keys to line numbers and files
      // Handle citation ranges: \citation{key1,key2,key3}
      const citationMatch = line.match(/\\citation\{([^}]+)\}/);
      if (citationMatch) {
        const citationKeys = citationMatch[1].split(',').map(k => k.trim());
        
        citationKeys.forEach(citationKey => {
          if (citationKey) {
            // Store line number (from .aux, approximate but better than nothing)
            citationLineMap.set(citationKey, index + 1);
            
            // Store file mapping
            if (currentFile) {
              citationFileMap.set(citationKey, currentFile);
            }
            
            // Store context (which other citations were on same line)
            citationContextMap.set(citationKey, {
              line: index + 1,
              file: currentFile,
              relatedKeys: citationKeys.filter(k => k !== citationKey)
            });
          }
        });
      }
    });
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let lineNumber = null;
    let fileName = null;

    // Match "File ended while scanning use of \citation"
    if (/file ended while scanning use of \\citation/i.test(line)) {
      // Try to extract citation key from context (increased search range)
      let citationKey = null;
      let citationFile = null;
      for (let j = Math.max(0, i - 15); j < i; j++) {
        const prevLine = lines[j];
        const keyMatch = prevLine.match(/\\citation\{([^}]+)\}/);
        if (keyMatch) {
          citationKey = keyMatch[1];
          lineNumber = citationLineMap.get(citationKey) || null;
          citationFile = citationFileMap.get(citationKey) || null;
          break;
        }
      }

      errors.push({
        type: 'error',
        engine: 'bibtex',
        message: 'File ended while scanning use of \\citation' + (citationKey ? ` (citation key: ${citationKey})` : ''),
        rawMessage: line,
        line: lineNumber,
        file: citationFile,
        severity: 'error',
        text: null,
        column: null,
        startColumn: null,
        endColumn: null,
        context: lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 5))
      });
    }

    // Match "I found no \citation commands"
    else if (/I found no \\citation commands/i.test(line)) {
      errors.push({
        type: 'error',
        engine: 'bibtex',
        message: 'I found no \\citation commands - bibliography may not be properly referenced in document',
        rawMessage: line,
        line: null,
        file: null,
        severity: 'error',
        text: null,
        column: null,
        startColumn: null,
        endColumn: null,
        context: lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 3))
      });
    }

    // Match "I couldn't open database file"
    else if (/I couldn't open database file/i.test(line)) {
      const fileMatch = line.match(/database file\s+([^\s]+)/i);
      const missingFile = fileMatch ? fileMatch[1] : null;

      errors.push({
        type: 'error',
        engine: 'bibtex',
        message: `I couldn't open database file${missingFile ? `: ${missingFile}` : ''}`,
        rawMessage: line,
        line: null,
        file: missingFile,
        severity: 'error',
        text: null,
        column: null,
        startColumn: null,
        endColumn: null,
        context: lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 3))
      });
    }

    // Match "Warning--I didn't find a database entry for"
    else if (/Warning--I didn't find a database entry for/i.test(line)) {
      const entryMatch = line.match(/database entry for\s+"([^"]+)"/i);
      const missingKey = entryMatch ? entryMatch[1] : null;
      
      // Get line number and file from citation map
      lineNumber = citationLineMap.get(missingKey) || null;
      const citationFile = citationFileMap.get(missingKey) || null;
      
      // Get context info if available
      const contextInfo = citationContextMap.get(missingKey);
      const relatedKeys = contextInfo?.relatedKeys || [];

      errors.push({
        type: 'warning',
        engine: 'bibtex',
        message: `Warning--I didn't find a database entry for "${missingKey || 'unknown'}"` + 
                 (relatedKeys.length > 0 ? ` (cited with: ${relatedKeys.join(', ')})` : ''),
        rawMessage: line,
        line: lineNumber,
        file: citationFile,
        severity: 'warning',
        text: missingKey ? `\\cite{${missingKey}}` : null,
        column: null,
        startColumn: null,
        endColumn: null,
        context: lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 3)),
        citationKey: missingKey
      });
    }

    // Match "I'm skipping whatever remains of this command"
    else if (/I'm skipping whatever remains of this command/i.test(line)) {
      errors.push({
        type: 'error',
        engine: 'bibtex',
        message: 'I\'m skipping whatever remains of this command - syntax error in bibliography file',
        rawMessage: line,
        line: null,
        file: null,
        severity: 'error',
        text: null,
        column: null,
        startColumn: null,
        endColumn: null,
        context: lines.slice(Math.max(0, i - 5), Math.min(lines.length, i + 5))
      });
    }

    // Match BibTeX warnings
    else if (/Warning/i.test(line) && !/Warning--I didn't find/i.test(line)) {
      const warningMessage = line.trim();
      
      errors.push({
        type: 'warning',
        engine: 'bibtex',
        message: warningMessage,
        rawMessage: line,
        line: null,
        file: null,
        severity: 'warning',
        text: null,
        column: null,
        startColumn: null,
        endColumn: null,
        context: lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 3))
      });
    }

    // Match BibTeX errors (general pattern)
    else if (/^!\s/i.test(line)) {
      const errorMessage = line.replace(/^!\s*/, '').trim();
      
      errors.push({
        type: 'error',
        engine: 'bibtex',
        message: errorMessage,
        rawMessage: line,
        line: null,
        file: null,
        severity: 'error',
        text: null,
        column: null,
        startColumn: null,
        endColumn: null,
        context: lines.slice(Math.max(0, i - 3), Math.min(lines.length, i + 3))
      });
    }
  }

  // Remove duplicates using improved deduplication
  return deduplicateErrors(errors);
}

/**
 * Parse latex.js errors/warnings
 */
export function parseLatexJSErrors(logText) {
  if (!logText) return [];

  const errors = [];
  const lines = logText.split('\n');

  for (const line of lines) {
    // Match latex.js error patterns
    if (line.includes('Error:') || line.includes('error:')) {
      const errorMatch = line.match(/Error:\s*(.+)/i);
      if (errorMatch) {
        errors.push({
          type: 'error',
          engine: 'latex.js',
          message: errorMatch[1].trim(),
          line: null,
          file: null,
          severity: 'error',
          text: null,
          column: null,
          startColumn: null,
          endColumn: null
        });
      }
    }

    // Match latex.js warning patterns
    if (line.includes('Warning:') || line.includes('warning:')) {
      const warningMatch = line.match(/Warning:\s*(.+)/i);
      if (warningMatch) {
        errors.push({
          type: 'warning',
          engine: 'latex.js',
          message: warningMatch[1].trim(),
          line: null,
          file: null,
          severity: 'warning',
          text: null,
          column: null,
          startColumn: null,
          endColumn: null
        });
      }
    }
  }

  return errors;
}

import { parseBibFileErrors } from './bibtex-error-detector.js';

/**
 * Unified compilation error parser
 * Parses errors from pdflatex log and optionally BibTeX .blg file
 * @param {string} logText - Main compilation log (pdflatex)
 * @param {Object} options - Parsing options
 * @param {string} options.engine - Engine name (default: 'pdflatex')
 * @param {string} options.blgContent - Content of .blg file for BibTeX errors
 * @param {string} options.auxContent - Content of .aux file for line number mapping
 * @param {string} options.projectDir - Project directory for file path normalization
 * @param {Array<Object>} options.bibFiles - Array of {path: string, content: string} for .bib files
 * @returns {Array} Combined array of all errors and warnings
 */
export function parseCompilationErrors(logText, options = {}) {
  const { engine = 'pdflatex', blgContent, auxContent, projectDir = '', bibFiles = [] } = options;
  
  const errors = [];
  
  // Parse main log (pdflatex)
  if (logText) {
    errors.push(...parsePdfLaTeXErrors(logText));
  }
  
  // Parse BibTeX log if available
  if (blgContent) {
    errors.push(...parseBibTeXErrors(blgContent, auxContent, projectDir));
  }
  
  // Parse .bib file errors if available
  if (bibFiles && bibFiles.length > 0) {
    bibFiles.forEach(bibFile => {
      if (bibFile.content && bibFile.path) {
        try {
          const bibErrors = parseBibFileErrors(bibFile.content, bibFile.path);
          errors.push(...bibErrors);
        } catch (err) {
          console.warn(`⚠️ Error parsing .bib file ${bibFile.path}:`, err.message);
        }
      }
    });
  }
  
  // Deduplicate errors
  return deduplicateErrors(errors);
}

/**
 * Remove duplicate errors with improved deduplication logic
 * Groups related errors, handles multi-pass compilation duplicates, considers context
 * @param {Array} errors - Array of error objects
 * @returns {Array} Deduplicated array
 */
function deduplicateErrors(errors) {
  if (!Array.isArray(errors) || errors.length === 0) return [];
  
  const uniqueErrors = [];
  const seen = new Set();
  const groupedErrors = new Map(); // Group similar errors
  
  for (const error of errors) {
    // Create base key for exact duplicates
    const baseKey = `${error.engine}-${error.line || 0}-${error.message}-${error.file || ''}-${error.text || ''}`;
    
    // Check for exact duplicates
    if (seen.has(baseKey)) {
      continue;
    }
    
    // Check for similar errors (same message, nearby lines, same file)
    let isDuplicate = false;
    if (error.line && error.file) {
      for (const [existingKey, existingError] of groupedErrors.entries()) {
        // Same file, same message, within 3 lines
        if (existingError.file === error.file &&
            existingError.message === error.message &&
            existingError.line &&
            Math.abs(existingError.line - error.line) <= 3) {
          isDuplicate = true;
          break;
        }
      }
    }
    
    if (!isDuplicate) {
      seen.add(baseKey);
      if (error.line && error.file) {
        groupedErrors.set(baseKey, error);
      }
      uniqueErrors.push(error);
    }
  }
  
  return uniqueErrors;
}
