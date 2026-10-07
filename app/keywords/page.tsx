import type { Metadata } from "next";
import Keywords from "@/components/research/Keywords";

export const metadata: Metadata = { title: "Keyword research" };

export default function Page() {
  return <Keywords />;
}
