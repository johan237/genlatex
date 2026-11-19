/**
 * GenLaTeX – Register: Google or email/password (verify email first, then redirect).
 */

'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { EyeOpenIcon, EyeClosedIcon } from '@radix-ui/react-icons';
import { authClient } from '@/lib/auth-client.js';

function isSafeReturnUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const path = url.startsWith('/') ? url : new URL(url, 'http://localhost').pathname;
  return path.startsWith('/') && !path.startsWith('//');
}

function RegisterContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const shareToken = searchParams.get('share');
  const plan = searchParams.get('plan');
  const returnUrlParam = searchParams.get('returnUrl');
  const returnUrl = returnUrlParam && isSafeReturnUrl(returnUrlParam) ? returnUrlParam : null;

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    if (!isPending && session?.user) {
      if (shareToken) {
        fetch(`/api/shares/${shareToken}/accept`, { method: 'POST', credentials: 'include' })
          .then((res) => res.json())
          .then((data) => {
            if (data.success) router.push(`/editor/${data.projectId}`);
            else router.push('/dashboard');
          })
          .catch(() => router.push('/dashboard'));
      } else if (plan === 'pro') {
        fetch('/api/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            userId: session.user.id,
            email: session.user.email,
            billingInterval: 'monthly',
          }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.success && data.url) window.location.href = data.url;
            else router.push(returnUrl || '/dashboard');
          })
          .catch(() => router.push('/dashboard'));
      } else {
        router.push(returnUrl || '/dashboard');
      }
    }
  }, [session, isPending, shareToken, plan, returnUrl, router]);

  function buildCallbackURL() {
    const base = typeof window !== 'undefined' ? window.location.origin : '';
    const q = [];
    if (shareToken) q.push(`share=${shareToken}`);
    if (plan) q.push(`plan=${plan}`);
    return `${base}/register${q.length ? '?' + q.join('&') : ''}`;
  }

  async function signUpWithGoogle() {
    const q = [];
    if (shareToken) q.push(`share=${shareToken}`);
    if (plan) q.push(`plan=${plan}`);
    if (returnUrl) q.push(`returnUrl=${encodeURIComponent(returnUrl)}`);
    const callbackURL = q.length ? `/register?${q.join('&')}` : '/register';
    await authClient.signIn.social({
      provider: 'google',
      callbackURL: shareToken || plan || returnUrl ? callbackURL : '/dashboard',
    });
  }

  async function onSubmitEmail(e) {
    e.preventDefault();
    setMessage('');
    if (password !== confirmPassword) {
      setMessage('Passwords do not match');
      return;
    }
    setLoading(true);
    const callbackURL = buildCallbackURL();
    const { data, error } = await authClient.signUp.email({
      name: name.trim() || undefined,
      email: email.trim(),
      password,
      callbackURL,
    });
    setLoading(false);
    if (error) {
      setMessage(error.message || 'Sign up failed');
      return;
    }
    setEmailSent(true);
  }

  if (isPending) {
    return (
      <div className="h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (emailSent) {
    return (
      <div className="h-screen flex overflow-hidden">
        <div className="flex-1 flex items-center justify-center p-6 lg:p-8">
          <div className="w-full max-w-md text-center">
            <Link href="/" className="inline-flex items-center gap-2 mb-6">
              <img src="/logo_genlatex_full.svg" alt="GenLaTeX" className="h-9 w-auto" />
            </Link>
            <h1 className="text-2xl font-bold text-foreground mb-2">Check your email</h1>
            <p className="text-muted-foreground mb-4">
              We sent a verification link to <strong>{email}</strong>. Click it to verify your account, then you&apos;ll be signed in and redirected.
            </p>
            <p className="text-sm text-muted-foreground">
              Didn&apos;t get it? Check spam or{' '}
              <button type="button" onClick={() => setEmailSent(false)} className="text-primary hover:underline">
                try again
              </button>
            </p>
            <p className="mt-6 text-sm text-muted-foreground">
              <Link href={returnUrl ? `/login?returnUrl=${encodeURIComponent(returnUrl)}` : '/login'} className="text-primary hover:underline">Back to sign in</Link>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex overflow-hidden">
      <div className="flex-1 flex flex-col bg-background h-full">
        <div className="flex-1 flex items-center justify-center p-6 lg:p-8">
          <div className="w-full max-w-md">
            <Link href="/" className="flex items-center gap-2 mb-6">
              <img src="/logo_genlatex_full.svg" alt="GenLaTeX" className="h-9 w-auto" />
            </Link>

            <h1 className="text-2xl font-bold text-foreground mb-1">Create an Account</h1>
            <p className="text-sm text-muted-foreground mb-5">
              Sign up with Google or use email. With email, you must verify before signing in.
            </p>

            <button
              type="button"
              onClick={signUpWithGoogle}
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

            <form onSubmit={onSubmitEmail} className="space-y-3">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-foreground mb-1">Name</label>
                <input
                  id="name"
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  className="w-full rounded-lg border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
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
                    placeholder="At least 8 characters"
                    required
                    minLength={8}
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
              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-foreground mb-1">Repeat password</label>
                <div className="relative">
                  <input
                    id="confirmPassword"
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Repeat your password"
                    required
                    minLength={8}
                    className="w-full rounded-lg border border-border bg-input px-3 py-2 pr-10 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                  >
                    {showConfirmPassword ? <EyeClosedIcon width={16} height={16} /> : <EyeOpenIcon width={16} height={16} />}
                  </button>
                </div>
              </div>
              {message && (
                <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-2">
                  {message}
                </div>
              )}
              <button
                type="submit"
                disabled={loading || password !== confirmPassword}
                className="w-full py-2.5 px-4 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:opacity-50"
              >
                {loading ? 'Creating account...' : 'Sign up with email'}
              </button>
            </form>
            <p className="text-xs text-muted-foreground mt-3">
              By signing up with email, you must verify your email before you can sign in. We&apos;ll send you a link.
            </p>

            <p className="mt-5 text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link href="/login" className="text-primary hover:text-primary/80 font-medium underline">Sign In</Link>
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

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <RegisterContent />
    </Suspense>
  );
}
