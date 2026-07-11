import type { DecisionAIReviewLedger } from "@/lib/sports/prediction/decisionAIReviewLedger";
import type { DecisionAutopilot } from "@/lib/sports/prediction/decisionAutopilot";
import type { DecisionBeliefRevision } from "@/lib/sports/prediction/decisionBeliefRevision";
import type { DecisionBrainSlate } from "@/lib/sports/prediction/decisionBrain";
import type { DecisionCounterfactualLab } from "@/lib/sports/prediction/decisionCounterfactualLab";
import type { DecisionOperatingCycle } from "@/lib/sports/prediction/decisionOperatingCycle";
import type { DecisionProofRunner } from "@/lib/sports/prediction/decisionProofRunner";
import type { DecisionAction, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionMetacognitionStatus = "clear" | "watching" | "blocked";
export type DecisionMetacognitionMode = "offline-deterministic" | "supervised-review" | "proof-blocked" | "live-review-ready";
export type DecisionMetacognitionStageId = "observe" | "believe" | "doubt" | "test" | "revise" | "decide" | "verify" | "learn";
export type DecisionMetacognitionStageStatus = "pass" | "watch" | "block";

export type DecisionMetacognitionStage = {
  id: DecisionMetacognitionStageId;
  status: DecisionMetacognitionStageStatus;
  label: string;
  thought: string;
  evidence: string[];
  nextQuestion: string;
};

export type DecisionMetacognition = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMetacognitionStatus;
  mode: DecisionMetacognitionMode;
  metacognitionHash: string;
  summary: string;
  activeBelief: {
    matchId: string;
    match: string;
    baselineAction: DecisionAction;
    revisedAction: DecisionAction;
    status: DecisionBeliefRevision["status"];
    revisionScore: number;
    beliefGradeBefore: string;
    beliefGradeAfter: string;
    reason: string;
    requiredEvidence: string[];
    command: string;
    verifyUrl: string;
  } | null;
  primaryDoubt: string;
  changeMyMind: string[];
  stages: DecisionMetacognitionStage[];
  counts: {
    rows: number;
    stages: number;
    pass: number;
    watch: number;
    block: number;
    beliefs: number;
    counterfactualBreaks: number;
    proofBlocked: number;
    ledgerBlocked: number;
  };
  runbook: {
    nextSafeCommand: string | null;
    verifyUrl: string | null;
    canAskOpenAI: boolean;
    canPromote: false;
    canPersist: false;
    canPublish: false;
    forbiddenActions: string[];
  };
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

function unique(values: string[], limit = 8): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, limit);
}

function commandIsSafe(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  if (lower.includes("persist=1") || lower.includes("persist=true")) return false;
  if (lower.includes("dryrun=0") || lower.includes("dryrun=false")) return false;
  if (!lower.includes("-x post") && !lower.includes("-xpost")) return true;
  return lower.includes("dryrun=1");
}

function statusRank(status: DecisionMetacognitionStageStatus): number {
  if (status === "block") return 3;
  if (status === "watch") return 2;
  return 1;
}

function overallStatus(stages: DecisionMetacognitionStage[]): DecisionMetacognitionStatus {
  if (stages.some((stage) => stage.status === "block")) return "blocked";
  if (stages.some((stage) => stage.status === "watch")) return "watching";
  return "clear";
}

function stageCounts(stages: DecisionMetacognitionStage[]): Pick<DecisionMetacognition["counts"], "pass" | "watch" | "block" | "stages"> {
  return {
    stages: stages.length,
    pass: stages.filter((stage) => stage.status === "pass").length,
    watch: stages.filter((stage) => stage.status === "watch").length,
    block: stages.filter((stage) => stage.status === "block").length
  };
}

function stage({
  id,
  label,
  status,
  thought,
  evidence,
  nextQuestion
}: DecisionMetacognitionStage): DecisionMetacognitionStage {
  return {
    id,
    label,
    status,
    thought,
    evidence: unique(evidence, 4),
    nextQuestion
  };
}

