import type { Metadata } from "next";
import { pageMeta } from "@/lib/site";
import TrafficGuide from "@/components/TrafficGuide";

export const metadata: Metadata = pageMeta("/traffic/guide", "Set up Traffic", "Set up MetaInfo's edge collector to measure AI referral visits and AI crawler hits on your site.", { index: true });

export default function Page() {
  return <TrafficGuide />;
}
