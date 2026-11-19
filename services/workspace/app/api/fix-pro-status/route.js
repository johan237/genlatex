/**
 * Manually fix Pro status - INTERNAL DEBUG ENDPOINT
 * Use this to manually set a user to Pro if webhook failed
 * 
 * PROTECTED: Requires INTERNAL_API_KEY header or query param
 * Usage: curl -X POST -H "X-Internal-Api-Key: your-key" https://app.example.com/api/fix-pro-status?user_id=xxx
 */

import { NextResponse } from 'next/server';
import { requireInternalApiKey } from '@/lib/internal-api-auth.js';
import { updateUserSubscription } from '@/lib/user-subscription.js';

export async function POST(request) {
  // Require internal API key
  const authError = await requireInternalApiKey(request);
  if (authError) return authError;

  try {
    // Get user ID from query param (admin specifies which user to fix)
    const url = new URL(request.url);
    const userId = url.searchParams.get('user_id');
    
    if (!userId) {
      return NextResponse.json({ 
        success: false, 
        error: 'user_id query parameter required' 
      }, { status: 400 });
    }
    
    // Manually set user to Pro
    await updateUserSubscription(userId, {
      isPro: true,
      status: 'active',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year
      stripeCustomerId: 'manual-fix',
      stripeSubscriptionId: 'manual-fix'
    });
    
    return NextResponse.json({
      success: true,
      message: `User ${userId} is now Pro`
    });
  } catch (error) {
    console.error('[fix-pro-status] Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

export async function GET(request) {
  // Also protect GET to prevent info disclosure
  const authError = await requireInternalApiKey(request);
  if (authError) return authError;

  return NextResponse.json({
    message: 'POST to this endpoint to manually set a user to Pro',
    usage: 'curl -X POST -H "X-Internal-Api-Key: your-key" "https://app.example.com/api/fix-pro-status?user_id=USER_UUID"'
  });
}

