/**
 * Modification Scope Detector
 * Determines the scope of modifications based on user intent
 */

import { LaTeXSectionParser } from './latex-section-parser.js';

export class ModificationScopeDetector {
  constructor() {
    this.sectionParser = new LaTeXSectionParser();
  }

  /**
   * Analyze modification intent from user request
   * @param {string} userRequest - User's modification request
   * @param {string} fileContent - Full file content
   * @param {string|null} highlightedText - Text selected by user (if any)
   * @returns {Promise<Object>} Scope analysis result
   */
  async analyzeModificationIntent(userRequest, fileContent, highlightedText = null) {
    const lowerRequest = userRequest.toLowerCase();

    // Priority 1: If user has highlighted text, assume they want to modify selection
    if (highlightedText && highlightedText.trim().length > 0) {
      console.log('🎯 User highlighted text detected - scope: selection');
      return {
        scope: 'selection',
        targetSection: null,
        confidence: 0.95,
        reason: 'User highlighted specific text'
      };
    }

    // Priority 2: Check for explicit section mentions
    const sectionScope = this.sectionParser.identifyModificationScope(userRequest, fileContent);
    if (sectionScope.scope === 'section' && sectionScope.confidence >= 0.8) {
      console.log(`🎯 Section-specific modification detected: ${sectionScope.sectionName}`);
      return {
        scope: 'section',
        targetSection: sectionScope.sectionName,
        sectionType: sectionScope.sectionType,
        start: sectionScope.start,
        end: sectionScope.end,
        confidence: sectionScope.confidence,
        reason: `User mentioned section: ${sectionScope.sectionName}`
      };
    }

    // Priority 3: Pattern matching for modification types
    const patterns = [
      // Section-specific patterns
      { regex: /\b(?:increase|expand|extend|enhance|improve|enlarge|grow|lengthen)\s+(?:the\s+)?(\w+)\b/i, scope: 'section' },
      { regex: /\b(?:modify|edit|change|update|revise|rewrite)\s+(?:the\s+)?(\w+)\b/i, scope: 'section' },
      { regex: /\badd\s+(?:to|in)\s+(?:the\s+)?(\w+)\b/i, scope: 'section' },
      
      // Full document patterns
      { regex: /\b(?:fix|correct|repair)\s+(?:all\s+)?(?:errors?|issues?|problems?)\b/i, scope: 'full' },
      { regex: /\b(?:reformat|restructure|reorganize)\s+(?:the\s+)?(?:entire\s+)?document\b/i, scope: 'full' },
      { regex: /\b(?:entire|whole|full)\s+document\b/i, scope: 'full' },
    ];

    for (const pattern of patterns) {
      const match = lowerRequest.match(pattern.regex);
      if (match) {
        if (pattern.scope === 'section' && match[1]) {
          // Try to find the mentioned section
          const sectionName = match[1];
          const section = this.sectionParser.findSection(fileContent, sectionName);
          
          if (section) {
            console.log(`🎯 Found section from pattern: ${sectionName}`);
            return {
              scope: 'section',
              targetSection: sectionName,
              sectionType: section.type,
              start: section.start,
              end: section.end,
              confidence: 0.85,
              reason: `Pattern matched section: ${sectionName}`
            };
          }
        } else if (pattern.scope === 'full') {
          console.log('🎯 Full document modification pattern detected');
          return {
            scope: 'full',
            targetSection: null,
            confidence: 0.9,
            reason: 'Pattern indicates full document modification'
          };
        }
      }
    }

    // Priority 4: Semantic analysis using simple heuristics
    // If request is very short and mentions a single word that matches a section, assume section modification
    const words = lowerRequest.split(/\s+/).filter(w => w.length > 3);
    if (words.length <= 5) {
      for (const word of words) {
        const section = this.sectionParser.findSection(fileContent, word);
        if (section) {
          console.log(`🎯 Short request with section keyword: ${word}`);
          return {
            scope: 'section',
            targetSection: word,
            sectionType: section.type,
            start: section.start,
            end: section.end,
            confidence: 0.75,
            reason: `Short request mentions section: ${word}`
          };
        }
      }
    }

    // Default: Full document modification (safest assumption)
    console.log('🎯 Defaulting to full document modification');
    return {
      scope: 'full',
      targetSection: null,
      confidence: 0.6,
      reason: 'No specific scope indicators found'
    };
  }

  /**
   * Get modification boundaries based on scope
   * @param {Object} scope - Scope object from analyzeModificationIntent
   * @param {string} fileContent - Full file content
   * @param {string|null} highlightedText - Highlighted text (if any)
   * @returns {Object} Boundaries { start, end, startLine, endLine }
   */
  getModificationBoundaries(scope, fileContent, highlightedText = null) {
    if (scope.scope === 'selection' && highlightedText) {
      // Find the position of highlighted text in file content
      const start = fileContent.indexOf(highlightedText);
      if (start >= 0) {
        const end = start + highlightedText.length;
        const startLine = this.sectionParser.getLineNumber(fileContent, start);
        const endLine = this.sectionParser.getLineNumber(fileContent, end);
        
        return {
          start,
          end,
          startLine,
          endLine,
          content: highlightedText
        };
      }
    }

    if (scope.scope === 'section' && scope.start !== undefined && scope.end !== undefined) {
      const startLine = this.sectionParser.getLineNumber(fileContent, scope.start);
      const endLine = this.sectionParser.getLineNumber(fileContent, scope.end);
      
      return {
        start: scope.start,
        end: scope.end,
        startLine,
        endLine,
        content: fileContent.substring(scope.start, scope.end)
      };
    }

    // Full document
    const lines = fileContent.split('\n');
    return {
      start: 0,
      end: fileContent.length,
      startLine: 0,
      endLine: lines.length - 1,
      content: fileContent
    };
  }

