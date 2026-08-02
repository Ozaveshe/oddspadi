import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getNewsStory } from "@/lib/editorial/news";
import { LocalTime } from "@/components/odds/LocalTime";
import { ShareBar } from "@/components/share/ShareBar";
import { serializeJsonLd } from "@/lib/security/jsonLd";
import { absoluteUrl, pageMetadata } from "@/lib/seo/pageMetadata";
import { verifyEditorialClaim } from "@/lib/editorial/publicationClaims";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const story = await getNewsStory((await params).slug);
  // A slug with no story 404s below; keep it out of the index rather than
  // letting the fallback metadata be crawled as a thin duplicate of the shell.
  if (!story) return { title: "Story not found", robots: { index: false, follow: true } };
  return pageMetadata({
    title: story.title,
    description: story.excerpt,
    path: `/news/${story.slug}`,
    type: "article",
    publishedTime: story.publishedAt,
    modifiedTime: story.updatedAt ?? story.publishedAt
  });
}

export default async function StoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const story = await getNewsStory((await params).slug);
  if (!story) notFound();
  // Any record claim in this story is re-checked against the ledger now, not
  // trusted from when the story was generated. A pick corrected or retracted
  // since then produces a visible notice instead of a silently stale number.
  const claimVerification = await verifyEditorialClaim(story.claim ?? null).catch(() => null);
  // URLs are derived from NEXT_PUBLIC_SITE_URL rather than hardcoded, so preview
  // and staging deploys do not publish structured data pointing at production.
  const storyUrl = absoluteUrl(`/news/${story.slug}`);
  const articleJsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: story.title,
    datePublished: story.publishedAt,
    dateModified: story.updatedAt ?? story.publishedAt,
    description: story.excerpt,
    inLanguage: "en",
    mainEntityOfPage: { "@type": "WebPage", "@id": storyUrl },
    // Google's article rich result requires a publisher logo; without it the
    // story is ineligible however complete the rest of the markup is.
    image: [absoluteUrl("/opengraph-image")],
    author: { "@type": "Organization", name: "OddsPadi", url: absoluteUrl("/") },
    publisher: {
      "@type": "Organization",
      name: "OddsPadi",
      url: absoluteUrl("/"),
      logo: { "@type": "ImageObject", url: absoluteUrl("/brand/oddspadi-icon-512-maskable.png"), width: 512, height: 512 }
    },
    citation: story.sources?.map((source) => source.url) ?? []
  };
  const breadcrumbJsonLd = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "Home", item: absoluteUrl("/") },
    { "@type": "ListItem", position: 2, name: "News", item: absoluteUrl("/news") },
    { "@type": "ListItem", position: 3, name: story.title, item: storyUrl }
  ] };
  return <main id="main" className="container story-page">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(articleJsonLd) }} />
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(breadcrumbJsonLd) }} />
    <Link className="text-link" href="/news">← Back to the Matchday Desk</Link>
    <article className="story-article">
      <div className="story-meta"><span>{story.category}</span><span>{story.sport}</span><time dateTime={story.publishedAt}>{story.publishedAt.slice(0, 10)}</time><span>{story.readMinutes} min read</span>{story.revision ? <span>Revision {story.revision}</span> : null}</div>
      <h1>{story.title}</h1><p className="story-dek">{story.excerpt}</p>
      {story.sourceAsOf ? <p className="small muted">Engine evidence checked <LocalTime iso={story.sourceAsOf} variant="datetime" />.</p> : null}
      {claimVerification?.notice ? (
        <aside className={`story-correction ${claimVerification.status}`} role="note">
          <strong>{claimVerification.status === "unverifiable" ? "Figures unverified" : "Correction notice"}</strong>
          <p>{claimVerification.notice}</p>
          <Link className="text-link" href="/track-record">Check the current record →</Link>
        </aside>
      ) : null}
      {story.body.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
      <ShareBar
        compact
        pageContext="news_story"
        title={story.title}
        text={`📰 ${story.title} — from the OddsPadi Matchday Desk:`}
        url={`/news/${encodeURIComponent(story.slug)}`}
      />
      {story.sources?.length ? <section className="story-sources"><h2>Sources</h2>{story.sources.map(source => <a href={source.url} target={source.url.startsWith("/") ? undefined : "_blank"} rel="noreferrer" key={source.url}>{source.label}<span>Checked {source.checkedAt}</span></a>)}</section> : null}
      <aside className="story-cta"><strong>See the live evidence</strong><p>Open today's predictions to compare model probabilities, prices and decision status.</p><Link className="button primary" href="/predictions">View predictions</Link></aside>
    </article>
  </main>;
}
