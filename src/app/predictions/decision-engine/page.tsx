import type { Metadata } from "next";
import Link from "next/link";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import { ProviderRunStrip, SlateFixtureCard } from "@/components/odds/IntelligenceSlate";
import { getHistoricalEngineEvidence } from "@/lib/sports/performance/report";
import { getDailyTipsProduct } from "@/lib/sports/tips/product";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "Decision Engine Status",
  description: "Latest OddsPadi engine run, provider health, data coverage, recent canonical decisions and public calibration status.",
  alternates: { canonical: "/predictions/decision-engine" },
  openGraph: {
    title: "OddsPadi Decision Engine",
    description: "See the latest engine run, provider health, data coverage and canonical public decisions.",
    url: "/predictions/decision-engine"
  }
};

const jobs = [
  ["Import fixtures", "Today + next 7 days"],
  ["Refresh odds", "Freshness and price checks"],
  ["Run daily engine", "Every eligible fixture"],
  ["Generate weekly predictions", "Preliminary seven-day radar"],
  ["Settle results", "Published-pick ledger"]
] as const;

function count(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);
}

export default async function DecisionEnginePage() {
  const [product, historicalEvidence] = await Promise.all([
    getDailyTipsProduct({ ensure: false }),
    getHistoricalEngineEvidence()
  ]);
  const { slate } = product;
  const providerReadable = slate.provider.status !== "unavailable" && slate.provider.status !== "failed";
  const currentValue = (value: number) => providerReadable ? value : "—";
  const stale = slate.fixtures.filter((row) => row.publicStatus === "stale").length;
  const providerGaps = slate.fixtures.filter((row) => row.publicStatus === "needs_data" || row.publicStatus === "suspended").length;
  const coverage = providerReadable
    ? product.summary.fixturesFound ? Math.round((product.summary.fixturesAnalysed / product.summary.fixturesFound) * 100) : 0
    : null;
  const averageDataQuality = slate.fixtures.length
    ? slate.fixtures.reduce((sum, row) => sum + row.decisionSummary.dataQuality, 0) / slate.fixtures.length
    : 0;
  const marketsAnalysed = slate.fixtures.reduce((sum, row) => sum + row.decisionSummary.auditSummary.marketsAnalysed, 0);
  const lastRun = slate.provider.lastRun;
  const runErrors = [...new Set([...(lastRun?.errors ?? []), ...slate.provider.errors])];
  const runStatusLabel = lastRun?.status === "completed"
    ? "Latest cycle completed"
    : slate.provider.status === "unavailable"
      ? "Stored engine run unavailable"
    : slate.provider.status === "empty"
      ? "Waiting for provider data"
      : slate.provider.status === "partial"
        ? "Partial provider coverage"
        : `Engine status: ${lastRun?.status ?? slate.provider.status}`;

  return (
    <main id="main" className="container engine-page">
      <header className="page-heading engine-page-heading">
        <span className="section-kicker">The system behind every public decision</span>
        <h1>Decision engine</h1>
        <p>This is the current operational view: what the provider supplied, how much the engine analysed, what remains blocked, and the same canonical decisions shown across OddsPadi.</p>
        <nav className="intelligence-nav" aria-label="Engine related pages"><Link className="button primary" href="/engine/performance">Performance dashboard</Link><Link className="button" href="/predictions/today">Today&apos;s tips</Link><Link className="button" href="/predictions/history">Public results</Link></nav>
      </header>

      <ProviderRunStrip slate={slate} />

      <section className="section engine-run-summary" aria-label="Latest engine run summary">
        <div className="section-title"><div><span className="section-kicker">Latest engine run</span><h2>{runStatusLabel}</h2></div><span className={`badge ${lastRun?.status === "completed" ? "positive" : "scheduled"}`}>{lastRun?.finishedAt ? new Date(lastRun.finishedAt).toLocaleString() : providerReadable ? "Awaiting completion" : "No stored run"}</span></div>
        <div className="metrics-grid engine-run-metrics">
          <div className="metric"><span className="metric-label">Fixtures analysed</span><span className="metric-value">{currentValue(product.summary.fixturesAnalysed)}</span></div>
          <div className="metric"><span className="metric-label">Value picks</span><span className="metric-value">{currentValue(product.summary.valuePicks)}</span></div>
          <div className="metric"><span className="metric-label">Watchlist</span><span className="metric-value">{currentValue(product.summary.watchlist)}</span></div>
          <div className="metric"><span className="metric-label">Stale decisions</span><span className="metric-value">{currentValue(stale)}</span></div>
          <div className="metric"><span className="metric-label">Provider gaps</span><span className="metric-value">{currentValue(providerGaps)}</span></div>
          <div className="metric"><span className="metric-label">Odds snapshots</span><span className="metric-value">{currentValue(product.summary.oddsSnapshotsUsed)}</span></div>
        </div>
      </section>

      <section className="section historical-evidence engine-authority" aria-labelledby="engine-authority-heading">
        <div className="section-title">
          <div><span className="section-kicker">Research-to-runtime authority</span><h2 id="engine-authority-heading">What the engine knows—and what it is allowed to use</h2></div>
          <span className={`badge ${historicalEvidence.source === "supabase" ? "positive" : "scheduled"}`}>{historicalEvidence.source}</span>
        </div>
        <p className="performance-intro">History, player facts, holdout performance, runtime parity and live promotion are separate gates. A large database cannot silently authorize a model change.</p>
        {historicalEvidence.source === "unavailable" ? <div className="performance-evidence-unavailable" role="status">
          <span>Not read</span>
          <div><h3>Historical model authority is unavailable in this runtime</h3><p>Corpus counts, backtests and promotion state are hidden instead of rendered as zero. Daily provider work was not launched to fill the gap.</p></div>
        </div> : (() => {
          const footballBacktest = historicalEvidence.latestBacktests.find((row) => row.sport === "football");
          const footballModel = historicalEvidence.models.find((row) => row.sport === "football");
          const exactRuntimeParity = footballBacktest?.modelCompatibility === "exact-runtime-parity";
          const learning = historicalEvidence.learningPipeline;
          return <>
            <ol className="learning-pipeline engine-authority-path" aria-label="Decision engine evidence and authority stages">
              <li data-state={historicalEvidence.census.totals.finishedFixtures ? "ready" : "waiting"}><span>01 / HISTORY</span><strong>{count(historicalEvidence.census.totals.finishedFixtures)}</strong><h4>Finished fixtures</h4><p>Chronological outcomes establish the base rates.</p></li>
              <li data-state={historicalEvidence.playerMatchPerformances ? "ready" : "waiting"}><span>02 / PLAYERS</span><strong>{count(historicalEvidence.playerMatchPerformances)}</strong><h4>Player match facts</h4><p>Lineups, availability and form can enter feature gates.</p></li>
              <li data-state={footballBacktest?.testSize ? "ready" : "waiting"}><span>03 / HOLDOUT</span><strong>{footballBacktest ? count(footballBacktest.testSize) : "None"}</strong><h4>Football test rows</h4><p>{footballBacktest?.brierScore !== null && footballBacktest?.brierScore !== undefined ? `Brier ${footballBacktest.brierScore.toFixed(3)} on the latest stored run.` : "No valid holdout receipt is available."}</p></li>
              <li data-state={exactRuntimeParity ? "ready" : "waiting"}><span>04 / PARITY</span><strong>{exactRuntimeParity ? "Exact" : "Mismatch"}</strong><h4>Runtime contract</h4><p>Backtest code and live feature entrypoint must match.</p></li>
              <li data-state={learning.reviewReadyCandidates ? "ready" : "waiting"}><span>05 / REVIEW</span><strong>{learning.reviewReadyCandidates}/{learning.promotionCandidates}</strong><h4>Review-ready</h4><p>Calibration candidates passing the evidence gates.</p></li>
              <li data-state={learning.approvedPromotions && footballModel?.active ? "ready" : "waiting"}><span>06 / LIVE</span><strong>{learning.approvedPromotions}</strong><h4>Approved promotions</h4><p>Operator-approved adjustments bound to an active model.</p></li>
            </ol>

            <div className="engine-dashboard-grid engine-authority-notes">
              <article className="panel engine-dashboard-panel">
                <span className="section-kicker">Football model boundary</span>
                <h2>{exactRuntimeParity ? "Backtest and runtime are aligned" : "Benchmark evidence is not runtime authority"}</h2>
                <p className="muted">The latest stored football backtest uses <strong>{footballBacktest?.modelKey ?? "no recorded model"}</strong>. The registered runtime model is <strong>{footballBacktest?.runtimeModelKey ?? footballModel?.modelKey ?? "not registered"}</strong>. {exactRuntimeParity ? "Their entrypoint and feature contract match." : "Until parity and promotion pass, its metrics cannot tune live decisions."}</p>
              </article>
              <article className="panel engine-dashboard-panel">
                <span className="section-kicker">Player evidence boundary</span>
                <h2>Player rows exist; material weight is gated</h2>
                <ul className="engine-dashboard-list">
                  <li><span>Availability snapshots</span><strong>{count(historicalEvidence.playerAvailabilitySnapshots)}</strong></li>
                  <li><span>Lineup snapshots</span><strong>{count(historicalEvidence.lineupSnapshots)}</strong></li>
                  <li><span>Match-performance facts</span><strong>{count(historicalEvidence.playerMatchPerformances)}</strong></li>
                </ul>
              </article>
            </div>
          </>;
        })()}
      </section>

      <section className="section engine-dashboard-grid" aria-label="Engine health and scheduled jobs">
        <article className="panel engine-dashboard-panel">
          <span className="section-kicker">Data coverage</span>
          <h2>{coverage === null ? "Today’s coverage was not read" : `${coverage}% of today's slate analysed`}</h2>
          <p className="muted">{providerReadable ? <>{product.summary.fixturesFound} provider-backed fixtures found. {providerGaps ? `${providerGaps} still need data or provider recovery.` : "No fixture is currently blocked by a provider gap."}</> : "The stored slate repository is unavailable. Zero coverage is not inferred, and this page does not invoke live providers."}</p>
          <div className={`engine-rail${coverage === null ? " is-unavailable" : ""}`} aria-label={coverage === null ? "Fixture coverage unavailable" : `${coverage}% fixture coverage`}><span style={{ width: `${coverage ?? 0}%` }} /></div>
          <ul className="engine-dashboard-list">
            <li><span>Provider health</span><strong>{slate.provider.status}</strong></li>
            <li><span>Provider source</span><strong>{slate.provider.providers.join(", ") || "No provider response"}</strong></li>
            <li><span>Markets analysed</span><strong>{currentValue(marketsAnalysed)}</strong></li>
            <li><span>Average data quality</span><strong>{providerReadable ? `${Math.round(averageDataQuality * 100)}%` : "Not read"}</strong></li>
          </ul>
        </article>

        <article className="panel engine-dashboard-panel">
          <span className="section-kicker">Jobs</span>
          <h2>Scheduled intelligence cycle</h2>
          <p className="muted">These protected jobs keep fixtures, prices, decisions and results current.</p>
          <ul className="engine-dashboard-list">{jobs.map(([name, scope]) => <li key={name}><span>{name}</span><strong>{scope}</strong></li>)}</ul>
        </article>
      </section>

      <section className="section engine-dashboard-grid" aria-label="Errors and calibration">
        <article className="panel engine-dashboard-panel">
          <span className="section-kicker">Last errors</span>
          <h2>{runErrors.length ? `${runErrors.length} issue${runErrors.length === 1 ? "" : "s"} need attention` : "No provider errors in the latest public run"}</h2>
          {runErrors.length ? <ul className="engine-error-list">{runErrors.map((error) => <li key={error}>{error}</li>)}</ul> : <p className="muted">A clean error list does not imply complete coverage; the coverage panel above remains the source of truth.</p>}
        </article>

        <article className="panel engine-dashboard-panel">
          <span className="section-kicker">Calibration summary</span>
          <h2>Price and probability stay separate</h2>
          <p className="muted">Model chance is compared with the bookmaker&apos;s margin-free fair chance. A pick is published only after edge, expected value, data quality, confidence and freshness gates all pass.</p>
          <ul className="engine-dashboard-list">
            <li><span>Public invariants</span><strong>{providerReadable ? slate.fixtures.every((row) => row.decisionSummary.auditSummary.publicInvariantPassed) ? "Passing" : "Review required" : "Not read"}</strong></li>
            <li><span>Value threshold</span><strong>{providerReadable ? slate.fixtures[0] ? `${Math.round(slate.fixtures[0].decisionSummary.auditSummary.thresholds.minimumValueEdge * 100)}% minimum edge` : "Sport-specific" : "Not read"}</strong></li>
          </ul>
        </article>
      </section>

      <section className="section">
        <div className="section-title"><div><span className="section-kicker">Recent decisions</span><h2>Canonical daily output</h2></div><Link className="button small-btn" href="/predictions/today">Open full slate</Link></div>
        {slate.fixtures.length ? <div className="intelligence-grid">{slate.fixtures.slice(0, 6).map((row) => <SlateFixtureCard key={row.fixture.fixtureId} row={row} compact asOf={product.generatedAt} />)}</div> : <div className="engine-empty-ledger"><div><span className="section-kicker">Current output</span><h2>{providerReadable ? "No provider-backed fixtures were analysed" : "Current engine output was not read"}</h2><p className="muted">{providerReadable ? "The provider status above explains the gap. OddsPadi keeps the public ledger empty instead of substituting sample fixtures." : "The stored slate is unavailable in this runtime. An unread result is kept separate from a completed cycle with zero fixtures."}</p></div><div className="engine-empty-next"><strong>What unlocks an analysis</strong><ol><li>A verified fixture identity</li><li>A fresh market snapshot</li><li>Complete model and evidence gates</li></ol></div></div>}

        <details className="fold engine-operator-details">
          <summary>Operator run details</summary>
          <div className="fold-body"><p className="muted small">Manual reruns are protected POST operations. Operator instructions live in <code>docs/automations.md</code>.</p><Link className="button small-btn" href="/api/cron/run-daily-engine">View latest run endpoint</Link></div>
        </details>
      </section>

      <PredictionDisclaimer />
    </main>
  );
}
