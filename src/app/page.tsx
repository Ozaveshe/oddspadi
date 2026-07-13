import type { Metadata } from "next";
import Link from "next/link";
import { LiveTicker } from "@/components/live/LiveTicker";
import { LocalTime } from "@/components/odds/LocalTime";
import { MatchCard } from "@/components/odds/MatchCard";
import { ResponsibleUseNotice } from "@/components/odds/PredictionDisclaimer";
import { ValuePickCard } from "@/components/odds/ValuePickCard";
import { fetchLiveScoreBoard } from "@/lib/sports/liveScoreBoard";
import { getValuePicks, sports, todayIsoDate } from "@/lib/sports/service";
import { getCachedPredictionsPageData } from "@/lib/sports/prediction/cachedPublicReads";
import { toPredictionListRow, type PredictionListRow } from "@/lib/sports/prediction/listRow";
import { getNewsStories } from "@/lib/editorial/news";
import { getPublicPredictionHistory, type PublicPredictionHistory } from "@/lib/sports/prediction/history";
import { YourTeamsStrip } from "@/components/account/YourTeamsStrip";
import { RecordStrip } from "@/components/odds/RecordStrip";

// The live ticker refreshes through /api/live after hydration; cache the heavier
// prediction/editorial shell so a homepage view does not fan out to providers.
export const revalidate = 60;

export const metadata: Metadata = {
  title: "OddsPadi — Live Scores, Sports Predictions & Matchday News",
  description:
    "Live scores and transparent football, basketball and tennis predictions, plus results and matchday news for fans across Africa and beyond.",
  alternates: { canonical: "/" }
};

const sportEmoji: Record<string, string> = {
  football: "⚽",
  basketball: "🏀",
  tennis: "🎾",
  cricket: "🏏",
  rugby: "🏉",
  handball: "🤾"
};

const faqs = [
  {
    q: "Are OddsPadi predictions guaranteed?",
    a: "No — and be careful with anyone who says theirs are. Football is uncertain by nature. What we do is show you where the numbers look favourable, how confident the model is, and how risky each pick is, so you can decide with clear eyes."
  },
  {
    q: "How does OddsPadi make its predictions?",
    a: "Our AI engine compares real bookmaker odds with its own estimated probabilities, built from team strength, form, and match context. When the model's probability beats the bookmaker's implied probability after removing their margin, that's value — and that's what we flag."
  },
  {
    q: "Is OddsPadi free to use?",
    a: "Yes. Live scores, predictions, value picks, and the full analysis behind every pick are free."
  },
  {
    q: "Which leagues does OddsPadi cover?",
    a: "Live scores cover leagues worldwide — including the Premier League, Champions League, CAF competitions, and top African leagues. Deep AI analysis starts with the Premier League and is expanding league by league."
  },
  {
    q: "Can I place bets on OddsPadi?",
    a: "No. OddsPadi is analysis only — we don't take bets, hold money, or process payments. If you choose to bet elsewhere, you must be 18+ and should only stake what you can afford to lose."
  }
];

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a }
  }))
};

/**
 * The home page must render fast even when upstream sports providers are
 * slow or cold: give each data source a time budget and fall back to the
 * friendly empty states (the live ticker re-fetches client-side anyway).
 */
function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    promise.catch(() => fallback),
    new Promise<T>((resolve) => {
      const timer = setTimeout(() => resolve(fallback), ms);
      if (typeof timer === "object" && "unref" in timer) timer.unref();
    })
  ]);
}

