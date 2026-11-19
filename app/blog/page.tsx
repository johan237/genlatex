import type { Metadata } from "next";
import Navigation from "@/components/layout/Navigation";
import Footer from "@/components/layout/Footer";
import Link from "next/link";
import { BreadcrumbJsonLd } from "@/components/JsonLd";

export const metadata: Metadata = {
  title: "GenLaTeX Blog: AI Research Writing Guides",
  description:
    "Read GenLaTeX comparison articles and AI writing guides for LaTeX, literature reviews, and research workflows.",
  openGraph: {
    title: "GenLaTeX Blog: AI Research Writing Guides",
    description:
      "Read GenLaTeX comparison articles and AI writing guides for LaTeX, literature reviews, and research workflows.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function Blog() {
  return (
    <main className="min-h-screen bg-background">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: "https://genlatex.com" },
          { name: "Blog", url: "https://genlatex.com/blog" },
        ]}
      />
      <Navigation />
      <section className="pt-32 pb-24 px-6">
        <div className="max-w-5xl mx-auto text-center">
          <h1 className="font-heading text-4xl md:text-6xl font-bold mb-6">
            GenLaTeX Blog: AI Research Writing
          </h1>
          <p className="text-secondary text-lg max-w-3xl mx-auto mb-12">
            Explore AI research writing guides and comparisons for LaTeX workflows,
            literature reviews, and citation management.
          </p>
          <div className="grid gap-6 md:grid-cols-3 text-left">
            <Link
              href="/blog/genlatex-vs-overleaf-ai"
              className="rounded-[24px] border border-white/60 bg-white/80 p-6 shadow-card-soft hover:shadow-card-hover transition"
            >
              <h2 className="text-xl font-semibold text-foreground mb-3">
                GenLaTeX vs Overleaf AI
              </h2>
              <p className="text-secondary text-sm">
                Compare GenLaTeX and Overleaf AI for research drafting,
                citations, and LaTeX workflows. Learn which tool fits your
                academic writing process.
              </p>
            </Link>
            <Link
              href="/blog/genlatex-vs-jenni-ai"
              className="rounded-[24px] border border-white/60 bg-white/80 p-6 shadow-card-soft hover:shadow-card-hover transition"
            >
              <h2 className="text-xl font-semibold text-foreground mb-3">
                GenLaTeX vs Jenni AI
              </h2>
              <p className="text-secondary text-sm">
                See how GenLaTeX compares to Jenni AI for academic structure,
                citations, and LaTeX-ready output.
              </p>
            </Link>
            <Link
              href="/blog/genlatex-vs-answerthis-io"
              className="rounded-[24px] border border-white/60 bg-white/80 p-6 shadow-card-soft hover:shadow-card-hover transition"
            >
              <h2 className="text-xl font-semibold text-foreground mb-3">
                GenLaTeX vs AnswerThis.io
              </h2>
              <p className="text-secondary text-sm">
                Compare GenLaTeX with AnswerThis.io and decide whether you need
                a discovery tool, a drafting workflow, or both.
              </p>
            </Link>
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
