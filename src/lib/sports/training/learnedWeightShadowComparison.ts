import type { DecisionOddsBoard, DecisionOddsBoardSelection } from "@/lib/sports/prediction/decisionOddsBoard";
import type { DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";
import type {
  LearnedWeightPromotionDecision,
  LearnedWeightPromotionGovernor
} from "@/lib/sports/training/learnedWeightPromotionGovernor";
import type { ShadowLearnedWeight, ShadowTrainingCandidate, ShadowTrainingCandidates } from "@/lib/sports/training/shadowTrainingCandidates";

export type LearnedWeightShadowComparisonStatus = "ready-shadow" | "waiting-governor" | "waiting-candidates" | "blocked";
export type LearnedWeightShadowComparisonRowStatus = "would-pass-shadow" | "would-downgrade" | "watch-only" | "blocked";

export type LearnedWeightShadowComparisonRow = {
  id: string;
  sport: DecisionMultiSport;
  matchId: string;
  match: string;
  market: string;
  selection: string;
  baselineAction: DecisionOddsBoardSelection["action"];
  baselineEdge: number;
  baselineExpectedValue: number;
  learnedMinimumEdge: number | null;
  learnedValueScore: number | null;
  edgeDelta: number | null;
  status: LearnedWeightShadowComparisonRowStatus;
  reason: string;
};

export type LearnedWeightShadowComparison = {
  generatedAt: string;
  date: string;
  mode: "learned-weight-shadow-comparison";
  status: LearnedWeightShadowComparisonStatus;
  comparisonHash: string;
  summary: string;
  rows: LearnedWeightShadowComparisonRow[];
  totals: {
    compared: number;
    wouldPassShadow: number;
    wouldDowngrade: number;
    watchOnly: number;
    blocked: number;
    eligibleSports: number;
    learnedWeights: number;
  };
  controls: {
    canInspectReadOnly: true;
    canApplyLearnedWeightsToPredictions: false;
    canPromoteLearnedWeights: false;
    canPersistComparison: false;
    canTrainModels: false;
    canPublishPicks: false;
    canUpgradePublicAction: false;
  };
  blockers: string[];
  proofUrls: string[];
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

function round(value: number, digits = 4): number {
  return Number(value.toFixed(digits));
}

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function weightValue(weights: ShadowLearnedWeight[], key: string): number | null {
  const weight = weights.find((item) => item.key === key);
  return typeof weight?.value === "number" && Number.isFinite(weight.value) ? weight.value : null;
}

function candidateForSport(candidates: ShadowTrainingCandidates, sport: DecisionMultiSport): ShadowTrainingCandidate | null {
  if (sport !== "football" && sport !== "basketball" && sport !== "tennis") return null;
  return candidates.candidates.find((candidate) => candidate.sport === sport) ?? null;
}

function decisionForSport(governor: LearnedWeightPromotionGovernor, sport: DecisionMultiSport): LearnedWeightPromotionDecision | null {
  if (sport !== "football" && sport !== "basketball" && sport !== "tennis") return null;
  return governor.decisions.find((decision) => decision.sport === sport) ?? null;
}

function learnedValueScore(selection: DecisionOddsBoardSelection, weights: ShadowLearnedWeight[]): number {
  const valueEdgeWeight = weightValue(weights, "valueEdgeWeight") ?? 0.5;
  const dataQualityWeight = weightValue(weights, "dataQualityWeight") ?? 0.2;
  const marketWeight = weightValue(weights, "marketAdjustmentWeight") ?? weightValue(weights, "paceWeight") ?? weightValue(weights, "surfaceWeight") ?? 0.12;
  return round(selection.expectedValue * (1 + valueEdgeWeight * 0.18) + selection.edge * (1 + dataQualityWeight * 0.12) + selection.dataQualityScore * marketWeight * 0.0008);
}

function comparisonRow({
  selection,
  candidate,
  decision
}: {
  selection: DecisionOddsBoardSelection;
  candidate: ShadowTrainingCandidate | null;
  decision: LearnedWeightPromotionDecision | null;
}): LearnedWeightShadowComparisonRow {
  const eligible = decision?.status === "eligible-shadow";
  const candidateReady = candidate?.status === "ready-shadow";
  const learnedMinimumEdge = candidate ? weightValue(candidate.learnedWeights, "minimumEdge") ?? 0.035 : null;
  const learnedScore = candidate && candidateReady ? learnedValueScore(selection, candidate.learnedWeights) : null;
  const edgeDelta = learnedScore === null ? null : round(learnedScore - selection.expectedValue);
  const baselinePasses = selection.action === "value" && selection.edge > 0 && selection.expectedValue > 0;
  const learnedPasses = learnedScore !== null && learnedMinimumEdge !== null && selection.edge >= learnedMinimumEdge && learnedScore > 0;
  const status: LearnedWeightShadowComparisonRowStatus = !candidate || !decision || !candidateReady
    ? "blocked"
    : !eligible
      ? "watch-only"
      : learnedPasses
        ? "would-pass-shadow"
        : baselinePasses
          ? "would-downgrade"
          : "watch-only";
  const reason =
    status === "would-pass-shadow"
      ? `Candidate clears learned minimum edge ${learnedMinimumEdge?.toFixed(3)} in shadow only.`
      : status === "would-downgrade"
        ? `Candidate would downgrade because edge ${selection.edge.toFixed(3)} or learned score ${learnedScore?.toFixed(3)} misses learned thresholds.`
        : status === "watch-only"
          ? learnedScore !== null
            ? `Learned score is available for research shadow review; ${decision?.nextAction ?? "governance approval is still pending."}`
            : decision?.nextAction ?? "Governor has not authorized shadow comparison for this sport."
          : candidate?.nextAction ?? "No ready learned-weight candidate exists for this sport.";

  return {
    id: `${selection.id}:learned-shadow`,
    sport: selection.sport,
    matchId: selection.matchId,
    match: selection.match,
    market: selection.marketName,
    selection: selection.selection,
    baselineAction: selection.action,
    baselineEdge: selection.edge,
    baselineExpectedValue: selection.expectedValue,
    learnedMinimumEdge,
    learnedValueScore: learnedScore,
    edgeDelta,
    status,
    reason
  };
}

function overallStatus({
  rows,
  governor,
  candidates
}: {
  rows: LearnedWeightShadowComparisonRow[];
  governor: LearnedWeightPromotionGovernor;
  candidates: ShadowTrainingCandidates;
}): LearnedWeightShadowComparisonStatus {
  if (governor.status === "blocked" || candidates.status === "blocked") return "blocked";
  if (rows.some((row) => row.learnedValueScore !== null)) {
    return "ready-shadow";
  }
  if (governor.status === "waiting-candidate" || candidates.status === "waiting-backtest") return "waiting-candidates";
  return "waiting-governor";
}

function summaryFor(status: LearnedWeightShadowComparisonStatus): string {
  if (status === "ready-shadow") return "Learned weights can be compared against current picks in read-only shadow mode; no prediction is changed.";
  if (status === "waiting-candidates") return "Shadow comparison is waiting on completed learned-weight candidates.";
  if (status === "waiting-governor") return "Shadow comparison is waiting on promotion-governor and model-governance approval.";
  return "Shadow comparison is blocked by candidate, governor, or safety proof.";
}

export function buildLearnedWeightShadowComparison({
  date,
  oddsBoard,
  shadowCandidates,
  promotionGovernor,
  limit = 12,
  now = new Date()
}: {
  date: string;
  oddsBoard: DecisionOddsBoard;
  shadowCandidates: ShadowTrainingCandidates;
  promotionGovernor: LearnedWeightPromotionGovernor;
  limit?: number;
  now?: Date;
}): LearnedWeightShadowComparison {
  const selections = oddsBoard.selections
    .filter((selection) => selection.expectedValue > 0 || selection.edge > 0 || selection.action === "value" || selection.action === "watch")
    .slice(0, Math.max(1, limit));
  const rows = selections.map((selection) =>
    comparisonRow({
      selection,
      candidate: candidateForSport(shadowCandidates, selection.sport),
      decision: decisionForSport(promotionGovernor, selection.sport)
    })
  );
  const status = overallStatus({ rows, governor: promotionGovernor, candidates: shadowCandidates });
  const totals = {
    compared: rows.length,
    wouldPassShadow: rows.filter((row) => row.status === "would-pass-shadow").length,
    wouldDowngrade: rows.filter((row) => row.status === "would-downgrade").length,
    watchOnly: rows.filter((row) => row.status === "watch-only").length,
    blocked: rows.filter((row) => row.status === "blocked").length,
    eligibleSports: promotionGovernor.totals.eligibleShadow,
    learnedWeights: shadowCandidates.totals.learnedWeights
  };
  const blockers = unique([
    ...promotionGovernor.blockers,
    ...shadowCandidates.blockers,
    ...rows.filter((row) => row.status === "blocked").map((row) => `${row.sport}: ${row.reason}`)
  ]);

  return {
    generatedAt: now.toISOString(),
    date,
    mode: "learned-weight-shadow-comparison",
    status,
    comparisonHash: stableHash({
      date,
      board: oddsBoard.boardHash,
      governor: promotionGovernor.governorHash,
      candidates: shadowCandidates.candidateHash,
      rows: rows.map((row) => [row.id, row.status, row.learnedValueScore, row.edgeDelta])
    }),
    summary: summaryFor(status),
    rows,
    totals,
    controls: {
      canInspectReadOnly: true,
      canApplyLearnedWeightsToPredictions: false,
      canPromoteLearnedWeights: false,
      canPersistComparison: false,
      canTrainModels: false,
      canPublishPicks: false,
      canUpgradePublicAction: false
    },
    blockers,
    proofUrls: unique([
      "/api/sports/decision/training/shadow-comparison",
      "/api/sports/decision/training/promotion-governor",
      "/api/sports/decision/training/shadow-candidates",
      "/api/sports/decision/odds-board",
      ...promotionGovernor.proofUrls,
      ...shadowCandidates.proofUrls
    ])
  };
}