function modeFor({
  status,
  proofRunner,
  aiReviewLedger,
  autopilot
}: {
  status: DecisionMetacognitionStatus;
  proofRunner: DecisionProofRunner;
  aiReviewLedger: DecisionAIReviewLedger;
  autopilot: DecisionAutopilot;
}): DecisionMetacognitionMode {
  if (status === "blocked" || proofRunner.status === "blocked" || aiReviewLedger.status === "blocked" || autopilot.status === "blocked") return "proof-blocked";
  if (aiReviewLedger.controlContract.submitToOpenAIAllowed && proofRunner.status === "verified") return "live-review-ready";
  if (!aiReviewLedger.controlContract.submitToOpenAIAllowed || aiReviewLedger.status === "needs-config") return "offline-deterministic";
  return "supervised-review";
}

function topStage(stages: DecisionMetacognitionStage[]): DecisionMetacognitionStage | null {
  return stages.slice().sort((a, b) => statusRank(b.status) - statusRank(a.status))[0] ?? null;
}

function safeCommand({
  beliefRevision,
  counterfactualLab,
  proofRunner,
  aiReviewLedger,
  operatingCycle,
  autopilot
}: {
  beliefRevision: DecisionBeliefRevision;
  counterfactualLab: DecisionCounterfactualLab;
  proofRunner: DecisionProofRunner;
  aiReviewLedger: DecisionAIReviewLedger;
  operatingCycle: DecisionOperatingCycle;
  autopilot: DecisionAutopilot;
}): { command: string | null; verifyUrl: string | null } {
  const candidates = [
    { command: beliefRevision.policy.nextSafeCommand, verifyUrl: beliefRevision.activeRevision?.verifyUrl ?? null },
    { command: counterfactualLab.decisionPolicy.nextSafeCommand, verifyUrl: counterfactualLab.activeCase?.verifyUrl ?? null },
    { command: proofRunner.runbook.firstSafeCommand, verifyUrl: proofRunner.runbook.firstVerificationUrl },
    { command: aiReviewLedger.runbook.firstReviewCommand, verifyUrl: aiReviewLedger.runbook.firstReviewUrl },
    { command: aiReviewLedger.runbook.firstProofCommand, verifyUrl: aiReviewLedger.runbook.firstProofUrl },
    { command: operatingCycle.nextTransition.command, verifyUrl: operatingCycle.nextTransition.verifyUrl },
    { command: autopilot.nextAction?.command ?? null, verifyUrl: autopilot.nextAction?.verifyUrl ?? null }
  ];
  const safe = candidates.find((item) => commandIsSafe(item.command));
  return { command: safe?.command ?? null, verifyUrl: safe?.verifyUrl ?? null };
}

