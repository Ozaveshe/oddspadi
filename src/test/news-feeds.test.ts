import { describe, expect, it } from "vitest";
import { GET as getRss } from "@/app/news/rss.xml/route";
import { GET as getJsonFeed } from "@/app/news/feed.json/route";
import { newsStories } from "@/lib/editorial/news";

describe("Matchday Desk syndication feeds", () => {
  it("publishes every story through valid RSS-shaped XML", async () => {
    const response = await getRss();
    const body = await response.text();
    expect(response.headers.get("content-type")).toContain("application/rss+xml");
    expect(body).toContain('<rss version="2.0"');
    expect((body.match(/<item>/g) ?? [])).toHaveLength(newsStories.length);
    for (const story of newsStories) expect(body).toContain(`/news/${story.slug}`);
  });

  it("publishes every story through JSON Feed 1.1", async () => {
    const response = await getJsonFeed();
    const body = await response.json() as { version: string; items: Array<{ id: string }> };
    expect(body.version).toBe("https://jsonfeed.org/version/1.1");
    expect(body.items).toHaveLength(newsStories.length);
    expect(new Set(body.items.map((item) => item.id)).size).toBe(newsStories.length);
  });
});
