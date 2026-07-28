import { describe, expect, it } from "vitest";
import { dynamic as rssDynamic, GET as getRss } from "@/app/news/rss.xml/route";
import { dynamic as jsonFeedDynamic, GET as getJsonFeed } from "@/app/news/feed.json/route";
import { getNewsStories, isSafeGeneratedEditorialFingerprint, newsStories } from "@/lib/editorial/news";

describe("Matchday Desk syndication feeds", () => {
  it("renders database-backed feeds at request time", () => {
    expect(rssDynamic).toBe("force-dynamic");
    expect(jsonFeedDynamic).toBe("force-dynamic");
  });

  it("publishes the July 22 UEFA qualifying desk without turning needs-data rows into picks", () => {
    const story = newsStories.find((item) => item.slug === "uefa-qualifying-july-22-matchday-desk");
    expect(newsStories[0]?.slug).toBe("uefa-qualifying-july-22-matchday-desk");
    expect(story?.revision).toBe(1);
    expect(story?.publishedAt).toBe("2026-07-22");
    expect(story?.sourceAsOf).toBe("2026-07-22T08:28:31.260965Z");
    expect(story?.sources?.every((source) => source.checkedAt === "2026-07-22")).toBe(true);
    expect(story?.body.join(" ")).toContain("10 provider rows for those nine ties");
    expect(story?.body.join(" ")).toContain("nine fresh API-Football summaries were all needs-data records");
    expect(story?.body.join(" ")).toContain("canonical public-pick ledger remained empty");
  });

  it("publishes the World Cup final desk from matching stored fixtures without inventing a pick", () => {
    const story = newsStories.find((item) => item.slug === "spain-argentina-world-cup-final-matchday-desk");
    expect(story?.revision).toBe(1);
    expect(story?.publishedAt).toBe("2026-07-19");
    expect(story?.sourceAsOf).toBe("2026-07-19T06:36:19.178934Z");
    expect(story?.sources?.every((source) => source.checkedAt === "2026-07-19")).toBe(true);
    expect(story?.body.join(" ")).toContain("Spain face Argentina");
    expect(story?.body.join(" ")).toContain("two provider records for the same final");
    expect(story?.body.join(" ")).toContain("no model selection");
  });

  it("keeps the Summer League championship revision source-dated and honest about duplicate provider rows", () => {
    const story = newsStories.find((item) => item.slug === "basketball-summer-league-matchday-watchlist");
    expect(story?.revision).toBe(9);
    expect(story?.updatedAt).toBe("2026-07-19");
    expect(story?.sourceAsOf).toBe("2026-07-19T06:36:45.442173Z");
    expect(story?.sources?.every((source) => source.checkedAt === "2026-07-19")).toBe(true);
    expect(story?.body.join(" ")).toContain("Memphis-Golden State");
    expect(story?.body.join(" ")).toContain("representing those three matchups rather than five separate games");
    expect(story?.body.join(" ")).toContain("None had a published decision, attached prediction outcome or canonical public pick");
  });

  it("keeps curated desk stories available when the public database is not configured", async () => {
    expect(await getNewsStories()).toEqual(newsStories);
  });

  it("suppresses legacy generated stories sourced from the paper-only outcome projection", () => {
    expect(isSafeGeneratedEditorialFingerprint("fnv1a-c0347dde")).toBe(false);
    expect(isSafeGeneratedEditorialFingerprint("template-v2-fnv1a-3cbbad8b")).toBe(false);
    expect(isSafeGeneratedEditorialFingerprint("canonical-v1-fnv1a-c0347dde")).toBe(true);
    expect(isSafeGeneratedEditorialFingerprint("fixture-desk-fnv1a-42e9aaef")).toBe(true);
  });

  it("publishes every story through valid RSS-shaped XML", async () => {
    const response = await getRss();
    const body = await response.text();
    expect(response.headers.get("content-type")).toContain("application/rss+xml");
    expect(body).toContain('<rss version="2.0"');
    expect((body.match(/<item>/g) ?? [])).toHaveLength(newsStories.length);
    const guids = [...body.matchAll(/<guid isPermaLink="true">([^<]+)<\/guid>/g)].map((match) => match[1]);
    expect(new Set(guids).size).toBe(newsStories.length);
    for (const story of newsStories) expect(body).toContain(`/news/${story.slug}`);
  });

  it("publishes every story through JSON Feed 1.1", async () => {
    const response = await getJsonFeed();
    const body = await response.json() as { version: string; items: Array<{ id: string; url: string }> };
    expect(body.version).toBe("https://jsonfeed.org/version/1.1");
    expect(body.items).toHaveLength(newsStories.length);
    expect(new Set(body.items.map((item) => item.id)).size).toBe(newsStories.length);
    expect(new Set(body.items.map((item) => item.url)).size).toBe(newsStories.length);
  });
});
