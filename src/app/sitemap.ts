import type { MetadataRoute } from "next";
import { sportsProvider, todayIsoDate } from "@/lib/sports/service";
import type { Match } from "@/lib/sports/types";
import { getNewsStories } from "@/lib/editorial/news";
import { footballLeagues } from "@/lib/sports/leagueStandings";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://oddspadi.com";

/** Never let a slow/failed provider block sitemap generation. */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      const timer = setTimeout(() => resolve(fallback), ms);
      if (typeof timer === "object" && "unref" in timer) timer.unref();
    })
  ]);
}

function shiftIso(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const newsStories = await getNewsStories();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${siteUrl}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${siteUrl}/live-scores`, lastModified: now, changeFrequency: "always", priority: 0.9 },
    { url: `${siteUrl}/predictions`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${siteUrl}/predictions/value-picks`, lastModified: now, changeFrequency: "hourly", priority: 0.8 },
    { url: `${siteUrl}/predictions/history`, lastModified: now, changeFrequency: "daily", priority: 0.6 },
    { url: `${siteUrl}/predictions/decision-engine`, lastModified: now, changeFrequency: "daily", priority: 0.5 },
    { url: `${siteUrl}/predictions/bet-slip`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${siteUrl}/community`, lastModified: now, changeFrequency: "hourly", priority: 0.5 },
    { url: `${siteUrl}/forums`, lastModified: now, changeFrequency: "daily", priority: 0.5 },
    { url: `${siteUrl}/news`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${siteUrl}/season-outlooks`, lastModified: now, changeFrequency: "daily", priority: 0.8 },
    { url: `${siteUrl}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 }
  ];

  // Surface today's and tomorrow's fixtures so match pages are discoverable
  // beyond internal links. Guarded so provider hiccups can't break the sitemap.
  const today = todayIsoDate();
  const matchEntries: MetadataRoute.Sitemap = [];
  const seen = new Set<string>();
  try {
    const lists = await Promise.all(
      [today, shiftIso(today, 1)].map((date) =>
        withTimeout(sportsProvider.getFixtures(date, "football"), 4_000, [] as Match[])
      )
    );
    for (const list of lists) {
      for (const match of list) {
        if (seen.has(match.id)) continue;
        seen.add(match.id);
        matchEntries.push({
          url: `${siteUrl}/predictions/${encodeURIComponent(match.id)}`,
          lastModified: now,
          changeFrequency: "hourly",
          priority: 0.6
        });
        if (matchEntries.length >= 2_000) break;
      }
    }
  } catch {
    // Static routes still ship even if fixtures can't be fetched.
  }

  const newsEntries: MetadataRoute.Sitemap = newsStories.map((story) => ({
    url: `${siteUrl}/news/${story.slug}`,
    lastModified: new Date(story.updatedAt ?? story.publishedAt),
    changeFrequency: "daily",
    priority: 0.7
  }));
  const standingsEntries: MetadataRoute.Sitemap = footballLeagues.map((league) => ({ url: `${siteUrl}/predictions/league/${league.slug}/table`, lastModified: now, changeFrequency: "daily", priority: 0.65 }));
  return [...staticRoutes, ...standingsEntries, ...newsEntries, ...matchEntries];
}
