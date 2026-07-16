import { getNewsStories } from "@/lib/editorial/news";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://oddspadi.com";

export const revalidate = 900;

export async function GET() {
  const newsStories = await getNewsStories();
  return Response.json({
    version: "https://jsonfeed.org/version/1.1",
    title: "OddsPadi Matchday Desk",
    home_page_url: `${siteUrl}/news`,
    feed_url: `${siteUrl}/news/feed.json`,
    description: "Sports briefings, model explainers and upcoming-season outlooks.",
    items: newsStories.map((story) => ({
      id: `${siteUrl}/news/${story.slug}`,
      url: `${siteUrl}/news/${story.slug}`,
      title: story.title,
      summary: story.excerpt,
      content_text: story.body.join("\n\n"),
      date_published: story.publishedAt,
      date_modified: story.updatedAt ?? story.publishedAt,
      tags: [story.category, story.sport]
    }))
  }, { headers: { "Cache-Control": "public, max-age=900, stale-while-revalidate=3600" } });
}
