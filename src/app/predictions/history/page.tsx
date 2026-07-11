import type { Metadata } from "next";
import { formatOdds, formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import { getHistorySummary } from "@/lib/sports/prediction/history";
import { getPredictionHistory } from "@/lib/sports/service";

export const metadata: Metadata = {
  title: "Prediction Results & Accuracy — Wins and Losses",
  description:
    "OddsPadi shows every prediction result — wins and losses — with accuracy and a simple ROI simulation. Honest records, because trust is earned.",
  alternates: { canonical: "/predictions/history" },
  openGraph: {
    title: "Prediction Results & Accuracy — OddsPadi",
    description: "Every prediction result, wins and losses included. Honest records, because trust is earned."
  }
};

export default function PredictionHistoryPage() {
  const history = getPredictionHistory();
  const summary = getHistorySummary(history);

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <h1>
          Our results — <span className="accent">wins and losses</span>
        </h1>
        <p>
          Anyone can screenshot their wins. We keep everything: every pick, every outcome, good or bad. Past results
          never guarantee future ones — but they do show you how we&apos;re doing.
        </p>
      </div>

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

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Match</th>
              <th>Pick</th>
              <th>Odds</th>
              <th>Model</th>
              <th>Edge</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {history.map((item) => (
              <tr key={item.id}>
                <td>{item.date}</td>
                <td>{item.match}</td>
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
      </div>
    </main>
  );
}
