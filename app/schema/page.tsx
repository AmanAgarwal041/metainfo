import type { Metadata } from "next";
import SchemaValidator from "@/components/SchemaValidator";

export const metadata: Metadata = { title: "Schema validator" };

export default function Page() {
  return <SchemaValidator />;
}
