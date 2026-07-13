import type { Metadata } from "next";
import { formatOdds, formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import { getHistorySummary } from "@/lib/sports/prediction/history";
import { getCachedPublicPredictionHistory } from "@/lib/sports/prediction/cachedPublicReads";
import { CountryFlag } from "@/components/odds/CountryFlag";
import { ShareBar } from "@/components/share/ShareBar";

// Keep the route cache aligned with ODDSPADI_PUBLIC_HISTORY_CACHE_TTL_MS.
export const revalidate = 900;

export const metadata: Metadata = {
  title: "Prediction Results & Accuracy — Wins and Losses",
  description:
    "OddsPadi shows every prediction result — wins and losses — with accuracy and a simple ROI simulation. Honest records, because trust is earned.",
  alternates: { canonical: "/predictions/history" },
  openGraph: {
    title: "Prediction Results & Accuracy — OddsPadi",
    description: "Every prediction result, wins and losses included. Honest records, because trust is earned.",
    url: "/predictions/history",
    type: "website"
  }
};

type PageProps = { searchParams?: Promise<Record<string, string | string[] | undefined>> };

function single(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }

export default async function PredictionHistoryPage({ searchParams }: PageProps) {
  const params = (await searchParams) ?? {};
  const sport = single(params.sport) ?? "all";
  const result = single(params.result) ?? "all";
  const range = single(params.range) ?? "30";
  const ledger = await getCachedPublicPredictionHistory();
  const cutoff = range === "all" ? null : Date.now() - Number(range) * 86_400_000;
  const history = ledger.items.filter(item =>
    (sport === "all" || item.sport === sport) &&
    (result === "all" || item.result === result) &&
    (!cutoff || new Date(item.createdAt).getTime() >= cutoff)
  );
  const summary = getHistorySummary(history);
  const pending = history.filter(item => item.result === "pending").length;
  const breakdown = (key: "league" | "market") => Array.from(history.reduce((groups, item) => { const label = key === "league" ? item.league ?? "Unlabelled league" : item.market || "Unlabelled market"; const rows = groups.get(label) ?? []; rows.push(item); groups.set(label, rows); return groups; }, new Map<string, typeof history>())).map(([label, items]) => ({ label, ...getHistorySummary(items) })).filter((row) => row.settled > 0).sort((a, b) => b.settled - a.settled);
  const leagueBreakdown = breakdown("league");
  const marketBreakdown = breakdown("market");
  const datasetJsonLd = { "@context": "https://schema.org", "@type": "Dataset", name: "OddsPadi public prediction results ledger", description: "A complete public ledger of stored OddsPadi prediction outcomes, including wins and losses.", url: "https://oddspadi.com/predictions/history", temporalCoverage: history.length ? `${history.at(-1)?.date}/${history[0]?.date}` : undefined, dateModified: ledger.generatedAt, measurementTechnique: "One-unit simulation across every won and lost stored pick; pushes and voids remain visible but are excluded from accuracy and ROI.", variableMeasured: ["result", "model probability", "odds", "league", "market"] };

  return (
    <main id="main" className="container">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetJsonLd) }} />
      <div className="page-heading">
        <h1>
          Our results — <span className="accent">wins and losses</span>
        </h1>
        <p>
          Anyone can screenshot their wins. We keep everything: every pick, every outcome, good or bad. Past results
          never guarantee future ones — but they do show you how we&apos;re doing.
        </p>
      </div>

      <section className="results-proof-strip">
        <div><span>Repository</span><strong>{ledger.source === "live" ? "Connected" : "Unavailable"}</strong></div>
        <div><span>Visible records</span><strong>{history.length}</strong></div>
        <div><span>Awaiting settlement</span><strong>{pending}</strong></div>
        <div><span>Generated</span><strong>{new Date(ledger.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong></div>
      </section>

      {leagueBreakdown.length || marketBreakdown.length ? <section className="grid-2 section" aria-label="Accuracy breakdowns">
        {[{ title: "Accuracy by league", rows: leagueBreakdown }, { title: "Accuracy by market", rows: marketBreakdown }].map((group) => <div className="panel" key={group.title}><h2>{group.title}</h2>{group.rows.length ? <div className="breakdown-list">{group.rows.map((row) => <div key={row.label}><span>{row.label}</span><strong>{formatPercent(row.accuracy)} <small>({row.wins}–{row.losses})</small></strong></div>)}</div> : <p className="muted">No settled rows are labelled for this breakdown yet.</p>}</div>)}
      </section> : null}

      <ShareBar
        pageContext="results_ledger"
        title="OddsPadi public results ledger"
        text={`Our record: ${Math.round(summary.accuracy * 100)}% accuracy on ${summary.settled} settled picks. Every result stays visible — analysis, not guaranteed tips:`}
        url="/predictions/history"
      />

      <form className="results-filters" method="get">
        <label>Sport<select name="sport" defaultValue={sport}><option value="all">All sports</option><option value="football">Football</option><option value="basketball">Basketball</option><option value="tennis">Tennis</option></select></label>
        <label>Outcome<select name="result" defaultValue={result}><option value="all">All outcomes</option><option value="pending">Pending</option><option value="won">Won</option><option value="lost">Lost</option><option value="push">Push</option><option value="void">Void</option></select></label>
        <label>Period<select name="range" defaultValue={range}><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All stored</option></select></label>
        <button className="button primary" type="submit">Apply filters</button>
      </form>

      <section className="grid-2 section">
        <div className="panel">
          <h2>The scoreboard so far</h2>
          <div className="metrics-grid" style={{ marginTop: 12 }}>
            <div className="metric">
              <span className="metric-label">Settled picks</span>
              <span className="metric-value">{summary.settled}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Wins / losses</span>
              <span className="metric-value">
                {summary.wins} / {summary.losses}
              </span>
            </div>
            <div className="metric">
              <span className="metric-label">Accuracy</span>
              <span className="metric-value">{formatPercent(summary.accuracy)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">ROI simulation</span>
              <span className="metric-value">{formatSignedPercent(summary.roi)}</span>
            </div>
          </div>
        </div>
        <div className="notice">
          <strong>How to read ROI:</strong> we simulate placing one unit on every settled pick. It&apos;s a simple
          honesty check on our value maths — not financial advice, and not a promise of future returns.
        </div>
      </section>

      <p className="live-meta-row">
        <span className={`badge ${ledger.source === "live" ? "positive" : "no-value"}`}>
          {ledger.source === "live" ? "Live results ledger" : "Results unavailable"}
        </span>
        {ledger.source === "live" ? "Latest stored picks and settlement outcomes from the OddsPadi engine." : ledger.reason}
      </p>

      {ledger.source === "unavailable" ? <div className="empty-state"><div className="empty-emoji">📒</div><h2>We can&apos;t read the results ledger</h2><p className="muted">No preview wins are substituted. The daily results automation will retry the repository and report the configuration fault.</p></div> : history.length ? <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col">Sport</th>
              <th scope="col">Match</th>
              <th scope="col">Pick</th>
              <th scope="col">Odds</th>
              <th scope="col">Model</th>
              <th scope="col">Edge</th>
              <th scope="col">Result</th>
            </tr>
          </thead>
          <tbody>
            {history.map((item) => (
              <tr key={item.id}>
                <td>{item.date}</td>
                <td><span className="badge scheduled">{item.sport}</span></td>
                <td><strong>{item.match}</strong>{item.league ? <><br/><span className="small muted result-league-line">{item.country ? <CountryFlag country={item.country} size={15} /> : null}{item.league}{item.country ? ` · ${item.country}` : ""}</span></> : null}</td>
                <td>{item.pick}</td>
                <td>{formatOdds(item.odds)}</td>
                <td>{formatPercent(item.modelProbability)}</td>
                <td>{formatSignedPercent(item.edge)}</td>
                <td>
                  <span className={`badge ${item.result === "won" ? "positive" : item.result === "lost" ? "no-value" : "scheduled"}`}>
                    {item.result}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div> : <div className="empty-state"><div className="empty-emoji">🔎</div><h2>No stored picks match these filters</h2><p className="muted">Try a wider period or another sport. The page does not fill gaps with sample results.</p></div>}
    </main>
  );
}
