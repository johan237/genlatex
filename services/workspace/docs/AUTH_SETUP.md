# Auth setup (Better Auth)

This document describes what you need to do after the auth implementation: migrations, environment variables, and optional steps.

## 1. Run Better Auth database migration

Better Auth creates its own tables (`user`, `session`, `account`, `verification`). Run the CLI from the **genlatex** directory:

```bash
cd genlatex
npx @better-auth/cli@latest migrate
```

- Use the same database as your app (`DATABASE_URL`).
- If the CLI asks for a config path, point it to your app config that exports `auth` (e.g. `lib/auth.js`), or follow the CLI’s instructions for your setup.

## 2. Environment variables

Add or update these in **genlatex/.env** (see **genlatex/.env.example** for a template).

### Required for auth

| Variable | Description |
|----------|-------------|
| `BETTER_AUTH_SECRET` | Secret for signing/encryption (min 32 chars). Generate: `openssl rand -base64 32` |
| `BETTER_AUTH_URL` | App base URL (e.g. `http://localhost:3000` in dev, `https://your-domain.com` in prod) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID (from [Google Cloud Console](https://console.cloud.google.com/apis/credentials)) |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |

### Required for email verification and password reset (production)

| Variable | Description |
|----------|-------------|
| `RESEND_API_KEY` | [Resend](https://resend.com) API key for sending verification and reset emails |
| `EMAIL_FROM` | Sender address (e.g. `GenLaTeX <onboarding@resend.dev>` or your verified domain) |

- **Development:** If `RESEND_API_KEY` is not set, verification and reset links are **logged to the server console** only (no email sent). Set `RESEND_API_KEY` for real emails in dev.
- **Production:** Set `RESEND_API_KEY` and `EMAIL_FROM` so users receive verification and password-reset emails.

### Google OAuth redirect URI

In Google Cloud Console → APIs & Services → Credentials → your OAuth 2.0 Client ID:

- **Authorized redirect URIs:** add  
  `http://localhost:3000/api/auth/callback/google` (dev)  
  and `https://your-domain.com/api/auth/callback/google` (prod).

## 3. App database migrations (existing)

Your app’s own migrations (e.g. `npm run migrate` or `psql $DATABASE_URL < lib/db-migrations/...`) should already have been run. They ensure:

- `users.password_hash` is nullable (for OAuth-only users).
- Tables like `projects`, `research_files`, `project_shares`, `user_zotero`, `file_usage_log`, etc., exist.

No extra app migration is required for the new auth behavior beyond what’s already in place.

## 4. NextAuth removed

NextAuth is no longer used; the app uses Better Auth only. No action needed.

## 5. Migrating an existing user (NextAuth → Better Auth)

If you had users in the app **before** switching to Better Auth, they exist in the `users` table but **not** in Better Auth’s `user` table, so email/password sign-in returns “User not found”.

To let one existing user sign in again:

1. Run the Better Auth migration (section 1) so the `user` table exists.
2. From the **genlatex** directory, run:
   ```bash
   node scripts/migrate-user-to-better-auth.js <email>
   ```
   Example: `node scripts/migrate-user-to-better-auth.js johantchassem@gmail.com`
3. The script copies that user into Better Auth’s `user` table with the **same id**, so projects and billing stay linked.
4. Better Auth uses **scrypt** for passwords (not bcrypt), so the old password hash is not reused. Have the user go to the app → **Forgot password?** → enter their email → set a new password. After that they can sign in with email + new password.

Repeat step 2 for each existing user you want to migrate.

## Summary of auth flows

- **Delete account:** User deletes account from settings → all their data is removed (project files on disk, DB rows: projects, research_files, file_usage_log, project_shares, user_zotero, zotero_oauth_pending, users) and then Better Auth deletes the auth user/sessions/accounts.
- **Email + password sign-up:** User signs up with email/password → **not** logged in immediately → verification email is sent → user clicks link → email is verified, user is signed in and redirected to the callback URL (e.g. `/register?plan=pro` or `/dashboard`). From `/register?plan=pro` the app redirects to checkout; from `/register?share=...` it accepts the share and redirects to the editor.
- **Google sign-up/sign-in:** One-click; no email verification step (handled by Google).
- **Login (email):** If email is not verified, sign-in returns an error and the UI shows “Please verify your email first.”
