// SPDX-License-Identifier: MIT

/**
 * Determine if error needs AI fix (complex) or can use quick fix (simple)
 * @param {Object} error - Error object in unified format
 * @returns {boolean} True if error needs AI, false if quick fix available
 */
export function needsAIFix(error) {
  // Simple errors can use quick fixes
  const simpleCategories = ['brace', 'syntax', 'missing-package', 'environment', 'math-mode'];
  if (simpleCategories.includes(error.category)) {
    return false;
  }
  
  // Complex errors need AI
  return true;
}

/**
 * Get quick fixes for an error
 * @param {Object} error - Error object in unified format
 * @param {string} code - Full file content
 * @param {number} lineNumber - Line number where error occurs
 * @param {Object} model - Monaco editor model (for URI)
 * @returns {Array} Array of Monaco CodeAction objects
 */
export function getQuickFixes(error, code, lineNumber, model) {
  const fixes = [];
  const lines = code.split('\n');
  const lineContent = lines[lineNumber - 1] || '';
  
  if (!error.category) return fixes;
  
  switch (error.category) {
    case 'brace': {
      // Missing closing brace
      if (error.message.includes('Missing') || error.message.includes('missing')) {
        // Find where to add the brace
        let insertColumn = lineContent.length + 1;
        
        // If error has column info, use it
        if (error.column) {
          insertColumn = error.endColumn || error.column + (error.text?.length || 0);
        } else {
          // Try to find the last opening brace
          const lastOpenBrace = lineContent.lastIndexOf('{');
          if (lastOpenBrace !== -1) {
            insertColumn = lastOpenBrace + 2; // After the opening brace
          }
        }
        
        fixes.push({
          title: 'Add missing closing brace }',
          kind: 'quickfix',
          isPreferred: true,
          edit: {
            edits: [{
              resource: model.uri,
              edit: {
                range: {
                  startLineNumber: lineNumber,
                  startColumn: insertColumn,
                  endLineNumber: lineNumber,
                  endColumn: insertColumn
                },
                text: '}'
              }
            }]
          }
        });
      }
      break;
    }
    
    case 'missing-package': {
      // Add \usepackage{package}
      const packageName = error.missingPackage || extractPackageName(error.message);
      if (packageName) {
        // Find where to add \usepackage (after \documentclass, before \begin{document})
        let insertLine = 1;
        let insertColumn = 1;
        
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('\\documentclass')) {
            insertLine = i + 1;
            insertColumn = lines[i].length + 1;
            break;
          }
        }
        
        // If we found \documentclass, insert after it
        // Otherwise insert at the beginning
        const packageLine = `\\usepackage{${packageName}}\n`;
        
        fixes.push({
          title: `Add \\usepackage{${packageName}}`,
          kind: 'quickfix',
          isPreferred: true,
          edit: {
            edits: [{
              resource: model.uri,
              edit: {
                range: {
                  startLineNumber: insertLine,
                  startColumn: insertColumn,
                  endLineNumber: insertLine,
                  endColumn: insertColumn
                },
                text: packageLine
              }
            }]
          }
        });
      }
      break;
    }
    
    case 'syntax': {
      // Common typos
      if (error.text && error.quickFix) {
        const fix = error.quickFix;
        if (fix.type === 'replace' && fix.text) {
          fixes.push({
            title: `Fix typo: ${error.text} → ${fix.text}`,
            kind: 'quickfix',
            isPreferred: true,
            edit: {
              edits: [{
                resource: model.uri,
                edit: {
                  range: {
                    startLineNumber: fix.range.startLine,
                    startColumn: fix.range.startColumn,
                    endLineNumber: fix.range.endLine,
                    endColumn: fix.range.endColumn
                  },
                  text: fix.text
                }
              }]
            }
          });
        }
      }
      
      // Missing closing brace for command
      if (error.message.includes('Missing closing brace')) {
        const commandMatch = lineContent.match(/\\([a-zA-Z@]+)\{/);
        if (commandMatch) {
          const commandEnd = lineContent.lastIndexOf(commandMatch[0]) + commandMatch[0].length;
          fixes.push({
            title: `Add closing brace for \\${commandMatch[1]}`,
            kind: 'quickfix',
            isPreferred: true,
            edit: {
              edits: [{
                resource: model.uri,
                edit: {
                  range: {
                    startLineNumber: lineNumber,
                    startColumn: lineContent.length + 1,
                    endLineNumber: lineNumber,
                    endColumn: lineContent.length + 1
                  },
                  text: '}'
                }
              }]
            }
          });
        }
      }
      break;
    }
    
    case 'environment': {
      // Missing \end{env}
      if (error.message.includes('Missing \\end')) {
        const envMatch = error.message.match(/Missing \\end\{([^}]+)\}/);
        if (envMatch) {
          const envName = envMatch[1];
          
          // Find where to add \end (at end of file or after content)
          let insertLine = lines.length;
          let insertColumn = 1;
          
          // Try to find matching \begin to determine where \end should go
          let beginLine = error.line;
          if (beginLine) {
            // Look for the end of the environment content
            // Simple heuristic: add before next \begin or at end
            for (let i = beginLine; i < lines.length; i++) {
              if (lines[i].includes(`\\begin{`) && !lines[i].includes(`\\begin{${envName}}`)) {
                insertLine = i;
                break;
              }
            }
          }
          
          const endLine = `\\end{${envName}}\n`;
          
          fixes.push({
            title: `Add \\end{${envName}}`,
            kind: 'quickfix',
            isPreferred: true,
            edit: {
              edits: [{
                resource: model.uri,
                edit: {
                  range: {
                    startLineNumber: insertLine,
                    startColumn: insertColumn,
                    endLineNumber: insertLine,
                    endColumn: insertColumn
                  },
                  text: endLine
                }
              }]
            }
          });
        }
      }
      
      // Extra \end
      if (error.message.includes("Extra \\end")) {
        const envMatch = error.message.match(/Extra \\end\{([^}]+)\}/);
        if (envMatch && error.line) {
          fixes.push({
            title: `Remove extra \\end{${envMatch[1]}}`,
            kind: 'quickfix',
            isPreferred: true,
            edit: {
              edits: [{
                resource: model.uri,
                edit: {
                  range: {
                    startLineNumber: error.line,
                    startColumn: error.column || 1,
                    endLineNumber: error.line,
                    endColumn: error.endColumn || lineContent.length + 1
                  },
                  text: ''
                }
              }]
            }
          });
        }
      }
      break;
    }
    
    case 'math-mode': {
      // Missing closing $
      if (error.message.includes('Unclosed math mode') || error.message.includes('missing closing $')) {
        fixes.push({
          title: 'Add closing $',
          kind: 'quickfix',
          isPreferred: true,
          edit: {
            edits: [{
              resource: model.uri,
              edit: {
                range: {
                  startLineNumber: lineNumber,
                  startColumn: lineContent.length + 1,
                  endLineNumber: lineNumber,
                  endColumn: lineContent.length + 1
                },
                text: '$'
              }
            }]
          }
        });
      }
      break;
    }
    
    case 'citation': {
      // Missing citation - offer to remove \cite{} or add to .bib
      if (error.message.includes("didn't find a database entry")) {
        // Match citation key: double-quoted "key", single-quoted 'key', or "for key" / "entry for key"
        const keyMatch =
          error.message.match(/"([^"]+)"/) ||
          error.message.match(/'([^']+)'/) ||
          error.message.match(/(?:database\s+entry\s+)?for\s+["']?([a-zA-Z0-9_:\-]+)["']?/i);
        if (keyMatch) {
          const citationKey = keyMatch[1];
          
          // Option 1: Remove citation (require line; text or column range for precise highlight)
          if (error.line && (error.text || error.column != null)) {
            fixes.push({
              title: `Remove \\cite{${citationKey}}`,
              kind: 'quickfix',
              edit: {
                edits: [{
                  resource: model.uri,
                  edit: {
                    range: {
                      startLineNumber: error.line,
                      startColumn: error.column || 1,
                      endLineNumber: error.line,
                      endColumn: error.endColumn || lineContent.length + 1
                    },
                    text: ''
                  }
                }]
              }
            });
          }
        }
      }
      break;
    }
  }
  
  return fixes;
}

/**
 * Extract package name from error message
 * @param {string} message - Error message
 * @returns {string|null} Package name or null
 */
function extractPackageName(message) {
  const patterns = [
    /Missing package:\s*([a-zA-Z0-9_-]+)/i,
    /package\s+([a-zA-Z0-9_-]+)\s+not found/i,
    /File\s+([a-zA-Z0-9_-]+)\.sty/i
  ];
  
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  
  return null;
}
