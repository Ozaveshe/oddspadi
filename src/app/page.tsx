import type { Metadata } from "next";
import Link from "next/link";
import { LiveTicker } from "@/components/live/LiveTicker";
import { SlateFixtureCard } from "@/components/odds/IntelligenceSlate";
import { ResponsibleUseNotice } from "@/components/odds/PredictionDisclaimer";
import { fetchLiveScoreBoard } from "@/lib/sports/liveScoreBoard";
import { getDailyTipsProduct, getWeeklyTipsProduct, getYesterdayResultsProduct } from "@/lib/sports/tips/product";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "OddsPadi — Daily Tips, Live Scores & Transparent Results",
  description: "Daily provider-backed fixtures, plain-language sports predictions, live scores and transparent public results for fans in Nigeria, Africa and beyond.",
  alternates: { canonical: "/" },
  openGraph: {
    title: "OddsPadi — Your padi for smarter match reads",
    description: "Daily fixtures, model probabilities, odds value, live scores and transparent results in plain language.",
    url: "/"
  }
};

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      const timer = setTimeout(() => resolve(fallback), ms);
      if (typeof timer === "object" && "unref" in timer) timer.unref();
    })
  ]);
}
function weekdayLabel(date: string, firstDate: string): string {
  if (date === firstDate) return "Today";
  const tomorrow = new Date(`${firstDate}T00:00:00.000Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  if (date === tomorrow.toISOString().slice(0, 10)) return "Tomorrow";
  return new Date(`${date}T12:00:00.000Z`).toLocaleDateString([], { weekday: "short" });
}

export default async function HomePage() {
  const [daily, weekly, yesterday, liveBoard] = await Promise.all([
    withTimeout(getDailyTipsProduct({ ensure: false }), 2_500, null),
    withTimeout(getWeeklyTipsProduct({ ensure: false }), 2_500, null),
    withTimeout(getYesterdayResultsProduct(), 2_500, null),
    withTimeout(fetchLiveScoreBoard(), 2_500, null)
  ]);
  const todayBest = daily?.sections.valuePicks[0] ?? daily?.sections.leans[0] ?? daily?.sections.watchlist[0] ?? null;
  const tipsPreview = daily
    ? [...daily.sections.valuePicks, ...daily.sections.leans, ...daily.sections.watchlist, ...daily.sections.noPicks, ...daily.sections.schedule]
        .filter((row, index, rows) => rows.findIndex((candidate) => candidate.fixture.fixtureId === row.fixture.fixtureId) === index)
        .slice(0, 3)
    : [];
  const providerStatus = daily?.slate.provider.status ?? "unavailable";
  const lastRun = daily?.slate.provider.lastRun?.finishedAt;

  return (
    <main id="main" className="container home-product">
      <section className="hero home-hero">
        <div>
          <span className="section-kicker">Daily match intelligence · built for clear decisions</span>
          <h1>Your padi for <span className="accent">smarter match reads.</span></h1>
          <p>Daily fixtures, model probabilities, odds value, live scores, and transparent results — all in plain language.</p>
          <div className="actions">
            <Link className="button primary" href="/predictions/today">Today&apos;s Tips</Link>
            <Link className="button" href="/live-scores">Live Scores</Link>
          </div>
          <p className="home-hero-note">Useful from Lagos to London: provider-backed data, visible uncertainty, no sample matches dressed up as live sport.</p>
        </div>
        <aside className="home-matchday-brief" aria-label="Matchday at a glance">
          <span className="section-kicker">Matchday at a glance</span>
          <strong>{daily?.summary.fixturesFound ?? 0}</strong>
          <span>fixtures on today&apos;s provider slate</span>
          <div><span>{liveBoard?.counts.live ?? 0} live now</span><span>{daily?.summary.fixturesAnalysed ?? 0} analysed</span></div>
          <Link className="text-link" href="/predictions/today">Open the full schedule →</Link>
        </aside>
      </section>

      <section className="home-engine-strip" aria-label="Latest engine status">
        <div><span>Fixtures scanned</span><strong>{daily?.summary.fixturesAnalysed ?? 0}</strong></div>
        <div><span>Tips published</span><strong>{daily?.summary.valuePicks ?? 0}</strong></div>
        <div><span>Watchlist</span><strong>{daily?.summary.watchlist ?? 0}</strong></div>
        <div><span>Last run</span><strong>{lastRun ? new Date(lastRun).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Waiting"}</strong></div>
        <div><span>Provider health</span><strong className={`engine-health status-${providerStatus}`}>{providerStatus}</strong></div>
      </section>

      <section className="section home-today-best">
        <div className="section-title"><div><span className="section-kicker">Today&apos;s Best</span><h2>The clearest read right now</h2></div><Link className="button small-btn" href="/predictions/today">All tips</Link></div>
        {todayBest ? <SlateFixtureCard row={todayBest} asOf={daily?.generatedAt} /> : <div className="empty-state"><h3>No decision highlight is ready yet</h3><p className="muted">The full provider schedule and no-pick explanations remain available. OddsPadi will not force a selection to fill this space.</p><Link className="button small-btn" href="/predictions/today">See today&apos;s schedule</Link></div>}
      </section>

      <section className="section">
        <div className="section-title"><div><span className="section-kicker">Daily Tips Preview</span><h2>Three matches worth opening</h2></div><Link className="text-link" href="/predictions/today">View all daily tips →</Link></div>
        {tipsPreview.length ? <div className="intelligence-grid home-tips-preview">{tipsPreview.map((row) => <SlateFixtureCard key={row.fixture.fixtureId} row={row} compact asOf={daily?.generatedAt} />)}</div> : <div className="empty-state compact"><h3>The daily board is waiting for provider data</h3><p className="muted">Provider health is shown above. No seeded cards are substituted.</p></div>}
      </section>

      <section className="section" id="live">
        <div className="section-title"><div><span className="section-kicker">Live Now <span className="nav-live-dot" aria-hidden="true" /></span><h2>Scores as they happen</h2></div><Link className="button small-btn" href="/live-scores">Full live board</Link></div>
        <LiveTicker initial={liveBoard} />
      </section>

      <section className="section home-results-summary">
        <div className="section-title"><div><span className="section-kicker">Yesterday&apos;s Results</span><h2>Wins and losses stay visible</h2></div><Link className="button small-btn" href="/predictions/history">Open results</Link></div>
        <div className="home-results-grid">
          <div><strong>{yesterday?.summary.wins ?? 0}</strong><span>Wins</span></div>
          <div><strong>{yesterday?.summary.losses ?? 0}</strong><span>Losses</span></div>
          <div><strong>{yesterday?.summary.pending ?? 0}</strong><span>Pending</span></div>
          <div><strong>{yesterday?.summary.manualReview ?? 0}</strong><span>Manual review</span></div>
        </div>
        <p className="muted small">{yesterday?.source === "unavailable" ? yesterday.reason : yesterday?.items.length ? `${yesterday.summary.settled} published picks settled yesterday.` : "No published picks settled yesterday. Internal model runs do not appear here."}</p>
      </section>

      <section className="section home-weekly-radar">
        <div className="section-title"><div><span className="section-kicker">Weekly Radar</span><h2>The next seven days</h2></div><Link className="button small-btn" href="/predictions/week">Open weekly predictions</Link></div>
        <p>Weekly predictions start preliminary and get refreshed as odds, injuries, lineups, and results change.</p>
        <div className="home-week-days">
          {(weekly?.days ?? []).map((day) => <Link href="/predictions/week" key={day.date}><span>{weekdayLabel(day.date, weekly?.slate.range.from ?? day.date)}</span><strong>{day.fixtures.length}</strong><small>{day.counts.valuePick} value · {day.counts.ready} ready</small></Link>)}
        </div>
      </section>

      <section className="section home-how">
        <div className="section-title"><div><span className="section-kicker">How OddsPadi works</span><h2>Read the match in three moves</h2></div></div>
        <ol>
          <li><span>1</span><div><h3>Scan the full schedule</h3><p>Every available provider fixture enters the daily board.</p></div></li>
          <li><span>2</span><div><h3>Compare chances and price</h3><p>The model estimates the outcome, then compares it with the bookmaker&apos;s fair chance.</p></div></li>
          <li><span>3</span><div><h3>Publish or abstain</h3><p>Value picks, leans, watchlists and no-pick reasons remain clearly separate.</p></div></li>
        </ol>
      </section>

      <section className="section home-responsible"><ResponsibleUseNotice /></section>
    </main>
  );
}
