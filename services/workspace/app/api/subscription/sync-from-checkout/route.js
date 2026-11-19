/**
 * Sync subscription from Stripe Checkout session
 * Called when user returns from Stripe Checkout with session_id.
 * Works in production as a fallback when webhooks fail or are delayed.
 * User must be authenticated and can only sync their own session.
 */

import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe-config.js';
import { updateUserSubscription } from '@/lib/user-subscription.js';
import { getSessionFromRequest } from '@/lib/project-auth.js';

export async function POST(request) {
  try {
    const session = await getSessionFromRequest();
    if (!session?.id) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const { sessionId } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ success: false, error: 'session_id is required' }, { status: 400 });
    }

    if (!stripe) {
      return NextResponse.json({ success: false, error: 'Stripe not configured' }, { status: 503 });
    }

    // Retrieve checkout session with subscription expanded
    const checkoutSession = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription'],
    });

    if (checkoutSession.mode !== 'subscription' || !checkoutSession.subscription) {
      return NextResponse.json({ success: false, error: 'Invalid checkout session' }, { status: 400 });
    }

    // Only allow sync for paid sessions (prevents abuse with abandoned/incomplete checkouts)
    if (checkoutSession.payment_status !== 'paid') {
      return NextResponse.json({ success: false, error: 'Payment not completed' }, { status: 400 });
    }

    const metadataUserId = checkoutSession.metadata?.userId;
    const userId = metadataUserId || session.id;

    // Ensure the session user can only sync for themselves
    if (userId !== session.id) {
      return NextResponse.json({ success: false, error: 'Not authorized to sync this session' }, { status: 403 });
    }

    const stripeSubscription =
      typeof checkoutSession.subscription === 'object'
        ? checkoutSession.subscription
        : await stripe.subscriptions.retrieve(checkoutSession.subscription);

    const customerId = typeof checkoutSession.customer === 'string'
      ? checkoutSession.customer
      : checkoutSession.customer?.id;

    const paperCreditsResetAt = new Date(stripeSubscription.current_period_start * 1000).toISOString();

    await updateUserSubscription(userId, {
      isPro: true,
      status: stripeSubscription.status,
      expiresAt: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
      stripeCustomerId: customerId,
      stripeSubscriptionId: stripeSubscription.id,
      paperCreditsResetAt,
    });

    return NextResponse.json({
      success: true,
      message: 'Subscription synced successfully',
    });
  } catch (error) {
    console.error('[sync-from-checkout] Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to sync subscription' },
      { status: 500 }
    );
  }
}
