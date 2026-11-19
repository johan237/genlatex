// SPDX-License-Identifier: MIT

/**
 * @typedef {Object} CompilationError
 * @property {string} id - Unique identifier (UUID or hash)
 * @property {'error'|'warning'|'info'} type - Error type
 * @property {'error'|'warning'|'info'} severity - Error severity level
 * @property {'pdflatex'|'bibtex'|'biber'|'system'} engine - Compilation engine that generated the error
 * @property {string} message - User-friendly error message
 * @property {string} rawMessage - Original log message
 * @property {number|null} line - Line number (1-indexed) where error occurred
 * @property {number|null} column - Column number (1-indexed) where error started
 * @property {number|null} endColumn - End column (1-indexed) where error ends
 * @property {string|null} file - File path (normalized, relative to project root)
 * @property {string|null} text - Problematic text snippet that caused the error
 * @property {string[]} context - Surrounding lines (3-7 lines) for context
 * @property {string} category - Error category (syntax, missing-package, citation, environment, math-mode, etc.)
 * @property {boolean} isIgnorable - Whether error can be safely ignored
 * @property {string[]} suggestions - Array of fix suggestions
 */

/**
 * Error categories for classification
 */
export const ERROR_CATEGORIES = {
  SYNTAX: 'syntax',
  MISSING_PACKAGE: 'missing-package',
  CITATION: 'citation',
  ENVIRONMENT: 'environment',
  MATH_MODE: 'math-mode',
  BRACE: 'brace',
  FILE_NOT_FOUND: 'file-not-found',
  BIBLIOGRAPHY: 'bibliography',
  FONT: 'font',
  SYSTEM: 'system',
  GENERAL: 'general'
};

/**
 * Error severity levels
 */
export const ERROR_SEVERITY = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info'
};

/**
 * Error types
 */
export const ERROR_TYPE = {
  ERROR: 'error',
  WARNING: 'warning',
  INFO: 'info'
};

/**
 * Compilation engines
 */
export const ENGINE = {
  PDFLATEX: 'pdflatex',
  BIBTEX: 'bibtex',
  BIBER: 'biber',
  SYSTEM: 'system'
};
