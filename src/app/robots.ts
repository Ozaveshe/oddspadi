import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo/pageMetadata";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // `/offline` is the service worker's fallback shell and `/tips` is a
        // permanent alias for `/predictions/today`; neither should be crawled
        // as a page in its own right.
        disallow: ["/api/", "/account", "/offline", "/tips"]
      }
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl
  };
}