/**
 * User Subscription Management
 * Handles user subscription status, AI token tracking, and enforcement
 */

import { pool } from './db.js';
import { SUBSCRIPTION_PLANS, getAITokenLimit } from './subscription-plans.js';
import { canAffordTokens, getPaperCreditCost, PAPER_CREDIT_COSTS } from './ai-token-costs.js';
import { isValidUUID, getValidUserID } from './user-validation.js';
import { getUserTotalStorageUsed } from './storage-limits.js';

/** Real Stripe subscription IDs start with sub_; placeholders (e.g. manual-fix) must not be sent to Stripe. */
export function isRealStripeSubscriptionId(id) {
  return typeof id === 'string' && id.startsWith('sub_');
}

/** Get Stripe subscription only when needed (lazy import to avoid circular deps). Skips API call for placeholders (e.g. manual-fix). */
async function getStripeSubscriptionIfAvailable(subscriptionId) {
  if (!isRealStripeSubscriptionId(subscriptionId)) return null;
  try {
    const { getStripeSubscription } = await import('./stripe-config.js');
    return await getStripeSubscription(subscriptionId);
  } catch (e) {
    return null;
  }
}

const PRO_RESET_REFRESH_MS = 60 * 24 * 60 * 60 * 1000; // 60 days

/**
 * Calculate the next monthly reset date based on anchor day of month.
 * Credits reset on the same calendar day each month (e.g., if anchor is 15th, resets on 15th each month).
 * If anchor day > days in current month, uses last day of month.
 * @param {Date} anchorDate - The original anchor date (signup, subscription start, etc.)
 * @returns {Date} Next reset date
 */
function getNextMonthlyResetDate(anchorDate) {
  const now = new Date();
  const anchorDay = anchorDate.getDate();

  // Start with current month
  let year = now.getFullYear();
  let month = now.getMonth();

  // Get the reset date for current month (handle months with fewer days)
  const daysInCurrentMonth = new Date(year, month + 1, 0).getDate();
  const resetDayThisMonth = Math.min(anchorDay, daysInCurrentMonth);
  const resetThisMonth = new Date(year, month, resetDayThisMonth, anchorDate.getHours(), anchorDate.getMinutes(), anchorDate.getSeconds());

  // If we haven't passed this month's reset date yet, return it
  if (now < resetThisMonth) {
    return resetThisMonth;
  }

  // Otherwise, return next month's reset date
  month++;
  if (month > 11) {
    month = 0;
    year++;
  }
  const daysInNextMonth = new Date(year, month + 1, 0).getDate();
  const resetDayNextMonth = Math.min(anchorDay, daysInNextMonth);
  return new Date(year, month, resetDayNextMonth, anchorDate.getHours(), anchorDate.getMinutes(), anchorDate.getSeconds());
}


/**
 * For Pro users: get subscription expiry date from Stripe (current_period_end).
 * This is the actual subscription end date (could be monthly or yearly).
 * Only refreshes from Stripe when stored date is in the past or >60 days ahead (likely stale).
 * Updates subscription_expires_at in DB when we fetch so we stay in sync.
 */
async function getProSubscriptionExpiryFromStripe(userId, stripeSubscriptionId, fallbackExpiresAt) {
  if (!stripeSubscriptionId || !isRealStripeSubscriptionId(stripeSubscriptionId)) return fallbackExpiresAt;
  const now = Date.now();
  const fallbackTime = fallbackExpiresAt ? new Date(fallbackExpiresAt).getTime() : 0;
  const isStale = !fallbackExpiresAt || fallbackTime < now || (fallbackTime - now) > PRO_RESET_REFRESH_MS;
  if (!isStale) return fallbackExpiresAt;
  try {
    const subscription = await getStripeSubscriptionIfAvailable(stripeSubscriptionId);
    if (!subscription?.current_period_end) return fallbackExpiresAt;
    const periodEndIso = new Date(subscription.current_period_end * 1000).toISOString();
    await pool.query(
      `UPDATE users SET subscription_expires_at = $1 WHERE id = $2`,
      [periodEndIso, userId]
    );
    return periodEndIso;
  } catch (e) {
    return fallbackExpiresAt;
  }
}

/**
 * Get user's subscription information from database
 * @param {string} userId - User ID
 * @returns {Promise<object>} User subscription data
 */
