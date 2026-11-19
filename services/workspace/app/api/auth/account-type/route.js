/**
 * GET: Returns whether the current user has a password (credential account).
 * Used by Settings to show password confirmation only for email/password users.
 */

import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { auth } from '@/lib/auth.js';
import { pool } from '@/lib/db.js';

export async function GET() {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session?.user?.id) {
      return NextResponse.json({ hasPassword: false }, { status: 200 });
    }
    const userId = session.user.id;
    // Better Auth account table: "account" with userId, providerId, password (camelCase or lowercase)
    const res = await pool.query(
      `SELECT 1 FROM account WHERE "userId" = $1 AND "providerId" = 'credential' AND password IS NOT NULL LIMIT 1`,
      [userId]
    ).catch(() =>
      pool.query(
        `SELECT 1 FROM account WHERE userid = $1 AND providerid = 'credential' AND password IS NOT NULL LIMIT 1`,
        [userId]
      )
    );
    const hasPassword = res?.rows?.length > 0;
    return NextResponse.json({ hasPassword: !!hasPassword });
  } catch (e) {
    console.error('account-type error:', e);
    return NextResponse.json({ hasPassword: false }, { status: 200 });
  }
}
