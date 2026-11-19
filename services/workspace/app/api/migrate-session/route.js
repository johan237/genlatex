/**
 * Session Migration API - INTERNAL DEBUG ENDPOINT
 * With Better Auth, sessions are managed by the auth provider. This endpoint is kept for compatibility.
 * 
 * PROTECTED: Requires INTERNAL_API_KEY header or query param
 */

import { NextResponse } from 'next/server';
import { requireInternalApiKey } from '@/lib/internal-api-auth.js';
import { getSessionFromRequest } from '@/lib/project-auth.js';

export async function POST(request) {
  // Require internal API key
  const authError = await requireInternalApiKey(request);
  if (authError) return authError;

  try {
    const session = await getSessionFromRequest();
    if (!session?.id) {
      return NextResponse.json({ 
        success: false, 
        error: 'No session found' 
      }, { status: 400 });
    }
    return NextResponse.json({
      success: true,
      migrated: false,
      user: session
    });
  } catch (error) {
    console.error('[migrate-session] Error:', error);
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
    message: 'POST to this endpoint to migrate your session',
    usage: 'curl -X POST -H "X-Internal-Api-Key: your-key" https://app.example.com/api/migrate-session'
  });
}

