import React, { type CSSProperties } from "react";
import type { DecisionEngineReport, DecisionMarketAnalysis } from "@/lib/sports/types";
import { formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";

function finiteProbability(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function signedPoints(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pts`;
}

function factorBarStyle(value: number, maximum: number): CSSProperties {
  const width = maximum > 0 ? Math.min(50, Math.abs(value) / maximum * 50) : 0;
  return value >= 0
    ? { left: "50%", width: `${width}%` }
    : { left: `${50 - width}%`, width: `${width}%` };
}

function metric(value: number | null | undefined, formatter: (number: number) => string): string {
  return typeof value === "number" && Number.isFinite(value) ? formatter(value) : "Not established";
}

export function DecisionEvidenceProfile({
  decision,
  publicCandidate = null
}: {
  decision: DecisionEngineReport;
  publicCandidate?: DecisionMarketAnalysis | null;
}) {
  const traceMatchesPublicCandidate = !publicCandidate || (
    decision.probabilityTrace.marketId === publicCandidate.marketId &&
    decision.probabilityTrace.selection === publicCandidate.label
  );
  const separatedPublicCandidate = traceMatchesPublicCandidate ? null : publicCandidate;
  const probabilityStages = (separatedPublicCandidate
    ? [
        { id: "prior", label: "Fair market chance", value: separatedPublicCandidate.noVigImpliedProbability },
        { id: "posterior", label: "Model chance", value: separatedPublicCandidate.modelProbability }
      ]
    : [
        { id: "prior", label: "Starting prior", value: decision.probabilityTrace.basePriorProbability },
        { id: "model", label: "Model output", value: decision.probabilityTrace.modelProbability },
        { id: "posterior", label: "Final posterior", value: decision.probabilityTrace.posteriorProbability }
      ]
  ).filter((stage): stage is { id: string; label: string; value: number } => finiteProbability(stage.value));
  const factors = decision.factors
    .slice()
    .sort((left, right) => Math.abs(right.weightedScore) - Math.abs(left.weightedScore))
    .slice(0, 6);
  const maximumFactor = Math.max(0, ...factors.map((factor) => Math.abs(factor.weightedScore)));
  const uncertainty = decision.uncertainty.components
    .slice()
    .sort((left, right) => right.contribution - left.contribution)
    .slice(0, 4);
  const profile = decision.learningProfile;
  const calibration = decision.probabilityCalibration;
  const confidenceLow = decision.probabilityTrace.confidenceBand.low;
  const confidenceHigh = decision.probabilityTrace.confidenceBand.high;
  const hasConfidenceBand = !separatedPublicCandidate && finiteProbability(confidenceLow) && finiteProbability(confidenceHigh) && confidenceHigh >= confidenceLow;
  const visibleCandidateBlockers = separatedPublicCandidate?.blockers.slice(0, 5) ?? [];
  const hiddenCandidateBlockerCount = separatedPublicCandidate ? Math.max(0, separatedPublicCandidate.blockers.length - visibleCandidateBlockers.length) : 0;
  const journeySelection = separatedPublicCandidate?.label ?? decision.probabilityTrace.selection ?? "No publishable selection";
  const journeySummary = separatedPublicCandidate
    ? `${separatedPublicCandidate.label} is ${formatPercent(separatedPublicCandidate.modelProbability)} in the final model versus ${formatPercent(
        separatedPublicCandidate.noVigImpliedProbability
      )} from the margin-free market, a ${formatSignedPercent(separatedPublicCandidate.edge)} edge and ${formatSignedPercent(
        separatedPublicCandidate.expectedValue
      )} raw price EV before publication gates. Its canonical state is ${separatedPublicCandidate.analysisStatus.replaceAll("_", " ")}.`
    : decision.probabilityTrace.summary;

  return (
    <section className="panel decision-evidence-profile" aria-labelledby="decision-evidence-heading">
      <header className="decision-evidence-heading">
        <div>
          <span className="section-kicker">Model evidence</span>
          <h2 id="decision-evidence-heading">{separatedPublicCandidate ? "Evidence for the public candidate" : "How the engine reached this view"}</h2>
        </div>
        <span className={`badge ${decision.health === "stable" ? "positive" : decision.health === "review" ? "scheduled" : "no-value"}`}>
          {decision.health}
        </span>
      </header>
      <p className="muted small">
        {separatedPublicCandidate
          ? `The canonical public candidate differs from the engine's primary trace for ${decision.probabilityTrace.selection ?? "another selection"}. This view keeps their evidence separate instead of borrowing another market's factors.`
          : "This is the deterministic calculation path, not a generated explanation. Positive factors support the selected side; negative factors pull against it."}
      </p>

      <div className="decision-evidence-grid">
        <figure className="probability-journey">
          <figcaption>
            <strong>Probability journey</strong>
            <span>{journeySelection}</span>
          </figcaption>
          {probabilityStages.length ? (
            <>
              <div className="probability-journey-track" aria-label={probabilityStages.map((stage) => `${stage.label} ${formatPercent(stage.value)}`).join(", ")}>
                {hasConfidenceBand ? (
                  <span
                    className="probability-confidence-band"
                    style={{ left: `${confidenceLow * 100}%`, width: `${(confidenceHigh - confidenceLow) * 100}%` }}
                    aria-hidden="true"
                  />
                ) : null}
                {probabilityStages.map((stage, index) => (
                  <span className={`probability-stage stage-${stage.id}`} style={{ left: `${stage.value * 100}%` }} key={stage.id}>
                    <i aria-hidden="true" />
                    <b>{index + 1}</b>
                  </span>
                ))}
              </div>
              <ol className="probability-stage-list">
                {probabilityStages.map((stage, index) => <li key={stage.id}><span>{index + 1}</span><div><small>{stage.label}</small><strong>{formatPercent(stage.value)}</strong></div></li>)}
              </ol>
              <p>{journeySummary}</p>
            </>
          ) : <p className="muted">The engine did not produce a valid probability trace for this market.</p>}
        </figure>

        <div className="evidence-provenance">
          <strong>Model and calibration provenance</strong>
          <dl>
            <div><dt>Runtime model</dt><dd>{profile?.modelKey ?? "Current sport model"}</dd></div>
            <div><dt>Engine version</dt><dd>{decision.engineVersion}</dd></div>
            <div><dt>Learning profile</dt><dd>{profile?.status ?? "Not loaded"}</dd></div>
            <div><dt>Calibration</dt><dd>{calibration?.status ?? "Not attached"}</dd></div>
            <div><dt>Historical sample</dt><dd>{profile ? profile.sampleSize.toLocaleString() : "Not established"}</dd></div>
            <div><dt>Brier score</dt><dd>{metric(profile?.brierScore, (value) => value.toFixed(3))}</dd></div>
          </dl>
          <p>{calibration?.summary ?? profile?.reason ?? "No governed historical calibration profile was attached to this decision."}</p>
        </div>
      </div>

      {separatedPublicCandidate ? (
        <div className="decision-evidence-grid evidence-chart-grid canonical-candidate-grid">
          <section className="candidate-evidence-panel" aria-labelledby="candidate-gates-heading">
            <span className="section-kicker">Canonical gates</span>
            <h3 id="candidate-gates-heading">Why this candidate has its current status</h3>
            <dl className="candidate-evidence-metrics">
              <div><dt>Publication state</dt><dd>{separatedPublicCandidate.analysisStatus.replaceAll("_", " ")}</dd></div>
              <div><dt>Evidence quality</dt><dd>{separatedPublicCandidate.evidenceQuality}</dd></div>
              <div><dt>Data quality</dt><dd>{formatPercent(separatedPublicCandidate.dataQuality)}</dd></div>
              <div><dt>Raw price EV</dt><dd>{formatSignedPercent(separatedPublicCandidate.expectedValue)}</dd></div>
            </dl>
            {separatedPublicCandidate.blockers.length ? (
              <ul className="candidate-gate-list">
                {visibleCandidateBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                {hiddenCandidateBlockerCount > 0 ? <li>{hiddenCandidateBlockerCount} additional gate{hiddenCandidateBlockerCount === 1 ? "" : "s"} remain closed.</li> : null}
              </ul>
            ) : <p className="muted small">No canonical publication blocker is attached to this candidate.</p>}
          </section>

          <aside className="candidate-trace-separation" aria-label="Trace separation note">
            <span className="section-kicker">Trace boundary</span>
            <h3>Another selection owns the detailed factor trace</h3>
            <p>
              The weighted factor and uncertainty charts belong to <strong>{decision.probabilityTrace.selection ?? "the engine's primary selection"}</strong>
              {decision.probabilityTrace.marketId ? ` in ${decision.probabilityTrace.marketId.replaceAll("_", " ")}` : ""}. They are intentionally not reused for <strong>{separatedPublicCandidate.label}</strong>.
            </p>
            <dl>
              <div><dt>Primary trace</dt><dd>{decision.probabilityTrace.selection ?? "Unavailable"}</dd></div>
              <div><dt>Trace status</dt><dd>{decision.probabilityTrace.status}</dd></div>
            </dl>
            <p className="muted small">The collapsed advanced engine audit below retains that separate selection-specific trace.</p>
          </aside>
        </div>
      ) : (
        <div className="decision-evidence-grid evidence-chart-grid">
          <figure className="factor-contribution-chart">
            <figcaption><strong>Decision factor contribution</strong><span>Weighted points</span></figcaption>
            {factors.length ? <div className="factor-chart-rows">
              {factors.map((factor) => (
                <div className="factor-chart-row" key={factor.key}>
                  <div><span>{factor.label}</span><strong>{signedPoints(factor.weightedScore)}</strong></div>
                  <div className="factor-diverging-track" role="meter" aria-label={`${factor.label}: ${signedPoints(factor.weightedScore)}`} aria-valuemin={-100} aria-valuemax={100} aria-valuenow={factor.weightedScore}>
                    <i className={factor.weightedScore >= 0 ? "positive" : "negative"} style={factorBarStyle(factor.weightedScore, maximumFactor)} />
                  </div>
                </div>
              ))}
            </div> : <p className="muted">No weighted factors were emitted.</p>}
          </figure>

          <figure className="uncertainty-profile-chart">
            <figcaption><strong>Decision-risk profile</strong><span>{decision.uncertainty.score}/100 diagnostic index</span></figcaption>
            <div className="uncertainty-chart-rows">
              {uncertainty.map((component) => (
                <div className="uncertainty-chart-row" key={component.id}>
                  <div><span>{component.label}</span><strong>{component.score}/100</strong></div>
                  <div className="uncertainty-track" role="meter" aria-label={`${component.label}: ${component.score} out of 100`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={component.score}>
                    <i className={`level-${component.level}`} style={{ width: `${Math.max(0, Math.min(100, component.score))}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <p className="small muted">Weighted evidence-risk index, not a statistical confidence level.</p>
            <p><strong>{decision.uncertainty.primaryUncertainty}.</strong> {decision.uncertainty.decisionImpact} Confidence penalty {formatSignedPercent(-decision.uncertainty.confidencePenalty)}.</p>
          </figure>
        </div>
      )}
    </section>
  );
}
