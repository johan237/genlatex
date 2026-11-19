// SPDX-License-Identifier: MIT

/**
 * Correlate errors to find relationships and group them
 * @param {Array<Object>} errors - Array of error objects in unified format
 * @returns {Array<Object>} Array of error groups with primary and related errors
 */
export function correlateErrors(errors) {
  if (!errors || errors.length === 0) return [];
  
  const groups = [];
  const processed = new Set();
  
  errors.forEach(error => {
    if (processed.has(error.id)) return;
    
    const group = {
      id: `group-${error.id}`,
      primary: error,
      related: [],
      rootCause: determineRootCause(error),
      fixAction: null
    };
    
    // Find related errors
    errors.forEach(other => {
      if (other.id !== error.id && !processed.has(other.id) && areRelated(error, other)) {
        group.related.push(other);
        processed.add(other.id);
      }
    });
    
    // Determine fix action if applicable
    if (group.rootCause === 'missing-package' && group.primary.missingPackage) {
      group.fixAction = `Add \\usepackage{${group.primary.missingPackage}}`;
    } else if (group.rootCause === 'citation' && group.related.length > 0) {
      group.fixAction = 'Fix bibliography file';
    }
    
    groups.push(group);
    processed.add(error.id);
  });
  
  return groups;
}

/**
 * Determine if two errors are related
 * @param {Object} error1 - First error
 * @param {Object} error2 - Second error
 * @returns {boolean} True if errors are related
 */
function areRelated(error1, error2) {
  // Same category and nearby lines in same file
  if (error1.category === error2.category && 
      error1.file === error2.file &&
      error1.line && error2.line &&
      Math.abs(error1.line - error2.line) < 10) {
    return true;
  }
  
  // Missing package causes multiple undefined commands
  if (error1.category === 'missing-package' && 
      error2.category === 'syntax' &&
      error2.message && error2.message.includes('undefined')) {
    return true;
  }
  
  // Multiple undefined commands from same missing package
  if (error1.category === 'syntax' && error2.category === 'syntax' &&
      error1.message && error1.message.includes('undefined') &&
      error2.message && error2.message.includes('undefined') &&
      error1.file === error2.file) {
    // Check if they're from same package (heuristic)
    const cmd1 = extractCommand(error1.message);
    const cmd2 = extractCommand(error2.message);
    if (cmd1 && cmd2 && areFromSamePackage(cmd1, cmd2)) {
      return true;
    }
  }
  
  // Citation errors in same file or related
  if (error1.category === 'citation' && error2.category === 'citation') {
    // Same file or both missing citations
    if (error1.file === error2.file || 
        (error1.message.includes("didn't find") && error2.message.includes("didn't find"))) {
      return true;
    }
  }
  
  // Environment errors (mismatched begin/end)
  if (error1.category === 'environment' && error2.category === 'environment' &&
      error1.file === error2.file &&
      error1.line && error2.line &&
      Math.abs(error1.line - error2.line) < 20) {
    return true;
  }
  
  // Brace errors in same area
  if (error1.category === 'brace' && error2.category === 'brace' &&
      error1.file === error2.file &&
      error1.line && error2.line &&
      Math.abs(error1.line - error2.line) < 5) {
    return true;
  }
  
  return false;
}

/**
 * Determine root cause of an error group
 * @param {Object} error - Primary error
 * @returns {string} Root cause category
 */
function determineRootCause(error) {
  // Missing package is often a root cause
  if (error.category === 'missing-package') {
    return 'missing-package';
  }
  
  // Citation errors often stem from .bib file issues
  if (error.category === 'citation') {
    return 'citation';
  }
  
  // Multiple syntax errors might be from missing package
  if (error.category === 'syntax' && error.message && error.message.includes('undefined')) {
    return 'missing-package';
  }
  
  // Environment errors are usually syntax issues
  if (error.category === 'environment') {
    return 'environment';
  }
  
  // Brace errors are syntax issues
  if (error.category === 'brace') {
    return 'brace';
  }
  
  // Default to general syntax
  return 'syntax';
}

/**
 * Extract command name from error message
 * @param {string} message - Error message
 * @returns {string|null} Command name or null
 */
function extractCommand(message) {
  const match = message.match(/undefined control sequence.*?\\([a-zA-Z@]+)/i);
  if (match) {
    return match[1];
  }
  return null;
}

/**
 * Check if two commands are likely from the same package
 * @param {string} cmd1 - First command
 * @param {string} cmd2 - Second command
 * @returns {boolean} True if likely from same package
 */
function areFromSamePackage(cmd1, cmd2) {
  // Common package prefixes
  const packagePrefixes = {
    'ams': ['frac', 'align', 'equation', 'matrix'],
    'graphicx': ['includegraphics', 'resizebox'],
    'hyperref': ['href', 'url', 'hyperref'],
    'tikz': ['tikzpicture', 'draw', 'node'],
    'pgfplots': ['pgfplotstableread', 'addplot']
  };
  
  for (const [prefix, commands] of Object.entries(packagePrefixes)) {
    if (commands.includes(cmd1.toLowerCase()) && commands.includes(cmd2.toLowerCase())) {
      return true;
    }
  }
  
  // If commands share common prefix, likely same package
  const prefix1 = cmd1.substring(0, 3).toLowerCase();
  const prefix2 = cmd2.substring(0, 3).toLowerCase();
  if (prefix1 === prefix2) {
    return true;
  }
  
  return false;
}

/**
 * Flatten error groups back to array of errors (for backward compatibility)
 * @param {Array<Object>} groups - Array of error groups
 * @returns {Array<Object>} Flattened array with group metadata
 */
export function flattenErrorGroups(groups) {
  const flattened = [];
  
  groups.forEach(group => {
    // Add primary error with group info
    flattened.push({
      ...group.primary,
      groupId: group.id,
      isPrimary: true,
      relatedCount: group.related.length,
      rootCause: group.rootCause,
      fixAction: group.fixAction
    });
    
    // Add related errors with group info
    group.related.forEach(related => {
      flattened.push({
        ...related,
        groupId: group.id,
        isPrimary: false,
        primaryErrorId: group.primary.id,
        rootCause: group.rootCause
      });
    });
  });
  
  return flattened;
}
