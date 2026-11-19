/**
 * Session – returns current user from Better Auth (same shape as before).
 */

import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth.js';

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user) {
      return NextResponse.json({ user: null });
    }
    return NextResponse.json({
      user: {
        id: session.user.id,
        email: session.user.email ?? null,
        name: session.user.name ?? null,
      },
    });
  } catch (error) {
    console.error('Session API error:', error);
    return NextResponse.json({ user: null });
  }
}
