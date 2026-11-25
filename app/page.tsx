import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Landing from "@/components/Landing";
import { pageMeta } from "@/lib/site";

export const metadata: Metadata = pageMeta(
  "/",
  "MetaInfo: free SEO and AI visibility audits",
  "Audit any page for Google, Bing, ChatGPT, Perplexity, Claude and Gemini, see which crawlers can reach it, and track whether AI answers cite you.",
  { absolute: true },
);

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Old links (/?url=…) pointed at the audit when it lived on the home page.
  const { url } = await searchParams;
  if (typeof url === "string" && url) redirect(`/audit?url=${encodeURIComponent(url)}`);
  return <Landing />;
}
