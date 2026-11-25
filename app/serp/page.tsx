import type { Metadata } from "next";
import { toolMeta } from "@/lib/site";
import ToolSchema from "@/components/ToolSchema";
import Serp from "@/components/research/Serp";

export const metadata: Metadata = toolMeta("/serp");

export default function Page() {
  return (
    <>
      <ToolSchema path="/serp" />
      <Serp />
    </>
  );
}
