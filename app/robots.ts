import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";

// Every crawler, search and AI alike, may read the public pages. The API and account pages stay out.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/settings", "/organisation", "/login"] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
