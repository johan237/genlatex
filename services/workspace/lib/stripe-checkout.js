/**
 * Stripe Checkout Integration
 * Creates Stripe Checkout sessions for subscriptions
 */

import { stripe } from './stripe-config.js';

/**
 * Create a Stripe Checkout session for subscription
 * @param {string} userId - User ID
 * @param {string} customerEmail - User's email
 * @param {string} priceId - Stripe price ID
 * @param {string} successUrl - URL to redirect after success
 * @param {string} cancelUrl - URL to redirect after cancel
 * @returns {Promise<object>} Checkout session
 */
export async function createCheckoutSession(userId, customerEmail, priceId, successUrl, cancelUrl) {
  if (!stripe) {
    throw new Error('Stripe is not initialized. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer_email: customerEmail,
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: userId,
      },
      subscription_data: {
        metadata: {
          userId: userId,
        },
      },
      allow_promotion_codes: true,
    });

    console.log('✅ Stripe checkout session created:', session.id);
    console.log('📧 Customer email:', customerEmail);
    console.log('👤 User ID:', userId);
    console.log('🔗 Session URL:', session.url);
    
    return session;
  } catch (error) {
    console.error('Error creating Stripe checkout session:', error);
    throw error;
  }
}

/**
 * Create Stripe customer portal session
 * @param {string} customerId - Stripe customer ID
 * @param {string} returnUrl - URL to return after portal session
 * @returns {Promise<object>} Portal session
 */
export async function createPortalSession(customerId, returnUrl) {
  if (!stripe) {
    throw new Error('Stripe is not initialized. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    return session;
  } catch (error) {
    console.error('Error creating Stripe portal session:', error);
    throw error;
  }
}

