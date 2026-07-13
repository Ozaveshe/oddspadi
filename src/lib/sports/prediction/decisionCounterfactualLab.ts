import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { ConfidenceLevel, DecisionAction, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionCounterfactualLabStatus = "stable" | "sensitive" | "fragile" | "no-candidates";
export type DecisionCounterfactualType = "market" | "team-news" | "lineup" | "weather" | "data-quality" | "model-boundary" | "robustness";
export type DecisionCounterfactualSeverity = "low" | "medium" | "high" | "critical";

export type DecisionCounterfactualCase = {
  id: string;
  matchId: string;
  match: string;
  type: DecisionCounterfactualType;
  severity: DecisionCounterfactualSeverity;
  label: string;
  baselineAction: DecisionAction;
  actionAfterShock: DecisionAction;
  confidence: ConfidenceLevel;
  baselineScore: number;
  projectedScore: number | null;
  scoreDelta: number | null;
  probabilityShift: number | null;
  edgeAfterShock: number | null;
  expectedValueAfterShock: number | null;
  survival: "survives" | "downgrades" | "breaks";
  thesis: string;
  falsifier: string;
  mitigation: string;
  evidence: string[];
  verifyUrl: string;
  command: string;
};

export type DecisionCounterfactualLab = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionCounterfactualLabStatus;
  summary: string;
  totalCases: number;
  stableCases: number;
  downgradeCases: number;
  breakCases: number;
  criticalCases: number;
  averageScoreDelta: number;
  activeCase: DecisionCounterfactualCase | null;
  cases: DecisionCounterfactualCase[];
  decisionPolicy: {
    canPromote: false;
    canPersist: false;
    canPublish: false;
    nextSafeCommand: string | null;
    requiredBeforeTrust: string[];
    forbiddenActions: string[];
  };
};

function matchLabel(row: DecisionRow): string {
  return `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`;
}

function actionRank(action: DecisionAction): number {
  if (action === "consider") return 2;
  if (action === "monitor") return 1;
  return 0;
}

function confidenceFromSeverity(severity: DecisionCounterfactualSeverity): ConfidenceLevel {
  if (severity === "critical" || severity === "high") return "high";
  if (severity === "medium") return "medium";
  return "low";
}

function survivalForAction(baseline: DecisionAction, after: DecisionAction): DecisionCounterfactualCase["survival"] {
  const delta = actionRank(after) - actionRank(baseline);
  if (delta < 0) return after === "avoid" ? "breaks" : "downgrades";
  return "survives";
}

function severityForCase({
  survival,
  scoreDelta,
  action,
  edgeAfterShock,
  expectedValueAfterShock
}: {
  survival: DecisionCounterfactualCase["survival"];
  scoreDelta: number | null;
  action: DecisionAction;
  edgeAfterShock: number | null;
  expectedValueAfterShock: number | null;
}): DecisionCounterfactualSeverity {
  if (survival === "breaks") return "critical";
  if (survival === "downgrades") return action === "consider" ? "high" : "medium";
  if ((scoreDelta ?? 0) <= -20) return "high";
  if ((edgeAfterShock ?? 0) < 0 || (expectedValueAfterShock ?? 0) < 0) return "medium";
  return "low";
}

function commandFor(matchId: string): string {
  return decisionCurlCommand(`/api/sports/decision/${encodeURIComponent(matchId)}`);
}

function verifyUrl(matchId: string): string {
  return `/api/sports/decision/${encodeURIComponent(matchId)}`;
}

function caseFromScenario(row: DecisionRow, type: DecisionCounterfactualType, scenarioId: string): DecisionCounterfactualCase | null {
  const decision = row.prediction.decision;
  const scenario = decision.scenarioMatrix.find((item) => item.id === scenarioId);
  if (!scenario) {
    return {
      id: `${row.match.id}:market:unpriced`, matchId: row.match.id, match: matchLabel(row), type: "market", severity: "high",
      label: "Market price unavailable", baselineAction: decision.action, actionAfterShock: decision.action, confidence: "low",
      baselineScore: decision.decisionScore, projectedScore: null, scoreDelta: null, probabilityShift: null, edgeAfterShock: null,
      expectedValueAfterShock: null, survival: "downgrades", thesis: "No usable bookmaker scenario exists, so the model lean cannot be stress-tested against a price move.",
      falsifier: "A complete, fresh market price could materially change the edge and action.", mitigation: decision.marketMovement.nextAction,
      evidence: [decision.marketMovement.summary, "No priced market-movement scenario was available."], verifyUrl: verifyUrl(row.match.id), command: commandFor(row.match.id)
    };
  }
  const survival = survivalForAction(decision.action, scenario.projectedAction);
  const scoreDelta = scenario.projectedScore - decision.decisionScore;
  const severity = severityForCase({
    survival,
    scoreDelta,
    action: decision.action,
    edgeAfterShock: decision.marketMovement.currentEdge,
    expectedValueAfterShock: decision.marketMovement.currentExpectedValue
  });
  return {
    id: `${row.match.id}:${scenario.id}`,
    matchId: row.match.id,
    match: matchLabel(row),
    type,
    severity,
    label: scenario.label,
    baselineAction: decision.action,
    actionAfterShock: scenario.projectedAction,
    confidence: confidenceFromSeverity(severity),
    baselineScore: decision.decisionScore,
    projectedScore: scenario.projectedScore,
    scoreDelta,
    probabilityShift: null,
    edgeAfterShock: decision.marketMovement.currentEdge,
    expectedValueAfterShock: decision.marketMovement.currentExpectedValue,
    survival,
    thesis: scenario.detail,
    falsifier: decision.decisionBoundary.flipTriggers[0] ?? decision.deliberation.decisionIfMissingDataTurnsBad,
    mitigation: decision.decisionBoundary.nextAction,
    evidence: [decision.decisionBoundary.summary, decision.uncertainty.summary, decision.marketMovement.summary].slice(0, 4),
    verifyUrl: verifyUrl(row.match.id),
    command: commandFor(row.match.id)
  };
}

