import type { DecisionBayesianBeliefLedger } from "@/lib/sports/prediction/decisionBayesianBeliefLedger";
import type { DecisionBrainReviewRunner } from "@/lib/sports/prediction/decisionBrainReviewRunner";
import type { DecisionBrainState } from "@/lib/sports/prediction/decisionBrainState";
import type { DecisionCycleGovernor } from "@/lib/sports/prediction/decisionCycleGovernor";
import type { DecisionInterventionPlanner } from "@/lib/sports/prediction/decisionInterventionPlanner";
import type { TrainingActivationRunbook } from "@/lib/sports/training/trainingActivationRunbook";
import type { TrainingReadiness } from "@/lib/sports/training/trainingReadiness";
import type { Sport } from "@/lib/sports/types";

export type DecisionLearningConsolidatorStatus = "ready-draft" | "waiting-memory" | "waiting-training" | "blocked";
export type DecisionLearningSignalCategory = "cycle-memory" | "outcome-label" | "calibration" | "training-feature" | "ai-review-feedback" | "intervention-label";
export type DecisionLearningSignalStatus = "draft" | "waiting" | "blocked";

export type DecisionLearningSignal = {
  id: string;
  category: DecisionLearningSignalCategory;
  status: DecisionLearningSignalStatus;
  label: string;
  detail: string;
  sourceHash: string;
  targetStore: "decision-memory" | "outcomes" | "calibration" | "training-corpus" | "review-memory";
  evidence: string[];
  learningImpact: string;
  blockedBy: string[];
  verifyUrl: string;
  safeToApply: false;
};

export type DecisionLearningConsolidator = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-learning-consolidator";
  status: DecisionLearningConsolidatorStatus;
  consolidatorHash: string;
  summary: string;
  activeSignal: DecisionLearningSignal | null;
  signals: DecisionLearningSignal[];
  trainingSnapshot: {
    readinessStatus: TrainingReadiness["status"];
    runbookStatus: TrainingActivationRunbook["status"];
    trainableSports: number;
    realFinishedFixtures: number;
    realOddsSnapshots: number;
    backtestRuns: number;
    nextTrainingEvidence: string;
  };
  memoryDraft: {
    canPersist: false;
    label: string;
    evidenceHash: string;
    content: string;
    tags: string[];
  };
  learningPolicy: {
    rule: string;
    canPersistMemory: false;
    canOpenOutcomeTicket: false;
    canRunCalibration: false;
    canBackfillCorpus: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
  };
  controls: {
    canInspectReadOnly: true;
    canPersistMemory: false;
    canPersistOutcomes: false;
    canRunCalibration: false;
    canWriteTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
    canUseHiddenChainOfThought: false;
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

function compact(value: string, maxLength = 300): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 18): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function signal(input: Omit<DecisionLearningSignal, "detail" | "evidence" | "learningImpact" | "blockedBy" | "safeToApply"> & {
  detail: string;
  evidence: Array<string | null | undefined>;
  learningImpact: string;
  blockedBy?: Array<string | null | undefined>;
}): DecisionLearningSignal {
  return {
    ...input,
    detail: compact(input.detail),
    evidence: unique(input.evidence, 8),
    learningImpact: compact(input.learningImpact),
    blockedBy: unique(input.blockedBy ?? [], 8),
    safeToApply: false
  };
}

function statusFromSignals(signals: DecisionLearningSignal[], trainingReadiness: TrainingReadiness): DecisionLearningConsolidatorStatus {
  if (signals.some((item) => item.status === "blocked")) return "blocked";
  if (trainingReadiness.status === "blocked") return "waiting-training";
  if (signals.some((item) => item.status === "waiting")) return "waiting-memory";
  return "ready-draft";
}

