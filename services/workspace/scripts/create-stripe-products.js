/**
 * Create Stripe Pro product and prices for GenLaTeX
 * Run from genlatex/: node scripts/create-stripe-products.js
 *
 * Creates:
 * - Product: GenLaTeX Pro
 * - Price: $25/month (no tax)
 * - Price: $21/month paid annually ($252/year, no tax)
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import Stripe from 'stripe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(__dirname, '..', '.env');
dotenv.config({ path: envPath });

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY || STRIPE_SECRET_KEY.includes('your_') || STRIPE_SECRET_KEY.includes('placeholder')) {
  console.error('Set STRIPE_SECRET_KEY in genlatex/.env (get it from https://dashboard.stripe.com/apikeys)');
  process.exit(1);
}

const stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2024-12-18.acacia' });

async function main() {
  console.log('Creating GenLaTeX Pro product and prices...\n');

  // 1. Create product
  const product = await stripe.products.create({
    name: 'GenLaTeX Pro',
    description: 'Pro subscription — unlimited projects, unlimited AI chat, priority support. No tax included.',
  });
  console.log('Product created:', product.id, product.name);

  // 2. Monthly price: $25/month (2500 cents)
  const priceMonthly = await stripe.prices.create({
    product: product.id,
    unit_amount: 2500, // $25.00 USD
    currency: 'usd',
    recurring: { interval: 'month' },
    metadata: { plan: 'pro', interval: 'month' },
  });
  console.log('Monthly price created:', priceMonthly.id, '$25/month');

  // 3. Yearly price: $21/month paid annually = $252/year (25200 cents)
  const priceYearly = await stripe.prices.create({
    product: product.id,
    unit_amount: 25200, // $252.00 USD per year
    currency: 'usd',
    recurring: { interval: 'year' },
    metadata: { plan: 'pro', interval: 'year', equivalent_per_month: '21' },
  });
  console.log('Yearly price created:', priceYearly.id, '$252/year ($21/month)');

  console.log('\n--- Add these to genlatex/.env ---\n');
  console.log(`STRIPE_PRO_PRODUCT_ID=${product.id}`);
  console.log(`STRIPE_PRO_MONTHLY_PRICE_ID=${priceMonthly.id}`);
  console.log(`STRIPE_PRO_YEARLY_PRICE_ID=${priceYearly.id}`);
  console.log('\n--- End ---\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
