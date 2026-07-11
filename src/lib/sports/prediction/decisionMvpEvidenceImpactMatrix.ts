import type {
  DecisionMvpEvidenceAcquisitionItem,
  DecisionMvpEvidenceAcquisitionQueue
} from "@/lib/sports/prediction/decisionMvpEvidenceAcquisitionQueue";
import type { DecisionMvpBeliefRevisionLoop } from "@/lib/sports/prediction/decisionMvpBeliefRevisionLoop";
import type { DecisionMvpProgressSnapshot } from "@/lib/sports/prediction/decisionMvpProgressSnapshot";
import type { Sport } from "@/lib/sports/types";

export type DecisionMvpEvidenceImpactMatrixStatus = "ready-readonly" | "waiting-provider-key" | "manual-review" | "blocked";
export type DecisionMvpEvidenceImpactSignal = "belief" | "market" | "provider" | "launch" | "safety";

export type DecisionMvpEvidenceImpactItem = {
  id: string;
  rank: number;
  matchId: string;
  match: string;
  label: string;
  status: DecisionMvpEvidenceImpactMatrixStatus;
  signal: DecisionMvpEvidenceImpactSignal;
  impactScore: number;
  uncertaintyReduction: number;
  actionFlipPotential: number;
  blockerReduction: number;
  proofCost: number;
  missingEnv: string[];
  proofUrl: string;
  command: string | null;
  safeToRun: boolean;
  decisionQuestion: string;
  expectedRevision: string;
  ifSupports: string;
  ifContradicts: string;
  ifMissing: string;
};

