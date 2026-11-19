/**
 * Stripe Webhook Handler
 * Processes Stripe webhook events for subscription updates
 * Uses database-backed idempotency tracking to prevent duplicate processing
 * (safe for multi-instance deployments and server restarts)
 */

import { NextResponse } from 'next/server';
import { verifyWebhookSignature, stripe } from '@/lib/stripe-config.js';
import { pool } from '@/lib/db.js';
import { updateUserSubscription, getUserSubscription } from '@/lib/user-subscription.js';

/**
 * Ensure the stripe_webhook_events table exists for idempotency tracking.
 * This table stores processed event IDs to prevent duplicate processing.
 */
async function ensureWebhookEventsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stripe_webhook_events (
      event_id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Create index for cleanup queries (processed_at)
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_processed_at
    ON stripe_webhook_events(processed_at)
  `).catch(() => { /* index may already exist */ });
}

// Ensure table exists on module load (runs once per cold start)
let tableEnsured = false;
async function ensureTableOnce() {
  if (!tableEnsured) {
    await ensureWebhookEventsTable();
    tableEnsured = true;
  }
}

/**
 * Check if event was already processed (database-backed idempotency)
 * @param {string} eventId - Stripe event ID
 * @returns {Promise<boolean>} true if already processed
 */
async function isEventProcessed(eventId) {
  await ensureTableOnce();
  const result = await pool.query(
    `SELECT 1 FROM stripe_webhook_events WHERE event_id = $1`,
    [eventId]
  );
  return result.rows.length > 0;
}

/**
 * Mark event as processed in database
 * @param {string} eventId - Stripe event ID
 * @param {string} eventType - Stripe event type
 */
async function markEventProcessed(eventId, eventType) {
  await ensureTableOnce();
  await pool.query(
    `INSERT INTO stripe_webhook_events (event_id, event_type)
     VALUES ($1, $2)
     ON CONFLICT (event_id) DO NOTHING`,
    [eventId, eventType]
  );

  // Cleanup old entries (older than 7 days) periodically - 1% chance per request
  if (Math.random() < 0.01) {
    pool.query(
      `DELETE FROM stripe_webhook_events WHERE processed_at < NOW() - INTERVAL '7 days'`
    ).catch(err => console.warn('[stripe-webhook] Cleanup error:', err.message));
  }
}

// Update subscription status in database. For Pro, sync paper credits period with Stripe (current_period_start/end).
// When stripeSubscriptionId lookup fails (e.g. user re-subscribed after cancel, so we cleared it),
// falls back to stripeCustomerId lookup so we can find the user and update.
async function updateSubscriptionStatus(stripeSubscriptionId, status, expiresAt = null, currentPeriodStart = null, stripeCustomerId = null) {
  try {
    let result = await pool.query(
      `SELECT id, paper_credits_reset_at FROM users WHERE stripe_subscription_id = $1`,
      [stripeSubscriptionId]
    );

    // Re-subscribe case: user cancelled, we cleared stripe_subscription_id; they have new subscription.
    // Look up by stripe_customer_id (we don't clear that on cancel).
    if (result.rows.length === 0 && stripeCustomerId) {
      result = await pool.query(
        `SELECT id, paper_credits_reset_at FROM users WHERE stripe_customer_id = $1`,
        [stripeCustomerId]
      );
      if (result.rows.length > 0) {
        console.log(`Found user by stripe_customer_id for re-subscription: ${stripeSubscriptionId}`);
      }
    }

    if (result.rows.length === 0) {
      console.warn(`No user found for Stripe subscription ID: ${stripeSubscriptionId}${stripeCustomerId ? ` or customer: ${stripeCustomerId}` : ''}`);
      return null;
    }

    const userId = result.rows[0].id;
    const updates = {
      isPro: status === 'active',
      status: status,
      expiresAt: expiresAt ? new Date(expiresAt * 1000).toISOString() : null,
      stripeSubscriptionId: stripeSubscriptionId // Keep in sync (critical when found by customer_id on re-subscribe)
    };
    // Reset paper credits only when Stripe period has rolled (new current_period_start)
    if (currentPeriodStart != null) {
      const newPeriodStartIso = new Date(currentPeriodStart * 1000).toISOString();
      const storedStart = result.rows[0].paper_credits_reset_at;
      const storedIso = storedStart ? new Date(storedStart).toISOString() : null;
      if (storedIso !== newPeriodStartIso) {
        updates.paperCreditsResetAt = newPeriodStartIso;
      }
    }

    await updateUserSubscription(userId, updates);

    console.log(`Updated subscription for user ${userId}: ${status}`);
    return { userId, status };
  } catch (error) {
    console.error('Error updating subscription status:', error);
    return null;
  }
}

/**
 * Handle subscription cancellation:
 * - Set user to free tier
 * - Reset paper credits to 0
 * - Set anchor date to NOW (cancellation date) for fresh start on free tier
 */
async function handleSubscriptionCancelled(stripeSubscriptionId) {
  try {
    const result = await pool.query(
      `SELECT id FROM users WHERE stripe_subscription_id = $1`,
      [stripeSubscriptionId]
    );
    if (result.rows.length === 0) {
      console.warn(`No user found for cancelled subscription: ${stripeSubscriptionId}`);
      return null;
    }
    const userId = result.rows[0].id;
    const now = new Date().toISOString();

    // Reset everything: is_pro=false, credits=0, anchor=now, clear stripe IDs
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

    console.log(`Subscription cancelled for user ${userId}: credits reset, anchor set to ${now}`);
    return { userId, status: 'cancelled' };
  } catch (error) {
    console.error('Error handling subscription cancellation:', error);
    return null;
  }
}

// Handle different webhook events
async function handleWebhookEvent(event) {
  console.log(`Processing webhook event: ${event.type}`);

  switch (event.type) {
    case 'checkout.session.completed':
      const session = event.data.object;
      const userId = session.metadata?.userId;
      
      if (userId) {
        // Get customer and subscription info
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (customerId && subscriptionId) {
          // Get subscription details from Stripe
          const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
          // Align paper credits period with Stripe billing: period start = current_period_start
          const paperCreditsResetAt = new Date(stripeSubscription.current_period_start * 1000).toISOString();
          await updateUserSubscription(userId, {
            isPro: true,
            status: stripeSubscription.status,
            expiresAt: new Date(stripeSubscription.current_period_end * 1000).toISOString(),
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscriptionId,
            paperCreditsResetAt
          });
          console.log(`Activated Pro subscription for user ${userId} (credits reset at Stripe period: ${paperCreditsResetAt})`);
        }
      }
      break;

    case 'customer.subscription.created':
    case 'customer.subscription.updated':
      const subscription = event.data.object;
      const subCustomerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
      await updateSubscriptionStatus(
        subscription.id,
        subscription.status,
        subscription.current_period_end,
        subscription.current_period_start,
        subCustomerId
      );
      break;

    case 'customer.subscription.deleted':
      const deletedSubscription = event.data.object;
      // On cancellation: reset credits to 0 and set anchor to NOW (cancellation date)
      await handleSubscriptionCancelled(deletedSubscription.id);
      break;

    case 'invoice.payment_succeeded':
      const invoice = event.data.object;
      if (invoice.subscription) {
        const invCustomerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id;
        await updateSubscriptionStatus(invoice.subscription, 'active', invoice.period_end, invoice.period_start, invCustomerId);
      }
      break;

    case 'invoice.payment_failed':
      const failedInvoice = event.data.object;
      if (failedInvoice.subscription) {
        // Check attempt count - if this is a final failure, consider downgrading
        const attemptCount = failedInvoice.attempt_count || 1;
        console.log(`Payment failed for subscription ${failedInvoice.subscription}, attempt ${attemptCount}`);

        if (attemptCount >= 3) {
          // After 3 failed attempts, downgrade to free tier
          console.log(`Final payment failure after ${attemptCount} attempts - downgrading user`);
          await handleSubscriptionCancelled(failedInvoice.subscription);
        } else {
          // Mark as past_due but keep Pro access temporarily
          const failedInvCustomerId = typeof failedInvoice.customer === 'string' ? failedInvoice.customer : failedInvoice.customer?.id;
          await updateSubscriptionStatus(failedInvoice.subscription, 'past_due', null, null, failedInvCustomerId);
        }
      }
      break;

    case 'customer.subscription.trial_will_end':
      const trialSubscription = event.data.object;
      console.log(`Trial ending soon for subscription: ${trialSubscription.id}`);
      break;

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }
}

export async function POST(request) {
  try {
    const body = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
      console.error('Missing Stripe signature');
      return NextResponse.json({
        error: 'Missing Stripe signature'
      }, { status: 400 });
    }

    // Verify webhook signature
    let event;
    try {
      event = verifyWebhookSignature(body, signature);
    } catch (error) {
      console.error('Webhook signature verification failed:', error);
      return NextResponse.json({
        error: 'Invalid signature'
      }, { status: 400 });
    }

    // Idempotency check - prevent duplicate processing of same event
    if (await isEventProcessed(event.id)) {
      console.log(`Skipping already processed event: ${event.id} (${event.type})`);
      return NextResponse.json({
        received: true,
        eventType: event.type,
        skipped: true,
        reason: 'Event already processed'
      });
    }

    // Handle the webhook event
    await handleWebhookEvent(event);

    // Mark event as processed after successful handling
    await markEventProcessed(event.id, event.type);

    return NextResponse.json({
      received: true,
      eventType: event.type
    });

  } catch (error) {
    console.error('Webhook processing error:', error);
    return NextResponse.json({
      error: 'Webhook processing failed'
    }, { status: 500 });
  }
}

