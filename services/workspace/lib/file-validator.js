/**
 * File Validator
 * Validates LaTeX file structure and integrity
 */

import fs from 'fs/promises';
import path from 'path';
import { getProjectPath } from './files.js';

export class FileValidator {
  constructor() {
    // Configuration
    this.maxFileSize = 10 * 1024 * 1024; // 10MB
  }

  /**
   * Validate file changes after modification
   * @param {string} filePath - File path (relative to project)
   * @param {string} projectId - Project ID
   * @param {string} fileType - File type hint ('latex', 'bib', etc.)
   * @returns {Promise<Object>} Validation result
   */
  async validateFileChanges(filePath, projectId, fileType = 'latex') {
    const normalizedPath = filePath.replace(/^[\/\\]+/, '').replace(/\\/g, '/');
    
    try {
      // Read file from disk
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const projectPathAbs = projectPath;
      const target = path.resolve(projectPathAbs, normalizedPath);
      
      // Security check
      if (!target.startsWith(projectPathAbs + path.sep) && target !== projectPathAbs) {
        return {
          isValid: false,
          issues: [{
            type: 'security',
            severity: 'error',
            message: 'Invalid file path - security check failed'
          }],
          statistics: {}
        };
      }

      let fileContent;
      try {
        fileContent = await fs.readFile(target, 'utf-8');
      } catch (error) {
        return {
          isValid: false,
          issues: [{
            type: 'file_access',
            severity: 'error',
            message: `Could not read file: ${error.message}`
          }],
          statistics: {}
        };
      }

      // Perform validation based on file type
      if (fileType === 'latex' || normalizedPath.endsWith('.tex')) {
        return this.validateLaTeXFile(fileContent, normalizedPath);
      } else if (fileType === 'bib' || normalizedPath.endsWith('.bib')) {
        return this.validateBibFile(fileContent);
      } else {
        return this.validateGenericFile(fileContent);
      }

    } catch (error) {
      console.error('Error validating file:', error);
      return {
        isValid: false,
        issues: [{
          type: 'validation_error',
          severity: 'error',
          message: `Validation error: ${error.message}`
        }],
        statistics: {}
      };
    }
  }

