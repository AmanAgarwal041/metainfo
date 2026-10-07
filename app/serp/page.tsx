import type { Metadata } from "next";
import Serp from "@/components/research/Serp";

export const metadata: Metadata = { title: "SERP analysis" };

export default function Page() {
  return <Serp />;
}
