import type { Metadata } from "next";
import { toolMeta } from "@/lib/site";
import ToolSchema from "@/components/ToolSchema";
import Traffic from "@/components/Traffic";

export const metadata: Metadata = toolMeta("/traffic");

export default function Page() {
  return (
    <>
      <ToolSchema path="/traffic" />
      <Traffic />
    </>
  );
}
