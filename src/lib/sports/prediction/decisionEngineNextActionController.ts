import type { DecisionCognitionScorecard } from "@/lib/sports/prediction/decisionCognitionScorecard";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { SupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";
import type { Sport } from "@/lib/sports/types";

export type DecisionEngineNextActionControllerStatus = "ready-readonly" | "waiting-corpus" | "repair-evidence" | "blocked";
export type DecisionEngineNextActionId =
  | "review-shadow-backtest"
  | "fill-corpus"
  | "inspect-evidence-sufficiency"
  | "repair-supabase"
  | "validate-final-answer"
  | "hold";

export type DecisionEngineNextActionController = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-engine-next-action-controller";
  status: DecisionEngineNextActionControllerStatus;
  controllerHash: string;
  summary: string;
  input: {
    scorecardHash: string;
    scorecardStatus: DecisionCognitionScorecard["status"];
    scorecardGrade: DecisionCognitionScorecard["grade"];
    scorecardTotal: number;
    corpusHash: string;
    corpusStatus: SupabaseTrainingCorpusCensus["status"];
    finishedFixtures: number;
    oddsSnapshots: number;
    featureSnapshots: number;
    completedBacktests: number;
  };
  selectedAction: {
    id: DecisionEngineNextActionId;
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    reason: string;
    expectedEvidence: string;
  };
  rationale: {
    strongestSignal: string;
    biggestDoubt: string;
    corpusSignal: string;
    scorecardSignal: string;
    whyThisAction: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunSelectedReadOnlyAction: boolean;
    canCallOpenAI: false;
    canFetchProviders: false;
    canWriteSupabaseRows: false;
    canPersistDecisions: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
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

function compact(value: string | null | undefined, maxLength = 280): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return "No evidence available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  return Array.from(new Set(values.map((value) => compact(value)).filter((value) => value !== "No evidence available."))).slice(0, limit);
}

function safeApiUrl(value: string): boolean {
  const lower = value.toLowerCase();
  if (!lower.startsWith("/api/sports/decision/")) return false;
  let url: URL;
  try {
    url = new URL(value, "http://127.0.0.1:3025");
  } catch {
    return false;
  }
  const blockedParams = ["persist", "publish", "train", "stake", "run", "openAiRun"];
  for (const param of blockedParams) {
    const raw = url.searchParams.get(param);
    const normalized = raw?.toLowerCase();
    if (normalized === "1" || normalized === "true") return false;
  }
  const dryRun = url.searchParams.get("dryRun")?.toLowerCase();
  return dryRun !== "0" && dryRun !== "false";
}

function action({
  id,
  label,
  verifyUrl,
  reason,
  expectedEvidence
}: {
  id: DecisionEngineNextActionId;
  label: string;
  verifyUrl: string;
  reason: string;
  expectedEvidence: string;
}): DecisionEngineNextActionController["selectedAction"] {
  const safeToRun = safeApiUrl(verifyUrl);
  return {
    id,
    label,
    command: safeToRun ? decisionCurlCommand(verifyUrl) : null,
    verifyUrl,
    safeToRun,
    reason: compact(reason),
    expectedEvidence: compact(expectedEvidence)
  };
}

function selectedActionFor({
  scorecard,
  corpus
}: {
  scorecard: DecisionCognitionScorecard;
  corpus: SupabaseTrainingCorpusCensus;
}): DecisionEngineNextActionController["selectedAction"] {
  const evidenceMetric = scorecard.metrics.find((metric) => metric.id === "evidence");
  const uncertaintyMetric = scorecard.metrics.find((metric) => metric.id === "uncertainty");

  if (corpus.status === "failed" || !corpus.target.serverReadReady || !corpus.target.targetMatchesExpected) {
    return action({
      id: "repair-supabase",
      label: "Repair Supabase corpus reads",
      verifyUrl: "/api/sports/decision/supabase-credential-activation",
      reason: corpus.summary,
      expectedEvidence: corpus.nextAction.expectedEvidence
    });
  }

  if (corpus.status === "waiting-supabase" || corpus.status === "empty-corpus" || corpus.status === "partial-corpus") {
    return action({
      id: "fill-corpus",
      label: "Fill missing corpus lanes",
      verifyUrl: corpus.nextAction.verifyUrl,
      reason: corpus.summary,
      expectedEvidence: corpus.nextAction.expectedEvidence
    });
  }

  if (corpus.status === "ready-shadow-backtest" && scorecard.score.total < 70) {
    return action({
      id: "review-shadow-backtest",
      label: "Review shadow backtest promotion gates",
      verifyUrl: "/api/sports/decision/training/football-data-model-promotion-decision?dryRun=1",
      reason: `Corpus is shadow-backtest ready, but scorecard remains ${scorecard.status} at ${scorecard.score.total}/100.`,
      expectedEvidence: "Market benchmark, threshold sweep, walk-forward validation, and provider-retest gates explain whether learned weights stay blocked or move to shadow review."
    });
  }

  if (evidenceMetric?.status === "block" || uncertaintyMetric?.status === "block") {
    return action({
      id: "inspect-evidence-sufficiency",
      label: "Inspect evidence sufficiency",
      verifyUrl: "/api/sports/decision/evidence-sufficiency-score",
      reason: evidenceMetric?.nextAction ?? uncertaintyMetric?.nextAction ?? scorecard.diagnosis.biggestDoubt,
      expectedEvidence: "Evidence sufficiency identifies which live data, market, model, or promotion gate blocks trust."
    });
  }

  if (scorecard.status === "ready-shadow") {
    return action({
      id: "validate-final-answer",
      label: "Validate final answer gates",
      verifyUrl: "/api/sports/decision/final-answer-validation",
      reason: scorecard.summary,
      expectedEvidence: "Final answer validation confirms trust firewall, activation contract, promotion gate, and public safety before any answer is surfaced."
    });
  }

  return action({
    id: "hold",
    label: "Hold engine",
    verifyUrl: "/api/sports/decision/cognition-scorecard?corpusRun=1",
    reason: scorecard.diagnosis.biggestDoubt,
    expectedEvidence: scorecard.diagnosis.nextSafeAction
  });
}

function statusFor(actionId: DecisionEngineNextActionId, scorecard: DecisionCognitionScorecard): DecisionEngineNextActionControllerStatus {
  if (actionId === "repair-supabase" || actionId === "hold") return "blocked";
  if (actionId === "fill-corpus") return "waiting-corpus";
  if (scorecard.status === "blocked") return "repair-evidence";
  return "ready-readonly";
}

export function buildDecisionEngineNextActionController({
  scorecard,
  corpus,
  now = new Date()
}: {
  scorecard: DecisionCognitionScorecard;
  corpus: SupabaseTrainingCorpusCensus;
  now?: Date;
}): DecisionEngineNextActionController {
  const selectedAction = selectedActionFor({ scorecard, corpus });
  const status = statusFor(selectedAction.id, scorecard);
  const controllerHash = stableHash({
    scorecard: [scorecard.scorecardHash, scorecard.status, scorecard.grade, scorecard.score.total],
    corpus: [corpus.censusHash, corpus.status, corpus.totals],
    selectedAction: [selectedAction.id, selectedAction.verifyUrl, selectedAction.safeToRun]
  });

  return {
    generatedAt: now.toISOString(),
    date: scorecard.date,
    sport: scorecard.sport,
    mode: "decision-engine-next-action-controller",
    status,
    controllerHash,
    summary:
      status === "ready-readonly"
        ? `Engine controller selected a safe read-only next action: ${selectedAction.label}.`
        : status === "waiting-corpus"
          ? `Engine controller is waiting on corpus work: ${selectedAction.reason}`
          : status === "repair-evidence"
            ? `Engine controller is repairing evidence before trust can rise: ${selectedAction.reason}`
            : `Engine controller is blocked: ${selectedAction.reason}`,
    input: {
      scorecardHash: scorecard.scorecardHash,
      scorecardStatus: scorecard.status,
      scorecardGrade: scorecard.grade,
      scorecardTotal: scorecard.score.total,
      corpusHash: corpus.censusHash,
      corpusStatus: corpus.status,
      finishedFixtures: corpus.totals.finishedFixtures,
      oddsSnapshots: corpus.totals.oddsSnapshots,
      featureSnapshots: corpus.totals.featureSnapshots,
      completedBacktests: corpus.totals.completedBacktests
    },
    selectedAction,
    rationale: {
      strongestSignal: compact(scorecard.diagnosis.strongestSignal),
      biggestDoubt: compact(scorecard.diagnosis.biggestDoubt),
      corpusSignal: compact(corpus.summary),
      scorecardSignal: compact(scorecard.summary),
      whyThisAction: compact(selectedAction.reason)
    },
    controls: {
      canInspectReadOnly: true,
      canRunSelectedReadOnlyAction: selectedAction.safeToRun,
      canCallOpenAI: false,
      canFetchProviders: false,
      canWriteSupabaseRows: false,
      canPersistDecisions: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/engine-next-action-controller",
      "/api/sports/decision/cognition-scorecard?corpusRun=1",
      "/api/sports/decision/training/supabase-training-corpus-census",
      selectedAction.verifyUrl,
      ...scorecard.proofUrls,
      ...corpus.proofUrls
    ]),
    locks: unique([
      "Engine next-action controller is read-only and cannot call OpenAI, fetch providers, write Supabase rows, persist decisions, train models, apply weights, adjust probabilities, raise confidence, publish picks, stake, or use hidden chain-of-thought.",
      "Controller output chooses the next proof to inspect; it does not execute side effects.",
      ...scorecard.locks,
      ...corpus.locks
    ])
  };
}
