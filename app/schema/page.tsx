import type { Metadata } from "next";
import { toolMeta } from "@/lib/site";
import ToolSchema from "@/components/ToolSchema";
import SchemaValidator from "@/components/SchemaValidator";

export const metadata: Metadata = toolMeta("/schema");

export default function Page() {
  return (
    <>
      <ToolSchema path="/schema" />
      <SchemaValidator />
    </>
  );
}
