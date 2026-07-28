import { getNewsStories } from "@/lib/editorial/news";
import { absoluteUrl, siteUrl } from "@/lib/seo/pageMetadata";

export const dynamic = "force-dynamic";

export async function GET() {
  const newsStories = await getNewsStories();
  return Response.json({
    version: "https://jsonfeed.org/version/1.1",
    title: "OddsPadi Matchday Desk",
    home_page_url: `${siteUrl}/news`,
    feed_url: `${siteUrl}/news/feed.json`,
    description: "Sports briefings, model explainers and upcoming-season outlooks.",
    // Slugs are database values: percent-encode them so a slug containing a
    // space, `#` or `?` cannot produce an item URL that resolves elsewhere.
    items: newsStories.map((story) => ({
      id: absoluteUrl(`/news/${encodeURIComponent(story.slug)}`),
      url: absoluteUrl(`/news/${encodeURIComponent(story.slug)}`),
      title: story.title,
      summary: story.excerpt,
      content_text: story.body.join("\n\n"),
      date_published: story.publishedAt,
      date_modified: story.updatedAt ?? story.publishedAt,
      tags: [story.category, story.sport]
    }))
  }, { headers: { "Cache-Control": "public, max-age=900, stale-while-revalidate=3600" } });
}