export async function getUserSubscription(userId) {
  try {
    // Validate and fix user ID if needed
    if (!isValidUUID(userId)) {
      console.warn(`Invalid user ID: ${userId}, attempting to get valid ID...`);
      userId = await getValidUserID(userId);
    }

    // Main query: do NOT include is_admin - column may not exist yet (migration not run).
    // This ensures Pro users are never broken by admin feature.
    const result = await pool.query(
      `SELECT id, is_pro, subscription_status, subscription_expires_at, 
       stripe_customer_id, stripe_subscription_id, ai_tokens_used, ai_tokens_reset_at,
       paper_credits_used, paper_credits_reset_at, daily_chat_requests, daily_chat_reset_at, advanced_chat_requests
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const user = result.rows[0];

    // Fetch is_admin separately - column may not exist if migration not run yet
    let isAdmin = false;
    try {
      const adminResult = await pool.query(`SELECT is_admin FROM users WHERE id = $1`, [userId]);
      if (adminResult.rows[0]?.is_admin) isAdmin = true;
    } catch {
      /* column doesn't exist yet */
    }
    
    // Return with defaults for potentially missing columns
    return {
      isPro: user.is_pro || false,
      isAdmin,
      status: user.subscription_status || 'free',
      expiresAt: user.subscription_expires_at || null,
      stripeCustomerId: user.stripe_customer_id || null,
      stripeSubscriptionId: user.stripe_subscription_id || null,
      aiTokensUsed: user.ai_tokens_used || 0,
      aiTokensResetAt: user.ai_tokens_reset_at || new Date().toISOString(),
      paperCreditsUsed: user.paper_credits_used ?? 0,
      paperCreditsResetAt: user.paper_credits_reset_at || null,
      dailyChatRequests: user.daily_chat_requests ?? 0,
      dailyChatResetAt: user.daily_chat_reset_at || null,
      advancedChatRequests: user.advanced_chat_requests ?? 0,
    };
  } catch (error) {
    console.error('Error getting user subscription:', error);
    // Return default values instead of throwing to handle missing columns gracefully
    return {
      isPro: false,
      isAdmin: false,
      status: 'free',
      expiresAt: null,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      aiTokensUsed: 0,
      aiTokensResetAt: new Date().toISOString(),
      paperCreditsUsed: 0,
      paperCreditsResetAt: null,
      dailyChatRequests: 0,
      dailyChatResetAt: null,
      advancedChatRequests: 0,
    };
  }
}

/**
 * Update user subscription in database
 * @param {string} userId - User ID
 * @param {object} subscriptionData - Subscription data to update
 * @returns {Promise<object>} Updated subscription data
 */
export async function updateUserSubscription(userId, subscriptionData) {
  try {
    const updateFields = [];
    const values = [];
    let paramCount = 1;

    if (subscriptionData.isPro !== undefined) {
      updateFields.push(`is_pro = $${paramCount}`);
      values.push(subscriptionData.isPro);
      paramCount++;
      // Start new period: use Stripe period start if provided (Pro), else NOW()
      const creditsResetAt = subscriptionData.paperCreditsResetAt ?? new Date().toISOString();
      updateFields.push(`paper_credits_used = 0`, `paper_credits_reset_at = $${paramCount}`);
      values.push(creditsResetAt);
      paramCount++;
    }

    if (subscriptionData.status !== undefined) {
      updateFields.push(`subscription_status = $${paramCount}`);
      values.push(subscriptionData.status);
      paramCount++;
    }

    if (subscriptionData.expiresAt !== undefined) {
      updateFields.push(`subscription_expires_at = $${paramCount}`);
      values.push(subscriptionData.expiresAt);
      paramCount++;
    }

    if (subscriptionData.stripeCustomerId !== undefined) {
      updateFields.push(`stripe_customer_id = $${paramCount}`);
      values.push(subscriptionData.stripeCustomerId);
      paramCount++;
    }

    if (subscriptionData.stripeSubscriptionId !== undefined) {
      updateFields.push(`stripe_subscription_id = $${paramCount}`);
      values.push(subscriptionData.stripeSubscriptionId);
      paramCount++;
    }

    // Sync paper credits period with Stripe when period start is provided (e.g. on renewal)
    // Only add when isPro was NOT set - avoids duplicate "paper_credits_used" assignment
    if (subscriptionData.paperCreditsResetAt !== undefined && subscriptionData.isPro === undefined) {
      updateFields.push(`paper_credits_used = 0`, `paper_credits_reset_at = $${paramCount}`);
      values.push(subscriptionData.paperCreditsResetAt);
      paramCount++;
    }

    if (updateFields.length === 0) {
      return await getUserSubscription(userId);
    }

    values.push(userId);
    const query = `UPDATE users SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING *`;
    
    const result = await pool.query(query, values);
    
    return result.rows[0];
  } catch (error) {
    console.error('Error updating user subscription:', error);
    throw error;
  }
}

/**
 * Check if user is pro
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} Whether user is pro
 */
export async function isUserPro(userId) {
  try {
    const subscription = await getUserSubscription(userId);
    return subscription ? (subscription.isPro || subscription.isAdmin) : false;
  } catch (error) {
    console.error('Error checking user pro status:', error);
    return false;
  }
}

/**
 * Get AI tokens used by user (with automatic monthly reset)
 * @param {string} userId - User ID
 * @returns {Promise<number>} Tokens used this month
 */
export async function getUserAITokensUsed(userId) {
  try {
    // Validate and fix user ID if needed
    if (!isValidUUID(userId)) {
      console.warn(`Invalid user ID: ${userId}, attempting to get valid ID...`);
      userId = await getValidUserID(userId);
    }

    const result = await pool.query(
      `SELECT ai_tokens_used, ai_tokens_reset_at FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return 0;
    }

    const user = result.rows[0];
    
    // Handle missing columns gracefully
    if (!user.ai_tokens_used && !user.ai_tokens_reset_at) {
      return 0;
    }
    
    const now = new Date();
    const resetAt = new Date(user.ai_tokens_reset_at || now);

    // Check if we're in a different month
    const resetMonth = resetAt.getMonth();
    const resetYear = resetAt.getFullYear();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    // If we're in a different month, reset tokens
    if (currentMonth !== resetMonth || currentYear !== resetYear) {
      try {
        await pool.query(
          `UPDATE users SET ai_tokens_used = 0, ai_tokens_reset_at = NOW() WHERE id = $1`,
          [userId]
        );
      } catch (updateError) {
        // Ignore if columns don't exist yet
        console.log('Could not reset tokens (columns may not exist):', updateError.message);
      }
      return 0;
    }

    return user.ai_tokens_used || 0;
  } catch (error) {
    console.error('Error getting AI tokens used:', error);
    return 0;
  }
}

