import type { Metadata, Viewport } from "next";
import "./globals.css";
import Nav from "@/components/Nav";

export const metadata: Metadata = {
  title: { default: "MetaInfo — SEO & AI visibility", template: "%s · MetaInfo" },
  description:
    "Scan any page the way Google, Bing, ChatGPT, Perplexity, Claude and Gemini see it. Find missing tags, crawler blocks, sitemap and robots issues, then get a prioritised fix plan and track progress.",
  icons: { icon: "/favicon.ico" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  );
}
