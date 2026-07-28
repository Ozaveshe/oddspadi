import { afterEach, describe, expect, it, vi } from "vitest";
import type { NewsStory } from "@/lib/editorial/news";

function story(overrides: Partial<NewsStory> = {}): NewsStory {
  return {
    slug: "matchday-desk",
    title: "Matchday desk",
    excerpt: "A briefing.",
    category: "Briefing",
    sport: "football",
    publishedAt: "2026-07-20T06:00:00.000Z",
    updatedAt: "2026-07-20T09:00:00.000Z",
    sourceAsOf: "2026-07-20T05:55:00.000Z",
    revision: 1,
    readMinutes: 3,
    body: ["First paragraph."],
    sources: [],
    ...overrides
  } as NewsStory;
}

async function renderFeeds(stories: NewsStory[]) {
  vi.resetModules();
  vi.doMock("@/lib/editorial/news", () => ({ getNewsStories: async () => stories }));
  const [{ GET: rss }, { GET: json }] = await Promise.all([
    import("@/app/news/rss.xml/route"),
    import("@/app/news/feed.json/route")
  ]);
  return { rssBody: await (await rss()).text(), jsonBody: await (await json()).json() };
}

afterEach(() => {
  vi.doUnmock("@/lib/editorial/news");
  vi.resetModules();
});

describe("syndication feeds", () => {
  it("escapes and encodes database-supplied slugs", async () => {
    // Slugs came straight from `op_editorial_stories` and were interpolated
    // raw while only the title/excerpt/category were escaped. A single `&`
    // therefore produced malformed XML and broke the feed for every
    // subscriber, not just for the offending item.
    const { rssBody, jsonBody } = await renderFeeds([story({ slug: "arsenal-&-chelsea preview" })]);

    expect(rssBody).not.toMatch(/<link>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)/);
    expect(rssBody).toContain("arsenal-%26-chelsea%20preview");
    expect(jsonBody.items[0].url).toContain("arsenal-%26-chelsea%20preview");
    expect(jsonBody.items[0].id).toBe(jsonBody.items[0].url);
  });

  it("never emits an Invalid Date in pubDate", async () => {
    const { rssBody } = await renderFeeds([story({ publishedAt: "not-a-date" })]);

    expect(rssBody).not.toContain("Invalid Date");
    expect(rssBody).toMatch(/<pubDate>[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4}/);
  });

  it("declares a build date so readers can tell a stale feed from a fresh one", async () => {
    const { rssBody } = await renderFeeds([story()]);

    expect(rssBody).toContain("<lastBuildDate>");
    expect(rssBody).toContain(new Date("2026-07-20T09:00:00.000Z").toUTCString());
  });

  it("still escapes title, excerpt and category", async () => {
    const { rssBody } = await renderFeeds([
      story({ title: "Arsenal <b>win</b> & advance", excerpt: 'He said "yes"', category: "A & B" })
    ]);

    expect(rssBody).toContain("Arsenal &lt;b&gt;win&lt;/b&gt; &amp; advance");
    expect(rssBody).toContain("He said &quot;yes&quot;");
    expect(rssBody).toContain("A &amp; B");
  });
});
