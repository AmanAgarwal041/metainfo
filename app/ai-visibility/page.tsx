import type { Metadata } from "next";
import { toolMeta } from "@/lib/site";
import ToolSchema from "@/components/ToolSchema";
import AiVisibility from "@/components/research/AiVisibility";

export const metadata: Metadata = toolMeta("/ai-visibility");

export default function Page() {
  return (
    <>
      <ToolSchema path="/ai-visibility" />
      <AiVisibility />
    </>
  );
}
