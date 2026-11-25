import type { Metadata } from "next";
import { toolMeta } from "@/lib/site";
import ToolSchema from "@/components/ToolSchema";
import App from "@/components/App";

export const metadata: Metadata = toolMeta("/audit");

export default function Page() {
  return (
    <>
      <ToolSchema path="/audit" />
      <App />
    </>
  );
}
