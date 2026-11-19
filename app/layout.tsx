import type { Metadata } from 'next';
import './globals.css';
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://genlatex.com';
export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: 'GenLaTeX — Open-source LaTeX editor with AI', template: '%s | GenLaTeX' },
  description: 'An open-source LaTeX editor with local projects, import and export, and an AI assistant you control.',
  icons: { icon: '/logo_genlatex_only.svg' },
  openGraph: { title: 'GenLaTeX', description: 'Open-source LaTeX editing with AI.', images: ['/logo_genlatex_full.svg'] },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body className="font-sans antialiased">{children}</body></html>;
}
