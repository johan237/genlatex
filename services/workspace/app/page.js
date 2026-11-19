// SPDX-License-Identifier: MIT

import { getSessionFromRequest } from '@/lib/project-auth.js';
import { redirect } from 'next/navigation';

export default async function HomePage() {
  const session = await getSessionFromRequest();
  if (session?.id) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center transition-colors duration-300">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6 text-center">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-center space-x-3 mb-6">
            <img src="/logo_genlatex_full.svg" alt="GenLaTeX" className="h-12 w-auto" />
          </div>
          <h1 className="text-4xl font-bold text-foreground mb-4">Build LaTeX projects with ease</h1>
          <p className="text-lg text-muted-foreground mb-8">Log in, manage projects, edit .tex files, compile to PDF, and preview.</p>
        </div>
        <div className="flex gap-4 justify-center">
          <a href="/login" className="px-8 py-3 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors duration-300 font-medium">
            Log in
          </a>
          <a href="/register" className="px-8 py-3 bg-background text-foreground border border-border rounded-lg hover:bg-muted transition-colors duration-300 font-medium">
            Register
          </a>
        </div>
      </div>
    </div>
  );
}
