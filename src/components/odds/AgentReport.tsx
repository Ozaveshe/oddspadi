import type { DecisionAiAgentResult, DecisionBoundaryMetric, DecisionEngineReport, FootballModelDiagnostics, PredictionAgentReport } from "@/lib/sports/types";
import { formatOdds, formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatBoundaryMetricNumber(metric: DecisionBoundaryMetric | undefined, value: number | null, role: "value" | "margin" = "value"): string {
  if (value === null || !Number.isFinite(value)) return "N/A";
  if (metric?.kind === "odds-floor") {
    if (role === "margin") return `${value >= 0 ? "+" : ""}${value.toFixed(2)} odds`;
    return formatOdds(value);
  }
  if (metric?.kind === "score-floor" || metric?.kind === "data-quality-floor" || metric?.kind === "uncertainty-ceiling") {
    if (role === "margin") return `${value >= 0 ? "+" : ""}${Math.round(value)} pts`;
    return `${Math.round(value)}/100`;
  }
  if (role === "margin") return formatSignedPercent(value);
  if (metric?.kind === "probability-floor" || metric?.kind === "price-shortening") return formatPercent(value);
  return formatSignedPercent(value);
}

export function AgentReport({
  report,
  diagnostics
}: {
  report: PredictionAgentReport;
  diagnostics: FootballModelDiagnostics;
}) {
  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2>Prediction agent report</h2>
          <p className="muted small">Verdict: {report.verdict.replaceAll("-", " ")}</p>
        </div>
        <span className={`badge ${diagnostics.uncertainty === "low" ? "low-risk" : diagnostics.uncertainty === "medium" ? "medium-risk" : "high-risk"}`}>
          {diagnostics.uncertainty} uncertainty
        </span>
      </div>
      <p>{report.summary}</p>
      <h3>Reasons</h3>
      <ul>
        {report.reasons.map((reason, index) => (
          <li key={`${reason}-${index}`}>{reason}</li>
        ))}
      </ul>
      <h3>Cautions</h3>
      <ul>
        {report.cautions.map((caution, index) => (
          <li key={`${caution}-${index}`}>{caution}</li>
        ))}
      </ul>
      <p className="small muted">
        Model {diagnostics.modelVersion}; data quality {formatPercent(diagnostics.dataQualityScore)}.
      </p>
    </div>
  );
}

