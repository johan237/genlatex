/**
 * Advanced LaTeX Linter
 * Comprehensive LaTeX error detection, style checking, and best practices validation
 */

import fs from 'fs/promises';
import path from 'path';
import { getProjectPath } from './files.js';

export class LaTeXLinter {
  constructor() {
    this.rules = new Map();
    this.loadRules();
  }

  /**
   * Load linting rules
   */
  loadRules() {
    // Syntax rules
    this.rules.set('unmatched_braces', {
      name: 'Unmatched Braces',
      severity: 'error',
      description: 'Check for unmatched opening and closing braces',
      check: this.checkUnmatchedBraces.bind(this)
    });

    this.rules.set('unmatched_environments', {
      name: 'Unmatched Environments',
      severity: 'error',
      description: 'Check for unmatched \\begin and \\end commands',
      check: this.checkUnmatchedEnvironments.bind(this)
    });

    this.rules.set('missing_packages', {
      name: 'Missing Packages',
      severity: 'warning',
      description: 'Check for missing required packages',
      check: this.checkMissingPackages.bind(this)
    });

    // Style rules
    this.rules.set('line_length', {
      name: 'Line Length',
      severity: 'warning',
      description: 'Check for lines that are too long',
      check: this.checkLineLength.bind(this)
    });

    this.rules.set('trailing_whitespace', {
      name: 'Trailing Whitespace',
      severity: 'info',
      description: 'Check for trailing whitespace',
      check: this.checkTrailingWhitespace.bind(this)
    });

    this.rules.set('empty_lines', {
      name: 'Empty Lines',
      severity: 'info',
      description: 'Check for excessive empty lines',
      check: this.checkEmptyLines.bind(this)
    });

    // Content rules
    this.rules.set('missing_captions', {
      name: 'Missing Captions',
      severity: 'warning',
      description: 'Check for figures and tables without captions',
      check: this.checkMissingCaptions.bind(this)
    });

    this.rules.set('missing_labels', {
      name: 'Missing Labels',
      severity: 'info',
      description: 'Check for figures and tables without labels',
      check: this.checkMissingLabels.bind(this)
    });

    this.rules.set('unused_labels', {
      name: 'Unused Labels',
      severity: 'warning',
      description: 'Check for labels that are never referenced',
      check: this.checkUnusedLabels.bind(this)
    });

    this.rules.set('missing_citations', {
      name: 'Missing Citations',
      severity: 'info',
      description: 'Check for potential missing citations',
      check: this.checkMissingCitations.bind(this)
    });

    // Best practices rules
    this.rules.set('hardcoded_references', {
      name: 'Hardcoded References',
      severity: 'warning',
      description: 'Check for hardcoded section/figure references',
      check: this.checkHardcodedReferences.bind(this)
    });

    this.rules.set('inconsistent_spacing', {
      name: 'Inconsistent Spacing',
      severity: 'info',
      description: 'Check for inconsistent spacing around commands',
      check: this.checkInconsistentSpacing.bind(this)
    });

    this.rules.set('deprecated_commands', {
      name: 'Deprecated Commands',
      severity: 'warning',
      description: 'Check for deprecated LaTeX commands',
      check: this.checkDeprecatedCommands.bind(this)
    });
  }

  /**
   * Lint LaTeX document
   */
  async lintDocument(projectId, options = {}) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const mainTexPath = path.join(projectPath, 'main.tex');
      
      // Read document content
      const content = await fs.readFile(mainTexPath, 'utf-8');
      const lines = content.split('\n');
      
      // Run all linting rules
      const issues = [];
      const enabledRules = options.rules || Array.from(this.rules.keys());
      
      for (const ruleId of enabledRules) {
        const rule = this.rules.get(ruleId);
        if (rule) {
          const ruleIssues = await rule.check(content, lines, options);
          issues.push(...ruleIssues);
        }
      }
      
      // Sort issues by severity and line number
      issues.sort((a, b) => {
        const severityOrder = { error: 0, warning: 1, info: 2 };
        const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (severityDiff !== 0) return severityDiff;
        return a.line - b.line;
      });
      
      // Generate summary
      const summary = this.generateSummary(issues);
      
