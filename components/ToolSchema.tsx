import { LAST_UPDATED, REPO, SITE_NAME, SITE_URL, TOOLS } from "@/lib/site";

/** JSON-LD for a public tool page: the web application it is, its place under the home page, and when it last changed. */
export default function ToolSchema({ path }: { path: string }) {
  const t = TOOLS.find((x) => x.path === path);
  if (!t) return null;
  const url = `${SITE_URL}${path}`;
  const data = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebApplication",
        "@id": `${url}#app`,
        name: t.title,
        url,
        description: t.description,
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        dateModified: LAST_UPDATED,
        publisher: { "@type": "Organization", "@id": `${SITE_URL}/#org`, name: SITE_NAME, url: `${SITE_URL}/`, logo: `${SITE_URL}/icon.svg`, sameAs: [REPO] },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: SITE_NAME, item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: t.title, item: url },
        ],
      },
    ],
  };
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}
