import type { DecisionBrainReviewPacket } from "@/lib/sports/prediction/decisionBrainReviewPacket";
import type { DecisionBrainReviewRunner } from "@/lib/sports/prediction/decisionBrainReviewRunner";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";

export type DecisionBrainLiveReviewReceiptStatus =
  | "ready-to-run"
  | "reviewed"
  | "fallback"
  | "not-configured"
  | "quota-or-billing-blocked"
  | "auth-failed"
  | "provider-error"
  | "invalid-response"
  | "blocked";

export type DecisionBrainLiveReviewGateStatus = "pass" | "watch" | "block";

export type DecisionBrainLiveReviewGate = {
  id: "packet-contract" | "live-provider-run" | "same-or-safer" | "side-effect-locks";
  label: string;
  status: DecisionBrainLiveReviewGateStatus;
  detail: string;
  nextAction: string;
  proofUrl: string;
};

export type DecisionBrainLiveReviewReceipt = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-brain-live-review-receipt";
  status: DecisionBrainLiveReviewReceiptStatus;
  receiptHash: string;
  summary: string;
  runRequested: boolean;
  model: string;
  packet: {
    packetHash: string;
    status: DecisionBrainReviewPacket["status"];
    evidenceItems: number;
    submitSafe: boolean;
  };
  latestRun: DecisionBrainReviewRunner["latestRun"];
  review: {
    provider: DecisionBrainReviewRunner["latestRun"]["provider"];
    verdict: DecisionBrainReviewRunner["appliedReview"]["verdict"];
    recommendedAction: DecisionBrainReviewRunner["appliedReview"]["recommendedAction"];
    trustPatch: DecisionBrainReviewRunner["appliedReview"]["trustPatch"];
    summary: string;
    reviewHash: string | null;
    requiredEvidence: string[];
    riskFlags: string[];
    unsupportedClaims: string[];
  };
  gates: DecisionBrainLiveReviewGate[];
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRequestOpenAI: boolean;
    requiresExplicitRunParam: true;
    canApplyAI: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
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

function compact(value: string | null | undefined, maxLength = 300): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No detail available.";
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 28): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function gate(input: DecisionBrainLiveReviewGate): DecisionBrainLiveReviewGate {
  return {
    ...input,
    detail: compact(input.detail, 260),
    nextAction: compact(input.nextAction, 220)
  };
}

function statusFor(runner: DecisionBrainReviewRunner): DecisionBrainLiveReviewReceiptStatus {
  if (runner.status === "ready-to-run") return "ready-to-run";
  return runner.status;
}

function summaryFor(status: DecisionBrainLiveReviewReceiptStatus, runRequested: boolean): string {
  if (status === "reviewed") return "Guarded brain review completed with structured AI output; same-or-safer and no-side-effect controls stayed locked.";
  if (status === "ready-to-run") return "Brain live review is ready for an explicit run=1 request; no provider call has been made by the dashboard.";
  if (status === "fallback") return "Brain live review is using deterministic fallback because the packet is not safe for provider submission yet.";
  if (status === "not-configured") return "Brain live review is wired but waiting for a server-only OPENAI_API_KEY.";
  if (status === "quota-or-billing-blocked") return "Brain live review reached a quota or billing block; deterministic fallback remains applied.";
  if (status === "auth-failed") return "Brain live review failed provider authorization; deterministic fallback remains applied.";
  if (status === "provider-error") return "Brain live review failed before a valid provider response; deterministic fallback remains applied.";
  if (status === "invalid-response") return "Brain live review received an invalid provider response; deterministic fallback remains applied.";
  return runRequested ? "Brain live review request was blocked by evidence or safety debt." : "Brain live review is blocked until evidence and safety gates improve.";
}

