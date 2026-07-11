import type { DecisionAICitationValidator } from "@/lib/sports/prediction/decisionAICitationValidator";
import type { DecisionAIFirewall } from "@/lib/sports/prediction/decisionAIFirewall";
import type { DecisionAIHandoffPacket } from "@/lib/sports/prediction/decisionAIHandoff";
import type { DecisionAIReviewLedger } from "@/lib/sports/prediction/decisionAIReviewLedger";
import type { DecisionAuthority } from "@/lib/sports/prediction/decisionAuthority";
import type { DecisionMetacognition } from "@/lib/sports/prediction/decisionMetacognition";
import type { DecisionProofRunner } from "@/lib/sports/prediction/decisionProofRunner";
import type { Sport } from "@/lib/sports/types";

export type DecisionAgentKernelStatus = "ready" | "supervised" | "blocked";
export type DecisionAgentKernelMode = "safe-hold" | "deterministic-supervised" | "openai-review-ready" | "ai-reviewed-authority";
export type DecisionAgentKernelPhaseId = "observe" | "reason" | "challenge" | "cite" | "firewall" | "authorize" | "act" | "learn";
export type DecisionAgentKernelPhaseStatus = "pass" | "watch" | "block";

export type DecisionAgentKernelPhase = {
  id: DecisionAgentKernelPhaseId;
  label: string;
  status: DecisionAgentKernelPhaseStatus;
  thought: string;
  evidence: string[];
  nextAction: string;
};

export type DecisionAgentKernel = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionAgentKernelStatus;
  mode: DecisionAgentKernelMode;
  turnId: string;
  kernelHash: string;
  summary: string;
  activeDecision: DecisionAuthority["activeDecision"];
  phases: DecisionAgentKernelPhase[];
  counts: {
    pass: number;
    watch: number;
    block: number;
  };
  permissions: {
    canAskOpenAI: boolean;
    canTrustAI: boolean;
    canApplyAI: boolean;
    canDisplayCandidate: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
  };
  nextOperation: {
    label: string;
    command: string | null;
    verifyUrl: string | null;
    blockedBy: string[];
  };
  guardrails: string[];
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

function unique(values: string[], limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, limit);
}

function phase(input: DecisionAgentKernelPhase): DecisionAgentKernelPhase {
  return {
    ...input,
    evidence: unique(input.evidence, 5)
  };
}

function phaseStatusFromBlockedWatch({
  block,
  watch
}: {
  block: boolean;
  watch: boolean;
}): DecisionAgentKernelPhaseStatus {
  if (block) return "block";
  if (watch) return "watch";
  return "pass";
}

function modeFor({
  authority,
  citations,
  handoff,
  firewall
}: {
  authority: DecisionAuthority;
  citations: DecisionAICitationValidator;
  handoff: DecisionAIHandoffPacket;
  firewall: DecisionAIFirewall;
}): DecisionAgentKernelMode {
  if (authority.status === "blocked") return "safe-hold";
  if (authority.activeDecision.source === "ai-reviewed" && firewall.status === "accepted" && citations.status === "valid") return "ai-reviewed-authority";
  if (handoff.status === "ready" && citations.status === "pending-review") return "openai-review-ready";
  return "deterministic-supervised";
}

function statusFor(phases: DecisionAgentKernelPhase[]): DecisionAgentKernelStatus {
  if (phases.some((item) => item.status === "block")) return "blocked";
  if (phases.some((item) => item.status === "watch")) return "supervised";
  return "ready";
}

