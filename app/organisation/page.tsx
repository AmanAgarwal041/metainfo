import type { Metadata } from "next";
import { pageMeta } from "@/lib/site";
import Organisation from "@/components/Organisation";

export const metadata: Metadata = pageMeta("/organisation", "Organisation", "Manage your MetaInfo team workspace and members.", { index: false });

export default function Page() {
  return <Organisation />;
}
