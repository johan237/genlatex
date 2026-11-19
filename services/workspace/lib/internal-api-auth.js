/**
 * Internal API Authentication
 * Protects debug/admin endpoints with a secret API key from .env
 * 
 * Usage in API routes:
 *   import { requireInternalApiKey } from '@/lib/internal-api-auth.js';
 *   
 *   export async function POST(request) {
 *     const authError = await requireInternalApiKey(request);
 *     if (authError) return authError;
 *     // ... rest of handler
 *   }
 * 
 * Call with header: X-Internal-Api-Key: your-secret-key
 * Or query param: ?internal_api_key=your-secret-key
 */

import { NextResponse } from 'next/server';

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;

/**
 * Validates the internal API key from request headers or query params.
 * Returns null if valid, or a NextResponse with 401/403 if invalid.
 * 
 * @param {Request} request - The incoming request
 * @returns {Promise<NextResponse|null>} - null if authorized, NextResponse error otherwise
 */
export async function requireInternalApiKey(request) {
  // In development without a key set, allow access (for local testing)
  if (process.env.NODE_ENV === 'development' && !INTERNAL_API_KEY) {
    console.warn('[internal-api-auth] No INTERNAL_API_KEY set - allowing access in development');
    return null;
  }

  // In production, INTERNAL_API_KEY must be set
  if (!INTERNAL_API_KEY) {
    console.error('[internal-api-auth] INTERNAL_API_KEY not configured - denying access');
    return NextResponse.json(
      { error: 'Internal endpoint not configured' },
      { status: 503 }
    );
  }

  // Check header first
  const headerKey = request.headers.get('X-Internal-Api-Key');
  if (headerKey === INTERNAL_API_KEY) {
    return null; // Authorized
  }

  // Check query param as fallback
  const url = new URL(request.url);
  const queryKey = url.searchParams.get('internal_api_key');
  if (queryKey === INTERNAL_API_KEY) {
    return null; // Authorized
  }

  // No valid key provided
  return NextResponse.json(
    { error: 'Unauthorized - valid internal API key required' },
    { status: 401 }
  );
}

/**
 * Check if the request has a valid internal API key (boolean version).
 * Use this when you want to check without returning a response.
 * 
 * @param {Request} request - The incoming request
 * @returns {boolean} - true if authorized
 */
export function hasInternalApiKey(request) {
  if (!INTERNAL_API_KEY) {
    return process.env.NODE_ENV === 'development';
  }

  const headerKey = request.headers.get('X-Internal-Api-Key');
  if (headerKey === INTERNAL_API_KEY) return true;

  const url = new URL(request.url);
  const queryKey = url.searchParams.get('internal_api_key');
  if (queryKey === INTERNAL_API_KEY) return true;

  return false;
}
