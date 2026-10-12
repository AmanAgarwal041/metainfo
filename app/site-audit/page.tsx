import type { Metadata } from "next";
import SiteAudit from "@/components/SiteAudit";

export const metadata: Metadata = { title: "Site crawl" };

export default function Page() {
  return <SiteAudit />;
}