  /**
   * Validate LaTeX file structure
   * @param {string} content - File content
   * @param {string} filePath - File path for context
   * @returns {Object} Validation result
   */
  validateLaTeXFile(content, filePath = '') {
    const issues = [];
    const statistics = {};

    // File integrity checks
    if (!content || content.length === 0) {
      issues.push({
        type: 'file_integrity',
        severity: 'error',
        message: 'File is empty'
      });
      return { isValid: false, issues, statistics };
    }

    if (content.length > this.maxFileSize) {
      issues.push({
        type: 'file_integrity',
        severity: 'warning',
        message: `File is very large: ${Math.round(content.length / 1024)}KB`
      });
    }

    statistics.fileLength = content.length;
    statistics.lineCount = content.split('\n').length;

    // Document structure validation
    const documentClassMatches = content.matchAll(/\\documentclass(\[[^\]]*\])?\{[^\}]*\}/g);
    const documentClassArray = Array.from(documentClassMatches);
    const documentBeginMatches = content.matchAll(/\\begin\{document\}/g);
    const documentBeginArray = Array.from(documentBeginMatches);
    const documentEndMatches = content.matchAll(/\\end\{document\}/g);
    const documentEndArray = Array.from(documentEndMatches);

    statistics.docClassCount = documentClassArray.length;
    statistics.beginCount = documentBeginArray.length;
    statistics.endCount = documentEndArray.length;

    // Check for duplicate document structure (CRITICAL)
    if (statistics.docClassCount !== 1) {
      issues.push({
        type: 'structure',
        severity: statistics.docClassCount === 0 ? 'error' : 'error',
        message: `Found ${statistics.docClassCount} \\documentclass declaration(s). Expected exactly 1.`
      });
    }

    if (statistics.beginCount !== 1) {
      issues.push({
        type: 'structure',
        severity: statistics.beginCount === 0 ? 'error' : 'error',
        message: `Found ${statistics.beginCount} \\begin{document} tag(s). Expected exactly 1.`
      });
    }

    if (statistics.endCount !== 1) {
      issues.push({
        type: 'structure',
        severity: statistics.endCount === 0 ? 'error' : 'error',
        message: `Found ${statistics.endCount} \\end{document} tag(s). Expected exactly 1.`
      });
    }

    // Check for missing essential components
    if (statistics.docClassCount === 0) {
      issues.push({
        type: 'structure',
        severity: 'error',
        message: 'Missing \\documentclass declaration'
      });
    }

    if (statistics.beginCount === 0) {
      issues.push({
        type: 'structure',
        severity: 'error',
        message: 'Missing \\begin{document}'
      });
    }

    if (statistics.endCount === 0) {
      issues.push({
        type: 'structure',
        severity: 'error',
        message: 'Missing \\end{document}'
      });
    }

    // Environment matching validation
    const beginMatches = content.matchAll(/\\begin\{([^}]+)\}/g);
    const endMatches = content.matchAll(/\\end\{([^}]+)\}/g);
    const beginEnvs = Array.from(beginMatches).map(m => m[1]);
    const endEnvs = Array.from(endMatches).map(m => m[1]);

    statistics.environments = {
      begin: beginEnvs.length,
      end: endEnvs.length
    };

    // Check for unmatched environments
    const envCounts = {};
    for (const env of beginEnvs) {
      envCounts[env] = (envCounts[env] || 0) + 1;
    }
    for (const env of endEnvs) {
      envCounts[env] = (envCounts[env] || 0) - 1;
    }

    for (const [env, count] of Object.entries(envCounts)) {
      if (count !== 0) {
        issues.push({
          type: 'environment',
          severity: 'error',
          message: `Unmatched environment "${env}": ${count > 0 ? count : Math.abs(count)} more \\begin than \\end`
        });
      }
    }

    // Document environment specific check
    const envDocBeginCount = beginEnvs.filter(e => e === 'document').length;
    const envDocEndCount = endEnvs.filter(e => e === 'document').length;
    if (envDocBeginCount !== envDocEndCount) {
      issues.push({
        type: 'structure',
        severity: 'error',
        message: `Mismatched document environments: ${envDocBeginCount} begin, ${envDocEndCount} end`
      });
    }

    // Brace matching validation
    const openBraces = (content.match(/\{/g) || []).length;
    const closeBraces = (content.match(/\}/g) || []).length;
    const unmatchedBraces = openBraces - closeBraces;

    statistics.braces = {
      open: openBraces,
      close: closeBraces,
      unmatched: unmatchedBraces
    };

    if (unmatchedBraces !== 0) {
      issues.push({
        type: 'syntax',
        severity: 'error',
        message: `Unmatched braces: ${Math.abs(unmatchedBraces)} more ${unmatchedBraces > 0 ? 'opening' : 'closing'} brace(s)`
      });
    }

    // Check for malformed commands
    const malformedCommands = content.match(/\\[a-zA-Z]+\{[^}]*$/g);
    if (malformedCommands && malformedCommands.length > 0) {
      issues.push({
        type: 'syntax',
        severity: 'warning',
        message: `Found ${malformedCommands.length} potentially malformed command(s) (commands without proper closing)`
      });
    }

    // Check for common empty commands
    const emptySectionMatches = content.match(/\\section\s*\{[^}]*\s*\}/g);
    const emptyCiteMatches = content.match(/\\cite\s*\{\s*\}/g);
    const emptyRefMatches = content.match(/\\ref\s*\{\s*\}/g);

    if (emptySectionMatches && emptySectionMatches.length > 0) {
      issues.push({
        type: 'content',
        severity: 'warning',
        message: `Found ${emptySectionMatches.length} empty section title(s)`
      });
    }

    if (emptyCiteMatches && emptyCiteMatches.length > 0) {
      issues.push({
        type: 'content',
        severity: 'warning',
        message: `Found ${emptyCiteMatches.length} empty citation(s)`
      });
    }

    if (emptyRefMatches && emptyRefMatches.length > 0) {
      issues.push({
        type: 'content',
        severity: 'warning',
        message: `Found ${emptyRefMatches.length} empty reference(s)`
      });
    }

    // Determine overall validity
    const errorIssues = issues.filter(i => i.severity === 'error');
    const isValid = errorIssues.length === 0;

    return {
      isValid,
      issues,
      statistics,
      summary: {
        totalIssues: issues.length,
        errors: errorIssues.length,
        warnings: issues.filter(i => i.severity === 'warning').length
      }
    };
  }

  /**
   * Validate BibTeX file
   * @param {string} content - File content
   * @returns {Object} Validation result
   */
  validateBibFile(content) {
    const issues = [];
    const statistics = {};

    if (!content || content.length === 0) {
      issues.push({
        type: 'file_integrity',
        severity: 'warning',
        message: 'BibTeX file is empty'
      });
      return { isValid: true, issues, statistics };
    }

    statistics.fileLength = content.length;

    // Check for entry structure
    const entryMatches = content.matchAll(/@\w+\{/g);
    const entries = Array.from(entryMatches);
    statistics.entryCount = entries.length;

    if (statistics.entryCount === 0) {
      issues.push({
        type: 'structure',
        severity: 'warning',
        message: 'No BibTeX entries found'
      });
    }

    // Check for unmatched braces in entries
    const braceCount = (content.match(/\{/g) || []).length - (content.match(/\}/g) || []).length;
    if (braceCount !== 0) {
      issues.push({
        type: 'syntax',
        severity: 'error',
        message: `Unmatched braces in BibTeX entries: ${Math.abs(braceCount)} more ${braceCount > 0 ? 'opening' : 'closing'} brace(s)`
      });
    }

    const errorIssues = issues.filter(i => i.severity === 'error');
    const isValid = errorIssues.length === 0;

    return {
      isValid,
      issues,
      statistics,
      summary: {
        totalIssues: issues.length,
        errors: errorIssues.length,
        warnings: issues.filter(i => i.severity === 'warning').length
      }
    };
  }

  /**
   * Validate generic file
   * @param {string} content - File content
   * @returns {Object} Validation result
   */
  validateGenericFile(content) {
    const issues = [];
    const statistics = {};

    if (!content || content.length === 0) {
      issues.push({
        type: 'file_integrity',
        severity: 'warning',
        message: 'File is empty'
      });
    } else {
      statistics.fileLength = content.length;
      statistics.lineCount = content.split('\n').length;
    }

    const errorIssues = issues.filter(i => i.severity === 'error');
    const isValid = errorIssues.length === 0;

    return {
      isValid,
      issues,
      statistics,
      summary: {
        totalIssues: issues.length,
        errors: errorIssues.length,
        warnings: issues.filter(i => i.severity === 'warning').length
      }
    };
  }

  /**
   * Validate file content directly (without reading from disk)
   * Useful for pre-write validation
   * @param {string} content - File content to validate
   * @param {string} fileType - File type hint
   * @returns {Object} Validation result
   */
  validateContent(content, fileType = 'latex') {
    if (fileType === 'latex') {
      return this.validateLaTeXFile(content);
    } else if (fileType === 'bib') {
      return this.validateBibFile(content);
    } else {
      return this.validateGenericFile(content);
    }
  }
}

