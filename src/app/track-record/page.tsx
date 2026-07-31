import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo/pageMetadata";
import { PromotionGateBoard } from "@/components/odds/PromotionGateBoard";
import { readPromotionGateStatus } from "@/lib/sports/promotionGateStatus";
import { getCachedHomepageModelRecordSummary } from "@/lib/sports/tips/publicReads";

export const revalidate = 300;

export const metadata: Metadata = pageMetadata({
  title: "Track Record — Results, Performance & Methodology",
  description:
    "OddsPadi's accountability surface: published picks and their settlements, the internal model record, live promotion gates, calibration and methodology — nothing hidden, nothing faked.",
  path: "/track-record",
  socialTitle: "Track Record — OddsPadi",
  socialDescription: "Every published pick settled in public, and the gates the model must pass."
});

/**
 * Track Record unifies what used to be four scattered destinations (Results,
 * Value Picks, Performance, Engine) into one accountability surface. It
 * composes the same reads those pages use — never a private re-derivation —
 * and links into them as the deep record (docs/route-map.md).
 */
export default async function TrackRecordPage() {
  const [record, gateStatus] = await Promise.all([
    getCachedHomepageModelRecordSummary().catch(() => null),
    readPromotionGateStatus("football").catch(() => null)
  ]);
  const graded = record ? record.won + record.lost : 0;

  return (
    <main id="main" className="container">
      <div className="page-heading">
        <span className="section-kicker">Track Record</span>
        <h1>Judge the model by its <span className="accent">ledger</span></h1>
        <p>Published picks settle in public with their original odds. Until the model earns publication, its internal record and the seven gates below show exactly how far it is from that bar — the numbers are the engine&apos;s own, not marketing.</p>
      </div>

      <section className="section" aria-labelledby="record-yesterday-heading">
        <div className="section-title"><div><span className="section-kicker">Yesterday</span><h2 id="record-yesterday-heading">Internal model record</h2></div><Link className="button primary" href="/predictions/history">Full results ledger</Link></div>
        {record && graded > 0 ? (
          <div className="metrics-grid">
            <div className="metric"><span className="metric-label">Model wins</span><span className="metric-value">{record.won}</span></div>
            <div className="metric"><span className="metric-label">Model losses</span><span className="metric-value">{record.lost}</span></div>
            <div className="metric"><span className="metric-label">Pending</span><span className="metric-value">{record.pending}</span></div>
            <div className="metric"><span className="metric-label">Hit rate</span><span className="metric-value">{Math.round((record.won / graded) * 100)}%</span></div>
          </div>
        ) : (
          <p className="muted small">Yesterday&apos;s grading has not landed yet — the settlement sweep runs hourly. The full ledger has the complete history.</p>
        )}
        <p className="muted small">Internal record: every decision the engine grades against final scores, published or not. Published picks are the subset that cleared all gates — see the ledger for those.</p>
      </section>

      {gateStatus ? (
        <section className="section" aria-labelledby="record-gates-heading">
          <div className="section-title"><div><span className="section-kicker">Road to publication</span><h2 id="record-gates-heading">The seven promotion gates, live</h2></div><Link className="button" href="/predictions/decision-engine">Engine status</Link></div>
          <PromotionGateBoard status={gateStatus} />
        </section>
      ) : null}

      <section className="section" aria-labelledby="record-deep-heading">
        <div className="section-title"><div><span className="section-kicker">The deep record</span><h2 id="record-deep-heading">Everything you can audit</h2></div></div>
        <div className="explore-tile-row">
          <Link className="explore-tile" href="/predictions/history"><strong>Results</strong><span>Published picks, settlements, ROI</span></Link>
          <Link className="explore-tile" href="/predictions/value-picks"><strong>Value Picks</strong><span>Current published selections</span></Link>
          <Link className="explore-tile" href="/engine/performance"><strong>Performance</strong><span>Calibration &amp; analytics</span></Link>
          <Link className="explore-tile" href="/predictions/decision-engine"><strong>Engine</strong><span>Gates, freshness, automation</span></Link>
        </div>
      </section>

      <section className="section" aria-labelledby="record-method-heading">
        <div className="section-title"><div><span className="section-kicker">Methodology</span><h2 id="record-method-heading">How this record stays honest</h2></div></div>
        <ul className="muted">
          <li>Every decision is graded against final scores by an hourly automated sweep — including the calls the engine withheld.</li>
          <li>Settlement uses the odds recorded when the decision was made, and closing prices are captured for closing-line value.</li>
          <li>Corrections are append-only: a wrong number is corrected forward and noted, never silently rewritten.</li>
          <li>No gate is ever lowered to make picks appear; publication opens when all seven hold.</li>
        </ul>
      </section>
    </main>
  );
}
