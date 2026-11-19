/**
 * AI Token Costs Configuration
 * Defines token cost for each type of AI request
 */

export const AI_TOKEN_COSTS = {
  chat: 1,           // Simple chat messages
  generate: 5,       // Content generation
  assistant: 2,      // AI assistant requests
  paper: 10,         // Paper generation (legacy)
  analysis: 3,      // Document analysis
};

/** Paper generation credit costs (fast_mode = 5, normal_mode = 10) */
export const PAPER_CREDIT_COSTS = {
  fast_mode: 5,
  normal_mode: 10
};

/**
 * AI model identifier for chat - single model for all users.
 * Override via env: AI_MODEL (primary) or AI_MODEL_FALLBACK (backup).
 */
export const AI_MODELS = {
  get chat() {
    return process.env.AI_MODEL || process.env.AI_MODEL_FALLBACK || 'deepseek/deepseek-chat';
  }
};

/** Get the chat model for server-side use */
export function getChatModel() {
  return process.env.AI_MODEL || process.env.AI_MODEL_FALLBACK || 'deepseek/deepseek-chat';
}

/**
 * Get token cost for a specific request type
 * @param {string} requestType - Type of AI request
 * @returns {number} Token cost for the request type
 */
export function getTokenCost(requestType) {
  return AI_TOKEN_COSTS[requestType] || 1;
}

/**
 * Get paper generation credit cost
 * @param {boolean} fastMode - true = fast mode (5 credits), false = normal mode (10 credits)
 * @returns {number} Credit cost
 */
export function getPaperCreditCost(fastMode) {
  return fastMode ? PAPER_CREDIT_COSTS.fast_mode : PAPER_CREDIT_COSTS.normal_mode;
}

/**
 * Check if user can make AI request based on tokens
 * @param {boolean} isPro - Whether user is pro
 * @param {number} tokensUsed - Tokens already used this month
 * @param {number} tokenLimit - Token limit for user's plan
 * @param {number} tokensNeeded - Tokens needed for this request
 * @returns {object} Check result with allowed status and details
 */
export function canAffordTokens(isPro, tokensUsed, tokenLimit, tokensNeeded) {
  if (isPro) {
    return {
      allowed: true,
      tokensUsed,
      tokenLimit: -1, // unlimited
      remaining: -1,
      cost: tokensNeeded
    };
  }

  const totalNeeded = tokensUsed + tokensNeeded;
  
  if (tokenLimit === -1) {
    return {
      allowed: true,
      tokensUsed,
      tokenLimit: -1,
      remaining: -1,
      cost: tokensNeeded
    };
  }

  const allowed = totalNeeded <= tokenLimit;
  const remaining = Math.max(0, tokenLimit - tokensUsed);

  return {
    allowed,
    tokensUsed,
    tokenLimit,
    remaining,
    cost: tokensNeeded
  };
}

