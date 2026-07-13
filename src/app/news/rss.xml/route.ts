import { getNewsStories } from "@/lib/editorial/news";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://oddspadi.com";

export const revalidate = 21_600;

function xml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export async function GET() {
  const newsStories = await getNewsStories();
  const items = newsStories.map((story) => `
    <item>
      <title>${xml(story.title)}</title>
      <link>${siteUrl}/news/${story.slug}</link>
      <guid isPermaLink="true">${siteUrl}/news/${story.slug}</guid>
      <description>${xml(story.excerpt)}</description>
      <category>${xml(story.category)}</category>
      <pubDate>${new Date(story.publishedAt).toUTCString()}</pubDate>
    </item>`).join("");
  const body = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>OddsPadi Matchday Desk</title>
    <link>${siteUrl}/news</link>
    <description>Sports briefings, model explainers and upcoming-season outlooks.</description>
    <language>en</language>
    <atom:link href="${siteUrl}/news/rss.xml" rel="self" type="application/rss+xml" />${items}
  </channel>
</rss>`;
  return new Response(body, { headers: { "Content-Type": "application/rss+xml; charset=utf-8", "Cache-Control": "public, max-age=900, stale-while-revalidate=3600" } });
}
