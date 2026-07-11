import type { DecisionDataAuthority } from "@/lib/sports/prediction/decisionDataAuthority";
import type { DecisionOddsIntelligenceProof } from "@/lib/sports/prediction/decisionOddsIntelligenceProof";
import type { DecisionOpenAILiveReviewReceipt } from "@/lib/sports/prediction/decisionOpenAILiveReviewReceipt";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionBayesianBeliefLedgerStatus = "supported" | "contested" | "needs-evidence" | "blocked";
export type DecisionBayesianBeliefLedgerItemStatus = "support" | "watch" | "block";

export type DecisionBayesianBeliefLedgerItem = {
  id: string;
  matchId: string;
  match: string;
  status: DecisionBayesianBeliefLedgerItemStatus;
  action: Prediction["decision"]["action"];
  selection: string | null;
  priorProbability: number | null;
  marketPriorProbability: number | null;
  modelProbability: number | null;
  posteriorProbability: number | null;
  posteriorEdge: number | null;
  posteriorExpectedValue: number | null;
  uncertaintyScore: number;
  evidenceBalance: {
    supports: number;
    opposes: number;
    uncertain: number;
  };
  revisionPressure: number;
  dataPressure: number;
  marketPressure: number;
  aiPressure: number;
  beliefGrade: string;
  confidence: Prediction["decision"]["confidence"];
  summary: string;
  falsifier: string;
  nextObservation: string;
  command: string;
  verifyUrl: string;
};

export type DecisionBayesianBeliefLedger = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "bayesian-belief-ledger";
  status: DecisionBayesianBeliefLedgerStatus;
  ledgerHash: string;
  summary: string;
  totals: {
    beliefs: number;
    support: number;
    watch: number;
    block: number;
    averagePosterior: number | null;
    averageEdge: number | null;
    averageExpectedValue: number | null;
    averageUncertainty: number;
    averageRevisionPressure: number;
  };
  activeBelief: DecisionBayesianBeliefLedgerItem | null;
  beliefs: DecisionBayesianBeliefLedgerItem[];
  updatePolicy: {
    rule: string;
    canUseMarketPrior: boolean;
    canUseOpenAIReview: boolean;
    canPromotePublicPick: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    nextSafeCommand: string | null;
  };
  controls: {
    canInspectReadOnly: true;
    canRunReadOnlyCommand: boolean;
    canAskOpenAI: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
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

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function round(value: number | null | undefined, digits = 4): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Number(value.toFixed(digits));
}

function average(values: Array<number | null | undefined>, digits = 4): number | null {
  const finite = values.filter((value): value is number => value !== null && value !== undefined && Number.isFinite(value));
  if (!finite.length) return null;
  return round(finite.reduce((sum, value) => sum + value, 0) / finite.length, digits);
}

function averageRequired(values: number[], digits = 1): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(digits));
}

function matchLabel(row: DecisionRow): string {
  return `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`;
}

function marketPrior(row: DecisionRow): number | null {
  const traceMarket = row.prediction.decision.probabilityTrace.steps.find((step) => step.kind === "market-prior");
  return traceMarket?.posteriorProbability ?? row.prediction.decision.beliefState.marketImpliedProbability ?? null;
}

function marketPressure(row: DecisionRow): number {
  const trace = row.prediction.decision.probabilityTrace;
  const disagreement = trace.disagreement ?? Math.abs((trace.modelProbability ?? 0) - (marketPrior(row) ?? 0));
  const edge = Math.abs(trace.posteriorEdge ?? row.prediction.decision.beliefState.probabilityEdge ?? 0);
  const noValue = row.prediction.bestPick.hasValue ? 0 : 14;
  return clamp(disagreement * 100 + Math.max(0, 0.015 - edge) * 700 + noValue);
}

function dataPressure(row: DecisionRow, dataAuthority: DecisionDataAuthority): number {
  const decision = row.prediction.decision;
  return clamp(
    decision.dataCoverage.requiredBeforeTrust.length * 9 +
      decision.missingSignals.length * 5 +
      decision.controlPolicy.gates.filter((gate) => gate.status === "block").length * 12 +
      (decision.dataCoverage.status === "mock-backed" ? 18 : decision.dataCoverage.status === "insufficient" ? 24 : 0) +
      Math.max(0, 55 - dataAuthority.trustScore) * 0.5
  );
}

