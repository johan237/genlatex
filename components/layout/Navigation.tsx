import Link from 'next/link';
export default function Navigation() {
  return <nav className="px-6 py-5 border-b border-border bg-white/80"><div className="max-w-hero mx-auto flex flex-wrap items-center justify-between gap-4">
    <Link href="/" aria-label="GenLaTeX home"><img src="/logo_genlatex_full.svg" width="155" height="40" alt="GenLaTeX" /></Link>
    <div className="flex items-center gap-6 text-sm"><Link href="/tools/">Tools</Link><Link href="/blog/">Blog</Link><Link href="/editor/" className="rounded-lg bg-primary px-5 py-2.5 text-white font-medium">Open editor ↗</Link></div>
  </div></nav>;
}
