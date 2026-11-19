/**
 * Rate Limit Status API
 * Returns current usage statistics
 */

import { NextResponse } from 'next/server';
import { rateLimiter } from '@/lib/rate-limiter.js';

export async function GET() {
  try {
    const stats = rateLimiter.getUsageStats();
    const timeUntilReset = rateLimiter.getFormattedTimeUntilReset();
    
    return NextResponse.json({
      success: true,
      stats: {
        ...stats,
        timeUntilReset,
        resetTime: new Date(Date.now() + rateLimiter.getTimeUntilReset()).toISOString()
      }
    });
  } catch (error) {
    console.error('Rate limit API error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req) {
  try {
    const { action } = await req.json();
    
    if (action === 'reset') {
      // Only allow reset in development mode
      if (process.env.NODE_ENV !== 'development') {
        return NextResponse.json(
          { success: false, error: 'Reset only allowed in development mode' },
          { status: 403 }
        );
      }
      
      rateLimiter.reset();
      return NextResponse.json({ success: true, message: 'Rate limit stats reset' });
    }
    
    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Rate limit reset error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
