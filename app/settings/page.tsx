import type { Metadata } from "next";
import { pageMeta } from "@/lib/site";
import Settings from "@/components/Settings";

export const metadata: Metadata = pageMeta("/settings", "Settings", "MetaInfo settings: DataForSEO keys, MCP server setup and workspace preferences.", { index: false });

export default function Page() {
  return <Settings />;
}
