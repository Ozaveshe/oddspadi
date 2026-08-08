import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import { getCachedHomepageWeeklySummary } from "@/lib/sports/tips/publicReads";
import { footballLeagueRegistry } from "@/lib/sports/footballLeagues";
import { SearchBox } from "@/components/product/SearchBox";

export const revalidate = 300;

export const metadata: Metadata = pageMetadata({
  title: "Explore Fixtures, Competitions & Coverage",
  description:
    "Every way into OddsPadi: fixtures by sport and date, live scores, league tables, season outlooks, news and community — all leading to one canonical page per match.",
  path: "/explore",
  socialTitle: "Explore — OddsPadi",
  socialDescription: "Fixtures by sport, date and competition — one canonical page per match."
});

const SPORTS = [
  { id: "football", label: "Football" },
  { id: "basketball", label: "Basketball" },
  { id: "tennis", label: "Tennis" }
];

const DAY_LABELS = ["Today", "Tomorrow", "+2", "+3", "+4", "+5", "+6"];

/**
 * Explore is a hub, not a new data surface: every tile links into an existing
 * canonical route (docs/route-map.md). The only read it performs is the same
 * cached seven-day count board the homepage uses, so it stays fast and can
 * never contradict Today.
 */
export default async function ExplorePage() {
  const weekly = await getCachedHomepageWeeklySummary().catch(() => null);
  const tableLeagues = footballLeagueRegistry.filter((league) => league.tier === "top-five" || league.tier === "africa-primary");

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Explore</span>
        <h1>Every way into the <span className="accent">board</span></h1>
        <p>Fixtures by sport, date or competition; live now; tables, season outlooks, news and community. Wherever you start, each match has one page with everything the engine knows.</p>
      </div>

      <section className="section" aria-label="Search">
        <SearchBox />
      </section>

      <section className="section" aria-labelledby="explore-dates-heading">
        <div className="section-title"><div><span className="section-kicker">By date</span><h2 id="explore-dates-heading">The week ahead</h2></div><Link className="button" href="/predictions/week">Weekly radar</Link></div>
        <div className="explore-tile-row">
          <Link className="explore-tile" href="/predictions/today"><strong>{weekly?.[0]?.fixtureCount ?? "—"}</strong><span>Today</span></Link>
          <Link className="explore-tile" href="/predictions/tomorrow"><strong>{weekly?.[1]?.fixtureCount ?? "—"}</strong><span>Tomorrow</span></Link>
          {(weekly ?? []).slice(2).map((day, index) => (
            <Link className="explore-tile" href="/predictions/week" key={day.date}>
              <strong>{day.fixtureCount}</strong>
              <span>{DAY_LABELS[index + 2] ?? day.date.slice(5)}</span>
            </Link>
          ))}
        </div>
        <p className="muted small">Fixtures scheduled per day across covered sports. Counts update every few minutes.</p>
      </section>

      <section className="section" aria-labelledby="explore-sports-heading">
        <div className="section-title"><div><span className="section-kicker">By sport</span><h2 id="explore-sports-heading">Sport boards</h2></div><Link className="button" href="/live-scores">Live scores</Link></div>
        <div className="explore-tile-row">
          {SPORTS.map((sport) => (
            <Link className="explore-tile" href={`/predictions?sport=${encodeURIComponent(sport.id)}`} key={sport.id}>
              <strong>{sport.label}</strong>
              <span>Fixtures &amp; model board</span>
            </Link>
          ))}
          <Link className="explore-tile" href="/live-scores"><strong>Live</strong><span>In-play right now</span></Link>
        </div>
      </section>

      <section className="section" aria-labelledby="explore-competitions-heading">
        <div className="section-title"><div><span className="section-kicker">By competition</span><h2 id="explore-competitions-heading">Tables &amp; season outlooks</h2></div><Link className="button" href="/season-outlooks">Season outlooks</Link></div>
        <div className="explore-competition-list">
          {tableLeagues.map((league) => (
            <Link className="explore-competition" href={`/predictions/league/${encodeURIComponent(league.slug)}/table`} key={league.slug}>
              <strong>{league.name}</strong>
              <span>{league.country} · table</span>
            </Link>
          ))}
        </div>
      </section>

      <section className="section" aria-labelledby="explore-reading-heading">
        <div className="section-title"><div><span className="section-kicker">Around the matchday</span><h2 id="explore-reading-heading">Reading &amp; the crowd</h2></div></div>
        <div className="explore-tile-row">
          <Link className="explore-tile" href="/news"><strong>News</strong><span>Sports desk &amp; engine notes</span></Link>
          <Link className="explore-tile" href="/community"><strong>Community</strong><span>Feed, polls &amp; tips</span></Link>
          <Link className="explore-tile" href="/forums"><strong>Forums</strong><span>Longer conversations</span></Link>
        </div>
      </section>
    </main>
  );
}
