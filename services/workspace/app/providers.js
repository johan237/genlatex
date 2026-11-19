// SPDX-License-Identifier: MIT

'use client';

import { ThemeProvider } from 'next-themes';
import { Theme } from '@radix-ui/themes';
import '@radix-ui/themes/styles.css';
import { useEffect, useState } from 'react';
import { ToastProvider } from '../components/Toast';
import { PageErrorBoundary } from '../components/ErrorBoundary';
import VerifyEmailGuard from '../components/VerifyEmailGuard';

export default function Providers({ children, session }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      storageKey="genlatex-theme"
      enableSystem={false}
      disableTransitionOnChange={false}
      enableColorScheme={false}
      forcedTheme={undefined}
    >
      <Theme 
        accentColor="blue" 
        grayColor="slate" 
        radius="medium" 
        scaling="100%"
        appearance="inherit"
      >
        <PageErrorBoundary>
          <ToastProvider>
            <VerifyEmailGuard session={session}>
              {children}
            </VerifyEmailGuard>
          </ToastProvider>
        </PageErrorBoundary>
      </Theme>
    </ThemeProvider>
  );
}