function caseFromRobustness(row: DecisionRow, type: DecisionCounterfactualType, caseId: string): DecisionCounterfactualCase | null {
  const decision = row.prediction.decision;
  const robustness = decision.robustness.cases.find((item) => item.id === caseId);
  if (!robustness) return null;
  const survival = survivalForAction(decision.action, robustness.actionAfterShock);
  const scoreDelta = robustness.status === "breaks" ? -34 : robustness.status === "downgrades" ? -18 : Math.round(robustness.probabilityShift * 100);
  const severity = severityForCase({
    survival,
    scoreDelta,
    action: decision.action,
    edgeAfterShock: robustness.edgeAfterShock,
    expectedValueAfterShock: robustness.expectedValueAfterShock
  });
  return {
    id: `${row.match.id}:robustness:${robustness.id}`,
    matchId: row.match.id,
    match: matchLabel(row),
    type,
    severity,
    label: robustness.label,
    baselineAction: decision.action,
    actionAfterShock: robustness.actionAfterShock,
    confidence: confidenceFromSeverity(severity),
    baselineScore: decision.decisionScore,
    projectedScore: Math.max(0, Math.min(100, decision.decisionScore + scoreDelta)),
    scoreDelta,
    probabilityShift: robustness.probabilityShift,
    edgeAfterShock: robustness.edgeAfterShock,
    expectedValueAfterShock: robustness.expectedValueAfterShock,
    survival,
    thesis: robustness.detail,
    falsifier: decision.robustness.requiredRechecks[0] ?? decision.reviewLoop.releaseCriteria[0] ?? decision.decisionBoundary.nearestFlip,
    mitigation: robustness.repair,
    evidence: [decision.robustness.summary, ...decision.robustness.requiredRechecks.slice(0, 2), decision.uncertainty.decisionImpact].filter(Boolean),
    verifyUrl: verifyUrl(row.match.id),
    command: commandFor(row.match.id)
  };
}

function caseFromMarketMove(row: DecisionRow): DecisionCounterfactualCase | null {
  const decision = row.prediction.decision;
  const scenario =
    decision.marketMovement.scenarios.find((item) => item.actionAfterMove !== decision.action) ??
    decision.marketMovement.scenarios.find((item) => item.edge !== null || item.expectedValue !== null);
  if (!scenario) return null;
  const survival = survivalForAction(decision.action, scenario.actionAfterMove);
  const severity = severityForCase({
    survival,
    scoreDelta: null,
    action: decision.action,
    edgeAfterShock: scenario.edge,
    expectedValueAfterShock: scenario.expectedValue
  });
  return {
    id: `${row.match.id}:market:${scenario.id}`,
    matchId: row.match.id,
    match: matchLabel(row),
    type: "market",
    severity,
    label: scenario.label,
    baselineAction: decision.action,
    actionAfterShock: scenario.actionAfterMove,
    confidence: confidenceFromSeverity(severity),
    baselineScore: decision.decisionScore,
    projectedScore: null,
    scoreDelta: null,
    probabilityShift: null,
    edgeAfterShock: scenario.edge,
    expectedValueAfterShock: scenario.expectedValue,
    survival,
    thesis: scenario.detail,
    falsifier: decision.marketMovement.alerts[0] ?? decision.marketMovement.nextAction,
    mitigation: decision.marketMovement.nextAction,
    evidence: [
      decision.marketMovement.summary,
      `Current edge ${decision.marketMovement.currentEdge ?? "unknown"}.`,
      `Max shortening before no value ${decision.marketMovement.maxShorteningBeforeNoValue ?? "unknown"}.`
    ],
    verifyUrl: verifyUrl(row.match.id),
    command: commandFor(row.match.id)
  };
}

