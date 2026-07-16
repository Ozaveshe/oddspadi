import type { Metadata } from "next";
import { CountryFlag } from "@/components/odds/CountryFlag";
import { ShareBar } from "@/components/share/ShareBar";
import { TipsSharePreview } from "@/components/odds/TipsSharePreview";
import { getCachedPublicPredictionHistory } from "@/lib/sports/prediction/cachedPublicReads";
import { formatOdds, formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import {
  filterPublicPredictionHistory,
  getHistorySummary,
  getHistoryWindowSummaries
} from "@/lib/sports/prediction/history";
import { getYesterdayDecisionAuditProduct, getYesterdayResultsProduct } from "@/lib/sports/tips/product";
import { formatYesterdayResultsPost } from "@/lib/sports/tips/social";
import { SlateFixtureCard } from "@/components/odds/IntelligenceSlate";
import { serializeJsonLd } from "@/lib/security/jsonLd";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "OddsPadi Results — Accuracy & Settlement",
  description: "OddsPadi's public-pick ledger shows published picks only, with settlement reasons, wins, losses, ROI simulation, and provider status.",
  alternates: { canonical: "/predictions/history" },
  openGraph: {
    title: "Prediction Results & Accuracy — OddsPadi",
    description: "Published public picks only, with every result and pending reason visible.",
    url: "/predictions/history",
    type: "website"
  }
};

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };
const single = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

function badgeClass(result: string, settlementStatus: string) {
  if (result === "won") return "positive";
  if (result === "lost") return "no-value";
  if (settlementStatus === "needs_manual_review" || settlementStatus === "provider_missing") return "medium";
  return "scheduled";
}

