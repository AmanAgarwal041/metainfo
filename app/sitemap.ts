import type { MetadataRoute } from "next";
import { LAST_UPDATED, SITE_URL, TOOLS } from "@/lib/site";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, lastModified: LAST_UPDATED, changeFrequency: "weekly", priority: 1 },
    ...TOOLS.map((t) => ({ url: `${SITE_URL}${t.path}`, lastModified: LAST_UPDATED, changeFrequency: "monthly" as const, priority: t.path === "/audit" ? 0.9 : 0.7 })),
    { url: `${SITE_URL}/traffic/guide`, lastModified: LAST_UPDATED, changeFrequency: "monthly", priority: 0.5 },
  ];
}
