#!/usr/bin/env node
/**
 * Production Migrations – GenLaTeX
 * Orchestrates all setup steps for production deployment.
 *
 * Usage (from genlatex/):
 *   node scripts/production-migrations.js
 *   NODE_ENV=production node scripts/production-migrations.js
 *
 * Prerequisites:
 *   - Copy .env.production to .env and fill in real values, OR
 *   - Set env vars before running
 *
 * Steps run:
 *   1. Database migrations (run-migrations.js)
 *   2. Better Auth schema (npx @better-auth/cli migrate)
 *   3. Stripe products (create-stripe-products.js) – uses STRIPE_SECRET_KEY from env
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { existsSync } from 'fs';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

// Load env: prefer .env.production (this script is for production), else .env
const envProduction = join(rootDir, '.env.production');
const envDefault = join(rootDir, '.env');
if (existsSync(envProduction)) {
  dotenv.config({ path: envProduction });
  if (existsSync(envDefault)) dotenv.config({ path: envDefault, override: true });
  console.log('📋 Loaded .env.production (and .env overrides if present)');
} else if (existsSync(envDefault)) {
  dotenv.config({ path: envDefault });
  console.log('📋 Loaded .env');
} else {
  console.warn('⚠️  No .env or .env.production found. Using existing env vars.');
}

function run(cmd, args, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, {
      stdio: 'inherit',
      cwd: rootDir,
      shell: true,
      ...opts,
    });
    child.on('close', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('🚀 GenLaTeX Production Migrations');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Add it to .env or .env.production');
    process.exit(1);
  }

  // 1. Database migrations
  console.log('📦 Step 1/3: Database migrations...');
  await run('node', ['run-migrations.js']);
  console.log('');

  // 2. Better Auth schema
  console.log('📦 Step 2/3: Better Auth schema...');
  try {
    await run('npx', ['@better-auth/cli@latest', 'migrate']);
  } catch (e) {
    console.warn('⚠️  Better Auth migrate failed (may already be up to date):', e.message);
  }
  console.log('');

  // 3. Stripe products (production = live mode if STRIPE_SECRET_KEY starts with sk_live_)
  console.log('📦 Step 3/3: Stripe products...');
  const stripeKey = process.env.STRIPE_SECRET_KEY || '';
  if (!stripeKey || stripeKey.includes('your_') || stripeKey.includes('placeholder')) {
    console.warn('⚠️  STRIPE_SECRET_KEY not set or placeholder. Skipping Stripe product creation.');
    console.warn('   Run manually when ready: node scripts/create-stripe-products.js');
  } else if (stripeKey.startsWith('sk_live_')) {
    console.log('   Using LIVE Stripe key – creating production products...');
    await run('node', ['scripts/create-stripe-products.js']);
  } else {
    console.log('   Using TEST Stripe key – creating test products...');
    await run('node', ['scripts/create-stripe-products.js']);
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✅ Production migrations complete!');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch((err) => {
  console.error('\n❌ Migration failed:', err.message);
  process.exit(1);
});