export type DecisionMvpEvidenceImpactMatrix = {
  mode: "decision-mvp-evidence-impact-matrix";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpEvidenceImpactMatrixStatus;
  matrixHash: string;
  summary: string;
  nextImpact: DecisionMvpEvidenceImpactItem | null;
  items: DecisionMvpEvidenceImpactItem[];
  totals: {
    items: number;
    readyReadonly: number;
    waitingProviderKey: number;
    manualReview: number;
    blocked: number;
    maxImpactScore: number;
    averageImpactScore: number;
  };
  controls: {
    canInspectReadOnly: true;
    canRunNextReadOnlyProof: boolean;
    canAskOpenAI: false;
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

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function priorityScore(priority: DecisionMvpEvidenceAcquisitionItem["priority"]): number {
  if (priority === "critical") return 34;
  if (priority === "high") return 26;
  if (priority === "medium") return 16;
  return 8;
}

function signalFor(item: DecisionMvpEvidenceAcquisitionItem): DecisionMvpEvidenceImpactSignal {
  const text = `${item.providerId} ${item.label} ${item.gap} ${item.expectedEvidence}`.toLowerCase();
  if (text.includes("odds") || text.includes("market") || text.includes("bookmaker") || text.includes("no-vig") || text.includes("value")) return "market";
  if (text.includes("provider") || text.includes("fixture") || text.includes("lineup") || text.includes("injur") || text.includes("standings") || text.includes("live")) return "provider";
  if (text.includes("launch") || text.includes("epl") || text.includes("storage") || text.includes("training")) return "launch";
  if (text.includes("safe") || text.includes("risk") || text.includes("block")) return "safety";
  return "belief";
}

function statusFor(item: DecisionMvpEvidenceAcquisitionItem): DecisionMvpEvidenceImpactMatrixStatus {
  if (item.status === "ready-readonly") return "ready-readonly";
  if (item.status === "waiting-provider") return "waiting-provider-key";
  if (item.status === "manual-review") return "manual-review";
  return "blocked";
}

function scoreItem({
  item,
  signal,
  beliefRevisionLoop,
  mvpProgressSnapshot
}: {
  item: DecisionMvpEvidenceAcquisitionItem;
  signal: DecisionMvpEvidenceImpactSignal;
  beliefRevisionLoop: DecisionMvpBeliefRevisionLoop;
  mvpProgressSnapshot: DecisionMvpProgressSnapshot;
}) {
  const uncertaintyReduction = clamp(priorityScore(item.priority) + (beliefRevisionLoop.revision.trustCeiling === "locked" ? 18 : 8) + (item.status === "ready-readonly" ? 10 : 0));
  const actionFlipPotential = clamp(
    (signal === "market" ? 34 : signal === "provider" ? 28 : signal === "safety" ? 24 : 14) +
      (beliefRevisionLoop.revision.baselineAction === "consider" ? 8 : 0)
  );
  const blockerReduction = clamp(
    (item.status === "ready-readonly" ? 34 : item.status === "waiting-provider" ? 24 : item.status === "manual-review" ? 12 : 4) +
      (mvpProgressSnapshot.status === "needs-provider-keys" && signal === "provider" ? 18 : 0)
  );
  const proofCost = clamp(item.missingEnv.length * 14 + (item.safeToRun ? 0 : 8) + (item.status === "blocked" ? 18 : 0));
  const impactScore = clamp(uncertaintyReduction * 0.34 + actionFlipPotential * 0.28 + blockerReduction * 0.28 - proofCost * 0.32);
  return { uncertaintyReduction, actionFlipPotential, blockerReduction, proofCost, impactScore };
}

function impactItem({
  item,
  rank,
  beliefRevisionLoop,
  mvpProgressSnapshot
}: {
  item: DecisionMvpEvidenceAcquisitionItem;
  rank: number;
  beliefRevisionLoop: DecisionMvpBeliefRevisionLoop;
  mvpProgressSnapshot: DecisionMvpProgressSnapshot;
}): DecisionMvpEvidenceImpactItem {
  const signal = signalFor(item);
  const scoring = scoreItem({ item, signal, beliefRevisionLoop, mvpProgressSnapshot });
  const status = statusFor(item);
  return {
    id: `impact-${item.id}`,
    rank,
    matchId: item.matchId,
    match: item.match,
    label: item.label,
    status,
    signal,
    ...scoring,
    missingEnv: item.missingEnv,
    proofUrl: item.proofUrl,
    command: item.command,
    safeToRun: item.safeToRun && status === "ready-readonly",
    decisionQuestion: compact(`Would ${item.match} remain ${beliefRevisionLoop.revision.baselineAction ?? "monitor"} if ${item.label.toLowerCase()} supports or contradicts the current belief?`, 240),
    expectedRevision: compact(item.expectedBeliefChange, 240),
    ifSupports: compact(`Keep the belief capped at ${beliefRevisionLoop.revision.trustCeiling}; move only toward monitor/shadow review if every stronger gate also clears.`, 240),
    ifContradicts: compact(`Lower or retire the belief, prefer avoid/monitor, and keep public action locked until the contradiction is resolved.`, 240),
    ifMissing: compact(item.missingEnv.length ? `Stay blocked on ${item.missingEnv.join(" or ")} and do not raise trust.` : "Keep the evidence gap open and select the next proof candidate.", 240)
  };
}

function statusForMatrix(items: DecisionMvpEvidenceImpactItem[]): DecisionMvpEvidenceImpactMatrixStatus {
  if (items.some((item) => item.safeToRun && item.status === "ready-readonly")) return "ready-readonly";
  if (items.some((item) => item.status === "waiting-provider-key")) return "waiting-provider-key";
  if (items.some((item) => item.status === "manual-review")) return "manual-review";
  return "blocked";
}

function summaryFor(status: DecisionMvpEvidenceImpactMatrixStatus, nextImpact: DecisionMvpEvidenceImpactItem | null): string {
  if (status === "ready-readonly") return `Evidence impact matrix can inspect ${nextImpact?.label ?? "the next proof"} as the highest-impact read-only move.`;
  if (status === "waiting-provider-key") return `Evidence impact matrix is waiting on ${nextImpact?.missingEnv[0] ?? "provider keys"} before the highest-impact belief test can run.`;
  if (status === "manual-review") return `Evidence impact matrix needs operator review before the next belief-changing proof is safe.`;
  return "Evidence impact matrix is blocked until the evidence queue has usable proof candidates.";
}

export function buildDecisionMvpEvidenceImpactMatrix({
  date,
  sport,
  evidenceQueue,
  beliefRevisionLoop,
  mvpProgressSnapshot,
  now = new Date(),
  limit = 8
}: {
  date: string;
  sport: Sport;
  evidenceQueue: DecisionMvpEvidenceAcquisitionQueue;
  beliefRevisionLoop: DecisionMvpBeliefRevisionLoop;
  mvpProgressSnapshot: DecisionMvpProgressSnapshot;
  now?: Date;
  limit?: number;
}): DecisionMvpEvidenceImpactMatrix {
  const items = evidenceQueue.items
    .map((item, index) => impactItem({ item, rank: index + 1, beliefRevisionLoop, mvpProgressSnapshot }))
    .sort((a, b) => b.impactScore - a.impactScore || Number(b.safeToRun) - Number(a.safeToRun) || a.match.localeCompare(b.match))
    .slice(0, Math.max(1, Math.min(20, limit)))
    .map((item, index) => ({ ...item, rank: index + 1 }));
  const nextImpact = items.find((item) => item.safeToRun) ?? items.find((item) => item.status !== "blocked") ?? items[0] ?? null;
  const status = statusForMatrix(items);
  const scores = items.map((item) => item.impactScore);

  return {
    mode: "decision-mvp-evidence-impact-matrix",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    matrixHash: stableHash({
      date,
      sport,
      status,
      queue: [evidenceQueue.queueHash, evidenceQueue.status],
      revision: [beliefRevisionLoop.loopHash, beliefRevisionLoop.status, beliefRevisionLoop.revision.trustCeiling],
      progress: [mvpProgressSnapshot.status, mvpProgressSnapshot.percentages.liveProduction],
      items: items.map((item) => [item.id, item.rank, item.status, item.impactScore])
    }),
    summary: summaryFor(status, nextImpact),
    nextImpact,
    items,
    totals: {
      items: items.length,
      readyReadonly: items.filter((item) => item.status === "ready-readonly").length,
      waitingProviderKey: items.filter((item) => item.status === "waiting-provider-key").length,
      manualReview: items.filter((item) => item.status === "manual-review").length,
      blocked: items.filter((item) => item.status === "blocked").length,
      maxImpactScore: Math.max(0, ...scores),
      averageImpactScore: average(scores)
    },
    controls: {
      canInspectReadOnly: true,
      canRunNextReadOnlyProof: Boolean(nextImpact?.safeToRun),
      canAskOpenAI: false,
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
    proofUrls: unique([
      "/api/sports/decision/mvp-evidence-impact-matrix",
      "/api/sports/decision/mvp-evidence-acquisition-queue",
      "/api/sports/decision/mvp-belief-revision-loop",
      nextImpact?.proofUrl,
      ...evidenceQueue.proofUrls,
      ...beliefRevisionLoop.proofUrls,
      ...mvpProgressSnapshot.proofUrls
    ]),
    locks: unique([
      "MVP evidence impact matrix ranks proof value only; it does not fetch providers, write rows, train, publish, stake, or raise trust.",
      "Impact scores are advisory and remain below provider proof, authority, OpenAI, storage, and training gates.",
      "A high-impact proof can only keep, lower, or hold the current belief through the belief revision loop.",
      ...evidenceQueue.locks,
      ...beliefRevisionLoop.locks
    ])
  };
}
