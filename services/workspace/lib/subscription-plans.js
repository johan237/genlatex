/**
 * Subscription Plans Configuration
 * Defines the available subscription tiers and their features
 */

export const SUBSCRIPTION_PLANS = {
  FREE: {
    id: 'free',
    name: 'Free',
    price: 0,
    interval: 'month',
    description: 'Ideal for hacking around and trying GenLaTeX with no commitment.',
    features: [
      'Up to 3 projects',
      'File size limits',
      '5 AI paper credits (lifetime)',
      '5 AI chat messages per day',
      'Standard citations (APA, MLA)',
      'PDF & LaTeX export',
      'Community support'
    ],
    limits: {
      maxProjects: 3,
      maxCollaborators: 1,
      maxStoragePerProjectMB: 60,
      maxTotalStorageMB: 180,
      paperCreditsLifetime: 5, // Free users get 5 credits total (lifetime, no monthly reset)
      chatRequestsPerDay: 5,
      canConnectZotero: false,
      canUseNormalMode: false,
      maxStorageGB: 0.18,
      aiTokensPerMonth: 100
    }
  },
  PRO: {
    id: 'pro',
    name: 'Pro',
    price: 25,
    interval: 'month',
    yearlyPrice: 21,
    yearlyInterval: 'year',
    features: [
      'Unlimited projects',
      '10GB total storage',
      '45 AI paper credits/month',
      'Unlimited AI chat',
      'Zotero integration',
      'Fast (~10 min, 10+ citations) & Normal (~30 min, 30+ citations) modes',
      'Priority support'
    ],
    limits: {
      maxProjects: -1,
      maxCollaborators: 10,
      maxTotalStorageGB: 10,
      paperCreditsPerMonth: 45,
      chatRequestsPerDay: -1,
      canConnectZotero: true,
      canUseNormalMode: true,
      maxStorageGB: 10,
      aiRequestsPerMonth: -1
    }
  }
};

export const PLAN_FEATURES = {
  FREE: [
    'Up to 3 projects',
    'File size limits',
    '5 AI paper credits (lifetime)',
    '5 AI chat messages per day',
    'Standard citations (APA, MLA)',
    'PDF & LateX export',
    'Community support'
  ],
  PRO: [
    'Unlimited projects',
    'No file size limits',
    'Unlimited AI chat',
    'All citation styles',
    'LaTeX export',
    'Priority AI processing',
    'Remove watermarks',
    'Literature review & deepest research',
    'Email support'
  ]
};

export const PRICING = {
  PRO_MONTHLY: 25,
  PRO_YEARLY: 21,
  CURRENCY: 'USD'
};

// Helper functions
export function getPlanById(planId) {
  return Object.values(SUBSCRIPTION_PLANS).find(plan => plan.id === planId);
}

export function isProPlan(planId) {
  return planId === 'pro';
}

export function canCreateProject(currentPlan, currentProjectCount) {
  if (currentPlan === 'pro') return true;
  return currentProjectCount < SUBSCRIPTION_PLANS.FREE.limits.maxProjects;
}

/**
 * Get AI token limit for a plan (legacy)
 * @param {string} planId - Plan ID
 * @returns {number} Token limit (-1 for unlimited)
 */
export function getAITokenLimit(planId) {
  const plan = getPlanById(planId);
  return plan ? plan.limits.aiTokensPerMonth : 0;
}

export function getProjectLimit(planId) {
  const plan = getPlanById(planId);
  return plan ? plan.limits.maxProjects : 0;
}

/**
 * Get paper credits limit for a plan
 * @param {string} planId - Plan ID
 * @returns {number} Credits limit (-1 for unlimited). For free: lifetime limit. For pro: per month.
 */
export function getPaperCreditsLimit(planId) {
  const plan = getPlanById(planId);
  if (!plan) return 0;
  // Free plan uses lifetime credits, Pro uses monthly credits
  return planId === 'pro' ? plan.limits.paperCreditsPerMonth : plan.limits.paperCreditsLifetime;
}

/**
 * Check if a plan has lifetime credits (no monthly reset)
 * @param {string} planId - Plan ID
 * @returns {boolean} True if credits are lifetime (free plan), false if monthly (pro plan)
 */
export function isLifetimeCredits(planId) {
  return planId !== 'pro';
}

/**
 * Get chat requests per day limit for a plan
 * @param {string} planId - Plan ID
 * @returns {number} Requests per day (-1 for unlimited)
 */
export function getChatLimit(planId) {
  const plan = getPlanById(planId);
  if (!plan) return 0;
  return plan.limits.chatRequestsPerDay ?? 0;
}
