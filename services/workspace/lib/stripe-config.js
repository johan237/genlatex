/**
 * Stripe Configuration
 * Handles Stripe API integration for payments and subscriptions
 */

import Stripe from 'stripe';

// Validate Stripe secret key
if (!process.env.STRIPE_SECRET_KEY) {
  console.warn('⚠️  STRIPE_SECRET_KEY is not set. Stripe features will not work.');
}

// Initialize Stripe with secret key
const stripe = process.env.STRIPE_SECRET_KEY 
  ? new Stripe(process.env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-12-18.acacia', // Latest API version
    })
  : null;

// Stripe product and price IDs (you'll need to create these in your Stripe dashboard)
const STRIPE_CONFIG = {
  products: {
    pro: process.env.STRIPE_PRO_PRODUCT_ID || 'prod_pro_placeholder',
  },
  prices: {
    proMonthly: process.env.STRIPE_PRO_MONTHLY_PRICE_ID || 'price_pro_monthly_placeholder',
    proYearly: process.env.STRIPE_PRO_YEARLY_PRICE_ID || 'price_pro_yearly_placeholder',
  },
  webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
};

// Create or retrieve Stripe customer
// IMPORTANT: Only returns a customer if userId matches exactly in metadata
// This prevents account takeover via email changes
export async function getOrCreateStripeCustomer(userId, email, name) {
  if (!stripe) {
    throw new Error('Stripe is not initialized. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    // First, search by userId in metadata (most secure approach)
    const customersByMetadata = await stripe.customers.search({
      query: `metadata['userId']:'${userId}'`,
      limit: 1,
    });

    if (customersByMetadata.data.length > 0) {
      const existingCustomer = customersByMetadata.data[0];
      // Update email if it changed (user may have updated their email)
      if (existingCustomer.email !== email) {
        console.log(`Updating Stripe customer email from ${existingCustomer.email} to ${email}`);
        await stripe.customers.update(existingCustomer.id, { email, name });
      }
      return existingCustomer;
    }

    // No existing customer for this userId - create a new one
    // Do NOT reuse customers with matching email but different userId
    // (this prevents account takeover if someone else used the same email)
    const customer = await stripe.customers.create({
      email: email,
      name: name,
      metadata: {
        userId: userId,
      },
    });

    console.log(`Created new Stripe customer ${customer.id} for userId ${userId}`);
    return customer;
  } catch (error) {
    console.error('Error creating/finding Stripe customer:', error);
    throw error;
  }
}

// Create subscription
export async function createStripeSubscription(customerId, priceId, paymentMethodId) {
  if (!stripe) {
    throw new Error('Stripe is not initialized. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });

    // Set as default payment method
    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    // Create subscription
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
    });

    return subscription;
  } catch (error) {
    console.error('Error creating Stripe subscription:', error);
    throw error;
  }
}

// Get subscription details
export async function getStripeSubscription(subscriptionId) {
  if (!stripe) {
    throw new Error('Stripe is not initialized. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ['latest_invoice', 'customer'],
    });

    return subscription;
  } catch (error) {
    console.error('Error retrieving Stripe subscription:', error);
    throw error;
  }
}

// Cancel subscription
export async function cancelStripeSubscription(subscriptionId) {
  if (!stripe) {
    throw new Error('Stripe is not initialized. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const subscription = await stripe.subscriptions.cancel(subscriptionId);
    return subscription;
  } catch (error) {
    console.error('Error canceling Stripe subscription:', error);
    throw error;
  }
}

// Update subscription
export async function updateStripeSubscription(subscriptionId, newPriceId) {
  if (!stripe) {
    throw new Error('Stripe is not initialized. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    
    const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
      items: [{
        id: subscription.items.data[0].id,
        price: newPriceId,
      }],
      proration_behavior: 'create_prorations',
    });

    return updatedSubscription;
  } catch (error) {
    console.error('Error updating Stripe subscription:', error);
    throw error;
  }
}

// Create payment intent for one-time payments
export async function createPaymentIntent(amount, currency, customerId, metadata = {}) {
  if (!stripe) {
    throw new Error('Stripe is not initialized. Please set STRIPE_SECRET_KEY environment variable.');
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: currency,
      customer: customerId,
      metadata: metadata,
      automatic_payment_methods: {
        enabled: true,
      },
    });

    return paymentIntent;
  } catch (error) {
    console.error('Error creating payment intent:', error);
    throw error;
  }
}

// Verify webhook signature
export function verifyWebhookSignature(payload, signature) {
  try {
    if (!stripe) {
      throw new Error('Stripe is not initialized. Check STRIPE_SECRET_KEY environment variable.');
    }
    
    if (!STRIPE_CONFIG.webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not configured');
    }

    const event = stripe.webhooks.constructEvent(
      payload,
      signature,
      STRIPE_CONFIG.webhookSecret
    );
    return event;
  } catch (error) {
    console.error('Webhook signature verification failed:', error);
    throw error;
  }
}

// Validate Stripe configuration
export function validateStripeConfig() {
  const required = [
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'STRIPE_PRO_PRODUCT_ID',
    'STRIPE_PRO_MONTHLY_PRICE_ID',
    'STRIPE_PRO_YEARLY_PRICE_ID',
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.warn('⚠️  Missing Stripe environment variables:', missing.join(', '));
    return false;
  }
  
  return true;
}

export { stripe, STRIPE_CONFIG };