      return {
        success: true,
        issues,
        summary,
        totalIssues: issues.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check for unmatched braces
   */
  async checkUnmatchedBraces(content, lines, options = {}) {
    const issues = [];
    const openBraces = [];
    const closeBraces = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;
      
      // Count braces (ignore escaped braces)
      for (let j = 0; j < line.length; j++) {
        if (line[j] === '{' && (j === 0 || line[j-1] !== '\\')) {
          openBraces.push({ line: lineNumber, column: j + 1 });
        } else if (line[j] === '}' && (j === 0 || line[j-1] !== '\\')) {
          closeBraces.push({ line: lineNumber, column: j + 1 });
        }
      }
    }
    
    // Check for unmatched braces
    if (openBraces.length !== closeBraces.length) {
      issues.push({
        rule: 'unmatched_braces',
        severity: 'error',
        line: 1,
        column: 1,
        message: `Unmatched braces: ${openBraces.length} open, ${closeBraces.length} close`,
        suggestion: 'Check for missing or extra braces in your document'
      });
    }
    
    return issues;
  }

  /**
   * Check for unmatched environments
   */
  async checkUnmatchedEnvironments(content, lines, options = {}) {
    const issues = [];
    const environments = new Map();
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1;
      
      // Check for \begin commands
      const beginMatch = line.match(/\\begin\{([^}]+)\}/);
      if (beginMatch) {
        const envName = beginMatch[1];
        if (!environments.has(envName)) {
          environments.set(envName, []);
        }
        environments.get(envName).push({ type: 'begin', line: lineNumber });
      }
      