/**
 * Check if user can use AI (has enough tokens)
 * @param {string} userId - User ID
 * @param {number} tokensNeeded - Tokens needed for the request
 * @returns {Promise<object>} Check result with details
 */
export async function canUserUseAI(userId, tokensNeeded) {
  try {
    const subscription = await getUserSubscription(userId);
    if (!subscription) {
      return {
        allowed: false,
        error: 'User not found',
        tokensUsed: 0,
        tokenLimit: 0,
        remaining: 0
      };
    }

    // Auto-reset if new month
    const tokensUsed = await getUserAITokensUsed(userId);
    const isPro = subscription.isPro || subscription.isAdmin;
    
    // Determine token limit (admin and Pro get unlimited)
    const tokenLimit = isPro ? -1 : SUBSCRIPTION_PLANS.FREE.limits.aiTokensPerMonth;

    return canAffordTokens(isPro, tokensUsed, tokenLimit, tokensNeeded);
  } catch (error) {
    console.error('Error checking if user can use AI:', error);
    return {
      allowed: false,
      error: error.message,
      tokensUsed: 0,
      tokenLimit: 0,
      remaining: 0
    };
  }
}

/**
 * Record AI usage (tokens consumed) - simple version for backward compatibility
 * @param {string} userId - User ID
 * @param {number} tokensUsed - Number of tokens to add
 * @returns {Promise<void>}
 */
export async function recordAIUsage(userId, tokensUsed) {
  try {
    // First, check if we need to reset (monthly reset)
    await getUserAITokensUsed(userId);

    // Now add the tokens
    await pool.query(
      `UPDATE users SET ai_tokens_used = ai_tokens_used + $1 WHERE id = $2`,
      [tokensUsed, userId]
    );
  } catch (error) {
    console.error('Error recording AI usage:', error);
    throw error;
  }
}

/**
 * Atomically check and deduct AI tokens.
 * Returns true if deduction succeeded, false if insufficient tokens.
 * Use this BEFORE calling external APIs to prevent race conditions.
 * @param {string} userId - User ID
 * @param {number} tokensNeeded - Number of tokens to deduct
 * @returns {Promise<{success: boolean, tokensUsed: number, remaining: number}>}
 */
