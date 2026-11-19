/**
 * AI Writing Assistant
 * Provides context-aware writing suggestions, grammar checking, and content enhancement
 * Powered by AI models via OpenRouter API (configured via AI_MODEL env variable)
 */

import fs from 'fs/promises';
import path from 'path';
import { aiModelClient } from './aimodel-client.js';

export class AIWritingAssistant {
  constructor() {
    this.suggestions = new Map();
    this.contextCache = new Map();
  }

  /**
   * Analyze text and provide writing suggestions using AI model
   */
  async analyzeText(text, context = {}) {
    try {
      // Use AI model for comprehensive analysis
      const aiAnalysis = await aiModelClient.analyzeLaTeX(text, context);
      
      if (aiAnalysis.success) {
        // Parse AI response and combine with local analysis
        const analysis = {
          ai_suggestions: aiAnalysis.content,
          grammar_issues: await this.checkGrammar(text),
          style_suggestions: await this.analyzeStyle(text, context),
          clarity_improvements: await this.analyzeClarity(text),
          academic_tone: await this.checkAcademicTone(text),
          citation_suggestions: await this.suggestCitations(text, context),
          structure_recommendations: await this.analyzeStructure(text, context),
          readability_score: this.calculateReadability(text),
          word_count: this.getWordCount(text),
          sentence_count: this.getSentenceCount(text)
        };

        return {
          success: true,
          analysis,
          overall_score: this.calculateOverallScore(analysis),
          ai_model: aiModelClient.model || process.env.AI_MODEL || process.env.AI_MODEL_FALLBACK || 'deepseek/deepseek-chat'
        };
      } else {
        // Fallback to local analysis if AI fails
        return this.fallbackAnalysis(text, context);
      }
    } catch (error) {
      console.error('AI analysis failed, using fallback:', error);
      return this.fallbackAnalysis(text, context);
    }
  }

