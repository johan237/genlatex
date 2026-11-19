/**
 * GenLaTeX – Reset password (Better Auth). User lands here from email link with ?token=...
 */

'use client';

import { Suspense, useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client.js';

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const errorParam = searchParams.get('error');

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(errorParam === 'INVALID_TOKEN' ? 'This reset link is invalid or expired.' : '');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (errorParam === 'INVALID_TOKEN') setError('This reset link is invalid or expired.');
  }, [errorParam]);

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }
    if (!token) {
      setError('Missing reset token');
      return;
    }
    setLoading(true);
    const { error: err } = await authClient.resetPassword({
      newPassword: password,
      token,
    });
    setLoading(false);
    if (err) {
      setError(err.message || 'Failed to reset password');
      return;
    }
    setSuccess(true);
  }

  if (success) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <Link href="/login" className="inline-flex items-center gap-2 mb-8">
            <img src="/logo_genlatex_full.svg" alt="GenLaTeX" className="h-10 w-auto" />
          </Link>
          <h1 className="text-2xl font-bold text-foreground mb-2">Password reset</h1>
          <p className="text-muted-foreground mb-6">Your password has been updated. You can now sign in.</p>
          <Link href="/login" className="inline-block py-2.5 px-4 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90">
            Sign in
          </Link>
        </div>
      </div>
    );
  }

  if (!token && !errorParam) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <Link href="/login" className="inline-flex items-center gap-2 mb-8">
            <img src="/logo_genlatex_full.svg" alt="GenLaTeX" className="h-10 w-auto" />
          </Link>
          <h1 className="text-2xl font-bold text-foreground mb-2">Invalid link</h1>
          <p className="text-muted-foreground mb-6">This reset link is missing the token. Request a new one from the forgot password page.</p>
          <Link href="/forgot-password" className="text-primary hover:underline font-medium">Forgot password</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        <Link href="/login" className="inline-flex items-center gap-2 mb-8">
          <img src="/logo_genlatex_full.svg" alt="GenLaTeX" className="h-10 w-auto" />
        </Link>
        <h1 className="text-2xl font-bold text-foreground mb-2">Set new password</h1>
        <p className="text-muted-foreground mb-6">Enter your new password below.</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">New password</label>
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              required
              minLength={8}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div>
            <label htmlFor="confirm" className="block text-sm font-medium text-foreground mb-1">Confirm password</label>
            <input
              id="confirm"
              type={showPassword ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              required
              minLength={8}
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} className="rounded border-border text-primary" />
            <span className="text-sm text-muted-foreground">Show password</span>
          </label>
          {error && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-2">
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 px-4 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          >
            {loading ? 'Resetting...' : 'Reset password'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <ResetPasswordContent />
    </Suspense>
  );
}
