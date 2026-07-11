import type { DecisionBrainLiveReviewReceipt } from "@/lib/sports/prediction/decisionBrainLiveReviewReceipt";
import type { DecisionBrainState, DecisionBrainStateLoop } from "@/lib/sports/prediction/decisionBrainState";
import type { DecisionDataBackbone } from "@/lib/sports/prediction/decisionDataBackbone";
import type { DecisionEvidenceAcquisitionCandidate, DecisionEvidenceAcquisitionPlanner } from "@/lib/sports/prediction/decisionEvidenceAcquisitionPlanner";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";

export type DecisionBrainEvidenceDebtResolverStatus = "ready-action" | "waiting-env" | "waiting-storage" | "blocked";
export type DecisionBrainEvidenceDebtSource = "brain-loop" | "live-review-gate" | "acquisition-candidate" | "data-backbone";
export type DecisionBrainEvidenceDebtActionStatus = "ready" | "waiting-env" | "waiting-storage" | "manual" | "blocked";

export type DecisionBrainEvidenceDebtAction = {
  id: string;
  source: DecisionBrainEvidenceDebtSource;
  status: DecisionBrainEvidenceDebtActionStatus;
  priority: "critical" | "high" | "medium" | "low";
  label: string;
  reason: string;
  expectedEvidence: string;
  command: string | null;
  verifyUrl: string;
  safeToRun: boolean;
  missing: string[];
  blocks: string[];
  unlocks: string[];
  informationGainScore: number;
};

