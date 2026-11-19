/**
 * Subscription Management API
 * Handles user subscription status, limits, and billing
 */

import { NextResponse } from 'next/server';
import { SUBSCRIPTION_PLANS, getPlanById, canCreateProject } from '@/lib/subscription-plans.js';
import {
  getOrCreateStripeCustomer,
  createStripeSubscription,
  getStripeSubscription,
  cancelStripeSubscription,
  updateStripeSubscription,
  STRIPE_CONFIG
} from '@/lib/stripe-config.js';
import {
  getUserSubscription,
  updateUserSubscription,
  canUserCreateProject,
  getUserAITokensUsed,
  isUserPro,
  isRealStripeSubscriptionId
} from '@/lib/user-subscription.js';
import { pool } from '@/lib/db.js';
import { isValidUUID, getValidUserID } from '@/lib/user-validation.js';
import { getSessionFromRequest } from '@/lib/project-auth.js';

/**
 * Verify the authenticated user matches the requested userId
 * @param {string} requestedUserId - The userId from the request
 * @returns {Promise<{authorized: boolean, session: object|null, error?: string}>}
 */
async function verifyUserAuthorization(requestedUserId) {
  const session = await getSessionFromRequest();
  if (!session?.id) {
    return { authorized: false, session: null, error: 'Authentication required' };
  }

  // Allow if session user matches requested user
  if (session.id === requestedUserId) {
    return { authorized: true, session };
  }

  // Check if requestedUserId can be validated to session.id
  if (!isValidUUID(requestedUserId)) {
    try {
      const validId = await getValidUserID(requestedUserId);
      if (validId === session.id) {
        return { authorized: true, session, validatedUserId: validId };
      }
    } catch {
      // Fall through to unauthorized
    }
  }

  return { authorized: false, session, error: 'Not authorized to access this subscription' };
}

// GET - Get user subscription status
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    let userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({
        success: false,
        error: 'User ID is required'
      }, { status: 400 });
    }

    // Verify authorization
    const auth = await verifyUserAuthorization(userId);
    if (!auth.authorized) {
      return NextResponse.json({
        success: false,
        error: auth.error
      }, { status: auth.session ? 403 : 401 });
    }

    // Use validated userId if available
    if (auth.validatedUserId) {
      userId = auth.validatedUserId;
    } else if (!isValidUUID(userId)) {
      userId = await getValidUserID(userId);
    }

    // Get user subscription from database
    const subscription = await getUserSubscription(userId);
    
    // Use isUserPro for source of truth (includes both is_pro and is_admin - admin gets Pro privileges)
    const isPro = await isUserPro(userId);
    const status = subscription?.status || 'free';
    
    // Get project count from database
    let projectCount = 0;
    try {
      const projectResult = await pool.query(
        'SELECT COUNT(*) as count FROM projects WHERE user_id = $1',
        [userId]
      );
      projectCount = parseInt(projectResult.rows[0]?.count || 0);
    } catch (error) {
      console.error('Error getting project count:', error);
    }

    // Determine plan
    const planId = isPro ? 'pro' : 'free';
    const plan = getPlanById(planId);

    // Get AI tokens used (will auto-reset if new month)
    let aiTokensUsed = 0;
    try {
      aiTokensUsed = await getUserAITokensUsed(userId);
    } catch (error) {
      console.error('Error getting AI tokens:', error);
    }
    
    const tokenLimit = isPro ? -1 : SUBSCRIPTION_PLANS.FREE.limits.aiTokensPerMonth;

    return NextResponse.json({
      success: true,
      subscription: {
        userId,
        planId,
        status,
        isPro,
        projectCount,
        canCreateProject: isPro || projectCount < plan.limits.maxProjects,
        limits: plan.limits,
        aiTokensUsed,
        aiTokenLimit: tokenLimit,
        remainingTokens: isPro ? -1 : Math.max(0, tokenLimit - aiTokensUsed)
      }
    });

  } catch (error) {
    console.error('Subscription API error:', error);
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 });
  }
}

