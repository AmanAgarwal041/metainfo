import type { Metadata } from "next";
import { toolMeta } from "@/lib/site";
import ToolSchema from "@/components/ToolSchema";
import SearchConsole from "@/components/SearchConsole";

export const metadata: Metadata = toolMeta("/search-console");

export default function Page() {
  return (
    <>
      <ToolSchema path="/search-console" />
      <SearchConsole />
    </>
  );
}
