import type { Metadata } from "next";
import Link from "next/link";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import { ProviderRunStrip, SlateFixtureCard } from "@/components/odds/IntelligenceSlate";
import { getDailyTipsProduct } from "@/lib/sports/tips/product";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "AI Decision Engine Status",
  description: "Latest OddsPadi engine run, provider health, data coverage, recent canonical decisions and public calibration status.",
  alternates: { canonical: "/predictions/decision-engine" },
  openGraph: {
    title: "OddsPadi AI Decision Engine",
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

export default async function DecisionEnginePage() {
  const product = await getDailyTipsProduct();
  const { slate } = product;
  const stale = slate.fixtures.filter((row) => row.publicStatus === "stale").length;
  const providerGaps = slate.fixtures.filter((row) => row.publicStatus === "needs_data" || row.publicStatus === "suspended").length;
  const coverage = product.summary.fixturesFound ? Math.round((product.summary.fixturesAnalysed / product.summary.fixturesFound) * 100) : 0;
  const averageDataQuality = slate.fixtures.length
    ? slate.fixtures.reduce((sum, row) => sum + row.decisionSummary.dataQuality, 0) / slate.fixtures.length
    : 0;
  const marketsAnalysed = slate.fixtures.reduce((sum, row) => sum + row.decisionSummary.auditSummary.marketsAnalysed, 0);
  const lastRun = slate.provider.lastRun;
  const runErrors = [...new Set([...(lastRun?.errors ?? []), ...slate.provider.errors])];

  return (
    <main id="main" className="container">
      <header className="page-heading">
        <span className="section-kicker">The system behind every public decision</span>
        <h1>AI decision engine</h1>
        <p>This is the current operational view: what the provider supplied, how much the engine analysed, what remains blocked, and the same canonical decisions shown across OddsPadi.</p>
        <nav className="intelligence-nav" aria-label="Engine related pages"><Link className="button primary" href="/engine/performance">Performance dashboard</Link><Link className="button" href="/predictions/today">Today&apos;s tips</Link><Link className="button" href="/predictions/history">Public results</Link></nav>
      </header>

      <ProviderRunStrip slate={slate} />

      <section className="section" aria-label="Latest engine run summary">
        <div className="section-title"><div><span className="section-kicker">Latest engine run</span><h2>{lastRun?.status ?? slate.provider.status}</h2></div><span className={`badge ${lastRun?.status === "completed" ? "positive" : "scheduled"}`}>{lastRun?.finishedAt ? new Date(lastRun.finishedAt).toLocaleString() : "Awaiting completion"}</span></div>
        <div className="metrics-grid">
          <div className="metric"><span className="metric-label">Fixtures analysed</span><span className="metric-value">{product.summary.fixturesAnalysed}</span></div>
          <div className="metric"><span className="metric-label">Value picks</span><span className="metric-value">{product.summary.valuePicks}</span></div>
          <div className="metric"><span className="metric-label">Watchlist</span><span className="metric-value">{product.summary.watchlist}</span></div>
          <div className="metric"><span className="metric-label">Stale decisions</span><span className="metric-value">{stale}</span></div>
          <div className="metric"><span className="metric-label">Provider gaps</span><span className="metric-value">{providerGaps}</span></div>
          <div className="metric"><span className="metric-label">Odds snapshots</span><span className="metric-value">{product.summary.oddsSnapshotsUsed}</span></div>
        </div>
      </section>

      <section className="section engine-dashboard-grid" aria-label="Engine health and scheduled jobs">
        <article className="panel engine-dashboard-panel">
          <span className="section-kicker">Data coverage</span>
          <h2>{coverage}% of today&apos;s slate analysed</h2>
          <p className="muted">{product.summary.fixturesFound} provider-backed fixtures found. {providerGaps ? `${providerGaps} still need data or provider recovery.` : "No fixture is currently blocked by a provider gap."}</p>
          <div className="engine-rail" aria-label={`${coverage}% fixture coverage`}><span style={{ width: `${coverage}%` }} /></div>
          <ul className="engine-dashboard-list">
            <li><span>Provider health</span><strong>{slate.provider.status}</strong></li>
            <li><span>Provider source</span><strong>{slate.provider.providers.join(", ") || "No provider response"}</strong></li>
            <li><span>Markets analysed</span><strong>{marketsAnalysed}</strong></li>
            <li><span>Average data quality</span><strong>{Math.round(averageDataQuality * 100)}%</strong></li>
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
            <li><span>Public invariants</span><strong>{slate.fixtures.every((row) => row.decisionSummary.auditSummary.publicInvariantPassed) ? "Passing" : "Review required"}</strong></li>
            <li><span>Value threshold</span><strong>{slate.fixtures[0] ? `${Math.round(slate.fixtures[0].decisionSummary.auditSummary.thresholds.minimumValueEdge * 100)}% minimum edge` : "Sport-specific"}</strong></li>
          </ul>
        </article>
      </section>

      <section className="section">
        <div className="section-title"><div><span className="section-kicker">Recent decisions</span><h2>Canonical daily output</h2></div><Link className="button small-btn" href="/predictions/today">Open full slate</Link></div>
        {slate.fixtures.length ? <div className="intelligence-grid">{slate.fixtures.slice(0, 6).map((row) => <SlateFixtureCard key={row.fixture.fixtureId} row={row} compact asOf={product.generatedAt} />)}</div> : <div className="empty-state"><h2>No provider-backed fixtures were analysed</h2><p className="muted">The provider status above explains the gap. This page does not substitute sample fixtures.</p></div>}

        <details className="fold engine-operator-details">
          <summary>Operator run details</summary>
          <div className="fold-body"><p className="muted small">Manual reruns are protected POST operations. Operator instructions live in <code>docs/automations.md</code>.</p><Link className="button small-btn" href="/api/cron/run-daily-engine">View latest run endpoint</Link></div>
        </details>
      </section>

      <PredictionDisclaimer />
    </main>
  );
}
