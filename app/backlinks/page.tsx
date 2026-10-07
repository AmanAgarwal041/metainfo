import type { Metadata } from "next";
import Backlinks from "@/components/research/Backlinks";

export const metadata: Metadata = { title: "Backlinks" };

export default function Page() {
  return <Backlinks />;
}
