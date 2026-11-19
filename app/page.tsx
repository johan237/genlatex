import Link from 'next/link';
import Navigation from '@/components/layout/Navigation';
import Footer from '@/components/layout/Footer';
const features = [
  ['01', 'Your writing, your workspace.', 'Create projects with multiple text files, import .tex and .bib files, and keep working without an account. Projects save in your browser.'],
  ['02', 'An assistant on your terms.', 'Bring your own OpenAI-compatible model. Ask questions, fix LaTeX, and review suggested changes before applying them.'],
  ['03', 'Built to be yours.', 'Open source under the MIT licence. Run it locally, host the static site yourself, and extend the tools to fit how you work.'],
];
export default function Home() {
  return <><Navigation /><main>
    <section id="about" className="max-w-hero mx-auto px-6 pt-24 pb-20 text-center">
      <p className="text-xs font-semibold tracking-[0.2em] uppercase text-primary mb-7">Open source · LaTeX · AI</p>
      <h1 className="font-heading text-5xl md:text-7xl font-semibold tracking-tight leading-[1.08] max-w-4xl mx-auto">A little less friction.<br /><span className="text-primary">A lot more writing.</span></h1>
      <p className="max-w-xl mx-auto mt-7 text-lg leading-relaxed text-secondary">Your LaTeX workspace, with an AI assistant you control. Start a paper, work with your source, and make it your own.</p>
      <div className="flex flex-wrap justify-center gap-4 mt-9"><Link href="/editor/" className="bg-primary text-white rounded-xl px-7 py-3.5 font-medium">Start writing ↗</Link><Link href="/tools/" className="bg-white border border-border rounded-xl px-7 py-3.5 font-medium">Explore the tools</Link></div>
      <p className="text-xs text-secondary mt-5">No account required. Projects saved on your device.</p>
      <div className="mt-16 rounded-2xl border border-border bg-white shadow-card-soft overflow-hidden text-left max-w-5xl mx-auto">
        <div className="px-5 py-4 border-b border-border text-sm text-secondary flex justify-between"><span>GenLaTeX / My next paper</span><span className="text-primary">main.tex</span></div>
        <div className="grid md:grid-cols-2"><pre className="p-7 md:p-10 text-xs md:text-sm leading-loose overflow-auto bg-[#fafbfe] text-secondary">{String.raw`\documentclass{article}
\title{An idea worth exploring}
\begin{document}
\maketitle

\section{Introduction}
Every good paper starts with a question.

\[ E = mc^2 \]
\end{document}`}</pre><div className="p-10 md:p-14 font-serif text-center bg-white flex flex-col justify-center"><h2 className="text-2xl">An idea worth exploring</h2><p className="mt-4 text-xs text-secondary">Your name</p><h3 className="mt-10 text-left font-bold">1 &nbsp; Introduction</h3><p className="text-left text-sm mt-4">Every good paper starts with a question.</p><p className="text-xl mt-8 italic">E = mc²</p><p className="text-[10px] text-secondary mt-10 font-sans">Illustrative document preview</p></div></div>
      </div>
    </section>
    <section id="solution" className="max-w-hero mx-auto px-6 py-16 grid md:grid-cols-3 gap-10">{features.map(([n, title, description]) => <article key={n}><span className="text-sm font-mono text-primary">{n} /</span><h2 className="text-xl font-heading font-semibold mt-5 mb-3">{title}</h2><p className="text-secondary text-sm leading-relaxed">{description}</p></article>)}</section>
    <section id="how-it-works" className="max-w-hero mx-auto px-6 py-16"><div className="border-y border-border py-12 grid md:grid-cols-2 gap-8"><h2 className="font-heading text-3xl font-semibold">Static hosting.<br />Room to go further.</h2><p className="text-secondary leading-relaxed">The editor runs as a static site on Netlify. AI connects directly to your chosen provider. PDF compilation can run in your browser when the optional SwiftLaTeX engine is installed; packages may require network access. The original server workspace and research agent are included for developers who want accounts, cloud storage, and advanced research workflows.</p></div></section>
    <section id="pricing" className="max-w-hero mx-auto px-6 py-16 pb-28 text-center"><h2 className="font-heading text-3xl font-semibold">Free to use. Free to build on.</h2><p className="text-secondary mt-4 mb-8">The editor has no subscription or document quota. Your AI provider may charge for usage.</p><Link className="rounded-xl px-7 py-3.5 bg-primary text-white font-medium" href="/editor/">Open GenLaTeX ↗</Link></section>
  </main><Footer /></>;
}
