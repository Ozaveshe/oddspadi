import type { FootballProviderLiveDecisionCycleReceipt } from "@/lib/sports/training/footballProviderLiveDecisionCycleReceipt";

export type FootballProviderLiveOperationQueueStatus = "blocked-provider-data" | "ready-readonly" | "ready-monitor" | "waiting-ai-review" | "safe-hold";
export type FootballProviderLiveOperationStatus = "ready" | "waiting" | "blocked" | "done";
export type FootballProviderLiveOperationKind = "provider" | "feature" | "odds" | "briefing" | "openai" | "monitor" | "storage" | "settlement" | "safety";

export type FootballProviderLiveOperation = {
  id: string;
  kind: FootballProviderLiveOperationKind;
  status: FootballProviderLiveOperationStatus;
  priority: "critical" | "high" | "medium" | "low";
  label: string;
  rationale: string;
  expectedEvidence: string;
  verifyUrl: string;
  command: string | null;
  safeToRun: boolean;
  blockedBy: string[];
};

export type FootballProviderLiveOperationQueue = {
  mode: "football-provider-live-operation-queue";
  generatedAt: string;
  status: FootballProviderLiveOperationQueueStatus;
  queueHash: string;
  summary: string;
  target: FootballProviderLiveDecisionCycleReceipt["target"];
  nextOperation: FootballProviderLiveOperation | null;
  totals: Record<FootballProviderLiveOperationStatus, number>;
  operations: FootballProviderLiveOperation[];
  controls: {
    canInspectReadOnly: true;
    canRunReadOnlyProof: boolean;
    canRequestAIReview: boolean;
    canUseForMonitor: boolean;
    canWriteLiveFeatureSnapshots: boolean;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
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

function unique(values: Array<string | null | undefined>, limit = 14): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function commandIsReadOnly(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  if (!lower.includes("curl.exe")) return false;
  const hasRunParam = /[?&]run=1\b/.test(lower) || /[?&]run=true\b/.test(lower);
  return !hasRunParam && !lower.includes("dryrun=0") && !lower.includes("dryrun=false") && !lower.includes("persist=1");
}

function operation(input: Omit<FootballProviderLiveOperation, "safeToRun" | "blockedBy"> & { blockedBy?: string[] }): FootballProviderLiveOperation {
  const blockedBy = unique(input.blockedBy ?? [], 8);
  return {
    ...input,
    blockedBy,
    safeToRun: input.status === "ready" && blockedBy.length === 0 && commandIsReadOnly(input.command)
  };
}

function statusFor(cycle: FootballProviderLiveDecisionCycleReceipt, operations: FootballProviderLiveOperation[]): FootballProviderLiveOperationQueueStatus {
  if (cycle.status === "waiting-provider-data") return "blocked-provider-data";
  if (cycle.status === "waiting-openai-key") return "safe-hold";
  if (cycle.status === "ready-for-ai-review") return "waiting-ai-review";
  if (cycle.status === "ai-reviewed-monitor") return "ready-monitor";
  if (operations.some((item) => item.status === "ready" && item.safeToRun)) return "ready-readonly";
  return "safe-hold";
}

function summaryFor(status: FootballProviderLiveOperationQueueStatus, nextOperation: FootballProviderLiveOperation | null): string {
  if (status === "blocked-provider-data") return `Live operation queue is blocked by provider data: ${nextOperation?.label ?? "configure provider keys"}.`;
  if (status === "waiting-ai-review") return "Live operation queue is ready for a bounded AI critique before monitor action.";
  if (status === "ready-monitor") return "Live operation queue is monitor-ready; public picks, staking, training, and persistence remain locked.";
  if (status === "ready-readonly") return `Live operation queue has a safe read-only proof ready: ${nextOperation?.label ?? "inspect proof"}.`;
  return "Live operation queue is in safe hold until the next evidence gate clears.";
}

function operationsFor(cycle: FootballProviderLiveDecisionCycleReceipt): FootballProviderLiveOperation[] {
  const providerMissing = cycle.stages.providerData.missing;
  const providerReady = cycle.stages.providerData.ready;
  const watchlistReady = cycle.stages.modelMarket.ready;
  const briefingReady = cycle.stages.briefing.ready;
  const aiReviewed = cycle.stages.aiCritique.reviewed;

  return [
    operation({
      id: "provider-keys-and-fixture-proof",
      kind: "provider",
      status: providerReady ? "done" : "blocked",
      priority: "critical",
      label: "Configure provider keys and raw fixture proof",
      rationale: providerReady ? "Provider-backed fixture, odds, and raw payload proof are available." : cycle.summary,
      expectedEvidence: "Runtime source is provider-backed, fixture rows link raw payload proof, and complete match_winner odds exist.",
      verifyUrl: "/api/sports/decision/training/football-provider-live-activation?date=2026-08-21&dryRun=1",
      command: providerReady ? `curl.exe -s "http://127.0.0.1:3025/api/sports/decision/training/football-provider-live-activation?date=2026-08-21&dryRun=1"` : null,
      blockedBy: providerReady ? [] : providerMissing
    }),
    operation({
      id: "live-feature-preview",
      kind: "feature",
      status: cycle.stages.providerData.source === "provider-backed" || cycle.stages.providerData.source === "mock-fallback" ? "ready" : "waiting",
      priority: "high",
      label: "Inspect live feature materializer",
      rationale: "Preview split=live rows and feature evidence before any storage or monitor action.",
      expectedEvidence: "Feature rows include model probabilities, market probabilities, odds, evidence flags, and pending settlement targets.",
      verifyUrl: "/api/sports/decision/training/football-provider-live-feature-materializer?date=2026-08-21&dryRun=1",
      command: `curl.exe -s "http://127.0.0.1:3025/api/sports/decision/training/football-provider-live-feature-materializer?date=2026-08-21&dryRun=1"`,
      blockedBy: []
    }),
    operation({
      id: "rank-value-watchlist",
      kind: "odds",
      status: watchlistReady ? "done" : providerReady ? "ready" : "waiting",
      priority: "high",
      label: "Rank model-vs-market value watchlist",
      rationale: watchlistReady ? `${cycle.stages.modelMarket.monitorCandidates} monitor candidate(s) ranked.` : "Rank candidates only after provider-backed odds and fixture proof are ready.",
      expectedEvidence: "Watchlist returns positive edge, positive EV, risks, and safer alternatives without public-pick language.",
      verifyUrl: "/api/sports/decision/training/football-provider-live-watchlist?date=2026-08-21&dryRun=1",
      command: `curl.exe -s "http://127.0.0.1:3025/api/sports/decision/training/football-provider-live-watchlist?date=2026-08-21&dryRun=1"`,
      blockedBy: providerReady ? [] : ["provider-backed fixture and odds proof"]
    }),
    operation({
      id: "prepare-briefing-packet",
      kind: "briefing",
      status: briefingReady ? "done" : watchlistReady ? "ready" : "waiting",
      priority: "medium",
      label: "Prepare evidence-cited briefing packet",
      rationale: briefingReady ? `${cycle.stages.briefing.evidenceItems} briefing evidence item(s) prepared.` : "Create public reasoning, risk case, avoid gates, and safer alternatives from the watchlist.",
      expectedEvidence: "Briefing packet includes evidence IDs, public model case, risk case, avoid-if gates, and safer alternatives.",
      verifyUrl: "/api/sports/decision/training/football-provider-live-briefing-packet?date=2026-08-21&dryRun=1",
      command: `curl.exe -s "http://127.0.0.1:3025/api/sports/decision/training/football-provider-live-briefing-packet?date=2026-08-21&dryRun=1"`,
      blockedBy: watchlistReady ? [] : ["positive-EV watchlist candidate"]
    }),
    operation({
      id: "bounded-ai-critique",
      kind: "openai",
      status: aiReviewed ? "done" : cycle.controls.canRequestAIReview ? "ready" : "waiting",
      priority: "medium",
      label: "Run bounded live AI critique",
      rationale: cycle.stages.aiCritique.reviewed ? "AI critique completed through the strict no-side-effects review gate." : cycle.stages.aiCritique.latestReason ?? "AI critique is available only when provider activation and OpenAI key gates are ready.",
      expectedEvidence: "OpenAI review returns strict JSON with allowed evidence IDs, same-or-safer action, and never permissions for publish, persist, train, and stake.",
      verifyUrl: "/api/sports/decision/training/football-provider-live-ai-review?date=2026-08-21&run=1",
      command: cycle.controls.canRequestAIReview ? `curl.exe -s "http://127.0.0.1:3025/api/sports/decision/training/football-provider-live-ai-review?date=2026-08-21&run=1"` : null,
      blockedBy: cycle.controls.canRequestAIReview ? [] : ["provider activation and OpenAI review gate"]
    }),
    operation({
      id: "monitor-evidence-freshness",
      kind: "monitor",
      status: cycle.controls.canUseForMonitor ? "ready" : "waiting",
      priority: "medium",
      label: "Monitor evidence freshness",
      rationale: cycle.controls.canUseForMonitor ? "Cycle can be watched internally while public actions remain locked." : "Monitoring waits until the provider decision cycle is monitor-safe.",
      expectedEvidence: "Cycle stays monitor-only with provider proof, odds, briefing, and AI critique freshness tracked.",
      verifyUrl: "/api/sports/decision/training/football-provider-live-decision-cycle?date=2026-08-21",
      command: `curl.exe -s "http://127.0.0.1:3025/api/sports/decision/training/football-provider-live-decision-cycle?date=2026-08-21"`,
      blockedBy: cycle.controls.canUseForMonitor ? [] : ["monitor-ready decision cycle"]
    }),
    operation({
      id: "store-live-feature-snapshot",
      kind: "storage",
      status: cycle.controls.canWriteLiveFeatureSnapshots ? "ready" : "blocked",
      priority: "low",
      label: "Store provider-backed live feature snapshot",
      rationale: "Storage writes require provider proof, Supabase service-role readiness, run=1, and admin authorization.",
      expectedEvidence: "op_training_feature_snapshots receives split=live rows with pending targets and raw provider payload proof.",
      verifyUrl: "/api/sports/decision/training/football-provider-live-feature-storage-receipt?date=2026-08-21&dryRun=1",
      command: null,
      blockedBy: cycle.controls.canWriteLiveFeatureSnapshots ? [] : ["admin write gate", "Supabase service-role gate", "provider raw payload proof"]
    }),
    operation({
      id: "settle-live-feature-labels",
      kind: "settlement",
      status: "waiting",
      priority: "medium",
      label: "Draft settlement labels from provider final scores",
      rationale: "Stored live feature rows become retest candidates only after provider final scores map to actualOutcome labels.",
      expectedEvidence: "Settlement label receipt reads stored split=live rows, matches provider final scores, drafts actualOutcome labels, and keeps writes admin-gated.",
      verifyUrl: "/api/sports/decision/training/football-provider-live-settlement-label-receipt?dryRun=1&source=epl-2026-opening-live-provider",
      command: `curl.exe -s "http://127.0.0.1:3025/api/sports/decision/training/football-provider-live-settlement-label-receipt?dryRun=1&source=epl-2026-opening-live-provider"`,
      blockedBy: ["provider final score", "settlement label", "admin write gate for persistence"]
    }),
    operation({
      id: "train-publish-stake-lock",
      kind: "safety",
      status: "blocked",
      priority: "critical",
      label: "Keep training, public picks, and staking locked",
      rationale: "Upcoming/live fixtures have no settlement label and cannot train, publish, or stake.",
      expectedEvidence: "Every live operation keeps canTrainModels, canPublishPicks, and canStake false.",
      verifyUrl: "/api/sports/decision/training/football-provider-live-decision-cycle?date=2026-08-21",
      command: null,
      blockedBy: ["pending settlement label", "production governance", "public safety policy"]
    })
  ];
}

export function buildFootballProviderLiveOperationQueue({
  cycle,
  now = new Date()
}: {
  cycle: FootballProviderLiveDecisionCycleReceipt;
  now?: Date;
}): FootballProviderLiveOperationQueue {
  const operations = operationsFor(cycle).sort((a, b) => {
    const statusRank = { blocked: 4, ready: 3, waiting: 2, done: 1 }[b.status] - { blocked: 4, ready: 3, waiting: 2, done: 1 }[a.status];
    if (statusRank !== 0) return statusRank;
    const priorityRank = { critical: 4, high: 3, medium: 2, low: 1 }[b.priority] - { critical: 4, high: 3, medium: 2, low: 1 }[a.priority];
    if (priorityRank !== 0) return priorityRank;
    return a.id.localeCompare(b.id);
  });
  const actionable = operations.find((item) => item.status === "blocked" && item.priority === "critical" && item.id !== "train-publish-stake-lock") ?? operations.find((item) => item.status === "ready") ?? null;
  const totals = {
    ready: operations.filter((item) => item.status === "ready").length,
    waiting: operations.filter((item) => item.status === "waiting").length,
    blocked: operations.filter((item) => item.status === "blocked").length,
    done: operations.filter((item) => item.status === "done").length
  };
  const status = statusFor(cycle, operations);

  return {
    mode: "football-provider-live-operation-queue",
    generatedAt: now.toISOString(),
    status,
    queueHash: stableHash({
      status,
      cycle: cycle.cycleHash,
      operations: operations.map((item) => [item.id, item.status, item.blockedBy])
    }),
    summary: summaryFor(status, actionable),
    target: cycle.target,
    nextOperation: actionable,
    totals,
    operations,
    controls: {
      canInspectReadOnly: true,
      canRunReadOnlyProof: operations.some((item) => item.safeToRun),
      canRequestAIReview: cycle.controls.canRequestAIReview,
      canUseForMonitor: cycle.controls.canUseForMonitor,
      canWriteLiveFeatureSnapshots: cycle.controls.canWriteLiveFeatureSnapshots,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/training/football-provider-live-operation-queue",
      ...cycle.proofUrls,
      ...operations.map((item) => item.verifyUrl)
    ]),
    locks: unique([
      "Live operation queue is read-only and cannot persist decisions, train models, publish picks, stake, or expose hidden chain-of-thought.",
      "Storage writes require the separate storage receipt, admin authorization, and Supabase service-role readiness.",
      "Upcoming EPL rows remain monitor-only until settlement labels exist.",
      ...cycle.locks
    ])
  };
}
