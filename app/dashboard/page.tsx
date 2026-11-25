import type { Metadata } from "next";
import { toolMeta } from "@/lib/site";
import ToolSchema from "@/components/ToolSchema";
import Dashboard from "@/components/Dashboard";

export const metadata: Metadata = toolMeta("/dashboard");

export default function Page() {
  return (
    <>
      <ToolSchema path="/dashboard" />
      <Dashboard />
    </>
  );
}
