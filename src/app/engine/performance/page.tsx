import type { Metadata } from "next";
import Link from "next/link";
import type { PerformanceRow } from "@/lib/sports/performance/analytics";
import { getEnginePerformanceReport } from "@/lib/sports/performance/report";

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Engine Performance — Accuracy, ROI & Calibration",
  description: "Transparent OddsPadi decision-engine performance across settled public picks, including accuracy, ROI simulation, Brier score, calibration, closing-line value and settlement health.",
  alternates: { canonical: "/engine/performance" },
  openGraph: {
    title: "Is the OddsPadi engine actually working?",
    description: "Inspect settled public-pick accuracy, ROI, calibration, Brier score and operational warnings without internal runs or demo predictions.",
    url: "/engine/performance"
  }
};

function percent(value: number | null, digits = 1): string {
  return value === null ? "Not enough data" : `${(value * 100).toFixed(digits)}%`;
}

function signedPercent(value: number | null, digits = 1): string {
  if (value === null) return "Not available";
  return `${value >= 0 ? "+" : ""}${(value * 100).toFixed(digits)}%`;
}

function decimal(value: number | null, digits = 3): string {
  return value === null ? "Not enough data" : value.toFixed(digits);
}

function PerformanceTable({ caption, rows }: { caption: string; rows: PerformanceRow[] }) {
  return (
    <div className="performance-table-wrap">
      <table className="data-table performance-table">
        <caption>{caption}</caption>
        <thead><tr><th>Group</th><th>Settled</th><th>W–L–P</th><th>Accuracy</th><th>ROI</th><th>Brier</th></tr></thead>
        <tbody>{rows.map((row) => <tr key={row.label}>
          <td><strong>{row.label}</strong></td>
          <td>{row.picks}</td>
          <td>{row.wins}–{row.losses}–{row.pushes}</td>
          <td>{percent(row.accuracy)}</td>
          <td className={row.roi !== null && row.roi < 0 ? "negative-number" : row.roi !== null && row.roi > 0 ? "positive-number" : undefined}>{signedPercent(row.roi)}</td>
          <td>{decimal(row.brierScore)}</td>
        </tr>)}</tbody>
      </table>
    </div>
  );
}

