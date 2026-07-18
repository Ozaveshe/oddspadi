import { describe, expect, it } from "vitest";
import { dynamic as rssDynamic, GET as getRss } from "@/app/news/rss.xml/route";
import { dynamic as jsonFeedDynamic, GET as getJsonFeed } from "@/app/news/feed.json/route";
import { getNewsStories, isSafeGeneratedEditorialFingerprint, newsStories } from "@/lib/editorial/news";

describe("Matchday Desk syndication feeds", () => {
  it("renders database-backed feeds at request time", () => {
    expect(rssDynamic).toBe("force-dynamic");
    expect(jsonFeedDynamic).toBe("force-dynamic");
  });

  it("keeps the current matchday revision source-dated and honest about the July 17 storage gap", () => {
    const story = newsStories.find((item) => item.slug === "basketball-summer-league-matchday-watchlist");
    expect(newsStories[0]?.slug).toBe("basketball-summer-league-matchday-watchlist");
    expect(story?.revision).toBe(7);
    expect(story?.updatedAt).toBe("2026-07-17");
    expect(story?.sourceAsOf).toBe("2026-07-17T06:35:02.214994Z");
    expect(story?.sources?.every((source) => source.checkedAt === "2026-07-17")).toBe(true);
    expect(story?.body.join(" ")).toContain("six Las Vegas Summer League consolation games");
    expect(story?.body.join(" ")).toContain("no Summer League fixture whose Las Vegas local date was July 17");
    expect(story?.body.join(" ")).toContain("published zero value picks");
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