function buildSignals({
  brainState,
  beliefLedger,
  brainReviewRunner,
  interventionPlanner,
  cycleGovernor,
  trainingReadiness,
  trainingActivationRunbook
}: {
  brainState: DecisionBrainState;
  beliefLedger: DecisionBayesianBeliefLedger;
  brainReviewRunner: DecisionBrainReviewRunner;
  interventionPlanner: DecisionInterventionPlanner;
  cycleGovernor: DecisionCycleGovernor;
  trainingReadiness: TrainingReadiness;
  trainingActivationRunbook: TrainingActivationRunbook;
}): DecisionLearningSignal[] {
  const activeBelief = beliefLedger.activeBelief;
  const activeScenario = interventionPlanner.activeScenario;
  const trainingBlocked = trainingReadiness.status === "blocked" || trainingActivationRunbook.status === "blocked";
  return [
    signal({
      id: "learn-cycle-memory",
      category: "cycle-memory",
      status: "draft",
      label: cycleGovernor.memoryDraft.label,
      detail: cycleGovernor.memoryDraft.content,
      sourceHash: cycleGovernor.governorHash,
      targetStore: "decision-memory",
      evidence: [cycleGovernor.governorHash, cycleGovernor.selectedIntent.id, cycleGovernor.selectedIntent.rationale, ...cycleGovernor.doubts.slice(0, 3)],
      learningImpact: "Creates a replayable supervised-cycle memory so future decisions can compare why the agent held, inspected, asked AI, or ran evidence.",
      verifyUrl: "/api/sports/decision/cycle-governor"
    }),
    signal({
      id: "learn-outcome-label",
      category: "outcome-label",
      status: activeBelief?.matchId ? "waiting" : "blocked",
      label: `Outcome label for ${activeBelief?.match ?? brainState.activeThesis.match ?? "active thesis"}`,
      detail: activeBelief
        ? `Prepare a pending outcome label for ${activeBelief.match}; action ${activeBelief.action}, selection ${activeBelief.selection ?? "n/a"}, posterior ${activeBelief.posteriorProbability ?? "n/a"}.`
        : "No active belief is available to label.",
      sourceHash: beliefLedger.ledgerHash,
      targetStore: "outcomes",
      evidence: [activeBelief?.id, activeBelief?.summary, activeBelief?.falsifier],
      learningImpact: "Outcome labels are required before calibration, Brier score, ROI, and closing-line value can become real feedback.",
      blockedBy: activeBelief ? ["Outcome write remains locked until Supabase memory/outcome tables and admin controls are verified."] : ["No active belief."],
      verifyUrl: "/api/sports/decision/bayesian-belief-ledger"
    }),
    signal({
      id: "learn-intervention-label",
      category: "intervention-label",
      status: activeScenario ? "draft" : "blocked",
      label: `Intervention label: ${activeScenario?.outcome.replaceAll("-", " ") ?? "missing"}`,
      detail: activeScenario?.thesisChange ?? "No active intervention scenario is available.",
      sourceHash: interventionPlanner.plannerHash,
      targetStore: "decision-memory",
      evidence: [activeScenario?.id, activeScenario?.ifObserved, activeScenario?.ifMissing, activeScenario?.projected.action],
      learningImpact: "Stores what evidence would strengthen, monitor, downgrade, or block the thesis so future similar states can start with better priors.",
      blockedBy: activeScenario ? [] : ["No intervention scenario."],
      verifyUrl: "/api/sports/decision/intervention-planner"
    }),
    signal({
      id: "learn-ai-review-feedback",
      category: "ai-review-feedback",
      status: brainReviewRunner.status === "reviewed" ? "draft" : "waiting",
      label: "AI review feedback memory",
      detail: brainReviewRunner.appliedReview.summary,
      sourceHash: brainReviewRunner.runnerHash,
      targetStore: "review-memory",
      evidence: [brainReviewRunner.latestRun.status, brainReviewRunner.appliedReview.verdict, brainReviewRunner.appliedReview.recommendedAction, brainReviewRunner.latestRun.reason],
      learningImpact: "Captures whether AI agreed, downgraded, requested evidence, or blocked the thesis without using hidden chain-of-thought.",
      blockedBy: brainReviewRunner.status === "reviewed" ? [] : [brainReviewRunner.latestRun.reason ?? brainReviewRunner.summary],
      verifyUrl: "/api/sports/decision/brain-review-runner"
    }),
    signal({
      id: "learn-calibration-gap",
      category: "calibration",
      status: trainingReadiness.totals.backtestRuns > 0 ? "draft" : "waiting",
      label: "Calibration/backtest feedback gap",
      detail: `Training readiness has ${trainingReadiness.totals.realFinishedFixtures} finished fixtures, ${trainingReadiness.totals.realOddsSnapshots} odds snapshots, and ${trainingReadiness.totals.backtestRuns} backtest runs.`,
      sourceHash: trainingReadiness.readinessHash,
      targetStore: "calibration",
      evidence: [trainingReadiness.summary, trainingReadiness.nextSafeCommand.expectedEvidence, trainingActivationRunbook.nextStep?.expectedEvidence],
      learningImpact: "Links today's supervised decision to the historical corpus requirements needed for calibrated model weights and market-edge reliability.",
      blockedBy: trainingReadiness.totals.backtestRuns > 0 ? [] : ["No real-data backtest run is available yet."],
      verifyUrl: "/api/sports/decision/training/readiness"
    }),
    signal({
      id: "learn-training-feature",
      category: "training-feature",
      status: trainingBlocked ? "blocked" : "waiting",
      label: "Training feature candidate",
      detail: `Candidate feature snapshot should include active thesis, posterior, EV, evidence debt, intervention outcome, and selected governor intent for ${brainState.activeThesis.match ?? "the slate"}.`,
      sourceHash: stableHash({
        brain: brainState.brainHash,
        belief: beliefLedger.ledgerHash,
        intervention: interventionPlanner.plannerHash,
        governor: cycleGovernor.governorHash
      }),
      targetStore: "training-corpus",
      evidence: [
        brainState.activeThesis.match,
        brainState.activeThesis.selection,
        String(brainState.activeThesis.posteriorProbability ?? "no-posterior"),
        String(brainState.activeThesis.expectedValue ?? "no-ev"),
        activeScenario?.outcome,
        cycleGovernor.selectedIntent.id
      ],
      learningImpact: "Defines the future feature row shape for supervised learning once corpus writes and model training are allowed.",
      blockedBy: trainingBlocked ? trainingActivationRunbook.blockers : ["Training writes remain locked until corpus proof, outcome labels, and backtests are complete."],
      verifyUrl: "/api/sports/decision/training/activation-runbook"
    })
  ];
}

