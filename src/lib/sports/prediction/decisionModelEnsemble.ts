import type { ConfidenceLevel, DecisionAction, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionModelEnsembleStatus = "aligned" | "contested" | "blocked" | "no-candidates";
export type DecisionModelEnsembleJudgeId =
  | "sport-model"
  | "market-model"
  | "posterior-belief"
  | "data-quality"
  | "calibration-memory"
  | "risk-robustness"
  | "actionability";
export type DecisionModelEnsembleJudgeVerdict = "support" | "watch" | "oppose" | "block";
export type DecisionModelEnsembleConsensus = "unanimous" | "majority" | "split" | "blocked";

export type DecisionModelEnsembleJudge = {
  id: DecisionModelEnsembleJudgeId;
  label: string;
  verdict: DecisionModelEnsembleJudgeVerdict;
  action: DecisionAction;
  probability: number | null;
  edge: number | null;
  expectedValue: number | null;
  score: number;
  weight: number;
  confidence: ConfidenceLevel;
  detail: string;
  evidence: string[];
};

export type DecisionModelEnsembleCandidate = {
  matchId: string;
  match: string;
  league: string;
  kickoffTime: string;
  selection: string | null;
  baseAction: DecisionAction;
  ensembleAction: DecisionAction;
  consensus: DecisionModelEnsembleConsensus;
  agreementScore: number;
  weightedScore: number;
  decisionScore: number;
  modelProbability: number | null;
  marketProbability: number | null;
  posteriorProbability: number | null;
  valueEdge: number | null;
  expectedValue: number | null;
  dataCoverageScore: number;
  judges: DecisionModelEnsembleJudge[];
  conflicts: string[];
  blockers: string[];
  nextCheck: string;
};

export type DecisionModelEnsemble = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionModelEnsembleStatus;
  summary: string;
  totalCandidates: number;
  alignedCandidates: number;
  contestedCandidates: number;
  blockedCandidates: number;
  topCandidate: DecisionModelEnsembleCandidate | null;
  candidates: DecisionModelEnsembleCandidate[];
  slateConflicts: string[];
  modelHealth: {
    averageWeightedScore: number;
    averageAgreementScore: number;
    publishableCandidates: number;
    monitorCandidates: number;
    avoidedCandidates: number;
  };
};

function matchLabel(row: DecisionRow): string {
  return `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`;
}

function round(value: number, digits = 2): number {
  return Number(value.toFixed(digits));
}

function actionRank(action: DecisionAction): number {
  if (action === "consider") return 2;
  if (action === "monitor") return 1;
  return 0;
}

function safestAction(actions: DecisionAction[]): DecisionAction {
  return actions.reduce((lowest, action) => (actionRank(action) < actionRank(lowest) ? action : lowest), "consider" as DecisionAction);
}

function verdictScore(verdict: DecisionModelEnsembleJudgeVerdict): number {
  if (verdict === "support") return 100;
  if (verdict === "watch") return 62;
  if (verdict === "oppose") return 26;
  return 0;
}

