/**
 * AI Model Integration for GenLaTeX LaTeX Editor
 * Client-side JavaScript for AI-powered research assistance features
 */

class GenLaTeXAI {
  constructor() {
    this.apiEndpoint = '/api/ai/assistant';
    this.isEnabled = true;
    this.lastRequestTime = 0;
    this.requestDelay = 1000; // Default delay, will be updated from config
    this.config = null;
    this.loadConfig();
  }

  /**
   * Load configuration from server
   */
  async loadConfig() {
    try {
      const response = await fetch('/api/config');
      if (response.ok) {
        this.config = await response.json();
        this.requestDelay = this.config.ai?.requestDelay || 1000;
        this.isEnabled = this.config.features?.aiEnabled || false;
      }
    } catch (error) {
      console.warn('Failed to load AI configuration:', error);
      // Continue with defaults if config fails to load
    }
  }

  /**
   * Check if enough time has passed since last request
   */
  canMakeRequest() {
    if (!this.isEnabled) {
      return false;
    }
    
    const now = Date.now();
    if (now - this.lastRequestTime < this.requestDelay) {
      return false;
    }
    this.lastRequestTime = now;
    return true;
  }

  /**
   * Make API request to AI assistant
   */
  async makeRequest(action, data) {
    if (!this.canMakeRequest()) {
      if (!this.isEnabled) {
        return { success: false, error: 'AI features are disabled. Please configure OPENROUTER_API_KEY.' };
      }
      return { success: false, error: 'Rate limit exceeded' };
    }

    try {
      const response = await fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, data })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('AI request failed:', error);
      
      // Handle specific error types
      if (error.message.includes('429') || error.message.includes('Rate limit')) {
        return { 
          success: false, 
          error: 'Rate limit exceeded. Please wait a moment before trying again.',
          type: 'rate_limit'
        };
      } else if (error.message.includes('401') || error.message.includes('Invalid API key')) {
        return { 
          success: false, 
          error: 'Invalid API key. Please check your configuration.',
          type: 'auth_error'
        };
      } else {
        return { success: false, error: error.message };
      }
    }
  }

  /**
   * Analyze LaTeX text and provide suggestions
   */
  async analyzeText(text, context = {}) {
    return this.makeRequest('analyze_text', { text, context });
  }

  /**
   * Generate LaTeX content based on requirements
   */
  async generateLaTeXContent(requirements, context = {}) {
    return this.makeRequest('generate_latex_content', { requirements, context });
  }

  /**
   * Fix LaTeX errors
   */
  async fixLaTeXErrors(text, errors = []) {
    return this.makeRequest('fix_latex_errors', { text, errors });
  }

  /**
   * Generate abstract
   */
  async generateAbstract(content, context = {}) {
    return this.makeRequest('generate_abstract', { content, context });
  }

  /**
   * Improve writing style
   */
  async improveWriting(text, style = 'academic') {
    return this.makeRequest('improve_writing', { text, style });
  }

  /**
   * Generate citations
   */
  async generateCitations(topic, count = 5) {
    return this.makeRequest('generate_citations', { topic, count });
  }

  /**
   * Generate research questions
   */
  async generateResearchQuestions(topic, context = {}) {
    return this.makeRequest('generate_research_questions', { topic, context });
  }

  /**
   * Summarize content
   */
  async summarizeContent(text, maxLength = 200) {
    return this.makeRequest('summarize_content', { text, maxLength });
  }

  /**
   * Translate content
   */
  async translateContent(text, targetLanguage = 'English') {
    return this.makeRequest('translate_content', { text, targetLanguage });
  }

  /**
   * Suggest LaTeX commands
   */
  async suggestLaTeXCommands(partialCommand, context = {}) {
    return this.makeRequest('suggest_latex_commands', { partialCommand, context });
  }

  /**
   * Check LaTeX errors
   */
  async checkLaTeXErrors(text) {
    return this.makeRequest('check_latex_errors', { text });
  }

  /**
   * Get writing suggestions
   */
  async getSuggestions(text, position, context = {}) {
    return this.makeRequest('generate_suggestions', { text, position, context });
  }
}

// Create global instance (only in browser)
if (typeof window !== 'undefined') {
  window.genlatexAI = new GenLaTeXAI();
}

/**
 * Monaco Editor Integration
 * Add AI features to Monaco Editor
 */
class MonacoAI {
  constructor(editor) {
    this.editor = editor;
    this.ai = window.genlatexAI;
    this.setupAI();
  }

  setupAI() {
    // Add AI suggestions on content change
    this.editor.onDidChangeModelContent(() => {
      this.scheduleAIAnalysis();
    });

    // Add AI command palette
    this.addAICommands();
  }

  scheduleAIAnalysis() {
    // Debounce AI analysis
    clearTimeout(this.aiTimeout);
    this.aiTimeout = setTimeout(() => {
      this.analyzeCurrentContent();
    }, 2000);
  }