      // Check for \end commands
      const endMatch = line.match(/\\end\{([^}]+)\}/);
      if (endMatch) {
        const envName = endMatch[1];
        if (!environments.has(envName)) {
          environments.set(envName, []);
        }
        environments.get(envName).push({ type: 'end', line: lineNumber });
      }
    }
    
    // Check for unmatched environments
    for (const [envName, commands] of environments) {
      const begins = commands.filter(c => c.type === 'begin');
      const ends = commands.filter(c => c.type === 'end');
      
      if (begins.length !== ends.length) {
        issues.push({
          rule: 'unmatched_environments',
          severity: 'error',
          line: begins.length > 0 ? begins[0].line : ends[0].line,
          column: 1,
          message: `Unmatched environment '${envName}': ${begins.length} \\begin, ${ends.length} \\end`,
          suggestion: `Add missing \\begin{${envName}} or \\end{${envName}}`
        });
      }
    }
    
    return issues;
  }

  /**
   * Check for missing packages
   */
  async checkMissingPackages(content, lines, options = {}) {
    const issues = [];
    const usedCommands = new Set();
    const declaredPackages = new Set();
    
    // Extract used commands
    const commandRegex = /\\([a-zA-Z]+)/g;
    let match;
    while ((match = commandRegex.exec(content)) !== null) {
      usedCommands.add(match[1]);
    }
    
    // Extract declared packages
    for (const line of lines) {
      const packageMatch = line.match(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/);
      if (packageMatch) {
        declaredPackages.add(packageMatch[1]);
      }
    }
    
    // Check for missing packages
    const packageMap = {
      'includegraphics': 'graphicx',
      'url': 'url',
      'href': 'hyperref',
      'toprule': 'booktabs',
      'midrule': 'booktabs',
      'bottomrule': 'booktabs',
      'algorithm': 'algorithm',
      'algorithmic': 'algorithmic',
      'lstlisting': 'listings',
      'minted': 'minted',
      'tikzpicture': 'tikz',
      'pgfplotstableread': 'pgfplots'
    };
    
    for (const command of usedCommands) {
      const requiredPackage = packageMap[command];
      if (requiredPackage && !declaredPackages.has(requiredPackage)) {
        issues.push({
          rule: 'missing_packages',
          severity: 'warning',
          line: 1,
          column: 1,
          message: `Command '\\${command}' requires package '${requiredPackage}'`,
          suggestion: `Add \\usepackage{${requiredPackage}} to your preamble`
        });
      }
    }
    
    return issues;
  }

  /**
   * Check line length
   */
  async checkLineLength(content, lines, options = {}) {
    const issues = [];
    const maxLength = options.maxLineLength || 80;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > maxLength) {
        issues.push({
          rule: 'line_length',
          severity: 'warning',
          line: i + 1,
          column: maxLength + 1,
          message: `Line ${i + 1} is ${line.length} characters long (max: ${maxLength})`,
          suggestion: 'Consider breaking the line or using shorter variable names'
        });
      }
    }
    
    return issues;
  }

  /**
   * Check for trailing whitespace
   */
  async checkTrailingWhitespace(content, lines, options = {}) {
    const issues = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.endsWith(' ') || line.endsWith('\t')) {
        issues.push({
          rule: 'trailing_whitespace',
          severity: 'info',
          line: i + 1,
          column: line.length,
          message: `Line ${i + 1} has trailing whitespace`,
          suggestion: 'Remove trailing spaces and tabs'
        });
      }
    }
    
    return issues;
  }

  /**
   * Check for excessive empty lines
   */
  async checkEmptyLines(content, lines, options = {}) {
    const issues = [];
    const maxEmptyLines = options.maxEmptyLines || 2;
    let consecutiveEmptyLines = 0;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (line.trim() === '') {
        consecutiveEmptyLines++;
      } else {
        if (consecutiveEmptyLines > maxEmptyLines) {
          issues.push({
            rule: 'empty_lines',
            severity: 'info',
            line: i - consecutiveEmptyLines + 1,
            column: 1,
            message: `${consecutiveEmptyLines} consecutive empty lines (max: ${maxEmptyLines})`,
            suggestion: 'Reduce the number of empty lines'
          });
        }
        consecutiveEmptyLines = 0;
      }
    }
    
    return issues;
  }

  /**
   * Check for missing captions
   */
  async checkMissingCaptions(content, lines, options = {}) {
    const issues = [];
    const figureRegex = /\\begin\{figure\}/g;
    const tableRegex = /\\begin\{table\}/g;
    
    let match;
    while ((match = figureRegex.exec(content)) !== null) {
      const figureStart = match.index;
      const figureEnd = content.indexOf('\\end{figure}', figureStart);
      
      if (figureEnd !== -1) {
        const figureContent = content.substring(figureStart, figureEnd);
        if (!figureContent.includes('\\caption{')) {
          const lineNumber = content.substring(0, figureStart).split('\n').length;
          issues.push({
            rule: 'missing_captions',
            severity: 'warning',
            line: lineNumber,
            column: 1,
            message: 'Figure without caption',
            suggestion: 'Add \\caption{...} to describe the figure'
          });
        }
      }
    }
    
    while ((match = tableRegex.exec(content)) !== null) {
      const tableStart = match.index;
      const tableEnd = content.indexOf('\\end{table}', tableStart);
      
      if (tableEnd !== -1) {
        const tableContent = content.substring(tableStart, tableEnd);
        if (!tableContent.includes('\\caption{')) {
          const lineNumber = content.substring(0, tableStart).split('\n').length;
          issues.push({
            rule: 'missing_captions',
            severity: 'warning',
            line: lineNumber,
            column: 1,
            message: 'Table without caption',
            suggestion: 'Add \\caption{...} to describe the table'
          });
        }
      }
    }
    
    return issues;
  }

  /**
   * Check for missing labels
   */
  async checkMissingLabels(content, lines, options = {}) {
    const issues = [];
    const figureRegex = /\\begin\{figure\}/g;
    const tableRegex = /\\begin\{table\}/g;
    const sectionRegex = /\\section\{[^}]+\}/g;
    
    let match;
    while ((match = figureRegex.exec(content)) !== null) {
      const figureStart = match.index;
      const figureEnd = content.indexOf('\\end{figure}', figureStart);
      
      if (figureEnd !== -1) {
        const figureContent = content.substring(figureStart, figureEnd);
        if (!figureContent.includes('\\label{')) {
          const lineNumber = content.substring(0, figureStart).split('\n').length;
          issues.push({
            rule: 'missing_labels',
            severity: 'info',
            line: lineNumber,
            column: 1,
            message: 'Figure without label',
            suggestion: 'Add \\label{fig:...} for referencing'
          });
        }
      }
    }
    
    while ((match = tableRegex.exec(content)) !== null) {
      const tableStart = match.index;
      const tableEnd = content.indexOf('\\end{table}', tableStart);
      
      if (tableEnd !== -1) {
        const tableContent = content.substring(tableStart, tableEnd);
        if (!tableContent.includes('\\label{')) {
          const lineNumber = content.substring(0, tableStart).split('\n').length;
          issues.push({
            rule: 'missing_labels',
            severity: 'info',
            line: lineNumber,
            column: 1,
            message: 'Table without label',
            suggestion: 'Add \\label{tab:...} for referencing'
          });
        }
      }
    }
    
    while ((match = sectionRegex.exec(content)) !== null) {
      const sectionStart = match.index;
      const nextSection = content.indexOf('\\section{', sectionStart + 1);
      const sectionEnd = nextSection !== -1 ? nextSection : content.length;
      const sectionContent = content.substring(sectionStart, sectionEnd);
      
      if (!sectionContent.includes('\\label{')) {
        const lineNumber = content.substring(0, sectionStart).split('\n').length;
        issues.push({
          rule: 'missing_labels',
          severity: 'info',
          line: lineNumber,
          column: 1,
          message: 'Section without label',
          suggestion: 'Add \\label{sec:...} for referencing'
        });
      }
    }
    
    return issues;
  }

  /**
   * Check for unused labels
   */
  async checkUnusedLabels(content, lines, options = {}) {
    const issues = [];
    const labels = new Set();
    const references = new Set();
    
    // Extract all labels
    const labelRegex = /\\label\{([^}]+)\}/g;
    let match;
    while ((match = labelRegex.exec(content)) !== null) {
      labels.add(match[1]);
    }
    
    // Extract all references
    const refRegex = /\\ref\{([^}]+)\}/g;
    while ((match = refRegex.exec(content)) !== null) {
      references.add(match[1]);
    }
    
    // Find unused labels
    for (const label of labels) {
      if (!references.has(label)) {
        const labelMatch = content.match(new RegExp(`\\\\label\\{${label}\\}`));
        if (labelMatch) {
          const lineNumber = content.substring(0, labelMatch.index).split('\n').length;
          issues.push({
            rule: 'unused_labels',
            severity: 'warning',
            line: lineNumber,
            column: 1,
            message: `Unused label '${label}'`,
            suggestion: 'Remove the label or add a reference to it'
          });
        }
      }
    }
    
    return issues;
  }

  /**
   * Check for missing citations
   */
  async checkMissingCitations(content, lines, options = {}) {
    const issues = [];
    const citationKeywords = [
      'according to', 'states that', 'shows that', 'demonstrates',
      'research', 'study', 'paper', 'article', 'journal',
      'found that', 'concluded', 'suggested', 'indicated'
    ];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineLower = line.toLowerCase();
      
      for (const keyword of citationKeywords) {
        if (lineLower.includes(keyword) && !line.includes('\\cite{')) {
          issues.push({
            rule: 'missing_citations',
            severity: 'info',
            line: i + 1,
            column: 1,
            message: `Potential missing citation for '${keyword}'`,
            suggestion: 'Consider adding a citation with \\cite{...}'
          });
          break; // Only one suggestion per line
        }
      }
    }
    
    return issues;
  }

  /**
   * Check for hardcoded references
   */
  async checkHardcodedReferences(content, lines, options = {}) {
    const issues = [];
    const hardcodedPatterns = [
      /Section \d+/g,
      /Figure \d+/g,
      /Table \d+/g,
      /Chapter \d+/g
    ];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const pattern of hardcodedPatterns) {
        const matches = line.match(pattern);
        if (matches) {
          for (const match of matches) {
            issues.push({
              rule: 'hardcoded_references',
              severity: 'warning',
              line: i + 1,
              column: line.indexOf(match) + 1,
              message: `Hardcoded reference '${match}'`,
              suggestion: 'Use \\ref{...} or \\autoref{...} for automatic referencing'
            });
          }
        }
      }
    }
    
    return issues;
  }

  /**
   * Check for inconsistent spacing
   */
  async checkInconsistentSpacing(content, lines, options = {}) {
    const issues = [];
    const spacingPatterns = [
      { pattern: /\\[a-zA-Z]+\s*\{/g, message: 'Inconsistent spacing before opening brace' },
      { pattern: /\}\s*\\[a-zA-Z]+/g, message: 'Inconsistent spacing after closing brace' }
    ];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const { pattern, message } of spacingPatterns) {
        const matches = line.match(pattern);
        if (matches) {
          for (const match of matches) {
            issues.push({
              rule: 'inconsistent_spacing',
              severity: 'info',
              line: i + 1,
              column: line.indexOf(match) + 1,
              message: message,
              suggestion: 'Use consistent spacing around LaTeX commands'
            });
          }
        }
      }
    }
    
    return issues;
  }

  /**
   * Check for deprecated commands
   */
  async checkDeprecatedCommands(content, lines, options = {}) {
    const issues = [];
    const deprecatedCommands = {
      '\\bf': '\\textbf{}',
      '\\it': '\\textit{}',
      '\\rm': '\\textrm{}',
      '\\sl': '\\textsl{}',
      '\\sc': '\\textsc{}',
      '\\tt': '\\texttt{}',
      '\\em': '\\emph{}'
    };
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      for (const [deprecated, replacement] of Object.entries(deprecatedCommands)) {
        if (line.includes(deprecated)) {
          issues.push({
            rule: 'deprecated_commands',
            severity: 'warning',
            line: i + 1,
            column: line.indexOf(deprecated) + 1,
            message: `Deprecated command '${deprecated}'`,
            suggestion: `Use '${replacement}' instead`
          });
        }
      }
    }
    
    return issues;
  }

  /**
   * Generate summary of issues
   */
  generateSummary(issues) {
    const summary = {
      total: issues.length,
      errors: 0,
      warnings: 0,
      info: 0,
      byRule: {}
    };
    
    for (const issue of issues) {
      summary[issue.severity]++;
      
      if (!summary.byRule[issue.rule]) {
        summary.byRule[issue.rule] = 0;
      }
      summary.byRule[issue.rule]++;
    }
    
    return summary;
  }

  /**
   * Get available rules
   */
  getAvailableRules() {
    const rules = Array.from(this.rules.entries()).map(([id, rule]) => ({
      id,
      name: rule.name,
      severity: rule.severity,
      description: rule.description
    }));
    
    return {
      success: true,
      rules,
      totalRules: rules.length
    };
  }

  /**
   * Fix issues automatically
   */
  async fixIssues(projectId, issues, options = {}) {
    try {
      const projectPath = path.resolve(process.cwd(), getProjectPath(undefined, projectId));
      const mainTexPath = path.join(projectPath, 'main.tex');
      
      // Read document content
      let content = await fs.readFile(mainTexPath, 'utf-8');
      const lines = content.split('\n');
      
      const fixes = [];
      const fixedContent = [...lines];
      
      // Apply fixes
      for (const issue of issues) {
        if (options.autoFix && this.canAutoFix(issue)) {
          const fix = this.applyFix(issue, fixedContent);
          if (fix) {
            fixes.push(fix);
          }
        }
      }
      
      // Write fixed content
      if (fixes.length > 0) {
        const backupPath = mainTexPath + '.backup';
        await fs.copyFile(mainTexPath, backupPath);
        await fs.writeFile(mainTexPath, fixedContent.join('\n'), 'utf-8');
      }
      
      return {
        success: true,
        fixes,
        totalFixes: fixes.length,
        backupPath: fixes.length > 0 ? mainTexPath + '.backup' : null
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check if issue can be auto-fixed
   */
  canAutoFix(issue) {
    const autoFixableRules = [
      'trailing_whitespace',
      'empty_lines',
      'inconsistent_spacing',
      'deprecated_commands'
    ];
    
    return autoFixableRules.includes(issue.rule);
  }

  /**
   * Apply fix to content
   */
  applyFix(issue, lines) {
    const lineIndex = issue.line - 1;
    if (lineIndex < 0 || lineIndex >= lines.length) {
      return null;
    }
    
    const originalLine = lines[lineIndex];
    let fixedLine = originalLine;
    
    switch (issue.rule) {
      case 'trailing_whitespace':
        fixedLine = originalLine.replace(/\s+$/, '');
        break;
      case 'empty_lines':
        // This would be handled in a separate pass
        break;
      case 'inconsistent_spacing':
        fixedLine = originalLine
          .replace(/\\[a-zA-Z]+\s*\{/g, match => match.replace(/\s+/, ''))
          .replace(/\}\s*\\[a-zA-Z]+/g, match => match.replace(/\s+/, ''));
        break;
      case 'deprecated_commands':
        const deprecatedMap = {
          '\\bf': '\\textbf{',
          '\\it': '\\textit{',
          '\\rm': '\\textrm{',
          '\\sl': '\\textsl{',
          '\\sc': '\\textsc{',
          '\\tt': '\\texttt{',
          '\\em': '\\emph{'
        };
        
        for (const [deprecated, replacement] of Object.entries(deprecatedMap)) {
          fixedLine = fixedLine.replace(new RegExp(deprecated, 'g'), replacement);
        }
        break;
    }
    
    if (fixedLine !== originalLine) {
      lines[lineIndex] = fixedLine;
      return {
        rule: issue.rule,
        line: issue.line,
        original: originalLine,
        fixed: fixedLine
      };
    }
    
    return null;
  }

  /**
   * Export linting report
   */
  async exportReport(issues, format = 'json') {
    try {
      switch (format) {
        case 'json':
          return {
            success: true,
            content: JSON.stringify(issues, null, 2),
            mimeType: 'application/json'
          };
        case 'html':
          return {
            success: true,
            content: this.generateHTMLReport(issues),
            mimeType: 'text/html'
          };
        case 'txt':
          return {
            success: true,
            content: this.generateTextReport(issues),
            mimeType: 'text/plain'
          };
        default:
          throw new Error(`Unsupported format: ${format}`);
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate HTML report
   */
  generateHTMLReport(issues) {
    const summary = this.generateSummary(issues);
    
    return `<!DOCTYPE html>
<html>
<head>
    <title>LaTeX Linting Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 40px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; }
        .issue { padding: 10px; margin: 10px 0; border-radius: 3px; }
        .error { background: #f8d7da; border-left: 4px solid #dc3545; }
        .warning { background: #fff3cd; border-left: 4px solid #ffc107; }
        .info { background: #d1ecf1; border-left: 4px solid #17a2b8; }
        .severity { font-weight: bold; }
    </style>
</head>
<body>
    <div class="header">
        <h1>LaTeX Linting Report</h1>
        <p>Total Issues: ${summary.total}</p>
        <p>Errors: <span class="severity">${summary.errors}</span></p>
        <p>Warnings: <span class="severity">${summary.warnings}</span></p>
        <p>Info: <span class="severity">${summary.info}</span></p>
    </div>
    
    <div class="issues">
        ${issues.map(issue => `
            <div class="issue ${issue.severity}">
                <h3>Line ${issue.line}: ${issue.message}</h3>
                <p><strong>Rule:</strong> ${issue.rule}</p>
                <p><strong>Severity:</strong> ${issue.severity}</p>
                <p><strong>Suggestion:</strong> ${issue.suggestion}</p>
            </div>
        `).join('')}
    </div>
</body>
</html>`;
  }

  /**
   * Generate text report
   */
  generateTextReport(issues) {
    const summary = this.generateSummary(issues);
    let report = `LaTeX Linting Report\n`;
    report += `==================\n\n`;
    report += `Total Issues: ${summary.total}\n`;
    report += `Errors: ${summary.errors}\n`;
    report += `Warnings: ${summary.warnings}\n`;
    report += `Info: ${summary.info}\n\n`;
    
    for (const issue of issues) {
      report += `Line ${issue.line}: ${issue.message}\n`;
      report += `  Rule: ${issue.rule}\n`;
      report += `  Severity: ${issue.severity}\n`;
      report += `  Suggestion: ${issue.suggestion}\n\n`;
    }
    
    return report;
  }
}
