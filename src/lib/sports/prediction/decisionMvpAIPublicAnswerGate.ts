import type { DecisionMvpAICritiqueLedger } from "@/lib/sports/prediction/decisionMvpAICritiqueLedger";
import type { DecisionMvpAIDecisionTurn } from "@/lib/sports/prediction/decisionMvpAIDecisionTurn";
import type { DecisionMvpAILoopReceipt } from "@/lib/sports/prediction/decisionMvpAILoopReceipt";
import type { DecisionMvpAnswerAuthorityGate } from "@/lib/sports/prediction/decisionMvpAnswerAuthorityGate";

export type DecisionMvpAIPublicAnswerGateStatus = "waiting-review" | "waiting-provider" | "monitor-only" | "ready-shadow-answer" | "blocked";
export type DecisionMvpAIPublicAnswerMode = "locked" | "monitor-only" | "shadow-review" | "avoid-only";

export type DecisionMvpAIPublicAnswerGate = {
  mode: "decision-mvp-ai-public-answer-gate";
  generatedAt: string;
  date: string;
  sport: DecisionMvpAIDecisionTurn["sport"];
  status: DecisionMvpAIPublicAnswerGateStatus;
  gateHash: string;
  summary: string;
  publicAnswer: {
    mode: DecisionMvpAIPublicAnswerMode;
    headline: string;
    explanation: string;
    risks: string[];
    saferAlternatives: string[];
    avoidedClaims: string[];
    displayAllowed: boolean;
    publishAllowed: false;
  };
  checks: Array<{
    id: string;
    label: string;
    status: "pass" | "watch" | "block";
    detail: string;
    nextAction: string;
  }>;
  source: {
    answerAuthorityHash: string;
    critiqueLedgerHash: string;
    decisionTurnHash: string;
    loopReceiptHash: string;
  };
  controls: {
    canInspectReadOnly: true;
    canDisplayPublicSummary: boolean;
    canDisplayMonitorOnly: boolean;
    canPublishPicks: false;
    canStake: false;
    canCallOpenAI: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
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

function statusFor({
  answerAuthorityGate,
  loopReceipt,
  critiqueLedger
}: {
  answerAuthorityGate: DecisionMvpAnswerAuthorityGate;
  loopReceipt: DecisionMvpAILoopReceipt;
  critiqueLedger: DecisionMvpAICritiqueLedger;
}): DecisionMvpAIPublicAnswerGateStatus {
  if (loopReceipt.status === "waiting-review" || critiqueLedger.status === "not-reviewed") return "waiting-review";
  if (loopReceipt.status === "blocked" || critiqueLedger.status === "blocked") return "blocked";
  if (loopReceipt.status === "waiting-provider" || answerAuthorityGate.status === "waiting-provider-proof") return "waiting-provider";
  if (answerAuthorityGate.status === "ready-shadow-review") return "ready-shadow-answer";
  return "monitor-only";
}

function publicModeFor(status: DecisionMvpAIPublicAnswerGateStatus, appliedEffect: DecisionMvpAICritiqueLedger["verdict"]["appliedEffect"]): DecisionMvpAIPublicAnswerMode {
  if (appliedEffect === "avoid") return "avoid-only";
  if (status === "ready-shadow-answer") return "shadow-review";
  if (status === "monitor-only") return "monitor-only";
  return "locked";
}

function summaryFor(status: DecisionMvpAIPublicAnswerGateStatus): string {
  if (status === "ready-shadow-answer") return "MVP AI public-answer gate can show a shadow-review explanation, but publishing and staking remain locked.";
  if (status === "monitor-only") return "MVP AI public-answer gate can show monitor-only guidance without promotion.";
  if (status === "waiting-review") return "MVP AI public-answer gate is waiting for the guarded AI review before showing a stronger answer.";
  if (status === "waiting-provider") return "MVP AI public-answer gate is waiting for provider evidence before showing a stronger answer.";
  return "MVP AI public-answer gate blocks public promotion until AI, evidence, and authority blockers are repaired.";
}

export function buildDecisionMvpAIPublicAnswerGate({
  answerAuthorityGate,
  critiqueLedger,
  decisionTurn,
  loopReceipt,
  now = new Date()
}: {
  answerAuthorityGate: DecisionMvpAnswerAuthorityGate;
  critiqueLedger: DecisionMvpAICritiqueLedger;
  decisionTurn: DecisionMvpAIDecisionTurn;
  loopReceipt: DecisionMvpAILoopReceipt;
  now?: Date;
}): DecisionMvpAIPublicAnswerGate {
  const status = statusFor({ answerAuthorityGate, loopReceipt, critiqueLedger });
  const publicMode = publicModeFor(status, critiqueLedger.verdict.appliedEffect);
  const displayAllowed = publicMode === "monitor-only" || publicMode === "shadow-review" || publicMode === "avoid-only";
  const risks = unique([
    ...loopReceipt.loop.stopReasons,
    critiqueLedger.items.find((item) => item.status === "block")?.evidence,
    answerAuthorityGate.selectedGate?.detail,
    decisionTurn.turn.doubt
  ], 6);
  const saferAlternatives = unique([
    critiqueLedger.verdict.appliedEffect === "avoid" ? "Avoid this pick until provider evidence and critique blockers clear." : null,
    "Monitor only; do not treat this as a betting recommendation.",
    "Wait for fixtures, odds, lineups/injuries, and authority proof before upgrading.",
    "Use the next proof API as evidence, not as a public pick."
  ], 6);
  const avoidedClaims = [
    "Outcomes remain uncertain.",
    "No hidden chain-of-thought.",
    "No unstored provider facts.",
    "No published pick or stake advice.",
    "No raised probability, confidence, or learned weight."
  ];
  const checks = [
    {
      id: "answer-authority",
      label: "Answer authority",
      status: answerAuthorityGate.status === "ready-shadow-review" || answerAuthorityGate.status === "monitor-only" ? ("watch" as const) : ("block" as const),
      detail: answerAuthorityGate.summary,
      nextAction: answerAuthorityGate.nextAction.detail
    },
    {
      id: "ai-loop",
      label: "AI loop",
      status: loopReceipt.status === "ready-next-proof" ? ("watch" as const) : loopReceipt.status === "blocked" ? ("block" as const) : ("watch" as const),
      detail: loopReceipt.summary,
      nextAction: loopReceipt.nextAction.expectedEvidence
    },
    {
      id: "critique-ledger",
      label: "Critique ledger",
      status: critiqueLedger.totals.block > 0 ? ("block" as const) : critiqueLedger.totals.watch > 0 ? ("watch" as const) : ("pass" as const),
      detail: critiqueLedger.summary,
      nextAction: critiqueLedger.nextAction.expectedEvidence
    },
    {
      id: "public-safety",
      label: "Public safety",
      status: "pass" as const,
      detail: "Public output is capped to explanation/monitoring; publish, stake, training, persistence, confidence, probability, and hidden reasoning remain locked.",
      nextAction: "Keep public answer same-or-safer until authority gates clear."
    }
  ];
  const nextBlock = checks.find((check) => check.status === "block") ?? checks.find((check) => check.status === "watch") ?? null;

  return {
    mode: "decision-mvp-ai-public-answer-gate",
    generatedAt: now.toISOString(),
    date: decisionTurn.date,
    sport: decisionTurn.sport,
    status,
    gateHash: stableHash({
      status,
      publicMode,
      authority: [answerAuthorityGate.authorityHash, answerAuthorityGate.status, answerAuthorityGate.publicAnswer.mode],
      critique: [critiqueLedger.ledgerHash, critiqueLedger.status, critiqueLedger.verdict.appliedEffect],
      turn: [decisionTurn.turnHash, decisionTurn.status, decisionTurn.turn.phase],
      loop: [loopReceipt.loopHash, loopReceipt.status, loopReceipt.loop.selectedMove],
      checks: checks.map((check) => [check.id, check.status])
    }),
    summary: summaryFor(status),
    publicAnswer: {
      mode: publicMode,
      headline:
        publicMode === "shadow-review"
          ? "Shadow review only"
          : publicMode === "monitor-only"
            ? "Monitor only"
            : publicMode === "avoid-only"
              ? "Avoid for now"
              : "Locked",
      explanation: compact(`${decisionTurn.turn.decision} ${decisionTurn.turn.belief} ${summaryFor(status)}`, 360),
      risks,
      saferAlternatives,
      avoidedClaims,
      displayAllowed,
      publishAllowed: false
    },
    checks,
    source: {
      answerAuthorityHash: answerAuthorityGate.authorityHash,
      critiqueLedgerHash: critiqueLedger.ledgerHash,
      decisionTurnHash: decisionTurn.turnHash,
      loopReceiptHash: loopReceipt.loopHash
    },
    controls: {
      canInspectReadOnly: true,
      canDisplayPublicSummary: displayAllowed,
      canDisplayMonitorOnly: publicMode === "monitor-only" || publicMode === "shadow-review" || publicMode === "avoid-only",
      canPublishPicks: false,
      canStake: false,
      canCallOpenAI: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    nextAction: {
      label: nextBlock?.label ?? "Keep monitor-only answer",
      command: null,
      verifyUrl: nextBlock?.id === "ai-loop" ? "/api/sports/decision/mvp-ai-loop-receipt" : nextBlock?.id === "answer-authority" ? "/api/sports/decision/mvp-answer-authority-gate" : "/api/sports/decision/mvp-ai-public-answer-gate",
      safeToRun: false,
      expectedEvidence: compact(nextBlock?.nextAction ?? "Keep public output capped to monitor-only explanation.", 280)
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-ai-public-answer-gate",
      "/api/sports/decision/mvp-answer-authority-gate",
      ...loopReceipt.proofUrls,
      ...decisionTurn.proofUrls,
      ...critiqueLedger.proofUrls,
      ...answerAuthorityGate.proofUrls
    ]),
    locks: unique([
      "MVP AI public-answer gate can display only same-or-safer explanation, monitor, or avoid guidance.",
      "It cannot publish picks, stake, call OpenAI, fetch providers, persist decisions, train, apply learned weights, edit probabilities, raise confidence, or expose hidden chain-of-thought.",
      ...loopReceipt.locks,
      ...decisionTurn.locks,
      ...critiqueLedger.locks,
      ...answerAuthorityGate.locks
    ])
  };
}
