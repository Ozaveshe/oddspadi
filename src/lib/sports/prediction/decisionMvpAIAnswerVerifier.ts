import type { DecisionMvpAIAnswerComposer } from "@/lib/sports/prediction/decisionMvpAIAnswerComposer";
import type { DecisionMvpAIDecisionTurn } from "@/lib/sports/prediction/decisionMvpAIDecisionTurn";
import type { DecisionMvpAILoopReceipt } from "@/lib/sports/prediction/decisionMvpAILoopReceipt";
import type { DecisionMvpAIPublicAnswerGate } from "@/lib/sports/prediction/decisionMvpAIPublicAnswerGate";

export type DecisionMvpAIAnswerVerifierStatus = "verified-locked" | "verified-monitor" | "verified-shadow" | "verified-avoid" | "failed";

export type DecisionMvpAIAnswerVerifier = {
  mode: "decision-mvp-ai-answer-verifier";
  generatedAt: string;
  date: string;
  sport: DecisionMvpAIDecisionTurn["sport"];
  status: DecisionMvpAIAnswerVerifierStatus;
  verifierHash: string;
  summary: string;
  checks: Array<{
    id: string;
    label: string;
    status: "pass" | "watch" | "block";
    detail: string;
    nextAction: string;
  }>;
  source: {
    answerHash: string;
    publicAnswerGateHash: string;
    decisionTurnHash: string;
    loopReceiptHash: string;
  };
  verdict: {
    renderMode: "locked-explanation" | "monitor-only" | "shadow-review" | "avoid-only" | "reject";
    publicCopyAllowed: boolean;
    pickCardAllowed: false;
    publishAllowed: false;
    stakeAllowed: false;
    confidenceUpgradeAllowed: false;
    hiddenReasoningAllowed: false;
  };
  controls: {
    canInspectReadOnly: true;
    canRenderVerifiedAnswer: boolean;
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

function compact(value: string | null | undefined, maxLength = 340): string {
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
  composer,
  failed
}: {
  composer: DecisionMvpAIAnswerComposer;
  failed: boolean;
}): DecisionMvpAIAnswerVerifierStatus {
  if (failed) return "failed";
  if (composer.status === "shadow-review") return "verified-shadow";
  if (composer.status === "monitor-only") return "verified-monitor";
  if (composer.status === "avoid-only") return "verified-avoid";
  return "verified-locked";
}

function renderModeFor(status: DecisionMvpAIAnswerVerifierStatus): DecisionMvpAIAnswerVerifier["verdict"]["renderMode"] {
  if (status === "verified-shadow") return "shadow-review";
  if (status === "verified-monitor") return "monitor-only";
  if (status === "verified-avoid") return "avoid-only";
  if (status === "verified-locked") return "locked-explanation";
  return "reject";
}

function containsUnsafePositiveClaim(text: string): boolean {
  const normalized = text.toLowerCase();
  return [
    /\byou should bet\b/,
    /\bplace (a|the) bet\b/,
    /\bstake\s+\d/,
    /\bguaranteed\b/,
    /\bsure thing\b/,
    /\bwill win\b/,
    /\bpublish this pick\b/,
    /\bhidden chain[- ]of[- ]thought:\b/,
    /\b(can|will|should)\s+raise confidence\b/,
    /\b(can|will|should)\s+upgrade probability\b/
  ].some((pattern) => pattern.test(normalized));
}

function answerText(composer: DecisionMvpAIAnswerComposer): string {
  return [
    composer.answer.title,
    composer.answer.stance,
    composer.answer.body,
    composer.answer.confidenceLanguage,
    ...composer.answer.reasons,
    ...composer.answer.risks,
    ...composer.answer.saferAlternatives,
    ...composer.answer.changeMyMind,
    composer.answer.promotionLock,
    ...composer.answer.thinkingAudit.uncertaintyDrivers,
    ...composer.answer.thinkingAudit.counterEvidence,
    ...composer.answer.thinkingAudit.flipConditions,
    ...composer.answer.thinkingAudit.promotionBlockers,
    composer.answer.thinkingAudit.safestNextStep,
    composer.answer.thinkingAudit.publicSafetyRule,
    composer.answer.footer
  ].join(" ");
}

function summaryFor(status: DecisionMvpAIAnswerVerifierStatus): string {
  if (status === "verified-shadow") return "MVP AI answer verifier cleared a shadow-review explanation while pick, publish, stake, and confidence upgrades stay locked.";
  if (status === "verified-monitor") return "MVP AI answer verifier cleared monitor-only copy while stronger action remains locked.";
  if (status === "verified-avoid") return "MVP AI answer verifier cleared avoid-only copy while stronger action remains locked.";
  if (status === "verified-locked") return "MVP AI answer verifier cleared a locked explanation only; no pick card can render.";
  return "MVP AI answer verifier rejected the composed answer because one or more safety checks failed.";
}

export function buildDecisionMvpAIAnswerVerifier({
  answerComposer,
  publicAnswerGate,
  decisionTurn,
  loopReceipt,
  now = new Date()
}: {
  answerComposer: DecisionMvpAIAnswerComposer;
  publicAnswerGate: DecisionMvpAIPublicAnswerGate;
  decisionTurn: DecisionMvpAIDecisionTurn;
  loopReceipt: DecisionMvpAILoopReceipt;
  now?: Date;
}): DecisionMvpAIAnswerVerifier {
  const sourceMatches =
    answerComposer.source.publicAnswerGateHash === publicAnswerGate.gateHash &&
    answerComposer.source.decisionTurnHash === decisionTurn.turnHash &&
    answerComposer.source.loopReceiptHash === loopReceipt.loopHash;
  const hasGrounding =
    answerComposer.answer.reasons.length > 0 &&
    answerComposer.answer.risks.length > 0 &&
    answerComposer.answer.saferAlternatives.length > 0 &&
    sourceMatches;
  const unsafeClaimFound = containsUnsafePositiveClaim(answerText(answerComposer));
  const actionLocksHold =
    !answerComposer.controls.canRenderAsPick &&
    !answerComposer.controls.canPublishPicks &&
    !answerComposer.controls.canStake &&
    !answerComposer.controls.canAdjustProbabilities &&
    !answerComposer.controls.canRaiseConfidence &&
    !answerComposer.controls.canUseHiddenChainOfThought;
  const omittedClaimsHold = ["No hidden chain-of-thought.", "No published pick or stake advice."].every((claim) => answerComposer.answer.omittedClaims.includes(claim));
  const publicGateCompatible =
    answerComposer.status === "locked" ? publicAnswerGate.publicAnswer.mode === "locked" : answerComposer.status === publicAnswerGate.publicAnswer.mode;
  const falsifiableReasoningPresent = answerComposer.answer.changeMyMind.length > 0 && Boolean(answerComposer.answer.promotionLock.trim());
  const thinkingAuditPresent =
    answerComposer.answer.thinkingAudit.uncertaintyDrivers.length > 0 &&
    answerComposer.answer.thinkingAudit.counterEvidence.length > 0 &&
    answerComposer.answer.thinkingAudit.flipConditions.length > 0 &&
    answerComposer.answer.thinkingAudit.promotionBlockers.length > 0 &&
    Boolean(answerComposer.answer.thinkingAudit.safestNextStep.trim()) &&
    answerComposer.answer.thinkingAudit.publicSafetyRule.toLowerCase().includes("hidden chain-of-thought");

  const checks = [
    {
      id: "source-integrity",
      label: "Source integrity",
      status: sourceMatches ? ("pass" as const) : ("block" as const),
      detail: sourceMatches
        ? "Composer source hashes match the public gate, decision turn, and loop receipt."
        : "Composer source hashes do not match the current public gate, decision turn, or loop receipt.",
      nextAction: sourceMatches ? "Keep the answer tied to these source hashes." : "Rebuild the composer from the current AI turn before rendering."
    },
    {
      id: "grounding",
      label: "Grounding",
      status: hasGrounding ? ("pass" as const) : ("block" as const),
      detail: hasGrounding
        ? "Answer has reasons, risks, safer alternatives, and matching source evidence."
        : "Answer is missing reasons, risks, safer alternatives, or matching source evidence.",
      nextAction: hasGrounding ? "Keep reasons, risks, and safer alternatives visible." : "Hold rendering until grounded explanation fields are present."
    },
    {
      id: "forbidden-claims",
      label: "Forbidden claims",
      status: unsafeClaimFound ? ("block" as const) : ("pass" as const),
      detail: unsafeClaimFound
        ? "Answer text contains a positive betting, guarantee, confidence-upgrade, or hidden-reasoning claim."
        : "Answer text does not contain positive betting, guarantee, confidence-upgrade, or hidden-reasoning claims.",
      nextAction: unsafeClaimFound ? "Reject the answer and recompose same-or-safer copy." : "Keep the answer capped to explanation language."
    },
    {
      id: "action-locks",
      label: "Action locks",
      status: actionLocksHold ? ("pass" as const) : ("block" as const),
      detail: actionLocksHold
        ? "Composer controls keep pick cards, publish, stake, probability edits, confidence raises, and hidden reasoning locked."
        : "One or more unsafe composer controls are open.",
      nextAction: actionLocksHold ? "Keep unsafe actions locked downstream." : "Reject the answer until all unsafe controls are false."
    },
    {
      id: "public-gate-compatibility",
      label: "Public gate compatibility",
      status: publicGateCompatible && omittedClaimsHold ? ("pass" as const) : ("block" as const),
      detail: publicGateCompatible && omittedClaimsHold
        ? "Composer status matches the public-answer gate and required omitted claims are present."
        : "Composer status or required omitted claims do not match the public-answer gate.",
      nextAction: publicGateCompatible && omittedClaimsHold ? "Render only through the verified answer path." : "Rebuild public gate and composer before display."
    },
    {
      id: "falsifiable-reasoning",
      label: "Falsifiable reasoning",
      status: falsifiableReasoningPresent ? ("pass" as const) : ("block" as const),
      detail: falsifiableReasoningPresent
        ? "Answer includes change-my-mind evidence and the active promotion-lock reason."
        : "Answer is missing change-my-mind evidence or the active promotion-lock reason.",
      nextAction: falsifiableReasoningPresent ? "Keep change-my-mind evidence visible with the verified answer." : "Recompose the answer with falsifiable evidence before display."
    },
    {
      id: "thinking-audit",
      label: "Thinking audit",
      status: thinkingAuditPresent ? ("pass" as const) : ("block" as const),
      detail: thinkingAuditPresent
        ? "Answer carries uncertainty drivers, counter-evidence, flip conditions, promotion blockers, safest next step, and public-safety rule."
        : "Answer is missing one or more public-safe thinking audit fields.",
      nextAction: thinkingAuditPresent ? "Keep the public-safe thinking audit attached to the verified answer." : "Rebuild the answer from a decision turn with complete thinking audit fields."
    }
  ];
  const failed = checks.some((check) => check.status === "block");
  const status = statusFor({ composer: answerComposer, failed });
  const renderMode = renderModeFor(status);
  const nextBlock = checks.find((check) => check.status === "block") ?? null;

  return {
    mode: "decision-mvp-ai-answer-verifier",
    generatedAt: now.toISOString(),
    date: answerComposer.date,
    sport: answerComposer.sport,
    status,
    verifierHash: stableHash({
      status,
      answerHash: answerComposer.answerHash,
      source: answerComposer.source,
      checks: checks.map((check) => [check.id, check.status]),
      renderMode
    }),
    summary: summaryFor(status),
    checks,
    source: {
      answerHash: answerComposer.answerHash,
      publicAnswerGateHash: publicAnswerGate.gateHash,
      decisionTurnHash: decisionTurn.turnHash,
      loopReceiptHash: loopReceipt.loopHash
    },
    verdict: {
      renderMode,
      publicCopyAllowed: renderMode !== "reject",
      pickCardAllowed: false,
      publishAllowed: false,
      stakeAllowed: false,
      confidenceUpgradeAllowed: false,
      hiddenReasoningAllowed: false
    },
    controls: {
      canInspectReadOnly: true,
      canRenderVerifiedAnswer: renderMode !== "reject",
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
      label: nextBlock?.label ?? "Render verified locked explanation",
      command: null,
      verifyUrl: nextBlock ? "/api/sports/decision/mvp-ai-answer-verifier" : answerComposer.nextAction.verifyUrl,
      safeToRun: false,
      expectedEvidence: compact(nextBlock?.nextAction ?? "Verified answer remains same-or-safer and read-only.", 280)
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-ai-answer-verifier",
      ...answerComposer.proofUrls,
      ...publicAnswerGate.proofUrls,
      ...decisionTurn.proofUrls,
      ...loopReceipt.proofUrls
    ]),
    locks: unique([
      "MVP AI answer verifier audits composed copy before rendering.",
      "Verifier cannot render a pick card, publish, stake, call OpenAI, fetch providers, write provider rows, persist decisions, train, apply learned weights, adjust probabilities, raise confidence, or expose hidden chain-of-thought.",
      ...answerComposer.locks,
      ...publicAnswerGate.locks,
      ...decisionTurn.locks,
      ...loopReceipt.locks
    ])
  };
}