export function buildDecisionLearningConsolidator({
  date,
  sport,
  brainState,
  beliefLedger,
  brainReviewRunner,
  interventionPlanner,
  cycleGovernor,
  trainingReadiness,
  trainingActivationRunbook,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  brainState: DecisionBrainState;
  beliefLedger: DecisionBayesianBeliefLedger;
  brainReviewRunner: DecisionBrainReviewRunner;
  interventionPlanner: DecisionInterventionPlanner;
  cycleGovernor: DecisionCycleGovernor;
  trainingReadiness: TrainingReadiness;
  trainingActivationRunbook: TrainingActivationRunbook;
  now?: Date;
}): DecisionLearningConsolidator {
  const signals = buildSignals({
    brainState,
    beliefLedger,
    brainReviewRunner,
    interventionPlanner,
    cycleGovernor,
    trainingReadiness,
    trainingActivationRunbook
  });
  const activeSignal = signals.find((item) => item.status === "blocked") ?? signals.find((item) => item.status === "waiting") ?? signals[0] ?? null;
  const status = statusFromSignals(signals, trainingReadiness);
  const consolidatorHash = stableHash({
    date,
    sport,
    brain: brainState.brainHash,
    belief: beliefLedger.ledgerHash,
    runner: brainReviewRunner.runnerHash,
    intervention: interventionPlanner.plannerHash,
    governor: cycleGovernor.governorHash,
    training: trainingReadiness.readinessHash,
    signals: signals.map((item) => [item.id, item.status, item.sourceHash])
  });
  const tags = unique([
    sport,
    cycleGovernor.selectedIntent.id,
    brainState.activeThesis.publicStance,
    brainState.activeThesis.confidenceCeiling,
    interventionPlanner.activeScenario?.outcome,
    brainReviewRunner.appliedReview.verdict,
    trainingReadiness.status
  ], 10);

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "decision-learning-consolidator",
    status,
    consolidatorHash,
    summary:
      status === "blocked"
        ? "Learning consolidator found blocked memory/training signals; no write or training action can run."
        : status === "waiting-training"
          ? "Learning consolidator has draft signals, but training readiness is still blocked."
          : status === "waiting-memory"
            ? "Learning consolidator prepared drafts while waiting for outcome, AI, memory, or corpus proof."
            : "Learning consolidator prepared replayable memory and training drafts for the supervised cycle.",
    activeSignal,
    signals,
    trainingSnapshot: {
      readinessStatus: trainingReadiness.status,
      runbookStatus: trainingActivationRunbook.status,
      trainableSports: trainingReadiness.totals.trainableSports,
      realFinishedFixtures: trainingReadiness.totals.realFinishedFixtures,
      realOddsSnapshots: trainingReadiness.totals.realOddsSnapshots,
      backtestRuns: trainingReadiness.totals.backtestRuns,
      nextTrainingEvidence: trainingActivationRunbook.nextStep?.expectedEvidence ?? trainingReadiness.nextSafeCommand.expectedEvidence
    },
    memoryDraft: {
      canPersist: false,
      label: cycleGovernor.memoryDraft.label,
      evidenceHash: stableHash({ consolidatorHash, cycle: cycleGovernor.memoryDraft.evidenceHash, signals: signals.map((item) => item.id) }),
      content: compact(`${cycleGovernor.memoryDraft.content} Learning signal: ${activeSignal?.learningImpact ?? "No active learning signal."}`),
      tags
    },
    learningPolicy: {
      rule: "Consolidate what the engine should remember or learn, but keep all memory, outcome, calibration, corpus, and model-training writes locked.",
      canPersistMemory: false,
      canOpenOutcomeTicket: false,
      canRunCalibration: false,
      canBackfillCorpus: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false
    },
    controls: {
      canInspectReadOnly: true,
      canPersistMemory: false,
      canPersistOutcomes: false,
      canRunCalibration: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/learning-consolidator",
      "/api/sports/decision/cycle-governor",
      "/api/sports/decision/training/readiness",
      "/api/sports/decision/training/activation-runbook",
      "/api/sports/decision/brain-review-runner",
      "/api/sports/decision/intervention-planner",
      ...cycleGovernor.proofUrls,
      ...trainingReadiness.proofUrls,
      ...trainingActivationRunbook.proofUrls
    ], 24),
    locks: unique([
      "Learning consolidator is draft-only and cannot write memory, outcomes, calibration, corpus rows, or model weights.",
      "No learning signal can publish picks, train models, stake, or upgrade public action.",
      "Memory draft excludes hidden chain-of-thought and stores only public evidence labels.",
      ...cycleGovernor.locks,
      ...trainingActivationRunbook.blockers
    ], 24)
  };
}
