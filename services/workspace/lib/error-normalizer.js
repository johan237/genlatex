// SPDX-License-Identifier: MIT

import { createHash } from 'crypto';
import path from 'path';
import { ERROR_CATEGORIES } from './error-schema.js';

/**
 * Generate unique ID for an error
 * @param {Object} error - Error object
 * @returns {string} Unique identifier
 */
function generateErrorId(error) {
  const key = `${error.engine}-${error.line || 0}-${error.message}-${error.file || ''}-${error.text || ''}`;
  return createHash('md5').update(key).digest('hex').substring(0, 16);
}

/**
 * Normalize file path to relative path from project root
 * @param {string|null} filePath - File path (may be absolute or relative)
 * @param {string} projectDir - Project directory path
 * @returns {string|null} Normalized relative path or null
 */
function normalizeFilePath(filePath, projectDir) {
  if (!filePath) return null;
  
  try {
    // Handle absolute paths
    if (path.isAbsolute(filePath)) {
      const relativePath = path.relative(projectDir, filePath);
      return relativePath.replace(/\\/g, '/'); // Normalize to forward slashes
    }
    
    // Handle relative paths
    // Remove leading ./ if present
    const normalized = filePath.replace(/^\.\//, '').replace(/\\/g, '/');
    return normalized;
  } catch (error) {
    // If normalization fails, return original path
    return filePath.replace(/\\/g, '/');
  }
}

/**
 * Categorize error based on message and type
 * @param {Object} error - Error object
 * @returns {string} Error category
 */
function categorizeError(error) {
  const message = (error.message || '').toLowerCase();
  const rawMessage = (error.rawMessage || message).toLowerCase();
  
  // Missing package errors
  if (error.isMissingPackage || /missing package|package.*not found|file.*\.sty.*not found/i.test(message)) {
    return ERROR_CATEGORIES.MISSING_PACKAGE;
  }
  
  // Citation errors
  if (/citation|bibliography|bibtex|biber/i.test(message) || error.engine === 'bibtex' || error.engine === 'biber') {
    return ERROR_CATEGORIES.CITATION;
  }
  
  // Environment errors
  if (/\\begin|\\end|environment|unclosed|missing.*end/i.test(message)) {
    return ERROR_CATEGORIES.ENVIRONMENT;
  }
  
  // Math mode errors
  if (/\$|math mode|missing \$|extra \$/i.test(message)) {
    return ERROR_CATEGORIES.MATH_MODE;
  }
  
  // Brace errors
  if (/brace|missing.*\{|extra.*\}|file ended while scanning/i.test(message)) {
    return ERROR_CATEGORIES.BRACE;
  }
  
  // File not found errors
  if (/file.*not found|cannot find file|unable to load/i.test(message)) {
    return ERROR_CATEGORIES.FILE_NOT_FOUND;
  }
  
  // Font errors
  if (/font|fontconfig/i.test(message)) {
    return ERROR_CATEGORIES.FONT;
  }
  
  // System errors
  if (error.engine === 'system' || /program not found|system error/i.test(message)) {
    return ERROR_CATEGORIES.SYSTEM;
  }
  
  // Syntax errors (default for most LaTeX errors)
  if (error.type === 'error' && error.severity === 'error') {
    return ERROR_CATEGORIES.SYNTAX;
  }
  
  return ERROR_CATEGORIES.GENERAL;
}

/**
 * Generate fix suggestions based on error category and message
 * @param {Object} error - Error object
 * @param {string} category - Error category
 * @returns {string[]} Array of suggestions
 */
function generateSuggestions(error, category) {
  const suggestions = [];
  const message = (error.message || '').toLowerCase();
  
  switch (category) {
    case ERROR_CATEGORIES.MISSING_PACKAGE:
      if (error.missingPackage) {
        suggestions.push(`Install missing package: \\usepackage{${error.missingPackage}}`);
        suggestions.push(`Check if package name is correct: ${error.missingPackage}`);
      } else {
        suggestions.push('Check if required packages are installed');
        suggestions.push('Verify package names in \\usepackage commands');
      }
      break;
      
    case ERROR_CATEGORIES.CITATION:
      suggestions.push('Check bibliography file (.bib) exists and is properly formatted');
      suggestions.push('Verify citation keys match entries in bibliography file');
      suggestions.push('Run BibTeX/Biber if citations are not resolving');
      if (/undefined/i.test(message)) {
        suggestions.push('Add missing citation to bibliography file or remove unused citation');
      }
      break;
      
    case ERROR_CATEGORIES.ENVIRONMENT:
      if (/missing.*end/i.test(message)) {
        suggestions.push('Add missing \\end{...} command');
        suggestions.push('Check that all \\begin{...} commands have matching \\end{...}');
      } else if (/extra.*end/i.test(message)) {
        suggestions.push('Remove extra \\end{...} command');
        suggestions.push('Check for duplicate \\end{...} commands');
      } else {
        suggestions.push('Check that environment names match between \\begin and \\end');
      }
      break;
      
    case ERROR_CATEGORIES.MATH_MODE:
      if (/missing \$/i.test(message)) {
        suggestions.push('Add missing $ to close math mode');
        suggestions.push('Check that all math expressions are properly delimited');
      } else if (/extra \$/i.test(message)) {
        suggestions.push('Remove extra $ symbol');
        suggestions.push('Check for unmatched $ symbols');
      } else {
        suggestions.push('Ensure math mode is properly opened and closed');
      }
      break;
      
    case ERROR_CATEGORIES.BRACE:
      suggestions.push('Check for missing closing brace }');
      suggestions.push('Verify all opening braces { have matching closing braces }');
      suggestions.push('Check for unmatched braces in commands');
      break;
      
    case ERROR_CATEGORIES.FILE_NOT_FOUND:
      suggestions.push('Verify file path is correct');
      suggestions.push('Check if file exists in the project directory');
      suggestions.push('Ensure file extension is correct (.tex, .bib, .sty, etc.)');
      break;
      
    case ERROR_CATEGORIES.SYNTAX:
      if (error.text) {
        suggestions.push(`Check syntax around: ${error.text}`);
      }
      suggestions.push('Review LaTeX syntax for the problematic command');
      suggestions.push('Check for typos in command names');
      break;
      
    default:
      suggestions.push('Review the error message and check LaTeX documentation');
  }
  
  return suggestions;
}

/**
 * Extract context lines from log around error line
 * @param {string} logText - Full log text
 * @param {number} errorLineIndex - Index of error line in log
 * @param {number} contextLines - Number of context lines to extract (default: 5)
 * @returns {string[]} Array of context lines
 */
function extractContext(logText, errorLineIndex, contextLines = 5) {
  if (!logText) return [];
  
  const lines = logText.split('\n');
  const start = Math.max(0, errorLineIndex - Math.floor(contextLines / 2));
  const end = Math.min(lines.length, errorLineIndex + Math.ceil(contextLines / 2) + 1);
  
  return lines.slice(start, end).map((line, idx) => {
    const actualLineNum = start + idx + 1;
    const marker = actualLineNum === errorLineIndex + 1 ? '>>> ' : '    ';
    return `${marker}${line}`;
  });
}

/**
 * Normalize a single error to unified format
 * @param {Object} error - Parsed error object from error-parser.js
 * @param {Object} options - Normalization options
 * @param {string} options.projectDir - Project directory path
 * @param {string} options.logText - Full log text for context extraction
 * @param {number} options.errorLineIndex - Index of error line in log (optional)
 * @returns {Object} Normalized error object
 */
export function normalizeError(error, options = {}) {
  const { projectDir = '', logText = '', errorLineIndex = null } = options;
  
  // Generate unique ID
  const id = generateErrorId(error);
  
  // Normalize file path
  const file = normalizeFilePath(error.file, projectDir);
  
  // Categorize error
  const category = categorizeError(error);
  
  // Generate suggestions
  const suggestions = generateSuggestions(error, category);
  
  // Extract context if log text and line index provided
  let context = [];
  if (logText && errorLineIndex !== null) {
    context = extractContext(logText, errorLineIndex);
  } else if (error.context && Array.isArray(error.context)) {
    context = error.context;
  }
  
  // Determine severity and type
  const severity = error.severity || (error.type === 'error' ? 'error' : 'warning');
  const type = error.type || severity;
  
  // Build normalized error
  return {
    id,
    type,
    severity,
    engine: error.engine || 'pdflatex',
    message: error.message || 'Unknown error',
    rawMessage: error.rawMessage || error.message || '',
    line: error.line || null,
    column: error.column || error.startColumn || null,
    endColumn: error.endColumn || null,
    file,
    text: error.text || null,
    context,
    category,
    isIgnorable: error.isIgnorable || false,
    suggestions,
    // Preserve original fields that might be useful
    missingPackage: error.missingPackage || null,
    isMissingPackage: error.isMissingPackage || false
  };
}

/**
 * Normalize array of errors to unified format
 * @param {Array} errors - Array of parsed error objects
 * @param {Object} options - Normalization options
 * @returns {Array} Array of normalized error objects
 */
export function normalizeErrors(errors, options = {}) {
  if (!Array.isArray(errors)) return [];
  
  // Build line index map for context extraction
  const logText = options.logText || '';
  const lineIndexMap = new Map();
  if (logText) {
    const lines = logText.split('\n');
    errors.forEach((error, idx) => {
      // Try to find error line in log
      if (error.message) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes(error.message) || 
              (error.line && lines[i].match(new RegExp(`l\\.${error.line}`)))) {
            lineIndexMap.set(idx, i);
            break;
          }
        }
      }
    });
  }
  
  return errors.map((error, idx) => {
    const errorLineIndex = lineIndexMap.get(idx) || null;
    return normalizeError(error, {
      ...options,
      errorLineIndex
    });
  });
}
