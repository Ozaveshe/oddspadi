import React, { type CSSProperties } from "react";
import type { DecisionBeliefState } from "@/lib/sports/types";
import { clampProbability, formatPercent } from "@/lib/sports/prediction/format";

type ProbabilityMarkerProps = {
  className: string;
  label: string;
  value: number;
};

function finiteProbability(value: number | null): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function ProbabilityMarker({ className, label, value }: ProbabilityMarkerProps) {
  return (
    <span className={`calibration-marker ${className}`} style={{ left: `${clampProbability(value) * 100}%` }} aria-hidden="true">
      <i />
      <b>{label}</b>
    </span>
  );
}

export function CalibrationReliabilityBand({
  interval,
  modelProbability,
  marketProbability,
  selectionLabel
}: {
  interval: DecisionBeliefState["confidenceInterval"];
  modelProbability: number | null;
  marketProbability: number | null;
  selectionLabel: string | null;
}) {
  const low = interval.low;
  const high = interval.high;
  const isAvailable = interval.method === "wilson-calibration-bucket"
    && finiteProbability(low)
    && finiteProbability(high)
    && high >= low;
  const hasModelProbability = finiteProbability(modelProbability);
  const hasMarketProbability = finiteProbability(marketProbability);

  return (
    <figure className="calibration-reliability-chart" data-state={isAvailable ? "verified" : "unavailable"}>
      <figcaption>
        <div>
          <span className="calibration-eyebrow">Historical evidence</span>
          <strong>Historical calibration range</strong>
        </div>
        <span className={`badge ${isAvailable ? "positive" : "scheduled"}`}>
          {isAvailable ? "Verified 95% band" : "Not available"}
        </span>
      </figcaption>

      {isAvailable ? (
        <>
          <p className="calibration-selection">Settled outcomes for <strong>{selectionLabel ?? "the selected outcome"}</strong> at similar model probabilities.</p>
          <div
            className="calibration-ruler"
            role="img"
            aria-label={`Historical 95% calibration range ${formatPercent(low)} to ${formatPercent(high)}${hasModelProbability ? `, model probability ${formatPercent(modelProbability)}` : ""}${hasMarketProbability ? `, fair market probability ${formatPercent(marketProbability)}` : ""}.`}
          >
            <span
              className="calibration-band"
              style={{ left: `${low * 100}%`, width: `${(high - low) * 100}%` } as CSSProperties}
              aria-hidden="true"
            />
            {hasModelProbability ? <ProbabilityMarker className="model" label="Model" value={modelProbability} /> : null}
            {hasMarketProbability ? <ProbabilityMarker className="market" label="Market" value={marketProbability} /> : null}
          </div>
          <div className="calibration-axis" aria-hidden="true"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
          <dl className="calibration-legend">
            <div><dt>Observed 95% band</dt><dd>{formatPercent(low)}–{formatPercent(high)}</dd></div>
            {hasModelProbability ? <div><dt>Model chance</dt><dd>{formatPercent(modelProbability)}</dd></div> : null}
            {hasMarketProbability ? <div><dt>Fair market chance</dt><dd>{formatPercent(marketProbability)}</dd></div> : null}
          </dl>
          <p className="calibration-method">
            Wilson interval from {interval.sampleSize?.toLocaleString() ?? "an unreported number of"} settled predictions
            {interval.source ? ` · ${interval.source}` : ""}. This measures historical calibration in the active bucket; it is not a range of possible match outcomes or a guarantee.
          </p>
        </>
      ) : (
        <div className="calibration-unavailable" role="status">
          <strong>No statistical band is shown.</strong>
          <p>{interval.detail}</p>
        </div>
      )}
    </figure>
  );
}
