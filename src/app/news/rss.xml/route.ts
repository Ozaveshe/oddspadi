import { getNewsStories } from "@/lib/editorial/news";
import { absoluteUrl, siteUrl } from "@/lib/seo/pageMetadata";

// Editorial generation runs four times a day; the syndication surface should
// not remain six hours behind a successfully published desk edition.
export const dynamic = "force-dynamic";

function xml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

/**
 * Slugs are database values, so they are percent-encoded *and* XML-escaped.
 * They were previously interpolated raw while only the title, excerpt and
 * category were escaped — a single `&` in one slug produced malformed XML and
 * broke the whole feed for every subscriber, not just that one item.
 */
function storyUrl(slug: string): string {
  return xml(absoluteUrl(`/news/${encodeURIComponent(slug)}`));
}

/** An unparseable date would otherwise emit a literal "Invalid Date". */
function rfc822(value: string | null | undefined, fallback: Date): string {
  const parsed = value ? new Date(value) : null;
  return (parsed && !Number.isNaN(parsed.getTime()) ? parsed : fallback).toUTCString();
}

export async function GET() {
  const now = new Date();
  const newsStories = await getNewsStories();
  const items = newsStories.map((story) => {
    const url = storyUrl(story.slug);
    return `
    <item>
      <title>${xml(story.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${xml(story.excerpt)}</description>
      <category>${xml(story.category)}</category>
      <pubDate>${rfc822(story.publishedAt, now)}</pubDate>
    </item>`;
  }).join("");
  const body = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>OddsPadi Matchday Desk</title>
    <link>${siteUrl}/news</link>
    <description>Sports briefings, model explainers and upcoming-season outlooks.</description>
    <language>en</language>
    <lastBuildDate>${rfc822(newsStories[0]?.updatedAt ?? newsStories[0]?.publishedAt, now)}</lastBuildDate>
    <atom:link href="${siteUrl}/news/rss.xml" rel="self" type="application/rss+xml" />${items}
  </channel>
</rss>`;
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=900, stale-while-revalidate=3600" } });
}