export async function deductAITokensAtomic(userId, tokensNeeded) {
  // First, check if we need to reset (monthly reset)
  await getUserAITokensUsed(userId);
  
  const subscription = await getUserSubscription(userId);
  const isPro = subscription?.isPro || subscription?.isAdmin || false;
  const tokenLimit = isPro ? -1 : SUBSCRIPTION_PLANS.FREE.limits.aiTokensPerMonth;

  // For unlimited (-1), just deduct
  if (tokenLimit === -1) {
    await pool.query(
      `UPDATE users SET ai_tokens_used = ai_tokens_used + $1 WHERE id = $2`,
      [tokensNeeded, userId]
    );
    return { success: true, tokensUsed: tokensNeeded, remaining: 999 };
  }

  // Atomic check-and-deduct: only deduct if we have enough tokens
  const result = await pool.query(
    `UPDATE users
     SET ai_tokens_used = ai_tokens_used + $1
     WHERE id = $2 AND ai_tokens_used + $1 <= $3
     RETURNING ai_tokens_used`,
    [tokensNeeded, userId, tokenLimit]
  );

  if (result.rowCount === 0) {
    // Deduction failed - insufficient tokens
    const current = await pool.query(`SELECT ai_tokens_used FROM users WHERE id = $1`, [userId]);
    const used = current.rows[0]?.ai_tokens_used ?? 0;
    return { success: false, tokensUsed: 0, remaining: Math.max(0, tokenLimit - used) };
  }

  const newUsed = result.rows[0].ai_tokens_used;
  return { success: true, tokensUsed: tokensNeeded, remaining: Math.max(0, tokenLimit - newUsed) };
}

/**
 * Check if user can create a project
 * @param {string} userId - User ID
 * @returns {Promise<object>} Check result with details
 */
export async function canUserCreateProject(userId) {
  try {
    const subscription = await getUserSubscription(userId);
    if (!subscription) {
      return {
        allowed: false,
        error: 'User not found',
        projectCount: 0,
        maxProjects: 0
      };
    }

    const isPro = subscription.isPro || subscription.isAdmin;

    if (isPro) {
      return {
        allowed: true,
        projectCount: 0, // Don't need to check for pro/admin
        maxProjects: -1,
        isPro: true
      };
    }

    // Check project count for free users
    const projectCountResult = await pool.query(
      `SELECT COUNT(*) as count FROM projects WHERE user_id = $1`,
      [userId]
    );

    const projectCount = parseInt(projectCountResult.rows[0].count);
    const maxProjects = SUBSCRIPTION_PLANS.FREE.limits.maxProjects;

    return {
      allowed: projectCount < maxProjects,
      projectCount,
      maxProjects,
      isPro: false
    };
  } catch (error) {
    console.error('Error checking if user can create project:', error);
    return {
      allowed: false,
      error: error.message,
      projectCount: 0,
      maxProjects: 1
    };
  }
}

// ============================================================================
// Paper credits
// - Free users: LIFETIME credits (no monthly reset, 5 credits total forever)
// - Pro users: MONTHLY reset based on Stripe current_period_start (45 credits/month)
// ============================================================================

/**
 * Get the anchor date for credit resets.
 * - Pro users: Stripe subscription's current_period_start
 * - Free users: created_at (signup date)
 * @param {string} userId - User ID
 * @returns {Promise<{ anchor: Date|null, lastReset: Date|null, isPro: boolean }>}
 */
async function getCreditResetAnchor(userId) {
  const result = await pool.query(
    `SELECT created_at, paper_credits_reset_at, is_pro, stripe_subscription_id FROM users WHERE id = $1`,
    [userId]
  );
  if (result.rows.length === 0) return { anchor: null, lastReset: null, isPro: false };
  const user = result.rows[0];
  const isPro = user.is_pro || false;
  const lastReset = user.paper_credits_reset_at ? new Date(user.paper_credits_reset_at) : null;

  if (isPro && user.stripe_subscription_id) {
    // For Pro: get anchor from Stripe subscription's current_period_start
    try {
      const subscription = await getStripeSubscriptionIfAvailable(user.stripe_subscription_id);
      if (subscription?.current_period_start) {
        const stripeAnchor = new Date(subscription.current_period_start * 1000);
        return { anchor: stripeAnchor, lastReset, isPro };
      }
    } catch (e) {
      // Fall back to paper_credits_reset_at if Stripe fails
    }
    // Fallback: use paper_credits_reset_at or created_at
    return { anchor: lastReset || new Date(user.created_at), lastReset, isPro };
  }

  // For Free users: use created_at as anchor
  const createdAt = user.created_at ? new Date(user.created_at) : null;
  return { anchor: createdAt, lastReset, isPro };
}

