"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BET_SLIP_CHANGED_EVENT, readSlip, writeSlip, type SlipLeg } from "@/lib/sports/betSlip";
import { analyseWorkspace } from "@/lib/workspace/analysis";
import type { CanonicalSelection } from "@/lib/workspace/selection";

/**
 * The Bet Workspace.
 *
 * This used to call `analyzeSlip`, which multiplied every leg's probability
 * together regardless of whether the legs were related. Two selections on the
 * same match are not independent events, and the old summary reported a
 * confident combined chance for slips that were correlated — or that could not
 * land at all. It now runs the workspace engine, which says what it knows and
 * withholds a figure where an independence assumption would mislead.
 */
const percent = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value) ? "—" : `${Math.round(value * 100)}%`;

/**
 * Stored slip legs predate the canonical selection shape, so they carry no
 * market id, no timestamps and no fixture status. They are mapped honestly:
 * the unknown fields stay null and the engine reports them as gaps rather than
 * filling them in.
 */
function toCanonical(leg: SlipLeg): CanonicalSelection {
  return {
    legId: leg.id,
    fixtureId: leg.matchId,
    marketId: leg.id.split(":")[1] ?? "match_winner",
    selectionId: leg.id.split(":")[2] ?? leg.selection,
    label: leg.selection,
    fixtureLabel: leg.matchLabel,
    competition: leg.league,
    source: "Stored slip",
    userOdds: leg.decimalOdds,
    oddsObservedAt: null,
    modelProbability: leg.modelProbability,
    modelGeneratedAt: null,
    decisionState: null,
    publicationId: null,
    kickoffAt: leg.kickoffTime,
    fixtureStatus: "scheduled",
    marketSupported: true,
    modelInterval: null
  };
}

const BASIS_LABEL: Record<string, string> = {
  "independently-modelled": "Independently modelled",
  "correlation-adjusted": "Correlation adjusted",
  "correlation-unknown": "Correlation unknown",
  "combined-unavailable": "Combined model probability unavailable"
};

export function SlipCheckClient() {
  const [legs, setLegs] = useState<SlipLeg[]>([]);

  useEffect(() => {
    const sync = () => setLegs(readSlip());
    sync();
    window.addEventListener(BET_SLIP_CHANGED_EVENT, sync);
    return () => {
      window.removeEventListener(BET_SLIP_CHANGED_EVENT, sync);
    };
  }, []);

  const analysis = analyseWorkspace(legs.map(toCanonical));

  return (
    <>
      <section className="slip-summary panel">
        <div><span className="metric-label">Combined odds</span><strong>{analysis.combinedBookmakerOdds?.toFixed(2) ?? "—"}</strong></div>
        <div><span className="metric-label">Priced chance</span><strong>{percent(analysis.naiveImpliedProbability)}</strong></div>
        <div>
          <span className="metric-label">Model chance</span>
          <strong>
            {analysis.combinedModelProbability === null
              ? "Not available"
              : analysis.combinedModelRange
                ? `${percent(analysis.combinedModelRange.low)}–${percent(analysis.combinedModelRange.high)}`
                : percent(analysis.combinedModelProbability)}
          </strong>
        </div>
        <div><span className="metric-label">Basis</span><strong>{BASIS_LABEL[analysis.combinationBasis]}</strong></div>
        <div><span className="metric-label">Evidence</span><strong style={{ textTransform: "capitalize" }}>{analysis.evidenceQuality}</strong></div>
      </section>

      {legs.length ? <p className="slip-verdict">{analysis.combinationExplanation}</p> : null}

      {analysis.correlations.length ? (
        <section className="section" aria-labelledby="slip-correlation-heading">
          <h2 id="slip-correlation-heading" className="section-kicker">Correlation</h2>
          <ul className="slip-correlation-list">
            {analysis.correlations.map((finding, index) => (
              <li key={`${finding.kind}-${index}`} className={`slip-correlation ${finding.severity}`}>
                {finding.detail}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {legs.length ? (
        <div className="slip-legs">
          {analysis.legs.map((leg) => (
            <article className="panel slip-leg" key={leg.selection.legId}>
              <div>
                <span className="small muted">{leg.selection.competition}</span>
                <h2>{leg.selection.fixtureLabel}</h2>
                <p>
                  <strong>{leg.selection.label}</strong> · {leg.selection.userOdds.toFixed(2)} odds ·{" "}
                  {percent(leg.impliedProbability)} priced · {percent(leg.selection.modelProbability)} model
                  {leg.modelFairOdds ? ` · fair ${leg.modelFairOdds.toFixed(2)}` : ""}
                </p>
                <p className="muted small">{leg.note}</p>
                {leg.diagnostics.length ? (
                  <p className="slip-leg-diagnostics">
                    {leg.diagnostics.map((diagnostic) => (
                      <span className="badge scheduled" key={diagnostic}>{diagnostic.replaceAll("-", " ")}</span>
                    ))}
                  </p>
                ) : null}
              </div>
              <div className="card-actions">
                <Link className="button" href={`/predictions/${encodeURIComponent(leg.selection.fixtureId)}`}>Match Intelligence</Link>
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => writeSlip(legs.filter((item) => item.id !== leg.selection.legId))}
                >
                  Remove
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <h2>Your workspace is empty</h2>
          <p className="muted">Add priced model selections from any match page. Analysis only — no account needed.</p>
          <Link className="button primary" href="/predictions">Browse predictions</Link>
        </div>
      )}
      {legs.length ? (
        <button className="auth-text-button slip-clear" type="button" onClick={() => writeSlip([])}>Clear workspace</button>
      ) : null}
    </>
  );
}
