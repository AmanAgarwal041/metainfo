import type { Metadata } from "next";
import Organisation from "@/components/Organisation";

export const metadata: Metadata = { title: "Organisation" };

export default function Page() {
  return <Organisation />;
}
