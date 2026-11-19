/**
 * GenLaTeX – Forgot password: request reset link (Better Auth).
 */

'use client';

import { useState } from 'react';
import Link from 'next/link';
import { authClient } from '@/lib/auth-client.js';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function onSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    const redirectTo = `${base}/reset-password`;
    const { error: err } = await authClient.requestPasswordReset({
      email: email.trim(),
      redirectTo,
    });
    setLoading(false);
    if (err) {
      setError(err.message || 'Failed to send reset email');
      return;
    }
    setSent(true);
  }

  if (sent) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center">
          <Link href="/login" className="inline-flex items-center gap-2 mb-8">
            <img src="/logo_genlatex_full.svg" alt="GenLaTeX" className="h-10 w-auto" />
          </Link>
          <h1 className="text-2xl font-bold text-foreground mb-2">Check your email</h1>
          <p className="text-muted-foreground mb-6">
            If an account exists for <strong>{email}</strong>, we sent a password reset link.
          </p>
          <Link href="/login" className="text-primary hover:underline font-medium">Back to sign in</Link>
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
        <h1 className="text-2xl font-bold text-foreground mb-2">Forgot password</h1>
        <p className="text-muted-foreground mb-6">Enter your email and we&apos;ll send a reset link.</p>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1">Email</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
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
            {loading ? 'Sending...' : 'Send reset link'}
          </button>
        </form>
        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link href="/login" className="text-primary hover:underline">Back to sign in</Link>
        </p>
      </div>
    </div>
  );
}
