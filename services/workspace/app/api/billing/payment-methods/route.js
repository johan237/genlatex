/**
 * Payment Method Management API
 * Handles adding, retrieving, and managing payment methods
 */

import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe-config.js';

// GET - Get customer payment methods
export async function GET(request) {
  try {
    if (!stripe) {
      return NextResponse.json({
        success: false,
        error: 'Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.'
      }, { status: 500 });
    }

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

    const customer = await stripe.customers.retrieve(customerId);
    const defaultPaymentMethod = customer.invoice_settings?.default_payment_method;

    return NextResponse.json({
      success: true,
      paymentMethods: paymentMethods.data.map(pm => ({
        id: pm.id,
        type: pm.type,
        card: pm.card ? {
          brand: pm.card.brand,
          last4: pm.card.last4,
          expMonth: pm.card.exp_month,
          expYear: pm.card.exp_year,
          country: pm.card.country,
        } : null,
        billing_details: pm.billing_details,
        isDefault: pm.id === defaultPaymentMethod,
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

// POST - Set default payment method
export async function POST(request) {
  try {
    if (!stripe) {
      return NextResponse.json({
        success: false,
        error: 'Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.'
      }, { status: 500 });
    }

    const { customerId, paymentMethodId } = await request.json();

    if (!customerId || !paymentMethodId) {
      return NextResponse.json({
        success: false,
        error: 'Customer ID and Payment Method ID are required'
      }, { status: 400 });
    }

    // Update customer's default payment method
    const customer = await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });

    return NextResponse.json({
      success: true,
      defaultPaymentMethod: customer.invoice_settings?.default_payment_method,
    });

  } catch (error) {
    console.error('Payment method update error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to update payment method'
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

