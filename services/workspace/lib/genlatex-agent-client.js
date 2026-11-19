/**
 * GenLaTeX Agent Client
 * Communicates with genlatex-agent API for advanced AI tasks
 */

export class GenLatexAgentClient {
  constructor() {
    this.pythonApiUrl = process.env.GENLATEX_AGENT_URL || 'http://localhost:8000';
    this.agentToken = process.env.GENLATEX_AGENT_API_KEY || process.env.AGENT_API_TOKEN;
    // Increase timeout for document generation (can take 60-120 seconds)
    this.timeout = parseInt(process.env.GENLATEX_AGENT_TIMEOUT) || 120000; // 2 minutes
    this.enabled = process.env.GENLATEX_AGENT_ENABLED !== 'false';
    this.maxRetries = 2; // Reduce retries since we have longer timeout

    console.log('🤖 GenLaTeX Agent Client Configuration:');
    console.log('  Python API URL:', this.pythonApiUrl);
    console.log('  Timeout:', this.timeout);
    console.log('  Enabled:', this.enabled);
  }

  /**
   * Check if genlatex-agent is enabled and running
   */
  isEnabled() {
    return this.enabled;
  }

  /**
   * Make HTTP request to Python genlatex-agent API (localhost:8000)
   */
  async makeRequest(endpoint, payload, retries = this.maxRetries) {
    if (!this.enabled) {
      throw new Error('GenLaTeX Agent is disabled');
    }

    const url = `${this.pythonApiUrl}${endpoint}`;
    console.log(`📡 Calling Python genlatex-agent at: ${url}`);

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        const headers = { 'Content-Type': 'application/json' };
        if (this.agentToken) {
          headers['Authorization'] = `Bearer ${this.agentToken}`;
        }
        const response = await fetch(url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        console.log(`📡 GenLaTeX Agent response: ${response.status} ${response.statusText}`);

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`❌ GenLaTeX Agent API error (${response.status}):`, errorText);
          throw new Error(`GenLaTeX Agent API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        console.log(`✅ GenLaTeX Agent response received from: ${endpoint}`);
        return data;

      } catch (error) {
        if (error.name === 'AbortError') {
          console.error(`⏱️ GenLaTeX Agent timeout on attempt ${attempt}/${retries}`);
          if (attempt === retries) {
            throw new Error('GenLaTeX Agent request timeout');
          }
        } else if (error.message.includes('fetch failed')) {
          console.error(`🔌 GenLaTeX Agent connection error on attempt ${attempt}/${retries}:`, error.message);
          if (attempt === retries) {
            throw new Error('GenLaTeX Agent is not running or unreachable at localhost:8000');
          }
        } else {
          console.error(`❌ GenLaTeX Agent error on attempt ${attempt}/${retries}:`, error.message);
          throw error;
        }

        // Wait before retry (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  /**
   * Generate/Write a paper via Python genlatex-agent API with polling
   */
  async makePaper({ prompt, content, context = {}, onStatusUpdate = null }) {
    try {
      console.log('🤖 Starting document generation via Python genlatex-agent...');

      // Step 1: Start document generation
      const startPayload = {
        prompt,
        content: content || '',
        context,
      };

      const startResponse = await this.makeRequest('/api/genlatex-agent/make-paper', startPayload);
      
      const documentId = startResponse.document_id ?? startResponse.paper_id;
      if (!startResponse.success || !documentId) {
        throw new Error(startResponse.error || 'Failed to start document generation');
      }
      console.log(`📄 Document generation started, id: ${documentId}`);

      // Step 2: Poll for status until completed, failed, or timeout (max 30 min at 2s = 900 attempts)
      const maxPollAttempts = 900;
      let attempt = 0;
      let lastStatus = 'in_progress';
      while (lastStatus === 'in_progress') {
        attempt++;
        if (attempt > maxPollAttempts) {
          console.error(`❌ document generation timed out after ${maxPollAttempts} polls (~30 min)`);
          return {
            success: false,
            error: 'document generation timed out',
            paper_id: documentId,
            citations: [],
          };
        }
        console.log(`🔄 Polling attempt ${attempt}...`);
        
        if (attempt > 1) { // Skip delay on first attempt
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between polls
        }

        try {
          const statusHeaders = {};
          if (this.agentToken) {
            statusHeaders['Authorization'] = `Bearer ${this.agentToken}`;
          }
          const statusResponse = await fetch(`${this.pythonApiUrl}/documents/${documentId}`, { headers: statusHeaders });
          
          if (!statusResponse.ok) {
            console.warn(`⚠️ Status poll failed (attempt ${attempt})`);
            continue;
          }

          const status = await statusResponse.json();
          console.log(`📊 Status: ${status.status}, Progress: ${status.progress || 0}% (attempt ${attempt})`);
          
          // Emit status update if callback provided
          if (onStatusUpdate && status.status === 'in_progress') {
            onStatusUpdate(status.message || 'Generating document...');
          }

          lastStatus = status.status; // Update last status
          
          if (status.status === 'completed') {
            // Step 3: Get content when done
            console.log('✅ document generation completed, fetching content...');
            const contentResponse = await fetch(`${this.pythonApiUrl}/documents/${documentId}/content`, { headers: statusHeaders });
            
            if (!contentResponse.ok) {
              throw new Error('Failed to fetch document content');
            }

            const contentData = await contentResponse.json();
            console.log('✅ Document content retrieved, length:', contentData.content?.length || 0);
            return {
              success: true,
              result: contentData.content || contentData.latex_content || '',
              citations: contentData.citations || [],
              paper_id: documentId,
            };

          } else if (status.status === 'failed') {
            // Canonical field is error_message; status.error kept for compatibility
            const errorMessage = status.error_message || status.error || 'document generation failed';
            console.error(`❌ document generation failed: ${errorMessage}`);
            throw new Error(errorMessage);

          } else if (status.status === 'in_progress') {
            // Continue polling - loop will continue automatically
            console.log(`🔄 Generation in progress (${status.progress || 0}%)...`);
            // Don't break or return - let the while loop continue
          } else {
            // Unknown status, log and regroup poll
            console.warn(`⚠️ Unknown status: ${status.status}, continuing to poll...`);
            lastStatus = 'in_progress'; // Force continuation
          }

        } catch (pollError) {
          // If poll returns an error status, break out (error is handled above)
          // Otherwise, log and continue polling
          if (pollError.message.includes('document generation failed')) {
            // Error was already thrown above, don't catch it again
            throw pollError;
          }
          console.warn(`⚠️ Poll error (attempt ${attempt}):`, pollError.message);
          // Continue polling for network errors etc.
        }
      }

    } catch (error) {
      console.error('Error in makePaper:', error);
      return {
        success: false,
        error: error.message,
        paper_id: null,
        citations: [],
      };
    }
  }

  /**
   * Review article – not available (GenLaTeX prompt-only mode).
   */
  async reviewArticle() {
    return { success: false, error: 'Not available (GenLaTeX prompt-only mode).', suggestions: [] };
  }

  /**
   * Fact check – not available (GenLaTeX prompt-only mode).
   */
  async factCheck() {
    return { success: false, error: 'Not available (GenLaTeX prompt-only mode).', verifiedFacts: [], issues: [] };
  }

  /**
   * Add citation (search-based) – not available (GenLaTeX prompt-only mode).
   */
  async addCitation() {
    return { success: false, error: 'Not available (GenLaTeX prompt-only mode).', citations: [] };
  }
}

// Export singleton instance
export const genlatexAgentClient = new GenLatexAgentClient();


