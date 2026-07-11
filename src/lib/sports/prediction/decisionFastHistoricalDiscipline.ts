import type { DecisionOddsIntelligenceProof } from "@/lib/sports/prediction/decisionOddsIntelligenceProof";
import type { PublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";
import type { Sport } from "@/lib/sports/types";

export type DecisionFastHistoricalDisciplineStatus =
  | "waiting-history"
  | "market-prior-enforced"
  | "provider-retest-ready"
  | "diagnostic-only"
  | "blocked";

export type DecisionFastHistoricalDiscipline = {
  mode: "decision-fast-historical-discipline";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionFastHistoricalDisciplineStatus;
  disciplineHash: string;
  summary: string;
  posture: {
    label: string;
    instruction: string;
    trustEffect: "cap-raw-edge" | "queue-provider-retest" | "diagnostic-only" | "waiting";
  };
  evidence: {
    attached: boolean;
    publicStatus: PublicHistoricalTrainingEvidence["status"] | null;
    diagnosticScore: number;
    fixtures: number;
    oddsRows: number;
    benchmarkVerdict: PublicHistoricalTrainingEvidence["scorecard"]["benchmarkVerdict"] | null;
  };
  marketDiscipline: {
    positiveValueCandidates: number;
    cappedCandidates: number;
    topCappedSelections: Array<{
      rank: number;
      match: string;
      selection: string;
      edge: number;
      expectedValue: number;
      reason: string;
    }>;
  };
  rules: Array<{
    id: "history-attached" | "market-benchmark" | "raw-edge-cap" | "side-effects";
    label: string;
    status: "pass" | "watch" | "block";
    detail: string;
  }>;
  controls: {
    canInspectReadOnly: true;
    canMutateProbabilities: false;
    canPersistDecision: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
  };
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

function statusFor(evidence: PublicHistoricalTrainingEvidence | null): DecisionFastHistoricalDisciplineStatus {
  if (!evidence) return "waiting-history";
  if (evidence.status === "failed" || evidence.status === "insufficient-history") return "blocked";
  if (evidence.status === "market-prior-dominant") return "market-prior-enforced";
  if (evidence.status === "provider-retest-ready") return "provider-retest-ready";
  return "diagnostic-only";
}

function postureFor(status: DecisionFastHistoricalDisciplineStatus): DecisionFastHistoricalDiscipline["posture"] {
  if (status === "market-prior-enforced") {
    return {
      label: "Market prior discipline",
      instruction: "Treat raw positive-EV model picks as capped shadow candidates until provider-enriched retests beat no-vig market consensus.",
      trustEffect: "cap-raw-edge"
    };
  }
  if (status === "provider-retest-ready") {
    return {
      label: "Provider retest queue",
      instruction: "Public history found a retest path; require live fixture IDs, odds snapshots, and context features before promotion.",
      trustEffect: "queue-provider-retest"
    };
  }
  if (status === "diagnostic-only") {
    return {
      label: "Diagnostic history",
      instruction: "Use public EPL history as cautionary context only; do not adjust live probabilities or learned weights.",
      trustEffect: "diagnostic-only"
    };
  }
  return {
    label: "History waiting",
    instruction: "Run the public-history proof before the fast dashboard can discipline raw model edges with historical market evidence.",
    trustEffect: "waiting"
  };
}

function summaryFor(status: DecisionFastHistoricalDisciplineStatus, evidence: PublicHistoricalTrainingEvidence | null, capped: number): string {
  if (status === "market-prior-enforced") {
    return `Historical market discipline is active: ${evidence?.scorecard.fixtures.toLocaleString() ?? 0} fixtures and ${evidence?.scorecard.oddsRows.toLocaleString() ?? 0} odds rows say market prior dominates, so ${capped} raw value candidate(s) stay shadow-capped.`;
  }
  if (status === "provider-retest-ready") return "Public history is ready for provider-enriched retest; live promotion remains locked.";
  if (status === "diagnostic-only") return "Public history is attached as diagnostic context only; provider-enriched proof is still required.";
  if (status === "blocked") return "Historical discipline is blocked because the public-history proof failed or is too thin.";
  return "Historical discipline is waiting for verified public-history evidence.";
}

export function buildDecisionFastHistoricalDiscipline({
  date,
  sport,
  publicHistoricalTrainingEvidence = null,
  oddsIntelligenceProof,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  publicHistoricalTrainingEvidence?: PublicHistoricalTrainingEvidence | null;
  oddsIntelligenceProof: DecisionOddsIntelligenceProof;
  now?: Date;
}): DecisionFastHistoricalDiscipline {
  const status = statusFor(publicHistoricalTrainingEvidence);
  const marketPriorDominant = status === "market-prior-enforced";
  const topValueSelections = oddsIntelligenceProof.topEdges.filter((selection) => selection.action === "value");
  const topCappedSelections = (marketPriorDominant ? topValueSelections : []).slice(0, 4).map((selection) => ({
    rank: selection.rank,
    match: selection.match,
    selection: selection.selection,
    edge: selection.edge,
    expectedValue: selection.expectedValue,
    reason: "Historical benchmark favors no-vig market consensus over the raw model, so this remains a shadow candidate."
  }));
  const cappedCandidates = marketPriorDominant ? topValueSelections.length : 0;
  const rules: DecisionFastHistoricalDiscipline["rules"] = [
    {
      id: "history-attached",
      label: "History attached",
      status: publicHistoricalTrainingEvidence ? "pass" : "watch",
      detail: publicHistoricalTrainingEvidence
        ? `${publicHistoricalTrainingEvidence.scorecard.fixtures.toLocaleString()} fixtures, ${publicHistoricalTrainingEvidence.scorecard.oddsRows.toLocaleString()} odds rows, score ${publicHistoricalTrainingEvidence.diagnosticScore}/100.`
        : "Public-history evidence has not been attached to this fast page run."
    },
    {
      id: "market-benchmark",
      label: "Market benchmark",
      status:
        publicHistoricalTrainingEvidence?.scorecard.benchmarkVerdict === "market-beats-model"
          ? "pass"
          : publicHistoricalTrainingEvidence
            ? "watch"
            : "block",
      detail: publicHistoricalTrainingEvidence?.scorecard.benchmarkVerdict ?? "No benchmark verdict attached."
    },
    {
      id: "raw-edge-cap",
      label: "Raw edge cap",
      status: marketPriorDominant ? "pass" : topValueSelections.length ? "watch" : "pass",
      detail: marketPriorDominant
        ? `${cappedCandidates} positive-EV candidate(s) capped by historical market-prior discipline.`
        : `${topValueSelections.length} positive-EV candidate(s) remain read-only because provider proof is incomplete.`
    },
    {
      id: "side-effects",
      label: "Side effects",
      status: "pass",
      detail: "Publishing, staking, training, persistence, learned weights, and probability mutation are locked."
    }
  ];

  return {
    mode: "decision-fast-historical-discipline",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    disciplineHash: stableHash({
      date,
      sport,
      status,
      evidence: [
        publicHistoricalTrainingEvidence?.status ?? null,
        publicHistoricalTrainingEvidence?.diagnosticScore ?? null,
        publicHistoricalTrainingEvidence?.scorecard.benchmarkVerdict ?? null
      ],
      cappedCandidates,
      topCappedSelections: topCappedSelections.map((selection) => [selection.rank, selection.match, selection.selection])
    }),
    summary: summaryFor(status, publicHistoricalTrainingEvidence, cappedCandidates),
    posture: postureFor(status),
    evidence: {
      attached: Boolean(publicHistoricalTrainingEvidence),
      publicStatus: publicHistoricalTrainingEvidence?.status ?? null,
      diagnosticScore: publicHistoricalTrainingEvidence?.diagnosticScore ?? 0,
      fixtures: publicHistoricalTrainingEvidence?.scorecard.fixtures ?? 0,
      oddsRows: publicHistoricalTrainingEvidence?.scorecard.oddsRows ?? 0,
      benchmarkVerdict: publicHistoricalTrainingEvidence?.scorecard.benchmarkVerdict ?? null
    },
    marketDiscipline: {
      positiveValueCandidates: topValueSelections.length,
      cappedCandidates,
      topCappedSelections
    },
    rules,
    controls: {
      canInspectReadOnly: true,
      canMutateProbabilities: false,
      canPersistDecision: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: [
      "/api/sports/decision/training/public-historical-training-evidence",
      "/api/sports/decision/training/football-data-market-benchmark",
      "/api/sports/decision/odds-intelligence-proof",
      "/api/sports/decision/answer-promotion-gate"
    ]
  };
}
