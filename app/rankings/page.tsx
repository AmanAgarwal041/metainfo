import type { Metadata } from "next";
import Rankings from "@/components/research/Rankings";

export const metadata: Metadata = { title: "Rank tracking" };

export default function Page() {
  return <Rankings />;
}