function buildPhases({
  metacognition,
  handoff,
  citations,
  firewall,
  authority,
  proofRunner,
  aiReviewLedger
}: {
  metacognition: DecisionMetacognition;
  handoff: DecisionAIHandoffPacket;
  citations: DecisionAICitationValidator;
  firewall: DecisionAIFirewall;
  authority: DecisionAuthority;
  proofRunner: DecisionProofRunner;
  aiReviewLedger: DecisionAIReviewLedger;
}): DecisionAgentKernelPhase[] {
  return [
    phase({
      id: "observe",
      label: "Observe",
      status: phaseStatusFromBlockedWatch({ block: metacognition.counts.block > 0, watch: metacognition.counts.watch > 0 }),
      thought: metacognition.summary,
      evidence: [metacognition.metacognitionHash, `mode:${metacognition.mode}`, `active:${metacognition.activeBelief?.match ?? "none"}`],
      nextAction: metacognition.primaryDoubt
    }),
    phase({
      id: "reason",
      label: "Reason",
      status: authority.activeDecision.authorizedAction === "avoid" ? "block" : authority.status === "supervised" ? "watch" : "pass",
      thought: authority.activeDecision.reason,
      evidence: [authority.authorityHash, `source:${authority.activeDecision.source}`, `action:${authority.activeDecision.authorizedAction}`],
      nextAction: authority.chain.find((item) => item.status === "block")?.nextAction ?? authority.chain.find((item) => item.status === "watch")?.nextAction ?? "Keep the current authority state."
    }),
    phase({
      id: "challenge",
      label: "Challenge",
      status: handoff.status === "blocked" ? "block" : handoff.status === "needs-config" ? "watch" : "pass",
      thought: handoff.summary,
      evidence: [handoff.packetHash, handoff.inputHash, `evidence:${handoff.evidence.included}`],
      nextAction: handoff.runbook.blockedBy[0] ?? handoff.runbook.missingEnv[0] ?? "Submit only through the guarded OpenAI review path."
    }),
    phase({
      id: "cite",
      label: "Cite",
      status: citations.status === "valid" ? "pass" : citations.status === "pending-review" ? "watch" : "block",
      thought: citations.summary,
      evidence: [citations.validatorHash, `evidence:${citations.evidence.uniqueIds}`, `sources:${citations.evidence.sourceCount}`],
      nextAction: citations.rules.find((item) => item.status === "block")?.nextAction ?? citations.rules.find((item) => item.status === "watch")?.nextAction ?? "Keep cited evidence IDs with the review."
    }),
    phase({
      id: "firewall",
      label: "Firewall",
      status: firewall.status === "accepted" ? "pass" : firewall.status === "pending-review" ? "watch" : "block",
      thought: firewall.summary,
      evidence: [firewall.firewallHash, `reviews:${firewall.counts.reviews}`, `accepted:${firewall.counts.acceptedReviews}`],
      nextAction: firewall.rules.find((item) => item.status === "block")?.requiredAction ?? firewall.rules.find((item) => item.status === "watch")?.requiredAction ?? "Keep accepted AI review behind authority."
    }),
    phase({
      id: "authorize",
      label: "Authorize",
      status: authority.status === "authorized" ? "pass" : authority.status === "supervised" ? "watch" : "block",
      thought: authority.summary,
      evidence: [authority.authorityHash, `posture:${authority.activeDecision.publicPosture}`, `display:${authority.control.canDisplayCandidate}`],
      nextAction: authority.chain.find((item) => item.status === "block")?.nextAction ?? authority.chain.find((item) => item.status === "watch")?.nextAction ?? "Authority can keep the current posture."
    }),
    phase({
      id: "act",
      label: "Act",
      status: proofRunner.status === "blocked" || aiReviewLedger.status === "blocked" ? "block" : proofRunner.status === "partial" || aiReviewLedger.status === "needs-config" ? "watch" : "pass",
      thought: `${proofRunner.summary} ${aiReviewLedger.summary}`,
      evidence: [`proof:${proofRunner.status}`, `ledger:${aiReviewLedger.status}`, aiReviewLedger.ledgerHash],
      nextAction: proofRunner.nextReceipt?.expectedEvidence ?? aiReviewLedger.runbook.requiredBeforeReview[0] ?? "Keep proof receipts attached before action."
    }),
    phase({
      id: "learn",
      label: "Learn",
      status: authority.control.canTrainFromResult ? "pass" : "watch",
      thought: "Outcome learning remains disabled until provider provenance, settlement, persistence, and activation proof pass.",
      evidence: [`persist:${authority.control.canPersist}`, `publish:${authority.control.canPublish}`, `train:${authority.control.canTrainFromResult}`],
      nextAction: "Enable training only after Supabase project isolation, provider data, and outcome settlement are verified."
    })
  ];
}

