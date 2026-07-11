import type { DecisionMvpAIDecisionTurn } from "@/lib/sports/prediction/decisionMvpAIDecisionTurn";
import type { DecisionMvpAIExperimentObserver } from "@/lib/sports/prediction/decisionMvpAIExperimentObserver";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";

export type DecisionMvpAIExperimentMemoryStatus = "ready-shadow-memory" | "waiting-observation" | "contradiction-review" | "warning-review" | "blocked";

export type DecisionMvpAIExperimentMemoryCell = {
  id: "learned" | "remaining-doubt" | "next-safe-move" | "safety-boundary";
  label: string;
  status: "retained" | "waiting" | "warning" | "block";
  content: string;
  evidence: string[];
};

export type DecisionMvpAIExperimentMemory = {
  mode: "decision-mvp-ai-experiment-memory";
  generatedAt: string;
  date: string;
  sport: DecisionMvpAIDecisionTurn["sport"];
  status: DecisionMvpAIExperimentMemoryStatus;
  memoryHash: string;
  summary: string;
  cells: DecisionMvpAIExperimentMemoryCell[];
  interpretation: {
    learned: string;
    remainingDoubt: string;
    nextSafeMove: string;
    memoryUse: "shadow-only" | "blocked";
    observerOutcome: DecisionMvpAIExperimentObserver["interpretation"]["outcome"];
    beliefEffect: DecisionMvpAIExperimentObserver["interpretation"]["beliefEffect"];
    probabilityEffect: 0;
    publicActionEffect: "none";
  };
  source: {
    decisionTurnHash: string;
    observerHash: string;
    selectedProof: string;
    observationStatus: DecisionMvpAIExperimentObserver["status"];
  };
  controls: {
    canInspectReadOnly: true;
    canRetainWorkingMemory: boolean;
    canRunObserver: boolean;
    canPersistMemory: false;
    canCallOpenAI: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
    canUseHiddenChainOfThought: false;
  };
  nextAction: {
    label: string;
    command: string | null;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
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

function compact(value: string | null | undefined, maxLength = 320): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No evidence available.";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function statusFor(observer: DecisionMvpAIExperimentObserver): DecisionMvpAIExperimentMemoryStatus {
  if (observer.status === "blocked") return "blocked";
  if (observer.status === "ready-observation") return "waiting-observation";
  if (observer.status === "observed-contradiction") return "contradiction-review";
  if (observer.status === "observed-warning" || observer.status === "failed") return "warning-review";
  return "ready-shadow-memory";
}

function summaryFor(status: DecisionMvpAIExperimentMemoryStatus, selectedProof: string): string {
  if (status === "ready-shadow-memory") return `MVP AI experiment memory retained shadow support from ${selectedProof}; public action remains unchanged.`;
  if (status === "contradiction-review") return `MVP AI experiment memory retained contradiction pressure from ${selectedProof}; confidence cannot rise.`;
  if (status === "warning-review") return `MVP AI experiment memory retained a warning from ${selectedProof}; the next step is manual proof review.`;
  if (status === "blocked") return `MVP AI experiment memory is blocked because ${selectedProof} cannot be observed safely.`;
  return `MVP AI experiment memory is waiting for one read-only observation from ${selectedProof}.`;
}

function cellsFor({
  status,
  decisionTurn,
  observer
}: {
  status: DecisionMvpAIExperimentMemoryStatus;
  decisionTurn: DecisionMvpAIDecisionTurn;
  observer: DecisionMvpAIExperimentObserver;
}): DecisionMvpAIExperimentMemoryCell[] {
  const observedSignals = observer.observation.signals.length ? observer.observation.signals : ["No observer response signals yet."];
  const waiting = status === "waiting-observation";
  const blocked = status === "blocked";
  const caution = status === "warning-review" || status === "contradiction-review";
  const cellStatus = blocked ? "block" : waiting ? "waiting" : caution ? "warning" : "retained";

  return [
    {
      id: "learned",
      label: "Learned",
      status: cellStatus,
      content: compact(observer.interpretation.learned),
      evidence: unique([observer.interpretation.outcome, observer.observation.statusLabel, ...observedSignals], 8)
    },
    {
      id: "remaining-doubt",
      label: "Remaining doubt",
      status: blocked || caution ? "warning" : waiting ? "waiting" : "retained",
      content: compact(
        caution || blocked
          ? observer.interpretation.risk
          : decisionTurn.thinkingAudit.uncertaintyDrivers[0] ?? decisionTurn.turn.doubt
      ),
      evidence: unique([decisionTurn.turn.doubt, ...decisionTurn.thinkingAudit.counterEvidence.slice(0, 3)], 6)
    },
    {
      id: "next-safe-move",
      label: "Next safe move",
      status: blocked ? "block" : waiting ? "waiting" : "retained",
      content: compact(observer.interpretation.nextAction),
      evidence: unique([observer.nextAction.expectedEvidence, decisionTurn.thinkingAudit.safestNextStep], 4)
    },
    {
      id: "safety-boundary",
      label: "Safety boundary",
      status: "retained",
      content: "This memory is shadow-only and cannot write rows, train models, adjust probabilities, raise confidence, publish picks, stake, or reveal hidden chain-of-thought.",
      evidence: unique([decisionTurn.experimentProtocol.readOnlyBoundary, ...observer.locks.slice(0, 3)], 5)
    }
  ];
}

export function buildDecisionMvpAIExperimentMemory({
  decisionTurn,
  experimentObserver,
  origin,
  now = new Date()
}: {
  decisionTurn: DecisionMvpAIDecisionTurn;
  experimentObserver: DecisionMvpAIExperimentObserver;
  origin?: string;
  now?: Date;
}): DecisionMvpAIExperimentMemory {
  const status = statusFor(experimentObserver);
  const cells = cellsFor({ status, decisionTurn, observer: experimentObserver });
  const memoryUse = status === "blocked" ? "blocked" : "shadow-only";
  const safeToRun = status === "waiting-observation" && experimentObserver.controls.canObserveProof;
  const verifyUrl = "/api/sports/decision/mvp-ai-experiment-memory";
  const siteOrigin = origin ?? decisionSiteOrigin();

  return {
    mode: "decision-mvp-ai-experiment-memory",
    generatedAt: now.toISOString(),
    date: decisionTurn.date,
    sport: decisionTurn.sport,
    status,
    memoryHash: stableHash({
      status,
      decisionTurnHash: decisionTurn.turnHash,
      observerHash: experimentObserver.observerHash,
      cells: cells.map((cell) => [cell.id, cell.status, cell.content]),
      observerOutcome: experimentObserver.interpretation.outcome
    }),
    summary: summaryFor(status, decisionTurn.turn.selectedProof),
    cells,
    interpretation: {
      learned: cells.find((cell) => cell.id === "learned")?.content ?? "No learned signal retained.",
      remainingDoubt: cells.find((cell) => cell.id === "remaining-doubt")?.content ?? "No remaining doubt retained.",
      nextSafeMove: cells.find((cell) => cell.id === "next-safe-move")?.content ?? "No next move retained.",
      memoryUse,
      observerOutcome: experimentObserver.interpretation.outcome,
      beliefEffect: experimentObserver.interpretation.beliefEffect,
      probabilityEffect: 0,
      publicActionEffect: "none"
    },
    source: {
      decisionTurnHash: decisionTurn.turnHash,
      observerHash: experimentObserver.observerHash,
      selectedProof: decisionTurn.turn.selectedProof,
      observationStatus: experimentObserver.status
    },
    controls: {
      canInspectReadOnly: true,
      canRetainWorkingMemory: status !== "blocked",
      canRunObserver: safeToRun,
      canPersistMemory: false,
      canCallOpenAI: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    nextAction: {
      label: safeToRun ? "Observe into working memory" : cells.find((cell) => cell.status === "block" || cell.status === "warning")?.label ?? "Review working memory",
      command: safeToRun ? `curl.exe -sS "${new URL(`${verifyUrl}?date=${encodeURIComponent(decisionTurn.date)}&sport=${encodeURIComponent(decisionTurn.sport)}&observe=1`, siteOrigin).toString()}"` : null,
      verifyUrl,
      safeToRun,
      expectedEvidence: compact(safeToRun ? "Fetch one approved local GET proof and retain the observation as shadow-only working memory." : experimentObserver.interpretation.nextAction)
    },
    proofUrls: unique([verifyUrl, "/api/sports/decision/mvp-ai-experiment-observer", ...experimentObserver.proofUrls, ...decisionTurn.proofUrls]),
    locks: unique([
      "MVP AI experiment memory is read-only working memory; it does not persist memory or outcomes.",
      "Experiment memory can retain support, warning, contradiction, block, or hold signals for shadow review only.",
      "Experiment memory cannot call OpenAI, write provider rows, train models, apply learned weights, adjust probabilities, raise confidence, publish picks, stake, upgrade public action, or expose hidden chain-of-thought.",
      ...experimentObserver.locks,
      ...decisionTurn.locks
    ])
  };
}
