import type { Metadata } from "next";
import { toolMeta } from "@/lib/site";
import ToolSchema from "@/components/ToolSchema";
import Backlinks from "@/components/research/Backlinks";

export const metadata: Metadata = toolMeta("/backlinks");

export default function Page() {
  return (
    <>
      <ToolSchema path="/backlinks" />
      <Backlinks />
    </>
  );
}
