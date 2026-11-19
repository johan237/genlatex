// SPDX-License-Identifier: MIT

/**
 * Check LaTeX syntax in real-time
 * Returns errors in unified format compatible with error schema
 * @param {string} code - LaTeX code to check
 * @param {Object} options - Checking options
 * @param {string} options.file - File name (for error reporting)
 * @returns {Array} Array of error objects in unified format
 */
export function checkSyntax(code, options = {}) {
  if (!code || typeof code !== 'string') return [];
  
  const { file = null } = options;
  const errors = [];
  const lines = code.split('\n');
  
  // Track state across lines
  const state = {
    braceDepth: 0,
    environmentStack: [],
    mathModeDepth: 0, // Track $ and $$ separately
    inComment: false
  };
  
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const lineForCheck = stripInlineComment(line);
    
    // Skip empty lines
    if (!lineForCheck.trim()) return;
    
    // Check for comment lines
    if (lineForCheck.trim().startsWith('%')) {
      return;
    }
    
    // Check braces
    const braceErrors = checkBraces(lineForCheck, lineNumber, state);
    errors.push(...braceErrors);
    
    // Check environments
    const envErrors = checkEnvironments(lineForCheck, lineNumber, state);
    errors.push(...envErrors);
    
    // Check math mode
    const mathErrors = checkMathMode(lineForCheck, lineNumber, state);
    errors.push(...mathErrors);
    
    // Check common typos
    const typoErrors = checkCommonTypos(lineForCheck, lineNumber);
    errors.push(...typoErrors);
    
    // Check basic command syntax
    const commandErrors = checkCommandSyntax(lineForCheck, lineNumber);
    errors.push(...commandErrors);
  });
  
  // Check for unclosed structures at end of file
  if (state.braceDepth > 0) {
    errors.push({
      type: 'error',
      severity: 'error',
      engine: 'syntax-checker',
      message: `Missing ${state.braceDepth} closing brace(s)`,
      line: lines.length,
      file: file,
      category: 'brace',
      text: null,
      column: null,
      endColumn: null,
      context: lines.slice(Math.max(0, lines.length - 3))
    });
  }
  
  if (state.environmentStack.length > 0) {
    state.environmentStack.forEach(env => {
      errors.push({
        type: 'error',
        severity: 'error',
        engine: 'syntax-checker',
        message: `Missing \\end{${env.name}}`,
        line: env.line,
        file: file,
        category: 'environment',
        text: `\\begin{${env.name}}`,
        column: env.column,
        endColumn: env.column + env.name.length + 7,
        context: lines.slice(Math.max(0, env.line - 2), Math.min(lines.length, env.line + 2))
      });
    });
  }
  
  if (state.mathModeDepth > 0) {
    errors.push({
      type: 'error',
      severity: 'error',
      engine: 'syntax-checker',
      message: 'Unclosed math mode',
      line: lines.length,
      file: file,
      category: 'math-mode',
      text: null,
      column: null,
      endColumn: null,
      context: lines.slice(Math.max(0, lines.length - 3))
    });
  }
  
  return errors;
}

/**
 * Strip inline comments (unescaped %) for lightweight syntax checks.
 */
function stripInlineComment(line) {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '%') {
      let backslashCount = 0;
      for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) {
        backslashCount++;
      }
      if (backslashCount % 2 === 0) {
        return line.slice(0, i);
      }
    }
  }
  return line;
}

/**
 * Check for unmatched braces
 */
function checkBraces(line, lineNumber, state) {
  const errors = [];
  let localBraceDepth = state.braceDepth;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const prevChar = i > 0 ? line[i - 1] : '';
    
    // Skip escaped braces
    if (prevChar === '\\') continue;
    
    if (char === '{') {
      localBraceDepth++;
    } else if (char === '}') {
      localBraceDepth--;
      if (localBraceDepth < 0) {
        // Extra closing brace
        errors.push({
          type: 'error',
          severity: 'error',
          engine: 'syntax-checker',
          message: 'Extra closing brace }',
          line: lineNumber,
          file: null,
          category: 'brace',
          text: '}',
          column: i + 1,
          endColumn: i + 2,
          context: []
        });
        localBraceDepth = 0; // Reset to prevent cascading errors
      }
    }
  }
  
  state.braceDepth = localBraceDepth;
  return errors;
}

/**
 * Check for unmatched environments
 */
function checkEnvironments(line, lineNumber, state) {
  const errors = [];
  
  // Match \begin{env} patterns
  const beginMatches = line.matchAll(/\\begin\{([^}]+)\}/g);
  for (const match of beginMatches) {
    const envName = match[1];
    const matchIndex = match.index;
    
    state.environmentStack.push({
      name: envName,
      line: lineNumber,
      column: matchIndex + 1
    });
  }
  
  // Match \end{env} patterns
  const endMatches = line.matchAll(/\\end\{([^}]+)\}/g);
  for (const match of endMatches) {
    const envName = match[1];
    const matchIndex = match.index;
    
    if (state.environmentStack.length === 0) {
      // Extra \end without matching \begin
      errors.push({
        type: 'error',
        severity: 'error',
        engine: 'syntax-checker',
        message: `Extra \\end{${envName}} without matching \\begin`,
        line: lineNumber,
        file: null,
        category: 'environment',
        text: `\\end{${envName}}`,
        column: matchIndex + 1,
        endColumn: matchIndex + 7 + envName.length,
        context: []
      });
    } else {
      const lastEnv = state.environmentStack.pop();
      if (lastEnv.name !== envName) {
        // Mismatched environment
        errors.push({
          type: 'error',
          severity: 'error',
          engine: 'syntax-checker',
          message: `\\end{${envName}} doesn't match \\begin{${lastEnv.name}} on line ${lastEnv.line}`,
          line: lineNumber,
          file: null,
          category: 'environment',
          text: `\\end{${envName}}`,
          column: matchIndex + 1,
          endColumn: matchIndex + 7 + envName.length,
          context: []
        });
        // Push back the original begin to maintain stack
        state.environmentStack.push(lastEnv);
      }
    }
  }
  
  return errors;
}

