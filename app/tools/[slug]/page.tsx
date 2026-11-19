import type { Metadata } from "next";
import { TOOLS_LIST } from "@/lib/tools";
import ToolSlugClient from "./ToolSlugClient";

export function generateStaticParams() {
  return TOOLS_LIST.map((tool) => ({ slug: tool.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const tool = TOOLS_LIST.find((item) => item.id === slug);
  const name = tool?.name ?? "GenLaTeX Tool";
  const description =
    tool?.description ??
    "Use free AI LaTeX tools in your browser, then open the output in GenLaTeX.";
  const title = `${name} | GenLaTeX`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
    },
    robots: { index: true, follow: true },
  };
}

export default async function ToolSlugPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <ToolSlugClient slug={slug ?? ""} />;
}
