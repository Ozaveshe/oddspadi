import type { DecisionModelCard, DecisionModelCards } from "@/lib/sports/prediction/decisionModelCards";
import type { ShadowTrainingCandidate, ShadowTrainingCandidates } from "@/lib/sports/training/shadowTrainingCandidates";
import type { TrainingCorpusCommand } from "@/lib/sports/training/multiSportCorpusPlan";
import type { Sport } from "@/lib/sports/types";

type GovernedSport = Extract<Sport, "football" | "basketball" | "tennis">;

export type LearnedWeightPromotionGovernorStatus = "eligible-shadow" | "waiting-candidate" | "waiting-governance" | "blocked";
export type LearnedWeightPromotionGateStatus = "pass" | "watch" | "block";

export type LearnedWeightPromotionGate = {
  id: string;
  label: string;
  status: LearnedWeightPromotionGateStatus;
  detail: string;
  requiredAction: string | null;
};

export type LearnedWeightPromotionDecision = {
  sport: GovernedSport;
  status: LearnedWeightPromotionGovernorStatus;
  candidateStatus: ShadowTrainingCandidate["status"] | "missing";
  modelCardStatus: DecisionModelCard["status"] | "missing";
  governanceStatus: DecisionModelCard["governance"]["status"] | "missing";
  trustScore: number;
  backtestId: string | null;
  learnedWeights: number;
  candidateHash: string | null;
  gates: LearnedWeightPromotionGate[];
  blockers: string[];
  nextAction: string;
};

