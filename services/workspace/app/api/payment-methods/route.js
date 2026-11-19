/**
 * Payment Method API
 * Handles Stripe payment method operations
 */

import { NextResponse } from 'next/server';
import { stripe, getOrCreateStripeCustomer } from '@/lib/stripe-config.js';

// POST - Create payment method
export async function POST(request) {
  try {
    const { userId, email, name, paymentMethodId } = await request.json();

    if (!userId || !email || !name || !paymentMethodId) {
      return NextResponse.json({
        success: false,
        error: 'User ID, email, name, and payment method ID are required'
      }, { status: 400 });
    }

    // Get or create Stripe customer
    const customer = await getOrCreateStripeCustomer(userId, email, name);

    // Attach payment method to customer
    await stripe.paymentMethods.attach(paymentMethodId, {
      customer: customer.id,
    });

    // Set as default payment method
    await stripe.customers.update(customer.id, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    return NextResponse.json({
      success: true,
      customerId: customer.id,
      paymentMethodId: paymentMethodId
    });

  } catch (error) {
    console.error('Payment method creation error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to create payment method'
    }, { status: 400 });
  }
}

// GET - Get customer's payment methods
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const customerId = searchParams.get('customerId');

    if (!customerId) {
      return NextResponse.json({
        success: false,
        error: 'Customer ID is required'
      }, { status: 400 });
    }

    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });

    return NextResponse.json({
      success: true,
      paymentMethods: paymentMethods.data.map(pm => ({
        id: pm.id,
        type: pm.type,
        card: pm.card ? {
          brand: pm.card.brand,
          last4: pm.card.last4,
          expMonth: pm.card.exp_month,
          expYear: pm.card.exp_year
        } : null
      }))
    });

  } catch (error) {
    console.error('Payment methods retrieval error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to retrieve payment methods'
    }, { status: 400 });
  }
}

// DELETE - Remove payment method
export async function DELETE(request) {
  try {
    const { searchParams } = new URL(request.url);
    const paymentMethodId = searchParams.get('paymentMethodId');

    if (!paymentMethodId) {
      return NextResponse.json({
        success: false,
        error: 'Payment method ID is required'
      }, { status: 400 });
    }

    await stripe.paymentMethods.detach(paymentMethodId);

    return NextResponse.json({
      success: true,
      message: 'Payment method removed successfully'
    });

  } catch (error) {
    console.error('Payment method removal error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to remove payment method'
    }, { status: 400 });
  }
}

