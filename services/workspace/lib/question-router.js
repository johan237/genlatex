/**
 * Question Router - Intelligently classifies and routes user questions
 * to appropriate specialized handlers based on intent analysis
 */

export class QuestionRouter {
  constructor() {
    // Pattern matching keywords for each question type
    this.patterns = {
      latex_fix: [
        'fix', 'error', 'bug', 'broken', 'correction', 'repair', 
        'wrong', 'incorrect', 'broken', 'issue', 'problem', 
        'syntax error', 'compilation error', 'undefined control sequence',
        'missing', 'mismatch', 'unclosed', 'invalid'
      ],
      latex_generate: [
        'generate', 'create', 'write', 'add section', 'new', 'make', 
        'build', 'add', 'insert', 'append', 'compose', 'draft',
        'write a section', 'create a section', 'generate content'
      ],
      latex_analyze: [
        'analyze', 'review', 'suggest', 'improve', 'check', 'evaluate',
        'assess', 'examine', 'critique', 'feedback', 'recommend',
        'optimize', 'enhance', 'refine'
      ],
      latex_syntax_help: [
        'how to', 'syntax', 'command', 'package', 'what is', 'usage',
        'help', 'example', 'how do i', 'explain', 'tutorial', 'guide',
        'reference', 'documentation', 'usage of', 'how can i'
      ],
      question_answering: [
        'what', 'why', 'how', 'when', 'where', 'who', 'explain',
        'describe', 'tell me', 'define', 'meaning', 'significance',
        'difference', 'compare', 'contrast', 'relationship'
      ]
    };

    // Weights for confidence scoring
    this.patternWeights = {
      latex_fix: 1.0,
      latex_generate: 1.0,
      latex_analyze: 1.0,
      latex_syntax_help: 0.9,
      question_answering: 0.8
    };
  }

  /**
   * Classify question type based on message content
   * @param {string} message - User's message
   * @param {Object} context - Additional context (currentDocument, etc.)
   * @returns {Object} { type, confidence, reasoning }
   */
  classifyQuestionType(message, context = {}) {
    if (!message || typeof message !== 'string') {
      return {
        type: 'general_chat',
        confidence: 1.0,
        reasoning: 'Empty or invalid message'
      };
    }

    const lowerMessage = message.toLowerCase().trim();
    const scores = {};

    // Score each category based on pattern matches
    for (const [type, patterns] of Object.entries(this.patterns)) {
      scores[type] = 0;
      let matchCount = 0;
      
      for (const pattern of patterns) {
        if (lowerMessage.includes(pattern)) {
          matchCount++;
          // Longer patterns get higher weight
          scores[type] += pattern.length * this.patternWeights[type];
        }
      }
      
      // Bonus for multiple matches
      if (matchCount > 1) {
        scores[type] *= 1.2;
      }
    }

    // Check for LaTeX-specific context indicators
    const hasLatexContext = context.currentDocument || 
                           lowerMessage.includes('latex') || 
                           lowerMessage.includes('tex') ||
                           lowerMessage.includes('documentclass') ||
                           lowerMessage.includes('\\begin') ||
                           lowerMessage.includes('\\section');

    // Boost LaTeX-related categories if context suggests LaTeX
    if (hasLatexContext) {
      if (scores.latex_fix > 0) scores.latex_fix *= 1.3;
      if (scores.latex_generate > 0) scores.latex_generate *= 1.3;
      if (scores.latex_analyze > 0) scores.latex_analyze *= 1.3;
      if (scores.latex_syntax_help > 0) scores.latex_syntax_help *= 1.3;
    }

    // Find the category with highest score
    const sortedScores = Object.entries(scores)
      .sort((a, b) => b[1] - a[1]);

    const topType = sortedScores[0];
    const topScore = topType ? topType[1] : 0;
    const secondScore = sortedScores[1] ? sortedScores[1][1] : 0;

    // Calculate confidence (higher gap = higher confidence)
    const totalScore = Object.values(scores).reduce((a, b) => a + b, 0);
    let confidence = 0.5; // Default
    let type = 'general_chat';
    let reasoning = '';

    if (topScore > 0) {
      // Confidence based on score dominance
      const scoreRatio = totalScore > 0 ? topScore / totalScore : 0;
      const gapRatio = secondScore > 0 ? (topScore - secondScore) / topScore : 1;
      
      confidence = Math.min(0.95, Math.max(0.5, scoreRatio * 0.7 + gapRatio * 0.3));
      type = topType[0];
      
      reasoning = `Matched patterns for ${type} (score: ${topScore.toFixed(2)}, confidence: ${(confidence * 100).toFixed(1)}%)`;
      
      // Low confidence threshold - fallback to general_chat
      if (confidence < 0.55 && !hasLatexContext) {
        type = 'general_chat';
        confidence = 1.0;
        reasoning = 'Low confidence in specialized category, routing to general chat';
      }
    } else {
      // No matches found
      reasoning = 'No pattern matches found, routing to general chat';
    }

    return {
      type,
      confidence,
      reasoning
    };
  }
}

