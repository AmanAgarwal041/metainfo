import type { Metadata } from "next";
import { toolMeta } from "@/lib/site";
import ToolSchema from "@/components/ToolSchema";
import Competitors from "@/components/research/Competitors";

export const metadata: Metadata = toolMeta("/competitors");

export default function Page() {
  return (
    <>
      <ToolSchema path="/competitors" />
      <Competitors />
    </>
  );
}