  /**
   * Fallback analysis when AI is unavailable
   */
  async fallbackAnalysis(text, context = {}) {
    try {
      const analysis = {
        grammar_issues: await this.checkGrammar(text),
        style_suggestions: await this.analyzeStyle(text, context),
        clarity_improvements: await this.analyzeClarity(text),
        academic_tone: await this.checkAcademicTone(text),
        citation_suggestions: await this.suggestCitations(text, context),
        structure_recommendations: await this.analyzeStructure(text, context),
        readability_score: this.calculateReadability(text),
        word_count: this.getWordCount(text),
        sentence_count: this.getSentenceCount(text)
      };

      return {
        success: true,
        analysis,
        overall_score: this.calculateOverallScore(analysis),
        ai_model: 'Local Analysis'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Check grammar and spelling
   */
  async checkGrammar(text) {
    const issues = [];
    
    // Common grammar patterns to check
    const grammarPatterns = [
      {
        pattern: /\b(its|it's)\b/gi,
        check: (match, text) => {
          const context = text.substring(Math.max(0, match.index - 20), match.index + 20);
          if (match[0].toLowerCase() === 'its' && context.includes("'")) {
            return { type: 'grammar', message: 'Consider using "it\'s" (it is) instead of "its"', severity: 'medium' };
          }
          return null;
        }
      },
      {
        pattern: /\b(there|their|they're)\b/gi,
        check: (match, text) => {
          const context = text.substring(Math.max(0, match.index - 20), match.index + 20);
          if (match[0].toLowerCase() === 'there' && context.includes('belong')) {
            return { type: 'grammar', message: 'Consider using "their" (possessive) instead of "there"', severity: 'medium' };
          }
          return null;
        }
      },
      {
        pattern: /\b(affect|effect)\b/gi,
        check: (match, text) => {
          const context = text.substring(Math.max(0, match.index - 10), match.index + 10);
          if (match[0].toLowerCase() === 'effect' && context.includes('will')) {
            return { type: 'grammar', message: 'Consider using "affect" (verb) instead of "effect" (noun)', severity: 'low' };
          }
          return null;
        }
      }
    ];

    for (const { pattern, check } of grammarPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const issue = check(match, text);
        if (issue) {
          issues.push({
            ...issue,
            position: match.index,
            length: match[0].length,
            suggestion: match[0]
          });
        }
      }
    }

    return issues;
  }

  /**
   * Analyze writing style
   */
  async analyzeStyle(text, context) {
    const suggestions = [];
    
    // Check for passive voice
    const passivePatterns = [
      /\b(is|are|was|were|been)\s+\w+ed\b/gi,
      /\b(has|have|had)\s+been\s+\w+ed\b/gi
    ];

    let passiveCount = 0;
    for (const pattern of passivePatterns) {
      const matches = text.match(pattern);
      if (matches) passiveCount += matches.length;
    }

    if (passiveCount > 5) {
      suggestions.push({
        type: 'style',
        message: `Consider reducing passive voice (found ${passiveCount} instances)`,
        severity: 'medium',
        category: 'voice'
      });
    }

    // Check sentence length
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const longSentences = sentences.filter(s => s.split(' ').length > 25);
    
    if (longSentences.length > 0) {
      suggestions.push({
        type: 'style',
        message: `Consider breaking down ${longSentences.length} long sentences for better readability`,
        severity: 'low',
        category: 'length'
      });
    }

    // Check for repetitive words
    const words = text.toLowerCase().split(/\s+/);
    const wordCount = {};
    for (const word of words) {
      const cleanWord = word.replace(/[^\w]/g, '');
      if (cleanWord.length > 3) {
        wordCount[cleanWord] = (wordCount[cleanWord] || 0) + 1;
      }
    }

    const repetitiveWords = Object.entries(wordCount)
      .filter(([word, count]) => count > 5)
      .sort(([,a], [,b]) => b - a);

    if (repetitiveWords.length > 0) {
      suggestions.push({
        type: 'style',
        message: `Consider using synonyms for frequently repeated words: ${repetitiveWords.slice(0, 3).map(([word]) => word).join(', ')}`,
        severity: 'low',
        category: 'repetition'
      });
    }

    return suggestions;
  }

  /**
   * Analyze clarity and readability
   */
  async analyzeClarity(text) {
    const improvements = [];

    // Check for complex phrases that could be simplified
    const complexPhrases = [
      { pattern: /\bin order to\b/gi, suggestion: 'to' },
      { pattern: /\bdue to the fact that\b/gi, suggestion: 'because' },
      { pattern: /\bin the event that\b/gi, suggestion: 'if' },
      { pattern: /\bwith regard to\b/gi, suggestion: 'about' },
      { pattern: /\bin spite of the fact that\b/gi, suggestion: 'although' }
    ];

    for (const { pattern, suggestion } of complexPhrases) {
      const matches = text.match(pattern);
      if (matches) {
        improvements.push({
          type: 'clarity',
          message: `Consider replacing "${matches[0]}" with "${suggestion}" for better clarity`,
          severity: 'low',
          category: 'simplification'
        });
      }
    }

    // Check for jargon and technical terms without explanation
    const jargonPatterns = [
      /\b(algorithm|methodology|paradigm|framework)\b/gi
    ];

    for (const pattern of jargonPatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 3) {
        improvements.push({
          type: 'clarity',
          message: 'Consider defining technical terms for broader audience',
          severity: 'medium',
          category: 'jargon'
        });
      }
    }

    return improvements;
  }

  /**
   * Check academic tone and formality
   */
  async checkAcademicTone(text) {
    const issues = [];

    // Check for informal language
    const informalPatterns = [
      { pattern: /\b(pretty|really|very|quite)\b/gi, message: 'Consider using more precise academic language' },
      { pattern: /\b(awesome|cool|great|nice)\b/gi, message: 'Use more formal descriptive language' },
      { pattern: /\b(we|I|you)\b/gi, message: 'Consider using passive voice or third person for academic writing' }
    ];

    for (const { pattern, message } of informalPatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 2) {
        issues.push({
          type: 'tone',
          message,
          severity: 'medium',
          category: 'formality'
        });
      }
    }

    // Check for contractions
    const contractions = text.match(/\b\w+'\w+\b/g);
    if (contractions && contractions.length > 0) {
      issues.push({
        type: 'tone',
        message: 'Avoid contractions in academic writing',
        severity: 'low',
        category: 'formality'
      });
    }

    return issues;
  }

  /**
   * Suggest citations based on content
   */
  async suggestCitations(text, context) {
    const suggestions = [];

    // Extract potential citation needs
    const citationPatterns = [
      { pattern: /\b(study|research|analysis|experiment)\b/gi, type: 'methodology' },
      { pattern: /\b(algorithm|method|approach|technique)\b/gi, type: 'technical' },
      { pattern: /\b(theory|model|framework|paradigm)\b/gi, type: 'theoretical' },
      { pattern: /\b(results|findings|outcomes|conclusions)\b/gi, type: 'results' }
    ];

    for (const { pattern, type } of citationPatterns) {
      const matches = text.match(pattern);
      if (matches && matches.length > 2) {
        suggestions.push({
          type: 'citation',
          message: `Consider adding citations for ${type} concepts`,
          severity: 'medium',
          category: type,
          context: matches.slice(0, 3)
        });
      }
    }

    return suggestions;
  }

  /**
   * Analyze document structure
   */
  async analyzeStructure(text, context) {
    const recommendations = [];

    // Check for section organization
    const sections = text.match(/\\section\{[^}]+\}/g) || [];
    const subsections = text.match(/\\subsection\{[^}]+\}/g) || [];
    
    if (sections.length < 3) {
      recommendations.push({
        type: 'structure',
        message: 'Consider adding more sections for better organization',
        severity: 'medium',
        category: 'organization'
      });
    }

    // Check for introduction and conclusion
    const hasIntroduction = /\\section\{[^}]*introduction[^}]*\}/gi.test(text);
    const hasConclusion = /\\section\{[^}]*conclusion[^}]*\}/gi.test(text);

    if (!hasIntroduction) {
      recommendations.push({
        type: 'structure',
        message: 'Consider adding an introduction section',
        severity: 'high',
        category: 'organization'
      });
    }

    if (!hasConclusion) {
      recommendations.push({
        type: 'structure',
        message: 'Consider adding a conclusion section',
        severity: 'high',
        category: 'organization'
      });
    }

    // Check paragraph length
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    const longParagraphs = paragraphs.filter(p => p.split(' ').length > 150);

    if (longParagraphs.length > 0) {
      recommendations.push({
        type: 'structure',
        message: `Consider breaking down ${longParagraphs.length} long paragraphs`,
        severity: 'low',
        category: 'paragraphs'
      });
    }

    return recommendations;
  }

  /**
   * Calculate readability score (Flesch Reading Ease)
   */
  calculateReadability(text) {
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const syllables = this.countSyllables(text);

    if (sentences.length === 0 || words.length === 0) return 0;

    const avgSentenceLength = words.length / sentences.length;
    const avgSyllablesPerWord = syllables / words.length;

    const score = 206.835 - (1.015 * avgSentenceLength) - (84.6 * avgSyllablesPerWord);
    return Math.round(score);
  }

  /**
   * Count syllables in text
   */
  countSyllables(text) {
    const words = text.toLowerCase().split(/\s+/);
    let totalSyllables = 0;

    for (const word of words) {
      const cleanWord = word.replace(/[^\w]/g, '');
      if (cleanWord.length <= 3) {
        totalSyllables += 1;
      } else {
        const vowels = cleanWord.match(/[aeiouy]+/g);
        totalSyllables += vowels ? vowels.length : 1;
      }
    }

    return totalSyllables;
  }

  /**
   * Get word count
   */
  getWordCount(text) {
    return text.split(/\s+/).filter(word => word.length > 0).length;
  }

  /**
   * Get sentence count
   */
  getSentenceCount(text) {
    return text.split(/[.!?]+/).filter(sentence => sentence.trim().length > 0).length;
  }

  /**
   * Calculate overall writing score
   */
  calculateOverallScore(analysis) {
    let score = 100;

    // Deduct points for issues
    score -= analysis.grammar_issues.length * 2;
    score -= analysis.style_suggestions.length * 1;
    score -= analysis.clarity_improvements.length * 1;
    score -= analysis.academic_tone.length * 2;
    score -= analysis.structure_recommendations.length * 3;

    // Adjust for readability
    const readability = analysis.readability_score;
    if (readability < 30) score -= 10;
    else if (readability < 50) score -= 5;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Generate writing suggestions for specific text
   */
  async generateSuggestions(text, position, context = {}) {
    try {
      const suggestions = [];

      // Get text around cursor position
      const start = Math.max(0, position - 100);
      const end = Math.min(text.length, position + 100);
      const contextText = text.substring(start, end);

      // Analyze context for suggestions
      const analysis = await this.analyzeText(contextText, context);

      if (analysis.success) {
        // Add relevant suggestions
        suggestions.push(...analysis.analysis.grammar_issues);
        suggestions.push(...analysis.analysis.style_suggestions);
        suggestions.push(...analysis.analysis.clarity_improvements);
      }

      return {
        success: true,
        suggestions: suggestions.slice(0, 5), // Limit to 5 suggestions
        position
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Auto-complete LaTeX commands
   */
  async suggestLaTeXCommands(partialCommand, context = {}) {
    const commonCommands = [
      'section', 'subsection', 'subsubsection', 'paragraph',
      'textbf', 'textit', 'emph', 'underline',
      'cite', 'ref', 'label', 'caption',
      'begin', 'end', 'itemize', 'enumerate',
      'figure', 'table', 'equation', 'align',
      'includegraphics', 'input', 'include'
    ];

    const suggestions = commonCommands
      .filter(cmd => cmd.startsWith(partialCommand.toLowerCase()))
      .map(cmd => ({
        command: cmd,
        description: this.getCommandDescription(cmd),
        usage: this.getCommandUsage(cmd)
      }));

    return {
      success: true,
      suggestions: suggestions.slice(0, 10)
    };
  }

  /**
   * Get LaTeX command description
   */
  getCommandDescription(command) {
    const descriptions = {
      'section': 'Create a new section',
      'subsection': 'Create a new subsection',
      'textbf': 'Make text bold',
      'textit': 'Make text italic',
      'cite': 'Insert citation',
      'ref': 'Reference a label',
      'includegraphics': 'Include an image',
      'begin': 'Start an environment',
      'end': 'End an environment'
    };

    return descriptions[command] || 'LaTeX command';
  }

  /**
   * Get LaTeX command usage example
   */
  getCommandUsage(command) {
    const usage = {
      'section': '\\section{Title}',
      'subsection': '\\subsection{Title}',
      'textbf': '\\textbf{bold text}',
      'textit': '\\textit{italic text}',
      'cite': '\\cite{reference}',
      'ref': '\\ref{label}',
      'includegraphics': '\\includegraphics[width=0.8\\textwidth]{image.png}',
      'begin': '\\begin{environment}',
      'end': '\\end{environment}'
    };

    return usage[command] || `\\${command}{}`;
  }

  /**
   * Check for common LaTeX errors
   */
  async checkLaTeXErrors(text) {
    const errors = [];

    // Check for unmatched braces
    const openBraces = (text.match(/\{/g) || []).length;
    const closeBraces = (text.match(/\}/g) || []).length;
    
    if (openBraces !== closeBraces) {
      errors.push({
        type: 'syntax',
        message: `Unmatched braces: ${openBraces} open, ${closeBraces} close`,
        severity: 'high',
        category: 'braces'
      });
    }

    // Check for unmatched environments
    const beginMatches = text.match(/\\begin\{([^}]+)\}/g) || [];
    const endMatches = text.match(/\\end\{([^}]+)\}/g) || [];
    
    const beginEnvs = beginMatches.map(m => m.match(/\{([^}]+)\}/)[1]);
    const endEnvs = endMatches.map(m => m.match(/\{([^}]+)\}/)[1]);
    
    for (const env of beginEnvs) {
      if (!endEnvs.includes(env)) {
        errors.push({
          type: 'syntax',
          message: `Missing \\end{${env}} for \\begin{${env}}`,
          severity: 'high',
          category: 'environments'
        });
      }
    }

    // Check for common mistakes
    const commonMistakes = [
      { pattern: /\\section\s*\{[^}]*\s*\}/g, message: 'Empty section title' },
      { pattern: /\\cite\s*\{\s*\}/g, message: 'Empty citation' },
      { pattern: /\\ref\s*\{\s*\}/g, message: 'Empty reference' }
    ];

    for (const { pattern, message } of commonMistakes) {
      const matches = text.match(pattern);
      if (matches) {
        errors.push({
          type: 'content',
          message,
          severity: 'medium',
          category: 'empty_commands'
        });
      }
    }

    return errors;
  }

  /**
   * Suggest improvements for LaTeX document
   */
  async suggestLaTeXImprovements(text, context = {}) {
    const improvements = [];

    // Check for missing packages
    const usedCommands = this.extractLaTeXCommands(text);
    const requiredPackages = this.getRequiredPackages(usedCommands);
    const declaredPackages = this.extractDeclaredPackages(text);

    for (const pkg of requiredPackages) {
      if (!declaredPackages.includes(pkg)) {
        improvements.push({
          type: 'package',
          message: `Consider adding \\usepackage{${pkg}}`,
          severity: 'medium',
          category: 'packages',
          package: pkg
        });
      }
    }

    // Check for figure placement
    const figures = text.match(/\\begin\{figure\}/g) || [];
    if (figures.length > 0) {
      improvements.push({
        type: 'layout',
        message: 'Consider using figure placement options like [h], [t], [b], or [H]',
        severity: 'low',
        category: 'figures'
      });
    }

    // Check for table formatting
    const tables = text.match(/\\begin\{tabular\}/g) || [];
    if (tables.length > 0) {
      improvements.push({
        type: 'layout',
        message: 'Consider using booktabs package for better table formatting',
        severity: 'low',
        category: 'tables'
      });
    }

    return improvements;
  }

  /**
   * Extract LaTeX commands from text
   */
  extractLaTeXCommands(text) {
    const commands = text.match(/\\[a-zA-Z]+\b/g) || [];
    return [...new Set(commands.map(cmd => cmd.substring(1)))];
  }

  /**
   * Get required packages for commands
   */
  getRequiredPackages(commands) {
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
      'minted': 'minted'
    };

    const required = [];
    for (const cmd of commands) {
      if (packageMap[cmd] && !required.includes(packageMap[cmd])) {
        required.push(packageMap[cmd]);
      }
    }

    return required;
  }

  /**
   * Extract declared packages from text
   */
  extractDeclaredPackages(text) {
    const packages = text.match(/\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g) || [];
    return packages.map(pkg => pkg.match(/\{([^}]+)\}/)[1]);
  }

  /**
   * Generate LaTeX content using AI model
   */
  async generateLaTeXContent(requirements, context = {}) {
    try {
      const result = await aiModelClient.generateLaTeXContent(requirements, context);
      return {
        success: result.success,
        content: result.content,
        error: result.error
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Fix LaTeX errors using AI model
   */
  async fixLaTeXErrors(text, errors = []) {
    try {
      const result = await aiModelClient.fixLaTeXErrors(text, errors);
      return {
        success: result.success,
        fixedContent: result.content,
        error: result.error
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate abstract using AI model
   */
  async generateAbstract(content, context = {}) {
    try {
      const result = await aiModelClient.generateAbstract(content, context);
      return {
        success: result.success,
        abstract: result.content,
        error: result.error
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Improve writing style using AI model
   */
  async improveWriting(text, style = 'academic') {
    try {
      const result = await aiModelClient.improveWriting(text, style);
      return {
        success: result.success,
        improvedText: result.content,
        error: result.error
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate citations using AI model
   */
  async generateCitations(topic, count = 5) {
    try {
      const result = await aiModelClient.generateCitations(topic, count);
      return {
        success: result.success,
        citations: result.content,
        error: result.error
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Generate research questions using AI model
   */
  async generateResearchQuestions(topic, context = {}) {
    try {
      const result = await aiModelClient.generateResearchQuestions(topic, context);
      return {
        success: result.success,
        questions: result.content,
        error: result.error
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Summarize content using AI model
   */
  async summarizeContent(text, maxLength = 200) {
    try {
      const result = await aiModelClient.summarizeContent(text, maxLength);
      return {
        success: result.success,
        summary: result.content,
        error: result.error
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Translate content using AI model
   */
  async translateContent(text, targetLanguage = 'English') {
    try {
      const result = await aiModelClient.translateContent(text, targetLanguage);
      return {
        success: result.success,
        translatedText: result.content,
        error: result.error
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }
}
