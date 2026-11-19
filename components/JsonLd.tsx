const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://genlatex.com";

export function OrganizationWebSiteJsonLd() {
  const organization = {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteUrl}#organization`,
    name: "GenLaTeX",
    url: siteUrl,
    logo: `${siteUrl}/logo_genlatex_full.svg`,
    description:
      "AI-powered research writing platform. Write research papers in seconds with literature reviews, smart citations, and LaTeX/PDF export.",
    sameAs: [
      "https://twitter.com/genlatex",
      "https://linkedin.com/company/genlatex",
      "https://github.com/genlatex",
    ],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      email: "privacy@genlatex.ai",
      availableLanguage: "English, French",
    },
  };

  const webSite = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "GenLaTeX",
    url: siteUrl,
    description:
      "AI-powered research writing for modern teams. Literature reviews, citations, and export-ready drafts in minutes.",
    publisher: { "@id": `${siteUrl}#organization` },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${siteUrl}/?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(organization),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(webSite),
        }}
      />
    </>
  );
}

export function ArticleJsonLd({
  url,
  title,
  description,
  datePublished,
  dateModified,
}: {
  url: string;
  title: string;
  description: string;
  datePublished: string;
  dateModified?: string;
}) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: title,
    description,
    url,
    datePublished,
    dateModified: dateModified || datePublished,
    author: {
      "@type": "Organization",
      name: "GenLaTeX",
      url: siteUrl,
    },
    publisher: {
      "@type": "Organization",
      name: "GenLaTeX",
      logo: {
        "@type": "ImageObject",
        url: `${siteUrl}/logo_genlatex_full.svg`,
      },
    },
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}

export function BreadcrumbJsonLd({
  items,
}: {
  items: { name: string; url: string }[];
}) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
    />
  );
}