export function DecisionEnginePanel({ decision }: { decision: DecisionEngineReport }) {
  const engineMode =
    decision.llmEnhanced && decision.llmModel
      ? `enhanced by ${decision.llmModel}`
      : decision.llmStatus && decision.llmStatus !== "not-requested"
        ? `AI status: ${decision.llmStatus.replaceAll("-", " ")}`
        : "rules and model reasoning";

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2>Decision engine</h2>
          <p className="muted small">
            {decision.engineVersion} - {engineMode}
          </p>
        </div>
        <span className={`badge ${decision.action === "consider" ? "positive" : decision.action === "monitor" ? "medium" : "no-value"}`}>
          {decision.verdict.replaceAll("-", " ")}
        </span>
      </div>
      <p>{decision.summary}</p>
      {decision.llmFailureReason ? <p className="small muted">AI provider note: {decision.llmFailureReason}</p> : null}
      {decision.aiAgentReviewed && decision.aiAgentStatus === "reviewed" ? (
        <p className="small muted">AI reviewer: {decision.aiAgentVerdict?.replaceAll("-", " ")}.</p>
      ) : decision.aiAgentStatus && decision.aiAgentStatus !== "not-requested" ? (
        <p className="small muted">AI audit did not complete; deterministic safeguards remain active.</p>
      ) : null}

      <h3>Research brief</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.researchBrief.status}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Decision clock</span>
          <span className="metric-value">{decision.researchBrief.decisionClock}</span>
        </div>
      </div>
      <p>{decision.researchBrief.headline}</p>
      <p className="small muted">{decision.researchBrief.executiveSummary}</p>
      <div className="match-list">
        <div className="metric">
          <span className="metric-label">Model thesis</span>
          <span className="metric-value">{decision.researchBrief.modelThesis}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Market thesis</span>
          <span className="metric-value">{decision.researchBrief.marketThesis}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Risk thesis</span>
          <span className="metric-value">{decision.researchBrief.riskThesis}</span>
        </div>
      </div>
      {decision.researchBrief.requiredChecks.length ? (
        <p className="small muted">Research checks: {decision.researchBrief.requiredChecks.slice(0, 5).join(" ")}</p>
      ) : null}

      <h3>Decision notebook</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.notebook.status.replace("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Assumptions</span>
          <span className="metric-value">{decision.notebook.assumptions.length}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Falsifiers</span>
          <span className="metric-value">{decision.notebook.falsifiers.length}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Next review</span>
          <span className="metric-value">{formatTime(decision.notebook.nextReviewAt)}</span>
        </div>
      </div>
      <p className="small muted">{decision.notebook.summary}</p>
      <div className="match-list">
        {decision.notebook.assumptions.slice(0, 3).map((item) => (
          <div className="metric" key={item.id}>
            <span className="metric-label">
              assumption - {item.priority} - {item.status}
            </span>
            <span className="metric-value">{item.label}</span>
            <p className="small muted">{item.detail}</p>
            <p className="small muted">Action: {item.action}</p>
          </div>
        ))}
        {decision.notebook.falsifiers.slice(0, 3).map((item) => (
          <div className="metric" key={item.id}>
            <span className="metric-label">
              falsifier - {item.priority} - {item.status}
            </span>
            <span className="metric-value">{item.label}</span>
            <p className="small muted">{item.detail}</p>
            <p className="small muted">Action: {item.action}</p>
          </div>
        ))}
      </div>
      {decision.notebook.operatorChecklist.length ? (
        <p className="small muted">
          Operator checklist: {decision.notebook.operatorChecklist.slice(0, 5).map((item) => `${item.label}: ${item.action}`).join(" ")}
        </p>
      ) : null}

      <h3>Agent calibration</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Health</span>
          <span className="metric-value">{decision.health}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Reliability</span>
          <span className="metric-value">{decision.calibration.reliabilityScore}/100</span>
        </div>
        <div className="metric">
          <span className="metric-label">Calibration action</span>
          <span className="metric-value">{decision.calibration.action}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Contradictions</span>
          <span className="metric-value">
            {decision.contradictionChecks.filter((check) => check.status === "conflict").length}
          </span>
        </div>
      </div>
      <p className="small muted">{decision.calibration.detail}</p>

      <h3>Data coverage</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.dataCoverage.status.replaceAll("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Score</span>
          <span className="metric-value">{decision.dataCoverage.score}/100</span>
        </div>
        <div className="metric">
          <span className="metric-label">Provider-backed</span>
          <span className="metric-value">{decision.dataCoverage.providerBackedSignals}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Mock</span>
          <span className="metric-value">{decision.dataCoverage.mockSignals}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Missing</span>
          <span className="metric-value">{decision.dataCoverage.missingSignals}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Stale</span>
          <span className="metric-value">{decision.dataCoverage.staleSignals}</span>
        </div>
      </div>
      <p className="small muted">{decision.dataCoverage.summary}</p>
      <div className="match-list">
        {decision.dataCoverage.signals.slice(0, 8).map((signal) => (
          <div className="metric" key={signal.id}>
            <span className="metric-label">
              {signal.status.replaceAll("-", " ")} - {signal.freshness.replaceAll("-", " ")} - {signal.source}
            </span>
            <span className="metric-value">{signal.label}</span>
            <p className="small muted">{signal.detail}</p>
          </div>
        ))}
      </div>
      {decision.dataCoverage.requiredBeforeTrust.length ? (
        <p className="small muted">Required before trust: {decision.dataCoverage.requiredBeforeTrust.join(" ")}</p>
      ) : null}

      <h3>Odds intelligence</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.oddsIntelligence.status.replaceAll("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Markets</span>
          <span className="metric-value">{decision.oddsIntelligence.totalMarkets}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Positive EV</span>
          <span className="metric-value">{decision.oddsIntelligence.positiveExpectedValueSelections}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Actionable</span>
          <span className="metric-value">{decision.oddsIntelligence.actionableSelections}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Avg margin</span>
          <span className="metric-value">
            {decision.oddsIntelligence.averageBookmakerMargin === null ? "N/A" : formatSignedPercent(decision.oddsIntelligence.averageBookmakerMargin)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Best actionable</span>
          <span className="metric-value">{decision.oddsIntelligence.bestActionableSelection?.label ?? "None"}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Watch leader</span>
          <span className="metric-value">{decision.oddsIntelligence.bestWatchlistSelection?.label ?? "None"}</span>
        </div>
      </div>
      <p className="small muted">{decision.oddsIntelligence.summary}</p>
      <div className="match-list">
        {decision.oddsIntelligence.topCandidates.slice(0, 4).map((candidate) => (
          <div className="metric" key={`${candidate.marketId}-${candidate.selectionId}`}>
            <span className="metric-label">
              {candidate.action} - {candidate.confidence} confidence - {candidate.risk} risk
            </span>
            <span className="metric-value">
              {candidate.label}: {formatOdds(candidate.odds)}
            </span>
            <p className="small muted">
              Model {formatPercent(candidate.modelProbability)}; no-vig {formatPercent(candidate.noVigImpliedProbability)}; edge{" "}
              {formatSignedPercent(candidate.edge)}; EV {formatSignedPercent(candidate.expectedValue)}; fair{" "}
              {candidate.fairOdds === null ? "N/A" : formatOdds(candidate.fairOdds)}. {candidate.reason}
              {typeof candidate.uncertaintyAdjustedScore === "number"
                ? ` Score ${candidate.uncertaintyAdjustedScore.toFixed(3)}.`
                : ""}
              {typeof candidate.priceShorteningTolerance === "number"
                ? ` Shortening tolerance ${formatPercent(candidate.priceShorteningTolerance)}.`
                : ""}
            </p>
          </div>
        ))}
      </div>
      <div className="match-list">
        {decision.oddsIntelligence.marketAudits.map((market) => (
          <div className="metric" key={market.marketId}>
            <span className="metric-label">
              {market.status.replaceAll("-", " ")} - margin {formatSignedPercent(market.bookmakerMargin)}
            </span>
            <span className="metric-value">{market.marketName}</span>
            <p className="small muted">{market.summary}</p>
          </div>
        ))}
      </div>
      {decision.oddsIntelligence.avoidReasons.length ? <p className="small muted">Avoid notes: {decision.oddsIntelligence.avoidReasons.join(" ")}</p> : null}
      {decision.oddsIntelligence.watchlistReasons.length ? (
        <p className="small muted">Watchlist notes: {decision.oddsIntelligence.watchlistReasons.join(" ")}</p>
      ) : null}

      <h3>Market movement intelligence</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.marketMovement.status.replace("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Current odds</span>
          <span className="metric-value">{decision.marketMovement.currentOdds === null ? "N/A" : formatOdds(decision.marketMovement.currentOdds)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Fair odds</span>
          <span className="metric-value">{decision.marketMovement.fairOdds === null ? "N/A" : formatOdds(decision.marketMovement.fairOdds)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Shortening room</span>
          <span className="metric-value">
            {decision.marketMovement.maxShorteningBeforeNoValue === null ? "N/A" : formatPercent(decision.marketMovement.maxShorteningBeforeNoValue)}
          </span>
        </div>
      </div>
      <p className="small muted">{decision.marketMovement.summary}</p>
      <div className="match-list">
        {decision.marketMovement.scenarios.map((scenario) => (
          <div className="metric" key={scenario.id}>
            <span className="metric-label">
              {scenario.label} - action {scenario.actionAfterMove}
            </span>
            <span className="metric-value">{scenario.odds === null ? "N/A" : formatOdds(scenario.odds)}</span>
            <p className="small muted">
              Edge {scenario.edge === null ? "N/A" : formatSignedPercent(scenario.edge)}; EV{" "}
              {scenario.expectedValue === null ? "N/A" : formatSignedPercent(scenario.expectedValue)}. {scenario.detail}
            </p>
          </div>
        ))}
      </div>
      {decision.marketMovement.alerts.length ? <p className="small muted">Movement alerts: {decision.marketMovement.alerts.join(" ")}</p> : null}

      <h3>Belief state</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Grade</span>
          <span className="metric-value">{decision.beliefState.grade}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Believed probability</span>
          <span className="metric-value">
            {decision.beliefState.believedProbability === null ? "No trusted pick" : formatPercent(decision.beliefState.believedProbability)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Probability edge</span>
          <span className="metric-value">
            {decision.beliefState.probabilityEdge === null ? "No edge" : formatSignedPercent(decision.beliefState.probabilityEdge)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Uncertainty</span>
          <span className="metric-value">{decision.beliefState.uncertaintyScore}/100</span>
        </div>
        <div className="metric">
          <span className="metric-label">Confidence band</span>
          <span className="metric-value">
            {decision.beliefState.confidenceInterval.low === null || decision.beliefState.confidenceInterval.high === null
              ? "No data"
              : `${formatPercent(decision.beliefState.confidenceInterval.low)}-${formatPercent(decision.beliefState.confidenceInterval.high)}`}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Expires</span>
          <span className="metric-value">{decision.beliefState.ttlMinutes} min</span>
        </div>
        <div className="metric">
          <span className="metric-label">Supports</span>
          <span className="metric-value">{decision.beliefState.evidenceBalance.supports}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Opposes</span>
          <span className="metric-value">{decision.beliefState.evidenceBalance.opposes}</span>
        </div>
      </div>
      <p className="small muted">{decision.beliefState.summary}</p>
      <div className="match-list">
        {decision.beliefState.signals.slice(0, 4).map((signal) => (
          <div className="metric" key={signal.id}>
            <span className="metric-label">
              {signal.direction} - {signal.confidence} confidence - {signal.source}
            </span>
            <span className="metric-value">{signal.label}</span>
            <p className="small muted">
              Impact {formatSignedPercent(signal.probabilityImpact)}. {signal.detail}
            </p>
          </div>
        ))}
      </div>
      <p className="small muted">Invalidates when: {decision.beliefState.invalidationTriggers.join(" ")}</p>

      <h3>Probability trace</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.probabilityTrace.status.replaceAll("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Market prior</span>
          <span className="metric-value">
            {decision.probabilityTrace.basePriorProbability === null ? "N/A" : formatPercent(decision.probabilityTrace.basePriorProbability)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Model probability</span>
          <span className="metric-value">
            {decision.probabilityTrace.modelProbability === null ? "N/A" : formatPercent(decision.probabilityTrace.modelProbability)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Posterior</span>
          <span className="metric-value">
            {decision.probabilityTrace.posteriorProbability === null ? "N/A" : formatPercent(decision.probabilityTrace.posteriorProbability)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Posterior edge</span>
          <span className="metric-value">
            {decision.probabilityTrace.posteriorEdge === null ? "N/A" : formatSignedPercent(decision.probabilityTrace.posteriorEdge)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Posterior EV</span>
          <span className="metric-value">
            {decision.probabilityTrace.posteriorExpectedValue === null ? "N/A" : formatSignedPercent(decision.probabilityTrace.posteriorExpectedValue)}
          </span>
        </div>
      </div>
      <p className="small muted">{decision.probabilityTrace.summary}</p>
      <div className="match-list">
        {decision.probabilityTrace.steps.slice(0, 8).map((step) => (
          <div className="metric" key={step.id}>
            <span className="metric-label">
              {step.kind.replaceAll("-", " ")} - {step.status} - weight {formatPercent(step.weight)}
            </span>
            <span className="metric-value">{step.label}</span>
            <p className="small muted">
              {step.priorProbability === null || step.posteriorProbability === null
                ? "No probability update."
                : `${formatPercent(step.priorProbability)} to ${formatPercent(step.posteriorProbability)} (${formatSignedPercent(step.probabilityDelta ?? 0)}).`}{" "}
              {step.detail}
            </p>
          </div>
        ))}
      </div>
      {decision.probabilityTrace.conflicts.length ? <p className="small muted">Trace conflicts: {decision.probabilityTrace.conflicts.join(" ")}</p> : null}
      <p className="small muted">Trace safeguards: {decision.probabilityTrace.safeguards.join(" ")}</p>

      <h3>Decision attribution</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.attribution.status}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Decisive factor</span>
          <span className="metric-value">{decision.attribution.decisiveFactor}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Value score</span>
          <span className="metric-value">{decision.attribution.valueScore}/100</span>
        </div>
        <div className="metric">
          <span className="metric-label">Risk score</span>
          <span className="metric-value">{decision.attribution.riskScore}/100</span>
        </div>
        <div className="metric">
          <span className="metric-label">Net movement</span>
          <span className="metric-value">
            {decision.attribution.netProbabilityMovement === null ? "N/A" : formatSignedPercent(decision.attribution.netProbabilityMovement)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Model-market gap</span>
          <span className="metric-value">
            {decision.attribution.modelMarketGap === null ? "N/A" : formatSignedPercent(decision.attribution.modelMarketGap)}
          </span>
        </div>
      </div>
      <p className="small muted">{decision.attribution.summary}</p>
      <div className="match-list">
        {[...decision.attribution.positiveDrivers.slice(0, 3), ...decision.attribution.negativeDrivers.slice(0, 3)].map((driver) => (
          <div className="metric" key={driver.id}>
            <span className="metric-label">
              {driver.direction} - {driver.category} - impact {driver.impactScore}/100
            </span>
            <span className="metric-value">{driver.label}</span>
            <p className="small muted">
              {driver.probabilityImpact === null ? "" : `Probability impact ${formatSignedPercent(driver.probabilityImpact)}. `}
              {driver.detail}
            </p>
          </div>
        ))}
      </div>
      {decision.attribution.missingDataDrag.length ? (
        <p className="small muted">Missing-data drag: {decision.attribution.missingDataDrag.map((driver) => driver.label).join(", ")}.</p>
      ) : null}
      <p className="small muted">{decision.attribution.explanation}</p>

      <h3>Uncertainty decomposition</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.uncertainty.status.replaceAll("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Score</span>
          <span className="metric-value">{decision.uncertainty.score}/100</span>
        </div>
        <div className="metric">
          <span className="metric-label">Primary</span>
          <span className="metric-value">{decision.uncertainty.primaryUncertainty}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Penalty</span>
          <span className="metric-value">{formatSignedPercent(-decision.uncertainty.confidencePenalty)}</span>
        </div>
      </div>
      <p className="small muted">{decision.uncertainty.summary}</p>
      <div className="match-list">
        {decision.uncertainty.components
          .slice()
          .sort((a, b) => b.contribution - a.contribution)
          .slice(0, 6)
          .map((component) => (
            <div className="metric" key={component.id}>
              <span className="metric-label">
                {component.level} - {component.category} - contribution {component.contribution.toFixed(1)}
              </span>
              <span className="metric-value">
                {component.label}: {component.score}/100
              </span>
              <p className="small muted">{component.detail}</p>
              <p className="small muted">Mitigation: {component.mitigation}</p>
            </div>
          ))}
      </div>
      <p className="small muted">Decision impact: {decision.uncertainty.decisionImpact}</p>

      <h3>Decision boundary</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.decisionBoundary.status.replaceAll("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Nearest flip</span>
          <span className="metric-value">{decision.decisionBoundary.nearestFlip}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Flip margin</span>
          <span className="metric-value">
            {decision.decisionBoundary.flipMargin === null
              ? "N/A"
              : formatBoundaryMetricNumber(
                  decision.decisionBoundary.metrics.find((metric) => metric.margin === decision.decisionBoundary.flipMargin) ??
                    decision.decisionBoundary.metrics[0],
                  decision.decisionBoundary.flipMargin,
                  "margin"
                )}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Next action</span>
          <span className="metric-value">{decision.decisionBoundary.nextAction}</span>
        </div>
      </div>
      <p className="small muted">{decision.decisionBoundary.summary}</p>
      <div className="match-list">
        {decision.decisionBoundary.metrics.map((metric) => (
          <div className="metric" key={metric.id}>
            <span className="metric-label">
              {metric.kind.replaceAll("-", " ")} - {metric.status}
            </span>
            <span className="metric-value">{metric.label}</span>
            <p className="small muted">
              Current {formatBoundaryMetricNumber(metric, metric.current)}; threshold {formatBoundaryMetricNumber(metric, metric.threshold)};
              margin {formatBoundaryMetricNumber(metric, metric.margin, "margin")}. {metric.detail}
            </p>
          </div>
        ))}
      </div>
      <p className="small muted">Must stay true: {decision.decisionBoundary.requiredToStayConsider.join(" ")}</p>
      <p className="small muted">Flip triggers: {decision.decisionBoundary.flipTriggers.join(" ")}</p>

      <h3>AI protocol</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.aiProtocol.status.replaceAll("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Mode</span>
          <span className="metric-value">{decision.aiProtocol.mode.replaceAll("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Questions answered</span>
          <span className="metric-value">
            {decision.aiProtocol.questions.filter((question) => question.status === "answered").length}/{decision.aiProtocol.questions.length}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Tool gaps</span>
          <span className="metric-value">{decision.aiProtocol.toolRequests.filter((tool) => tool.status === "missing").length}</span>
        </div>
      </div>
      <p className="small muted">{decision.aiProtocol.summary}</p>
      <div className="match-list">
        {decision.aiProtocol.questions.slice(0, 6).map((question) => (
          <div className="metric" key={question.id}>
            <span className="metric-label">
              {question.status.replaceAll("-", " ")} - evidence {question.evidenceIds.join(", ")}
            </span>
            <span className="metric-value">{question.prompt}</span>
            <p className="small muted">{question.answer}</p>
            {question.followUp ? <p className="small muted">Follow-up: {question.followUp}</p> : null}
          </div>
        ))}
      </div>
      <div className="match-list">
        {decision.aiProtocol.toolRequests.slice(0, 5).map((tool) => (
          <div className="metric" key={tool.id}>
            <span className="metric-label">
              {tool.priority} priority - {tool.status} - {tool.provider}
            </span>
            <span className="metric-value">{tool.label}</span>
            <p className="small muted">{tool.reason}</p>
            <p className="small muted">Unlocks: {tool.unlocks}</p>
          </div>
        ))}
      </div>
      <p className="small muted">Reviewer guardrails: {decision.aiProtocol.guardrails.join(" ")}</p>

      <h3>Reasoning graph</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.reasoningGraph.status}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Nodes</span>
          <span className="metric-value">{decision.reasoningGraph.nodes.length}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Edges</span>
          <span className="metric-value">{decision.reasoningGraph.edges.length}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Watch nodes</span>
          <span className="metric-value">{decision.reasoningGraph.unresolvedNodes.length}</span>
        </div>
      </div>
      <p className="small muted">{decision.reasoningGraph.summary}</p>
      <div className="match-list">
        {decision.reasoningGraph.nodes.slice(0, 8).map((node) => (
          <div className="metric" key={node.id}>
            <span className="metric-label">
              {node.type} - {node.status} - strength {node.strength}/100
            </span>
            <span className="metric-value">{node.label}</span>
            <p className="small muted">{node.detail}</p>
            {node.evidenceIds.length ? <p className="small muted">Evidence: {node.evidenceIds.join(", ")}</p> : null}
          </div>
        ))}
      </div>
      <p className="small muted">
        Strongest path: {decision.reasoningGraph.strongestPath.length ? decision.reasoningGraph.strongestPath.join(" -> ") : "none"}.
      </p>
      <p className="small muted">
        Blocking path: {decision.reasoningGraph.blockingPath.length ? decision.reasoningGraph.blockingPath.join(" -> ") : "none"}.
      </p>

      <h3>Tool orchestration</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.toolOrchestration.status.replaceAll("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Readiness</span>
          <span className="metric-value">{decision.toolOrchestration.readinessScore}/100</span>
        </div>
        <div className="metric">
          <span className="metric-label">Next task</span>
          <span className="metric-value">{decision.toolOrchestration.nextTaskId ?? "none"}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Stale after</span>
          <span className="metric-value">
            {decision.toolOrchestration.staleAfterMinutes === null ? "N/A" : `${decision.toolOrchestration.staleAfterMinutes} min`}
          </span>
        </div>
      </div>
      <p className="small muted">{decision.toolOrchestration.summary}</p>
      <div className="match-list">
        {decision.toolOrchestration.tasks.slice(0, 8).map((task) => (
          <div className="metric" key={task.id}>
            <span className="metric-label">
              {task.priority} priority - {task.status.replaceAll("-", " ")} - {task.category.replaceAll("-", " ")}
            </span>
            <span className="metric-value">{task.label}</span>
            <p className="small muted">
              Provider: {task.provider}. Depends on: {task.dependsOn.length ? task.dependsOn.join(", ") : "none"}.
            </p>
            <p className="small muted">{task.reason}</p>
            <p className="small muted">Decision impact: {task.decisionImpact}</p>
          </div>
        ))}
      </div>
      <p className="small muted">
        Blocking tasks: {decision.toolOrchestration.blockingTasks.length ? decision.toolOrchestration.blockingTasks.join(", ") : "none"}.
      </p>
      <p className="small muted">Execution order: {decision.toolOrchestration.executionOrder.join(" -> ")}.</p>

      <h3>Tool execution audit</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.toolExecution.status}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Executed</span>
          <span className="metric-value">
            {decision.toolExecution.executedTasks}/{decision.toolExecution.totalTasks}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Blocked</span>
          <span className="metric-value">{decision.toolExecution.blockedTasks}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Skipped</span>
          <span className="metric-value">{decision.toolExecution.skippedTasks}</span>
        </div>
      </div>
      <p className="small muted">{decision.toolExecution.summary}</p>
      <div className="match-list">
        {decision.toolExecution.attempts.slice(0, 8).map((attempt) => (
          <div className="metric" key={attempt.id}>
            <span className="metric-label">
              {attempt.priority} priority - {attempt.status} - {attempt.provider}
            </span>
            <span className="metric-value">
              {attempt.label}
              {attempt.observedRecords === null ? "" : ` - ${attempt.observedRecords} record(s)`}
            </span>
            <p className="small muted">{attempt.detail}</p>
            <p className="small muted">Outputs: {attempt.outputSignals.join(", ")}</p>
          </div>
        ))}
      </div>
      <p className="small muted">Next run: {decision.toolExecution.nextRun}</p>

      <h3>Control policy</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.controlPolicy.status.replaceAll("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Visibility</span>
          <span className="metric-value">{decision.controlPolicy.visibility.replaceAll("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Mode</span>
          <span className="metric-value">{decision.controlPolicy.automationMode.replaceAll("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Primary blocker</span>
          <span className="metric-value">{decision.controlPolicy.primaryBlockerId ?? "none"} </span>
        </div>
      </div>
      <p className="small muted">{decision.controlPolicy.summary}</p>
      <p className="small muted">Directive: {decision.controlPolicy.primaryDirective}</p>
      <p className="small muted">Next best action: {decision.controlPolicy.nextBestAction}</p>
      <div className="match-list">
        {decision.controlPolicy.gates.slice(0, 8).map((gate) => (
          <div className="metric" key={gate.id}>
            <span className="metric-label">
              {gate.source} - {gate.status}
            </span>
            <span className="metric-value">{gate.label}</span>
            <p className="small muted">{gate.detail}</p>
            {gate.requiredAction ? <p className="small muted">Required: {gate.requiredAction}</p> : null}
          </div>
        ))}
      </div>
      <p className="small muted">Allowed: {decision.controlPolicy.allowedActions.join("; ")}</p>
      <p className="small muted">Forbidden: {decision.controlPolicy.forbiddenActions.join("; ")}</p>

      <h3>Monitoring plan</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.monitoringPlan.status}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Priority</span>
          <span className="metric-value">{decision.monitoringPlan.priority}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Cadence</span>
          <span className="metric-value">{decision.monitoringPlan.reviewCadenceMinutes} min</span>
        </div>
        <div className="metric">
          <span className="metric-label">Next review</span>
          <span className="metric-value">{formatTime(decision.monitoringPlan.nextReviewAt)}</span>
        </div>
      </div>
      <p className="small muted">{decision.monitoringPlan.summary}</p>
      <div className="match-list">
        {decision.monitoringPlan.tasks.slice(0, 4).map((task) => (
          <div className="metric" key={task.id}>
            <span className="metric-label">
              {task.priority} priority - {task.source.toString().replaceAll("-", " ")} - due {formatTime(task.dueAt)}
            </span>
            <span className="metric-value">{task.label}</span>
            <p className="small muted">{task.trigger}</p>
            <p className="small muted">Action: {task.action}</p>
          </div>
        ))}
      </div>
      <p className="small muted">Stop when: {decision.monitoringPlan.stopConditions.join(" ")}</p>
      <p className="small muted">Escalate when: {decision.monitoringPlan.escalationRules.join(" ")}</p>

      <h3>Actionability audit</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.actionability.status.replaceAll("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Posture</span>
          <span className="metric-value">{decision.actionability.posture.replaceAll("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Score</span>
          <span className="metric-value">{decision.actionability.score}/100</span>
        </div>
        <div className="metric">
          <span className="metric-label">Failed gates</span>
          <span className="metric-value">{decision.actionability.gates.filter((gate) => gate.status === "fail").length}</span>
        </div>
      </div>
      <p className="small muted">{decision.actionability.summary}</p>
      <div className="match-list">
        {decision.actionability.gates.slice(0, 5).map((gate) => (
          <div className="metric" key={gate.id}>
            <span className="metric-label">
              {gate.status} - weight {formatPercent(gate.weight)}
            </span>
            <span className="metric-value">
              {gate.label}: {gate.score}/100
            </span>
            <p className="small muted">{gate.detail}</p>
            {gate.requiredAction ? <p className="small muted">Required: {gate.requiredAction}</p> : null}
          </div>
        ))}
      </div>
      {decision.actionability.blockers.length ? <p className="small muted">Blockers: {decision.actionability.blockers.join(" ")}</p> : null}
      {decision.actionability.requiredBeforeAction.length ? (
        <p className="small muted">Before action: {decision.actionability.requiredBeforeAction.join(" ")}</p>
      ) : null}
      <p className="small muted">{decision.actionability.responsibleUse.join(" ")}</p>

      <h3>Review loop</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.reviewLoop.status}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Recommended action</span>
          <span className="metric-value">{decision.reviewLoop.recommendedAction}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Score delta</span>
          <span className="metric-value">{decision.reviewLoop.scoreDelta}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Shifts</span>
          <span className="metric-value">
            {decision.reviewLoop.confidenceShift}/{decision.reviewLoop.riskShift}
          </span>
        </div>
      </div>
      <p className="small muted">{decision.reviewLoop.summary}</p>
      <div className="match-list">
        {decision.reviewLoop.steps.map((step) => (
          <div className="metric" key={step.id}>
            <span className="metric-label">
              {step.role.replaceAll("-", " ")} - {step.verdict} - {step.confidence} confidence
            </span>
            <span className="metric-value">{step.summary}</span>
            {step.evidence.length ? <p className="small muted">Evidence: {step.evidence.join(" ")}</p> : null}
            {step.requiredChange ? <p className="small muted">Required: {step.requiredChange}</p> : null}
          </div>
        ))}
      </div>
      {decision.reviewLoop.repairsApplied.length ? <p className="small muted">Repairs: {decision.reviewLoop.repairsApplied.join(" ")}</p> : null}
      {decision.reviewLoop.unresolvedIssues.length ? <p className="small muted">Unresolved: {decision.reviewLoop.unresolvedIssues.join(" ")}</p> : null}
      <p className="small muted">Release criteria: {decision.reviewLoop.releaseCriteria.join(" ")}</p>

      <h3>Robustness stress test</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.robustness.status}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Score</span>
          <span className="metric-value">{decision.robustness.score}/100</span>
        </div>
        <div className="metric">
          <span className="metric-label">Survival rate</span>
          <span className="metric-value">{formatPercent(decision.robustness.survivalRate)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Worst case</span>
          <span className="metric-value">{decision.robustness.worstCase.label}</span>
        </div>
      </div>
      <p className="small muted">{decision.robustness.summary}</p>
      <div className="match-list">
        {decision.robustness.cases.map((item) => (
          <div className="metric" key={item.id}>
            <span className="metric-label">
              {item.status} - shift {formatSignedPercent(item.probabilityShift)}
            </span>
            <span className="metric-value">
              {item.label}: {item.actionAfterShock}
            </span>
            <p className="small muted">
              Edge {item.edgeAfterShock === null ? "N/A" : formatSignedPercent(item.edgeAfterShock)}; EV{" "}
              {item.expectedValueAfterShock === null ? "N/A" : formatSignedPercent(item.expectedValueAfterShock)}. {item.detail}
            </p>
            <p className="small muted">Repair: {item.repair}</p>
          </div>
        ))}
      </div>
      {decision.robustness.hedgeSuggestions.length ? <p className="small muted">Hedges: {decision.robustness.hedgeSuggestions.join(" ")}</p> : null}
      <p className="small muted">Required rechecks: {decision.robustness.requiredRechecks.join(" ")}</p>

      <h3>Evaluation plan</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.evaluationPlan.status.replaceAll("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Settlement</span>
          <span className="metric-value">{decision.evaluationPlan.settlementSelection ?? "No public pick"}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Model prob.</span>
          <span className="metric-value">
            {decision.evaluationPlan.modelProbability === null ? "N/A" : formatPercent(decision.evaluationPlan.modelProbability)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Break-even</span>
          <span className="metric-value">
            {decision.evaluationPlan.breakEvenProbability === null ? "N/A" : formatPercent(decision.evaluationPlan.breakEvenProbability)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Quoted odds</span>
          <span className="metric-value">{decision.evaluationPlan.quotedOdds === null ? "N/A" : formatOdds(decision.evaluationPlan.quotedOdds)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Target CLV</span>
          <span className="metric-value">
            {decision.evaluationPlan.targetClosingLineValue === null ? "N/A" : formatSignedPercent(decision.evaluationPlan.targetClosingLineValue)}
          </span>
        </div>
      </div>
      <p className="small muted">{decision.evaluationPlan.summary}</p>
      <div className="match-list">
        {decision.evaluationPlan.requiredOutcomeSignals.map((signal) => (
          <div className="metric" key={signal.id}>
            <span className="metric-label">
              {signal.status} - {signal.source}
            </span>
            <span className="metric-value">{signal.label}</span>
            <p className="small muted">{signal.detail}</p>
          </div>
        ))}
      </div>
      <p className="small muted">Success: {decision.evaluationPlan.successCriteria.join(" ")}</p>
      <p className="small muted">Failure: {decision.evaluationPlan.failureCriteria.join(" ")}</p>
      <p className="small muted">Learning questions: {decision.evaluationPlan.learningQuestions.join(" ")}</p>
      <p className="small muted">Post-match actions: {decision.evaluationPlan.postMatchActions.join(" ")}</p>

      <h3>Case memory</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Status</span>
          <span className="metric-value">{decision.caseMemory.status.replace("-", " ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Similar cases</span>
          <span className="metric-value">{decision.caseMemory.similarCases.length}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Adjustment</span>
          <span className="metric-value">{decision.caseMemory.adjustment}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Avg similarity</span>
          <span className="metric-value">
            {decision.caseMemory.averageSimilarity === null ? "No data" : formatPercent(decision.caseMemory.averageSimilarity)}
          </span>
        </div>
      </div>
      <p className="small muted">{decision.caseMemory.summary}</p>
      {decision.caseMemory.similarCases.length ? (
        <div className="match-list">
          {decision.caseMemory.similarCases.slice(0, 3).map((item) => (
            <div className="metric" key={item.id}>
              <span className="metric-label">
                similarity {formatPercent(item.similarity)} - {item.action} - {item.health}
              </span>
              <span className="metric-value">{item.recommendedSelection ?? "No clear value found"}</span>
              <p className="small muted">
                {item.fixtureExternalId}; score {item.decisionScore}; reliability{" "}
                {item.reliabilityScore === null ? "N/A" : `${item.reliabilityScore}/100`}; {item.rationale}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {decision.learningProfile ? (
        <>
          <h3>Learning profile</h3>
          <div className="metrics-grid">
            <div className="metric">
              <span className="metric-label">Training status</span>
              <span className="metric-value">{decision.learningProfile.status.replaceAll("-", " ")}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Real fixtures</span>
              <span className="metric-value">
                {decision.learningProfile.realFinishedFixtures}/{decision.learningProfile.minimumRecommendedFixtures}
              </span>
            </div>
            <div className="metric">
              <span className="metric-label">Learned edge</span>
              <span className="metric-value">
                {decision.learningProfile.minimumEdge === null ? "Default" : formatSignedPercent(decision.learningProfile.minimumEdge)}
              </span>
            </div>
            <div className="metric">
              <span className="metric-label">Backtest yield</span>
              <span className="metric-value">
                {decision.learningProfile.yield === null ? "No data" : formatSignedPercent(decision.learningProfile.yield)}
              </span>
            </div>
          </div>
          <p className="small muted">{decision.learningProfile.reason}</p>
        </>
      ) : null}

      <h3>Decision score</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Score</span>
          <span className="metric-value">{decision.decisionScore}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Action</span>
          <span className="metric-value">{decision.action}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Confidence</span>
          <span className="metric-value">{decision.confidence}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Risk</span>
          <span className="metric-value">{decision.risk}</span>
        </div>
      </div>

      <h3>Agent stages</h3>
      <div className="match-list">
        {decision.agentStages.map((stage) => (
          <div className="metric" key={stage.id}>
            <span className="metric-label">
              {stage.label} - {stage.status}
            </span>
            <span className="metric-value">{stage.score}/100</span>
            <p className="small muted">{stage.detail}</p>
          </div>
        ))}
      </div>

      <h3>Decision committee</h3>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Consensus</span>
          <span className="metric-value">{decision.committee.consensus}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Final action</span>
          <span className="metric-value">{decision.committee.recommendedAction}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Consider votes</span>
          <span className="metric-value">{decision.committee.voteCounts.consider}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Avoid votes</span>
          <span className="metric-value">{decision.committee.voteCounts.avoid}</span>
        </div>
      </div>
      <p className="small muted">{decision.committee.finalRationale}</p>
      <div className="match-list">
        {decision.committee.members.map((member) => (
          <div className="metric" key={member.id}>
            <span className="metric-label">
              {member.role.replaceAll("-", " ")} - {member.stance} - votes {member.vote}
            </span>
            <span className="metric-value">{member.label}</span>
            <p className="small muted">{member.thesis}</p>
            {member.objections.length ? <p className="small muted">Challenge: {member.objections.join(" ")}</p> : null}
            {member.requiredChecks.length ? <p className="small muted">Checks: {member.requiredChecks.join(" ")}</p> : null}
          </div>
        ))}
      </div>
      {decision.committee.unresolvedDisagreements.length ? (
        <p className="small muted">Open disagreements: {decision.committee.unresolvedDisagreements.join(" ")}</p>
      ) : null}

      <h3>Agent deliberation</h3>
      <div className="match-list">
        <div className="metric">
          <span className="metric-label">Primary thesis</span>
          <span className="metric-value">{decision.deliberation.primaryThesis}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Dissenting thesis</span>
          <span className="metric-value">{decision.deliberation.dissentingThesis}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Synthesis</span>
          <span className="metric-value">{decision.deliberation.synthesis}</span>
        </div>
      </div>

      <div className="scoreline-grid">
        {decision.deliberation.hypotheses.map((hypothesis) => (
          <div className="metric" key={hypothesis.id}>
            <span className="metric-label">
              {hypothesis.status.replace("-", " ")} - {hypothesis.confidence} confidence
            </span>
            <span className="metric-value">{hypothesis.label}</span>
            <p className="small muted">{hypothesis.detail}</p>
            <p className="small muted">Impact: {hypothesis.decisionImpact}</p>
          </div>
        ))}
      </div>

      <h3>What would change the decision</h3>
      <div className="match-list">
        {decision.deliberation.watchItems.map((item) => (
          <div className="metric" key={item.id}>
            <span className="metric-label">
              {item.priority} priority - {item.signalType.replace("-", " ")}
            </span>
            <span className="metric-value">{item.label}</span>
            <p className="small muted">{item.whyItMatters}</p>
            <p className="small muted">If confirmed: {item.actionIfConfirmed}</p>
          </div>
        ))}
      </div>
      <p className="small muted">
        Bad-data path: {decision.deliberation.decisionIfMissingDataTurnsBad} Market-move path:{" "}
        {decision.deliberation.decisionIfMarketMoves}
      </p>

      {decision.contextAdjustment ? (
        <>
          <h3>Context adjustment</h3>
          <div className="metrics-grid">
            <div className="metric">
              <span className="metric-label">Home shift</span>
              <span className="metric-value">{formatSignedPercent(decision.contextAdjustment.probabilityShift.home)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Away shift</span>
              <span className="metric-value">{formatSignedPercent(decision.contextAdjustment.probabilityShift.away)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Total shift</span>
              <span className="metric-value">{formatSignedPercent(decision.contextAdjustment.totalShift)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Signals</span>
              <span className="metric-value">{decision.contextAdjustment.signals.length}</span>
            </div>
          </div>
          <p className="small muted">{decision.contextAdjustment.summary}</p>
          <div className="match-list">
            {decision.contextAdjustment.signals.slice(0, 4).map((signal) => (
              <div className="metric" key={signal.id}>
                <span className="metric-label">
                  {signal.category} - {signal.quality} - {signal.impact.replace("-", " ")}
                </span>
                <span className="metric-value">{signal.label}</span>
                <p className="small muted">{signal.detail}</p>
              </div>
            ))}
          </div>
        </>
      ) : null}

      <h3>Weighted factors</h3>
      <div className="match-list">
        {decision.factors.map((factor) => (
          <div className="metric" key={factor.key}>
            <span className="metric-label">
              {factor.label} - score {factor.score} - weight {factor.weight}
            </span>
            <span className="metric-value">{factor.weightedScore}</span>
            <p className="small muted">{factor.explanation}</p>
          </div>
        ))}
      </div>

      <h3>Self-critique checks</h3>
      <div className="match-list">
        {decision.contradictionChecks.map((check) => (
          <div className="metric" key={check.id}>
            <span className="metric-label">
              {check.label} - {check.status}
            </span>
            <p className="small muted">{check.detail}</p>
          </div>
        ))}
      </div>

      <h3>Public reasoning trace</h3>
      <ol>
        {decision.publicReasoningSteps.map((step, index) => (
          <li key={`${step}-${index}`}>{step}</li>
        ))}
      </ol>

      <h3>Evidence reviewed</h3>
      <div className="match-list">
        {decision.evidence.map((item) => (
          <div className="metric" key={`${item.category}-${item.label}`}>
            <span className="metric-label">
              {item.category.replace("-", " ")} - {item.quality} - {item.impact}
            </span>
            <span className="metric-value">{item.label}</span>
            <p className="small muted">{item.detail}</p>
          </div>
        ))}
      </div>

      {decision.avoidReasons.length ? (
        <>
          <h3>Why to avoid forcing it</h3>
          <ul>
            {decision.avoidReasons.map((reason, index) => (
              <li key={`${reason}-${index}`}>{reason}</li>
            ))}
          </ul>
        </>
      ) : null}

      <h3>Safer alternatives to review</h3>
      <div className="scoreline-grid">
        {decision.saferAlternatives.map((alternative) => (
          <div className="metric" key={`${alternative.market}-${alternative.selection}`}>
            <span className="metric-label">
              {alternative.market} - {alternative.risk} risk
            </span>
            <span className="metric-value">{alternative.selection}</span>
            <p className="small muted">
              Model {formatPercent(alternative.modelProbability)} - fair odds{" "}
              {alternative.fairOdds ? formatOdds(alternative.fairOdds) : "N/A"}
              {!alternative.availableInMvp ? " - needs bookmaker market" : ""}
            </p>
          </div>
        ))}
      </div>

      <h3>Risks and next checks</h3>
      <ul>
        {decision.risks.concat(decision.nextChecks).map((risk, index) => (
          <li key={`${risk}-${index}`}>{risk}</li>
        ))}
      </ul>

      <h3>Sensitivity checks</h3>
      <ul>
        {decision.sensitivityChecks.map((check) => (
          <li key={check.label}>
            <strong>{check.label}:</strong> {check.effect.replaceAll("-", " ")}. {check.detail}
          </li>
        ))}
      </ul>

      <h3>Scenario matrix</h3>
      <div className="scoreline-grid">
        {decision.scenarioMatrix.map((scenario) => (
          <div className="metric" key={scenario.id}>
            <span className="metric-label">
              {scenario.label} - {scenario.projectedAction}
            </span>
            <span className="metric-value">
              {scenario.projectedScore} ({scenario.scoreImpact >= 0 ? "+" : ""}
              {scenario.scoreImpact})
            </span>
            <p className="small muted">{scenario.detail}</p>
          </div>
        ))}
      </div>

      <h3>Abstention gates</h3>
      <div className="match-list">
        {decision.abstentionRules.map((rule) => (
          <div className="metric" key={rule.id}>
            <span className="metric-label">
              {rule.label} - {rule.triggered ? "triggered" : "clear"}
            </span>
            <p className="small muted">{rule.detail}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function AiDecisionAgentReviewPanel({ result }: { result: DecisionAiAgentResult }) {
  if (!result.requested) return null;

  return (
    <div className="panel">
      <div className="panel-header">
        <div>
          <h2>AI reviewer</h2>
          <p className="muted small">
            {result.model ?? "deterministic guardrail"} - {result.status.replaceAll("-", " ")}
          </p>
        </div>
        <span className={`badge ${result.status === "reviewed" ? "positive" : result.status === "not-configured" ? "medium" : "no-value"}`}>
          {result.review?.reviewVerdict.replaceAll("-", " ") ?? result.status.replaceAll("-", " ")}
        </span>
      </div>

      {result.review ? (
        <>
          <p>{result.review.summary}</p>
          <div className="metrics-grid">
            <div className="metric">
              <span className="metric-label">AI action</span>
              <span className="metric-value">{result.review.recommendedAction}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Applied action</span>
              <span className="metric-value">{result.decision.action}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Confidence</span>
              <span className="metric-value">{result.review.confidenceAdjustment}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Risk</span>
              <span className="metric-value">{result.review.riskAdjustment}</span>
            </div>
          </div>

          <h3>Reviewer rationale</h3>
          <ul>
            {result.review.rationale.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>

          <h3>Evidence-cited audit</h3>
          <p className="small muted">{result.review.auditSummary}</p>
          <div className="match-list">
            {result.review.evidenceChecks.map((check) => (
              <div className="metric" key={check.id}>
                <span className="metric-label">
                  {check.status} - {check.label}
                </span>
                <span className="metric-value">{check.citedEvidenceIds.length ? check.citedEvidenceIds.join(", ") : "No accepted citations"}</span>
                <p className="small muted">{check.finding}</p>
                {check.requiredFollowUp ? <p className="small muted">Follow-up: {check.requiredFollowUp}</p> : null}
              </div>
            ))}
          </div>

          <h3>AI safety gates</h3>
          <div className="match-list">
            {result.review.safetyGates.map((gate) => (
              <div className="metric" key={gate.id}>
                <span className="metric-label">
                  {gate.status} - {gate.label}
                </span>
                <p className="small muted">{gate.reason}</p>
              </div>
            ))}
          </div>
          {result.review.unsupportedClaims.length ? (
            <>
              <h3>Unsupported claims</h3>
              <ul>
                {result.review.unsupportedClaims.map((item, index) => (
                  <li key={`${item}-${index}`}>{item}</li>
                ))}
              </ul>
            </>
          ) : null}

          <h3>Risk flags and data gaps</h3>
          <ul>
            {result.review.riskFlags.concat(result.review.dataGaps).map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>

          <h3>Checks before action</h3>
          <ul>
            {result.review.checksBeforeAction.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </>
      ) : (
        <p className="muted">{result.reason ?? "AI reviewer did not run."}</p>
      )}
    </div>
  );
}

export function ModelDiagnostics({ diagnostics }: { diagnostics: FootballModelDiagnostics }) {
  const unit = diagnostics.scoreUnit ?? "goals";
  return (
    <div className="panel">
      <h2>Model mathematics</h2>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Home expected {unit}</span>
          <span className="metric-value">{diagnostics.expectedGoals.home.toFixed(2)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Away expected {unit}</span>
          <span className="metric-value">{diagnostics.expectedGoals.away.toFixed(2)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Total expected {unit}</span>
          <span className="metric-value">{diagnostics.expectedGoals.total.toFixed(2)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Winner probability sum</span>
          <span className="metric-value">{diagnostics.homeDrawAwayTotal.toFixed(3)}</span>
        </div>
      </div>
      {diagnostics.topOutcomeLabel ? <p className="small muted">{diagnostics.topOutcomeLabel}</p> : null}
      <h3>Top projected scores</h3>
      <div className="scoreline-grid">
        {diagnostics.topCorrectScores.map((scoreline) => (
          <div className="metric" key={`${scoreline.homeGoals}-${scoreline.awayGoals}`}>
            <span className="metric-label">
              {scoreline.homeGoals}-{scoreline.awayGoals}
            </span>
            <span className="metric-value">{formatPercent(scoreline.probability)}</span>
          </div>
        ))}
      </div>
      <h3>Signals</h3>
      <ul>
        {diagnostics.signalScores.map((signal) => (
          <li key={signal.label}>
            <strong>{signal.label}:</strong> {signal.value} <span className="muted">{signal.note}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
