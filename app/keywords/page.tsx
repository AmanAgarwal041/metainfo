import type { Metadata } from "next";
import { toolMeta } from "@/lib/site";
import ToolSchema from "@/components/ToolSchema";
import Keywords from "@/components/research/Keywords";

export const metadata: Metadata = toolMeta("/keywords");

export default function Page() {
  return (
    <>
      <ToolSchema path="/keywords" />
      <Keywords />
    </>
  );
}