export type DecisionBrainEvidenceDebtResolver = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "brain-evidence-debt-resolver";
  status: DecisionBrainEvidenceDebtResolverStatus;
  resolverHash: string;
  summary: string;
  debt: {
    evidenceDebt: number;
    blockerCount: number;
    watchCount: number;
    blockedLoops: number;
    blockedLiveReviewGates: number;
    blockedDataGates: number;
  };
  actions: DecisionBrainEvidenceDebtAction[];
  nextAction: DecisionBrainEvidenceDebtAction | null;
  controls: {
    canInspectReadOnly: true;
    canRunNextSafeCommand: boolean;
    canCallOpenAI: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
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

function compact(value: string | null | undefined, maxLength = 260): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No detail available.";
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 16): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function priorityRank(priority: DecisionBrainEvidenceDebtAction["priority"]): number {
  if (priority === "critical") return 4;
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function statusRank(status: DecisionBrainEvidenceDebtActionStatus): number {
  if (status === "ready") return 5;
  if (status === "waiting-storage") return 4;
  if (status === "waiting-env") return 3;
  if (status === "manual") return 2;
  return 1;
}

function safeCommand(command: string | null, missing: string[], status: DecisionBrainEvidenceDebtActionStatus): boolean {
  if (!command || missing.length || status !== "ready") return false;
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  if (lower.includes("run=1") || lower.includes("persist=1") || lower.includes("publish=1") || lower.includes("dryrun=0")) return false;
  if (lower.includes("-x post") && !lower.includes("dryrun=1")) return false;
  return true;
}

function action(input: Omit<DecisionBrainEvidenceDebtAction, "safeToRun" | "reason" | "expectedEvidence"> & {
  reason: string;
  expectedEvidence: string;
}): DecisionBrainEvidenceDebtAction {
  const missing = unique(input.missing);
  const normalized = {
    ...input,
    reason: compact(input.reason),
    expectedEvidence: compact(input.expectedEvidence),
    missing,
    blocks: unique(input.blocks),
    unlocks: unique(input.unlocks),
    informationGainScore: clamp(input.informationGainScore)
  };
  return {
    ...normalized,
    safeToRun: safeCommand(normalized.command, missing, normalized.status)
  };
}

function loopAction(loop: DecisionBrainStateLoop, index: number): DecisionBrainEvidenceDebtAction {
  const status: DecisionBrainEvidenceDebtActionStatus = loop.status === "block" ? "blocked" : "manual";
  return action({
    id: `brain-loop-${loop.id}`,
    source: "brain-loop",
    status,
    priority: loop.status === "block" ? "critical" : "high",
    label: loop.label,
    reason: loop.signal,
    expectedEvidence: loop.nextAction,
    command: null,
    verifyUrl: "/api/sports/decision/brain-state",
    missing: [],
    blocks: [`${loop.label} is ${loop.status}.`],
    unlocks: ["brain review packet readiness", "same-or-safer AI critique eligibility"],
    informationGainScore: 92 - index * 4
  });
}

function liveGateAction(gate: DecisionBrainLiveReviewReceipt["gates"][number], index: number): DecisionBrainEvidenceDebtAction {
  const status: DecisionBrainEvidenceDebtActionStatus = gate.status === "block" ? "blocked" : "manual";
  return action({
    id: `live-review-${gate.id}`,
    source: "live-review-gate",
    status,
    priority: gate.id === "packet-contract" ? "critical" : gate.status === "block" ? "high" : "medium",
    label: gate.label,
    reason: gate.detail,
    expectedEvidence: gate.nextAction,
    command: null,
    verifyUrl: gate.proofUrl,
    missing: [],
    blocks: [`${gate.label} is ${gate.status}.`],
    unlocks: ["guarded OpenAI live review receipt", "AI review audit trail"],
    informationGainScore: 88 - index * 5
  });
}

function acquisitionStatus(candidate: DecisionEvidenceAcquisitionCandidate): DecisionBrainEvidenceDebtActionStatus {
  if (candidate.status === "ready") return "ready";
  if (candidate.status === "waiting-env") return "waiting-env";
  if (candidate.status === "waiting-supabase") return "waiting-storage";
  if (candidate.status === "manual") return "manual";
  return "blocked";
}

function acquisitionAction(candidate: DecisionEvidenceAcquisitionCandidate): DecisionBrainEvidenceDebtAction {
  return action({
    id: `resolver-${candidate.id}`,
    source: "acquisition-candidate",
    status: acquisitionStatus(candidate),
    priority: candidate.priority,
    label: candidate.label,
    reason: candidate.expectedBeliefChange,
    expectedEvidence: candidate.expectedEvidence,
    command: candidate.command,
    verifyUrl: candidate.verifyUrl,
    missing: candidate.missingEnv,
    blocks: candidate.blockers,
    unlocks: [`${candidate.affectedBeliefs} belief(s)`, "brain evidence debt reduction", "decision confidence ceiling repair"],
    informationGainScore: candidate.informationGainScore
  });
}

function dataBackboneActions(dataBackbone: DecisionDataBackbone): DecisionBrainEvidenceDebtAction[] {
  return dataBackbone.gates
    .filter((gate) => gate.status !== "pass")
    .map((gate, index) =>
      action({
        id: `data-backbone-${gate.id}`,
        source: "data-backbone",
        status: gate.id === "storage-proof" ? "waiting-storage" : "blocked",
        priority: gate.status === "block" ? "critical" : "high",
        label: gate.label,
        reason: gate.detail,
        expectedEvidence: gate.nextAction,
        command: gate.id === "storage-proof" ? decisionCurlCommand("/api/sports/decision/storage-activation-checklist") : null,
        verifyUrl: gate.proofUrl,
        missing: dataBackbone.nextAction.missing,
        blocks: [dataBackbone.summary],
        unlocks: ["data backbone", "brain observe loop", "final answer trace"],
        informationGainScore: Math.max(50, 90 - index * 8)
      })
    );
}

function statusFor(actions: DecisionBrainEvidenceDebtAction[]): DecisionBrainEvidenceDebtResolverStatus {
  if (actions.some((item) => item.status === "ready")) return "ready-action";
  if (actions.some((item) => item.status === "waiting-storage")) return "waiting-storage";
  if (actions.some((item) => item.status === "waiting-env")) return "waiting-env";
  return "blocked";
}

function summaryFor(status: DecisionBrainEvidenceDebtResolverStatus, debt: DecisionBrainEvidenceDebtResolver["debt"], next: DecisionBrainEvidenceDebtAction | null): string {
  if (status === "ready-action") return `Brain evidence debt has a safe next action: ${next?.label ?? "inspect resolver"}.`;
  if (status === "waiting-storage") return `Brain evidence debt is dominated by storage proof: ${debt.blockedDataGates} data gate(s) block review.`;
  if (status === "waiting-env") return "Brain evidence debt is waiting on provider or admin environment variables before dry-runs can reduce uncertainty.";
  return `Brain evidence debt remains blocked: ${debt.blockerCount} blocker(s), ${debt.watchCount} watch item(s), evidence debt ${debt.evidenceDebt}/100.`;
}

export function buildDecisionBrainEvidenceDebtResolver({
  date,
  sport,
  brainState,
  brainLiveReviewReceipt,
  evidenceAcquisitionPlanner,
  dataBackbone,
  now = new Date(),
  limit = 12
}: {
  date: string;
  sport: Sport;
  brainState: DecisionBrainState;
  brainLiveReviewReceipt: DecisionBrainLiveReviewReceipt;
  evidenceAcquisitionPlanner: DecisionEvidenceAcquisitionPlanner;
  dataBackbone: DecisionDataBackbone;
  now?: Date;
  limit?: number;
}): DecisionBrainEvidenceDebtResolver {
  const loopActions = brainState.loops.filter((loop) => loop.status !== "pass").map(loopAction);
  const liveActions = brainLiveReviewReceipt.gates.filter((gate) => gate.status !== "pass").map(liveGateAction);
  const acquisitionActions = evidenceAcquisitionPlanner.candidates.slice(0, 8).map(acquisitionAction);
  const backboneActions = dataBackboneActions(dataBackbone);
  const actions = [...loopActions, ...liveActions, ...acquisitionActions, ...backboneActions]
    .sort((a, b) => {
      return (
        statusRank(b.status) - statusRank(a.status) ||
        priorityRank(b.priority) - priorityRank(a.priority) ||
        b.informationGainScore - a.informationGainScore ||
        a.label.localeCompare(b.label)
      );
    })
    .slice(0, limit);
  const nextAction = actions.find((item) => item.safeToRun) ?? actions[0] ?? null;
  const debt = {
    evidenceDebt: brainState.pressure.evidenceDebt,
    blockerCount: brainState.pressure.blockerCount,
    watchCount: brainState.pressure.watchCount,
    blockedLoops: brainState.loops.filter((loop) => loop.status === "block").length,
    blockedLiveReviewGates: brainLiveReviewReceipt.gates.filter((gate) => gate.status === "block").length,
    blockedDataGates: dataBackbone.gates.filter((gate) => gate.status === "block").length
  };
  const status = statusFor(actions);

  return {
    generatedAt: now.toISOString(),
    date,
    sport,
    mode: "brain-evidence-debt-resolver",
    status,
    resolverHash: stableHash({
      date,
      sport,
      status,
      debt,
      brain: brainState.brainHash,
      live: brainLiveReviewReceipt.receiptHash,
      planner: evidenceAcquisitionPlanner.plannerHash,
      actions: actions.map((item) => [item.id, item.status, item.informationGainScore])
    }),
    summary: summaryFor(status, debt, nextAction),
    debt,
    actions,
    nextAction,
    controls: {
      canInspectReadOnly: true,
      canRunNextSafeCommand: Boolean(nextAction?.safeToRun),
      canCallOpenAI: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/brain-evidence-debt-resolver",
      "/api/sports/decision/brain-state",
      "/api/sports/decision/brain-live-review-receipt",
      "/api/sports/decision/evidence-acquisition-planner",
      "/api/sports/decision/data-backbone",
      ...brainState.proofUrls,
      ...brainLiveReviewReceipt.proofUrls,
      ...evidenceAcquisitionPlanner.proofUrls,
      ...dataBackbone.proofUrls
    ]),
    locks: unique([
      "Evidence-debt resolver cannot call OpenAI; it only identifies proof needed before live review.",
      "Resolver commands must be read-only or dryRun=1 and cannot persist, publish, train, stake, or upgrade public action.",
      ...brainState.locks,
      ...brainLiveReviewReceipt.locks,
      ...evidenceAcquisitionPlanner.locks,
      ...dataBackbone.locks
    ])
  };
}
