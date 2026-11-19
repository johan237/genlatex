/**
 * Chat Summary Generation Utility
 * Generates medium-detail summaries for code modifications
 */

/**
 * Generate a summary for code modifications
 * Format: "Modified `file.tex`: Added section on X"
 * 
 * @param {string[]} filesModified - Array of file paths that were modified
 * @param {string} code - The code that was modified (optional)
 * @param {string} responseText - AI response text that may contain context (optional)
 * @returns {string} Summary string
 */
export function generateCodeSummary(filesModified = [], code = '', responseText = '') {
  if (!filesModified || filesModified.length === 0) {
    return '';
  }

  // Extract file names (remove paths, keep just filename)
  const fileNames = filesModified.map(filePath => {
    // Handle both full paths and just filenames
    const parts = filePath.split('/');
    return parts[parts.length - 1];
  });

  // Try to extract meaningful action from response text
  let action = '';
  
  if (responseText) {
    // Look for common patterns in response text
    const lowerText = responseText.toLowerCase();
    
    // Check for section-related actions
    if (lowerText.includes('added section') || lowerText.includes('created section')) {
      const sectionMatch = responseText.match(/(?:added|created)\s+(?:a\s+)?section\s+(?:on\s+)?['"]?([^'"]+)['"]?/i);
      if (sectionMatch) {
        action = `Added section on ${sectionMatch[1]}`;
      } else {
        action = 'Added section';
      }
    } else if (lowerText.includes('updated section') || lowerText.includes('modified section')) {
      const sectionMatch = responseText.match(/(?:updated|modified)\s+(?:the\s+)?section\s+(?:on\s+)?['"]?([^'"]+)['"]?/i);
      if (sectionMatch) {
        action = `Updated section on ${sectionMatch[1]}`;
      } else {
        action = 'Updated section';
      }
    } else if (lowerText.includes('added citation') || lowerText.includes('added reference')) {
      const countMatch = responseText.match(/(\d+)\s+(?:citation|reference)/i);
      if (countMatch) {
        action = `Added ${countMatch[1]} citation${countMatch[1] > 1 ? 's' : ''}`;
      } else {
        action = 'Added citation';
      }
    } else if (lowerText.includes('modified') || lowerText.includes('updated')) {
      // Generic modification
      const whatMatch = responseText.match(/(?:modified|updated)\s+(?:the\s+)?([^.]+)/i);
      if (whatMatch && whatMatch[1].length < 50) {
        action = `Modified ${whatMatch[1].trim()}`;
      } else {
        action = 'Modified content';
      }
    } else if (lowerText.includes('added') || lowerText.includes('inserted')) {
      const whatMatch = responseText.match(/(?:added|inserted)\s+(?:the\s+)?([^.]+)/i);
      if (whatMatch && whatMatch[1].length < 50) {
        action = `Added ${whatMatch[1].trim()}`;
      } else {
        action = 'Added content';
      }
    } else if (lowerText.includes('removed') || lowerText.includes('deleted')) {
      const whatMatch = responseText.match(/(?:removed|deleted)\s+(?:the\s+)?([^.]+)/i);
      if (whatMatch && whatMatch[1].length < 50) {
        action = `Removed ${whatMatch[1].trim()}`;
      } else {
        action = 'Removed content';
      }
    }
  }

  // If no action extracted, try to infer from code
  if (!action && code) {
    const codeLower = code.toLowerCase();
    if (codeLower.includes('\\section{') || codeLower.includes('\\section*{')) {
      const sectionMatch = code.match(/\\section\*?\{([^}]+)\}/);
      if (sectionMatch) {
        action = `Added section on ${sectionMatch[1]}`;
      } else {
        action = 'Added section';
      }
    } else if (codeLower.includes('\\cite{') || codeLower.includes('\\citep{') || codeLower.includes('\\citet{')) {
      const citeMatches = code.match(/\\cite[pt]?\{[^}]+\}/g);
      if (citeMatches) {
        action = `Added ${citeMatches.length} citation${citeMatches.length > 1 ? 's' : ''}`;
      } else {
        action = 'Added citation';
      }
    } else if (code.length > 100) {
      // Large code block - likely significant modification
      action = 'Made significant changes';
    } else {
      action = 'Modified content';
    }
  }

  // Fallback if still no action
  if (!action) {
    action = 'Modified content';
  }

  // Build summary
  if (fileNames.length === 1) {
    return `Modified \`${fileNames[0]}\`: ${action}`;
  } else if (fileNames.length <= 3) {
    const fileList = fileNames.map(f => `\`${f}\``).join(', ');
    return `Modified ${fileList}: ${action}`;
  } else {
    const fileList = fileNames.slice(0, 2).map(f => `\`${f}\``).join(', ');
    return `Modified ${fileList} and ${fileNames.length - 2} more file${fileNames.length - 2 > 1 ? 's' : ''}: ${action}`;
  }
}

/**
 * Generate a minimal summary for tool calls
 * Format: "Searched files for 'X'"
 * 
 * @param {Array} toolCalls - Array of tool call objects
 * @returns {string} Summary string
 */
export function generateToolCallSummary(toolCalls = []) {
  if (!toolCalls || toolCalls.length === 0) {
    return '';
  }

  const summaries = toolCalls.map(call => {
    const tool = call.tool || call.function || '';
    const params = call.params || call.parameters || {};
    
    if (tool.includes('search')) {
      const query = params.query || params.search || '';
      return `Searched for '${query}'`;
    } else if (tool.includes('read') || tool.includes('file')) {
      const fileId = params.file_id || params.fileId || '';
      return `Accessed file`;
    } else if (tool.includes('list')) {
      return `Listed files`;
    } else {
      return `Executed ${tool}`;
    }
  });

  if (summaries.length === 1) {
    return summaries[0];
  } else if (summaries.length <= 3) {
    return summaries.join(', ');
  } else {
    return `${summaries.slice(0, 2).join(', ')}, and ${summaries.length - 2} more`;
  }
}
