/**
 * Stripe Checkout API
 * Creates checkout sessions for subscriptions
 */

import { NextResponse } from 'next/server';
import { createCheckoutSession } from '@/lib/stripe-checkout.js';
import { STRIPE_CONFIG } from '@/lib/stripe-config.js';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import { isValidUUID, getValidUserID } from '@/lib/user-validation.js';

// POST - Create checkout session
export async function POST(request) {
  try {
    const session = await getSessionFromRequest();
    if (!session?.id) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 });
    }

    const { userId, email, billingInterval = 'monthly' } = await request.json();

    if (!userId || !email) {
      return NextResponse.json({
        success: false,
        error: 'User ID and email are required'
      }, { status: 400 });
    }

    // Only allow creating checkout for the authenticated user
    const resolvedUserId = isValidUUID(userId) ? userId : await getValidUserID(userId).catch(() => null);
    if (resolvedUserId !== session.id) {
      return NextResponse.json({ success: false, error: 'Not authorized to create checkout for this user' }, { status: 403 });
    }

    // Determine price ID based on billing interval
    const priceId = billingInterval === 'yearly' 
      ? STRIPE_CONFIG.prices.proYearly 
      : STRIPE_CONFIG.prices.proMonthly;

    // Determine redirect URLs
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
    const successUrl = `${baseUrl}/dashboard?session_id={CHECKOUT_SESSION_ID}&upgraded=true`;
    const cancelUrl = `${baseUrl}/dashboard?canceled=true`;

    // Create checkout session
    const checkoutSession = await createCheckoutSession(
      resolvedUserId,
      email,
      priceId,
      successUrl,
      cancelUrl
    );

    return NextResponse.json({
      success: true,
      url: checkoutSession.url, // Redirect user to this URL
      sessionId: checkoutSession.id
    });

  } catch (error) {
    console.error('Checkout creation error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to create checkout session'
    }, { status: 400 });
  }
}

