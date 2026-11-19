// SPDX-License-Identifier: MIT

import { NextResponse } from 'next/server';
import { pool, runMigrations } from '@/lib/db.js';
import bcrypt from 'bcryptjs';
import { strictRateLimit } from '@/lib/rate-limit-server.js';

export async function POST(request) {
  // Apply strict rate limiting to registration (5 requests per minute)
  const rateLimitResponse = strictRateLimit(request);
  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  try {
    await runMigrations();
    const body = await request.json();
    const name = body.name || null;
    const email = body.email;
    const password = body.password;
    
    // Input validation
    if (!email || !password) {
      return NextResponse.json({ error: 'Missing email or password' }, { status: 400 });
    }
    
    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: 'Invalid email format' }, { status: 400 });
    }
    
    // Password strength validation
    if (password.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }
    
    const hash = await bcrypt.hash(password, 10);

    // Insert user and get back the user id
    const result = await pool.query(
      `INSERT INTO users(name, email, password_hash)
       VALUES($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET name = COALESCE(EXCLUDED.name, users.name)
       RETURNING id`,
      [name, email, hash]
    );

    const userId = result.rows[0]?.id;

    // Start 30-day paper credits period at registration (anchor = signup; resets every 30 days from signup)
    if (userId) {
      await pool.query(
        `UPDATE users SET paper_credits_reset_at = created_at, paper_credits_used = 0 WHERE id = $1`,
        [userId]
      );
    }

    // Link any pending project shares that were shared with this email
    if (userId) {
      const updateResult = await pool.query(
        `UPDATE project_shares
         SET shared_with_user_id = $1
         WHERE shared_with_email = $2 AND shared_with_user_id IS NULL`,
        [userId, email.toLowerCase()]
      );
      if (updateResult.rowCount > 0) {
        console.log(`📧 Linked ${updateResult.rowCount} pending project share(s) to new user: ${email}`);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('Registration error:', e);
    return new NextResponse(`Registration error: ${e.message}`, { status: 500 });
  }
}