function gatesFor(packet: DecisionBrainReviewPacket, runner: DecisionBrainReviewRunner): DecisionBrainLiveReviewGate[] {
  const liveStatus: DecisionBrainLiveReviewGateStatus = runner.latestRun.requested
    ? runner.status === "reviewed"
      ? "pass"
      : runner.status === "fallback"
        ? "watch"
        : "block"
    : runner.controls.canRequestOpenAI
      ? "watch"
      : "block";
  return [
    gate({
      id: "packet-contract",
      label: "Packet contract",
      status: packet.controls.canSubmitToOpenAI ? "pass" : packet.status === "needs-evidence" ? "watch" : "block",
      detail: `${packet.status.replaceAll("-", " ")} with ${packet.evidencePacket.length} evidence item(s).`,
      nextAction: packet.submit.safeToRun ? "Submit only through the guarded run=1 route." : packet.submit.blockedBy[0] ?? packet.summary,
      proofUrl: "/api/sports/decision/brain-review-packet"
    }),
    gate({
      id: "live-provider-run",
      label: "Live provider run",
      status: liveStatus,
      detail: runner.latestRun.requested
        ? `${runner.latestRun.provider} returned ${runner.latestRun.status.replaceAll("-", " ")}${runner.latestRun.reason ? `: ${runner.latestRun.reason}` : "."}`
        : "No live provider request has been made. The dashboard only displays a safe receipt.",
      nextAction: runner.controls.canRequestOpenAI ? "Call this receipt with run=1 when you intentionally want live AI critique." : runner.summary,
      proofUrl: "/api/sports/decision/brain-live-review-receipt"
    }),
    gate({
      id: "same-or-safer",
      label: "Same-or-safer clamp",
      status: runner.appliedReview.publicActionUpgradePermission === "never" ? "pass" : "block",
      detail: `Applied ${runner.appliedReview.verdict.replaceAll("-", " ")} review recommends ${runner.appliedReview.recommendedAction}; trust patch ${runner.appliedReview.trustPatch.replaceAll("-", " ")}.`,
      nextAction: "Keep AI review advisory until deterministic, provider, storage, and final-answer gates separately pass.",
      proofUrl: "/api/sports/decision/brain-review-runner"
    }),
    gate({
      id: "side-effect-locks",
      label: "Side-effect locks",
      status:
        runner.controls.canApplyAI ||
        runner.controls.canPersist ||
        runner.controls.canPublish ||
        runner.controls.canTrain ||
        runner.controls.canStake ||
        runner.controls.canUseHiddenChainOfThought ||
        runner.controls.canUpgradePublicAction
          ? "block"
          : "pass",
      detail: "Apply, persist, publish, train, stake, trust upgrade, and hidden chain-of-thought permissions are all disabled.",
      nextAction: "Keep all model output in audit mode until product launch gates explicitly open.",
      proofUrl: "/api/sports/decision/brain-review-runner"
    })
  ];
}

function nextActionFor(packet: DecisionBrainReviewPacket, runner: DecisionBrainReviewRunner): DecisionBrainLiveReviewReceipt["nextAction"] {
  const verifyUrl = "/api/sports/decision/brain-live-review-receipt?run=1&limit=8";
  if (runner.controls.canRequestOpenAI) {
    return {
      label: "Run guarded brain live review",
      command: decisionCurlCommand(verifyUrl),
      verifyUrl,
      safeToRun: true,
      expectedEvidence: "Returns an AI or deterministic brain review receipt while side effects remain locked."
    };
  }
  return {
    label: "Inspect brain review packet",
    command: decisionCurlCommand("/api/sports/decision/brain-review-packet?limit=8"),
    verifyUrl: "/api/sports/decision/brain-review-packet?limit=8",
    safeToRun: true,
    expectedEvidence: packet.submit.blockedBy[0] ?? packet.summary
  };
}

export function buildDecisionBrainLiveReviewReceipt({
  packet,
  runner,
  now = new Date()
}: {
  packet: DecisionBrainReviewPacket;
  runner: DecisionBrainReviewRunner;
  now?: Date;
}): DecisionBrainLiveReviewReceipt {
  const status = statusFor(runner);
  const gates = gatesFor(packet, runner);
  const receiptHash = stableHash({
    packet: packet.packetHash,
    runner: runner.runnerHash,
    status,
    run: runner.latestRun,
    applied: [runner.appliedReview.verdict, runner.appliedReview.recommendedAction, runner.appliedReview.trustPatch]
  });

  return {
    generatedAt: now.toISOString(),
    date: runner.date,
    sport: runner.sport,
    mode: "decision-brain-live-review-receipt",
    status,
    receiptHash,
    summary: summaryFor(status, runner.runRequested),
    runRequested: runner.runRequested,
    model: runner.model,
    packet: {
      packetHash: packet.packetHash,
      status: packet.status,
      evidenceItems: packet.evidencePacket.length,
      submitSafe: packet.controls.canSubmitToOpenAI
    },
    latestRun: runner.latestRun,
    review: {
      provider: runner.latestRun.provider,
      verdict: runner.appliedReview.verdict,
      recommendedAction: runner.appliedReview.recommendedAction,
      trustPatch: runner.appliedReview.trustPatch,
      summary: compact(runner.appliedReview.summary, 420),
      reviewHash: runner.latestRun.reviewHash,
      requiredEvidence: runner.appliedReview.requiredEvidence,
      riskFlags: runner.appliedReview.riskFlags,
      unsupportedClaims: runner.appliedReview.unsupportedClaims
    },
    gates,
    nextAction: nextActionFor(packet, runner),
    controls: {
      canInspectReadOnly: true,
      canRequestOpenAI: runner.controls.canRequestOpenAI,
      requiresExplicitRunParam: true,
      canApplyAI: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/brain-live-review-receipt",
      "/api/sports/decision/brain-review-runner",
      "/api/sports/decision/brain-review-packet",
      "/api/sports/decision/brain-state",
      ...runner.proofUrls,
      ...packet.proofUrls
    ]),
    locks: unique([
      "Brain live review requires explicit run=1 for a provider call.",
      "The receipt never persists AI output, publishes picks, trains models, stakes, raises trust, or exposes hidden chain-of-thought.",
      "Applied review is clamped to same-or-safer than deterministic fallback.",
      ...runner.locks,
      ...packet.locks
    ])
  };
}