/**
 * Get paper credits used, auto-resetting monthly for Pro users only.
 * - Free users: NO reset (lifetime credits)
 * - Pro users: resets on same calendar day as Stripe current_period_start
 *
 * @param {string} userId - User ID
 * @returns {Promise<number>} Credits used (lifetime for free, this period for pro)
 */
export async function getPaperCreditsUsed(userId) {
  try {
    if (!isValidUUID(userId)) {
      userId = await getValidUserID(userId);
    }
    const result = await pool.query(
      `SELECT paper_credits_used, paper_credits_reset_at, is_pro FROM users WHERE id = $1`,
      [userId]
    );
    if (result.rows.length === 0) return 0;
    const user = result.rows[0];
    const used = user.paper_credits_used ?? 0;
    const isPro = user.is_pro || false;

    // Free users: NO monthly reset - credits are lifetime
    if (!isPro) {
      return used;
    }

    // Pro users: monthly reset based on anchor date
    const { anchor, lastReset } = await getCreditResetAnchor(userId);
    if (!anchor) return used;

    // Get the anchor day (day of month when credits reset)
    const anchorDay = anchor.getDate();
    const now = new Date();

    // Calculate this month's reset date
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const resetDay = Math.min(anchorDay, daysInMonth);
    const resetThisMonth = new Date(year, month, resetDay, 0, 0, 0, 0);

    // Check if we need to reset: passed this month's reset date AND last reset was before it
    const shouldReset = now >= resetThisMonth && (!lastReset || lastReset < resetThisMonth);
    if (shouldReset) {
      await pool.query(
        `UPDATE users SET paper_credits_used = 0, paper_credits_reset_at = $1 WHERE id = $2`,
        [resetThisMonth.toISOString(), userId]
      );
      return 0;
    }
    return used;
  } catch (e) {
    return 0;
  }
}

/**
 * Get paper credits info for user
 * @param {string} userId - User ID
 * @returns {Promise<object>} { used, limit, remaining, resetDate, subscriptionExpiresAt, isLifetime }
 */
export async function getUserPaperCredits(userId) {
  const sub = await getUserSubscription(userId);
  if (!sub) return { used: 0, limit: 0, remaining: 0, resetDate: null, subscriptionExpiresAt: null, isLifetime: true };
  const used = await getPaperCreditsUsed(userId);
  // Admin: unlimited. Pro users: monthly limit. Free users: lifetime limit
  const limit = sub.isAdmin ? -1 : (sub.isPro ? SUBSCRIPTION_PLANS.PRO.limits.paperCreditsPerMonth : SUBSCRIPTION_PLANS.FREE.limits.paperCreditsLifetime);
  const remaining = Math.max(0, limit === -1 ? 999 : limit - used);
  const isLifetime = !sub.isPro; // Free users have lifetime credits

  // Reset date only applies to Pro users (monthly reset)
  let resetDate = null;
  if (sub.isPro) {
    const { anchor } = await getCreditResetAnchor(userId);
    resetDate = anchor ? getNextMonthlyResetDate(anchor)?.toISOString() ?? null : null;
  }

  // For Pro users, also get subscription expiry from Stripe (actual billing cycle end)
  let subscriptionExpiresAt = null;
  if (sub.isPro && sub.stripeSubscriptionId) {
    subscriptionExpiresAt = await getProSubscriptionExpiryFromStripe(userId, sub.stripeSubscriptionId, sub.expiresAt);
  } else if (sub.isPro && sub.expiresAt) {
    subscriptionExpiresAt = sub.expiresAt;
  }
  return { used, limit: limit === -1 ? -1 : limit, remaining, resetDate, subscriptionExpiresAt, isLifetime };
}

/**
 * Check if user can use paper generation
 * @param {string} userId - User ID
 * @param {boolean} fastMode - true = fast (5 credits), false = normal (10 credits)
 * @returns {Promise<object>} { allowed, remaining, cost, resetDate, isLifetime }
 */
