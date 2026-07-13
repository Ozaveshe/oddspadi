import Link from "next/link";
import { formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import { getHistorySummary, type PublicPredictionHistoryItem } from "@/lib/sports/prediction/history";

export function RecordStrip({ items, compact = false }: { items: PublicPredictionHistoryItem[]; compact?: boolean }) {
  const summary = getHistorySummary(items);
  const lastTen = items.filter((item) => item.result === "won" || item.result === "lost").slice(0, 10);
  return <section className={`record-strip${compact ? " compact" : ""}`} aria-label="OddsPadi public prediction record">
    <div><span className="section-kicker">Our record</span><strong>{summary.settled ? `${formatPercent(summary.accuracy)} accuracy` : "Awaiting settled picks"}</strong></div>
    <div><span>Settled</span><strong>{summary.settled}</strong></div><div><span>ROI simulation</span><strong>{formatSignedPercent(summary.roi)}</strong></div>
    <div className="record-form" aria-label="Last ten settled results">{lastTen.length ? lastTen.map((item) => <i key={item.id} className={item.result} title={`${item.match}: ${item.result}`} />) : <span className="muted small">No settled form yet</span>}</div>
    <Link className="text-link" href="/predictions/history">Every win and loss →</Link>
  </section>;
}