export type LearnedWeightPromotionGovernor = {
  generatedAt: string;
  date: string;
  mode: "learned-weight-promotion-governor";
  status: LearnedWeightPromotionGovernorStatus;
  governorHash: string;
  summary: string;
  decisions: LearnedWeightPromotionDecision[];
  totals: {
    sports: number;
    eligibleShadow: number;
    waitingCandidate: number;
    waitingGovernance: number;
    blocked: number;
    learnedWeights: number;
  };
  nextSafeCommand: TrainingCorpusCommand;
  controls: {
    canInspectReadOnly: true;
    canRunShadowComparison: boolean;
    canApplyLearnedWeightsToPredictions: false;
    canPromoteLearnedWeights: false;
    canWriteProviderRows: false;
    canPersistTrainingRows: false;
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

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function gate(input: LearnedWeightPromotionGate): LearnedWeightPromotionGate {
  return input;
}

function statusFromGates(gates: LearnedWeightPromotionGate[]): LearnedWeightPromotionGovernorStatus {
  const candidateGate = gates.find((item) => item.id === "candidate-ready");
  const governanceGate = gates.find((item) => item.id === "governance-approved");
  const lockGate = gates.find((item) => item.id === "promotion-lock");
  if (!lockGate || lockGate.status !== "pass") return "blocked";
  if (candidateGate?.status === "block") return "waiting-candidate";
  if (governanceGate?.status === "block") return "waiting-governance";
  if (gates.some((item) => item.status === "block")) return "blocked";
  return "eligible-shadow";
}

function decisionFor({
  sport,
  candidate,
  card
}: {
  sport: GovernedSport;
  candidate: ShadowTrainingCandidate | null;
  card: DecisionModelCard | null;
}): LearnedWeightPromotionDecision {
  const gates = [
    gate({
      id: "candidate-ready",
      label: "Shadow candidate ready",
      status: candidate?.status === "ready-shadow" ? "pass" : candidate ? "block" : "block",
      detail: candidate ? `${candidate.status} with ${candidate.learnedWeights.length} learned weight(s).` : "No shadow candidate exists for this sport.",
      requiredAction:
        candidate?.status === "ready-shadow"
          ? null
          : candidate?.nextAction ?? "Build a completed non-demo shadow training candidate before promotion can be considered."
    }),
    gate({
      id: "governance-approved",
      label: "Model governance approved",
      status: card?.status === "training-ready" && card.governance.learnedGuardrailsAllowed ? "pass" : card ? "block" : "block",
      detail: card
        ? `${card.status}; governance ${card.governance.status}; trust ${card.governance.trustScore}/100; learnedGuardrails=${card.governance.learnedGuardrailsAllowed}.`
        : "No model card exists for this sport.",
      requiredAction:
        card?.status === "training-ready" && card.governance.learnedGuardrailsAllowed
          ? null
          : card?.governance.topChecks.find((item) => item.requiredAction)?.requiredAction ?? "Clear model-card and governance blockers."
    }),
    gate({
      id: "sample-metrics",
      label: "Backtest metrics complete",
      status:
        candidate && candidate.sampleSize >= 1000 && candidate.brierScore !== null && candidate.logLoss !== null && candidate.closingLineValue !== null
          ? "pass"
          : candidate && candidate.sampleSize > 0
            ? "watch"
            : "block",
      detail: candidate
        ? `sample=${candidate.sampleSize}, brier=${candidate.brierScore ?? "n/a"}, logLoss=${candidate.logLoss ?? "n/a"}, CLV=${candidate.closingLineValue ?? "n/a"}, calibration=${candidate.calibrationError ?? "n/a"}.`
        : "No backtest metrics exist.",
      requiredAction:
        candidate && candidate.sampleSize >= 1000 && candidate.brierScore !== null && candidate.logLoss !== null && candidate.closingLineValue !== null
          ? null
          : "Store a completed real-data backtest with sample size, Brier score, log loss, and CLV."
    }),
    gate({
      id: "calibration-approved",
      label: "Calibration approved",
      status:
        candidate && candidate.calibrationError !== null && candidate.calibrationBuckets > 0
          ? candidate.calibrationError <= 0.08
            ? "pass"
            : "watch"
          : "block",
      detail: candidate
        ? `calibrationError=${candidate.calibrationError ?? "n/a"}; buckets=${candidate.calibrationBuckets}.`
        : "No backtest calibration evidence exists.",
      requiredAction:
        candidate && candidate.calibrationError !== null && candidate.calibrationBuckets > 0
          ? candidate.calibrationError <= 0.14
            ? null
            : "Recalibrate or expand the historical corpus before learned weights can influence shadow comparison."
          : "Store calibration buckets and expected calibration error from the latest holdout backtest."
    }),
    gate({
      id: "promotion-lock",
      label: "Operator promotion lock",
      status: "pass",
      detail: "The governor can only declare shadow eligibility; it cannot apply learned weights to predictions or public picks.",
      requiredAction: null
    })
  ];
  const status = statusFromGates(gates);
  const blockers = unique(gates.filter((item) => item.status !== "pass").map((item) => `${item.label}: ${item.requiredAction ?? item.detail}`), 8);

  return {
    sport,
    status,
    candidateStatus: candidate?.status ?? "missing",
    modelCardStatus: card?.status ?? "missing",
    governanceStatus: card?.governance.status ?? "missing",
    trustScore: card?.governance.trustScore ?? 0,
    backtestId: candidate?.backtestId ?? null,
    learnedWeights: candidate?.learnedWeights.length ?? 0,
    candidateHash: candidate?.candidateHash ?? null,
    gates,
    blockers,
    nextAction:
      status === "eligible-shadow"
        ? "Run a read-only shadow comparison against current deterministic picks; do not apply learned weights to public decisions."
        : blockers[0] ?? "Keep learned weights quarantined until candidate and governance gates pass."
  };
}

function overallStatus(decisions: LearnedWeightPromotionDecision[]): LearnedWeightPromotionGovernorStatus {
  if (decisions.some((decision) => decision.status === "blocked")) return "blocked";
  if (decisions.every((decision) => decision.status === "eligible-shadow")) return "eligible-shadow";
  if (decisions.some((decision) => decision.status === "waiting-candidate")) return "waiting-candidate";
  return "waiting-governance";
}

function summary(status: LearnedWeightPromotionGovernorStatus): string {
  if (status === "eligible-shadow") return "Learned weights are eligible for read-only shadow comparison, but promotion to predictions remains locked.";
  if (status === "waiting-candidate") return "Learned-weight promotion is waiting on completed shadow candidates and stored learned-weight payloads.";
  if (status === "waiting-governance") return "Learned-weight promotion is waiting on model-card governance approval.";
  return "Learned-weight promotion is blocked by candidate, governance, or safety-lock proof.";
}

export function buildLearnedWeightPromotionGovernor({
  date,
  shadowCandidates,
  modelCards,
  now = new Date()
}: {
  date: string;
  shadowCandidates: ShadowTrainingCandidates;
  modelCards: DecisionModelCards;
  now?: Date;
}): LearnedWeightPromotionGovernor {
  const candidatesBySport = new Map(shadowCandidates.candidates.map((candidate) => [candidate.sport, candidate]));
  const cardsBySport = new Map(modelCards.cards.map((card) => [card.sport, card]));
  const sports = unique([...shadowCandidates.candidates.map((candidate) => candidate.sport), ...modelCards.cards.map((card) => card.sport)], 6) as GovernedSport[];
  const decisions = sports.map((sport) =>
    decisionFor({
      sport,
      candidate: candidatesBySport.get(sport) ?? null,
      card: cardsBySport.get(sport) ?? null
    })
  );
  const status = overallStatus(decisions);
  const totals = {
    sports: decisions.length,
    eligibleShadow: decisions.filter((decision) => decision.status === "eligible-shadow").length,
    waitingCandidate: decisions.filter((decision) => decision.status === "waiting-candidate").length,
    waitingGovernance: decisions.filter((decision) => decision.status === "waiting-governance").length,
    blocked: decisions.filter((decision) => decision.status === "blocked").length,
    learnedWeights: decisions.reduce((sum, decision) => sum + decision.learnedWeights, 0)
  };
  const blockers = unique([
    ...shadowCandidates.blockers,
    ...decisions.flatMap((decision) => decision.blockers.map((blocker) => `${decision.sport}: ${blocker}`))
  ]);

  return {
    generatedAt: now.toISOString(),
    date,
    mode: "learned-weight-promotion-governor",
    status,
    governorHash: stableHash({
      date,
      shadow: shadowCandidates.candidateHash,
      modelCards: modelCards.cards.map((card) => [card.sport, card.status, card.governance.status, card.governance.trustScore]),
      decisions: decisions.map((decision) => [decision.sport, decision.status, decision.candidateHash])
    }),
    summary: summary(status),
    decisions,
    totals,
    nextSafeCommand: shadowCandidates.nextSafeCommand,
    controls: {
      canInspectReadOnly: true,
      canRunShadowComparison: status === "eligible-shadow",
      canApplyLearnedWeightsToPredictions: false,
      canPromoteLearnedWeights: false,
      canWriteProviderRows: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canUpgradePublicAction: false
    },
    blockers,
    proofUrls: unique([
      "/api/sports/decision/training/promotion-governor",
      "/api/sports/decision/training/shadow-candidates",
      "/api/sports/decision/model-cards",
      "/api/sports/decision/model-governance",
      ...shadowCandidates.proofUrls,
      ...modelCards.proofUrls
    ])
  };
}
