import type { Metadata } from "next";
import App from "@/components/App";

export const metadata: Metadata = { title: "Site audit" };

export default function Page() {
  return <App />;
}
