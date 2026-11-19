// SPDX-License-Identifier: MIT

import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md text-center">
          <Link href="/" className="inline-flex items-center gap-2 mb-8">
            <img src="/logo_genlatex_full.svg" alt="GenLaTeX" className="h-9 w-auto" />
          </Link>

          <p className="text-8xl font-bold text-primary/20 mb-2">404</p>
          <h1 className="text-2xl font-bold text-foreground mb-2">Page not found</h1>
          <p className="text-sm text-muted-foreground mb-8">
            The page you&apos;re looking for doesn&apos;t exist or has been moved.
          </p>

          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 transition-opacity"
          >
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}