/**
 * Check for unclosed math mode
 */
function checkMathMode(line, lineNumber, state) {
  const errors = [];
  
  // Count $ symbols (not escaped)
  const dollarMatches = line.matchAll(/(?<!\\)\$/g);
  const dollarCount = Array.from(dollarMatches).length;
  
  // Update math mode depth
  state.mathModeDepth += dollarCount;
  
  // If odd number of $, we have unclosed math mode
  if (state.mathModeDepth % 2 !== 0 && dollarCount > 0) {
    // Find the last $ on this line
    let lastDollarIndex = -1;
    for (let i = line.length - 1; i >= 0; i--) {
      if (line[i] === '$' && (i === 0 || line[i - 1] !== '\\')) {
        lastDollarIndex = i;
        break;
      }
    }
    
    if (lastDollarIndex !== -1) {
      errors.push({
        type: 'error',
        severity: 'error',
        engine: 'syntax-checker',
        message: 'Unclosed math mode (missing closing $)',
        line: lineNumber,
        file: null,
        category: 'math-mode',
        text: '$',
        column: lastDollarIndex + 1,
        endColumn: lastDollarIndex + 2,
        context: []
      });
    }
  }
  
  return errors;
}

/**
 * Check for common typos
 */
function checkCommonTypos(line, lineNumber) {
  const errors = [];
  
  // Common typo patterns
  const typoPatterns = [
    {
      pattern: /\\begsin\{/g,
      fix: '\\begin{',
      message: 'Did you mean \\begin{?'
    },
    {
      pattern: /\\begni\{/g,
      fix: '\\begin{',
      message: 'Did you mean \\begin{?'
    },
    {
      pattern: /\\edn\{/g,
      fix: '\\end{',
      message: 'Did you mean \\end{?'
    },
    {
      pattern: /\\sectoin\{/g,
      fix: '\\section{',
      message: 'Did you mean \\section{?'
    },
    {
      pattern: /\\subsectoin\{/g,
      fix: '\\subsection{',
      message: 'Did you mean \\subsection{?'
    },
    {
      pattern: /\\textbf\{/g,
      match: /\\textbf\{[^}]*$/,
      message: 'Missing closing brace for \\textbf{}'
    },
    {
      pattern: /\\textit\{/g,
      match: /\\textit\{[^}]*$/,
      message: 'Missing closing brace for \\textit{}'
    }
  ];
  
  typoPatterns.forEach(({ pattern, fix, match, message }) => {
    const matches = Array.from(line.matchAll(pattern));
    matches.forEach(matchResult => {
      const matchIndex = matchResult.index;
      const matchedText = matchResult[0];
      
      // For patterns with specific match (like unclosed commands)
      if (match && !match.test(line)) {
        return; // Pattern doesn't match the specific condition
      }
      
      errors.push({
        type: 'error',
        severity: 'warning',
        engine: 'syntax-checker',
        message: message || `Typo: ${matchedText}`,
        line: lineNumber,
        file: null,
        category: 'syntax',
        text: matchedText,
        column: matchIndex + 1,
        endColumn: matchIndex + matchedText.length + 1,
        context: [],
        quickFix: fix ? {
          type: 'replace',
          text: fix,
          range: {
            startLine: lineNumber,
            startColumn: matchIndex + 1,
            endLine: lineNumber,
            endColumn: matchIndex + matchedText.length + 1
          }
        } : null
      });
    });
  });
  
  return errors;
}

/**
 * Check basic command syntax
 */
function checkCommandSyntax(line, lineNumber) {
  const errors = [];
  
  // Check for commands with opening brace but no closing brace on same line
  const commandWithBrace = /\\[a-zA-Z@]+\{/g;
  const matches = Array.from(line.matchAll(commandWithBrace));
  
  matches.forEach(match => {
    const commandStart = match.index;
    const openBraceIndex = line.indexOf('{', commandStart);
    
    if (openBraceIndex !== -1) {
      // Check if there's a closing brace after this opening brace
      const closeBraceIndex = line.indexOf('}', openBraceIndex);
      
      if (closeBraceIndex === -1) {
        // No closing brace found on this line
        const commandMatch = line.substring(commandStart).match(/^(\\[a-zA-Z@]+)/);
        if (commandMatch) {
          errors.push({
            type: 'error',
            severity: 'warning',
            engine: 'syntax-checker',
            message: `Missing closing brace for ${commandMatch[1]}`,
            line: lineNumber,
            file: null,
            category: 'brace',
            text: commandMatch[1] + '{',
            column: commandStart + 1,
            endColumn: commandStart + commandMatch[1].length + 2,
            context: []
          });
        }
      }
    }
  });
  
  return errors;
}