  async analyzeCurrentContent() {
    const content = this.editor.getValue();
    if (content.length < 50) return; // Skip short content

    try {
      const result = await this.ai.analyzeText(content);
      if (result.success) {
        this.showAISuggestions(result.analysis);
      }
    } catch (error) {
      console.error('AI analysis failed:', error);
    }
  }

  showAISuggestions(analysis) {
    // Create AI suggestions panel
    const suggestions = [];
    
    if (analysis.ai_suggestions) {
      suggestions.push({
        type: 'ai',
        message: analysis.ai_suggestions,
        severity: 'info'
      });
    }

    if (analysis.grammar_issues?.length > 0) {
      suggestions.push(...analysis.grammar_issues.map(issue => ({
        type: 'grammar',
        message: issue.message,
        severity: issue.severity,
        position: issue.position
      })));
    }

    if (analysis.style_suggestions?.length > 0) {
      suggestions.push(...analysis.style_suggestions.map(suggestion => ({
        type: 'style',
        message: suggestion.message,
        severity: suggestion.severity
      })));
    }

    // Display suggestions in editor
    this.displaySuggestions(suggestions);
  }

  displaySuggestions(suggestions) {
    // Add markers for suggestions
    const markers = suggestions.map(suggestion => ({
      startLineNumber: 1,
      startColumn: 1,
      endLineNumber: 1,
      endColumn: 1,
      message: suggestion.message,
      severity: this.mapSeverity(suggestion.severity),
      source: 'AI Assistant'
    }));

    this.editor.deltaDecorations([], markers);
  }

  mapSeverity(severity) {
    const mapping = {
      'high': 4, // Error
      'medium': 3, // Warning
      'low': 2, // Info
      'info': 1 // Hint
    };
    return mapping[severity] || 1;
  }

  addAICommands() {
    // Add AI commands to Monaco command palette
    const aiCommands = [
      {
        id: 'ai.generateAbstract',
        label: 'Generate Abstract',
        run: () => this.generateAbstract()
      },
      {
        id: 'ai.improveWriting',
        label: 'Improve Writing Style',
        run: () => this.improveWriting()
      },
      {
        id: 'ai.generateCitations',
        label: 'Generate Citations',
        run: () => this.generateCitations()
      },
      {
        id: 'ai.fixErrors',
        label: 'Fix LaTeX Errors',
        run: () => this.fixErrors()
      },
      {
        id: 'ai.summarize',
        label: 'Summarize Content',
        run: () => this.summarize()
      }
    ];

    // Register commands with Monaco
    aiCommands.forEach(command => {
      this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyA, command.run);
    });
  }

  async generateAbstract() {
    const content = this.editor.getValue();
    const result = await this.ai.generateAbstract(content);
    
    if (result.success) {
      // Insert abstract at the beginning
      const abstractSection = `\\section{Abstract}\n${result.abstract}\n\n`;
      this.editor.executeEdits('ai-abstract', [{
        range: new monaco.Range(1, 1, 1, 1),
        text: abstractSection
      }]);
    }
  }

  async improveWriting() {
    const selection = this.editor.getSelection();
    const text = this.editor.getModel().getValueInRange(selection);
    
    if (text.length === 0) {
      alert('Please select text to improve');
      return;
    }

    const result = await this.ai.improveWriting(text);
    
    if (result.success) {
      this.editor.executeEdits('ai-improve', [{
        range: selection,
        text: result.improvedText
      }]);
    }
  }

  async generateCitations() {
    const topic = prompt('Enter topic for citations:');
    if (!topic) return;

    const result = await this.ai.generateCitations(topic);
    
    if (result.success) {
      // Insert citations at the end
      const citationsSection = `\\section{References}\n\\begin{thebibliography}{9}\n${result.citations}\n\\end{thebibliography}\n`;
      const model = this.editor.getModel();
      const endPosition = model.getFullModelRange().getEndPosition();
      
      this.editor.executeEdits('ai-citations', [{
        range: new monaco.Range(endPosition.lineNumber, endPosition.column, endPosition.lineNumber, endPosition.column),
        text: citationsSection
      }]);
    }
  }

  async fixErrors() {
    const content = this.editor.getValue();
    const errors = await this.ai.checkLaTeXErrors(content);
    
    if (errors.success && errors.errors?.length > 0) {
      const result = await this.ai.fixLaTeXErrors(content, errors.errors);
      
      if (result.success) {
        this.editor.setValue(result.fixedContent);
      }
    }
  }

  async summarize() {
    const content = this.editor.getValue();
    const result = await this.ai.summarizeContent(content);
    
    if (result.success) {
      alert(`Summary:\n\n${result.summary}`);
    }
  }
}

// Export for use in other modules (only in browser)
if (typeof window !== 'undefined') {
  window.MonacoAI = MonacoAI;
}

/**
 * Usage Example:
 * 
 * // Initialize AI with Monaco Editor
 * const editor = monaco.editor.create(document.getElementById('editor'));
 * const ai = new MonacoAI(editor);
 * 
 * // Or use AI directly
 * const result = await window.genlatexAI.analyzeText('Your LaTeX content here');
 * console.log(result);
 */
