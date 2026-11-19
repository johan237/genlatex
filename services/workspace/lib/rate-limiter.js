/**
 * Rate Limiter for OpenRouter API
 * Tracks usage and provides rate limit information
 */

export class RateLimiter {
  constructor() {
    this.requests = [];
    this.tokens = 0;
    this.dailyLimit = 100; // requests per day
    this.tokenLimit = 100000; // tokens per day
    this.testMode = process.env.NODE_ENV === 'development' || process.env.AI_TEST_MODE === 'true';
  }

  /**
   * Check if we can make a request
   */
  canMakeRequest() {
    // Bypass rate limiting in test mode
    if (this.testMode) {
      return true;
    }
    
    const now = Date.now();
    const today = new Date(now).toDateString();
    
    // Filter requests from today
    const todayRequests = this.requests.filter(req => 
      new Date(req.timestamp).toDateString() === today
    );
    
    return todayRequests.length < this.dailyLimit;
  }

  /**
   * Record a request
   */
  recordRequest(tokenCount = 0) {
    // Skip recording in test mode to avoid cluttering stats
    if (this.testMode) {
      return;
    }
    
    const now = Date.now();
    this.requests.push({ timestamp: now, tokens: tokenCount });
    this.tokens += tokenCount;
    
    // Clean up old requests (older than 24 hours)
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    this.requests = this.requests.filter(req => req.timestamp > oneDayAgo);
  }

  /**
   * Get current usage statistics
   */
  getUsageStats() {
    // Return test mode stats
    if (this.testMode) {
      return {
        requestsToday: 0,
        requestsRemaining: 999,
        tokensToday: 0,
        tokensRemaining: 999999,
        dailyLimit: this.dailyLimit,
        tokenLimit: this.tokenLimit,
        canMakeRequest: true,
        testMode: true
      };
    }
    
    const now = Date.now();
    const today = new Date(now).toDateString();
    
    // Filter requests from today
    const todayRequests = this.requests.filter(req => 
      new Date(req.timestamp).toDateString() === today
    );
    
    const todayTokens = todayRequests.reduce((sum, req) => sum + req.tokens, 0);
    
    return {
      requestsToday: todayRequests.length,
      requestsRemaining: Math.max(0, this.dailyLimit - todayRequests.length),
      tokensToday: todayTokens,
      tokensRemaining: Math.max(0, this.tokenLimit - todayTokens),
      dailyLimit: this.dailyLimit,
      tokenLimit: this.tokenLimit,
      canMakeRequest: todayRequests.length < this.dailyLimit && todayTokens < this.tokenLimit,
      testMode: false
    };
  }

  /**
   * Get time until reset (next day)
   */
  getTimeUntilReset() {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    return tomorrow.getTime() - now.getTime();
  }

  /**
   * Format time until reset
   */
  getFormattedTimeUntilReset() {
    const ms = this.getTimeUntilReset();
    const hours = Math.floor(ms / (1000 * 60 * 60));
    const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    } else {
      return `${minutes}m`;
    }
  }

  /**
   * Reset usage (for testing)
   */
  reset() {
    this.requests = [];
    this.tokens = 0;
  }
}

// Export singleton instance
export const rateLimiter = new RateLimiter();
