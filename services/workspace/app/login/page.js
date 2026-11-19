/**
 * GenLaTeX – Login: Google or email/password (email must be verified first).
 */

'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { EyeOpenIcon, EyeClosedIcon } from '@radix-ui/react-icons';
import { authClient } from '@/lib/auth-client.js';

function isSafeReturnUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const path = url.startsWith('/') ? url : new URL(url, 'http://localhost').pathname;
  return path.startsWith('/') && !path.startsWith('//');
}

function LoginContent() {
  const searchParams = useSearchParams();
  const returnUrlParam = searchParams.get('returnUrl');
  const returnUrl = returnUrlParam && isSafeReturnUrl(returnUrlParam) ? returnUrlParam : '/dashboard';

  const { data: session, isPending } = authClient.useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isPending && session?.user) {
      if (session.user.emailVerified !== true) {
        window.location.href = '/verify-email-required';
        return;
      }
      window.location.href = returnUrl;
    }
  }, [session, isPending, returnUrl]);

  async function signInWithGoogle() {
    await authClient.signIn.social({
      provider: 'google',
      callbackURL: returnUrl,
    });
  }

  async function onSubmitEmail(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { data, error: err } = await authClient.signIn.email({
      email: email.trim(),
      password,
      callbackURL: returnUrl,
    });
    setLoading(false);
    if (err) {
      if (err.status === 403) setError('Please verify your email first. Check your inbox for the verification link.');
      else setError(err.message || 'Invalid email or password');
      return;
    }
    if (data) window.location.href = returnUrl;
  }

  if (isPending) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden">
      <div className="flex-1 flex flex-col bg-background h-full">
        <div className="flex-1 flex items-center justify-center p-6 lg:p-8">
          <div className="w-full max-w-md">
            <Link href="/" className="flex items-center gap-2 mb-8">
              <img src="/logo_genlatex_full.svg" alt="GenLaTeX" className="h-9 w-auto" />
            </Link>

            <h1 className="text-2xl font-bold text-foreground mb-1">Welcome Back</h1>
            <p className="text-sm text-muted-foreground mb-6">
              Sign in with Google or your email and password.
            </p>

            <button
              type="button"
              onClick={signInWithGoogle}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 border border-border rounded-lg bg-background text-foreground text-sm font-medium hover:bg-muted mb-5 transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 18 18" className="shrink-0">
                <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 6.168-2.172l-2.908-2.258c-.806.54-1.837.86-3.26.86-2.513 0-4.646-1.697-5.42-4.072H.957v2.331C2.438 15.983 5.482 18 9 18z" />
                <path fill="#FBBC05" d="M3.58 10.718c-.18-.54-.28-1.117-.28-1.718 0-.602.1-1.178.28-1.718V4.752H.957C.347 6.113 0 7.55 0 9s.348 2.887.957 4.248l2.623-2.53z" />
                <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0 5.482 0 2.438 2.017.957 4.752L3.58 7.282C4.354 4.907 6.487 3.21 9 3.58z" />
              </svg>
              Continue with Google
            </button>

            <div className="relative mb-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-3 bg-background text-muted-foreground">Or with email</span>
              </div>
            </div>

            <form onSubmit={onSubmitEmail} className="space-y-4">
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
              <div>
                <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1">Password</label>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Your password"
                    required
                    className="w-full rounded-lg border border-border bg-input px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeClosedIcon width={16} height={16} /> : <EyeOpenIcon width={16} height={16} />}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Link href="/forgot-password" className="text-xs text-primary hover:underline">Forgot password?</Link>
              </div>
              {error && (
                <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-2">
                  {error}
                </div>
              )}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50"
              >
                {loading ? 'Signing in...' : 'Sign in with email'}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{' '}
              <Link href={returnUrl !== '/dashboard' ? `/register?returnUrl=${encodeURIComponent(returnUrl)}` : '/register'} className="text-primary hover:text-primary/80 font-medium underline">Sign up</Link>
            </p>
          </div>
        </div>

        <div className="px-6 lg:px-8 py-4 border-t border-border">
          <div className="max-w-md mx-auto flex items-center justify-between text-xs text-muted-foreground">
            <span>© 2026 GenLaTeX. All rights reserved.</span>
            <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          </div>
        </div>
      </div>

      <div className="hidden lg:block flex-1 p-4 bg-background h-full">
        <div className="h-full w-full rounded-2xl bg-primary overflow-hidden relative flex flex-col items-center justify-center">
          <div className="relative z-10 flex flex-col items-center text-center px-8 w-full max-w-4xl">
            <h2 className="text-3xl font-bold text-white mb-6">Write top notch research articles in minutes.</h2>
            <div className="w-full rounded-xl overflow-hidden flex items-center justify-center flex-1 min-h-0 bg-white/5">
              <img src="/auth-hero.png" alt="LaTeX editor with PDF preview" className="w-full max-w-4xl object-contain rounded-lg shadow-xl" aria-hidden />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
}
