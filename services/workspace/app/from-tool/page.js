/**
 * From-tool: open tool output (LaTeX) in GenLaTeX editor.
 * If not logged in, redirect to login with returnUrl. After login, create project and redirect to editor.
 */

'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { authClient } from '@/lib/auth-client.js';

const MAX_LATEX_BYTES = 100 * 1024; // 100KB

function decodePayload(encoded) {
  if (!encoded || typeof encoded !== 'string') return null;
  try {
    const json = decodeURIComponent(escape(atob(encoded)));
    const data = JSON.parse(json);
    if (typeof data.latex !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}

function isSafeReturnUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const path = url.startsWith('/') ? url : new URL(url, 'http://localhost').pathname;
  return path.startsWith('/') && !path.startsWith('//');
}

function FromToolContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session, isPending } = authClient.useSession();
  const [status, setStatus] = useState('loading'); // 'loading' | 'redirect' | 'creating' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [upgradeRequired, setUpgradeRequired] = useState(false);

  useEffect(() => {
    const payloadParam = searchParams.get('payload');
    if (!payloadParam) {
      setStatus('error');
      setErrorMessage('Missing payload. Use a tool on the GenLaTeX website and click "Open in GenLaTeX".');
      return;
    }

    if (isPending) return;

    if (!session?.user) {
      const returnUrl = `/from-tool?payload=${encodeURIComponent(payloadParam)}`;
      if (isSafeReturnUrl(returnUrl)) {
        window.location.href = `/login?returnUrl=${encodeURIComponent(returnUrl)}`;
      } else {
        setStatus('error');
        setErrorMessage('Invalid return URL.');
      }
      setStatus('redirect');
      return;
    }

    if (session.user.emailVerified !== true) {
      window.location.href = '/verify-email-required';
      return;
    }

    const decoded = decodePayload(payloadParam);
    if (!decoded) {
      setStatus('error');
      setErrorMessage('Invalid or corrupted payload. Try again from the tool page.');
      return;
    }

    const latex = decoded.latex || '';
    if (new Blob([latex]).size > MAX_LATEX_BYTES) {
      setStatus('error');
      setErrorMessage('Output is too large to open here. Use Download from the tool instead.');
      return;
    }

    setStatus('creating');

    const body = {
      latex,
      name: decoded.tool ? `From ${decoded.tool}` : 'From Tools',
    };
    if (decoded.file && typeof decoded.file === 'object' && typeof decoded.file.name === 'string' && typeof decoded.file.base64 === 'string') {
      body.file = { name: decoded.file.name, base64: decoded.file.base64 };
    }

    fetch('/api/projects/from-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then(async (res) => {
        const data = await res.json();
        if (data.projectId) {
          router.replace('/dashboard');
          return;
        }
        if (res.status === 403 && data.upgradeRequired) {
          setStatus('error');
          setErrorMessage("You've reached the free plan limit (3 projects). Upgrade to Pro to open this in the GenLaTeX editor.");
          setUpgradeRequired(true);
          return;
        }
        setStatus('error');
        setErrorMessage(data.error || data.message || 'Failed to create project.');
      })
      .catch((err) => {
        setStatus('error');
        setErrorMessage(err?.message || 'Failed to create project. Try again.');
      });
  }, [searchParams, router, session, isPending]);

  if (status === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
        <div className="max-w-md w-full text-center">
          <h1 className="text-xl font-bold text-foreground mb-2">Could not open in GenLaTeX</h1>
          <p className="text-muted-foreground text-sm mb-6">{errorMessage}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            {upgradeRequired && (
              <Link
                href="/dashboard?openUpgrade=1"
                className="inline-block px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90"
              >
                Upgrade to Pro
              </Link>
            )}
            <Link
              href="/dashboard"
              className={upgradeRequired
                ? 'inline-block px-5 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm font-medium hover:bg-muted'
                : 'inline-block px-5 py-2.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90'}
            >
              Go to dashboard
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
      <div className="text-muted-foreground text-sm">
        {status === 'creating' ? 'Creating project and opening editor...' : 'Loading...'}
      </div>
    </div>
  );
}

export default function FromToolPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex flex-col items-center justify-center bg-background p-6">
        <div className="text-muted-foreground text-sm">Loading...</div>
      </div>
    }>
      <FromToolContent />
    </Suspense>
  );
}
