import type { Metadata } from "next";
import { pageMeta } from "@/lib/site";
import Login from "@/components/Login";

export const metadata: Metadata = pageMeta("/login", "Sign in", "Sign in to sync MetaInfo projects, scan history and tracking across devices and share them with your team.", { index: false });

export default function Page() {
  return <Login />;
}
