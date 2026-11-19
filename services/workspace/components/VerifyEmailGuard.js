/**
 * Redirects logged-in users with unverified email to /verify-email-required.
 * Allow list: public and auth pages where unverified users may be.
 */

'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

const ALLOWED_PATHS = [
  '/',
  '/login',
  '/signin',
  '/register',
  '/signup',
  '/verify-email',
  '/verify-email-required',
  '/forgot-password',
  '/reset-password',
  '/privacy',
];

function isAllowed(pathname) {
  if (!pathname) return true;
  if (pathname.startsWith('/api/')) return true;
  if (pathname.startsWith('/share/')) return true;
  return ALLOWED_PATHS.some((p) => pathname === p || (p !== '/' && pathname.startsWith(p + '/')));
}

export default function VerifyEmailGuard({ session, children }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!session?.id) return;
    if (session.emailVerified !== false) return;
    if (isAllowed(pathname)) return;
    router.replace('/verify-email-required');
  }, [session, pathname, router]);

  return children;
}