export function buildDecisionMetacognition({
  rows,
  date,
  sport,
  brainSlate,
  operatingCycle,
  autopilot,
  counterfactualLab,
  beliefRevision,
  proofRunner,
  aiReviewLedger
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  brainSlate: DecisionBrainSlate;
  operatingCycle: DecisionOperatingCycle;
  autopilot: DecisionAutopilot;
  counterfactualLab: DecisionCounterfactualLab;
  beliefRevision: DecisionBeliefRevision;
  proofRunner: DecisionProofRunner;
  aiReviewLedger: DecisionAIReviewLedger;
}): DecisionMetacognition {
  const activeRevision = beliefRevision.activeRevision;
  const activeBrain = brainSlate.topBrains[0] ?? null;
  const activeBelief = activeRevision
    ? {
        matchId: activeRevision.matchId,
        match: activeRevision.match,
        baselineAction: activeRevision.baselineAction,
        revisedAction: activeRevision.revisedAction,
        status: activeRevision.status,
        revisionScore: activeRevision.revisionScore,
        beliefGradeBefore: activeRevision.beliefGradeBefore,
        beliefGradeAfter: activeRevision.beliefGradeAfter,
        reason: activeRevision.reason,
        requiredEvidence: activeRevision.requiredEvidence.slice(0, 5),
        command: activeRevision.command,
        verifyUrl: activeRevision.verifyUrl
      }
    : null;
  const doubt = unique(
    [
      activeRevision?.requiredEvidence[0] ?? "",
      operatingCycle.workingMemory.primaryDoubt,
      counterfactualLab.activeCase?.falsifier ?? "",
      proofRunner.nextReceipt?.observedEvidence ?? "",
      aiReviewLedger.nextEntry?.blockedBy[0] ?? ""
    ],
    1
  )[0] ?? "No decisive doubt is currently recorded.";
  const changeMyMind = unique([
    ...(activeRevision?.requiredEvidence ?? []),
    counterfactualLab.activeCase?.falsifier ?? "",
    counterfactualLab.activeCase?.mitigation ?? "",
    proofRunner.nextReceipt?.expectedEvidence ?? "",
    operatingCycle.nextTransition.expectedEvidence,
    ...aiReviewLedger.runbook.requiredBeforeReview,
    ...aiReviewLedger.runbook.requiredBeforePersistence
  ]);

  const stages = [
    stage({
      id: "observe",
      label: "Observe",
      status: brainSlate.status === "blocked" ? "block" : brainSlate.status === "watching" ? "watch" : "pass",
      thought: brainSlate.summary,
      evidence: [`${brainSlate.totalMatches} match(es) scanned`, `${brainSlate.blocked} blocked brain(s)`, activeBrain?.summary ?? ""],
      nextQuestion: operatingCycle.workingMemory.decisiveUnknown
    }),
    stage({
      id: "believe",
      label: "Believe",
      status: activeRevision?.status === "retiring" ? "block" : activeRevision?.status === "holding" ? "pass" : "watch",
      thought: activeRevision ? activeRevision.reason : "No active belief is available to hold.",
      evidence: [operatingCycle.workingMemory.currentBelief, activeRevision ? `Revision score ${activeRevision.revisionScore}` : "", activeBrain?.belief.summary ?? ""],
      nextQuestion: activeRevision?.requiredEvidence[0] ?? operatingCycle.workingMemory.decisiveUnknown
    }),
    stage({
      id: "doubt",
      label: "Doubt",
      status: activeRevision?.priority === "critical" || beliefRevision.status === "retiring" ? "block" : doubt ? "watch" : "pass",
      thought: doubt,
      evidence: [operatingCycle.workingMemory.primaryDoubt, activeRevision?.evidence[0] ?? "", counterfactualLab.activeCase?.thesis ?? ""],
      nextQuestion: changeMyMind[0] ?? "Which provider signal would falsify the active belief?"
    }),
    stage({
      id: "test",
      label: "Test",
      status: counterfactualLab.status === "fragile" ? "block" : counterfactualLab.status === "stable" ? "pass" : "watch",
      thought: counterfactualLab.summary,
      evidence: [
        `${counterfactualLab.breakCases} break case(s)`,
        `${counterfactualLab.downgradeCases} downgrade case(s)`,
        counterfactualLab.activeCase?.label ?? ""
      ],
      nextQuestion: counterfactualLab.activeCase?.falsifier ?? "Which shock should be rechecked first?"
    }),
    stage({
      id: "revise",
      label: "Revise",
      status: beliefRevision.status === "retiring" ? "block" : beliefRevision.status === "holding" ? "pass" : "watch",
      thought: beliefRevision.summary,
      evidence: [
        `${beliefRevision.holding} hold`,
        `${beliefRevision.weakening} weaken`,
        `${beliefRevision.needsEvidence} need evidence`,
        `${beliefRevision.retiring} retire`
      ],
      nextQuestion: activeRevision?.requiredEvidence[0] ?? "What evidence would keep the revised action from moving lower?"
    }),
    stage({
      id: "decide",
      label: "Decide",
      status: autopilot.status === "blocked" || operatingCycle.status === "blocked" ? "block" : autopilot.canPublish ? "pass" : "watch",
      thought: autopilot.summary,
      evidence: [
        `Operating cycle: ${operatingCycle.status}`,
        `Autopilot mode: ${autopilot.mode}`,
        `Next action: ${autopilot.nextAction?.label ?? "none"}`
      ],
      nextQuestion: operatingCycle.nextTransition.action
    }),
    stage({
      id: "verify",
      label: "Verify",
      status: proofRunner.status === "blocked" || aiReviewLedger.status === "blocked" ? "block" : proofRunner.status === "verified" ? "pass" : "watch",
      thought: proofRunner.summary,
      evidence: [
        `Proof receipts blocked: ${proofRunner.blockedReceipts}`,
        `AI ledger: ${aiReviewLedger.status}`,
        aiReviewLedger.nextEntry?.label ?? ""
      ],
      nextQuestion: proofRunner.nextReceipt?.expectedEvidence ?? aiReviewLedger.runbook.requiredBeforeReview[0] ?? "Which proof receipt clears next?"
    }),
    stage({
      id: "learn",
      label: "Learn",
      status: operatingCycle.stages.find((item) => item.id === "learn")?.status === "blocked" ? "block" : autopilot.canPersist ? "pass" : "watch",
      thought: operatingCycle.workingMemory.learningTarget,
      evidence: [`Persist allowed: ${autopilot.canPersist ? "yes" : "no"}`, `Publish allowed: ${autopilot.canPublish ? "yes" : "no"}`],
      nextQuestion: "Has Supabase memory, outcome settlement, and calibration proof been verified?"
    })
  ];

  const status = overallStatus(stages);
  const mode = modeFor({ status, proofRunner, aiReviewLedger, autopilot });
  const counts = stageCounts(stages);
  const top = topStage(stages);
  const nextSafe = safeCommand({ beliefRevision, counterfactualLab, proofRunner, aiReviewLedger, operatingCycle, autopilot });
  const canAskOpenAI = aiReviewLedger.controlContract.submitToOpenAIAllowed && status !== "blocked" && beliefRevision.status !== "retiring";
  const runbook: DecisionMetacognition["runbook"] = {
    nextSafeCommand: nextSafe.command,
    verifyUrl: nextSafe.verifyUrl,
    canAskOpenAI,
    canPromote: false,
    canPersist: false,
    canPublish: false,
    forbiddenActions: unique([
      "Do not promote a monitor or avoid decision from metacognition.",
      "Do not persist belief revision output until activation proof passes.",
      "Do not publish a retired, needs-evidence, or proof-blocked belief.",
      "Do not submit private keys, admin tokens, or raw provider credentials to AI review.",
      ...beliefRevision.policy.forbiddenActions,
      ...proofRunner.runbook.forbiddenActions
    ])
  };
  const metacognitionHash = stableHash({
    date,
    sport,
    status,
    mode,
    activeBelief: activeBelief
      ? {
          matchId: activeBelief.matchId,
          status: activeBelief.status,
          revisedAction: activeBelief.revisedAction,
          revisionScore: activeBelief.revisionScore
        }
      : null,
    stages: stages.map((item) => ({ id: item.id, status: item.status })),
    canAskOpenAI,
    nextSafeCommand: runbook.nextSafeCommand
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    mode,
    metacognitionHash,
    summary:
      status === "blocked"
        ? `Metacognition is blocked at ${top?.label ?? "verification"}; the agent should explain, verify, and avoid write or publish mode.`
        : status === "watching"
          ? `Metacognition is watching ${counts.watch} stage(s); the agent may reason but must keep actions supervised.`
          : "Metacognition is clear; the agent can continue through the supervised review path.",
    activeBelief,
    primaryDoubt: doubt,
    changeMyMind,
    stages,
    counts: {
      ...counts,
      rows: rows.length,
      beliefs: beliefRevision.totalBeliefs,
      counterfactualBreaks: counterfactualLab.breakCases,
      proofBlocked: proofRunner.blockedReceipts,
      ledgerBlocked: aiReviewLedger.counts.blocked
    },
    runbook
  };
}
