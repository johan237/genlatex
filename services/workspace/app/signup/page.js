/**
 * GenLaTeX – Sign Up redirect
 * Redirects to /register?plan=free or /register?plan=pro
 */

import { redirect } from 'next/navigation';

export default async function SignUpPage({ searchParams }) {
  const params = typeof searchParams?.then === 'function' ? await searchParams : searchParams;
  const plan = (params?.plan || 'free').toLowerCase();
  const validPlan = plan === 'pro' ? 'pro' : 'free';
  redirect(`/register?plan=${validPlan}`);
}
