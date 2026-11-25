import type { Metadata, Viewport } from "next";
import { Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import Shell from "@/components/Shell";
import { ClerkAccounts, NoAccounts } from "@/lib/account";
import { DESCRIPTION, REPO, SITE_NAME, SITE_URL } from "@/lib/site";
import { THEME_BOOT } from "@/lib/theme";
import "./globals.css";

const sans = Hanken_Grotesk({ subsets: ["latin"], variable: "--font-hanken", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "MetaInfo: SEO and AI visibility", template: "%s | MetaInfo" },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: REPO }],
  creator: SITE_NAME,
  openGraph: { type: "website", siteName: SITE_NAME, locale: "en_US", images: [{ url: "/og.png", width: 1200, height: 630, alt: "MetaInfo: SEO and AI visibility" }] },
  twitter: { card: "summary_large_image", images: ["/og.png"] },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7fa" },
    { media: "(prefers-color-scheme: dark)", color: "#121317" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body>
        {/* Sign-in is optional: without a Clerk key the app runs anonymous-only. */}
        {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
          <ClerkProvider afterSignOutUrl="/dashboard">
            <ClerkAccounts>
              <Shell>{children}</Shell>
            </ClerkAccounts>
          </ClerkProvider>
        ) : (
          <NoAccounts>
            <Shell>{children}</Shell>
          </NoAccounts>
        )}
      </body>
    </html>
  );
}
