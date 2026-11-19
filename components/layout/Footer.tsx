import Link from 'next/link';
export default function Footer() {
  return <footer className="px-6 py-10 border-t border-border"><div className="max-w-hero mx-auto flex flex-wrap justify-between gap-4 text-sm text-secondary">
    <p>© 2026 GenLaTeX contributors · MIT licensed</p><div className="flex gap-5"><Link href="/editor/">Editor</Link><Link href="/tools/">Tools</Link><Link href="/privacy-policy/">Privacy</Link>{process.env.NEXT_PUBLIC_SOURCE_URL && <a href={process.env.NEXT_PUBLIC_SOURCE_URL}>Source code</a>}</div>
  </div></footer>;
}
