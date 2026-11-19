import type { Metadata } from "next";
import Navigation from "@/components/layout/Navigation";
import Footer from "@/components/layout/Footer";
import Link from "next/link";
import { TOOLS_LIST } from "@/lib/tools";
import { BreadcrumbJsonLd } from "@/components/JsonLd";
import {
  FileText,
  Table2,
  Quote,
  Sigma,
  FileSearch,
  FileUp,
  Wand2,
  GraduationCap,
} from "lucide-react";

const TOOL_ICONS: Record<string, typeof FileText> = {
  "table-to-latex": Table2,
  "doi-to-bibtex": Quote,
  "equation-to-latex": Sigma,
  "pdf-equation-extractor": FileSearch,
  "word-to-latex": FileUp,
  "latex-formatter": Wand2,
  "arxiv-to-latex": FileText,
  "abstract-generator": FileText,
  "thesis-statement-generator": GraduationCap,
};

export const metadata: Metadata = {
  title: "Free AI LaTeX Tools for Researchers",
  description:
    "Free AI LaTeX tools for tables, citations, equations, abstracts, and thesis statements. Generate LaTeX fast, then open in GenLaTeX.",
  openGraph: {
    title: "Free AI LaTeX Tools | GenLaTeX",
    description:
      "Free AI LaTeX tools to convert, generate, and format research content—then open in GenLaTeX.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function ToolsPage() {
  return (
    <main className="min-h-screen bg-background" role="main" aria-label="GenLaTeX free tools">
      <BreadcrumbJsonLd
        items={[
          { name: "Home", url: "https://genlatex.com" },
          { name: "Tools", url: "https://genlatex.com/tools" },
        ]}
      />
      <Navigation />
      <section className="pt-32 pb-24 px-6">
        <div className="max-w-hero mx-auto">
          <div className="text-center mb-14">
            <h1 className="font-heading text-4xl md:text-6xl font-bold mb-6">
              Free AI LaTeX Tools for Research Writing
            </h1>
            <p className="text-secondary text-lg max-w-2xl mx-auto">
              Convert tables, equations, citations, and outlines into LaTeX in your browser.
              Download the output or open it in GenLaTeX to keep editing.
            </p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {TOOLS_LIST.map((tool) => (
              <Link
                key={tool.id}
                href={tool.href as string}
                className="group block rounded-[24px] border border-border/60 bg-white p-6 shadow-card-soft transition hover:shadow-card-solid hover:border-primary/20"
              >
                <div className="mb-4 flex items-center justify-center h-11 w-11 rounded-2xl bg-primary/10 text-primary">
                  {(() => {
                    const Icon = TOOL_ICONS[tool.id] ?? FileText;
                    return <Icon className="h-5 w-5" />;
                  })()}
                </div>
                <h2 className="font-heading text-xl font-semibold text-foreground mb-2">
                  {tool.name}
                </h2>
                <p className="text-secondary text-sm leading-relaxed mb-5">
                  {tool.description}
                </p>
                <span className="text-sm font-semibold text-primary inline-flex items-center gap-1">
                  Try Now <span aria-hidden="true">→</span>
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
      <Footer />
    </main>
  );
}