// POST - Create or update subscription
export async function POST(request) {
  try {
    const { userId, planId, email, name, paymentMethodId, billingInterval = 'monthly' } = await request.json();

    if (!userId || !planId) {
      return NextResponse.json({
        success: false,
        error: 'User ID and Plan ID are required'
      }, { status: 400 });
    }

    // Verify authorization
    const auth = await verifyUserAuthorization(userId);
    if (!auth.authorized) {
      return NextResponse.json({
        success: false,
        error: auth.error
      }, { status: auth.session ? 403 : 401 });
    }

    const plan = getPlanById(planId);
    if (!plan) {
      return NextResponse.json({
        success: false,
        error: 'Invalid plan ID'
      }, { status: 400 });
    }

    // Handle free plan (downgrade): reset credits, set anchor to NOW
    if (planId === 'free') {
      const now = new Date().toISOString();
      await pool.query(
        `UPDATE users SET
          is_pro = false,
          subscription_status = 'free',
          subscription_expires_at = NULL,
          stripe_customer_id = NULL,
          stripe_subscription_id = NULL,
          paper_credits_used = 0,
          paper_credits_reset_at = $1
        WHERE id = $2`,
        [now, userId]
      );

      const projectResult = await pool.query(
        'SELECT COUNT(*) as count FROM projects WHERE user_id = $1',
        [userId]
      );
      const projectCount = parseInt(projectResult.rows[0].count);
      const aiTokensUsed = await getUserAITokensUsed(userId);

      return NextResponse.json({
        success: true,
        subscription: {
          userId,
          planId: 'free',
          status: 'active',
          isPro: false,
          plan: plan,
          projectCount,
          canCreateProject: projectCount < plan.limits.maxProjects,
          limits: plan.limits,
          aiTokensUsed,
          aiTokenLimit: SUBSCRIPTION_PLANS.FREE.limits.aiTokensPerMonth,
          remainingTokens: Math.max(0, plan.limits.aiTokensPerMonth - aiTokensUsed)
        }
      });
    }

    // Handle Pro plan with Stripe integration
    if (planId === 'pro') {
      if (!email || !name || !paymentMethodId) {
        return NextResponse.json({
          success: false,
          error: 'Email, name, and payment method are required for Pro plan'
        }, { status: 400 });
      }

      try {
        // Get or create Stripe customer
        const customer = await getOrCreateStripeCustomer(userId, email, name);

        // Determine price ID based on billing interval
        const priceId = billingInterval === 'yearly' 
          ? STRIPE_CONFIG.prices.proYearly 
          : STRIPE_CONFIG.prices.proMonthly;

        // Create Stripe subscription
        const stripeSubscription = await createStripeSubscription(
          customer.id, 
          priceId, 
          paymentMethodId
        );

        // Store subscription in database with anchor from Stripe's current_period_start
        const paperCreditsResetAt = new Date(stripeSubscription.current_period_start * 1000).toISOString();
        await updateUserSubscription(userId, {
          isPro: true,
          status: stripeSubscription.status,
          expiresAt: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
          stripeCustomerId: customer.id,
          stripeSubscriptionId: stripeSubscription.id,
          paperCreditsResetAt
        });

        const projectResult = await pool.query(
          'SELECT COUNT(*) as count FROM projects WHERE user_id = $1',
          [userId]
        );
        const projectCount = parseInt(projectResult.rows[0].count);
        const aiTokensUsed = await getUserAITokensUsed(userId);

        return NextResponse.json({
          success: true,
          subscription: {
            userId,
            planId: 'pro',
            status: stripeSubscription.status,
            isPro: true,
            plan: plan,
            projectCount,
            canCreateProject: true, // Pro users can create unlimited projects
            limits: plan.limits,
            aiTokensUsed,
            aiTokenLimit: -1,
            remainingTokens: -1
          },
          stripeSubscription: {
            id: stripeSubscription.id,
            status: stripeSubscription.status,
            clientSecret: stripeSubscription.latest_invoice?.payment_intent?.client_secret
          }
        });

      } catch (stripeError) {
        console.error('Stripe error:', stripeError);
        return NextResponse.json({
          success: false,
          error: `Payment processing failed: ${stripeError.message}`
        }, { status: 400 });
      }
    }

    return NextResponse.json({
      success: false,
      error: 'Invalid plan ID'
    }, { status: 400 });

  } catch (error) {
    console.error('Subscription creation error:', error);
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 });
  }
}