function aiPressure(row: DecisionRow, openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt): number {
  const aiProtocol = row.prediction.decision.aiProtocol;
  const live = openAiLiveReviewReceipt.status;
  return clamp(
    (aiProtocol.status === "blocked" ? 22 : aiProtocol.status === "needs-data" ? 12 : 0) +
      (live === "reviewed" ? 0 : live === "quota-or-billing-blocked" || live === "rate-or-quota-limited" ? 18 : 10)
  );
}

function itemStatus(row: DecisionRow, revisionPressure: number): DecisionBayesianBeliefLedgerItemStatus {
  const decision = row.prediction.decision;
  if (decision.controlPolicy.status === "blocked" || decision.actionability.status === "blocked" || revisionPressure >= 72) return "block";
  if (revisionPressure >= 38 || decision.beliefState.grade !== "strong" || decision.probabilityTrace.status !== "ready") return "watch";
  return "support";
}

function ledgerItem({
  row,
  dataAuthority,
  openAiLiveReviewReceipt
}: {
  row: DecisionRow;
  dataAuthority: DecisionDataAuthority;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
}): DecisionBayesianBeliefLedgerItem {
  const decision = row.prediction.decision;
  const trace = decision.probabilityTrace;
  const belief = decision.beliefState;
  const data = dataPressure(row, dataAuthority);
  const market = marketPressure(row);
  const ai = aiPressure(row, openAiLiveReviewReceipt);
  const revisionPressure = clamp(belief.uncertaintyScore * 0.34 + data * 0.28 + market * 0.22 + ai * 0.16);
  const status = itemStatus(row, revisionPressure);
  const nextObservation = unique([
    decision.monitoringPlan.tasks[0]?.trigger,
    decision.nextChecks[0],
    decision.dataCoverage.requiredBeforeTrust[0],
    openAiLiveReviewReceipt.nextAction
  ])[0] ?? "Refresh evidence before the belief can change.";

  return {
    id: `belief-ledger-${row.match.id}`,
    matchId: row.match.id,
    match: matchLabel(row),
    status,
    action: decision.action,
    selection: trace.selection ?? decision.recommendedSelection,
    priorProbability: round(trace.basePriorProbability ?? belief.baseModelProbability),
    marketPriorProbability: round(marketPrior(row)),
    modelProbability: round(trace.modelProbability),
    posteriorProbability: round(trace.posteriorProbability ?? belief.believedProbability),
    posteriorEdge: round(trace.posteriorEdge ?? belief.probabilityEdge),
    posteriorExpectedValue: round(trace.posteriorExpectedValue ?? belief.expectedValue),
    uncertaintyScore: belief.uncertaintyScore,
    evidenceBalance: belief.evidenceBalance,
    revisionPressure,
    dataPressure: data,
    marketPressure: market,
    aiPressure: ai,
    beliefGrade: belief.grade,
    confidence: decision.confidence,
    summary: compact(`${belief.summary} ${trace.summary}`, 320),
    falsifier: compact(decision.notebook.falsifiers[0]?.action ?? decision.decisionBoundary.nearestFlip ?? "A fresh provider or market observation invalidates the posterior."),
    nextObservation: compact(nextObservation),
    command: decisionCurlCommand(`/api/sports/decision/${encodeURIComponent(row.match.id)}`),
    verifyUrl: `/api/sports/decision/${encodeURIComponent(row.match.id)}`
  };
}

function statusFor(items: DecisionBayesianBeliefLedgerItem[], dataAuthority: DecisionDataAuthority): DecisionBayesianBeliefLedgerStatus {
  if (!items.length || dataAuthority.status === "blocked" || items.some((item) => item.status === "block")) return "blocked";
  if (items.some((item) => item.status === "watch")) return "needs-evidence";
  return "supported";
}

