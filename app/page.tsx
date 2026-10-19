import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Landing from "@/components/Landing";

export const metadata: Metadata = {
  title: { absolute: "MetaInfo: see your pages the way search engines and AI see them" },
};

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Old links (/?url=…) pointed at the audit when it lived on the home page.
  const { url } = await searchParams;
  if (typeof url === "string" && url) redirect(`/audit?url=${encodeURIComponent(url)}`);
  return <Landing />;
}
