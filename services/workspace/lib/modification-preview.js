/**
 * Modification Preview System
 * Generates diffs and estimates impact of modifications
 */

export class ModificationPreview {
  /**
   * Generate a unified diff between original and modified content
   * @param {string} original - Original content
   * @param {string} modified - Modified content
   * @param {string} filename - File name for diff header
   * @returns {string} Unified diff format
   */
  generateDiff(original, modified, filename = 'file.tex') {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');
    
    const diff = [];
    diff.push(`--- a/${filename}`);
    diff.push(`+++ b/${filename}`);
    
    // Simple line-by-line comparison
    let lineNum = 0;
    let i = 0, j = 0;
    
    while (i < originalLines.length || j < modifiedLines.length) {
      if (i >= originalLines.length) {
        // Added lines
        diff.push(`+${modifiedLines[j]}`);
        j++;
      } else if (j >= modifiedLines.length) {
        // Removed lines
        diff.push(`-${originalLines[i]}`);
        i++;
      } else if (originalLines[i] === modifiedLines[j]) {
        // Unchanged line
        diff.push(` ${originalLines[i]}`);
        i++;
        j++;
      } else {
        // Changed line - show both
        diff.push(`-${originalLines[i]}`);
        diff.push(`+${modifiedLines[j]}`);
        i++;
        j++;
      }
      
      lineNum++;
      
      // Limit diff size for performance
      if (diff.length > 1000) {
        diff.push('... (diff truncated for length)');
        break;
      }
    }
    
    return diff.join('\n');
  }

  /**
   * Estimate the impact of a modification
   * @param {string} original - Original content
   * @param {string} modified - Modified content
   * @returns {Object} Impact statistics
   */
  estimateImpact(original, modified) {
    const originalLines = original.split('\n');
    const modifiedLines = modified.split('\n');
    
    let linesAdded = 0;
    let linesRemoved = 0;
    let linesUnchanged = 0;
    let linesModified = 0;
    
    // Simple comparison
    const maxLen = Math.max(originalLines.length, modifiedLines.length);
    for (let i = 0; i < maxLen; i++) {
      const origLine = originalLines[i];
      const modLine = modifiedLines[i];
      
      if (origLine === undefined && modLine !== undefined) {
        linesAdded++;
      } else if (origLine !== undefined && modLine === undefined) {
        linesRemoved++;
      } else if (origLine === modLine) {
        linesUnchanged++;
      } else {
        linesModified++;
      }
    }
    
    const totalOriginal = originalLines.length;
    const totalModified = modifiedLines.length;
    const charsAdded = Math.max(0, modified.length - original.length);
    const charsRemoved = Math.max(0, original.length - modified.length);
    
    const deletionRatio = totalOriginal > 0 ? linesRemoved / totalOriginal : 0;
    const changeRatio = totalOriginal > 0 ? (linesAdded + linesRemoved + linesModified) / totalOriginal : 0;
    
    return {
      linesAdded,
      linesRemoved,
      linesModified,
      linesUnchanged,
      totalOriginalLines: totalOriginal,
      totalModifiedLines: totalModified,
      charsAdded,
      charsRemoved,
      originalSize: original.length,
      modifiedSize: modified.length,
      deletionRatio,
      changeRatio,
      sizeChangePercent: totalOriginal > 0 
        ? ((totalModified - totalOriginal) / totalOriginal * 100).toFixed(1)
        : 0
    };
  }

  /**
   * Determine if a modification requires user confirmation
   * @param {Object} impact - Impact statistics from estimateImpact()
   * @returns {Object} { requiresConfirmation, reason, riskLevel }
   */
  requiresConfirmation(impact) {
    const reasons = [];
    let riskLevel = 'low'; // low, medium, high, critical
    
    // Critical: More than 50 lines removed
    if (impact.linesRemoved > 50) {
      reasons.push(`Large content removal: ${impact.linesRemoved} lines deleted`);
      riskLevel = 'critical';
    }
    
    // Critical: More than 30% of content deleted
    if (impact.deletionRatio > 0.3) {
      reasons.push(`Significant deletion: ${Math.round(impact.deletionRatio * 100)}% of content removed`);
      riskLevel = 'critical';
    }
    
    // High: Document size reduced by more than 40%
    if (impact.modifiedSize < impact.originalSize * 0.6) {
      reasons.push(`Document significantly reduced: ${Math.abs(impact.sizeChangePercent)}% smaller`);
      if (riskLevel !== 'critical') riskLevel = 'high';
    }
    
    // High: More than 20% of lines changed
    if (impact.changeRatio > 0.2) {
      reasons.push(`Substantial changes: ${Math.round(impact.changeRatio * 100)}% of lines affected`);
      if (riskLevel === 'low') riskLevel = 'high';
    }
    
    // Medium: More than 100 lines changed
    if (impact.linesAdded + impact.linesRemoved + impact.linesModified > 100) {
      reasons.push(`Large modification: ${impact.linesAdded + impact.linesRemoved + impact.linesModified} lines changed`);
      if (riskLevel === 'low') riskLevel = 'medium';
    }
    
    const requiresConfirmation = reasons.length > 0;
    
    return {
      requiresConfirmation,
      reasons,
      riskLevel,
      summary: requiresConfirmation 
        ? `This modification is ${riskLevel} risk: ${reasons.join('; ')}`
        : 'This modification appears safe to apply automatically'
    };
  }

  /**
   * Generate a human-readable summary of changes
   * @param {Object} impact - Impact statistics
   * @returns {string} Summary text
   */
  generateSummary(impact) {
    const parts = [];
    
    if (impact.linesAdded > 0) {
      parts.push(`+${impact.linesAdded} line${impact.linesAdded > 1 ? 's' : ''}`);
    }
    
    if (impact.linesRemoved > 0) {
      parts.push(`-${impact.linesRemoved} line${impact.linesRemoved > 1 ? 's' : ''}`);
    }
    
    if (impact.linesModified > 0) {
      parts.push(`~${impact.linesModified} modified`);
    }
    
    const changeDesc = parts.length > 0 ? parts.join(', ') : 'No changes';
    
    const sizeChange = impact.modifiedSize - impact.originalSize;
    const sizeDesc = sizeChange > 0 
      ? `+${sizeChange} chars` 
      : sizeChange < 0 
        ? `${sizeChange} chars`
        : 'same size';
    
    return `${changeDesc} (${sizeDesc}, ${impact.totalModifiedLines} total lines)`;
  }

  /**
   * Create a preview object with all information
   * @param {string} original - Original content
   * @param {string} modified - Modified content
   * @param {string} filename - File name
   * @returns {Object} Complete preview object
   */
  createPreview(original, modified, filename = 'file.tex') {
    const impact = this.estimateImpact(original, modified);
    const confirmation = this.requiresConfirmation(impact);
    const summary = this.generateSummary(impact);
    const diff = this.generateDiff(original, modified, filename);
    
    return {
      impact,
      confirmation,
      summary,
      diff,
      filename,
      timestamp: new Date().toISOString()
    };
  }
}

