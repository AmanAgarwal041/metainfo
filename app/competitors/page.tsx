import type { Metadata } from "next";
import Competitors from "@/components/research/Competitors";

export const metadata: Metadata = { title: "Competitor analysis" };

export default function Page() {
  return <Competitors />;
}
