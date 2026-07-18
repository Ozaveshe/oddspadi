import * as React from "react";
import { formatOdds, formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import { formatFairOdds } from "@/lib/sports/prediction/decisionMarketIntelligence";
import type { MarketPriorReceipt } from "@/lib/sports/prediction/marketPriorPresentation";
import { buildMarketPriorPresentation } from "@/lib/sports/prediction/marketPriorPresentation";
import type { ExecutionPriceReceipt } from "@/lib/sports/prediction/executionPricePresentation";
import { buildExecutionPricePresentation } from "@/lib/sports/prediction/executionPricePresentation";
import type { PublicationGateReceipt } from "@/lib/sports/prediction/publicationGatePresentation";
import { buildPublicationGatePresentation } from "@/lib/sports/prediction/publicationGatePresentation";
import type { ValueEdgeEconomicConfidence } from "@/lib/sports/types";
import { buildEconomicConfidencePresentation } from "@/lib/sports/prediction/economicConfidencePresentation";

type DecisionPriceSignalProps = {
  modelProbability: number;
  marketProbability: number;
  currentOdds: number;
  edge: number;
  expectedValue: number;
  marketPriorReceipt?: MarketPriorReceipt | null;
  executionPriceReceipt?: ExecutionPriceReceipt | null;
  publicationGateReceipt?: PublicationGateReceipt | null;
  economicConfidenceReceipt?: ValueEdgeEconomicConfidence | null;
  compact?: boolean;
};

function probabilityWidth(value: number): string {
  return `${Math.max(0, Math.min(100, value * 100)).toFixed(1)}%`;
}

export function DecisionPriceSignal({
  modelProbability,
  marketProbability,
  currentOdds,
  edge,
  expectedValue,
  marketPriorReceipt,
  executionPriceReceipt,
  publicationGateReceipt,
  economicConfidenceReceipt,
  compact = false
}: DecisionPriceSignalProps) {
  const modelWidth = { "--decision-probability-width": probabilityWidth(modelProbability) } as React.CSSProperties;
  const marketWidth = { "--decision-probability-width": probabilityWidth(marketProbability) } as React.CSSProperties;
  const marketPrior = buildMarketPriorPresentation(marketPriorReceipt);
  const executionPrice = buildExecutionPricePresentation(executionPriceReceipt);
  const publicationGate = buildPublicationGatePresentation(publicationGateReceipt);
  const economicConfidence = buildEconomicConfidencePresentation(economicConfidenceReceipt);
  const comparisonLabel = `OddsPadi model ${formatPercent(modelProbability)}; bookmaker consensus no-vig probability ${formatPercent(marketProbability)}; executable odds ${formatOdds(currentOdds)} from ${executionPrice.source}; edge ${formatSignedPercent(edge)}; ${publicationGate.label}; ${economicConfidence.label}; ${marketPrior.label}.`;

  return (
    <figure className={`decision-price-signal${compact ? " compact" : ""}`} aria-label={comparisonLabel}>
      <header>
        <figcaption>Price case</figcaption>
        <span>Model versus consensus and executable price</span>
      </header>
      <div className="decision-probability-compare" aria-hidden="true">
        <div>
          <span>OddsPadi</span>
          <i><b className="model" style={modelWidth} /></i>
          <strong>{formatPercent(modelProbability)}</strong>
        </div>
        <div>
          <span>Book fair</span>
          <i><b className="market" style={marketWidth} /></i>
          <strong>{formatPercent(marketProbability)}</strong>
        </div>
      </div>
      <dl>
        <div><dt>Fair odds</dt><dd>{formatFairOdds(modelProbability)}</dd></div>
        <div><dt>Quoted odds</dt><dd>{formatOdds(currentOdds)}</dd></div>
        <div className={edge > 0 ? "positive" : "negative"}><dt>Probability edge</dt><dd>{formatSignedPercent(edge)}</dd></div>
        <div className={expectedValue > 0 ? "positive" : "negative"}><dt>Expected value</dt><dd>{formatSignedPercent(expectedValue)}</dd></div>
      </dl>
      <div className="decision-publication-gate" data-state={publicationGate.state}>
        <i aria-hidden="true" />
        <div><strong>{publicationGate.label}</strong><small>{publicationGate.detail}</small></div>
        <span>{publicationGate.shortLabel}</span>
      </div>
      <div className="decision-economic-confidence" data-state={economicConfidence.state}>
        <i aria-hidden="true" />
        <div><strong>{economicConfidence.label}</strong><small>{economicConfidence.detail}</small></div>
        <span>{economicConfidence.shortLabel}</span>
      </div>
      <div className="decision-execution-price" data-state={executionPrice.state}>
        <div><strong>{executionPrice.label}</strong><small>{executionPrice.detail}</small></div>
        <span>{executionPrice.source}</span>
      </div>
      <div className="decision-market-confidence" data-state={marketPrior.state}>
        <i aria-hidden="true" />
        <div><strong>{marketPrior.label}</strong><small>{marketPrior.detail}</small></div>
        {marketPrior.influenceLabel ? <span>{marketPrior.influenceLabel}</span> : null}
      </div>
      {!compact ? <p className="decision-market-boundary">The consensus calibrates model probability and supplies the no-vig comparison. The named bookmaker quote remains a separate executable price for expected-value analysis.</p> : null}
    </figure>
  );
}
