import type { DecisionMvpAIDecisionTurn } from "@/lib/sports/prediction/decisionMvpAIDecisionTurn";
import type { DecisionMvpAILoopReceipt } from "@/lib/sports/prediction/decisionMvpAILoopReceipt";
import type { DecisionMvpAIPublicAnswerGate } from "@/lib/sports/prediction/decisionMvpAIPublicAnswerGate";

export type DecisionMvpAIAnswerComposerStatus = "locked" | "monitor-only" | "shadow-review" | "avoid-only";

export type DecisionMvpAIAnswerComposer = {
  mode: "decision-mvp-ai-answer-composer";
  generatedAt: string;
  date: string;
  sport: DecisionMvpAIDecisionTurn["sport"];
  status: DecisionMvpAIAnswerComposerStatus;
  answerHash: string;
  summary: string;
  answer: {
    title: string;
    stance: "locked" | "monitor" | "shadow" | "avoid";
    body: string;
    confidenceLanguage: "unavailable" | "low" | "capped";
    reasons: string[];
    risks: string[];
    saferAlternatives: string[];
    changeMyMind: string[];
    promotionLock: string;
    thinkingAudit: {
      uncertaintyDrivers: string[];
      counterEvidence: string[];
      flipConditions: string[];
      promotionBlockers: string[];
      safestNextStep: string;
      publicSafetyRule: string;
    };
    omittedClaims: string[];
    footer: string;
  };
  source: {
    publicAnswerGateHash: string;
    decisionTurnHash: string;
    loopReceiptHash: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRenderInDashboard: boolean;
    canRenderAsPick: false;
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

function compact(value: string | null | undefined, maxLength = 360): string {
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

function statusFor(publicAnswerGate: DecisionMvpAIPublicAnswerGate): DecisionMvpAIAnswerComposerStatus {
  if (publicAnswerGate.publicAnswer.mode === "shadow-review") return "shadow-review";
  if (publicAnswerGate.publicAnswer.mode === "monitor-only") return "monitor-only";
  if (publicAnswerGate.publicAnswer.mode === "avoid-only") return "avoid-only";
  return "locked";
}

function stanceFor(status: DecisionMvpAIAnswerComposerStatus): DecisionMvpAIAnswerComposer["answer"]["stance"] {
  if (status === "shadow-review") return "shadow";
  if (status === "monitor-only") return "monitor";
  if (status === "avoid-only") return "avoid";
  return "locked";
}

function titleFor(status: DecisionMvpAIAnswerComposerStatus): string {
  if (status === "shadow-review") return "Shadow review only";
  if (status === "monitor-only") return "Monitor only";
  if (status === "avoid-only") return "Avoid for now";
  return "Locked until evidence clears";
}

function confidenceFor(status: DecisionMvpAIAnswerComposerStatus): DecisionMvpAIAnswerComposer["answer"]["confidenceLanguage"] {
  if (status === "locked") return "unavailable";
  if (status === "avoid-only") return "low";
  return "capped";
}

function summaryFor(status: DecisionMvpAIAnswerComposerStatus): string {
  if (status === "shadow-review") return "MVP AI answer composer can render a shadow-review explanation, not a pick.";
  if (status === "monitor-only") return "MVP AI answer composer can render monitor-only guidance, not a pick.";
  if (status === "avoid-only") return "MVP AI answer composer can render avoid-only guidance while stronger action stays locked.";
  return "MVP AI answer composer keeps the user-facing answer locked until evidence and critique blockers clear.";
}

function changeMyMindFor({
  publicAnswerGate,
  decisionTurn,
  loopReceipt
}: {
  publicAnswerGate: DecisionMvpAIPublicAnswerGate;
  decisionTurn: DecisionMvpAIDecisionTurn;
  loopReceipt: DecisionMvpAILoopReceipt;
}): string[] {
  return unique(
    [
      decisionTurn.turn.expectedEvidence ? `Run and verify: ${decisionTurn.turn.expectedEvidence}` : null,
      decisionTurn.turn.doubt ? `Resolve the current doubt: ${decisionTurn.turn.doubt}` : null,
      loopReceipt.nextAction.expectedEvidence ? `Loop evidence needed: ${loopReceipt.nextAction.expectedEvidence}` : null,
      publicAnswerGate.nextAction.expectedEvidence ? `Public gate evidence needed: ${publicAnswerGate.nextAction.expectedEvidence}` : null
    ],
    5
  );
}

function promotionLockFor({
  publicAnswerGate,
  decisionTurn,
  loopReceipt
}: {
  publicAnswerGate: DecisionMvpAIPublicAnswerGate;
  decisionTurn: DecisionMvpAIDecisionTurn;
  loopReceipt: DecisionMvpAILoopReceipt;
}): string {
  const blocker =
    publicAnswerGate.checks.find((check) => check.status === "block") ??
    publicAnswerGate.checks.find((check) => check.status === "watch") ??
    null;
  return compact(
    blocker
      ? `${blocker.label}: ${blocker.detail} Next evidence: ${blocker.nextAction}`
      : `${decisionTurn.turn.sameOrSaferReason} Loop status ${loopReceipt.status}; public answer mode ${publicAnswerGate.publicAnswer.mode}.`,
    360
  );
}

function publicThinkingAuditFor(decisionTurn: DecisionMvpAIDecisionTurn): DecisionMvpAIAnswerComposer["answer"]["thinkingAudit"] {
  return {
    uncertaintyDrivers: unique(decisionTurn.thinkingAudit.uncertaintyDrivers, 5),
    counterEvidence: unique(decisionTurn.thinkingAudit.counterEvidence, 5),
    flipConditions: unique(decisionTurn.thinkingAudit.flipConditions, 5),
    promotionBlockers: unique(decisionTurn.thinkingAudit.promotionBlockers, 5),
    safestNextStep: compact(decisionTurn.thinkingAudit.safestNextStep, 300),
    publicSafetyRule: compact(decisionTurn.thinkingAudit.publicSafetyRule, 320)
  };
}

export function buildDecisionMvpAIAnswerComposer({
  publicAnswerGate,
  decisionTurn,
  loopReceipt,
  now = new Date()
}: {
  publicAnswerGate: DecisionMvpAIPublicAnswerGate;
  decisionTurn: DecisionMvpAIDecisionTurn;
  loopReceipt: DecisionMvpAILoopReceipt;
  now?: Date;
}): DecisionMvpAIAnswerComposer {
  const status = statusFor(publicAnswerGate);
  const canRenderInDashboard = publicAnswerGate.controls.canDisplayPublicSummary || status === "locked";
  const reasons = unique(
    [
      publicAnswerGate.publicAnswer.explanation,
      decisionTurn.turn.belief,
      decisionTurn.turn.decision,
      loopReceipt.summary
    ],
    5
  );
  const risks = unique([...publicAnswerGate.publicAnswer.risks, ...loopReceipt.loop.stopReasons, decisionTurn.turn.doubt], 6);
  const saferAlternatives = unique(publicAnswerGate.publicAnswer.saferAlternatives, 6);
  const omittedClaims = unique(publicAnswerGate.publicAnswer.avoidedClaims, 8);
  const changeMyMind = changeMyMindFor({ publicAnswerGate, decisionTurn, loopReceipt });
  const promotionLock = promotionLockFor({ publicAnswerGate, decisionTurn, loopReceipt });
  const thinkingAudit = publicThinkingAuditFor(decisionTurn);

  return {
    mode: "decision-mvp-ai-answer-composer",
    generatedAt: now.toISOString(),
    date: publicAnswerGate.date,
    sport: publicAnswerGate.sport,
    status,
    answerHash: stableHash({
      status,
      publicAnswerGate: [publicAnswerGate.gateHash, publicAnswerGate.status, publicAnswerGate.publicAnswer.mode],
      decisionTurn: [decisionTurn.turnHash, decisionTurn.status, decisionTurn.turn.phase],
      loopReceipt: [loopReceipt.loopHash, loopReceipt.status, loopReceipt.loop.selectedMove],
      reasons,
      risks,
      saferAlternatives,
      changeMyMind,
      promotionLock,
      thinkingAudit
    }),
    summary: summaryFor(status),
    answer: {
      title: titleFor(status),
      stance: stanceFor(status),
      body: compact(
        status === "locked"
          ? `${publicAnswerGate.publicAnswer.explanation} The engine can explain the blocker, but it cannot provide a pick, stake, upgraded probability, or betting instruction.`
          : `${publicAnswerGate.publicAnswer.explanation} Treat this as ${status.replaceAll("-", " ")} analysis only.`,
        420
      ),
      confidenceLanguage: confidenceFor(status),
      reasons,
      risks,
      saferAlternatives,
      changeMyMind,
      promotionLock,
      thinkingAudit,
      omittedClaims,
      footer: "This is an evidence-gated AI decision-engine explanation, not betting advice."
    },
    source: {
      publicAnswerGateHash: publicAnswerGate.gateHash,
      decisionTurnHash: decisionTurn.turnHash,
      loopReceiptHash: loopReceipt.loopHash
    },
    controls: {
      canInspectReadOnly: true,
      canRenderInDashboard,
      canRenderAsPick: false,
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
      label: publicAnswerGate.nextAction.label,
      command: null,
      verifyUrl: publicAnswerGate.nextAction.verifyUrl,
      safeToRun: false,
      expectedEvidence: publicAnswerGate.nextAction.expectedEvidence
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-ai-answer-composer",
      ...publicAnswerGate.proofUrls,
      ...decisionTurn.proofUrls,
      ...loopReceipt.proofUrls
    ]),
    locks: unique([
      "MVP AI answer composer can render explanation text only; it cannot render a pick card.",
      "Composer cannot call OpenAI, fetch providers, write provider rows, persist decisions, train, apply learned weights, adjust probabilities, raise confidence, publish picks, stake, or expose hidden chain-of-thought.",
      ...publicAnswerGate.locks,
      ...decisionTurn.locks,
      ...loopReceipt.locks
    ])
  };
}