export async function canUserUsePaperGeneration(userId, fastMode) {
  const cost = getPaperCreditCost(fastMode);
  const sub = await getUserSubscription(userId);
  if (!sub) {
    return { allowed: false, remaining: 0, cost, resetDate: null, isLifetime: true };
  }
  const used = await getPaperCreditsUsed(userId);
  // Admin: unlimited. Pro users: monthly limit. Free users: lifetime limit
  const limit = sub.isAdmin ? -1 : (sub.isPro ? SUBSCRIPTION_PLANS.PRO.limits.paperCreditsPerMonth : SUBSCRIPTION_PLANS.FREE.limits.paperCreditsLifetime);
  const remaining = limit === -1 ? 999 : Math.max(0, limit - used);
  const allowed = limit === -1 || (used + cost <= limit);
  const isLifetime = !sub.isPro && !sub.isAdmin;

  // Reset date only applies to Pro users (monthly reset)
  let resetDate = null;
  if (sub.isPro && !sub.isAdmin) {
    const { anchor } = await getCreditResetAnchor(userId);
    resetDate = anchor ? getNextMonthlyResetDate(anchor)?.toISOString() ?? null : null;
  }
  return { allowed, remaining, cost, resetDate, isLifetime };
}

/**
 * Record paper generation (deduct credits)
 * @param {string} userId - User ID
 * @param {boolean} fastMode - true = 5 credits, false = 10 credits
 */
export async function recordPaperGeneration(userId, fastMode) {
  await getPaperCreditsUsed(userId); // ensure monthly reset if needed
  const cost = getPaperCreditCost(fastMode);
  await pool.query(
    `UPDATE users SET paper_credits_used = paper_credits_used + $1 WHERE id = $2`,
    [cost, userId]
  );
}

/**
 * Atomically check and deduct paper credits.
 * Returns true if deduction succeeded, false if insufficient credits.
 * Use this BEFORE calling external APIs to prevent race conditions.
 * @param {string} userId - User ID
 * @param {boolean} fastMode - true = 5 credits, false = 10 credits
 * @returns {Promise<{success: boolean, cost: number, remaining: number}>}
 */
export async function deductPaperCreditsAtomic(userId, fastMode) {
  await getPaperCreditsUsed(userId); // ensure monthly reset if needed (only for Pro users)
  const cost = getPaperCreditCost(fastMode);
  const sub = await getUserSubscription(userId);
  // Admin: unlimited. Pro users: monthly limit. Free users: lifetime limit
  const limit = sub?.isAdmin ? -1 : (sub?.isPro ? SUBSCRIPTION_PLANS.PRO.limits.paperCreditsPerMonth : SUBSCRIPTION_PLANS.FREE.limits.paperCreditsLifetime);

  // For unlimited (-1), just deduct
  if (limit === -1) {
    await pool.query(
      `UPDATE users SET paper_credits_used = paper_credits_used + $1 WHERE id = $2`,
      [cost, userId]
    );
    return { success: true, cost, remaining: 999 };
  }

  // Atomic check-and-deduct: only deduct if we have enough credits
  const result = await pool.query(
    `UPDATE users
     SET paper_credits_used = paper_credits_used + $1
     WHERE id = $2 AND paper_credits_used + $1 <= $3
     RETURNING paper_credits_used`,
    [cost, userId, limit]
  );

  if (result.rowCount === 0) {
    // Deduction failed - insufficient credits
    const current = await pool.query(`SELECT paper_credits_used FROM users WHERE id = $1`, [userId]);
    const used = current.rows[0]?.paper_credits_used ?? 0;
    return { success: false, cost, remaining: Math.max(0, limit - used) };
  }

  const newUsed = result.rows[0].paper_credits_used;
  return { success: true, cost, remaining: Math.max(0, limit - newUsed) };
}

/**
 * Refund paper credits (on generation failure after deduction)
 * @param {string} userId - User ID
 * @param {boolean} fastMode - true = 5 credits, false = 10 credits
 */
export async function refundPaperCredits(userId, fastMode) {
  const cost = getPaperCreditCost(fastMode);
  await pool.query(
    `UPDATE users SET paper_credits_used = GREATEST(0, paper_credits_used - $1) WHERE id = $2`,
    [cost, userId]
  );
}

// ============================================================================
// Daily chat (daily reset)
// ============================================================================

