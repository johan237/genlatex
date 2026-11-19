/**
 * Billing Management API
 * Handles invoices, payment history, and billing information
 */

import { NextResponse } from 'next/server';
import { stripe, validateStripeConfig } from '@/lib/stripe-config.js';
import { getSessionFromRequest } from '@/lib/project-auth.js';

// GET - Get billing history and invoices
export async function GET(request) {
  try {
    // Require authentication
    const session = await getSessionFromRequest();
    if (!session?.id) {
      return NextResponse.json({
        success: false,
        error: 'Authentication required'
      }, { status: 401 });
    }

    // Validate Stripe configuration
    if (!stripe) {
      return NextResponse.json({
        success: false,
        error: 'Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.'
      }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    let customerId = searchParams.get('customerId');
    const userId = searchParams.get('userId');

    // Security: only allow accessing own billing data
    const targetUserId = userId || session.id;
    if (targetUserId !== session.id) {
      return NextResponse.json({
        success: false,
        error: 'Not authorized to access this billing information'
      }, { status: 403 });
    }

    // Find customer by userId metadata (secure method)
    let customer;
    try {
      const customerSearch = await stripe.customers.search({
        query: `metadata['userId']:'${targetUserId}'`,
        limit: 1,
      });
      customer = customerSearch.data[0];
    } catch (searchError) {
      console.error('Customer search error:', searchError);
    }

    if (!customer && customerId) {
      // Fallback: verify customerId belongs to this user
      customer = await stripe.customers.retrieve(customerId);
      if (customer.metadata?.userId !== targetUserId) {
        return NextResponse.json({
          success: false,
          error: 'Customer not found for this user'
        }, { status: 404 });
      }
    }

    if (!customer) {
      return NextResponse.json({
        success: false,
        error: 'No billing account found. Subscribe to Pro to access billing.'
      }, { status: 404 });
    }

    customerId = customer.id;

    // Get invoices
    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 12,
      expand: ['data.payment_intent', 'data.charge'],
    });

    // Get upcoming invoice if subscription exists
    const subscriptions = await stripe.subscriptions.list({
      customer: customerId,
      limit: 1,
      status: 'active',
    });

    let upcomingInvoice = null;
    if (subscriptions.data.length > 0) {
      try {
        upcomingInvoice = await stripe.invoices.retrieveUpcoming({
          customer: customerId,
          subscription: subscriptions.data[0].id,
        });
      } catch (error) {
        // Upcoming invoice might not be available
        console.log('No upcoming invoice');
      }
    }

    // Get payment methods
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });

    return NextResponse.json({
      success: true,
      billing: {
        customer: {
          id: customer.id,
          email: customer.email,
          name: customer.name,
          created: customer.created,
        },
        invoices: invoices.data.map(invoice => ({
          id: invoice.id,
          status: invoice.status,
          amount: invoice.amount_paid,
          currency: invoice.currency,
          date: invoice.created,
          period_start: invoice.period_start,
          period_end: invoice.period_end,
          hosted_invoice_url: invoice.hosted_invoice_url,
          invoice_pdf: invoice.invoice_pdf,
          line_items: invoice.lines.data.map(item => ({
            description: item.description,
            amount: item.amount,
            quantity: item.quantity,
          })),
        })),
        upcomingInvoice: upcomingInvoice ? {
          amount_due: upcomingInvoice.amount_due,
          currency: upcomingInvoice.currency,
          period_end: upcomingInvoice.period_end,
          line_items: upcomingInvoice.lines.data.map(item => ({
            description: item.description,
            amount: item.amount,
          })),
        } : null,
        paymentMethods: paymentMethods.data.map(pm => ({
          id: pm.id,
          type: pm.type,
          card: pm.card ? {
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.exp_month,
            expYear: pm.card.exp_year,
          } : null,
        })),
      }
    });

  } catch (error) {
    console.error('Billing API error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to retrieve billing information'
    }, { status: 400 });
  }
}

// POST - Create portal session for managing billing
export async function POST(request) {
  try {
    // Require authentication
    const userSession = await getSessionFromRequest();
    if (!userSession?.id) {
      return NextResponse.json({
        success: false,
        error: 'Authentication required'
      }, { status: 401 });
    }

    // Validate Stripe configuration
    if (!stripe) {
      return NextResponse.json({
        success: false,
        error: 'Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.'
      }, { status: 500 });
    }

    const { returnUrl } = await request.json();

    // Find customer by authenticated user's ID (secure - no need for customerId from client)
    let customer;
    try {
      const customerSearch = await stripe.customers.search({
        query: `metadata['userId']:'${userSession.id}'`,
        limit: 1,
      });
      customer = customerSearch.data[0];
    } catch (searchError) {
      console.error('Customer search error:', searchError);
    }

    if (!customer) {
      return NextResponse.json({
        success: false,
        error: 'No billing account found. Subscribe to Pro to access the billing portal.'
      }, { status: 404 });
    }

    // Create billing portal session
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl || `${process.env.NEXT_PUBLIC_BASE_URL}/dashboard`,
    });

    return NextResponse.json({
      success: true,
      url: portalSession.url,
    });

  } catch (error) {
    console.error('Portal session creation error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to create billing portal session'
    }, { status: 400 });
  }
}

