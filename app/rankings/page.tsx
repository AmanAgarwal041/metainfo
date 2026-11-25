import type { Metadata } from "next";
import { toolMeta } from "@/lib/site";
import ToolSchema from "@/components/ToolSchema";
import Rankings from "@/components/research/Rankings";

export const metadata: Metadata = toolMeta("/rankings");

export default function Page() {
  return (
    <>
      <ToolSchema path="/rankings" />
      <Rankings />
    </>
  );
}