/**
 * Get daily chat counts and reset if new day
 * @param {string} userId - User ID
 * @returns {Promise<{ total: number }>}
 */
async function getDailyChatCounts(userId) {
  try {
    const result = await pool.query(
      `SELECT daily_chat_requests, daily_chat_reset_at FROM users WHERE id = $1`,
      [userId]
    );
    if (result.rows.length === 0) return { total: 0 };
    const row = result.rows[0];
    const resetAt = row.daily_chat_reset_at ? new Date(row.daily_chat_reset_at) : null;
    const now = new Date();
    const sameDay = resetAt && resetAt.getDate() === now.getDate() && resetAt.getMonth() === now.getMonth() && resetAt.getFullYear() === now.getFullYear();
    if (!sameDay && resetAt) {
      await pool.query(
        `UPDATE users SET daily_chat_requests = 0, daily_chat_reset_at = NOW() WHERE id = $1`,
        [userId]
      );
      return { total: 0 };
    }
    return {
      total: row.daily_chat_requests ?? 0
    };
  } catch (e) {
    return { total: 0 };
  }
}

/**
 * Get daily chat info for user
 * @param {string} userId - User ID
 * @returns {Promise<object>} { allowed, remaining, isPro, resetTime }
 */
export async function getDailyChatInfo(userId) {
  const sub = await getUserSubscription(userId);
  if (!sub) {
    return { allowed: false, remaining: 0, isPro: false, resetTime: null };
  }
  const { total } = await getDailyChatCounts(userId);
  const isPro = sub.isPro || sub.isAdmin;
  const chatLimit = isPro ? -1 : SUBSCRIPTION_PLANS.FREE.limits.chatRequestsPerDay;
  const remaining = chatLimit === -1 ? 999 : Math.max(0, chatLimit - total);
  const allowed = chatLimit === -1 || total < chatLimit;
  const result = await pool.query(`SELECT daily_chat_reset_at FROM users WHERE id = $1`, [userId]);
  const resetAt = result.rows[0]?.daily_chat_reset_at;
  let resetTime = null;
  if (resetAt) {
    const d = new Date(resetAt);
    d.setDate(d.getDate() + 1);
    d.setHours(0, 0, 0, 0);
    resetTime = d.toISOString();
  }
  return {
    allowed,
    remaining,
    isPro,
    resetTime,
    totalToday: total
  };
}

/**
 * Check if user can use chat (convenience)
 * @param {string} userId - User ID
 * @returns {Promise<object>} Same shape as getDailyChatInfo
 */
export async function canUserUseChat(userId) {
  return getDailyChatInfo(userId);
}

/**
 * Record chat usage (increment daily counts) - simple version for backward compatibility
 * @param {string} userId - User ID
 */
export async function recordChatUsage(userId) {
  await getDailyChatCounts(userId); // ensure daily reset if needed
  await pool.query(
    `UPDATE users SET daily_chat_requests = daily_chat_requests + 1 WHERE id = $1`,
    [userId]
  );
}

/**
 * Atomically check and deduct chat request.
 * Returns true if deduction succeeded, false if limit exceeded.
 * Use this BEFORE calling external APIs to prevent race conditions.
 * @param {string} userId - User ID
 * @returns {Promise<{success: boolean, remaining: number}>}
 */
export async function deductChatRequestAtomic(userId) {
  await getDailyChatCounts(userId); // ensure daily reset if needed
  
  const subscription = await getUserSubscription(userId);
  const isPro = subscription?.isPro || subscription?.isAdmin || false;
  const chatLimit = isPro ? -1 : (SUBSCRIPTION_PLANS.FREE.limits.chatRequestsPerDay ?? 5);

  // For unlimited (-1), just deduct
  if (chatLimit === -1) {
    await pool.query(
      `UPDATE users SET daily_chat_requests = daily_chat_requests + 1 WHERE id = $1`,
      [userId]
    );
    return { success: true, remaining: 999 };
  }

  // Atomic check-and-deduct: only deduct if under limit
  const result = await pool.query(
    `UPDATE users
     SET daily_chat_requests = daily_chat_requests + 1
     WHERE id = $1 AND daily_chat_requests < $2
     RETURNING daily_chat_requests`,
    [userId, chatLimit]
  );

  if (result.rowCount === 0) {
    // Deduction failed - limit reached
    const current = await pool.query(`SELECT daily_chat_requests FROM users WHERE id = $1`, [userId]);
    const used = current.rows[0]?.daily_chat_requests ?? 0;
    return { success: false, remaining: Math.max(0, chatLimit - used) };
  }

  const newUsed = result.rows[0].daily_chat_requests;
  return { success: true, remaining: Math.max(0, chatLimit - newUsed) };
}

