import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getNewsStory, getNewsStories } from "@/lib/editorial/news";

export const revalidate = 21_600;

export async function generateStaticParams() { return (await getNewsStories()).map(({ slug }) => ({ slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const story = await getNewsStory((await params).slug);
  return story ? {
    title: story.title,
    description: story.excerpt,
    alternates: { canonical: `/news/${story.slug}` },
    openGraph: { type: "article", title: story.title, description: story.excerpt, publishedTime: story.publishedAt, modifiedTime: story.updatedAt ?? story.publishedAt }
  } : {};
}

export default async function StoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const story = await getNewsStory((await params).slug);
  if (!story) notFound();
  const articleJsonLd = { "@context": "https://schema.org", "@type": "NewsArticle", headline: story.title, datePublished: story.publishedAt, dateModified: story.updatedAt ?? story.publishedAt, description: story.excerpt, mainEntityOfPage: `https://oddspadi.com/news/${story.slug}`, author: { "@type": "Organization", name: "OddsPadi" }, publisher: { "@type": "Organization", name: "OddsPadi", url: "https://oddspadi.com" }, citation: story.sources?.map(source => source.url) ?? [] };
  return <main id="main" className="container story-page">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd) }} />
    <Link className="text-link" href="/news">← Back to the Matchday Desk</Link>
    <article className="story-article">
      <div className="story-meta"><span>{story.category}</span><span>{story.sport}</span><time dateTime={story.publishedAt}>{story.publishedAt.slice(0, 10)}</time><span>{story.readMinutes} min read</span>{story.revision ? <span>Revision {story.revision}</span> : null}</div>
      <h1>{story.title}</h1><p className="story-dek">{story.excerpt}</p>
      {story.sourceAsOf ? <p className="small muted">Engine evidence checked {new Date(story.sourceAsOf).toLocaleString()}.</p> : null}
      {story.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      {story.sources?.length ? <section className="story-sources"><h2>Sources</h2>{story.sources.map(source => <a href={source.url} target={source.url.startsWith("/") ? undefined : "_blank"} rel="noreferrer" key={source.url}>{source.label}<span>Checked {source.checkedAt}</span></a>)}</section> : null}
      <aside className="story-cta"><strong>See the live evidence</strong><p>Open today's predictions to compare model probabilities, prices and decision status.</p><Link className="button primary" href="/predictions">View predictions</Link></aside>
    </article>
  </main>;
}
