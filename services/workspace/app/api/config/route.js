/**
 * Configuration API
 * Exposes safe environment variables to client-side
 */

import { NextResponse } from 'next/server';
import { getFeatureFlags } from '@/lib/feature-flags.js';

export async function GET() {
  try {
    const featureFlags = getFeatureFlags();
    // Only expose safe, non-sensitive configuration
    const config = {
      ai: {
        requestDelay: parseInt(process.env.AI_REQUEST_DELAY) || 1000,
        maxRetries: parseInt(process.env.AI_MAX_RETRIES) || 3,
        timeout: parseInt(process.env.AI_TIMEOUT) || 30000,
        temperature: parseFloat(process.env.AI_TEMPERATURE) || 0.7,
        maxTokens: parseInt(process.env.AI_MAX_TOKENS) || 2000
      },
      features: {
        aiEnabled: !!process.env.OPENROUTER_API_KEY,
        autoSave: true,
        realTimeAnalysis: true,
        ...featureFlags
      }
    };

    return NextResponse.json(config);
  } catch (error) {
    console.error('Config API error:', error);
    return NextResponse.json(
      { error: 'Failed to load configuration' },
      { status: 500 }
    );
  }
}
