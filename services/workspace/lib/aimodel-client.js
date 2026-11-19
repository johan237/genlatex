/**
 * AI Model Client using OpenRouter API.
 * Provides AI-powered document generation and LaTeX editing assistance.
 */

import { rateLimiter } from './rate-limiter.js';
import { QuestionRouter } from './question-router.js';

export class AIModelClient {
  constructor() {
    this.apiKey = process.env.OPENROUTER_API_KEY || 'sk-or-v1-your-api-key-here';
    this.endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    this.model = process.env.AI_MODEL || process.env.AI_MODEL_FALLBACK || 'deepseek/deepseek-chat';
    this.maxRetries = parseInt(process.env.AI_MAX_RETRIES) || 3;
    this.timeout = parseInt(process.env.AI_TIMEOUT) || 30000; // 30 seconds
    this.temperature = parseFloat(process.env.AI_TEMPERATURE) || 0.7;
    const rawMaxTokens = parseInt(process.env.AI_MAX_TOKENS, 10);
    const parsedMaxTokens = Number.isFinite(rawMaxTokens) ? rawMaxTokens : 2000;
    // Hard clamp to avoid provider-side defaults/requests that trigger 402 (e.g., 65535).
    this.maxTokens = Math.max(256, Math.min(parsedMaxTokens, 12000));
    
    // Mock mode for testing - bypasses OpenRouter API
    this.mockMode = process.env.AI_MOCK_MODE === 'true';
    
    // Initialize question router
    this.questionRouter = new QuestionRouter();
    
    // Debug logging
    console.log('🤖 AI Model Client Configuration:');
    console.log('  API Key:', this.apiKey ? `${this.apiKey.substring(0, 15)}...` : 'MISSING');
    console.log('  Mock Mode:', this.mockMode);
    console.log('  Model:', this.model);
    console.log('  Temperature:', this.temperature);
    console.log('  Max Tokens:', this.maxTokens);
    console.log('  Document Assistant Mode: ENABLED');
  }

  /**
   * Get memory context from genlatex-agent
   * NOTE: Memory system removed - returns empty context
   * @param {string} projectId - Project ID
   * @param {string} message - User message
   * @returns {Promise<string>} Memory context string
   */
  async getMemoryContext(projectId, message) {
    // Memory system removed - return empty context
    console.warn('⚠️ Memory system removed - getMemoryContext returns empty context');
    return `You are a document assistant${projectId ? ` working on project: ${projectId}` : ''}.`;
  }

  /**
   * Generate comprehensive LaTeX expert system prompt
   * @param {string} memoryContext - Global memory context from genlatex-agent
   * @param {string} userPrompt - User's specific instructions
   * @returns {string} Comprehensive expert prompt
   */
  getLaTeXExpertPrompt(memoryContext = '', userPrompt = '') {
    const basePrompt = `You are an expert LaTeX parser and fixer with deep understanding of LaTeX syntax, structure, and semantics.
You must carefully parse the ENTIRE document, understand its structure, and fix ALL errors including structural duplicates.

CRITICAL REQUIREMENTS:
1. PARSE THE ENTIRE DOCUMENT: Read through the complete LaTeX code from start to finish
2. UNDERSTAND STRUCTURE: Identify document class, preamble, and body structure
3. DETECT ALL ERRORS: Find syntax errors, structural errors, duplicates, and inconsistencies
4. FIX COMPREHENSIVELY: Fix every single error you find, not just obvious ones

STRUCTURAL ERROR DETECTION (MOST IMPORTANT):
- Document structure: Must have EXACTLY ONE \\begin{document} and EXACTLY ONE \\end{document}
- If you find multiple \\begin{document} or \\end{document} tags, you MUST remove all duplicates
- Count environments: Each \\begin{env} must have exactly one matching \\end{env}
- No duplicate environments: Check for duplicate \\begin{...}/\\end{...} pairs that shouldn't exist
- No orphaned content: All content must be inside the document environment
- Proper nesting: Environments must nest correctly (itemize, enumerate, etc.)

DUPLICATE TAGS ARE ERRORS (CRITICAL):
Duplicate tags cause compilation errors and MUST be removed when fixing any LaTeX document:
- Multiple \\documentclass declarations → Keep only the first one
- Multiple \\begin{document} tags → Keep only the first one  
- Multiple \\end{document} tags → Keep only the first one
- Duplicate \\begin{...}/\\end{...} pairs → Remove duplicates, keep only one pair
- When fixing errors, ALWAYS check for and remove duplicate tags FIRST

DUPLICATE CONTENT ARE ERRORS (CRITICAL):
Duplicate content creates redundant documents and MUST be removed:
- Same \\title{...} appearing multiple times → Keep only the first occurrence
- Same \\begin{abstract}...\\end{abstract} text appearing multiple times → Keep only the first occurrence
- Same \\section{...Title} with identical or very similar content appearing multiple times → Keep only the first occurrence
- Large identical paragraph/text blocks appearing multiple times → Keep only the first occurrence
- When fixing errors, ALWAYS check for and remove duplicate content, keeping ONLY the first occurrence

SYNTAX AND STRUCTURAL ERRORS TO DETECT:
1. DUPLICATE TAGS (CRITICAL - these cause errors and must be removed):
   - Multiple \\documentclass declarations (keep only first)
   - Multiple \\begin{document} tags (keep only first)
   - Multiple \\end{document} tags (keep only first)
   - Duplicate \\begin{env}/\\end{env} pairs (remove duplicates)
2. DUPLICATE CONTENT (CRITICAL - creates redundant documents):
   - Multiple identical \\title{...} declarations (keep only first)
   - Multiple identical \\begin{abstract}...\\end{abstract} blocks (keep only first)
   - Multiple sections with same title and similar content (keep only first)
   - Identical large text blocks/paragraphs (keep only first)
3. Missing or unmatched \\begin{...}/\\end{...} pairs
4. Unmatched braces { }, brackets [ ], parentheses ( )
5. Undefined control sequences
6. Package conflicts or missing packages
7. Incorrect list nesting (enumerate inside itemize improperly)
8. Malformed commands (\\textbackslash{} instead of \\) 
9. Duplicate sections, subsections, or environments
10. Orphaned content outside document environment
11. Missing document structure elements

LaTeX EXPERTISE:
- Document structure: Preamble (packages, metadata) + ONE \\begin{document}...\\end{document} body
- Command syntax: \\command{argument}, proper escaping
- Environment rules: Each \\begin{env} requires exactly one \\end{env}
- Nesting rules: Proper environment nesting (no invalid cross-nesting)
- Common packages: amsmath, graphicx, hyperref, booktabs, float, caption, subcaption
- Math mode: $...$, $$...$$, \\[...\\], equation environments
- Fix strategy: Fix ALL errors, remove duplicates, ensure single valid structure

FIXING PROCESS:
1. First, parse and count all \\begin{document} and \\end{document} occurrences
2. If multiple found, keep ONLY the first pair, remove all others
3. Verify all environments are properly matched
4. Check all braces, brackets, parentheses are balanced
5. Fix all syntax errors
6. Ensure document is valid and compilable
7. Return the complete, fixed document starting with \\documentclass`;

    let prompt = basePrompt;

    // Add memory context if available
    if (memoryContext && memoryContext.trim()) {
      prompt += `\n\nPROJECT CONTEXT (from memory):\n${memoryContext}`;
    }

    // Add user-specific task if provided
    if (userPrompt && userPrompt.trim()) {
      prompt += `\n\nYOUR TASK:\n${userPrompt}`;
    }

    return prompt;
  }

