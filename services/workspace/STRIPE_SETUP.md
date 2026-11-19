# Stripe Payment Integration Setup

This guide walks you through setting up Stripe for subscription payments in the GenLaTeX LaTeX Editor.

## Overview

The GenLaTeX application uses Stripe for handling subscription payments with the following features:
- Pro plan subscriptions (monthly/yearly)
- Secure payment processing
- Invoice management
- Billing portal for customers
- Webhook integration for real-time subscription updates

## Quick Start

### 1. Create a Stripe Account

Sign up at [https://dashboard.stripe.com/register](https://dashboard.stripe.com/register)

### 2. Get Your API Keys

Visit [https://dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys)

- **Publishable key**: Starts with `pk_test_` (for development) or `pk_live_` (for production)
- **Secret key**: Starts with `sk_test_` (for development) or `sk_live_` (for production)

**Important**: Never expose your secret key in client-side code. It should only be used on the server.

### 3. Create Products and Prices

**Option A — Script (recommended)**  
From the `genlatex` folder, with `STRIPE_SECRET_KEY` set in `.env`:

```bash
node scripts/create-stripe-products.js
```

This creates the GenLaTeX Pro product and two prices (no tax included):
- **$25/month** — monthly billing
- **$21/month paid annually** — $252/year

Copy the printed IDs into your `.env` as `STRIPE_PRO_PRODUCT_ID`, `STRIPE_PRO_MONTHLY_PRICE_ID`, and `STRIPE_PRO_YEARLY_PRICE_ID`.

**Option B — Stripe Dashboard**

Navigate to [https://dashboard.stripe.com/products](https://dashboard.stripe.com/products)

1. Click "Add product"
2. Name: **GenLaTeX Pro**, description: Unlimited projects and advanced features
3. Add **Monthly Price**: $25.00 USD, recurring monthly
4. Add **Yearly Price**: $252.00 USD, recurring yearly ($21/month equivalent)
5. Copy the Product ID and both Price IDs into your `.env`

### 4. Configure Environment Variables

Create a `.env` file in your project root (see `stripe-env-template.txt`):

```env
# Stripe Secret Keys (SERVER-SIDE ONLY)
STRIPE_SECRET_KEY=sk_test_your_secret_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# Product and Price IDs
STRIPE_PRO_PRODUCT_ID=prod_your_product_id_here
STRIPE_PRO_MONTHLY_PRICE_ID=price_your_monthly_price_id_here
STRIPE_PRO_YEARLY_PRICE_ID=price_your_yearly_price_id_here

# Publishable Key (SAFE for client-side)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
```

### 5. Set Up Webhook (Production)

Webhooks allow Stripe to notify your application about subscription events.

#### Development (using Stripe CLI)

1. Install [Stripe CLI](https://stripe.com/docs/stripe-cli)
2. Login: `stripe login`
3. Forward events: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`

#### Production

1. Go to [https://dashboard.stripe.com/webhooks](https://dashboard.stripe.com/webhooks)
2. Click "Add endpoint"
3. Configure:
   - **Endpoint URL**: `https://your-domain.com/api/webhooks/stripe`
   - **Events to send**:
     * `customer.subscription.created`
     * `customer.subscription.updated`
     * `customer.subscription.deleted`
     * `invoice.payment_succeeded`
     * `invoice.payment_failed`
4. Copy the signing secret → Set as `STRIPE_WEBHOOK_SECRET`

## Testing

### Test Cards

Use these test card numbers in test mode:

- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **Requires Auth**: `4000 0025 0000 3155`

Use any future expiry date and any CVC.

### Test Flow

1. Start your development server: `npm run dev`
2. Visit the application and click "Upgrade to Pro"
3. Use test card: `4242 4242 4242 4242`
4. Complete the payment flow
5. Check Stripe dashboard for the test payment

## API Endpoints

### Subscription Management

- `GET /api/subscription?userId={userId}` - Get subscription status
- `POST /api/subscription` - Create/upgrade subscription
- `PUT /api/subscription` - Update subscription
- `DELETE /api/subscription?userId={userId}` - Cancel subscription

### Billing

- `GET /api/billing?customerId={customerId}` - Get billing history
- `POST /api/billing` - Create billing portal session
- `GET /api/billing/invoices?invoiceId={invoiceId}` - Get invoice details
- `GET /api/billing/payment-methods?customerId={customerId}` - List payment methods
- `POST /api/billing/payment-methods` - Set default payment method
- `DELETE /api/billing/payment-methods?paymentMethodId={id}` - Remove payment method

### Payment Methods

- `GET /api/payment-methods?customerId={customerId}` - List methods
- `POST /api/payment-methods` - Add payment method
- `DELETE /api/payment-methods?paymentMethodId={id}` - Remove method

### Webhooks

- `POST /api/webhooks/stripe` - Receive Stripe webhook events

## Security Best Practices

### ✅ DO:

1. **Keep secret keys on the server only**
   - Use `STRIPE_SECRET_KEY` (without `NEXT_PUBLIC_` prefix)
   - Never send it to the client

2. **Validate webhook signatures**
   - Always verify webhook signatures
   - Use `STRIPE_WEBHOOK_SECRET`

3. **Use HTTPS in production**
   - Stripe requires HTTPS for webhooks
   - Use secure connections for all API calls

4. **Handle errors gracefully**
   - Show user-friendly error messages
   - Log errors server-side

### ❌ DON'T:

1. **Expose secret keys**
   - Never put secret keys in client-side code
   - Don't commit keys to version control

2. **Skip webhook verification**
   - Always verify webhook signatures
   - Don't process unverified events

3. **Store sensitive data**
   - Don't store full card numbers
   - Stripe handles PCI compliance

## Subscription Plans

### Free Plan
- Up to 3 projects
- Basic LaTeX editing
- PDF compilation
- GitHub integration
- 100 AI requests/month

### Pro Plan
- Unlimited projects
- Advanced LaTeX editing
- PDF compilation
- GitHub, Zotero, Mendeley integration
- Unlimited AI requests
- Priority support
- Collaborative editing
- Advanced analytics

**Pricing (no tax included):**
- Monthly: $25/month
- Yearly: $252/year ($21/month paid annually, save $48/year)

## Troubleshooting

### "Stripe is not initialized"
- Check that `STRIPE_SECRET_KEY` is set in your `.env` file
- Restart your development server after adding environment variables

### Webhook events not received
- Verify webhook URL is correct
- Check webhook signing secret matches
- Use Stripe CLI for local testing
- Check Stripe dashboard for webhook logs

### Payment method errors
- Ensure customer ID is correct
- Check payment method is attached to customer
- Verify payment method is valid

### Subscription not updating
- Check webhook is properly configured
- Verify webhook signature verification
- Check server logs for errors

## Additional Resources

- [Stripe Documentation](https://stripe.com/docs)
- [Stripe Testing Guide](https://stripe.com/docs/testing)
- [Stripe API Reference](https://stripe.com/docs/api)
- [Stripe Dashboard](https://dashboard.stripe.com)

## Support

For issues with Stripe integration:
1. Check this documentation
2. Review Stripe dashboard logs
3. Check server logs
4. Contact support

## Deployment Checklist

Before deploying to production:

- [ ] Set up Stripe production account
- [ ] Add production API keys to environment variables
- [ ] Configure production webhook endpoint
- [ ] Test payment flow with real cards
- [ ] Set up monitoring and logging
- [ ] Configure HTTPS
- [ ] Review error handling
- [ ] Set up backup payment processing
- [ ] Test subscription lifecycle events
- [ ] Configure email notifications

