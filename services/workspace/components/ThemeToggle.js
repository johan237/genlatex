// SPDX-License-Identifier: MIT

'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { SunIcon, MoonIcon } from '@radix-ui/react-icons';

export default function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return (
    <>
      {theme === 'light' ? (
        <MoonIcon width="16" height="16" />
      ) : (
        <SunIcon width="16" height="16" />
      )}
    </>
  );
}
