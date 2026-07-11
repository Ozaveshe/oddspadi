import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { DecisionAction, DecisionControlStatus, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionSlateThinkingStatus = "clear" | "watching" | "blocked";
export type DecisionSlateThoughtStatus = "supportive" | "contested" | "unproven" | "blocked";
export type DecisionSlateThoughtPriority = "critical" | "high" | "medium" | "low";

export type DecisionSlateThought = {
  id: string;
  matchId: string;
  match: string;
  league: string;
  country: string;
  kickoffTime: string;
  selection: string | null;
  baselineAction: DecisionAction;
  controlStatus: DecisionControlStatus;
  status: DecisionSlateThoughtStatus;
  priority: DecisionSlateThoughtPriority;
  workScore: number;
  confidenceScore: number;
  confidenceGrade: "high" | "medium" | "low";
  valueEdge: number | null;
  expectedValue: number | null;
  dataQualityScore: number;
  thesis: string;
  counterThesis: string;
  synthesis: string;
  riskSummary: string;
  saferAlternatives: string[];
  nextEvidenceAction: string;
  pressure: {
    supporting: number;
    questioning: number;
    needsEvidence: number;
    blocking: number;
    netScore: number;
  };
  evidenceGaps: string[];
  blockers: string[];
  watchReasons: string[];
  safeCommand: string;
  verifyUrl: string;
};

export type DecisionSlateThinking = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionSlateThinkingStatus;
  thinkingHash: string;
  summary: string;
  totalThoughts: number;
  supportive: number;
  contested: number;
  unproven: number;
  blocked: number;
  averageConfidenceScore: number;
  nextThought: DecisionSlateThought | null;
  thoughts: DecisionSlateThought[];
  policy: {
    canPromote: false;
    canPersist: false;
    canPublish: false;
    rule: string;
    verificationUrl: string;
  };
};

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compact(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 10): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function fallbackSaferAlternatives(row: DecisionRow): string[] {
  if (row.match.sport === "basketball") {
    return ["Reduce exposure through spread or total markets only after fresh pace, rest, and injury checks clear."];
  }
  if (row.match.sport === "tennis") {
    return ["Prefer set handicap or no-play until surface Elo, fatigue, and injury checks are refreshed."];
  }
  return [
    "Check double chance or draw no bet before any full-result lean.",
    "Compare over/under and both teams to score only after lineups, injuries, and weather signals are current."
  ];
}

function saferAlternativesFor(row: DecisionRow): string[] {
  const decision = row.prediction.decision;
  const alternatives = decision.saferAlternatives.map((alternative) =>
    `${alternative.market}: ${alternative.selection} - ${alternative.rationale}`
  );
  return unique([...alternatives, ...fallbackSaferAlternatives(row)], 4);
}

function riskSummaryFor({
  row,
  blockers,
  watchReasons,
  dataGaps
}: {
  row: DecisionRow;
  blockers: string[];
  watchReasons: string[];
  dataGaps: string[];
}): string {
  const decision = row.prediction.decision;
  const primaryRisk = unique(
    [
      blockers[0],
      decision.avoidReasons[0],
      decision.risks[0],
      watchReasons[0],
      dataGaps[0],
      decision.controlPolicy.summary,
      decision.dataCoverage.requiredBeforeTrust[0]
    ],
    1
  )[0];
  return compact(primaryRisk ?? "Risk is unresolved because live provider evidence and market freshness have not fully cleared.", 240);
}

function countTrue(values: boolean[]): number {
  return values.filter(Boolean).length;
}

function boundScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function confidenceGrade(score: number): DecisionSlateThought["confidenceGrade"] {
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function valueScore(edge: number | null, expectedValue: number | null): number {
  if (edge == null && expectedValue == null) return 35;
  const boundedEdge = edge == null ? 0 : Math.max(-0.08, Math.min(0.12, edge));
  const boundedEv = expectedValue == null ? 0 : Math.max(-0.12, Math.min(0.18, expectedValue));
  return 45 + boundedEdge * 230 + boundedEv * 170;
}

function controlScore(status: DecisionControlStatus): number {
  if (status === "publishable") return 82;
  if (status === "monitor-only") return 58;
  if (status === "needs-rerun") return 42;
  return 20;
}

function matchLabel(row: DecisionRow): string {
  return `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`;
}

function commandFor(matchId: string): string {
  return decisionCurlCommand(`/api/sports/decision/${encodeURIComponent(matchId)}`);
}

function statusFromPressure({
  controlStatus,
  supporting,
  questioning,
  needsEvidence,
  blocking,
  fragileMarket
}: {
  controlStatus: DecisionControlStatus;
  supporting: number;
  questioning: number;
  needsEvidence: number;
  blocking: number;
  fragileMarket: boolean;
}): DecisionSlateThoughtStatus {
  if (controlStatus === "blocked" || blocking > 0) return "blocked";
  if (needsEvidence >= Math.max(2, supporting)) return "unproven";
  if (fragileMarket || questioning >= supporting) return "contested";
  return "supportive";
}

function priorityFrom(status: DecisionSlateThoughtStatus, workScore: number): DecisionSlateThoughtPriority {
  if (status === "blocked" || workScore >= 78) return "critical";
  if (status === "unproven" || workScore >= 58) return "high";
  if (status === "contested" || workScore >= 34) return "medium";
  return "low";
}

function buildThought(row: DecisionRow): DecisionSlateThought {
  const decision = row.prediction.decision;
  const bestPick = row.prediction.bestPick;
  const selection = bestPick.hasValue ? bestPick.label : decision.recommendedSelection;
  const valueEdge = bestPick.hasValue ? bestPick.edge : decision.beliefState.probabilityEdge;
  const expectedValue = bestPick.hasValue ? bestPick.expectedValue : decision.beliefState.expectedValue;
  const dataGaps = unique(
    [
      ...decision.dataCoverage.requiredBeforeTrust,
      ...decision.researchBrief.dataGaps,
      ...decision.researchBrief.requiredChecks,
      ...decision.toolOrchestration.tasks
        .filter((task) => task.status === "missing-config" || task.status === "waiting" || task.status === "blocked")
        .map((task) => `${task.label}: ${task.reason}`),
      ...decision.toolExecution.attempts
        .filter((attempt) => attempt.status === "blocked" || attempt.status === "waiting")
        .map((attempt) => `${attempt.label}: ${attempt.nextAction}`),
      ...decision.reviewLoop.releaseCriteria,
      ...decision.nextChecks
    ],
    10
  );
  const blockers = unique(
    [
      ...decision.actionability.blockers,
      ...decision.controlPolicy.gates.filter((gate) => gate.status === "block").map((gate) => `${gate.label}: ${gate.detail}`),
      ...decision.toolExecution.attempts.filter((attempt) => attempt.status === "blocked").map((attempt) => `${attempt.label}: ${attempt.detail}`),
      decision.controlPolicy.status === "blocked" ? decision.controlPolicy.primaryDirective : null,
      decision.aiProtocol.status === "blocked" ? decision.aiProtocol.summary : null,
      decision.committee.consensus === "blocked" ? decision.committee.finalRationale : null
    ],
    8
  );
  const watchReasons = unique(
    [
      ...decision.committee.unresolvedDisagreements,
      ...decision.contradictionChecks.filter((item) => item.status !== "clear").map((item) => `${item.label}: ${item.detail}`),
      ...decision.marketMovement.alerts,
      ...decision.robustness.requiredRechecks,
      ...decision.decisionBoundary.flipTriggers,
      decision.uncertainty.primaryUncertainty,
      decision.marketMovement.status !== "resilient" ? decision.marketMovement.summary : null
    ],
    10
  );
  const supporting =
    countTrue([
      bestPick.hasValue && bestPick.edge > 0 && bestPick.expectedValue > 0,
      decision.oddsIntelligence.status === "positive-ev",
      decision.beliefState.grade === "strong" || decision.beliefState.grade === "moderate",
      decision.dataCoverage.score >= 70 && decision.dataCoverage.requiredBeforeTrust.length === 0,
      decision.robustness.status === "robust",
      decision.committee.consensus === "unanimous" || decision.committee.consensus === "leaning",
      decision.actionability.status === "actionable"
    ]) + Math.min(3, decision.evidence.filter((item) => item.impact === "positive").length);
  const questioning =
    countTrue([
      decision.risk === "high",
      decision.marketMovement.status === "sensitive" || decision.marketMovement.status === "fragile",
      decision.robustness.status !== "robust",
      decision.committee.consensus === "split",
      decision.uncertainty.status !== "controlled",
      decision.decisionBoundary.status !== "comfortable",
      decision.reviewLoop.unresolvedIssues.length > 0
    ]) +
    Math.min(
      5,
      decision.contradictionChecks.filter((item) => item.status !== "clear").length +
        decision.committee.unresolvedDisagreements.length +
        decision.evidence.filter((item) => item.impact === "negative").length
    );
  const needsEvidence =
    Math.min(8, dataGaps.length) +
    countTrue([
      decision.dataCoverage.status === "mock-backed" || decision.dataCoverage.status === "partial",
      decision.toolExecution.status === "partial",
      decision.toolOrchestration.status === "needs-tools",
      decision.aiProtocol.status === "needs-data",
      decision.controlPolicy.status === "needs-rerun"
    ]);
  const blocking =
    Math.min(6, blockers.length) +
    countTrue([
      decision.controlPolicy.status === "blocked",
      decision.actionability.status === "blocked",
      decision.toolExecution.status === "blocked",
      decision.toolOrchestration.status === "blocked",
      decision.aiProtocol.status === "blocked",
      decision.dataCoverage.status === "insufficient",
      decision.committee.consensus === "blocked"
    ]);
  const netScore = supporting * 2 - questioning - needsEvidence * 2 - blocking * 4;
  const confidenceScore = boundScore(
    valueScore(valueEdge, expectedValue) * 0.25 +
      decision.dataCoverage.score * 0.2 +
      decision.actionability.score * 0.2 +
      controlScore(decision.controlPolicy.status) * 0.2 +
      decision.calibration.reliabilityScore * 0.15 -
      Math.min(20, blockers.length * 3 + dataGaps.length)
  );
  const status = statusFromPressure({
    controlStatus: decision.controlPolicy.status,
    supporting,
    questioning,
    needsEvidence,
    blocking,
    fragileMarket: decision.marketMovement.status === "fragile"
  });
  const workScore = boundScore(blocking * 22 + needsEvidence * 10 + questioning * 7 + (100 - confidenceScore) * 0.35);
  const nextEvidenceAction =
    dataGaps[0] ??
    blockers[0] ??
    watchReasons[0] ??
    decision.controlPolicy.nextBestAction ??
    decision.marketMovement.nextAction ??
    "Re-run the deterministic decision with fresh provider evidence.";
  const statusVerb =
    status === "blocked"
      ? "blocked"
      : status === "unproven"
        ? "still unproven"
        : status === "contested"
          ? "contested"
          : "supportive";

  return {
    id: `slate-thought-${row.match.id}`,
    matchId: row.match.id,
    match: matchLabel(row),
    league: row.match.league.name,
    country: row.match.league.country,
    kickoffTime: row.match.kickoffTime,
    selection,
    baselineAction: decision.action,
    controlStatus: decision.controlPolicy.status,
    status,
    priority: priorityFrom(status, workScore),
    workScore,
    confidenceScore,
    confidenceGrade: confidenceGrade(confidenceScore),
    valueEdge,
    expectedValue,
    dataQualityScore: row.match.dataQualityScore,
    thesis: compact(decision.deliberation.primaryThesis || decision.summary, 240),
    counterThesis: compact(decision.deliberation.dissentingThesis || watchReasons[0] || "No counter-thesis is available.", 240),
    synthesis: compact(
      `${matchLabel(row)} is ${statusVerb}: ${supporting} support, ${questioning} question, ${needsEvidence} need evidence, ${blocking} block. Next evidence: ${nextEvidenceAction}`,
      280
    ),
    riskSummary: riskSummaryFor({ row, blockers, watchReasons, dataGaps }),
    saferAlternatives: saferAlternativesFor(row),
    nextEvidenceAction: compact(nextEvidenceAction, 220),
    pressure: {
      supporting,
      questioning,
      needsEvidence,
      blocking,
      netScore
    },
    evidenceGaps: dataGaps,
    blockers,
    watchReasons,
    safeCommand: commandFor(row.match.id),
    verifyUrl: `/api/sports/decision/${encodeURIComponent(row.match.id)}`
  };
}

function sortThoughts(thoughts: DecisionSlateThought[]): DecisionSlateThought[] {
  const priorityRank: Record<DecisionSlateThoughtPriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const statusRank: Record<DecisionSlateThoughtStatus, number> = { blocked: 4, unproven: 3, contested: 2, supportive: 1 };
  return thoughts.slice().sort((a, b) => {
    const priority = priorityRank[b.priority] - priorityRank[a.priority];
    if (priority !== 0) return priority;
    const status = statusRank[b.status] - statusRank[a.status];
    if (status !== 0) return status;
    return b.workScore - a.workScore;
  });
}

function averageConfidence(thoughts: DecisionSlateThought[]): number {
  if (!thoughts.length) return 0;
  return Number((thoughts.reduce((sum, item) => sum + item.confidenceScore, 0) / thoughts.length).toFixed(2));
}

export function buildDecisionSlateThinking({
  rows,
  date,
  sport,
  limit = 8
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  limit?: number;
}): DecisionSlateThinking {
  const allThoughts = sortThoughts(rows.map(buildThought));
  const thoughts = allThoughts.slice(0, Math.max(1, Math.min(40, limit)));
  const supportive = allThoughts.filter((item) => item.status === "supportive").length;
  const contested = allThoughts.filter((item) => item.status === "contested").length;
  const unproven = allThoughts.filter((item) => item.status === "unproven").length;
  const blocked = allThoughts.filter((item) => item.status === "blocked").length;
  const status: DecisionSlateThinkingStatus = blocked > 0 || !allThoughts.length ? "blocked" : unproven > 0 || contested > 0 ? "watching" : "clear";
  const nextThought = thoughts[0] ?? null;
  const thinkingHash = stableHash({
    date,
    sport,
    status,
    thoughts: allThoughts.map((item) => ({
      id: item.id,
      status: item.status,
      workScore: item.workScore,
      nextEvidenceAction: item.nextEvidenceAction
    }))
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    thinkingHash,
    summary: nextThought
      ? `Slate thinking is ${status}; next belief to investigate is ${nextThought.match} because ${nextThought.nextEvidenceAction}`
      : "Slate thinking is blocked because no match rows are available.",
    totalThoughts: allThoughts.length,
    supportive,
    contested,
    unproven,
    blocked,
    averageConfidenceScore: averageConfidence(allThoughts),
    nextThought,
    thoughts,
    policy: {
      canPromote: false,
      canPersist: false,
      canPublish: false,
      rule: "Slate thinking can only prioritize investigation; it cannot promote, persist, publish, or override deterministic control policy.",
      verificationUrl: `/api/sports/decision/slate-thinking?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`
    }
  };
}