export default async function HomePage() {
  const date = todayIsoDate();
  const unavailableLedger: PublicPredictionHistory = { items: [], source: "unavailable", reason: "Results timed out.", generatedAt: new Date().toISOString() };
  const emptyRows: PredictionListRow[] = [];
  // Sport snapshots come from the durable predictions-page cache, so the
  // homepage shares one provider fan-out per sport with /predictions instead
  // of triggering its own.
  const [football, basketball, tennis, valuePickRows, liveBoard, ledger, newsStories] = await Promise.all([
    withTimeout(getCachedPredictionsPageData(date, "football").then((data) => data.rows), 5_000, emptyRows),
    withTimeout(getCachedPredictionsPageData(date, "basketball").then((data) => data.rows), 5_000, emptyRows),
    withTimeout(getCachedPredictionsPageData(date, "tennis").then((data) => data.rows), 5_000, emptyRows),
    withTimeout(getValuePicks(date, "football", "preview", "preview"), 5_000, []),
    withTimeout(fetchLiveScoreBoard(), 5_000, null),
    withTimeout(getPublicPredictionHistory(), 4_000, unavailableLedger),
    getNewsStories()
  ]);
  const valuePicks = valuePickRows.map(toPredictionListRow);
  // Prefer a 2-1-1 football/basketball/tennis mix, but keep filling to four
  // from whichever sports actually have fixtures — in the European off-season
  // a football-first slice left the panel nearly empty.
  const preferred = [...football.slice(0, 2), ...basketball.slice(0, 1), ...tennis.slice(0, 1)];
  const backfill = [...football.slice(2), ...basketball.slice(1), ...tennis.slice(1)];
  const predictions = [...preferred, ...backfill].slice(0, 4);
  const predictionsArePreview = predictions.length > 0 && predictions.every(row => row.match.dataSource?.kind === "mock");
  const teamMatches = [
    ...predictions.map(({ match }) => ({ id: match.id, href: `/predictions/${encodeURIComponent(match.id)}`, home: match.homeTeam.name, away: match.awayTeam.name, kickoff: match.kickoffTime, sport: match.sport })),
    ...(liveBoard?.fixtures ?? []).map((fixture) => ({ id: String(fixture.id), href: fixture.analysis ? `/predictions/${encodeURIComponent(fixture.matchId)}` : "/live-scores", home: fixture.home.name, away: fixture.away.name, kickoff: fixture.kickoff, sport: fixture.sport }))
  ];

  return (
    <main id="main" className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />

      <section className="hero">
        <div>
          <span className="section-kicker">Live scores · Multi-sport predictions · Matchday news</span>
          <h1>
            Your matchday, <span className="accent">properly covered</span>.
          </h1>
          <p>
            Follow more live football, open today&apos;s football, basketball and tennis analysis, and check every stored
            result after the final whistle. The numbers are explained, uncertainty stays visible, and the story keeps moving.
          </p>
          <div className="actions">
            <Link className="button primary" href="/predictions">
              See today&apos;s predictions
            </Link>
            <Link className="button" href="/live-scores">
              Watch live scores
            </Link>
          </div>
          <div className="hero-stats">
            <div className="hero-stat">
              <strong>{liveBoard ? liveBoard.counts.live : "—"}</strong>
              <span>matches live now</span>
            </div>
            <div className="hero-stat">
              <strong>3</strong>
              <span>sports analysed</span>
            </div>
            <div className="hero-stat">
              <strong>100%</strong>
              <span>results shown, wins &amp; losses</span>
            </div>
          </div>
        </div>
        <div className="panel hero-panel">
          <div className="panel-header">
            <div>
              <h2>Today&apos;s top matches</h2>
              <p className="muted small">{predictionsArePreview ? "Prediction lab preview · seeded fixtures, not live picks." : "Probabilities, odds, confidence & risk — at a glance."}</p>
            </div>
            <Link className="button small-btn" href="/predictions">
              View all
            </Link>
          </div>
          {predictions.length ? (
            <div className="match-list">
              <MatchCard
                key={predictions[0].match.id}
                match={predictions[0].match}
                prediction={predictions[0].prediction}
              />
              {predictions.length > 1 ? (
                <div className="mini-match-list">
                  {predictions.slice(1, 4).map((row) => (
                    <Link
                      className="mini-match"
                      key={row.match.id}
                      href={`/predictions/${row.match.id}`}
                      aria-label={`${row.match.homeTeam.name} v ${row.match.awayTeam.name} prediction`}
                    >
                      <span className="mm-time">
                        <LocalTime iso={row.match.kickoffTime} />
                      </span>
                      <span className="mm-teams">
                        {row.match.homeTeam.name} v {row.match.awayTeam.name}
                      </span>
                      <span className={`badge ${row.prediction.bestPick.hasValue ? "positive" : "no-value"}`}>
                        {row.prediction.bestPick.hasValue ? "Value" : "No value"}
                      </span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="empty-state">
              <div className="empty-emoji" aria-hidden="true">
                📋
              </div>
              <h2>No fixtures loaded yet</h2>
              <p className="muted">Today&apos;s matches appear here as kickoff nears — check back shortly.</p>
            </div>
          )}
        </div>
      </section>

      <YourTeamsStrip matches={teamMatches} />

      <section className="section" id="live">
        <div className="section-title">
          <div>
            <span className="section-kicker">
              Happening now <span className="nav-live-dot" aria-hidden="true" />
            </span>
            <h2>Live &amp; next up</h2>
          </div>
          <Link className="button small-btn" href="/live-scores">
            Full live scores
          </Link>
        </div>
        <LiveTicker initial={liveBoard} />
      </section>

      <section className="section grid-2">
        <div>
          <div className="section-title">
            <div>
              <span className="section-kicker">Where the numbers smile</span>
              <h2>Today&apos;s value picks</h2>
            </div>
            <Link className="button small-btn" href="/predictions/value-picks">
              Open value picks
            </Link>
          </div>
          <div className="match-list">
            {valuePicks.slice(0, 3).map((row) => (
              <ValuePickCard key={row.match.id} match={row.match} prediction={row.prediction} />
            ))}
            {!valuePicks.length ? (
              <div className="empty-state">
                <div className="empty-emoji">🧐</div>
                <h2>No value picks right now</h2>
                <p className="muted">
                  When the edge isn&apos;t clear, we say so. We&apos;d rather show you nothing than force a pick.
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <div>
          <div className="section-title">
            <div>
              <span className="section-kicker">Simple, honest process</span>
              <h2>How OddsPadi works</h2>
            </div>
          </div>
          <div className="match-list">
            <div className="step-card">
              <span className="step-num">1</span>
              <h3>We read the market</h3>
              <p>Real odds from real bookmakers, updated through the day — plus form, strength, and match context.</p>
            </div>
            <div className="step-card">
              <span className="step-num">2</span>
              <h3>We run the numbers</h3>
              <p>
                Our AI engine estimates fair probabilities for every outcome and strips out the bookmaker&apos;s margin
                to find genuine value.
              </p>
            </div>
            <div className="step-card">
              <span className="step-num">3</span>
              <h3>We tell you straight</h3>
              <p>
                Every pick comes with confidence, risk, and a plain-language explanation. If there&apos;s no value, we
                say &ldquo;no pick today&rdquo; — simple.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-title">
          <div>
            <span className="section-kicker">More than football</span>
            <h2>Sports on OddsPadi</h2>
          </div>
        </div>
        <div className="sports-row">
          {sports.map((sport) => (
            <div className="sport-tile" aria-disabled={!sport.active} key={sport.id}>
              <span className="sport-emoji" aria-hidden="true">
                {sportEmoji[sport.id] ?? "🏅"}
              </span>
              <strong>{sport.label}</strong>
              <div className="small muted">{sport.active ? "Live now" : "Coming soon"}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-title"><div><span className="section-kicker">Engine ledger</span><h2>Recent picks and results</h2></div><Link className="button small-btn" href="/predictions/history">Open full results</Link></div>
        <RecordStrip items={ledger.items} compact />
        <div className="ledger-home">
          <aside><span className={`badge ${ledger.source === "live" ? "positive" : "no-value"}`}>{ledger.source === "live" ? "Repository connected" : "Repository unavailable"}</span><p>{ledger.source === "live" ? "Every stored win, loss, push and void remains inspectable." : "No sample record is substituted while the public repository cannot be read."}</p></aside>
          <div className="ledger-list">{ledger.items.slice(0,5).map(item => <article key={item.id}><span className={`badge ${item.result === "won" ? "positive" : item.result === "lost" ? "no-value" : "scheduled"}`}>{item.result}</span><div><strong>{item.match}</strong><small>{item.sport} · {item.pick} · {item.date}</small></div></article>)}
          {!ledger.items.length ? <div className="empty-state compact"><h3>No results substituted</h3><p className="muted">{ledger.reason ?? "The engine has not stored public outcomes yet."} Seeded preview matches never appear here.</p></div> : null}</div>
        </div>
      </section>

      <section className="section">
        <div className="trust-strip">
          <div className="trust-item">
            <span className="ti-icon" aria-hidden="true">
              🚫
            </span>
            <div>
              <strong>No fake &ldquo;sure odds&rdquo;</strong>
              <span>If we&apos;re not confident, we tell you. Abstaining is a feature, not a bug.</span>
            </div>
          </div>
          <div className="trust-item">
            <span className="ti-icon" aria-hidden="true">
              📖
            </span>
            <div>
              <strong>Losses shown too</strong>
              <span>
                Our <Link className="inline-link" href="/predictions/history">results page</Link> keeps every outcome —
                wins and losses.
              </span>
            </div>
          </div>
          <div className="trust-item">
            <span className="ti-icon" aria-hidden="true">
              🤖
            </span>
            <div>
              <strong>Real AI, real data</strong>
              <span>Every pick passes through a decision engine with dozens of checks before it reaches you.</span>
            </div>
          </div>
          <div className="trust-item">
            <span className="ti-icon" aria-hidden="true">
              🆓
            </span>
            <div>
              <strong>Free to use</strong>
              <span>Live scores, predictions, and full analysis — no paywall, no signup wall.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="section season-outlook">
        <div className="section-title">
          <div><span className="section-kicker">The next campaign starts now</span><h2>Upcoming season outlooks</h2></div>
          <Link className="button small-btn" href="/season-outlooks">Open season predictions</Link>
        </div>
        <div className="grid-3">
          <article className="step-card"><span className="step-num">01</span><h3>Baseline</h3><p>Historical strength and confirmed schedules establish the first forecast range.</p></article>
          <article className="step-card"><span className="step-num">02</span><h3>Squad watch</h3><p>Transfers, injuries and manager changes revise the outlook as evidence arrives.</p></article>
          <article className="step-card"><span className="step-num">03</span><h3>Match-ready</h3><p>Fixture-level predictions publish when teams, timing and usable market prices are confirmed.</p></article>
        </div>
      </section>

      <section className="section">
        <div className="section-title"><div><span className="section-kicker">The Matchday Desk</span><h2>Fresh from OddsPadi</h2></div><Link className="button small-btn" href="/news">All news</Link></div>
        <div className="news-grid">
          {newsStories.slice(0, 2).map((story) => <article className="news-card" key={story.slug}>
            <div className="story-meta"><span>{story.category}</span><span>{story.sport}</span></div>
            <h2><Link href={`/news/${story.slug}`}>{story.title}</Link></h2><p>{story.excerpt}</p>
            <Link className="text-link" href={`/news/${story.slug}`}>Read story →</Link>
          </article>)}
        </div>
      </section>

      <section className="section" id="faq">
        <div className="section-title">
          <div>
            <span className="section-kicker">Questions people ask</span>
            <h2>Quick answers</h2>
          </div>
        </div>
        <div className="faq-list">
          {faqs.map((item) => (
            <details className="fold" key={item.q}>
              <summary>{item.q}</summary>
              <div className="fold-body">
                <p className="muted" style={{ margin: 0 }}>
                  {item.a}
                </p>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="section">
        <ResponsibleUseNotice />
      </section>
    </main>
  );
}