  /**
   * Determine if a modification requires user confirmation
   * @param {Object} scope - Scope object
   * @param {string} fileContent - Current file content
   * @param {string} modifiedContent - Modified content
   * @returns {Object} { requiresConfirmation: boolean, reason: string, stats: Object }
   */
  requiresConfirmation(scope, fileContent, modifiedContent) {
    const originalLength = fileContent.length;
    const modifiedLength = modifiedContent.length;
    const lengthRatio = modifiedLength / originalLength;
    
    const originalLines = fileContent.split('\n').length;
    const modifiedLines = modifiedContent.split('\n').length;
    const linesChanged = Math.abs(modifiedLines - originalLines);
    const linesDeletionRatio = (originalLines - modifiedLines) / originalLines;

    const stats = {
      originalLength,
      modifiedLength,
      lengthRatio,
      originalLines,
      modifiedLines,
      linesChanged,
      linesDeletionRatio
    };

    // Confirmation required if:
    // 1. More than 50 lines removed
    if (linesDeletionRatio > 0 && originalLines - modifiedLines > 50) {
      return {
        requiresConfirmation: true,
        reason: `Large content removal detected (${originalLines - modifiedLines} lines)`,
        stats
      };
    }

    // 2. More than 30% of content deleted
    if (linesDeletionRatio > 0.3) {
      return {
        requiresConfirmation: true,
        reason: `Significant content deletion (${Math.round(linesDeletionRatio * 100)}% of lines)`,
        stats
      };
    }

    // 3. Content reduced to less than 40% of original (except for selection scope)
    if (lengthRatio < 0.4 && scope.scope !== 'selection') {
      return {
        requiresConfirmation: true,
        reason: `Content significantly reduced (${Math.round(lengthRatio * 100)}% of original)`,
        stats
      };
    }

    // 4. Full document modification with substantial changes
    if (scope.scope === 'full' && (linesChanged > 100 || Math.abs(lengthRatio - 1.0) > 0.5)) {
      return {
        requiresConfirmation: true,
        reason: 'Large full-document modification detected',
        stats
      };
    }

    return {
      requiresConfirmation: false,
      reason: 'Modification within safe limits',
      stats
    };
  }

  /**
   * Validate that modified content is complete and safe to apply
   * @param {string} modifiedContent - The content to validate
   * @param {Object} scope - Scope information
   * @param {string} originalContent - Original file content for comparison
   * @returns {Object} { isValid: boolean, errors: Array, warnings: Array }
   */
  validateModifiedContent(modifiedContent, scope, originalContent) {
    const errors = [];
    const warnings = [];

    // Check 1: For full document modifications, ensure complete document structure
    if (scope.scope === 'full' || scope.scope === 'section') {
      const hasDocClass = modifiedContent.includes('\\documentclass');
      const hasBeginDoc = modifiedContent.includes('\\begin{document}');
      const hasEndDoc = modifiedContent.includes('\\end{document}');

      if (!hasDocClass) {
        errors.push('Missing \\documentclass declaration');
      }
      if (!hasBeginDoc) {
        errors.push('Missing \\begin{document}');
      }
      if (!hasEndDoc) {
        errors.push('Missing \\end{document}');
      }
    }

    // Check 2: Validate length ratio for non-selection modifications
    if (scope.scope !== 'selection') {
      const lengthRatio = modifiedContent.length / originalContent.length;
      
      if (lengthRatio < 0.3) {
        errors.push(`Modified content is suspiciously short (${Math.round(lengthRatio * 100)}% of original)`);
      }
      
      if (lengthRatio < 0.5) {
        warnings.push(`Modified content is significantly shorter than original (${Math.round(lengthRatio * 100)}%)`);
      }
    }

    // Check 3: Ensure balanced braces and environments
    const openBraces = (modifiedContent.match(/\{/g) || []).length;
    const closeBraces = (modifiedContent.match(/\}/g) || []).length;
    
    if (openBraces !== closeBraces) {
      warnings.push(`Unbalanced braces detected (${openBraces} open, ${closeBraces} close)`);
    }

    // Check 4: Common LaTeX environments should be balanced
    const beginMatches = modifiedContent.match(/\\begin\{([^}]+)\}/g) || [];
    const endMatches = modifiedContent.match(/\\end\{([^}]+)\}/g) || [];
    
    if (beginMatches.length !== endMatches.length) {
      warnings.push(`Potentially unbalanced environments (${beginMatches.length} begins, ${endMatches.length} ends)`);
    }

    // Check 5: For section modifications, ensure the section still exists
    if (scope.scope === 'section' && scope.targetSection) {
      const sectionPattern = new RegExp(`\\\\(?:section|subsection|chapter|begin\\{${scope.sectionType}\\})`, 'i');
      if (!sectionPattern.test(modifiedContent)) {
        warnings.push(`Target section "${scope.targetSection}" may have been removed`);
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }
}