export default async function PredictionHistoryPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const filters = {
    sport: single(params.sport) ?? "all",
    result: single(params.result) ?? "all",
    range: single(params.range) ?? "30",
    market: single(params.market) ?? "all",
    publicStatus: single(params.publicStatus) ?? "all",
    settlementStatus: single(params.settlementStatus) ?? "all",
    confidence: single(params.confidence) ?? "all",
    edge: (single(params.edge) ?? "all") as "all" | "positive" | "negative"
  };
  const [ledger, yesterday, yesterdayAudit] = await Promise.all([
    getCachedPublicPredictionHistory(),
    getYesterdayResultsProduct(),
    getYesterdayDecisionAuditProduct()
  ]);
  const history = filterPublicPredictionHistory(ledger.items, filters);
  const summary = getHistorySummary(history);
  const windows = getHistoryWindowSummaries(ledger.items);
  const markets = [...new Set(ledger.items.map((item) => item.market))].sort();
  const settlementHealth = {
    waiting: ledger.items.filter((item) => ["waiting_kickoff", "match_live"].includes(item.settlementStatus)).length,
    provider: ledger.items.filter((item) => ["provider_missing", "awaiting_final_score"].includes(item.settlementStatus)).length,
    market: ledger.items.filter((item) => item.settlementStatus === "awaiting_market_resolution").length,
    review: ledger.items.filter((item) => item.settlementStatus === "needs_manual_review").length
  };
  const breakdown = (key: "league" | "market") => Array.from(history.reduce((groups, item) => {
    const label = key === "league" ? item.league ?? "Unlabelled league" : item.market;
    groups.set(label, [...(groups.get(label) ?? []), item]);
    return groups;
  }, new Map<string, typeof history>())).map(([label, items]) => ({ label, ...getHistorySummary(items) })).filter((row) => row.settled > 0).sort((a, b) => b.settled - a.settled);
  const datasetJsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "OddsPadi published public-pick results ledger",
    description: "Provider-backed value picks that were actually published, including settlement state and results.",
    url: "https://oddspadi.com/predictions/history",
    dateModified: ledger.generatedAt,
    measurementTechnique: "One-unit simulation across settled published public picks only; internal model runs are excluded.",
    variableMeasured: ["result", "settlement status", "model probability", "odds", "value edge", "closing line value"]
  };

  return <main id="main" className="container">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(datasetJsonLd) }} />
    <div className="page-heading">
      <h1>Public results — <span className="accent">published picks only</span></h1>
      <p>Internal model runs, demos, watchlists, and negative-edge analyses never count toward this record. Every unresolved pick shows exactly what it is waiting for.</p>
    </div>

    <section className="results-proof-strip">
      <div><span>Repository</span><strong>{ledger.source === "live" ? "Public ledger connected" : "Unavailable"}</strong></div>
      <div><span>Public picks</span><strong>{summary.totalPublicPicks}</strong></div>
      <div><span>Settled</span><strong>{summary.settled}</strong></div>
      <div><span>Pending</span><strong>{summary.pending}</strong></div>
      <div><span>Manual review</span><strong>{summary.manualReview}</strong></div>
    </section>

    <section className="results-window-grid section" aria-label="Results periods">
      {windows.map((window) => <article className="panel" key={window.id}>
        <span className="section-kicker">{window.label}</span>
        <strong className="results-window-total">{window.summary.totalPublicPicks} pick{window.summary.totalPublicPicks === 1 ? "" : "s"}</strong>
        <span className="small muted">{window.summary.settled} settled · {formatPercent(window.summary.accuracy)} accuracy</span>
      </article>)}
    </section>

    <section className="section" aria-labelledby="yesterday-audit-title">
      <div className="section-title"><div><span className="section-kicker">Decision audit · {yesterdayAudit.date}</span><h2 id="yesterday-audit-title">Yesterday&apos;s complete engine record</h2></div><span className="badge scheduled">{yesterdayAudit.summary.fixtures}</span></div>
      <p className="muted">This audit is separate from the accuracy ledger below. It includes every stored provider fixture and abstention; only picks that were actually published can affect accuracy or ROI.</p>
      <div className="results-proof-strip">
        <div><span>Fixtures</span><strong>{yesterdayAudit.summary.fixtures}</strong></div>
        <div><span>Analysed</span><strong>{yesterdayAudit.summary.analysed}</strong></div>
        <div><span>Value picks</span><strong>{yesterdayAudit.summary.valuePicks}</strong></div>
        <div><span>Leans</span><strong>{yesterdayAudit.summary.leans}</strong></div>
        <div><span>Watchlist</span><strong>{yesterdayAudit.summary.watchlist}</strong></div>
        <div><span>Abstentions</span><strong>{yesterdayAudit.summary.abstentions}</strong></div>
      </div>
      {yesterdayAudit.source === "unavailable" ? <div className="empty-state compact"><h3>Yesterday&apos;s stored audit is unavailable</h3><p className="muted">{yesterdayAudit.reason}</p></div> : yesterdayAudit.rows.length ? <div className="intelligence-grid">{yesterdayAudit.rows.map((row) => <SlateFixtureCard key={row.fixture.fixtureId} row={row} compact asOf={yesterdayAudit.generatedAt} />)}</div> : <div className="empty-state compact"><h3>No provider-backed decisions were stored yesterday</h3><p className="muted">The empty audit remains separate from the published-pick ledger.</p></div>}
    </section>

    <section className="grid-2 section" aria-label="Results scorecard">
      <div className="panel">
        <h2>Credibility scorecard</h2>
        <div className="metrics-grid results-metrics">
          <div className="metric"><span className="metric-label">Wins / losses</span><span className="metric-value">{summary.wins} / {summary.losses}</span></div>
          <div className="metric"><span className="metric-label">Pushes / voids</span><span className="metric-value">{summary.pushes} / {summary.voids}</span></div>
          <div className="metric"><span className="metric-label">Accuracy</span><span className="metric-value">{formatPercent(summary.accuracy)}</span></div>
          <div className="metric"><span className="metric-label">ROI simulation</span><span className="metric-value">{formatSignedPercent(summary.roi)}</span></div>
          <div className="metric"><span className="metric-label">Average odds</span><span className="metric-value">{summary.averageOdds ? formatOdds(summary.averageOdds) : "—"}</span></div>
          <div className="metric"><span className="metric-label">Average CLV</span><span className="metric-value">{summary.averageClosingLineValue === null ? "Not available" : formatSignedPercent(summary.averageClosingLineValue)}</span></div>
        </div>
      </div>
      <div className="notice"><strong>What counts:</strong> only provider-backed canonical decisions that cleared the public value-pick threshold at publication. Accuracy uses wins and losses; pushes and voids remain visible but do not change accuracy.</div>
    </section>

    <section className="section" aria-labelledby="settlement-health-title">
      <div className="section-title"><div><span className="section-kicker">Settlement health</span><h2 id="settlement-health-title">Why some results are still pending</h2></div></div>
      <div className="results-proof-strip">
        <div><span>Waiting / live</span><strong>{settlementHealth.waiting}</strong></div>
        <div><span>Provider score gap</span><strong>{settlementHealth.provider}</strong></div>
        <div><span>Market resolution</span><strong>{settlementHealth.market}</strong></div>
        <div><span>Manual review</span><strong>{settlementHealth.review}</strong></div>
      </div>
      <details className="fold results-counting">
        <summary>How results are counted</summary>
        <div className="fold-body"><p>Only selections that were publicly published as value picks enter this ledger. Wins and losses determine accuracy. Pushes and voids stay visible but do not change it. Pending picks remain pending until a provider final score and the market&apos;s settlement rule can be verified.</p></div>
      </details>
    </section>

    <ShareBar
      pageContext="results_ledger"
      title="OddsPadi public results ledger"
      text={`Published record: ${formatPercent(summary.accuracy)} accuracy across ${summary.settled} settled public picks. Internal model runs are excluded:`}
      url="/predictions/history"
    />

    <form className="results-filters" method="get">
      <label>Sport<select name="sport" defaultValue={filters.sport}><option value="all">All sports</option><option value="football">Football</option><option value="basketball">Basketball</option><option value="tennis">Tennis</option></select></label>
      <label>Date range<select name="range" defaultValue={filters.range}><option value="1">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All time</option></select></label>
      <label>Result<select name="result" defaultValue={filters.result}><option value="all">All results</option><option value="pending">Pending</option><option value="won">Won</option><option value="lost">Lost</option><option value="push">Push</option><option value="void">Void</option></select></label>
      <label>Market<select name="market" defaultValue={filters.market}><option value="all">All markets</option>{markets.map((market) => <option value={market} key={market}>{market.replaceAll("_", " ")}</option>)}</select></label>
      <label>Public status<select name="publicStatus" defaultValue={filters.publicStatus}><option value="all">All public states</option><option value="published">Published</option><option value="stale">Stale</option><option value="suspended">Suspended</option><option value="settled">Settled</option><option value="void">Void</option></select></label>
      <label>Settlement<select name="settlementStatus" defaultValue={filters.settlementStatus}><option value="all">All settlement states</option><option value="waiting_kickoff">Waiting kickoff</option><option value="match_live">Match live</option><option value="awaiting_final_score">Final score pending</option><option value="awaiting_market_resolution">Market resolution pending</option><option value="provider_missing">Provider missing</option><option value="needs_manual_review">Manual review</option><option value="settled">Settled</option><option value="void">Void</option></select></label>
      <label>Confidence<select name="confidence" defaultValue={filters.confidence}><option value="all">All confidence</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
      <label>Edge<select name="edge" defaultValue={filters.edge}><option value="all">All edges</option><option value="positive">Positive only</option><option value="negative">Negative only</option></select></label>
      <button className="button primary" type="submit">Apply filters</button>
    </form>

    <TipsSharePreview formats={[{ id: "yesterday-results", label: "Yesterday's Results", text: formatYesterdayResultsPost(yesterday) }]} />

    {breakdown("league").length || breakdown("market").length ? <section className="grid-2 section" aria-label="Accuracy breakdowns">
      {[{ title: "Accuracy by league", rows: breakdown("league") }, { title: "Accuracy by market", rows: breakdown("market") }].map((group) => <div className="panel" key={group.title}><h2>{group.title}</h2><div className="breakdown-list">{group.rows.map((row) => <div key={row.label}><span>{row.label}</span><strong>{formatPercent(row.accuracy)} <small>({row.wins}–{row.losses})</small></strong></div>)}</div></div>)}
    </section> : null}

    <p className="live-meta-row"><span className={`badge ${ledger.source === "live" ? "positive" : "no-value"}`}>{ledger.source === "live" ? "Published-pick ledger" : "Results unavailable"}</span>{ledger.source === "live" ? `Updated ${new Date(ledger.generatedAt).toLocaleString()}.` : ledger.reason}</p>

    {ledger.source === "unavailable" ? <div className="empty-state"><div className="empty-emoji">📒</div><h2>We can&apos;t read the public ledger</h2><p className="muted">No internal, preview, or demo results are substituted. Settlement automation will retry the repository.</p></div> : history.length ? <div className="table-wrap">
      <table className="data-table results-ledger-table">
        <thead><tr><th>Date</th><th>Sport</th><th>Match</th><th>Published pick</th><th>Odds</th><th>Edge / EV</th><th>Status</th></tr></thead>
        <tbody>{history.map((item) => <tr key={item.id}>
          <td>{item.date}</td>
          <td><span className="badge scheduled">{item.sport}</span></td>
          <td><strong>{item.match}</strong>{item.league ? <><br/><span className="small muted result-league-line">{item.country ? <CountryFlag country={item.country} size={15} /> : null}{item.league}{item.country ? ` · ${item.country}` : ""}</span></> : null}</td>
          <td>{item.pick}<br/><span className="small muted">{item.market.replaceAll("_", " ")} · {item.confidence} confidence</span></td>
          <td>{formatOdds(item.odds)}{item.closingOdds ? <><br/><span className="small muted">Close {formatOdds(item.closingOdds)}</span></> : null}</td>
          <td>{formatSignedPercent(item.edge)}<br/><span className="small muted">EV {formatSignedPercent(item.expectedValue)}</span></td>
          <td><span className={`badge ${badgeClass(item.result, item.settlementStatus)}`}>{item.result === "pending" ? item.pendingReasonLabel ?? "Pending" : item.result}</span>{item.result === "pending" ? <p className="small muted settlement-reason">{item.settlementReason}</p> : item.settledAt ? <p className="small muted settlement-reason">Settled {new Date(item.settledAt).toLocaleString()}</p> : null}</td>
        </tr>)}</tbody>
      </table>
    </div> : <div className="empty-state"><div className="empty-emoji">🔎</div><h2>No published picks match these filters</h2><p className="muted">This is an honest empty state. Internal runs and demo outcomes are not used to fill the ledger.</p></div>}
  </main>;
}
