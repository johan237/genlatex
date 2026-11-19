import { MetadataRoute } from "next";
import { TOOLS_LIST } from "@/lib/tools";

export const dynamic = "force-static";

const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://genlatex.com";
const blogSlugs = [
  "genlatex-vs-overleaf-ai",
  "genlatex-vs-jenni-ai",
  "genlatex-vs-answerthis-io",
  "ai-literature-review",
  "latex-ai-tools",
];

export default function sitemap(): MetadataRoute.Sitemap {
  const toolEntries: MetadataRoute.Sitemap = TOOLS_LIST.map((tool) => ({
    url: `${baseUrl}/tools/${tool.id}/`,
    lastModified: new Date(),
    changeFrequency: "weekly" as const,
    priority: 0.7,
  }));

  const blogEntries: MetadataRoute.Sitemap = blogSlugs.map((slug) => ({
    url: `${baseUrl}/blog/${slug}/`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.6,
  }));

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${baseUrl}/privacy-policy/`,
      lastModified: new Date(),
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/blog/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/tools/`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 0.8,
    },
    { url: `${baseUrl}/editor/`, changeFrequency: "monthly", priority: 0.9 },
    ...blogEntries,
    ...toolEntries,
  ];
}
