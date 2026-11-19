/**
 * One-time migration: copy an existing user from app "users" table
 * into Better Auth "user" table so they can sign in again after the
 * NextAuth → Better Auth switch. Uses the SAME user id so projects
 * and billing stay linked.
 *
 * Run from genlatex/: node scripts/migrate-user-to-better-auth.js <email>
 * Example: node scripts/migrate-user-to-better-auth.js johantchassem@gmail.com
 *
 * After running: use "Forgot password" for that email to set a new
 * password (Better Auth uses scrypt, not bcrypt, so the old hash is not reused).
 */

import 'dotenv/config';
import { pool } from '@/lib/db.js';

const email = process.argv[2]?.trim();
if (!email) {
  console.error('Usage: node scripts/migrate-user-to-better-auth.js <email>');
  process.exit(1);
}

async function main() {
  const client = await pool.connect();
  try {
    // 1. Get existing user from app "users" table
    const userRow = await client.query(
      `SELECT id, name, email, image, email_verified, created_at
       FROM users WHERE email = $1`,
      [email]
    );
    if (userRow.rows.length === 0) {
      console.error(`No user found with email: ${email}`);
      process.exit(1);
    }
    const u = userRow.rows[0];
    const now = new Date();
    const createdAt = u.created_at ? new Date(u.created_at) : now;
    const emailVerified = !!u.email_verified;

    // 2. Check if Better Auth "user" table exists and get its column style
    const tableCheck = await client.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'user'
      ORDER BY ordinal_position
    `);
    if (tableCheck.rows.length === 0) {
      console.error('Better Auth "user" table not found. Run: npx @better-auth/cli@latest migrate');
      process.exit(1);
    }
    const columns = tableCheck.rows.map((r) => r.column_name);
    const useCamel = columns.some((c) => c === 'emailVerified' || c === 'createdAt');

    // 3. Insert into Better Auth "user" (same id so projects/billing stay linked)
    const emailVerifiedCol = useCamel ? 'emailVerified' : 'emailverified';
    const createdAtCol = useCamel ? 'createdAt' : 'createdat';
    const updatedAtCol = useCamel ? 'updatedAt' : 'updatedat';
    const quoted = (name) => (useCamel && name !== 'id' && name !== 'name' && name !== 'email' && name !== 'image' ? `"${name}"` : name);
    const cols = ['id', 'name', 'email', quoted(emailVerifiedCol), 'image', quoted(createdAtCol), quoted(updatedAtCol)].join(', ');

    await client.query(
      `INSERT INTO "user" (${cols})
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [u.id, u.name ?? null, u.email, emailVerified, u.image ?? null, createdAt, now]
    );

    console.log(`Migrated user ${email} (id: ${u.id}) into Better Auth "user" table.`);
    console.log('Next: go to the app, click "Forgot password?", enter this email, and set a new password. Then you can sign in with email + new password.');
  } catch (err) {
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