export default async function EnginePerformancePage() {
  const report = await getEnginePerformanceReport();
  const performance = report.publicPerformance;
  const sourceUnavailable = report.source === "unavailable";

  return (
    <main id="main" className="container performance-page">
      <header className="performance-hero">
        <div>
          <span className="section-kicker">Public evidence · not a backtest</span>
          <h1>Is the OddsPadi engine <span className="accent">actually working?</span></h1>
          <p>This scorecard uses settled picks that were genuinely published. Internal runs, watchlists, demo predictions and unsettled outcomes do not improve the numbers.</p>
          <nav className="intelligence-nav" aria-label="Performance exports and related views">
            <Link className="button primary" href="/predictions/history">Inspect the result ledger</Link>
            <Link className="button" href="/api/engine/performance.csv">Export CSV</Link>
            <Link className="button" href="/api/engine/performance">View JSON</Link>
          </nav>
        </div>
        <aside className={`performance-verdict verdict-${report.verdict.status}`} aria-label={`Engine verdict: ${report.verdict.label}`}>
          <span>Current read</span>
          <strong>{report.verdict.label}</strong>
          <p>{report.verdict.detail}</p>
          <small>Generated {new Date(report.generatedAt).toLocaleString()}</small>
        </aside>
      </header>

      {sourceUnavailable ? <div className="notice warning"><strong>Public ledger unavailable.</strong> {report.sourceReason} No internal outcomes are substituted.</div> : null}

      <section className="section" aria-labelledby="engine-health-heading">
        <div className="section-title"><div><span className="section-kicker">01 · Engine Health</span><h2 id="engine-health-heading">Is the daily system operating?</h2></div><span className={`badge ${report.engineHealth.providerHealth === "completed" ? "positive" : "scheduled"}`}>{report.engineHealth.providerHealth}</span></div>
        <div className="performance-health-strip">
          <div><span>Latest run</span><strong>{report.engineHealth.latestRunTime ? new Date(report.engineHealth.latestRunTime).toLocaleString() : "No completed run"}</strong></div>
          <div><span>Fixtures analysed</span><strong>{report.engineHealth.fixturesAnalysed}</strong></div>
          <div><span>Decisions generated</span><strong>{report.engineHealth.decisionsGenerated}</strong></div>
          <div><span>Public picks today</span><strong>{report.engineHealth.publicPicksPublished}</strong></div>
          <div><span>Stale decisions</span><strong>{report.engineHealth.staleDecisions}</strong></div>
          <div><span>Settlement backlog</span><strong>{report.engineHealth.settlementBacklog}</strong></div>
        </div>
        <p className="muted small">Provider sources: {report.engineHealth.providers.join(", ") || "no provider response"}. Recorded provider gaps: {report.engineHealth.providerGaps}.</p>
      </section>

      <section className="section performance-scorecard" aria-labelledby="public-performance-heading">
        <div className="performance-scorecard-lead">
          <span className="section-kicker">02 · Public Pick Performance</span>
          <h2 id="public-performance-heading">What happened after publication?</h2>
          <strong>{percent(performance.accuracy)}</strong>
          <span>accuracy across {performance.wins + performance.losses} resolved win/loss picks</span>
        </div>
        <div className="performance-scorecard-grid">
          <div><span>Settled picks</span><strong>{performance.settledPicks}</strong></div>
          <div><span>Wins / losses</span><strong>{performance.wins} / {performance.losses}</strong></div>
          <div><span>Push / void</span><strong>{performance.pushes} / {performance.voids}</strong></div>
          <div><span>One-unit ROI</span><strong className={performance.roiSimulation.roi !== null && performance.roiSimulation.roi < 0 ? "negative-number" : ""}>{signedPercent(performance.roiSimulation.roi)}</strong></div>
          <div><span>Average odds</span><strong>{performance.averageOdds?.toFixed(2) ?? "Not available"}</strong></div>
          <div><span>Average edge</span><strong>{signedPercent(performance.averageEdge)}</strong></div>
          <div><span>Binary Brier score</span><strong>{decimal(performance.brierScore)}</strong></div>
          <div><span>Simulated profit</span><strong>{performance.roiSimulation.profit >= 0 ? "+" : ""}{performance.roiSimulation.profit.toFixed(2)} units</strong></div>
        </div>
      </section>

      <section className="section" aria-labelledby="calibration-heading">
        <div className="section-title"><div><span className="section-kicker">03 · Calibration</span><h2 id="calibration-heading">Confidence versus reality</h2></div><span className="muted small">A small gap is better</span></div>
        <p className="performance-intro">Each rung compares the model&apos;s average published chance with the actual win rate. Empty buckets remain visible instead of borrowing evidence from another range.</p>
        <div className="calibration-ladder">
          {report.calibration.map((bucket) => {
            const expected = bucket.averageProbability === null ? 0 : bucket.averageProbability * 100;
            const actual = bucket.actualWinRate === null ? 0 : bucket.actualWinRate * 100;
            return <article key={bucket.id} className="calibration-rung">
              <div><strong>{bucket.label}</strong><span>{bucket.predictions} prediction{bucket.predictions === 1 ? "" : "s"}</span></div>
              <div className="calibration-track" aria-label={`${bucket.label}: expected ${percent(bucket.averageProbability)}, actual ${percent(bucket.actualWinRate)}`}>
                <span className="calibration-expected" style={{ width: `${Math.min(100, expected)}%` }} />
                {bucket.actualWinRate !== null ? <i className="calibration-actual" style={{ left: `${Math.min(100, actual)}%` }} /> : null}
              </div>
              <dl><div><dt>Wins</dt><dd>{bucket.wins}</dd></div><div><dt>Expected wins</dt><dd>{bucket.expectedWins.toFixed(1)}</dd></div><div><dt>Actual rate</dt><dd>{percent(bucket.actualWinRate)}</dd></div><div><dt>Gap</dt><dd>{signedPercent(bucket.calibrationGap)}</dd></div></dl>
            </article>;
          })}
        </div>
        <div className="calibration-key"><span><i className="expected" /> Model chance</span><span><i className="actual" /> Actual win rate</span></div>
      </section>

      <section className="section performance-split" aria-label="Performance by sport and league">
        <div><div className="section-title"><div><span className="section-kicker">04 · Sport Performance</span><h2>By sport</h2></div></div><PerformanceTable caption="Settled public-pick performance by sport" rows={report.sports} /></div>
        <div><div className="section-title"><div><span className="section-kicker">League view</span><h2>By league</h2></div></div>{report.leagues.length ? <PerformanceTable caption="Settled public-pick performance by league" rows={report.leagues.slice(0, 12)} /> : <div className="empty-state compact"><h3>No settled league sample</h3><p className="muted">League rows will appear after public picks settle.</p></div>}</div>
      </section>

      <section className="section" aria-labelledby="market-performance-heading">
        <div className="section-title"><div><span className="section-kicker">05 · Market Performance</span><h2 id="market-performance-heading">Where the engine performs</h2></div></div>
        <PerformanceTable caption="Settled performance across canonical market families" rows={report.markets} />
      </section>

      <section className="section performance-split" aria-label="Confidence and data-quality performance">
        <div><div className="section-title"><div><span className="section-kicker">06 · Confidence</span><h2>Low, medium and high</h2></div></div><PerformanceTable caption="Performance by publication confidence" rows={report.confidence} /></div>
        <div><div className="section-title"><div><span className="section-kicker">07 · Data Quality</span><h2>Evidence quality bands</h2></div></div><PerformanceTable caption="Performance by publication-time data quality" rows={report.dataQuality} /><p className="muted small">Low is below 62%, medium is 62–80%, and high is 80%+. Older rows without retained scores remain unscored.</p></div>
      </section>

      <section className="section" aria-labelledby="clv-heading">
        <div className="section-title"><div><span className="section-kicker">08 · Closing Line Value</span><h2 id="clv-heading">Did the published price beat the close?</h2></div><span className={`badge ${report.closingLineValue.available ? "positive" : "scheduled"}`}>{report.closingLineValue.picksWithClosingOdds} comparable</span></div>
        {report.closingLineValue.available ? <>
          <div className="performance-health-strip compact">
            <div><span>Average CLV</span><strong>{signedPercent(report.closingLineValue.average)}</strong></div>
            <div><span>Positive / negative</span><strong>{report.closingLineValue.positive} / {report.closingLineValue.negative}</strong></div>
            <div><span>Average published odds</span><strong>{report.closingLineValue.averagePublishedOdds?.toFixed(2)}</strong></div>
            <div><span>Average closing odds</span><strong>{report.closingLineValue.averageClosingOdds?.toFixed(2)}</strong></div>
          </div>
          <div className="performance-table-wrap"><table className="data-table performance-table"><caption>Recent picks with verified closing odds</caption><thead><tr><th>Match</th><th>Opening</th><th>Published</th><th>Closing</th><th>CLV</th></tr></thead><tbody>{report.closingLineValue.rows.slice(0, 10).map((row) => <tr key={row.id}><td><strong>{row.match}</strong><br/><span className="muted small">{row.market.replaceAll("_", " ")}</span></td><td>{row.openingOdds?.toFixed(2) ?? "Not stored"}</td><td>{row.publishedOdds.toFixed(2)}</td><td>{row.closingOdds.toFixed(2)}</td><td className={row.value < 0 ? "negative-number" : row.value > 0 ? "positive-number" : undefined}>{signedPercent(row.value)}</td></tr>)}</tbody></table></div>
        </> : <div className="empty-state"><h3>Closing odds are not available yet</h3><p className="muted">Published prices remain visible. CLV will appear only after a verified pre-kickoff closing snapshot is stored; no closing price is inferred.</p></div>}
      </section>

      <section className="section" aria-labelledby="warnings-heading">
        <div className="section-title"><div><span className="section-kicker">09 · Warnings</span><h2 id="warnings-heading">What could make these numbers misleading?</h2></div><span className="badge scheduled">{report.warnings.length}</span></div>
        {report.warnings.length ? <div className="performance-warning-list">{report.warnings.map((warning) => <article className={`performance-warning severity-${warning.severity}`} key={warning.id}><span>{warning.severity}</span><div><h3>{warning.title}</h3><p>{warning.detail}</p></div></article>)}</div> : <div className="notice"><strong>No active dashboard warning.</strong> This is not a permanent quality claim; provider, calibration and result health continue to update.</div>}
        <details className="fold performance-methodology"><summary>How these numbers are counted</summary><div className="fold-body"><p>{report.methodology.accuracy}</p><p>{report.methodology.stake}</p><p>{report.methodology.brier}</p><strong>Always excluded</strong><ul>{report.methodology.exclusions.map((item) => <li key={item}>{item}</li>)}</ul></div></details>
      </section>
    </main>
  );
}