export function buildDecisionAgentKernel({
  date,
  sport,
  metacognition,
  handoff,
  citations,
  firewall,
  authority,
  proofRunner,
  aiReviewLedger
}: {
  date: string;
  sport: Sport;
  metacognition: DecisionMetacognition;
  handoff: DecisionAIHandoffPacket;
  citations: DecisionAICitationValidator;
  firewall: DecisionAIFirewall;
  authority: DecisionAuthority;
  proofRunner: DecisionProofRunner;
  aiReviewLedger: DecisionAIReviewLedger;
}): DecisionAgentKernel {
  const phases = buildPhases({ metacognition, handoff, citations, firewall, authority, proofRunner, aiReviewLedger });
  const status = statusFor(phases);
  const mode = modeFor({ authority, citations, handoff, firewall });
  const pass = phases.filter((item) => item.status === "pass").length;
  const watch = phases.filter((item) => item.status === "watch").length;
  const block = phases.filter((item) => item.status === "block").length;
  const permissions: DecisionAgentKernel["permissions"] = {
    canAskOpenAI: handoff.runbook.canSubmitToOpenAI && citations.control.canSubmitToOpenAI,
    canTrustAI: citations.control.canTrustAIOutput && firewall.control.canApplyToDecision,
    canApplyAI: authority.control.canApplyAI,
    canDisplayCandidate: authority.control.canDisplayCandidate,
    canPersist: false,
    canPublish: false,
    canTrain: false
  };
  const blockedBy = unique([
    ...phases.filter((item) => item.status === "block").map((item) => `${item.label}: ${item.nextAction}`),
    ...handoff.runbook.blockedBy,
    ...handoff.runbook.missingEnv
  ]);
  const command = authority.control.nextSafeCommand ?? citations.control.nextSafeCommand ?? firewall.control.nextSafeCommand ?? handoff.runbook.command;
  const verifyUrl = authority.control.verifyUrl ?? citations.control.verifyUrl ?? firewall.control.verifyUrl ?? handoff.runbook.verifyUrl;
  const kernelHash = stableHash({
    date,
    sport,
    status,
    mode,
    activeDecision: authority.activeDecision,
    phases: phases.map((item) => ({ id: item.id, status: item.status })),
    permissions,
    metacognition: metacognition.metacognitionHash,
    handoff: handoff.packetHash,
    citations: citations.validatorHash,
    firewall: firewall.firewallHash,
    authority: authority.authorityHash
  });
  const turnId = stableHash({ date, sport, kernelHash, active: authority.activeDecision.matchId }).replace("fnv1a-", "kernel-");

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    mode,
    turnId,
    kernelHash,
    summary:
      status === "ready"
        ? `Agent kernel is ready in ${mode} mode for ${authority.activeDecision.match ?? "the active decision"}.`
        : status === "supervised"
          ? `Agent kernel needs supervised handling in ${mode} mode; ${watch} phase(s) are watching.`
          : `Agent kernel is blocked in ${mode} mode; ${block} phase(s) require proof before action.`,
    activeDecision: authority.activeDecision,
    phases,
    counts: {
      pass,
      watch,
      block
    },
    permissions,
    nextOperation: {
      label: status === "blocked" ? "Clear blocking proof before action" : permissions.canAskOpenAI ? "Run guarded OpenAI review" : "Continue supervised deterministic review",
      command,
      verifyUrl,
      blockedBy
    },
    guardrails: unique([
      "Never publish while kernel status is blocked or supervised.",
      "Never persist or train from AI output until Supabase project isolation and activation proof pass.",
      "Never trust AI output without supplied evidence citations and firewall acceptance.",
      "Never let AI upgrade a deterministic or belief-revised action.",
      ...authority.control.forbiddenActions,
      ...citations.control.forbiddenActions
    ])
  };
}
