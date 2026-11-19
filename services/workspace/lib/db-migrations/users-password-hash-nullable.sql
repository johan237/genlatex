-- Allow users.password_hash to be NULL for OAuth-only users (Google) and Better Auth
-- (Better Auth stores password in account table; app users table is for projects/billing only)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
