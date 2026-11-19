# Fix "Errors When Signing In from Another Device with Old Sign In"

When a user (or you) signs in from a device that still has an **old session** (e.g. from before switching to Better Auth, or an expired/stale session), the app can return errors (401 Unauthorized, redirect loops, or "Invalid session"). Do the following.

---

## 1. On the server (you / admin)

### 1.1 Run Better Auth migration (if not done)

Better Auth uses its own tables (`user`, `session`, `account`, `verification`). From the **genlatex** directory:

```bash
cd genlatex
npx @better-auth/cli@latest migrate
```

Use the same `DATABASE_URL` as your app. If the CLI asks for a config path, point it to `lib/auth.js` (or follow the CLI instructions).

### 1.2 Check environment variables

In **genlatex/.env**:

- **`BETTER_AUTH_URL`** must match the URL used by **all** devices (e.g. `http://localhost:3000` in dev, or `https://your-domain.com` in prod). If one device uses `http://` and another `https://`, or a different host/port, cookies won’t match and you get "old sign in" errors.
- **`BETTER_AUTH_SECRET`** must be at least 32 characters and must **not** change between restarts; changing it invalidates all existing sessions.
- **`DATABASE_URL`** must be correct so the app and Better Auth can read/write the same DB.

### 1.3 If you migrated from NextAuth (or another auth) to Better Auth

Existing app users may exist only in the `users` table, not in Better Auth’s `user` table. For each such user who needs to sign in again:

1. From **genlatex** directory:
   ```bash
   node scripts/migrate-user-to-better-auth.js <user-email>
   ```
   Example: `node scripts/migrate-user-to-better-auth.js user@example.com`

2. Tell the user: **"Use Forgot password to set a new password, then sign in with email + new password."** (Better Auth uses a different password hash; the old one is not reused.)

---

## 2. On the device with the old sign-in (user or you)

### 2.1 Clear old session / cookies

The device still has an old or invalid session cookie. Clear it:

- **Chrome / Edge:**  
  - Open the app (e.g. `http://localhost:3000` or your domain).  
  - Address bar → lock/info icon → **Cookies** → remove all for this site, **or**  
  - DevTools (F12) → Application → Storage → **Clear site data** for this origin.

- **Firefox:**  
  - Lock icon next to URL → **Clear Cookies and Site Data** for this site.

- **Safari:**  
  - Develop → Empty Caches; Safari → Settings → Privacy → Manage Website Data → remove your app’s site.

After clearing, close the tab (or the browser) and open the app again in a new tab.

### 2.2 Sign in again

1. Open the app (e.g. `/login` or `/` and go to sign in).
2. Sign in with **Google** or **email + password**.
3. If you see **"Please verify your email first"**:  
   - Use the verification link from the sign-up email, or  
   - Use **Forgot password** and set a new password (that also verifies access to the inbox).

### 2.3 If you use email/password and it says "User not found" or "Invalid credentials"

- You may not be in Better Auth’s `user` table yet. Ask the admin to run:
  ```bash
  node scripts/migrate-user-to-better-auth.js <your-email>
  ```
- Then use **Forgot password** on the app to set a new password and sign in.

### 2.4 Optional: Sign out from the app first

If you can still open the app (e.g. dashboard):

1. Open **Settings** (or account menu).
2. Use **Sign out** (or **Log out**).
3. Then clear cookies for the site (step 2.1) and sign in again (step 2.2).

---

## 3. Quick checklist (summary)

| Who        | What to do |
|-----------|------------|
| **Server** | Run `npx @better-auth/cli@latest migrate` from `genlatex/` (once). |
| **Server** | Set `BETTER_AUTH_URL` to the same URL all devices use; keep `BETTER_AUTH_SECRET` and `DATABASE_URL` correct. |
| **Server** | If you moved from NextAuth: run `node scripts/migrate-user-to-better-auth.js <email>` for each user who must sign in again. |
| **Old device** | Clear cookies (or site data) for the app’s URL. |
| **Old device** | Sign in again on `/login` (Google or email/password). |
| **Old device** | If email/password: use **Forgot password** after migration, then sign in with the new password. |

After these steps, "errors when signing in from another device with old sign in" should be resolved. If errors persist, check server logs and that `BETTER_AUTH_URL` and cookie domain/path match for all devices.
