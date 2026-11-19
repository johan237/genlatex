/**
 * Shown when a logged-in user has not verified their email.
 * Blocks app access until they verify (link in email or resend).
 */

import { redirect } from 'next/navigation';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import VerifyEmailRequiredClient from '../../components/VerifyEmailRequiredClient';

export default async function VerifyEmailRequiredPage() {
  const session = await getSessionFromRequest();
  if (!session) {
    redirect('/login');
  }
  if (session.emailVerified) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
      <div className="w-full max-w-md text-center space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">
          Verify your email
        </h1>
        <p className="text-gray-600">
          Please verify your email before you can use the app. Check your inbox for the verification link.
        </p>
        <VerifyEmailRequiredClient email={session.email} />
        <p className="text-sm text-gray-500">
          Didn&apos;t receive the email? Check spam or resend below.
        </p>
      </div>
    </div>
  );
}
