import type { DecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import type { DecisionMvpEvidenceAcquisitionQueue } from "@/lib/sports/prediction/decisionMvpEvidenceAcquisitionQueue";
import type { DecisionMvpProgressSnapshot } from "@/lib/sports/prediction/decisionMvpProgressSnapshot";
import type { DecisionMvpProviderProofGate } from "@/lib/sports/prediction/decisionMvpProviderProofGate";
import type { DecisionMvpStorageCorpusGate } from "@/lib/sports/prediction/decisionMvpStorageCorpusGate";
import type { Prediction, Sport } from "@/lib/sports/types";

export type DecisionMvpAnswerAuthorityGateStatus =
  | "waiting-provider-proof"
  | "waiting-storage-corpus"
  | "waiting-openai-review"
  | "monitor-only"
  | "ready-shadow-review"
  | "blocked";

export type DecisionMvpAnswerAuthorityGateCheckStatus = "pass" | "watch" | "block";
export type DecisionMvpAnswerAuthorityGateCheckId =
  | "provider-proof"
  | "storage-corpus"
  | "openai-review"
  | "evidence-queue"
  | "value-edge"
  | "promotion-contract"
  | "responsible-controls";

export type DecisionMvpAnswerAuthorityGateCheck = {
  id: DecisionMvpAnswerAuthorityGateCheckId;
  label: string;
  status: DecisionMvpAnswerAuthorityGateCheckStatus;
  detail: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionMvpAnswerAuthorityRowLike = {
  prediction: Pick<Prediction, "bestPick"> & {
    decision: Pick<Prediction["decision"], "action" | "controlPolicy" | "oddsIntelligence">;
  };
};

export type DecisionMvpAnswerAuthorityGate = {
  mode: "decision-mvp-answer-authority-gate";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpAnswerAuthorityGateStatus;
  authorityHash: string;
  summary: string;
  publicAnswer: {
    allowed: false;
    mode: "locked" | "monitor-only" | "shadow-review";
    reason: string;
    rows: number;
    actionableRows: number;
    monitorRows: number;
    avoidRows: number;
    valueRows: number;
    publishableRows: number;
    lockedRows: number;
  };
  selectedGate: DecisionMvpAnswerAuthorityGateCheck | null;
  checks: DecisionMvpAnswerAuthorityGateCheck[];
  totals: {
    checks: number;
    pass: number;
    watch: number;
    block: number;
  };
  nextAction: {
    label: string;
    detail: string;
    proofUrl: string;
  };
  controls: {
    canInspectReadOnly: true;
    canDisplayMonitor: boolean;
    canRequestOpenAIReview: boolean;
    canPersistDecisions: false;
    canWriteProviderRows: false;
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

function compact(value: string | null | undefined, maxLength = 260): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No detail available.";
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

function check(input: DecisionMvpAnswerAuthorityGateCheck): DecisionMvpAnswerAuthorityGateCheck {
  return {
    ...input,
    detail: compact(input.detail),
    nextAction: compact(input.nextAction)
  };
}

function rowTotals(rows: DecisionMvpAnswerAuthorityRowLike[]): DecisionMvpAnswerAuthorityGate["publicAnswer"] {
  const actionableRows = rows.filter((row) => row.prediction.decision.action !== "avoid").length;
  const monitorRows = rows.filter((row) => row.prediction.decision.action === "monitor").length;
  const avoidRows = rows.filter((row) => row.prediction.decision.action === "avoid").length;
  const valueRows = rows.filter(
    (row) =>
      row.prediction.bestPick.hasValue &&
      row.prediction.bestPick.edge > 0 &&
      row.prediction.bestPick.expectedValue > 0 &&
      row.prediction.decision.oddsIntelligence.actionableSelections > 0
  ).length;
  const publishableRows = rows.filter((row) => row.prediction.decision.controlPolicy.publishAllowed).length;

  return {
    allowed: false,
    mode: "locked",
    reason: "Public answer authority has not been evaluated.",
    rows: rows.length,
    actionableRows,
    monitorRows,
    avoidRows,
    valueRows,
    publishableRows,
    lockedRows: rows.length - publishableRows
  };
}

function providerProofCheck(providerProofGate: DecisionMvpProviderProofGate): DecisionMvpAnswerAuthorityGateCheck {
  const status: DecisionMvpAnswerAuthorityGateCheckStatus =
    providerProofGate.status === "proof-observed" ? "pass" : providerProofGate.status === "ready-dry-run" ? "watch" : "block";
  return check({
    id: "provider-proof",
    label: "Provider proof",
    status,
    detail: providerProofGate.summary,
    nextAction: providerProofGate.nextAction.detail,
    proofUrl: providerProofGate.nextAction.proofUrl
  });
}

function storageCorpusCheck(storageCorpusGate: DecisionMvpStorageCorpusGate): DecisionMvpAnswerAuthorityGateCheck {
  const status: DecisionMvpAnswerAuthorityGateCheckStatus =
    storageCorpusGate.status === "ready-dry-run" ? "pass" : storageCorpusGate.status === "waiting-corpus" || storageCorpusGate.status === "waiting-provider-proof" ? "watch" : "block";
  return check({
    id: "storage-corpus",
    label: "Storage and corpus",
    status,
    detail: storageCorpusGate.summary,
    nextAction: storageCorpusGate.nextStep.detail,
    proofUrl: storageCorpusGate.nextStep.proofUrl
  });
}

function openAiCheck(aiReviewReadiness: DecisionAIReviewReadiness): DecisionMvpAnswerAuthorityGateCheck {
  const status: DecisionMvpAnswerAuthorityGateCheckStatus =
    aiReviewReadiness.status === "ready-to-run" ? "pass" : aiReviewReadiness.status === "needs-key" ? "block" : "watch";
  return check({
    id: "openai-review",
    label: "OpenAI review",
    status,
    detail: aiReviewReadiness.summary,
    nextAction: aiReviewReadiness.nextSafeCommand.expectedEvidence,
    proofUrl: "/api/sports/decision/openai-key-diagnostic"
  });
}

function evidenceQueueCheck(evidenceQueue: DecisionMvpEvidenceAcquisitionQueue): DecisionMvpAnswerAuthorityGateCheck {
  const status: DecisionMvpAnswerAuthorityGateCheckStatus =
    evidenceQueue.status === "ready-readonly" ? "watch" : evidenceQueue.status === "blocked" ? "block" : "watch";
  return check({
    id: "evidence-queue",
    label: "Evidence queue",
    status,
    detail: evidenceQueue.summary,
    nextAction: evidenceQueue.nextItem?.expectedBeliefChange ?? evidenceQueue.locks[0],
    proofUrl: evidenceQueue.nextItem?.proofUrl ?? "/api/sports/decision/mvp-evidence-acquisition-queue"
  });
}

function valueEdgeCheck(publicAnswer: DecisionMvpAnswerAuthorityGate["publicAnswer"]): DecisionMvpAnswerAuthorityGateCheck {
  const status: DecisionMvpAnswerAuthorityGateCheckStatus = publicAnswer.valueRows > 0 ? "watch" : "block";
  return check({
    id: "value-edge",
    label: "Value edge",
    status,
    detail: `${publicAnswer.valueRows}/${publicAnswer.rows} row(s) have positive EV and odds-intelligence actionability; ${publicAnswer.publishableRows} row(s) are locally publishable before MVP authority caps.`,
    nextAction:
      publicAnswer.valueRows > 0
        ? "Keep positive-EV rows in monitor/shadow mode until provider, storage, OpenAI, and promotion proof all clear."
        : "Acquire bookmaker odds and model evidence until at least one priced row has positive edge and expected value.",
    proofUrl: "/api/sports/decision/odds-intelligence-proof"
  });
}

function promotionContractCheck(): DecisionMvpAnswerAuthorityGateCheck {
  return check({
    id: "promotion-contract",
    label: "Answer promotion",
    status: "block",
    detail: "The full answer-promotion gate must clear provider evidence, model reasoning, calibrated market value, backtests, AI review, risk council, abstention, and public locks together.",
    nextAction: "Run the deep answer-promotion gate after provider proof, storage/corpus, OpenAI review, and backtest evidence are present.",
    proofUrl: "/api/sports/decision/answer-promotion-gate"
  });
}

function responsibleControlsCheck(): DecisionMvpAnswerAuthorityGateCheck {
  return check({
    id: "responsible-controls",
    label: "Responsible controls",
    status: "pass",
    detail: "The MVP authority gate is read-only and keeps publishing, staking, training, learned weights, probability edits, confidence upgrades, and hidden chain-of-thought locked.",
    nextAction: "Keep public output as analysis/monitoring until all authority gates pass and a separate launch decision enables publishing.",
    proofUrl: "/api/sports/decision/final-answer-contract"
  });
}

function statusFor(checks: DecisionMvpAnswerAuthorityGateCheck[], publicAnswer: DecisionMvpAnswerAuthorityGate["publicAnswer"]): DecisionMvpAnswerAuthorityGateStatus {
  const blocked = checks.find((item) => item.status === "block");
  if (!publicAnswer.rows) return "blocked";
  if (blocked?.id === "provider-proof") return "waiting-provider-proof";
  if (blocked?.id === "storage-corpus") return "waiting-storage-corpus";
  if (blocked?.id === "openai-review") return "waiting-openai-review";
  if (blocked) return "blocked";
  if (publicAnswer.valueRows > 0 && publicAnswer.actionableRows > 0) return "ready-shadow-review";
  return "monitor-only";
}

function publicModeFor(status: DecisionMvpAnswerAuthorityGateStatus): DecisionMvpAnswerAuthorityGate["publicAnswer"]["mode"] {
  if (status === "ready-shadow-review") return "shadow-review";
  if (status === "monitor-only") return "monitor-only";
  return "locked";
}

function summaryFor(status: DecisionMvpAnswerAuthorityGateStatus, selected: DecisionMvpAnswerAuthorityGateCheck | null): string {
  if (status === "ready-shadow-review") return "The MVP can prepare a shadow answer for operator review, but public picks and staking remain locked.";
  if (status === "monitor-only") return "The MVP can show monitor-only analysis while value evidence or promotion proof is still incomplete.";
  if (status === "waiting-provider-proof") return "Answer authority is waiting on provider dry-run proof before a public recommendation can be considered.";
  if (status === "waiting-storage-corpus") return "Answer authority is waiting on OddsPadi storage and 10-year corpus proof before promotion.";
  if (status === "waiting-openai-review") return "Answer authority is waiting on guarded OpenAI review readiness before final-answer promotion.";
  return `Answer authority is blocked by ${selected?.label ?? "missing slate evidence"}.`;
}

export function buildDecisionMvpAnswerAuthorityGate({
  date,
  sport,
  rows,
  mvpProgressSnapshot,
  providerProofGate,
  storageCorpusGate,
  evidenceQueue,
  aiReviewReadiness,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  rows: DecisionMvpAnswerAuthorityRowLike[];
  mvpProgressSnapshot: DecisionMvpProgressSnapshot;
  providerProofGate: DecisionMvpProviderProofGate;
  storageCorpusGate: DecisionMvpStorageCorpusGate;
  evidenceQueue: DecisionMvpEvidenceAcquisitionQueue;
  aiReviewReadiness: DecisionAIReviewReadiness;
  now?: Date;
}): DecisionMvpAnswerAuthorityGate {
  const publicAnswerBase = rowTotals(rows);
  const checks = [
    providerProofCheck(providerProofGate),
    storageCorpusCheck(storageCorpusGate),
    openAiCheck(aiReviewReadiness),
    evidenceQueueCheck(evidenceQueue),
    valueEdgeCheck(publicAnswerBase),
    promotionContractCheck(),
    responsibleControlsCheck()
  ];
  const selectedGate = checks.find((item) => item.status === "block") ?? checks.find((item) => item.status === "watch") ?? null;
  const status = statusFor(checks, publicAnswerBase);
  const publicAnswer = {
    ...publicAnswerBase,
    mode: publicModeFor(status),
    reason: selectedGate?.nextAction ?? "All MVP authority checks are in monitor-only review."
  };
  const totals = {
    checks: checks.length,
    pass: checks.filter((item) => item.status === "pass").length,
    watch: checks.filter((item) => item.status === "watch").length,
    block: checks.filter((item) => item.status === "block").length
  };

  return {
    mode: "decision-mvp-answer-authority-gate",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    authorityHash: stableHash({
      date,
      sport,
      status,
      rows: [publicAnswer.rows, publicAnswer.valueRows, publicAnswer.actionableRows, publicAnswer.publishableRows],
      progress: [mvpProgressSnapshot.status, mvpProgressSnapshot.percentages.liveProduction],
      provider: [providerProofGate.status, providerProofGate.gateHash],
      storage: [storageCorpusGate.status, storageCorpusGate.gateHash],
      evidence: [evidenceQueue.status, evidenceQueue.queueHash],
      ai: [aiReviewReadiness.status, aiReviewReadiness.readinessHash],
      checks: checks.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status, selectedGate),
    publicAnswer,
    selectedGate,
    checks,
    totals,
    nextAction: {
      label: selectedGate ? `Clear ${selectedGate.label}` : "Keep shadow answer under review",
      detail: selectedGate?.nextAction ?? "Inspect the full answer-promotion gate before any public launch decision.",
      proofUrl: selectedGate?.proofUrl ?? "/api/sports/decision/answer-promotion-gate"
    },
    controls: {
      canInspectReadOnly: true,
      canDisplayMonitor: status === "monitor-only" || status === "ready-shadow-review",
      canRequestOpenAIReview: aiReviewReadiness.controls.canRunLiveReview,
      canPersistDecisions: false,
      canWriteProviderRows: false,
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
    proofUrls: unique([
      "/api/sports/decision/mvp-answer-authority-gate",
      "/api/sports/decision/answer-promotion-gate",
      "/api/sports/decision/final-answer-contract",
      "/api/sports/decision/openai-key-diagnostic",
      ...mvpProgressSnapshot.proofUrls,
      ...providerProofGate.proofUrls,
      ...storageCorpusGate.proofUrls,
      ...evidenceQueue.proofUrls,
      ...aiReviewReadiness.proofUrls,
      ...checks.map((item) => item.proofUrl)
    ]),
    locks: unique([
      "MVP answer authority cannot publish picks, stake, persist decisions, train models, apply learned weights, adjust probabilities, raise confidence, or reveal hidden chain-of-thought.",
      "Positive expected value is necessary but never sufficient for a public recommendation.",
      "Provider dry-run proof must be observed before storage/corpus or answer promotion can matter.",
      "Storage, 10-year corpus, backtests, OpenAI review, and the full answer-promotion gate must all clear before a launch decision can consider public picks.",
      ...providerProofGate.locks,
      ...storageCorpusGate.locks,
      ...evidenceQueue.locks,
      ...aiReviewReadiness.locks
    ])
  };
}