export function buildDecisionBayesianBeliefLedger({
  date,
  sport,
  rows,
  dataAuthority,
  oddsIntelligenceProof,
  openAiLiveReviewReceipt,
  now = new Date(),
  limit = 8
}: {
  date: string;
  sport: Sport;
  rows: DecisionRow[];
  dataAuthority: DecisionDataAuthority;
  oddsIntelligenceProof: DecisionOddsIntelligenceProof;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  now?: Date;
  limit?: number;
}): DecisionBayesianBeliefLedger {
  const allBeliefs = rows.map((row) => ledgerItem({ row, dataAuthority, openAiLiveReviewReceipt })).sort((a, b) => {
    const statusRank = { block: 3, watch: 2, support: 1 }[b.status] - { block: 3, watch: 2, support: 1 }[a.status];
    if (statusRank !== 0) return statusRank;
    return b.revisionPressure - a.revisionPressure;
  });
  const beliefs = allBeliefs.slice(0, limit);
  const activeBelief = allBeliefs[0] ?? null;
  const status = statusFor(allBeliefs, dataAuthority);
  const support = allBeliefs.filter((item) => item.status === "support").length;
  const watch = allBeliefs.filter((item) => item.status === "watch").length;
  const block = allBeliefs.filter((item) => item.status === "block").length;
  const nextSafeCommand = activeBelief?.command ?? null;

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "bayesian-belief-ledger",
    status: status === "supported" && oddsIntelligenceProof.status === "watch" ? "contested" : status,
    ledgerHash: stableHash({
      date,
      sport,
      status,
      authority: dataAuthority.authorityHash,
      odds: oddsIntelligenceProof.proofHash,
      openAi: openAiLiveReviewReceipt.receiptHash,
      beliefs: allBeliefs.map((item) => [item.matchId, item.status, item.posteriorProbability, item.revisionPressure])
    }),
    summary:
      status === "supported"
        ? `Belief ledger supports ${support} slate belief(s), but public promotion remains locked.`
        : status === "needs-evidence"
          ? `Belief ledger needs evidence on ${watch} belief(s) before posterior trust can rise.`
          : `Belief ledger blocks ${block} belief(s); posterior trust cannot rise until evidence and safety gates clear.`,
    totals: {
      beliefs: allBeliefs.length,
      support,
      watch,
      block,
      averagePosterior: average(allBeliefs.map((item) => item.posteriorProbability)),
      averageEdge: average(allBeliefs.map((item) => item.posteriorEdge)),
      averageExpectedValue: average(allBeliefs.map((item) => item.posteriorExpectedValue)),
      averageUncertainty: averageRequired(allBeliefs.map((item) => item.uncertaintyScore)),
      averageRevisionPressure: averageRequired(allBeliefs.map((item) => item.revisionPressure))
    },
    activeBelief,
    beliefs,
    updatePolicy: {
      rule: "Update posterior belief only from explicit model, market-prior, context, data-quality, and AI-review evidence; never promote action above the safest current gate.",
      canUseMarketPrior: oddsIntelligenceProof.status !== "blocked",
      canUseOpenAIReview: openAiLiveReviewReceipt.status === "reviewed",
      canPromotePublicPick: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      nextSafeCommand
    },
    controls: {
      canInspectReadOnly: true,
      canRunReadOnlyCommand: Boolean(nextSafeCommand),
      canAskOpenAI: openAiLiveReviewReceipt.controls.canRequestLiveReview,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/bayesian-belief-ledger",
      "/api/sports/decision/odds-intelligence-proof",
      "/api/sports/decision/data-authority",
      "/api/sports/decision/openai-live-review-receipt",
      ...(activeBelief ? [activeBelief.verifyUrl] : [])
    ]),
    locks: [
      "Belief ledger is read-only and cannot persist decisions, publish picks, train models, stake, or upgrade public action.",
      "Posterior probability is advisory until provider data, Supabase proof, OpenAI review, and training gates pass.",
      "Market priors can adjust belief only after bookmaker margin removal; high revision pressure forces watch or avoid."
    ]
  };
}
