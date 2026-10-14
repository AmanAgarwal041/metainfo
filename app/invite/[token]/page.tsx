import type { Metadata } from "next";
import InviteAccept from "@/components/InviteAccept";

export const metadata: Metadata = { title: "Invitation" };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  return <InviteAccept token={(await params).token} />;
}
