'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

function ZoteroConnectedContent() {
  const searchParams = useSearchParams();
  const success = searchParams.get('success') === '1';
  const error = searchParams.get('error') || '';
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (!success || closed) return;
    const isOpener = typeof window !== 'undefined' && window.opener;
    if (isOpener) {
      try {
        window.opener.postMessage({ type: 'zotero-connected' }, window.location.origin);
      } catch (err) {
        console.warn('[zotero-connected] postMessage failed:', err?.message);
      }
      setClosed(true);
      window.close();
    }
  }, [success, closed]);

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
        <div className="max-w-md w-full text-center">
          <div className="mb-4 text-green-600">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Zotero connected</h1>
          <p className="text-gray-600 mb-6">
            You can close this window and return to your project.
          </p>
          <Link
            href="/dashboard"
            className="text-sm text-blue-600 hover:underline"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const errorMessages = {
    missing_params: 'Authorization was incomplete. Please try again.',
    expired_or_invalid: 'This link has expired or was already used. Please start the connection again.',
    config: 'Zotero connection is not configured. Please contact support.',
    no_key: 'We could not get your Zotero key. Please try again.',
    exchange: 'Something went wrong during connection. Please try again.',
  };
  const message = errorMessages[error] || 'Something went wrong. Please try again.';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-6">
      <div className="max-w-md w-full text-center">
        <div className="mb-4 text-red-500">
          <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-gray-900 mb-2">Connection failed</h1>
        <p className="text-gray-600 mb-6">{message}</p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/api/zotero/oauth/start"
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
          >
            Try again
          </Link>
          <Link
            href="/dashboard"
            className="px-4 py-2 rounded-lg border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50"
          >
            Go to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function ZoteroConnectedPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <ZoteroConnectedContent />
    </Suspense>
  );
}