  /**
   * Auto-detect LaTeX errors in text
   * @param {string} text - LaTeX text to analyze
   * @returns {Array} Array of error objects { type, description, line }
   */
  detectLaTeXErrors(text) {
    const errors = [];
    const lines = text.split('\n');

    lines.forEach((line, index) => {
      const lineNum = index + 1;
      const trimmed = line.trim();

      // Check for undefined control sequences (basic pattern)
      const undefinedPattern = /\\([A-Za-z]+)\{/g;
      const matches = [...trimmed.matchAll(undefinedPattern)];
      // Note: Full detection would require knowing all valid commands, this is simplified

      // Check for unmatched braces
      const openBraces = (line.match(/\{/g) || []).length;
      const closeBraces = (line.match(/\}/g) || []).length;
      if (Math.abs(openBraces - closeBraces) > 0) {
        // This is a simple check - full detection would require tracking across lines
        // But we'll flag it for the AI to handle
      }

      // Check for environment mismatches (basic)
      const beginMatches = (line.match(/\\begin\{/g) || []).length;
      const endMatches = (line.match(/\\end\{/g) || []).length;
      // Full detection requires tracking across lines, simplified here

      // Check for malformed commands
      if (line.includes('\\textbackslash{}')) {
        errors.push({
          type: 'malformed_command',
          description: 'Found \\textbackslash{} - should be \\',
          line: lineNum
        });
      }

      // Check for common syntax issues
      if (trimmed.includes('\\subsection') && trimmed.includes('\\begin{itemize}')) {
        // Potential nesting issue - flag for review
      }
    });

    // Track environments across lines
    const beginEnvs = [];
    const endEnvs = [];
    lines.forEach((line, index) => {
      const beginMatch = line.match(/\\begin\{([^}]+)\}/);
      const endMatch = line.match(/\\end\{([^}]+)\}/);
      if (beginMatch) {
        beginEnvs.push({ name: beginMatch[1], line: index + 1 });
      }
      if (endMatch) {
        endEnvs.push({ name: endMatch[1], line: index + 1 });
      }
    });

    // Check for environment mismatches
    if (beginEnvs.length !== endEnvs.length) {
      errors.push({
        type: 'environment_mismatch',
        description: `Mismatched environments: ${beginEnvs.length} \\begin found, ${endEnvs.length} \\end found`,
        line: 1
      });
    }

    // CRITICAL: Detect duplicate document tags (these are errors!)
    const documentClassMatches = text.match(/\\documentclass\[[^\]]*\]\{[^\}]*\}/g);
    const documentClassCount = documentClassMatches ? documentClassMatches.length : 0;
    if (documentClassCount > 1) {
      errors.push({
        type: 'duplicate_tag',
        description: `CRITICAL: Found ${documentClassCount} \\documentclass declarations (should be exactly 1). Duplicate tags cause compilation errors and must be removed.`,
        line: 1
      });
    }

    const beginDocMatches = text.match(/\\begin\{document\}/g);
    const beginDocCount = beginDocMatches ? beginDocMatches.length : 0;
    if (beginDocCount > 1) {
      errors.push({
        type: 'duplicate_tag',
        description: `CRITICAL: Found ${beginDocCount} \\begin{document} tags (should be exactly 1). Duplicate tags cause compilation errors and must be removed.`,
        line: 1
      });
    }

