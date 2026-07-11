import type { DecisionMvpAIAnswerComposer } from "@/lib/sports/prediction/decisionMvpAIAnswerComposer";
import type { DecisionMvpAIAnswerVerifier } from "@/lib/sports/prediction/decisionMvpAIAnswerVerifier";

export type DecisionMvpAIAnswerReleasePacketStatus = "released-locked" | "released-monitor" | "released-shadow" | "released-avoid" | "withheld";

export type DecisionMvpAIAnswerReleasePacket = {
  mode: "decision-mvp-ai-answer-release-packet";
  generatedAt: string;
  date: string;
  sport: DecisionMvpAIAnswerComposer["sport"];
  status: DecisionMvpAIAnswerReleasePacketStatus;
  releaseHash: string;
  summary: string;
  publicAnswer: {
    renderMode: DecisionMvpAIAnswerVerifier["verdict"]["renderMode"];
    title: string;
    stance: DecisionMvpAIAnswerComposer["answer"]["stance"];
    body: string;
    confidenceLanguage: DecisionMvpAIAnswerComposer["answer"]["confidenceLanguage"];
    reasons: string[];
    risks: string[];
    saferAlternatives: string[];
    changeMyMind: string[];
    promotionLock: string;
    thinkingAudit: DecisionMvpAIAnswerComposer["answer"]["thinkingAudit"];
    footer: string;
    badges: string[];
  };
  provenance: {
    answerHash: string;
    verifierHash: string;
    publicAnswerGateHash: string;
    decisionTurnHash: string;
    loopReceiptHash: string;
  };
  releaseChecks: Array<{
    id: string;
    label: string;
    status: "pass" | "watch" | "block";
    detail: string;
  }>;
  controls: {
    canInspectReadOnly: true;
    canRenderPublicAnswer: boolean;
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

function compact(value: string | null | undefined, maxLength = 460): string {
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

function statusFor(verifier: DecisionMvpAIAnswerVerifier): DecisionMvpAIAnswerReleasePacketStatus {
  if (verifier.status === "verified-shadow") return "released-shadow";
  if (verifier.status === "verified-monitor") return "released-monitor";
  if (verifier.status === "verified-avoid") return "released-avoid";
  if (verifier.status === "verified-locked") return "released-locked";
  return "withheld";
}

function summaryFor(status: DecisionMvpAIAnswerReleasePacketStatus): string {
  if (status === "released-shadow") return "MVP AI answer release packet exposes verified shadow-review copy while actions stay locked.";
  if (status === "released-monitor") return "MVP AI answer release packet exposes verified monitor-only copy while actions stay locked.";
  if (status === "released-avoid") return "MVP AI answer release packet exposes verified avoid-only copy while actions stay locked.";
  if (status === "released-locked") return "MVP AI answer release packet exposes only a verified locked explanation; no pick can render.";
  return "MVP AI answer release packet withholds public copy because verification failed.";
}

export function buildDecisionMvpAIAnswerReleasePacket({
  answerComposer,
  answerVerifier,
  now = new Date()
}: {
  answerComposer: DecisionMvpAIAnswerComposer;
  answerVerifier: DecisionMvpAIAnswerVerifier;
  now?: Date;
}): DecisionMvpAIAnswerReleasePacket {
  const status = statusFor(answerVerifier);
  const canRenderPublicAnswer = answerVerifier.controls.canRenderVerifiedAnswer && answerVerifier.verdict.publicCopyAllowed && status !== "withheld";
  const sourceMatches = answerVerifier.source.answerHash === answerComposer.answerHash;
  const releaseChecks = [
    {
      id: "verified-answer",
      label: "Verified answer",
      status: canRenderPublicAnswer ? ("pass" as const) : ("block" as const),
      detail: canRenderPublicAnswer ? "Verifier allows read-only public copy." : "Verifier withheld the answer."
    },
    {
      id: "source-match",
      label: "Source match",
      status: sourceMatches ? ("pass" as const) : ("block" as const),
      detail: sourceMatches ? "Release packet uses the same answer hash that verifier audited." : "Release packet answer hash does not match the verifier source."
    },
    {
      id: "no-action-release",
      label: "No action release",
      status:
        !answerVerifier.verdict.pickCardAllowed &&
        !answerVerifier.verdict.publishAllowed &&
        !answerVerifier.verdict.stakeAllowed &&
        !answerVerifier.verdict.confidenceUpgradeAllowed &&
        !answerVerifier.verdict.hiddenReasoningAllowed
          ? ("pass" as const)
          : ("block" as const),
      detail: "Pick cards, publishing, staking, confidence upgrades, and hidden reasoning are not part of this release."
    }
  ];
  const failed = releaseChecks.some((check) => check.status === "block");
  const finalStatus = failed ? "withheld" : status;

  return {
    mode: "decision-mvp-ai-answer-release-packet",
    generatedAt: now.toISOString(),
    date: answerComposer.date,
    sport: answerComposer.sport,
    status: finalStatus,
    releaseHash: stableHash({
      status: finalStatus,
      answerHash: answerComposer.answerHash,
      verifierHash: answerVerifier.verifierHash,
      checks: releaseChecks.map((check) => [check.id, check.status]),
      renderMode: answerVerifier.verdict.renderMode
    }),
    summary: summaryFor(finalStatus),
    publicAnswer: {
      renderMode: finalStatus === "withheld" ? "reject" : answerVerifier.verdict.renderMode,
      title: finalStatus === "withheld" ? "Answer withheld" : answerComposer.answer.title,
      stance: finalStatus === "withheld" ? "locked" : answerComposer.answer.stance,
      body: compact(
        finalStatus === "withheld"
          ? "The AI answer failed verification and cannot be displayed."
          : answerComposer.answer.body,
        520
      ),
      confidenceLanguage: finalStatus === "withheld" ? "unavailable" : answerComposer.answer.confidenceLanguage,
      reasons: finalStatus === "withheld" ? [] : answerComposer.answer.reasons,
      risks: finalStatus === "withheld" ? ["Verification failed."] : answerComposer.answer.risks,
      saferAlternatives: finalStatus === "withheld" ? ["Wait for a verified same-or-safer explanation."] : answerComposer.answer.saferAlternatives,
      changeMyMind: finalStatus === "withheld" ? ["Repair answer verification before changing public posture."] : answerComposer.answer.changeMyMind,
      promotionLock: finalStatus === "withheld" ? "Answer verification failed, so public promotion stays locked." : answerComposer.answer.promotionLock,
      thinkingAudit:
        finalStatus === "withheld"
          ? {
              uncertaintyDrivers: ["Answer verification failed."],
              counterEvidence: ["Verifier rejected the answer."],
              flipConditions: ["Repair answer verification before changing public posture."],
              promotionBlockers: ["Answer verification failed."],
              safestNextStep: "Repair answer verification.",
              publicSafetyRule: "No hidden chain-of-thought, pick, stake, or confidence upgrade can be released."
            }
          : answerComposer.answer.thinkingAudit,
      footer: finalStatus === "withheld" ? "No public answer released." : answerComposer.answer.footer,
      badges: unique([
        finalStatus.replaceAll("-", " "),
        answerVerifier.verdict.renderMode.replaceAll("-", " "),
        answerComposer.answer.confidenceLanguage,
        "not betting advice"
      ], 6)
    },
    provenance: {
      answerHash: answerComposer.answerHash,
      verifierHash: answerVerifier.verifierHash,
      publicAnswerGateHash: answerComposer.source.publicAnswerGateHash,
      decisionTurnHash: answerComposer.source.decisionTurnHash,
      loopReceiptHash: answerComposer.source.loopReceiptHash
    },
    releaseChecks,
    controls: {
      canInspectReadOnly: true,
      canRenderPublicAnswer: finalStatus !== "withheld",
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
      label: failed ? "Repair answer verification" : "Keep verified answer read-only",
      command: null,
      verifyUrl: failed ? "/api/sports/decision/mvp-ai-answer-verifier" : "/api/sports/decision/mvp-ai-answer-release-packet",
      safeToRun: false,
      expectedEvidence: failed ? "Verifier and release checks must all pass before copy can render." : "Release packet remains read-only and action-locked."
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-ai-answer-release-packet",
      ...answerVerifier.proofUrls,
      ...answerComposer.proofUrls
    ]),
    locks: unique([
      "MVP AI answer release packet is the only verified public-copy envelope for this MVP chain.",
      "Release packet cannot render a pick card, publish, stake, call OpenAI, fetch providers, write provider rows, persist decisions, train, apply learned weights, adjust probabilities, raise confidence, or expose hidden chain-of-thought.",
      ...answerVerifier.locks,
      ...answerComposer.locks
    ])
  };
}