// PUT - Update subscription (upgrade/downgrade/change billing interval)
export async function PUT(request) {
  try {
    const { userId, planId, stripeSubscriptionId, billingInterval } = await request.json();

    if (!userId || !planId) {
      return NextResponse.json({
        success: false,
        error: 'User ID and Plan ID are required'
      }, { status: 400 });
    }

    // Verify authorization
    const auth = await verifyUserAuthorization(userId);
    if (!auth.authorized) {
      return NextResponse.json({
        success: false,
        error: auth.error
      }, { status: auth.session ? 403 : 401 });
    }

    const existingSubscription = await getUserSubscription(userId);
    if (!existingSubscription) {
      return NextResponse.json({
        success: false,
        error: 'User subscription not found'
      }, { status: 404 });
    }

    const plan = getPlanById(planId);
    if (!plan) {
      return NextResponse.json({
        success: false,
        error: 'Invalid plan ID'
      }, { status: 400 });
    }

    const wasPro = existingSubscription.isPro;
    const becomingPro = planId === 'pro';
    const now = new Date().toISOString();

    // Handle different scenarios
    if (becomingPro && existingSubscription.stripeSubscriptionId && isRealStripeSubscriptionId(existingSubscription.stripeSubscriptionId)) {
      // Pro user changing billing interval (monthly <-> yearly)
      // Or re-activating - get fresh anchor from Stripe (skip for placeholders like manual-fix)
      try {
        const stripeSubscription = await getStripeSubscription(existingSubscription.stripeSubscriptionId);
        if (stripeSubscription) {
          const paperCreditsResetAt = new Date(stripeSubscription.current_period_start * 1000).toISOString();
          await updateUserSubscription(userId, {
            isPro: true,
            status: 'active',
            expiresAt: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
            stripeSubscriptionId: stripeSubscriptionId || existingSubscription.stripeSubscriptionId,
            paperCreditsResetAt
          });
        }
      } catch (stripeError) {
        console.error('Error fetching Stripe subscription:', stripeError);
        // Fallback: just update without Stripe data
        await updateUserSubscription(userId, {
          isPro: true,
          status: 'active',
          stripeSubscriptionId: stripeSubscriptionId || existingSubscription.stripeSubscriptionId
        });
      }
    } else if (becomingPro && existingSubscription.stripeSubscriptionId) {
      // Already Pro with placeholder ID (e.g. manual-fix); keep Pro, no Stripe call
      await updateUserSubscription(userId, {
        isPro: true,
        status: 'active',
        stripeSubscriptionId: existingSubscription.stripeSubscriptionId
      });
    } else if (becomingPro && !wasPro) {
      // Free -> Pro upgrade (should typically go through POST, but handle here too)
      await updateUserSubscription(userId, {
        isPro: true,
        status: 'active',
        stripeSubscriptionId: stripeSubscriptionId || existingSubscription.stripeSubscriptionId,
        paperCreditsResetAt: now // Will be overwritten by webhook with Stripe data
      });
    } else if (!becomingPro && wasPro) {
      // Pro -> Free downgrade: reset credits, set anchor to NOW
      await pool.query(
        `UPDATE users SET
          is_pro = false,
          subscription_status = 'free',
          subscription_expires_at = NULL,
          paper_credits_used = 0,
          paper_credits_reset_at = $1
        WHERE id = $2`,
        [now, userId]
      );
    } else {
      // Free -> Free (no change needed)
      await updateUserSubscription(userId, {
        isPro: false,
        status: 'free'
      });
    }

    const projectResult = await pool.query(
      'SELECT COUNT(*) as count FROM projects WHERE user_id = $1',
      [userId]
    );
    const projectCount = parseInt(projectResult.rows[0].count);
    const aiTokensUsed = await getUserAITokensUsed(userId);

    return NextResponse.json({
      success: true,
      subscription: {
        userId,
        planId,
        status: becomingPro ? 'active' : 'free',
        isPro: becomingPro,
        plan: plan,
        projectCount,
        canCreateProject: await canUserCreateProject(userId),
        limits: plan.limits,
        aiTokensUsed,
        aiTokenLimit: becomingPro ? -1 : SUBSCRIPTION_PLANS.FREE.limits.aiTokensPerMonth,
        remainingTokens: becomingPro ? -1 : Math.max(0, SUBSCRIPTION_PLANS.FREE.limits.aiTokensPerMonth - aiTokensUsed)
      }
    });

  } catch (error) {
    console.error('Subscription update error:', error);
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 });
  }
}

