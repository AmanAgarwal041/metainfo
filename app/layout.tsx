import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MetaInfo — SEO & AI visibility scanner",
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
      <body>{children}</body>
    </html>
  );
}
