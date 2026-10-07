import type { Metadata } from "next";
import KeywordGap from "@/components/research/KeywordGap";

export const metadata: Metadata = { title: "Keyword gap" };

export default function Page() {
  return <KeywordGap />;
}
