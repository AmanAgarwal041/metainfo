import type { Metadata } from "next";
import { toolMeta } from "@/lib/site";
import ToolSchema from "@/components/ToolSchema";
import KeywordGap from "@/components/research/KeywordGap";

export const metadata: Metadata = toolMeta("/keyword-gap");

export default function Page() {
  return (
    <>
      <ToolSchema path="/keyword-gap" />
      <KeywordGap />
    </>
  );
}
