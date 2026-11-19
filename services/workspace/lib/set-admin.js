/**
 * Set a user as admin (is_admin = true).
 * Only the email in ADMIN_EMAIL is allowed - change this constant to set a different admin.
 * Admin users get unlimited paper generations, chat, projects, and AI tokens.
 *
 * Run: npm run set-admin (from genlatex/ directory)
 * Loads DATABASE_URL from genlatex/.env - ensure it is set.
 */

import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

if (!process.env.DATABASE_URL) {
  console.error('❌ DATABASE_URL is not set. Add it to genlatex/.env');
  process.exit(1);
}

const { pool } = await import('./db.js');

// Only this email can be set as admin. Modify this to use a different admin email.
const ADMIN_EMAIL = 'tchassemchris@gmail.com';

export async function setUserAsAdmin(email) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error('Email is required');
  }
  if (normalizedEmail !== ADMIN_EMAIL.toLowerCase()) {
    throw new Error(`Only ${ADMIN_EMAIL} can be set as admin. Update ADMIN_EMAIL in lib/set-admin.js to use a different email.`);
  }

  // Ensure is_admin column exists
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE;
  `);

  const result = await pool.query(
    `UPDATE users SET is_admin = true WHERE LOWER(TRIM(email)) = $1 RETURNING id, email, is_admin`,
    [normalizedEmail]
  );

  if (result.rowCount === 0) {
    throw new Error(`No user found with email: ${email}`);
  }

  return result.rows[0];
}

async function main() {
  try {
    const user = await setUserAsAdmin(ADMIN_EMAIL);
    console.log(`✅ Admin set successfully: ${user.email} (id: ${user.id})`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run when executed directly
if (process.argv[1]?.endsWith('set-admin.js')) {
  main();
}
