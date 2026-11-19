// SPDX-License-Identifier: MIT

/**
 * Get AI-powered fix for an error
 * @param {Object} error - Error object in unified format
 * @param {string} code - Full file content
 * @param {Object} context - Additional context
 * @param {string} context.projectId - Project ID
 * @param {string} context.filePath - File path
 * @param {Array} context.relatedErrors - Related errors for context
 * @param {Object} modelUri - Monaco model URI object
 * @returns {Promise<Object>} AI fix as Monaco CodeAction object
 */
export async function getAIFix(error, code, context = {}, modelUri = null) {
  const { projectId, filePath, relatedErrors = [] } = context;
  
  if (!projectId) {
    throw new Error('Project ID is required for AI fixes');
  }
  
  // Build prompt with error context
  const prompt = buildErrorFixPrompt(error, code, context);
  
  try {
    // Call existing AI assistant API
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        projectId: projectId,
        message: prompt,
        mode: 'execute', // Use execute mode for code fixes
        context: {
          action: 'fix_latex_error',
          error: error,
          code: code,
          filePath: filePath,
          relatedErrors: relatedErrors
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`AI API returned ${response.status}`);
    }
    
    const data = await response.json();
    
    // Parse AI response to extract fix
    const fix = parseAIResponseToFix(data, error, code);
    
    return fix;
  } catch (error) {
    console.error('❌ Error calling AI fix API:', error);
    throw error;
  }
}

/**
 * Build error fix prompt for AI
 * @param {Object} error - Error object
 * @param {string} code - File content
 * @param {Object} context - Additional context
 * @returns {string} Prompt string
 */
function buildErrorFixPrompt(error, code, context) {
  const { filePath, relatedErrors = [] } = context;
  
  let prompt = `Fix the following LaTeX error:\n\n`;
  prompt += `Error: ${error.message}\n`;
  prompt += `Category: ${error.category || 'unknown'}\n`;
  prompt += `Engine: ${error.engine || 'unknown'}\n`;
  
  if (error.line) {
    prompt += `Line: ${error.line}\n`;
  }
  
  if (error.file) {
    prompt += `File: ${error.file}\n`;
  }
  
  if (error.text) {
    prompt += `Problematic text: ${error.text}\n`;
  }
  
  if (error.context && error.context.length > 0) {
    prompt += `\nContext (surrounding lines):\n`;
    error.context.forEach((line, idx) => {
      prompt += `${line}\n`;
    });
  }
  
  if (relatedErrors.length > 0) {
    prompt += `\nRelated errors:\n`;
    relatedErrors.forEach((relError, idx) => {
      prompt += `${idx + 1}. ${relError.message} (line ${relError.line || '?'})\n`;
    });
  }
  
  prompt += `\nFull file content:\n\`\`\`latex\n${code}\n\`\`\`\n\n`;
  prompt += `Please provide a fix for this error. Return ONLY the fixed code section (or the full file if needed), wrapped in \`\`\`latex code blocks. `;
  prompt += `If you need to modify multiple locations, provide the complete fixed file. `;
  prompt += `Include a brief explanation of what was fixed.`;
  
  return prompt;
}

/**
 * Parse AI response to extract fix
 * @param {Object} data - AI API response
 * @param {Object} error - Original error
 * @param {string} code - Original code
 * @returns {Object} Monaco CodeAction object
 */
function parseAIResponseToFix(data, error, code) {
  // Extract code from AI response
  let fixedCode = null;
  let explanation = '';
  
  // Try to extract code from response
  if (data.code) {
    fixedCode = data.code;
  } else if (data.content) {
    // Try to extract code blocks
    const codeBlockMatch = data.content.match(/```(?:latex)?\n([\s\S]*?)```/);
    if (codeBlockMatch) {
      fixedCode = codeBlockMatch[1];
    } else {
      // If no code block, try to extract explanation
      explanation = data.content;
    }
  } else if (data.message) {
    explanation = data.message;
  }
  
  // If we got fixed code, create edit
  let edit = null;
  if (fixedCode) {
    // Determine if it's a full file replacement or partial fix
    const lines = code.split('\n');
    const fixedLines = fixedCode.split('\n');
    
    if (fixedLines.length >= lines.length * 0.8) {
      // Full file replacement
      edit = {
        edits: [{
          resource: { path: error.file || 'main.tex' },
          edit: {
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: lines.length,
              endColumn: lines[lines.length - 1].length + 1
            },
            text: fixedCode
          }
        }]
      };
    } else if (error.line) {
      // Partial fix around error line
      const startLine = Math.max(1, error.line - 5);
      const endLine = Math.min(lines.length, error.line + 5);
      
      edit = {
        edits: [{
          resource: { path: error.file || 'main.tex' },
          edit: {
            range: {
              startLineNumber: startLine,
              startColumn: 1,
              endLineNumber: endLine,
              endColumn: lines[endLine - 1].length + 1
            },
            text: fixedCode
          }
        }]
      };
    }
  }
  
  return {
    title: 'AI Smart Fix',
    kind: 'quickfix',
    isPreferred: false,
    description: explanation || 'AI-powered fix for this error',
    edit: edit,
    diagnostics: [error]
  };
}

/**
 * Get batch AI fixes for multiple errors
 * @param {Array<Object>} errors - Array of error objects
 * @param {string} code - Full file content
 * @param {Object} context - Additional context
 * @returns {Promise<Object>} Batch fix with all edits
 */
export async function getBatchAIFixes(errors, code, context = {}) {
  if (errors.length === 0) {
    return null;
  }
  
  // Build batch prompt
  let prompt = `Fix the following ${errors.length} LaTeX error(s):\n\n`;
  
  errors.forEach((error, idx) => {
    prompt += `Error ${idx + 1}:\n`;
    prompt += `  Message: ${error.message}\n`;
    prompt += `  Category: ${error.category || 'unknown'}\n`;
    if (error.line) {
      prompt += `  Line: ${error.line}\n`;
    }
    if (error.text) {
      prompt += `  Text: ${error.text}\n`;
    }
    prompt += `\n`;
  });
  
  prompt += `\nFull file content:\n\`\`\`latex\n${code}\n\`\`\`\n\n`;
  prompt += `Please provide a fix for all errors. Return the complete fixed file wrapped in \`\`\`latex code blocks.`;
  
  try {
    const response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        projectId: context.projectId,
        message: prompt,
        mode: 'execute',
        context: {
          action: 'fix_latex_errors_batch',
          errors: errors,
          code: code,
          filePath: context.filePath
        }
      })
    });
    
    if (!response.ok) {
      throw new Error(`AI API returned ${response.status}`);
    }
    
    const data = await response.json();
    
    // Parse response
    const fixedCode = data.code || (data.content?.match(/```(?:latex)?\n([\s\S]*?)```/)?.[1]);
    
    if (!fixedCode) {
      throw new Error('No fix code found in AI response');
    }
    
    const lines = code.split('\n');
    
    return {
      title: `AI Smart Fix (${errors.length} errors)`,
      kind: 'quickfix',
      isPreferred: true,
      description: `AI-powered fix for ${errors.length} error(s)`,
      edit: {
        edits: [{
          resource: modelUri || { path: context.filePath || 'main.tex' },
          edit: {
            range: {
              startLineNumber: 1,
              startColumn: 1,
              endLineNumber: lines.length,
              endColumn: lines[lines.length - 1].length + 1
            },
            text: fixedCode
          }
        }]
      },
      diagnostics: errors
    };
  } catch (error) {
    console.error('❌ Error calling batch AI fix API:', error);
    throw error;
  }
}
