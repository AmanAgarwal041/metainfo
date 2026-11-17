import type { Metadata } from "next";
import TrafficGuide from "@/components/TrafficGuide";

export const metadata: Metadata = { title: "Set up Traffic" };

export default function Page() {
  return <TrafficGuide />;
}
