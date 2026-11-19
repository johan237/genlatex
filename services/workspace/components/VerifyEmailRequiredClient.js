'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function VerifyEmailRequiredClient({ email }) {
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function resend() {
    if (!email) return;
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/send-verification-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, callbackURL: '/dashboard' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data?.message || 'Failed to send. Try again.');
        setLoading(false);
        return;
      }
      setSent(true);
    } catch (e) {
      setError(e.message || 'Failed to send. Try again.');
    }
    setLoading(false);
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={resend}
        disabled={loading}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {loading ? 'Sending…' : sent ? 'Email sent' : 'Resend verification email'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <p className="text-sm text-gray-500">
        <Link href="/login" className="text-blue-600 hover:underline">Back to login</Link>
      </p>
    </div>
  );
}
