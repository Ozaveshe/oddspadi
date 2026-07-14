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

function count(value: number): string {
  return new Intl.NumberFormat("en", {
    notation: value >= 10_000 ? "compact" : "standard",
    maximumFractionDigits: 1
  }).format(value);
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
  const evidence = report.historicalEvidence;
  const sourceUnavailable = report.source === "unavailable";
  const historicalEvidenceUnavailable = evidence.source === "unavailable";
  const activeModels = evidence.models.filter((model) => model.active).length;
  const learning = evidence.learningPipeline;

  return (
    <main id="main" className="container performance-page">
      <header className="performance-hero">
        <div>
          <span className="section-kicker">Proof before picks</span>
          <h1>Show the maths. <span className="accent">Show the receipts.</span></h1>
          <p>Historical model evidence and real published results stay separate here. A large corpus does not excuse a weak backtest, and a promising backtest does not count as live performance.</p>
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

      {sourceUnavailable ? <div className="notice warning"><strong>Public outcome evidence unavailable.</strong> {report.sourceReason} Accuracy, ROI, calibration and CLV are withheld; zero is not substituted for missing evidence.</div> : null}

      <section className="section" aria-labelledby="engine-health-heading">
        <div className="section-title"><div><span className="section-kicker">01 / Engine Health</span><h2 id="engine-health-heading">Is the daily system operating?</h2></div><span className={`badge ${report.engineHealth.providerHealth === "completed" ? "positive" : "scheduled"}`}>{report.engineHealth.providerHealth}</span></div>
        <div className="performance-health-strip">
          <div><span>Latest provider attempt</span><strong>{report.engineHealth.latestRunTime ? new Date(report.engineHealth.latestRunTime).toLocaleString() : "No recorded attempt"}</strong></div>
          <div><span>Fixtures analysed</span><strong>{report.engineHealth.fixturesAnalysed}</strong></div>
          <div><span>Decisions generated</span><strong>{report.engineHealth.decisionsGenerated}</strong></div>
          <div><span>Public picks today</span><strong>{report.engineHealth.publicPicksPublished}</strong></div>
          <div><span>Stale decisions</span><strong>{report.engineHealth.staleDecisions}</strong></div>
          <div><span>Settlement backlog</span><strong>{report.engineHealth.settlementBacklog}</strong></div>
        </div>
        <p className="muted small">Provider sources: {report.engineHealth.providers.join(", ") || "no provider response"}. Recorded provider gaps: {report.engineHealth.providerGaps}.</p>
      </section>

      <section className="section historical-evidence" aria-labelledby="historical-evidence-heading">
        <div className="section-title">
          <div><span className="section-kicker">02 / Historical foundation</span><h2 id="historical-evidence-heading">What is the engine learning from?</h2></div>
          <span className={`badge ${evidence.source === "supabase" ? "positive" : "scheduled"}`}>{evidence.census.status.replaceAll("-", " ")}</span>
        </div>
        <p className="performance-intro">{evidence.census.summary}</p>
        {historicalEvidenceUnavailable ? (
          <div className="performance-evidence-unavailable" role="status">
            <span>Not read</span>
            <div>
              <h3>Historical counts are unavailable in this runtime</h3>
              <p>The repository connection is missing, so corpus totals, player history, backtests and promotion gates are hidden instead of displayed as zero.</p>
            </div>
          </div>
        ) : <>
        <div className="evidence-ledger" aria-label="Historical data counts">
          <div><span>Finished fixtures</span><strong>{count(evidence.census.totals.finishedFixtures)}</strong></div>
          <div><span>Odds snapshots</span><strong>{count(evidence.census.totals.oddsSnapshots)}</strong></div>
          <div><span>Feature rows</span><strong>{count(evidence.census.totals.featureSnapshots)}</strong></div>
          <div><span>Backtest runs</span><strong>{count(evidence.census.totals.completedBacktests)}</strong></div>
          <div><span>Player availability</span><strong>{count(evidence.playerAvailabilitySnapshots)}</strong></div>
          <div><span>Lineup snapshots</span><strong>{count(evidence.lineupSnapshots)}</strong></div>
          <div><span>Player match facts</span><strong>{count(evidence.playerMatchPerformances)}</strong></div>
        </div>

        <div className="learning-pipeline-heading">
          <div><span className="section-kicker">Learning pipeline</span><h3>From raw history to a live-approved adjustment</h3></div>
          <p>Each gate is separate. Later stages cannot borrow authority from a large corpus or a promising backtest.</p>
        </div>
        <ol className="learning-pipeline" aria-label="Historical learning and promotion stages">
          <li data-state={evidence.census.totals.finishedFixtures ? "ready" : "waiting"}><span>01</span><strong>{count(evidence.census.totals.finishedFixtures)}</strong><h4>Finished fixtures</h4><p>Chronological results and provider facts.</p></li>
          <li data-state={evidence.census.totals.completedBacktests ? "ready" : "waiting"}><span>02</span><strong>{count(evidence.census.totals.completedBacktests)}</strong><h4>Benchmark backtests</h4><p>Walk-forward holdouts, kept separate from runtime authority.</p></li>
          <li data-state={learning.runtimeParitySports === 3 ? "ready" : "waiting"}><span>03</span><strong>{learning.runtimeParitySports}/3</strong><h4>Runtime parity</h4><p>Exact model entrypoint and feature-contract receipts.</p></li>
          <li data-state={learning.calibrationRuns ? "ready" : "waiting"}><span>04</span><strong>{count(learning.calibrationRuns)}</strong><h4>Calibration runs</h4><p>Settled live decisions grouped by model version.</p></li>
          <li data-state={learning.reviewReadyCandidates ? "ready" : "waiting"}><span>05</span><strong>{learning.reviewReadyCandidates}/{learning.promotionCandidates}</strong><h4>Review-ready</h4><p>Candidates passing sample, skill, error and CLV gates.</p></li>
          <li data-state={learning.approvedPromotions ? "ready" : "waiting"}><span>06</span><strong>{learning.approvedPromotions}</strong><h4>Approved promotions</h4><p>Operator-approved, model-bound live adjustments.</p></li>
        </ol>

        <div className="evidence-sport-grid">
          {evidence.census.sports.map((sport) => {
            const completion = sport.featureSnapshots ? Math.min(100, Math.round((sport.completeFeatureSnapshots / sport.featureSnapshots) * 100)) : 0;
            return <article key={sport.sport} className="evidence-sport-card">
              <header><strong>{sport.sport}</strong><span>{completion}% complete features</span></header>
              <div className="evidence-meter" aria-label={`${sport.sport} complete feature coverage ${completion}%`}><i style={{ width: `${completion}%` }} /></div>
              <dl>
                <div><dt>fixtures</dt><dd>{count(sport.finishedFixtures)}</dd></div>
                <div><dt>odds</dt><dd>{count(sport.oddsSnapshots)}</dd></div>
                <div><dt>features</dt><dd>{count(sport.featureSnapshots)}</dd></div>
                <div><dt>backtests</dt><dd>{sport.completedBacktests}</dd></div>
              </dl>
            </article>;
          })}
        </div>

        <div className="historical-proof-grid">
          <div>
            <h3>Latest walk-forward backtests</h3>
            <div className="performance-table-wrap">
              <table className="data-table performance-table backtest-table">
                <thead><tr><th>Sport</th><th>Weight source</th><th>Odds evidence</th><th>Test sample</th><th>Picks</th><th>Brier</th><th>Log loss</th><th>Yield</th><th>CLV</th></tr></thead>
                <tbody>{evidence.latestBacktests.map((row) => <tr key={row.sport}>
                  <td><strong>{row.sport}</strong><small>{row.modelKey}</small><small>runtime: {row.runtimeModelKey ?? "not registered"}</small><small>{row.modelCompatibility}</small></td>
                  <td><strong>{row.learnedWeightsTrainingOnly ? "training only" : "unverified"}</strong><small>{count(row.learnedWeightsSampleSize)} learning fixtures</small><small>{row.learnedWeightsSource}</small></td>
                  <td><strong>{row.oddsCoverageVerified ? `${count(row.oddsCoherentDecisionFixtures)}/${count(row.oddsEvaluatedFixtures)} coherent` : "unverified"}</strong><small>{row.oddsCoverageVerified ? `${count(row.oddsVerifiedClosingFixtures)} verified close` : "legacy run or missing audit"}</small></td>
                  <td>{count(row.testSize)}</td><td>{count(row.pickCount)}</td><td>{decimal(row.brierScore)}</td><td>{decimal(row.logLoss)}</td>
                  <td className={row.yield !== null && row.yield < 0 ? "negative-number" : row.yield !== null && row.yield > 0 ? "positive-number" : undefined}>{signedPercent(row.yield)}</td>
                  <td>{signedPercent(row.closingLineValue, 2)}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </div>
          <aside className="model-governance-card">
            <span className="section-kicker">Promotion gate</span>
            <strong>{learning.approvedPromotions}</strong>
            <h3>live calibration promotions</h3>
            <p>{learning.approvedPromotions ? `Approved promotions exist; ${activeModels}/${evidence.models.length} separately registered model versions are active.` : "No model-bound calibration candidate is approved for live use. Historical backtests remain evidence, not authority."}</p>
            <ul>{evidence.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
          </aside>
        </div>
        </>}
      </section>

      <section className="section performance-scorecard" aria-labelledby="public-performance-heading">
        <div className="performance-scorecard-lead">
          <span className="section-kicker">03 / Public Pick Performance</span>
          <h2 id="public-performance-heading">What happened after publication?</h2>
          <strong>{sourceUnavailable ? "Withheld" : percent(performance.accuracy)}</strong>
          <span>{sourceUnavailable ? "No public outcome metric is inferred from an unreadable ledger" : `accuracy across ${performance.wins + performance.losses} resolved win/loss picks`}</span>
        </div>
        {sourceUnavailable ? <div className="performance-metrics-withheld" role="status">
          <span>Outcome ledger not read</span>
          <h3>No false zeroes</h3>
          <p>Settled picks, wins, losses, ROI, odds, edge, Brier score and simulated profit will return only after the canonical public ledger is readable.</p>
          <Link className="inline-link" href="/predictions/history">Inspect ledger availability</Link>
        </div> : <div className="performance-scorecard-grid">
          <div><span>Settled picks</span><strong>{performance.settledPicks}</strong></div>
          <div><span>Wins / losses</span><strong>{performance.wins} / {performance.losses}</strong></div>
          <div><span>Push / void</span><strong>{performance.pushes} / {performance.voids}</strong></div>
          <div><span>One-unit ROI</span><strong className={performance.roiSimulation.roi !== null && performance.roiSimulation.roi < 0 ? "negative-number" : ""}>{signedPercent(performance.roiSimulation.roi)}</strong></div>
          <div><span>Average odds</span><strong>{performance.averageOdds?.toFixed(2) ?? "Not available"}</strong></div>
          <div><span>Average edge</span><strong>{signedPercent(performance.averageEdge)}</strong></div>
          <div><span>Binary Brier score</span><strong>{decimal(performance.brierScore)}</strong></div>
          <div><span>Simulated profit</span><strong>{performance.roiSimulation.profit >= 0 ? "+" : ""}{performance.roiSimulation.profit.toFixed(2)} units</strong></div>
        </div>}
      </section>

      <section className="section" aria-labelledby="calibration-heading">
        <div className="section-title"><div><span className="section-kicker">04 / Calibration</span><h2 id="calibration-heading">Confidence versus reality</h2></div><span className="muted small">A small gap is better</span></div>
        {sourceUnavailable ? <div className="performance-evidence-unavailable" role="status">
          <span>Withheld</span>
          <div><h3>Calibration needs real settled outcomes</h3><p>The probability ladder is not drawn because the outcome ledger could not be read. An empty repository and an unavailable repository are different states.</p></div>
        </div> : <>
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
        </>}
      </section>

      {sourceUnavailable ? <section className="section performance-breakdowns-withheld" aria-labelledby="breakdowns-withheld-heading">
        <div className="section-title"><div><span className="section-kicker">05-09 / Outcome breakdowns</span><h2 id="breakdowns-withheld-heading">No breakdown without a ledger</h2></div><span className="badge scheduled">unavailable</span></div>
        <p>Sport, league, market, confidence, data-quality and closing-line tables are omitted because their source could not be read. This prevents a grid of zeroes from looking like measured performance.</p>
        <dl>
          <div><dt>Sport and league</dt><dd>Withheld</dd></div>
          <div><dt>Market performance</dt><dd>Withheld</dd></div>
          <div><dt>Confidence and data quality</dt><dd>Withheld</dd></div>
          <div><dt>Closing-line value</dt><dd>Withheld</dd></div>
        </dl>
      </section> : <>
      <section className="section performance-split" aria-label="Performance by sport and league">
        <div><div className="section-title"><div><span className="section-kicker">05 / Sport performance</span><h2>By sport</h2></div></div><PerformanceTable caption="Settled public-pick performance by sport" rows={report.sports} /></div>
        <div><div className="section-title"><div><span className="section-kicker">League view</span><h2>By league</h2></div></div>{report.leagues.length ? <PerformanceTable caption="Settled public-pick performance by league" rows={report.leagues.slice(0, 12)} /> : <div className="empty-state compact"><h3>No settled league sample</h3><p className="muted">League rows will appear after public picks settle.</p></div>}</div>
      </section>

      <section className="section" aria-labelledby="market-performance-heading">
        <div className="section-title"><div><span className="section-kicker">06 / Market Performance</span><h2 id="market-performance-heading">Which markets hold up?</h2></div></div>
        <PerformanceTable caption="Settled performance across canonical market families" rows={report.markets} />
      </section>

      <section className="section performance-split" aria-label="Confidence and data-quality performance">
        <div><div className="section-title"><div><span className="section-kicker">07 / Confidence</span><h2>Low, medium and high</h2></div></div><PerformanceTable caption="Performance by publication confidence" rows={report.confidence} /></div>
        <div><div className="section-title"><div><span className="section-kicker">08 / Data Quality</span><h2>Evidence quality bands</h2></div></div><PerformanceTable caption="Performance by publication-time data quality" rows={report.dataQuality} /><p className="muted small">Low is below 62%, medium is 62–80%, and high is 80%+. Older rows without retained scores remain unscored.</p></div>
      </section>

      <section className="section" aria-labelledby="clv-heading">
        <div className="section-title"><div><span className="section-kicker">09 / Closing Line Value</span><h2 id="clv-heading">Did the published price beat the close?</h2></div><span className={`badge ${report.closingLineValue.available ? "positive" : "scheduled"}`}>{report.closingLineValue.picksWithClosingOdds} comparable</span></div>
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
      </>}

      <section className="section" aria-labelledby="warnings-heading">
        <div className="section-title"><div><span className="section-kicker">10 / Warnings</span><h2 id="warnings-heading">What could make these numbers misleading?</h2></div><span className="badge scheduled">{report.warnings.length}</span></div>
        {report.warnings.length ? <div className="performance-warning-list">{report.warnings.map((warning) => <article className={`performance-warning severity-${warning.severity}`} key={warning.id}><span>{warning.severity}</span><div><h3>{warning.title}</h3><p>{warning.detail}</p></div></article>)}</div> : <div className="notice"><strong>No active dashboard warning.</strong> This is not a permanent quality claim; provider, calibration and result health continue to update.</div>}
        <details className="fold performance-methodology"><summary>How these numbers are counted</summary><div className="fold-body"><p>{report.methodology.accuracy}</p><p>{report.methodology.stake}</p><p>{report.methodology.brier}</p><strong>Always excluded</strong><ul>{report.methodology.exclusions.map((item) => <li key={item}>{item}</li>)}</ul></div></details>
      </section>
    </main>
  );
}
