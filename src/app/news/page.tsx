import type { Metadata } from "next";
import Link from "next/link";
import { getNewsStories } from "@/lib/editorial/news";
import { getSupabasePublicReadClient } from "@/lib/supabase/publicReadClient";

export const revalidate = 21_600;

export const metadata: Metadata = {
  title: "Sports news, match previews and season outlooks",
  description: "OddsPadi matchday briefings, sports prediction explainers and upcoming-season outlooks for football, basketball and tennis.",
  alternates: {
    canonical: "/news",
    types: {
      "application/rss+xml": "/news/rss.xml",
      "application/feed+json": "/news/feed.json"
    }
  }
};

type WeeklyRecap = { week_start: string; week_end: string; graded_count: number; wins: number; losses: number; pushes: number; voids: number; accuracy: number | string; roi: number | string; best_call: string | null };
async function weeklyRecaps(): Promise<WeeklyRecap[]> { const db = getSupabasePublicReadClient(); if (!db) return []; const { data } = await db.from("op_weekly_prediction_recaps").select("week_start,week_end,graded_count,wins,losses,pushes,voids,accuracy,roi,best_call").order("week_start", { ascending: false }).limit(6); return (data ?? []) as WeeklyRecap[]; }

export default async function NewsPage() {
  const recaps = await weeklyRecaps();
  const [lead, ...rest] = await getNewsStories();
  return (
    <main id="main" className="container editorial-page">
      <header className="page-heading editorial-heading">
        <span className="section-kicker">The Matchday Desk</span>
        <h1>News that helps you <span className="accent">read the game.</span></h1>
        <p>Fresh briefings, transparent model notes, and season outlooks—built from the same evidence behind OddsPadi predictions.</p>
        <div className="editorial-feed-links" aria-label="Subscribe to Matchday Desk updates">
          <Link href="/news/rss.xml">RSS feed</Link>
          <Link href="/news/feed.json">JSON feed</Link>
        </div>
      </header>
      <section className="news-lead">
        <div className="news-lead-art" aria-hidden="true"><span>OP</span><strong>Matchday<br/>Desk</strong></div>
        <article>
          <div className="story-meta"><span>{lead.category}</span><span>{lead.sport}</span><time dateTime={lead.publishedAt}>{lead.publishedAt.slice(0, 10)}</time>{(lead.revision ?? 1) > 1 ? <span className="badge scheduled">Updated</span> : null}</div>
          <h2><Link href={`/news/${lead.slug}`}>{lead.title}</Link></h2>
          <p>{lead.excerpt}</p>
          <Link className="text-link" href={`/news/${lead.slug}`}>Read the briefing →</Link>
        </article>
      </section>
      <section className="section" aria-labelledby="weekly-recaps"><div className="section-title"><div><span className="section-kicker">No cherry-picking</span><h2 id="weekly-recaps">Weeks in review</h2></div></div>{recaps.length ? <div className="news-grid">{recaps.map((recap) => <article className="news-card" key={recap.week_start}><div className="story-meta"><span>Public record</span><time>{recap.week_start} – {recap.week_end}</time></div><h3>{recap.wins} hits, {recap.losses} misses</h3><p>{recap.graded_count} picks graded · {Math.round(Number(recap.accuracy) * 100)}% accuracy · {recap.pushes} pushes · {recap.voids} voids.</p>{recap.best_call ? <p className="small"><strong>Best call:</strong> {recap.best_call}</p> : null}<Link className="text-link" href="/predictions/history">Inspect every result →</Link></article>)}</div> : <div className="empty-state compact"><h3>First weekly recap is still forming</h3><p className="muted">We publish the complete week after settlement. No sample wins are substituted while the ledger is empty.</p></div>}</section>
      <section className="news-grid" aria-label="Latest stories">
        {rest.map((story) => <article className="news-card" key={story.slug}>
          <div className="story-meta"><span>{story.category}</span><span>{story.sport}</span>{(story.revision ?? 1) > 1 ? <span className="badge scheduled">Updated</span> : null}</div>
          <h2><Link href={`/news/${story.slug}`}>{story.title}</Link></h2>
          <p>{story.excerpt}</p>
          <div className="story-footer"><time dateTime={story.publishedAt}>{story.publishedAt.slice(0, 10)}</time><span>{story.readMinutes} min read</span></div>
        </article>)}
      </section>
    </main>
  );
}
