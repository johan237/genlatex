/**
 * Better Auth – Google + email/password with verification.
 * Syncs Better Auth user to existing users table for projects/stripe.
 */

import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { createAuthMiddleware, APIError } from 'better-auth/api';
import { pool } from './db.js';
import { deleteAllUserData } from './delete-user-data.js';

const baseURL =
  process.env.BETTER_AUTH_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
  (process.env.NEXT_PUBLIC_BASE_URL) ||
  (process.env.NEXT_PUBLIC_APP_URL) ||
  'http://localhost:3000';

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL,
  trustedOrigins: [
    "https://app.genlatex.com",
    "https://genlatex.com",
    "https://www.genlatex.com",
    process.env.NODE_ENV === "development" && "http://localhost:3000",
  ].filter(Boolean),
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      if (ctx.path !== '/sign-up/email') return;
      const email = ctx.body?.email;
      if (!email || typeof email !== 'string') return;
      const result = await pool.query(
        'SELECT id FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1)) AND email_verified IS NOT NULL',
        [email]
      );
      if (result.rows.length > 0) {
        throw new APIError('BAD_REQUEST', {
          message: 'An account with this email already exists. Please sign in instead.',
        });
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          const { pool: db } = await import('./db.js');
          // users.email_verified is TIMESTAMPTZ; Better Auth gives boolean emailVerified
          const emailVerifiedTs = user.emailVerified ? new Date() : null;
          await db.query(
            `INSERT INTO users (id, name, email, image, email_verified, created_at, password_hash)
             VALUES ($1, $2, $3, $4, $5, NOW(), NULL)
             ON CONFLICT (email) DO UPDATE SET
               name = COALESCE(EXCLUDED.name, users.name),
               image = COALESCE(EXCLUDED.image, users.image),
               email_verified = COALESCE(EXCLUDED.email_verified, users.email_verified)`,
            [
              user.id,
              user.name ?? null,
              user.email,
              user.image ?? null,
              emailVerifiedTs,
            ]
          );
          
          // Send welcome email for OAuth signups (Google) where email is already verified
          if (user.emailVerified) {
            try {
              const { sendWelcomeEmail } = await import('./email.js');
              await sendWelcomeEmail({ user });
            } catch (error) {
              console.error('[auth] Failed to send welcome email:', error);
              // Don't fail user creation if welcome email fails
            }
          }
        },
      },
    },
  },
  user: {
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        await deleteAllUserData(user.id);
      },
    },
  },
  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    sendResetPassword: async ({ user, url }) => {
      const { sendResetPassword: sendReset } = await import('./email.js');
      await sendReset({ user, url });
    },
    // Mark email as verified when user completes reset (they proved access to the inbox).
    onPasswordReset: async ({ user }) => {
      const { pool: db } = await import('./db.js');
      // Update Better Auth's "user" table (column casing may vary by version)
      try {
        await db.query('UPDATE "user" SET "emailVerified" = true WHERE id = $1', [user.id]);
      } catch (e) {
        // Better Auth may use lowercase column name in some versions
        if (/column.*emailVerified.*does not exist/i.test(e.message)) {
          try {
            await db.query('UPDATE "user" SET emailverified = true WHERE id = $1', [user.id]);
          } catch (innerErr) {
            console.warn('[auth] Could not update Better Auth user.emailVerified:', innerErr.message);
          }
        } else {
          console.warn('[auth] Could not update Better Auth user table:', e.message);
        }
      }
      // Update application users table
      await db.query(
        'UPDATE users SET email_verified = COALESCE(email_verified, NOW()) WHERE id = $1',
        [user.id]
      );
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    sendVerificationEmail: async ({ user, url }) => {
      const { sendVerificationEmail: sendEmail } = await import('./email.js');
      await sendEmail({ to: user.email, url, user });
    },
    afterEmailVerification: async (user) => {
      const { pool: db } = await import('./db.js');
      await db.query(
        'UPDATE users SET email_verified = NOW() WHERE id = $1',
        [user.id]
      );
      
      // Send welcome email after email verification
      try {
        const { sendWelcomeEmail } = await import('./email.js');
        await sendWelcomeEmail({ user });
      } catch (error) {
        console.error('[auth] Failed to send welcome email:', error);
        // Don't fail verification if welcome email fails
      }
    },
  },
  session: {
    // Allow delete without password for OAuth-only (e.g. Google) users; 0 = skip "session must be fresh" check
    freshAge: 0,
  },
  advanced: {
    database: {
      generateId: 'uuid',
    },
  },
  plugins: [nextCookies()],
});
