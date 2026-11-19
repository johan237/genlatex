/**
 * Invoice Management API
 * Handles invoice retrieval and download
 */

import { NextResponse } from 'next/server';
import { stripe } from '@/lib/stripe-config.js';

// GET - Get invoice by ID
export async function GET(request) {
  try {
    if (!stripe) {
      return NextResponse.json({
        success: false,
        error: 'Stripe is not configured. Please set STRIPE_SECRET_KEY environment variable.'
      }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const invoiceId = searchParams.get('invoiceId');

    if (!invoiceId) {
      return NextResponse.json({
        success: false,
        error: 'Invoice ID is required'
      }, { status: 400 });
    }

    const invoice = await stripe.invoices.retrieve(invoiceId, {
      expand: ['charge', 'payment_intent'],
    });

    return NextResponse.json({
      success: true,
      invoice: {
        id: invoice.id,
        status: invoice.status,
        amount: invoice.amount_paid,
        currency: invoice.currency,
        date: invoice.created,
        period_start: invoice.period_start,
        period_end: invoice.period_end,
        hosted_invoice_url: invoice.hosted_invoice_url,
        invoice_pdf: invoice.invoice_pdf,
        invoice_number: invoice.number,
        subtotal: invoice.subtotal,
        total: invoice.total,
        customer_name: invoice.customer_name,
        customer_email: invoice.customer_email,
        line_items: invoice.lines.data.map(item => ({
          description: item.description,
          amount: item.amount,
          quantity: item.quantity,
          period: item.period,
        })),
        charge: invoice.charge ? {
          id: invoice.charge.id,
          status: invoice.charge.status,
          paid: invoice.charge.paid,
        } : null,
      }
    });

  } catch (error) {
    console.error('Invoice retrieval error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Failed to retrieve invoice'
    }, { status: 400 });
  }
}

