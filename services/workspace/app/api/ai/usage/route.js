/**
 * AI Usage Statistics API
 * Returns current AI token usage information for users
 */

import { NextResponse } from 'next/server';
import { getUserSubscription, getUserAITokensUsed } from '@/lib/user-subscription.js';
import { SUBSCRIPTION_PLANS } from '@/lib/subscription-plans.js';

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!userId) {
      return NextResponse.json({
        success: false,
        error: 'User ID is required'
      }, { status: 400 });
    }

    // Get user subscription info
    const subscription = await getUserSubscription(userId);
    if (!subscription) {
      return NextResponse.json({
        success: false,
        error: 'User not found'
      }, { status: 404 });
    }

    // Get AI tokens used (will auto-reset if new month)
    const tokensUsed = await getUserAITokensUsed(userId);
    const isPro = subscription.isPro;

    // Determine token limit
    const tokenLimit = isPro ? -1 : SUBSCRIPTION_PLANS.FREE.limits.aiTokensPerMonth;
    const remaining = isPro ? -1 : Math.max(0, tokenLimit - tokensUsed);

    // Get reset date (next month)
    const resetAt = new Date(subscription.aiTokensResetAt);
    resetAt.setMonth(resetAt.getMonth() + 1);
    resetAt.setDate(1);
    resetAt.setHours(0, 0, 0, 0);

    return NextResponse.json({
      success: true,
      usage: {
        tokensUsed,
        tokenLimit,
        remaining,
        isPro,
        percentageUsed: isPro ? 0 : Math.round((tokensUsed / tokenLimit) * 100),
        resetDate: resetAt.toISOString()
      }
    });

  } catch (error) {
    console.error('AI usage API error:', error);
    return NextResponse.json({
      success: false,
      error: 'Failed to retrieve AI usage'
    }, { status: 500 });
  }
}

