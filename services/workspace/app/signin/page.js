/**
 * GenLaTeX – Sign In redirect
 * If user has session → /dashboard (or returnUrl), else → /login (preserving returnUrl)
 */

import { getSessionFromRequest } from '@/lib/project-auth.js';
import { redirect } from 'next/navigation';

function isSafeReturnUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const path = url.startsWith('/') ? url : new URL(url, 'http://localhost').pathname;
  return path.startsWith('/') && !path.startsWith('//');
}

export default async function SignInPage({ searchParams }) {
  const session = await getSessionFromRequest();
  if (session?.id) {
    if (session.emailVerified !== true) redirect('/verify-email-required');
    const returnUrl = searchParams?.returnUrl && isSafeReturnUrl(searchParams.returnUrl) ? searchParams.returnUrl : '/dashboard';
    redirect(returnUrl);
  }
  const returnUrl = searchParams?.returnUrl && isSafeReturnUrl(searchParams.returnUrl) ? searchParams.returnUrl : null;
  if (returnUrl) {
    redirect(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
  }
  redirect('/login');
}