/**
 * Whether user can connect Zotero (Pro only)
 * @param {string} userId - User ID
 * @returns {Promise<boolean>}
 */
export async function canUserConnectZotero(userId) {
  return isUserPro(userId);
}

/**
 * Get full usage summary for dashboard
 * @param {string} userId - User ID
 * @returns {Promise<object>}
 */
export async function getUserUsageSummary(userId) {
  const sub = await getUserSubscription(userId);
  if (!sub) return null;
  // Admin and Pro get Pro limits (unlimited projects, paper credits, chat)
  const limits = (sub.isPro || sub.isAdmin) ? SUBSCRIPTION_PLANS.PRO.limits : SUBSCRIPTION_PLANS.FREE.limits;
  const projectCountResult = await pool.query(`SELECT COUNT(*) as count FROM projects WHERE user_id = $1`, [userId]);
  const projectCount = parseInt(projectCountResult.rows[0]?.count ?? 0, 10);
  const storageUsed = await getUserTotalStorageUsed(userId);
  const paperCreditsUsed = await getPaperCreditsUsed(userId);
  // Admin: unlimited. Pro users: monthly limit. Free users: lifetime limit
  const paperCreditsLimit = sub.isAdmin ? -1 : (sub.isPro ? limits.paperCreditsPerMonth : limits.paperCreditsLifetime);
  const isLifetimeCredits = !sub.isPro && !sub.isAdmin;
  const { total: chatToday } = await getDailyChatCounts(userId);
  const chatLimit = (sub.isPro || sub.isAdmin) ? -1 : (limits.chatRequestsPerDay ?? 5);
  const maxTotalStorage = (sub.isPro || sub.isAdmin) ? (limits.maxTotalStorageGB * 1024 * 1024 * 1024) : (limits.maxTotalStorageMB * 1024 * 1024);
  const maxStoragePerProject = (sub.isPro || sub.isAdmin) ? (2 * 1024 * 1024 * 1024) : (limits.maxStoragePerProjectMB * 1024 * 1024);
  const result = await pool.query(
    `SELECT paper_credits_reset_at, daily_chat_reset_at FROM users WHERE id = $1`,
    [userId]
  );
  const row = result.rows[0] || {};

  // Reset date only applies to Pro users (monthly reset), not admin
  let nextPaperReset = null;
  if (sub.isPro && !sub.isAdmin) {
    const { anchor } = await getCreditResetAnchor(userId);
    nextPaperReset = anchor ? getNextMonthlyResetDate(anchor) : null;
  }
  // For Pro users, also get subscription expiry (admin has no Stripe)
  let subscriptionExpiresAt = null;
  if (sub.isPro && !sub.isAdmin && sub.stripeSubscriptionId) {
    subscriptionExpiresAt = await getProSubscriptionExpiryFromStripe(userId, sub.stripeSubscriptionId, sub.expiresAt);
  } else if (sub.isPro && !sub.isAdmin && sub.expiresAt) {
    subscriptionExpiresAt = sub.expiresAt;
  }
  return {
    isPro: sub.isPro || sub.isAdmin,
    isLifetimeCredits,
    limits: {
      maxProjects: limits.maxProjects,
      maxTotalStorage,
      maxStoragePerProject,
      paperCreditsPerMonth: paperCreditsLimit, // Note: for free users this is actually lifetime
      chatRequestsPerDay: chatLimit
    },
    projectCount,
    storageUsed,
    storageRemaining: Math.max(0, maxTotalStorage - storageUsed),
    paperCreditsUsed,
    paperCreditsRemaining: Math.max(0, paperCreditsLimit === -1 ? 999 : paperCreditsLimit - paperCreditsUsed),
    paperCreditsResetDate: nextPaperReset ? nextPaperReset.toISOString() : null,
    subscriptionExpiresAt,
    chatRequestsToday: chatToday,
    chatRemaining: chatLimit === -1 ? 999 : Math.max(0, (limits.chatRequestsPerDay ?? 5) - chatToday),
    chatResetTime: row.daily_chat_reset_at
  };
}

