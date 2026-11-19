/**
 * Sync subscription status from Stripe
 * Fixes mismatch when user re-subscribed but DB still shows cancelled.
 * User must be authenticated; syncs their own subscription only.
 */

import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe-config.js';
import { updateUserSubscription, getUserSubscription } from '@/lib/user-subscription.js';
import { getSessionFromRequest } from '@/lib/project-auth.js';

export async function POST(request) {
  try {
    const session = await getSessionFromRequest();
    if (!session?.id) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const userId = session.id;

    if (!stripe) {
      return NextResponse.json({ success: false, error: 'Stripe not configured' }, { status: 503 });
    }

    const sub = await getUserSubscription(userId);
    const customerId = sub?.stripeCustomerId;

    if (!customerId || !customerId.startsWith('cus_')) {
      return NextResponse.json({
        success: false,
        error: 'No Stripe customer linked. Subscribe to Pro first.',
      }, { status: 400 });
    }

    // List active subscriptions for this customer
    const { data: subscriptions } = await stripe.subscriptions.list({
      customer: customerId,
      status: 'active',
      limit: 1,
    });

    if (subscriptions.length === 0) {
      // No active subscription in Stripe - ensure DB reflects free/cancelled
      return NextResponse.json({
        success: true,
        synced: false,
        message: 'No active subscription in Stripe. Your profile is correct.',
        subscription: await getUserSubscription(userId),
      });
    }

    const stripeSub = subscriptions[0];
    const paperCreditsResetAt = new Date(stripeSub.current_period_start * 1000).toISOString();

    await updateUserSubscription(userId, {
      isPro: true,
      status: stripeSub.status,
      expiresAt: new Date(stripeSub.current_period_end * 1000).toISOString(),
      stripeSubscriptionId: stripeSub.id,
      paperCreditsResetAt,
    });

    return NextResponse.json({
      success: true,
      synced: true,
      message: 'Subscription synced from Stripe.',
      subscription: await getUserSubscription(userId),
    });
  } catch (error) {
    console.error('[subscription/sync] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to sync subscription' },
      { status: 500 }
    );
  }
}