// DELETE - Cancel subscription
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({
        success: false,
        error: 'User ID is required'
      }, { status: 400 });
    }

    // Verify authorization
    const auth = await verifyUserAuthorization(userId);
    if (!auth.authorized) {
      return NextResponse.json({
        success: false,
        error: auth.error
      }, { status: auth.session ? 403 : 401 });
    }

    const subscription = await getUserSubscription(userId);
    if (!subscription) {
      return NextResponse.json({
        success: false,
        error: 'User subscription not found'
      }, { status: 404 });
    }

    // Cancel Stripe subscription if it exists (skip placeholders like manual-fix)
    if (subscription.stripeSubscriptionId && isRealStripeSubscriptionId(subscription.stripeSubscriptionId)) {
      try {
        await cancelStripeSubscription(subscription.stripeSubscriptionId);
      } catch (stripeError) {
        console.error('Error canceling Stripe subscription:', stripeError);
        // Continue with local cancellation even if Stripe fails
      }
    }

    // Downgrade to free plan: reset credits to 0, set anchor to NOW
    const now = new Date().toISOString();
    await pool.query(
      `UPDATE users SET
        is_pro = false,
        subscription_status = 'cancelled',
        subscription_expires_at = NULL,
        stripe_subscription_id = NULL,
        paper_credits_used = 0,
        paper_credits_reset_at = $1
      WHERE id = $2`,
      [now, userId]
    );

    const projectResult = await pool.query(
      'SELECT COUNT(*) as count FROM projects WHERE user_id = $1',
      [userId]
    );
    const projectCount = parseInt(projectResult.rows[0].count);
    const aiTokensUsed = await getUserAITokensUsed(userId);
    const freePlan = getPlanById('free');

    return NextResponse.json({
      success: true,
      message: 'Subscription cancelled successfully',
      subscription: {
        userId,
        planId: 'free',
        status: 'active',
        isPro: false,
        plan: freePlan,
        projectCount,
        canCreateProject: projectCount < freePlan.limits.maxProjects,
        limits: freePlan.limits,
        aiTokensUsed,
        aiTokenLimit: SUBSCRIPTION_PLANS.FREE.limits.aiTokensPerMonth,
        remainingTokens: Math.max(0, SUBSCRIPTION_PLANS.FREE.limits.aiTokensPerMonth - aiTokensUsed)
      }
    });

  } catch (error) {
    console.error('Subscription cancellation error:', error);
    return NextResponse.json({
      success: false,
      error: 'Internal server error'
    }, { status: 500 });
  }
}
