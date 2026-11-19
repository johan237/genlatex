// SPDX-License-Identifier: MIT

import './globals.css';
import { getSessionFromRequest } from '@/lib/project-auth.js';
import Providers from './providers';

// App URL for OG image and shared links (X, LinkedIn). Prefer BETTER_AUTH_URL / public app URL.
const appUrl =
  process.env.BETTER_AUTH_URL ||
  process.env.NEXT_PUBLIC_BASE_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
  'http://localhost:3000';

export const metadata = {
  metadataBase: new URL(appUrl),
  title: 'GenLaTeX',
  description: 'AI-powered LaTeX workspace for creating reports, slides, CVs, letters, and technical documents from natural language prompts.',
  openGraph: {
    type: 'website',
    locale: 'en_US',
    url: appUrl,
    siteName: 'GenLaTeX',
    title: 'GenLaTeX - AI-Powered LaTeX Workspace',
    description: 'Create LaTeX documents from prompts, refine with chat, and export polished output fast.',
    images: [
      {
        url: '/logo_full.png',
        width: 1200,
        height: 630,
        alt: 'GenLaTeX - AI-Powered LaTeX Workspace',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GenLaTeX - AI-Powered LaTeX Workspace',
    description: 'Prompt-first LaTeX document generation for reports, presentations, CVs, letters, and more.',
    images: ['/logo_full.png'],
  },
};

export default async function RootLayout({ children }) {
  const session = await getSessionFromRequest();
  
  return (
    <html lang="en" suppressHydrationWarning>
      <head />
      <body className="min-h-screen bg-white">
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600&display=swap" rel="stylesheet" />
        <link rel="icon" href="/logo_genlatex_only.svg" type="image/svg+xml" />
        <Providers session={session}>
          <div className="min-h-screen">
            {children}
          </div>
        </Providers>
      </body>
    </html>
  );
}
