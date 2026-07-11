import type { DecisionLiveProviderProbeLedger } from "@/lib/sports/prediction/decisionLiveProviderProbeLedger";
import type { DecisionMvpProgressSnapshot, DecisionMvpProgressSnapshotLane } from "@/lib/sports/prediction/decisionMvpProgressSnapshot";
import type { DecisionProviderEnvDiagnostic } from "@/lib/sports/prediction/decisionProviderEnvDiagnostic";
import type { DecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import type { Sport } from "@/lib/sports/types";

export type DecisionMvpActivationQueueStatus = "blocked" | "ready" | "waiting" | "complete";
export type DecisionMvpActivationQueueItemStatus = "blocked" | "ready" | "waiting" | "done" | "locked";
export type DecisionMvpActivationQueueItemLane = "provider" | "proof" | "storage" | "ai" | "training" | "epl" | "reasoning";

export type DecisionMvpActivationQueueItem = {
  id:
    | "provider-env"
    | "provider-proof"
    | "storage-proof"
    | "openai-review"
    | "training-corpus"
    | "epl-prekickoff"
    | "slate-investigation";
  lane: DecisionMvpActivationQueueItemLane;
  label: string;
  status: DecisionMvpActivationQueueItemStatus;
  priority: number;
  safeToRun: boolean;
  evidence: string;
  nextAction: string;
  proofUrl: string;
  missing: string[];
};

export type DecisionMvpActivationQueue = {
  mode: "decision-mvp-activation-queue";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpActivationQueueStatus;
  queueHash: string;
  summary: string;
  selected: DecisionMvpActivationQueueItem | null;
  items: DecisionMvpActivationQueueItem[];
  totals: {
    items: number;
    blocked: number;
    ready: number;
    waiting: number;
    done: number;
    locked: number;
  };
  controls: {
    canInspectReadOnly: true;
    canRunSafeProof: boolean;
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

function unique(values: Array<string | null | undefined>, limit = 30): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function mvpLane(snapshot: DecisionMvpProgressSnapshot, id: DecisionMvpProgressSnapshotLane["id"]): DecisionMvpProgressSnapshotLane | null {
  return snapshot.lanes.find((lane) => lane.id === id) ?? null;
}

function itemRank(status: DecisionMvpActivationQueueItemStatus): number {
  if (status === "blocked") return 5;
  if (status === "ready") return 4;
  if (status === "waiting") return 3;
  if (status === "locked") return 2;
  return 1;
}

function sortItems(items: DecisionMvpActivationQueueItem[]): DecisionMvpActivationQueueItem[] {
  return items.slice().sort((a, b) => {
    const status = itemRank(b.status) - itemRank(a.status);
    if (status !== 0) return status;
    return a.priority - b.priority;
  });
}

function queueStatus(items: DecisionMvpActivationQueueItem[]): DecisionMvpActivationQueueStatus {
  if (items.some((item) => item.status === "blocked")) return "blocked";
  if (items.some((item) => item.status === "ready")) return "ready";
  if (items.some((item) => item.status === "waiting" || item.status === "locked")) return "waiting";
  return "complete";
}

function summaryFor(status: DecisionMvpActivationQueueStatus, selected: DecisionMvpActivationQueueItem | null): string {
  if (status === "complete") return "MVP activation queue is complete; guarded publish and staking controls still remain closed until production approval.";
  if (status === "ready") return `${selected?.label ?? "A proof"} is ready to inspect or run through its guarded route.`;
  if (status === "waiting") return `MVP activation is waiting on ${selected?.label ?? "the next proof lane"}.`;
  return `MVP activation is blocked by ${selected?.label ?? "provider, storage, or training prerequisites"}.`;
}

export function buildDecisionMvpActivationQueue({
  date,
  sport,
  providerEnvDiagnostic,
  mvpProgressSnapshot,
  liveProviderProbeLedger,
  slateThinking,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  providerEnvDiagnostic: DecisionProviderEnvDiagnostic;
  mvpProgressSnapshot: DecisionMvpProgressSnapshot;
  liveProviderProbeLedger: DecisionLiveProviderProbeLedger;
  slateThinking: DecisionSlateThinking;
  now?: Date;
}): DecisionMvpActivationQueue {
  const storageLane = mvpLane(mvpProgressSnapshot, "supabase-storage");
  const aiLane = mvpLane(mvpProgressSnapshot, "openai-review");
  const trainingLane = mvpLane(mvpProgressSnapshot, "training-corpus");
  const eplLane = mvpLane(mvpProgressSnapshot, "epl-2026");
  const providerReady = providerEnvDiagnostic.footballMvpMinimum.status === "ready";
  const providerProofReady =
    liveProviderProbeLedger.status === "probe-ready" ||
    liveProviderProbeLedger.status === "probe-passed" ||
    liveProviderProbeLedger.lanes.some((lane) => lane.status === "not-requested" && lane.configured);

  const items = sortItems([
    {
      id: "provider-env",
      lane: "provider",
      label: "Configure football and odds provider keys",
      status: providerReady ? "done" : providerEnvDiagnostic.status === "partial" ? "waiting" : "blocked",
      priority: 1,
      safeToRun: false,
      evidence: providerEnvDiagnostic.summary,
      nextAction: providerEnvDiagnostic.footballMvpMinimum.nextAction,
      proofUrl: "/api/sports/decision/provider-env-diagnostic",
      missing: providerEnvDiagnostic.footballMvpMinimum.missingKeys.concat(providerEnvDiagnostic.footballMvpMinimum.placeholderKeys)
    },
    {
      id: "provider-proof",
      lane: "proof",
      label: "Run guarded provider dry-run proof",
      status: liveProviderProbeLedger.status === "probe-passed" ? "done" : providerProofReady ? "ready" : providerReady ? "waiting" : "locked",
      priority: 2,
      safeToRun: liveProviderProbeLedger.controls.canRunDryRun && providerProofReady,
      evidence: liveProviderProbeLedger.summary,
      nextAction: liveProviderProbeLedger.nextLane?.nextAction ?? liveProviderProbeLedger.locks[0],
      proofUrl: "/api/sports/decision/live-provider-probe-ledger",
      missing: liveProviderProbeLedger.nextLane?.missingEnv ?? []
    },
    {
      id: "storage-proof",
      lane: "storage",
      label: "Verify Supabase storage proof",
      status: storageLane?.status === "done" ? "done" : storageLane?.status === "current" ? "waiting" : "blocked",
      priority: 3,
      safeToRun: false,
      evidence: storageLane?.evidence ?? "Supabase storage proof is unavailable.",
      nextAction: storageLane?.nextAction ?? "Verify the OddsPadi Supabase project, schema, and service-role configuration.",
      proofUrl: storageLane?.proofUrl ?? "/api/sports/decision/storage-activation-checklist",
      missing: storageLane?.status === "done" ? [] : ["Supabase storage proof"]
    },
    {
      id: "openai-review",
      lane: "ai",
      label: "Enable guarded OpenAI review",
      status: aiLane?.status === "done" ? "done" : aiLane?.status === "current" ? "waiting" : "locked",
      priority: 4,
      safeToRun: false,
      evidence: aiLane?.evidence ?? "OpenAI review proof is unavailable.",
      nextAction: aiLane?.nextAction ?? "Configure OPENAI_API_KEY and run the bounded review receipt.",
      proofUrl: aiLane?.proofUrl ?? "/api/sports/decision/openai-key-diagnostic",
      missing: aiLane?.status === "done" ? [] : ["OpenAI review proof"]
    },
    {
      id: "training-corpus",
      lane: "training",
      label: "Backfill and prove 10-year training corpus",
      status: trainingLane?.status === "done" ? "done" : trainingLane?.status === "current" ? "waiting" : "locked",
      priority: 5,
      safeToRun: false,
      evidence: trainingLane?.evidence ?? "Training corpus proof is unavailable.",
      nextAction: trainingLane?.nextAction ?? "Backfill the 10-year football, basketball, and tennis corpus before learned weights can promote.",
      proofUrl: trainingLane?.proofUrl ?? "/api/sports/decision/training/ten-year-corpus-execution",
      missing: trainingLane?.status === "done" ? [] : ["10-year historical corpus proof"]
    },
    {
      id: "epl-prekickoff",
      lane: "epl",
      label: "Prepare EPL 2026/27 pre-kickoff proof",
      status: eplLane?.status === "done" ? "done" : providerReady ? "waiting" : "locked",
      priority: 6,
      safeToRun: false,
      evidence: eplLane?.evidence ?? `${mvpProgressSnapshot.epl2026.openingWindowFixtures} EPL opener fixture(s) tracked.`,
      nextAction: eplLane?.nextAction ?? mvpProgressSnapshot.epl2026.nextAction,
      proofUrl: eplLane?.proofUrl ?? "/api/sports/decision/epl-pre-kickoff-rehearsal",
      missing: providerReady ? [] : ["EPL provider fixture IDs and odds markets"]
    },
    {
      id: "slate-investigation",
      lane: "reasoning",
      label: "Investigate next slate belief",
      status: slateThinking.nextThought ? "waiting" : "locked",
      priority: 7,
      safeToRun: true,
      evidence: slateThinking.summary,
      nextAction: slateThinking.nextThought?.nextEvidenceAction ?? "Build slate thinking before selecting a match investigation.",
      proofUrl: slateThinking.policy.verificationUrl,
      missing: slateThinking.nextThought?.evidenceGaps.slice(0, 3) ?? []
    }
  ]);
  const selected = items.find((item) => item.status === "blocked" || item.status === "ready" || item.status === "waiting") ?? items[0] ?? null;
  const status = queueStatus(items);
  const totals = {
    items: items.length,
    blocked: items.filter((item) => item.status === "blocked").length,
    ready: items.filter((item) => item.status === "ready").length,
    waiting: items.filter((item) => item.status === "waiting").length,
    done: items.filter((item) => item.status === "done").length,
    locked: items.filter((item) => item.status === "locked").length
  };
  const queueHash = stableHash({
    date,
    sport,
    status,
    selected: selected?.id,
    items: items.map((item) => [item.id, item.status, item.safeToRun, item.missing])
  });

  return {
    mode: "decision-mvp-activation-queue",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    queueHash,
    summary: summaryFor(status, selected),
    selected,
    items,
    totals,
    controls: {
      canInspectReadOnly: true,
      canRunSafeProof: items.some((item) => item.safeToRun && item.status === "ready"),
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-activation-queue",
      ...items.map((item) => item.proofUrl),
      ...mvpProgressSnapshot.proofUrls,
      ...liveProviderProbeLedger.proofUrls
    ]),
    locks: [
      "The MVP activation queue only ranks the next proof; it cannot write provider rows, persist decisions, train models, publish picks, stake, or upgrade public action.",
      "Provider network probes still require run=1 and x-oddspadi-admin-token on their dedicated proof route.",
      "OpenAI review, Supabase storage, and training promotion remain separate proof gates."
    ]
  };
}
