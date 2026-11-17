import type { Metadata } from "next";
import Traffic from "@/components/Traffic";

export const metadata: Metadata = { title: "Traffic" };

export default function Page() {
  return <Traffic />;
}
