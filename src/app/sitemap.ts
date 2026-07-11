import type { MetadataRoute } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://oddspadi.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  return [
    {
      url: `${siteUrl}/`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 1
    },
    {
      url: `${siteUrl}/live-scores`,
      lastModified: now,
      changeFrequency: "always",
      priority: 0.9
    },
    {
      url: `${siteUrl}/predictions`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9
    },
    {
      url: `${siteUrl}/predictions/value-picks`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.8
    },
    {
      url: `${siteUrl}/predictions/history`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.6
    },
    {
      url: `${siteUrl}/predictions/decision-engine`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.5
    }
  ];
}
