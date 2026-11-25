import type { Metadata } from "next";

// Public site facts shared by metadata, the sitemap, robots.txt, JSON-LD and llms.txt.

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://metainfo.agarwal-aman041.workers.dev").replace(/\/$/, "");
export const SITE_NAME = "MetaInfo";
export const REPO = "https://github.com/AmanAgarwal041/metainfo";
/** Bump when the landing page or tool descriptions change: shown on the page and used as dateModified. */
export const LAST_UPDATED = "2026-11-25";
export const DESCRIPTION = "Free, open-source SEO and AI visibility toolkit: audit pages for Google, ChatGPT, Perplexity, Claude and Gemini, and track AI citations.";

const OG_IMAGE = { url: "/og.png", width: 1200, height: 630, alt: "MetaInfo: SEO and AI visibility" };

/** Title, description, canonical URL and share tags for one route. `index: false` keeps account pages out of search. */
export function pageMeta(path: string, title: string, description: string, { index = true, absolute = false } = {}): Metadata {
  return {
    title: absolute ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", url: path, title: absolute ? title : `${title} | ${SITE_NAME}`, description, images: [OG_IMAGE] },
    twitter: { card: "summary_large_image", title: absolute ? title : `${title} | ${SITE_NAME}`, description, images: [OG_IMAGE.url] },
    ...(index ? {} : { robots: { index: false, follow: true } }),
  };
}

/** Public tool pages, for the sitemap and llms.txt. */
export const TOOLS: { path: string; title: string; description: string }[] = [
  { path: "/audit", title: "Free page audit for SEO and AI search", description: "Audit any URL with 55+ checks scored for Google, Bing, ChatGPT, Perplexity, Claude, Gemini and social sharing, with a ranked fix plan." },
  { path: "/ai-visibility", title: "AI visibility tracker for ChatGPT and Perplexity", description: "Check whether ChatGPT, Claude, Gemini, Perplexity and Google AI Overviews name and cite your brand, then track fixes and their impact." },
  { path: "/site-audit", title: "Site crawl and JavaScript rendering check", description: "Crawl a whole site for broken links, duplicate titles, template-wide issues and content that only appears after JavaScript runs." },
  { path: "/schema", title: "Schema markup validator for JSON-LD", description: "Validate JSON-LD, Microdata and RDFa against the full schema.org vocabulary and Google's rich-result requirements." },
  { path: "/keywords", title: "Keyword research with volume and difficulty", description: "Long-tail keyword ideas from autocomplete for free; search volume, difficulty, CPC, intent and trend with DataForSEO." },
  { path: "/keyword-gap", title: "Keyword gap analysis against competitors", description: "Find the topics and keywords competitors cover and rank for that your site doesn't." },
  { path: "/competitors", title: "Competitor SEO and AI readiness comparison", description: "Compare your page audit with each competitor's, and find organic competitors by keyword overlap." },
  { path: "/serp", title: "SERP analysis with AI Overview sources", description: "Benchmark the pages that rank for a keyword: live results, SERP features and the sources Google's AI Overview cites." },
  { path: "/backlinks", title: "Backlink checker and link gap analysis", description: "Compare backlink profiles, referring domains and anchors, and find links competitors have that you don't." },
  { path: "/search-console", title: "Google Search Console clicks, positions and opportunities", description: "Your real Google clicks, impressions, CTR and positions from Search Console, with striking-distance keywords, low-CTR snippets, cannibalisation, decliners and URL inspection." },
  { path: "/rankings", title: "Rank tracker for keywords and competitors", description: "Track desktop and mobile Google positions for your keywords and competitors, with a cost estimate before each run." },
  { path: "/traffic", title: "AI referral and crawler traffic analytics", description: "See visits from ChatGPT, Perplexity and Gemini, and which AI crawlers fetch your pages, from an edge collector." },
  { path: "/dashboard", title: "SEO and AI visibility dashboard", description: "Scores per platform over time, AI readiness, next fixes and a setup checklist for each project." },
];

export const toolMeta = (path: string): Metadata => {
  const t = TOOLS.find((x) => x.path === path)!;
  return pageMeta(path, t.title, t.description);
};
