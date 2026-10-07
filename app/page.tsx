import { redirect } from "next/navigation";
import Dashboard from "@/components/Dashboard";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Old links (/?url=…) pointed at the audit when it lived on the home page.
  const { url } = await searchParams;
  if (typeof url === "string" && url) redirect(`/audit?url=${encodeURIComponent(url)}`);
  return <Dashboard />;
}
