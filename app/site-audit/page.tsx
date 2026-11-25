import type { Metadata } from "next";
import { toolMeta } from "@/lib/site";
import ToolSchema from "@/components/ToolSchema";
import SiteAudit from "@/components/SiteAudit";

export const metadata: Metadata = toolMeta("/site-audit");

export default function Page() {
  return (
    <>
      <ToolSchema path="/site-audit" />
      <SiteAudit />
    </>
  );
}
