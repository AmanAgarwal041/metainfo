import type { Metadata } from "next";
import AiVisibility from "@/components/research/AiVisibility";

export const metadata: Metadata = { title: "AI visibility" };

export default function Page() {
  return <AiVisibility />;
}