    const endDocMatches = text.match(/\\end\{document\}/g);
    const endDocCount = endDocMatches ? endDocMatches.length : 0;
    if (endDocCount > 1) {
      errors.push({
        type: 'duplicate_tag',
        description: `CRITICAL: Found ${endDocCount} \\end{document} tags (should be exactly 1). Duplicate tags cause compilation errors and must be removed.`,
        line: 1
      });
    }
    
    // Check for duplicate content (titles, abstracts)
    const titleMatches = text.match(/\\title\{([^}]+)\}/g);
    if (titleMatches && titleMatches.length > 1) {
      const titles = titleMatches.map(m => {
        const match = m.match(/\\title\{([^}]+)\}/);
        return match ? match[1].trim().toLowerCase() : '';
      });
      const uniqueTitles = new Set(titles);
      if (uniqueTitles.size < titles.length) {
        errors.push({
          type: 'duplicate_content',
          description: `CRITICAL: Duplicate title found. Same \\title{...} appears ${titleMatches.length} times. Keep only the first occurrence.`,
          line: 1
        });
      }
    }
    
    // Check for duplicate abstracts (simple check - same length/content)
    const abstractMatches = text.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/g);
    if (abstractMatches && abstractMatches.length > 1) {
      const abstracts = abstractMatches.map(m => {
        const match = m.match(/\\begin\{abstract\}([\s\S]*?)\\end\{abstract\}/);
        return match ? match[1].trim() : '';
      });
      // Simple check: if abstracts are identical or very similar (using first 100 chars as key)
      const abstractKeys = abstracts.map(a => a.length > 50 ? a.substring(0, 100) : a);
      const uniqueAbstracts = new Set(abstractKeys);
      if (uniqueAbstracts.size < abstracts.length) {
        errors.push({
          type: 'duplicate_content',
          description: `CRITICAL: Duplicate abstract found. Same \\begin{abstract}...\\end{abstract} content appears ${abstractMatches.length} times. Keep only the first occurrence.`,
          line: 1
        });
      }
    }

    return errors;
  }

  /**
   * Handle question with intelligent routing to specialized methods
   * @param {string} message - User's message
   * @param {Object} options - Options including projectId, currentDocument, memoryContext, etc.
   * @returns {Promise<Object>} AI response
   */
  async handleQuestion(message, options = {}) {
    const {
      projectId,
      currentDocument,
      memoryContext: providedMemoryContext,
      context: requestContext,
      ...otherOptions
    } = options;

    // Get memory context if not provided
    let memoryContext = providedMemoryContext || '';
    if (!memoryContext && projectId) {
      memoryContext = await this.getMemoryContext(projectId, message);
    }

    // Classify question type
    const classification = this.questionRouter.classifyQuestionType(message, {
      currentDocument,
      ...requestContext
    });

    console.log('🎯 Question classified:', {
      type: classification.type,
      confidence: classification.confidence,
      reasoning: classification.reasoning
    });

    // Route to appropriate method based on classification
    switch (classification.type) {
      case 'latex_fix':
        // Extract LaTeX text from context, currentDocument, or message
        let latexText = currentDocument;
        
        // Check for selected text in context
        if (!latexText && requestContext?.selectedText) {
          latexText = requestContext.selectedText;
        }
        
        // Check for LaTeX code block in message
        if (!latexText) {
          const codeBlockMatch = message.match(/```(?:latex)?\s*([\s\S]*?)```/);
          if (codeBlockMatch) {
            latexText = codeBlockMatch[1];
          }
        }
        
        // Fallback to full message if no LaTeX found
        if (!latexText) {
          latexText = message;
        }
        
        // Extract user prompt (instructions) - remove code blocks if present
        const userInstructions = message.replace(/```[\s\S]*?```/g, '').trim() || message;
        
        return await this.fixLaTeXErrors(latexText, [], memoryContext, userInstructions, true);

      case 'latex_generate':
        return await this.generateLaTeXContent(message, { currentDocument, ...requestContext }, memoryContext);

      case 'latex_analyze':
        // Extract LaTeX text from context, currentDocument, or message
        let textToAnalyze = currentDocument;
        
        // Check for selected text in context
        if (!textToAnalyze && requestContext?.selectedText) {
          textToAnalyze = requestContext.selectedText;
        }
        
        // Check for LaTeX code block in message
        if (!textToAnalyze) {
          const codeBlockMatch = message.match(/```(?:latex)?\s*([\s\S]*?)```/);
          if (codeBlockMatch) {
            textToAnalyze = codeBlockMatch[1];
          }
        }
        
        // Fallback to full message if no LaTeX found
        if (!textToAnalyze) {
          textToAnalyze = message;
        }
        
        return await this.analyzeLaTeX(textToAnalyze, { ...requestContext }, memoryContext);

      case 'latex_syntax_help':
        // Extract command from message
        const commandMatch = message.match(/(?:how to|what is|usage of|syntax for|command for)\s+(.+)/i);
        const command = commandMatch ? commandMatch[1].trim() : message;
        return await this.suggestLaTeXCommands(command, { ...requestContext }, memoryContext);

      case 'question_answering':
        // Use chat with enhanced prompt including memory context
        const qaSystemPrompt = memoryContext
          ? `${this.getSystemPrompt()}\n\nPROJECT CONTEXT:\n${memoryContext}`
          : this.getSystemPrompt();
        return await this.chat([
          { role: 'system', content: qaSystemPrompt },
          { role: 'user', content: message }
        ], { temperature: 0.7, ...otherOptions });

      case 'general_chat':
      default:
        // Use chat with memory context if available
        const generalSystemPrompt = memoryContext
          ? `${this.getSystemPrompt()}\n\nPROJECT CONTEXT:\n${memoryContext}`
          : this.getSystemPrompt();
        return await this.chat([
          { role: 'system', content: generalSystemPrompt },
          { role: 'user', content: message }
        ], { temperature: 0.7, ...otherOptions });
    }
  }

  /**
   * Get the system prompt for general-purpose document assistance.
   */
         getSystemPrompt() {
           return `You are an AI document assistant specialized in LaTeX-first document creation and editing.

CORE CAPABILITIES:
- Create complete LaTeX documents from natural-language requests
- Refine existing documents while preserving user-approved content
- Support reports, slides, CVs, letters, invoices, proposals, and technical docs
- Suggest structure, tone, formatting, and section improvements
- Provide practical BibTeX entries when references are requested

IMPORTANT GUIDELINES:
- Be concise and actionable by default.
- Ask focused clarifying questions when requirements are ambiguous.
- Prefer compilable LaTeX output when code is requested.
- Keep edits scoped to the user request; do not rewrite unrelated sections.
- Never block user requests because of topic domain.

Remember: this is a general document assistant, not a research-only assistant.`;
  }

  /**
   * Compatibility helper for legacy callers.
   * The assistant now supports all document intents, so this always returns true.
   */
  isResearchRelated(content) {
    return true;
  }

  /**
   * Send a chat completion request to AI Model
   */
  async chat(messages, options = {}) {
    // Check if API key is properly configured
    if (!this.apiKey || this.apiKey === 'sk-or-v1-your-api-key-here') {
      console.warn('⚠️ OpenRouter API key not configured. Using mock responses.');
      return await this.getMockResponse(messages, options);
    }

    // Return mock response in mock mode
    if (this.mockMode) {
      console.log('🎭 Mock mode enabled. Using simulated responses.');
      return await this.getMockResponse(messages, options);
    }

    // Check rate limits before making request
    if (!rateLimiter.canMakeRequest()) {
      const stats = rateLimiter.getUsageStats();
      const timeUntilReset = rateLimiter.getFormattedTimeUntilReset();
      throw new Error(`Rate limit exceeded. ${stats.requestsRemaining} requests remaining today. Resets in ${timeUntilReset}.`);
    }

    // Check if messages already contain a system prompt
    const hasSystemPrompt = messages.some(msg => msg.role === 'system');
    
    let messagesWithSystem = messages;
    if (!hasSystemPrompt) {
      // Only add default system prompt if one isn't already provided
      const systemPrompt = this.getSystemPrompt();
      messagesWithSystem = [
        { role: 'system', content: systemPrompt },
        ...messages
      ];
    }

    const requestBody = {
      model: this.model,
      messages: messagesWithSystem,
      temperature: options.temperature || this.temperature,
      max_tokens: (() => {
        const requested = Number.isFinite(options.maxTokens) ? options.maxTokens : this.maxTokens;
        return Math.max(256, Math.min(requested, 12000));
      })(),
      stream: options.stream || false
    };

    try {
      const response = await this.makeRequest(requestBody);
      
      console.log('🎯 Response processing:');
      console.log('  Response OK:', response.ok);
      console.log('  Response Status:', response.status);
      
      if (!response.ok) {
        // Try to get error details from response body
        let errorDetails = '';
        try {
          const errorData = await response.json();
          errorDetails = errorData.error ? ` - ${errorData.error.message || errorData.error}` : '';
          console.log('  Error Details:', errorData);
        } catch (e) {
          console.log('  Could not parse error response');
        }
        
        if (response.status === 429) {
          throw new Error(`Rate limit exceeded. Please wait before making another request. Status: ${response.status}${errorDetails}`);
        } else if (response.status === 401) {
          throw new Error(`Invalid API key. Please check your OPENROUTER_API_KEY. Status: ${response.status}${errorDetails}`);
        } else if (response.status === 403) {
          throw new Error(`Access forbidden. Please check your API key permissions. Status: ${response.status}${errorDetails}`);
        } else {
          throw new Error(`HTTP error! Status: ${response.status}${errorDetails}`);
        }
      }

      const data = await response.json();
      console.log('📦 Response Data:', JSON.stringify(data, null, 2));
      
      if (data.choices && data.choices.length > 0) {
        // Record successful request in rate limiter
        const tokenCount = data.usage ? (data.usage.prompt_tokens + data.usage.completion_tokens) : 0;
        rateLimiter.recordRequest(tokenCount);
        
        return {
          success: true,
          content: data.choices[0].message.content,
          usage: data.usage,
          model: data.model
        };
      } else {
        throw new Error('No response content received');
      }
    } catch (error) {
      console.error('DeepSeek API error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Make HTTP request with retry logic
   */
  async makeRequest(requestBody, retryCount = 0) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    // Debug logging
    console.log('  Endpoint:', this.endpoint);
    console.log('  API Key:', this.apiKey ? 'FOUND' : 'MISSING');
    console.log('  Model:', this.model);
    console.log('  Request Body:', JSON.stringify(requestBody, null, 2));

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': typeof window !== 'undefined' ? window.location.origin : (process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'),
          'X-Title': 'GenLaTeX LaTeX Editor'
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      
      // Debug response
      console.log('📡 DeepSeek API Response:');
      console.log('  Status:', response.status);
      console.log('  Status Text:', response.statusText);
      console.log('  Headers:', Object.fromEntries(response.headers.entries()));
      
      return response;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }
      
      if (retryCount < this.maxRetries) {
        // Special handling for rate limit errors
        if (error.message.includes('429') || error.message.includes('Rate limit')) {
          const backoffTime = Math.min(1000 * Math.pow(2, retryCount), 30000); // Max 30 seconds
          console.log(`Rate limit hit. Retrying in ${backoffTime}ms (${retryCount + 1}/${this.maxRetries})...`);
          await this.delay(backoffTime);
        } else {
          console.log(`Retrying request (${retryCount + 1}/${this.maxRetries})...`);
          await this.delay(1000 * (retryCount + 1)); // Exponential backoff
        }
        return this.makeRequest(requestBody, retryCount + 1);
      }
      
      throw error;
    }
  }

  /**
   * Delay utility for retries
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Analyze LaTeX text and provide suggestions
   */
  async analyzeLaTeX(text, context = {}, memoryContext = '') {
    const expertPrompt = this.getLaTeXExpertPrompt(
      memoryContext,
      'Analyze LaTeX and suggest improvements. Focus on: clarity, structure, style consistency, LaTeX best practices, and compile reliability. Be concise and actionable.'
    );

    const messages = [
      {
        role: 'system',
        content: expertPrompt
      },
      {
        role: 'user',
        content: `Please analyze this LaTeX text and provide suggestions:\n\n${text}\n\nContext: ${JSON.stringify(context)}`
      }
    ];

    return this.chat(messages, { temperature: 0.3 });
  }

  /**
   * Generate LaTeX content based on requirements
   */
  async generateLaTeXContent(requirements, context = {}, memoryContext = '') {
    const expertPrompt = this.getLaTeXExpertPrompt(
      memoryContext,
      `Generate high-quality LaTeX content based on: ${requirements}. Use proper syntax, suitable document structure, and production-ready formatting. Return only LaTeX code unless the user explicitly asks for explanation.`
    );

    const messages = [
      {
        role: 'system',
        content: expertPrompt
      },
      {
        role: 'user',
        content: `Generate LaTeX content for: ${requirements}\n\nContext: ${JSON.stringify(context)}`
      }
    ];

    return this.chat(messages, { temperature: 0.7 });
  }

  /**
   * Modify a specific section of a LaTeX document
   * @param {string} fullFileContent - Complete LaTeX document
   * @param {Object} sectionInfo - Section information { type, start, end, content, name, beginLine, endLine }
   * @param {string} userRequest - User's modification request
   * @param {string} memoryContext - Memory/chat context
   * @returns {Promise<Object>} Result with modified content
   */
  async modifyLaTeXSection(fullFileContent, sectionInfo, userRequest, memoryContext = '') {
    const expertPrompt = this.getLaTeXExpertPrompt(
      memoryContext,
      `Modify ONLY the specified section of a LaTeX document. User request: "${userRequest}"`
    );

    const messages = [
      {
        role: 'system',
        content: expertPrompt + `\n\nCRITICAL RULES FOR SECTION MODIFICATION:
1. You are modifying ONLY the "${sectionInfo.type}" section${sectionInfo.name ? ` ("${sectionInfo.name}")` : ''}
2. RETURN THE COMPLETE DOCUMENT with the modified section
3. DO NOT return only the modified section - return EVERYTHING from \\documentclass to \\end{document}
4. Keep all other sections EXACTLY as they are - no changes outside the target section
5. Only modify the content between these boundaries:
   - Start position: ${sectionInfo.start} (line ${sectionInfo.beginLine})
   - End position: ${sectionInfo.end} (line ${sectionInfo.endLine})

MANDATORY OUTPUT FORMAT:
\`\`\`latex
\\documentclass[...]{...}
... (complete preamble - UNCHANGED) ...
\\begin{document}
... (everything before the target section - UNCHANGED) ...
\\begin{${sectionInfo.type}}
... (YOUR MODIFIED CONTENT HERE) ...
\\end{${sectionInfo.type}}
... (everything after the target section - UNCHANGED) ...
\\end{document}
\`\`\`

VALIDATION CHECKLIST:
☑ Includes \\documentclass
☑ Includes \\begin{document}
☑ Includes \\end{document}
☑ All sections before target are preserved
☑ All sections after target are preserved
☑ Only target section is modified`
      },
      {
        role: 'user',
        content: `FULL DOCUMENT CONTENT (${fullFileContent.length} characters):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${fullFileContent}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

SECTION TO MODIFY:
Type: ${sectionInfo.type}
${sectionInfo.name ? `Name: ${sectionInfo.name}` : ''}
Lines: ${sectionInfo.beginLine} to ${sectionInfo.endLine}

CURRENT SECTION CONTENT:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${sectionInfo.innerContent || sectionInfo.content}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

USER REQUEST: ${userRequest}

REMEMBER: 
- Return the COMPLETE document (${fullFileContent.length} chars)
- Only modify the ${sectionInfo.type} section
- Preserve everything else EXACTLY as is
- Start with \\documentclass and end with \\end{document}`
      }
    ];

    const result = await this.chat(messages, { temperature: 0.5 });
    
    // Validate that result contains full document structure
    if (result.success) {
      const content = result.content;
      const hasDocClass = content.includes('\\documentclass');
      const hasBeginDoc = content.includes('\\begin{document}');
      const hasEndDoc = content.includes('\\end{document}');
      
      if (!hasDocClass || !hasBeginDoc || !hasEndDoc) {
        console.error('❌ AI returned incomplete document in modifyLaTeXSection');
        console.error('   Has \\documentclass:', hasDocClass);
        console.error('   Has \\begin{document}:', hasBeginDoc);
        console.error('   Has \\end{document}:', hasEndDoc);
        console.error('   Content length:', content.length, 'vs expected:', fullFileContent.length);
        
        return {
          success: false,
          error: 'AI returned incomplete document - missing required LaTeX document structure',
          partialContent: content,
          validationDetails: {
            hasDocClass,
            hasBeginDoc,
            hasEndDoc,
            contentLength: content.length,
            expectedLength: fullFileContent.length
          }
        };
      }
      
      // Additional validation: check that content length is reasonable
      const lengthRatio = content.length / fullFileContent.length;
      if (lengthRatio < 0.5) {
        console.warn(`⚠️ Modified content is suspiciously short: ${content.length} vs ${fullFileContent.length} (ratio: ${lengthRatio.toFixed(2)})`);
        return {
          success: false,
          error: `Modified content is too short (${Math.round(lengthRatio * 100)}% of original). AI may have returned only part of the document.`,
          partialContent: content,
          validationDetails: {
            lengthRatio,
            contentLength: content.length,
            expectedLength: fullFileContent.length
          }
        };
      }
    }
    
    return result;
  }

  /**
   * Modify selected/highlighted text in a LaTeX document
   * @param {string} fullFileContent - Complete LaTeX document
   * @param {string} selectedText - The highlighted/selected text
   * @param {Object} boundaries - Selection boundaries { start, end, startLine, endLine }
   * @param {string} userRequest - User's modification request
   * @param {string} memoryContext - Memory/chat context
   * @returns {Promise<Object>} Result with modified content
   */
  async modifyLaTeXSelection(fullFileContent, selectedText, boundaries, userRequest, memoryContext = '') {
    const expertPrompt = this.getLaTeXExpertPrompt(
      memoryContext,
      `Modify only the user-selected text in a LaTeX document. User request: "${userRequest}"`
    );

    const beforeSelection = fullFileContent.substring(0, boundaries.start);
    const afterSelection = fullFileContent.substring(boundaries.end);

    const messages = [
      {
        role: 'system',
        content: expertPrompt + `\n\nCRITICAL RULES FOR SELECTION MODIFICATION:
1. User has selected specific text to modify (lines ${boundaries.startLine}-${boundaries.endLine})
2. RETURN THE COMPLETE DOCUMENT with only the selected portion modified
3. Keep everything before and after the selection EXACTLY as is
4. The selection boundaries are:
   - Start: position ${boundaries.start}, line ${boundaries.startLine}
   - End: position ${boundaries.end}, line ${boundaries.endLine}

MANDATORY OUTPUT FORMAT:
\`\`\`latex
(everything before selection - UNCHANGED)
(MODIFIED SELECTION HERE)
(everything after selection - UNCHANGED)
\`\`\`

The document must be complete and valid LaTeX.`
      },
      {
        role: 'user',
        content: `SELECTED TEXT TO MODIFY:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${selectedText}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

USER REQUEST: ${userRequest}

CONTEXT BEFORE SELECTION (last 200 chars):
${beforeSelection.slice(-200)}

CONTEXT AFTER SELECTION (first 200 chars):
${afterSelection.slice(0, 200)}

Return the COMPLETE document with only this selected text modified.`
      }
    ];

    return this.chat(messages, { temperature: 0.5 });
  }

  /**
   * Fix LaTeX errors and improve code
   */
  async fixLaTeXErrors(text, errors = [], memoryContext = '', userPrompt = '', autoDetect = true) {
    // Auto-detect errors if not provided
    let detectedErrors = errors;
    if ((!errors || errors.length === 0) && autoDetect) {
      detectedErrors = this.detectLaTeXErrors(text);
      console.log('🔍 Auto-detected LaTeX errors:', detectedErrors.length);
    }

    const taskPrompt = userPrompt || 
      (detectedErrors && detectedErrors.length > 0
        ? `Fix all LaTeX errors found: ${detectedErrors.map(e => e.description || e).join('; ')}. IMPORTANT: This includes removing duplicate tags (\\documentclass, \\begin{document}, \\end{document}) which cause errors.`
        : 'Fix all LaTeX errors automatically. This INCLUDES removing duplicate tags (\\documentclass, \\begin{document}, \\end{document}) which cause compilation errors. Find ALL bugs and fix them in-place without duplicating sections.');

    const expertPrompt = this.getLaTeXExpertPrompt(memoryContext, taskPrompt);

    const errorDescription = detectedErrors && detectedErrors.length > 0
      ? detectedErrors.map(e => {
          if (typeof e === 'string') return e;
          return `Line ${e.line || '?'}: ${e.type || 'error'}: ${e.description || e}`;
        }).join('\n')
      : 'No specific errors provided - detect and fix all errors automatically';

    const messages = [
      {
        role: 'system',
        content: expertPrompt
      },
      {
        role: 'user',
        content: `CRITICAL: Remove ALL duplicates and fix ALL errors.

THE INPUT HAS DUPLICATES - You MUST return ONLY THE FIRST COMPLETE DOCUMENT.

RULES (MANDATORY):
1. Count \\documentclass declarations. If count > 1, extract ONLY from first \\documentclass to its matching \\end{document}
2. Count \\begin{document} tags. If count > 1, keep ONLY the first one
3. Count \\end{document} tags. If count > 1, keep ONLY the one that matches the first \\begin{document} (use balanced counting)
4. Remove duplicate titles - if same \\title{...} appears twice, keep ONLY the first
5. Remove duplicate abstracts - if same \\begin{abstract}...\\end{abstract} appears twice, keep ONLY the first
6. Remove duplicate sections - if same \\section{Title} with similar content appears twice, keep ONLY the first
7. Fix all syntax errors (unmatched braces, environments, etc.)

HOW TO EXTRACT FIRST DOCUMENT:
- Find first \\documentclass
- Find first \\begin{document} after it
- Use balanced counting: start depth=1, count \\begin{document} (+1) and \\end{document} (-1)
- When depth reaches 0, that's your matching \\end{document}
- Extract everything from first \\documentclass to that matching \\end{document}

RETURN FORMAT (REQUIRED):
\`\`\`latex
\\documentclass[...]{...}
... (first document ONLY, no duplicates) ...
\\end{document}
\`\`\`

CRITICAL: NO explanations. NO comments. NO second document. NO duplicate content.

Errors detected: ${errorDescription}

LaTeX to fix:
${text}

Return the complete fixed LaTeX (FIRST document only, no duplicates):`
      }
    ];

    return this.chat(messages, { temperature: 0.1 });
  }

  /**
   * Suggest LaTeX commands and syntax
   */
  async suggestLaTeXCommands(partialCommand, context = {}, memoryContext = '') {
    const expertPrompt = this.getLaTeXExpertPrompt(
      memoryContext,
      `Suggest LaTeX commands for: ${partialCommand}. Provide the command, description, syntax, and usage examples.`
    );

    const messages = [
      {
        role: 'system',
        content: expertPrompt
      },
      {
        role: 'user',
        content: `Suggest LaTeX commands for: "${partialCommand}"\n\nContext: ${JSON.stringify(context)}`
      }
    ];

    return this.chat(messages, { temperature: 0.5 });
  }

  /**
   * Generate an abstract/summary block based on document content.
   */
  async generateAbstract(content, context = {}, memoryContext = '') {
    const expertPrompt = this.getLaTeXExpertPrompt(
      memoryContext,
      'Generate a high-quality abstract/summary from the provided document content. Target 120-220 words unless user specifies otherwise. Return only LaTeX-formatted output.'
    );

    const messages = [
      {
        role: 'system',
        content: expertPrompt
      },
      {
        role: 'user',
        content: `Generate an abstract/summary for this document:\n\n${content}\n\nContext: ${JSON.stringify(context)}`
      }
    ];

    return this.chat(messages, { temperature: 0.6 });
  }

  /**
   * Improve writing style and clarity
   */
  async improveWriting(text, style = 'professional') {
    const messages = [
      {
        role: 'system',
        content: `You are a writing expert. Improve the provided text for better ${style} style, clarity, and readability. Return the improved text with brief explanations of changes.`
      },
      {
        role: 'user',
        content: `Improve this text for ${style} writing:\n\n${text}`
      }
    ];

    return this.chat(messages, { temperature: 0.5 });
  }

  /**
   * Generate citations and references
   */
  async generateCitations(topic, count = 5) {
    const messages = [
      {
        role: 'system',
        content: `Generate realistic, high-quality references for the requested topic. Return valid BibTeX entries.`
      },
      {
        role: 'user',
        content: `Generate ${count} BibTeX citations for: ${topic}`
      }
    ];

    return this.chat(messages, { temperature: 0.7 });
  }

  /**
   * Check for plagiarism and suggest improvements
   */
  async checkPlagiarism(text) {
    const messages = [
      {
        role: 'system',
        content: `You are a plagiarism detection expert. Analyze the text for potential plagiarism issues and suggest improvements for originality.`
      },
      {
        role: 'user',
        content: `Check this text for plagiarism and suggest improvements:\n\n${text}`
      }
    ];

    return this.chat(messages, { temperature: 0.3 });
  }

  /**
   * Generate clarifying questions to improve document quality.
   * (Method name kept for backward compatibility.)
   */
  async generateResearchQuestions(topic, context = {}) {
    const messages = [
      {
        role: 'system',
        content: `You are a document planning assistant. Generate practical clarifying questions that help produce a stronger document output.`
      },
      {
        role: 'user',
        content: `Generate focused document-planning questions for: ${topic}\n\nContext: ${JSON.stringify(context)}`
      }
    ];

    return this.chat(messages, { temperature: 0.7 });
  }

  /**
   * Summarize content
   */
  async summarizeContent(text, maxLength = 200) {
    const messages = [
      {
        role: 'system',
        content: `You are a summarization expert. Create a concise summary of the provided text in ${maxLength} words or less.`
      },
      {
        role: 'user',
        content: `Summarize this text:\n\n${text}`
      }
    ];

    return this.chat(messages, { temperature: 0.3 });
  }

  /**
   * Translate content
   */
  async translateContent(text, targetLanguage = 'English') {
    const messages = [
      {
        role: 'system',
        content: `You are a translation expert. Translate the provided text to ${targetLanguage} while maintaining the original meaning and style.`
      },
      {
        role: 'user',
        content: `Translate this text to ${targetLanguage}:\n\n${text}`
      }
    ];

    return this.chat(messages, { temperature: 0.3 });
  }

  /**
   * Generate mock response for testing
   */
  getMockResponse(messages, options = {}) {
    console.log('🎭 Mock Mode: Generating fake AI response');
    
    // Extract the last user message for context
    const lastMessage = messages[messages.length - 1];
    const userContent = lastMessage?.content || 'test message';
    
    let mockContent;
    if (userContent.includes('analyze') || userContent.includes('suggest')) {
      mockContent = `Mock Analysis: Text is well-structured. Add specific examples and improve paragraph flow.`;
    } else if (userContent.includes('Generate LaTeX content') || userContent.includes('generate') || userContent.includes('create') || userContent.includes('latex')) {
      mockContent = `\\section{Introduction}

This document presents a practical overview of the requested topic and defines the intended scope.

\\subsection{Background}

Computational science has grown significantly, driven by machine learning and high-performance computing advances.

\\subsection{Objectives}

The primary objectives include:
\\begin{enumerate}
\\item Analyze current computational approaches
\\item Identify methodology limitations  
\\item Propose novel solutions
\\item Validate findings through experiments
\\end{enumerate}

\\section{Methodology}

Our approach combines theoretical analysis with practical implementation using state-of-the-art tools.

\\section{Expected Outcomes}

We expect measurable improvements based on the proposed approach and constraints.

\\section{Conclusion}

This document provides a clear, actionable foundation for implementation and review.`;
    } else if (userContent.includes('fix') || userContent.includes('error')) {
      mockContent = `Fixed LaTeX Code:

\`\`\`latex
\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{amsmath,amsfonts,amssymb}
\\usepackage{graphicx}
\\usepackage{booktabs}
\\usepackage{url}
\\usepackage{hyperref}
\\title{test_sample}
\\author{Your Name}
\\date{\\today}
\\begin{document}
\\maketitle
\\begin{abstract}
Your abstract goes here.
\\end{abstract}
\\textbf{Keywords:} keyword1, keyword2, keyword3
\\section{Introduction}
Your introduction section.
\\end{document}
\`\`\`

Added missing \`\\usepackage{hyperref}\` package.`;
    } else if (userContent.includes('conflict of interest') || userContent.includes('conflict')) {
      mockContent = `Analyzed document: Found existing conflict of interest section at line 45. Modified existing section.

\`\`\`latex
\\section{Conflict of Interest}

The authors declare that they have no known competing financial interests or personal relationships that could have appeared to influence the work reported in this document.
\`\`\``;
    } else if (userContent.includes('acknowledgment') || userContent.includes('acknowledgement')) {
      mockContent = `Added acknowledgments section before \\end{document}

\`\`\`latex
\\section*{Acknowledgments}

We thank the anonymous reviewers for their valuable comments and suggestions.
\`\`\``;
    } else if (userContent.includes('conclusion')) {
      mockContent = `Added conclusion section before \\end{document}

\`\`\`latex
\\section{Conclusion}

This document outlines clear findings and practical next steps for future improvements.
\`\`\``;
    } else if (userContent.includes('methodology') || userContent.includes('method')) {
      mockContent = `Added methodology section before \\end{document}

\`\`\`latex
\\section{Methodology}

Our approach combines theoretical analysis with practical implementation. The methodology includes data collection, analysis, and validation phases.
\`\`\``;
    } else if (userContent.includes('results')) {
      mockContent = `Added results section before \\end{document}

\`\`\`latex
\\section{Results}

The experimental results demonstrate significant improvements over baseline methods. Key findings include enhanced performance and reduced computational complexity.
\`\`\``;
    } else if (userContent.includes('discussion')) {
      mockContent = `Added discussion section before \\end{document}

\`\`\`latex
\\section{Discussion}

The results indicate promising directions for future iterations. Limitations include computational constraints and data availability.
\`\`\``;
    } else if (userContent.includes('abstract')) {
      mockContent = `\\begin{abstract}
This is a mock abstract for testing. It summarizes key findings and contributions.
\\end{abstract}`;
    } else if (userContent.includes('citation') || userContent.includes('reference')) {
      mockContent = `@article{mock2024,
  title={Mock Reference Entry},
  author={Test, Author},
  journal={Mock Journal},
  year={2024}
}`;
    } else {
      mockContent = `Mock response for "${userContent}". I'm an AI document assistant focused on LaTeX generation and editing.`;
    }

    // Simulate API response delay
    return new Promise(resolve => {
      setTimeout(() => {
        resolve({
          success: true,
          content: mockContent,
          usage: {
            prompt_tokens: 50,
            completion_tokens: 100,
            total_tokens: 150
          },
          model: `${this.model} (mock)`
        });
      }, 500); // 500ms delay to simulate real API
    });
  }
}

// Export singleton instance
export const aiModelClient = new AIModelClient();