function casesForRow(row: DecisionRow): DecisionCounterfactualCase[] {
  return [
    caseFromMarketMove(row),
    caseFromScenario(row, "team-news", "adverse-team-news"),
    caseFromScenario(row, "model-boundary", "odds-shortening"),
    caseFromScenario(row, "lineup", "context-upgrade"),
    caseFromRobustness(row, "weather", "adverse-context"),
    caseFromRobustness(row, "data-quality", "data-quality-decay"),
    caseFromRobustness(row, "robustness", row.prediction.decision.robustness.worstCase.id)
  ].filter((item): item is DecisionCounterfactualCase => Boolean(item));
}

function severityRank(severity: DecisionCounterfactualSeverity): number {
  if (severity === "critical") return 4;
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  return 1;
}

function survivalRank(survival: DecisionCounterfactualCase["survival"]): number {
  if (survival === "breaks") return 3;
  if (survival === "downgrades") return 2;
  return 1;
}

function sortCases(cases: DecisionCounterfactualCase[]): DecisionCounterfactualCase[] {
  return cases.slice().sort((a, b) => {
    const severity = severityRank(b.severity) - severityRank(a.severity);
    if (severity !== 0) return severity;
    const survival = survivalRank(b.survival) - survivalRank(a.survival);
    if (survival !== 0) return survival;
    return (a.scoreDelta ?? 0) - (b.scoreDelta ?? 0);
  });
}

function labStatus(cases: DecisionCounterfactualCase[]): DecisionCounterfactualLabStatus {
  if (!cases.length) return "no-candidates";
  if (cases.some((item) => item.severity === "critical" || item.survival === "breaks")) return "fragile";
  if (cases.some((item) => item.severity === "high" || item.survival === "downgrades")) return "sensitive";
  return "stable";
}

function averageScoreDelta(cases: DecisionCounterfactualCase[]): number {
  const deltas = cases.map((item) => item.scoreDelta).filter((value): value is number => typeof value === "number");
  if (!deltas.length) return 0;
  return Number((deltas.reduce((sum, value) => sum + value, 0) / deltas.length).toFixed(2));
}

export function buildDecisionCounterfactualLab({
  rows,
  date,
  sport,
  limit = 12
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  limit?: number;
}): DecisionCounterfactualLab {
  const allCases = sortCases(rows.flatMap(casesForRow));
  // A bounded response should still represent every available shock class;
  // otherwise many critical cases of one kind can hide an entire risk domain.
  const representatives = (["market", "team-news", "lineup", "weather", "data-quality", "model-boundary", "robustness"] as const)
    .map((type) => allCases.find((item) => item.type === type)).filter((item): item is DecisionCounterfactualCase => Boolean(item));
  const representativeIds = new Set(representatives.map((item) => item.id));
  const cases = [...representatives, ...allCases.filter((item) => !representativeIds.has(item.id))].slice(0, limit);
  const status = labStatus(allCases);
  const stableCases = allCases.filter((item) => item.survival === "survives").length;
  const downgradeCases = allCases.filter((item) => item.survival === "downgrades").length;
  const breakCases = allCases.filter((item) => item.survival === "breaks").length;
  const criticalCases = allCases.filter((item) => item.severity === "critical").length;
  const activeCase = cases[0] ?? null;

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    summary:
      status === "no-candidates"
        ? "Counterfactual lab has no decision rows to stress-test."
        : status === "fragile"
          ? `Counterfactual lab found ${breakCases} breaking shock(s); keep the agent in monitor or avoid mode.`
          : status === "sensitive"
            ? `Counterfactual lab found ${downgradeCases} downgrade shock(s); require rechecks before trust rises.`
            : `Counterfactual lab found ${stableCases} shock(s) that preserve the current action.`,
    totalCases: allCases.length,
    stableCases,
    downgradeCases,
    breakCases,
    criticalCases,
    averageScoreDelta: averageScoreDelta(allCases),
    activeCase,
    cases,
    decisionPolicy: {
      canPromote: false,
      canPersist: false,
      canPublish: false,
      nextSafeCommand: activeCase?.command ?? null,
      requiredBeforeTrust: Array.from(
        new Set(cases.flatMap((item) => [item.falsifier, item.mitigation]).filter(Boolean))
      ).slice(0, 8),
      forbiddenActions: [
        "Do not promote a pick because it survives one counterfactual.",
        "Do not persist or publish counterfactual output directly.",
        "Do not invent lineup, injury, weather, or odds movement outside supplied evidence.",
        "Do not ignore a breaking shock when the baseline action is consider."
      ]
    }
  };
}