function confidenceFromScore(score: number): ConfidenceLevel {
  if (score >= 74) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function actionFromVerdict(verdict: DecisionModelEnsembleJudgeVerdict): DecisionAction {
  if (verdict === "support") return "consider";
  if (verdict === "watch") return "monitor";
  return "avoid";
}

function judge(input: {
  id: DecisionModelEnsembleJudgeId;
  label: string;
  verdict: DecisionModelEnsembleJudgeVerdict;
  probability?: number | null;
  edge?: number | null;
  expectedValue?: number | null;
  weight: number;
  detail: string;
  evidence: string[];
}): DecisionModelEnsembleJudge {
  const score = verdictScore(input.verdict);
  return {
    id: input.id,
    label: input.label,
    verdict: input.verdict,
    action: actionFromVerdict(input.verdict),
    probability: input.probability ?? null,
    edge: input.edge ?? null,
    expectedValue: input.expectedValue ?? null,
    score,
    weight: input.weight,
    confidence: confidenceFromScore(score),
    detail: input.detail,
    evidence: input.evidence.filter(Boolean).slice(0, 5)
  };
}

function sportModelJudge(row: DecisionRow): DecisionModelEnsembleJudge {
  const decision = row.prediction.decision;
  const bestPick = row.prediction.bestPick;
  const probability = bestPick.hasValue ? bestPick.modelProbability : decision.beliefState.baseModelProbability;
  const edge = bestPick.hasValue ? bestPick.edge : decision.beliefState.probabilityEdge;
  const expectedValue = bestPick.hasValue ? bestPick.expectedValue : decision.beliefState.expectedValue;
  const verdict: DecisionModelEnsembleJudgeVerdict =
    decision.action === "consider" && decision.decisionScore >= 64 && (edge ?? 0) > 0 && (expectedValue ?? 0) > 0
      ? "support"
      : decision.action === "monitor" || decision.decisionScore >= 48
        ? "watch"
        : "oppose";

  return judge({
    id: "sport-model",
    label: "Sport model",
    verdict,
    probability,
    edge,
    expectedValue,
    weight: 1.15,
    detail: `${decision.summary} Decision score is ${decision.decisionScore}.`,
    evidence: decision.publicReasoningSteps.slice(0, 4)
  });
}

function marketModelJudge(row: DecisionRow): DecisionModelEnsembleJudge {
  const decision = row.prediction.decision;
  const odds = decision.oddsIntelligence;
  const best = odds.bestSelection;
  const margin = odds.averageBookmakerMargin ?? 0;
  const verdict: DecisionModelEnsembleJudgeVerdict =
    odds.actionableSelections > 0 && (best?.edge ?? 0) > 0 && (best?.expectedValue ?? 0) > 0 && margin <= 0.12
      ? "support"
      : odds.totalMarkets > 0 && (odds.positiveEdgeSelections > 0 || odds.positiveExpectedValueSelections > 0)
        ? "watch"
        : "oppose";

  return judge({
    id: "market-model",
    label: "Market model",
    verdict,
    probability: best?.modelProbability ?? null,
    edge: best?.edge ?? decision.marketMovement.currentEdge,
    expectedValue: best?.expectedValue ?? decision.marketMovement.currentExpectedValue,
    weight: 1.05,
    detail: odds.summary,
    evidence: [
      `Markets ${odds.totalMarkets}, selections ${odds.totalSelections}, actionable ${odds.actionableSelections}.`,
      `Average bookmaker margin ${odds.averageBookmakerMargin ?? "unknown"}.`,
      ...odds.avoidReasons.slice(0, 3)
    ]
  });
}

function posteriorBeliefJudge(row: DecisionRow): DecisionModelEnsembleJudge {
  const belief = row.prediction.decision.beliefState;
  const trace = row.prediction.decision.probabilityTrace;
  const verdict: DecisionModelEnsembleJudgeVerdict =
    belief.grade === "strong" && (belief.probabilityEdge ?? 0) > 0 && (belief.expectedValue ?? 0) > 0
      ? "support"
      : belief.grade === "moderate" || trace.status === "watchlist"
        ? "watch"
        : "oppose";

  return judge({
    id: "posterior-belief",
    label: "Posterior belief",
    verdict,
    probability: belief.believedProbability,
    edge: belief.probabilityEdge,
    expectedValue: belief.expectedValue,
    weight: 1.1,
    detail: belief.summary,
    evidence: [
      trace.summary,
      `Evidence balance supports ${belief.evidenceBalance.supports}, opposes ${belief.evidenceBalance.opposes}, uncertain ${belief.evidenceBalance.uncertain}.`,
      ...trace.conflicts.slice(0, 3)
    ]
  });
}

function dataQualityJudge(row: DecisionRow): DecisionModelEnsembleJudge {
  const coverage = row.prediction.decision.dataCoverage;
  const verdict: DecisionModelEnsembleJudgeVerdict =
    coverage.score >= 74 && coverage.missingSignals === 0 && coverage.staleSignals === 0
      ? "support"
      : coverage.score >= 55 && coverage.requiredBeforeTrust.length <= 2
        ? "watch"
        : coverage.requiredBeforeTrust.length > 4 || coverage.score < 45
          ? "block"
          : "oppose";

  return judge({
    id: "data-quality",
    label: "Data quality",
    verdict,
    probability: null,
    edge: null,
    expectedValue: null,
    weight: 1.25,
    detail: coverage.summary,
    evidence: [
      `Coverage score ${coverage.score}/100.`,
      `Provider ${coverage.providerBackedSignals}, computed ${coverage.computedSignals}, mock ${coverage.mockSignals}, missing ${coverage.missingSignals}.`,
      ...coverage.requiredBeforeTrust.slice(0, 3)
    ]
  });
}

function calibrationMemoryJudge(row: DecisionRow): DecisionModelEnsembleJudge {
  const decision = row.prediction.decision;
  const memory = decision.caseMemory;
  const calibration = decision.calibration;
  const learning = decision.learningProfile;
  const verdict: DecisionModelEnsembleJudgeVerdict =
    calibration.action === "trust" && memory.adjustment === "none" && (learning?.active ?? false)
      ? "support"
      : memory.adjustment === "abstain"
        ? "block"
        : calibration.action === "discount" || memory.adjustment === "discount" || !(learning?.active ?? false)
          ? "watch"
          : "oppose";

  return judge({
    id: "calibration-memory",
    label: "Calibration and memory",
    verdict,
    probability: null,
    edge: null,
    expectedValue: null,
    weight: 0.95,
    detail: `${calibration.detail} ${memory.summary}`,
    evidence: [
      `Calibration reliability ${calibration.reliabilityScore}.`,
      `Memory sample ${memory.sampleSize}; adjustment ${memory.adjustment}.`,
      learning?.reason ?? "No learning profile is active."
    ]
  });
}

function riskRobustnessJudge(row: DecisionRow): DecisionModelEnsembleJudge {
  const decision = row.prediction.decision;
  const robustness = decision.robustness;
  const uncertainty = decision.uncertainty;
  const verdict: DecisionModelEnsembleJudgeVerdict =
    decision.risk !== "high" && robustness.status === "robust" && uncertainty.status === "controlled"
      ? "support"
      : robustness.status === "fragile" || decision.risk === "high" || uncertainty.score >= 58
        ? "block"
        : "watch";

  return judge({
    id: "risk-robustness",
    label: "Risk and robustness",
    verdict,
    probability: null,
    edge: robustness.worstCase.edgeAfterShock,
    expectedValue: robustness.worstCase.expectedValueAfterShock,
    weight: 1.1,
    detail: `${robustness.summary} ${uncertainty.summary}`,
    evidence: [
      `Risk ${decision.risk}; uncertainty ${uncertainty.score}.`,
      `Survival rate ${robustness.survivalRate}.`,
      robustness.worstCase.detail,
      ...robustness.requiredRechecks.slice(0, 2)
    ]
  });
}

function actionabilityJudge(row: DecisionRow): DecisionModelEnsembleJudge {
  const actionability = row.prediction.decision.actionability;
  const control = row.prediction.decision.controlPolicy;
  const verdict: DecisionModelEnsembleJudgeVerdict =
    actionability.status === "actionable" && control.publishAllowed
      ? "support"
      : control.status === "blocked" || actionability.blockers.length > 0
        ? "block"
        : "watch";

  return judge({
    id: "actionability",
    label: "Actionability",
    verdict,
    probability: null,
    edge: null,
    expectedValue: null,
    weight: 1.2,
    detail: `${actionability.summary} ${control.summary}`,
    evidence: [
      `Actionability score ${actionability.score}.`,
      `Control status ${control.status}.`,
      ...actionability.blockers.slice(0, 3),
      ...actionability.warnings.slice(0, 2)
    ]
  });
}

function buildJudges(row: DecisionRow): DecisionModelEnsembleJudge[] {
  return [
    sportModelJudge(row),
    marketModelJudge(row),
    posteriorBeliefJudge(row),
    dataQualityJudge(row),
    calibrationMemoryJudge(row),
    riskRobustnessJudge(row),
    actionabilityJudge(row)
  ];
}

function consensusFor(judges: DecisionModelEnsembleJudge[]): DecisionModelEnsembleConsensus {
  if (judges.some((item) => item.verdict === "block")) return "blocked";
  const actions = new Set(judges.map((item) => item.action));
  if (actions.size === 1) return "unanimous";
  const counts = judges.reduce(
    (acc, item) => {
      acc[item.action] += 1;
      return acc;
    },
    { consider: 0, monitor: 0, avoid: 0 }
  );
  return Math.max(counts.consider, counts.monitor, counts.avoid) >= 4 ? "majority" : "split";
}

function weightedScore(judges: DecisionModelEnsembleJudge[]): number {
  const totalWeight = judges.reduce((sum, item) => sum + item.weight, 0);
  if (!totalWeight) return 0;
  return round(judges.reduce((sum, item) => sum + item.score * item.weight, 0) / totalWeight, 1);
}

function agreementScore(judges: DecisionModelEnsembleJudge[], ensembleAction: DecisionAction): number {
  if (!judges.length) return 0;
  return round((judges.filter((item) => item.action === ensembleAction).length / judges.length) * 100, 1);
}

function ensembleActionFor(row: DecisionRow, judges: DecisionModelEnsembleJudge[], score: number): DecisionAction {
  if (judges.some((item) => item.verdict === "block")) return "avoid";
  if (score >= 76 && row.prediction.decision.action === "consider") return "consider";
  if (score >= 52) return "monitor";
  return safestAction(judges.map((item) => item.action));
}

function candidateConflicts(judges: DecisionModelEnsembleJudge[]): string[] {
  return judges
    .filter((item) => item.verdict === "watch" || item.verdict === "oppose" || item.verdict === "block")
    .map((item) => `${item.label}: ${item.detail}`)
    .slice(0, 6);
}

function candidateBlockers(judges: DecisionModelEnsembleJudge[]): string[] {
  return judges.filter((item) => item.verdict === "block").flatMap((item) => item.evidence.length ? item.evidence : [item.detail]).slice(0, 6);
}

function nextCheckFor(candidate: DecisionModelEnsembleCandidate): string {
  const blockingJudge = candidate.judges.find((item) => item.verdict === "block");
  if (blockingJudge) return `${blockingJudge.label}: ${blockingJudge.evidence[0] ?? blockingJudge.detail}`;
  const watchJudge = candidate.judges.find((item) => item.verdict === "watch" || item.verdict === "oppose");
  if (watchJudge) return `${watchJudge.label}: ${watchJudge.evidence[0] ?? watchJudge.detail}`;
  return "All ensemble judges are aligned enough for the next supervisor verification step.";
}

function buildCandidate(row: DecisionRow): DecisionModelEnsembleCandidate {
  const decision = row.prediction.decision;
  const bestPick = row.prediction.bestPick;
  const judges = buildJudges(row);
  const score = weightedScore(judges);
  const ensembleAction = ensembleActionFor(row, judges, score);
  const candidate: DecisionModelEnsembleCandidate = {
    matchId: row.match.id,
    match: matchLabel(row),
    league: row.match.league.name,
    kickoffTime: row.match.kickoffTime,
    selection: bestPick.hasValue ? bestPick.label : decision.recommendedSelection,
    baseAction: decision.action,
    ensembleAction,
    consensus: consensusFor(judges),
    agreementScore: agreementScore(judges, ensembleAction),
    weightedScore: score,
    decisionScore: decision.decisionScore,
    modelProbability: bestPick.hasValue ? bestPick.modelProbability : decision.beliefState.baseModelProbability,
    marketProbability: bestPick.hasValue ? bestPick.noVigImpliedProbability : decision.beliefState.marketImpliedProbability,
    posteriorProbability: decision.probabilityTrace.posteriorProbability ?? decision.beliefState.believedProbability,
    valueEdge: bestPick.hasValue ? bestPick.edge : decision.beliefState.probabilityEdge,
    expectedValue: bestPick.hasValue ? bestPick.expectedValue : decision.beliefState.expectedValue,
    dataCoverageScore: decision.dataCoverage.score,
    judges,
    conflicts: candidateConflicts(judges),
    blockers: candidateBlockers(judges),
    nextCheck: ""
  };
  return {
    ...candidate,
    nextCheck: nextCheckFor(candidate)
  };
}

function rowRank(row: DecisionRow): number {
  const bestPick = row.prediction.bestPick;
  const decision = row.prediction.decision;
  const actionWeight = decision.action === "consider" ? 160 : decision.action === "monitor" ? 80 : 0;
  return actionWeight + decision.decisionScore + (bestPick.hasValue ? Math.max(0, bestPick.expectedValue) * 100 + Math.max(0, bestPick.edge) * 100 : 0);
}

function statusFor(candidates: DecisionModelEnsembleCandidate[]): DecisionModelEnsembleStatus {
  if (!candidates.length) return "no-candidates";
  if (candidates.some((item) => item.consensus === "blocked")) return "blocked";
  if (candidates.some((item) => item.consensus === "split" || item.ensembleAction !== item.baseAction)) return "contested";
  return "aligned";
}

export function buildDecisionModelEnsemble({
  rows,
  date,
  sport,
  limit = 8
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  limit?: number;
}): DecisionModelEnsemble {
  const candidates = rows
    .slice()
    .sort((a, b) => rowRank(b) - rowRank(a))
    .slice(0, limit)
    .map(buildCandidate);
  const status = statusFor(candidates);
  const alignedCandidates = candidates.filter((item) => item.consensus === "unanimous" || item.consensus === "majority").length;
  const contestedCandidates = candidates.filter((item) => item.consensus === "split" || item.ensembleAction !== item.baseAction).length;
  const blockedCandidates = candidates.filter((item) => item.consensus === "blocked").length;
  const topCandidate = candidates[0] ?? null;
  const averageWeightedScore = candidates.length ? round(candidates.reduce((sum, item) => sum + item.weightedScore, 0) / candidates.length, 1) : 0;
  const averageAgreementScore = candidates.length ? round(candidates.reduce((sum, item) => sum + item.agreementScore, 0) / candidates.length, 1) : 0;

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    summary:
      status === "no-candidates"
        ? "Model ensemble has no candidates to audit."
        : status === "blocked"
          ? `Model ensemble blocks ${blockedCandidates} candidate(s) because one or more independent judges found hard trust failures.`
          : status === "contested"
            ? `Model ensemble is contested: ${contestedCandidates} candidate(s) differ from the base action or have split judges.`
            : `Model ensemble is aligned across ${alignedCandidates} candidate(s).`,
    totalCandidates: candidates.length,
    alignedCandidates,
    contestedCandidates,
    blockedCandidates,
    topCandidate,
    candidates,
    slateConflicts: candidates.flatMap((item) => item.conflicts.map((conflict) => `${item.match}: ${conflict}`)).slice(0, 8),
    modelHealth: {
      averageWeightedScore,
      averageAgreementScore,
      publishableCandidates: candidates.filter((item) => item.ensembleAction === "consider").length,
      monitorCandidates: candidates.filter((item) => item.ensembleAction === "monitor").length,
      avoidedCandidates: candidates.filter((item) => item.ensembleAction === "avoid").length
    }
  };
}
