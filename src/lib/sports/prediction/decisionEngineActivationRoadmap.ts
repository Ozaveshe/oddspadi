import type { DecisionLiveDataReadiness } from "@/lib/sports/prediction/decisionLiveDataReadiness";
import type { DecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import type { DecisionOpenAILiveReviewReceipt } from "@/lib/sports/prediction/decisionOpenAILiveReviewReceipt";
import type { DecisionProviderActivationQueue } from "@/lib/sports/prediction/decisionProviderActivationQueue";
import type { DecisionProviderKeyPlanFeed, DecisionProviderKeyPlanLane } from "@/lib/sports/prediction/decisionProviderKeyPlan";
import type { Sport } from "@/lib/sports/types";

export type DecisionEngineActivationRoadmapStatus =
  | "storage-first"
  | "provider-keys-first"
  | "dry-run-ready"
  | "ai-quota-first"
  | "training-data-first"
  | "ready-shadow"
  | "blocked";

export type DecisionEngineActivationRoadmapLaneStatus = "done" | "next" | "blocked" | "locked";

export type DecisionEngineActivationRoadmapLane = {
  id:
    | "supabase-storage"
    | "football-fixtures"
    | "odds-markets"
    | "context-signals"
    | "basketball-core"
    | "tennis-core"
    | "openai-review"
    | "training-corpus"
    | "public-launch";
  label: string;
  status: DecisionEngineActivationRoadmapLaneStatus;
  priority: number;
  percent: number;
  missing: string[];
  unlocks: string[];
  engineImpact: string;
  proofUrl: string;
  command: string | null;
  safeToRun: boolean;
  expectedEvidence: string;
  acceptanceCriteria: string[];
};

export type DecisionEngineActivationRoadmap = {
  mode: "decision-engine-activation-roadmap";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionEngineActivationRoadmapStatus;
  roadmapHash: string;
  summary: string;
  topPriority: DecisionEngineActivationRoadmapLane | null;
  lanes: DecisionEngineActivationRoadmapLane[];
  sequence: Array<{
    step: number;
    laneId: DecisionEngineActivationRoadmapLane["id"];
    label: string;
    action: string;
    proofUrl: string;
  }>;
  readiness: {
    providerQueue: DecisionProviderActivationQueue["status"];
    liveData: DecisionLiveDataReadiness["status"];
    openAi: DecisionOpenAILiveReviewReceipt["status"];
    configuredProviderLanes: number;
    totalCriticalProviderLanes: number;
    missingCriticalKeys: string[];
  };
  controls: {
    canInspectReadOnly: true;
    canRunSelectedDryRun: boolean;
    canWriteProviderRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
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

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function laneStatusFromProvider(lane: DecisionProviderKeyPlanLane): DecisionEngineActivationRoadmapLaneStatus {
  return lane.status === "configured" ? "done" : "blocked";
}

function lanePercentFromProvider(lane: DecisionProviderKeyPlanLane): number {
  return lane.status === "configured" ? 100 : 20;
}

function providerLaneById(queue: DecisionProviderActivationQueue, id: DecisionProviderKeyPlanLane["id"]): DecisionProviderKeyPlanLane | null {
  return queue.providerKeyPlan.lanes.find((lane) => lane.id === id) ?? null;
}

function feedById(queue: DecisionProviderActivationQueue, id: DecisionProviderKeyPlanFeed["id"]): DecisionProviderKeyPlanFeed | null {
  return queue.providerKeyPlan.feedMatrix.rows.find((feed) => feed.id === id) ?? null;
}

function providerLane({
  id,
  label,
  source,
  feed,
  priority,
  command,
  safeToRun,
  engineImpact,
  acceptanceCriteria
}: {
  id: DecisionEngineActivationRoadmapLane["id"];
  label: string;
  source: DecisionProviderKeyPlanLane | null;
  feed: DecisionProviderKeyPlanFeed | null;
  priority: number;
  command: string | null;
  safeToRun: boolean;
  engineImpact: string;
  acceptanceCriteria: string[];
}): DecisionEngineActivationRoadmapLane {
  const status = source ? laneStatusFromProvider(source) : "blocked";
  return {
    id,
    label,
    status,
    priority,
    percent: source ? lanePercentFromProvider(source) : 0,
    missing: unique([...(source?.missing ?? []), ...(feed?.missingKeys ?? [])]),
    unlocks: unique([...(source?.unlocks ?? []), ...(feed?.unlocks ?? [])], 8),
    engineImpact,
    proofUrl: feed?.proofUrl ?? source?.proofUrl ?? "/api/sports/decision/provider-key-plan",
    command,
    safeToRun,
    expectedEvidence: source?.firstMilestone ?? feed?.blockedReason ?? "Provider proof is source-stamped and normalized.",
    acceptanceCriteria
  };
}

function openAiLane({
  diagnostic,
  liveReview
}: {
  diagnostic: DecisionOpenAIKeyDiagnostic;
  liveReview: DecisionOpenAILiveReviewReceipt;
}): DecisionEngineActivationRoadmapLane {
  const ready = liveReview.status === "reviewed" || liveReview.status === "ready-to-request";
  const quotaBlocked = liveReview.status === "quota-or-billing-blocked" || liveReview.status === "rate-or-quota-limited";
  return {
    id: "openai-review",
    label: "OpenAI review",
    status: ready ? "done" : diagnostic.runtime.keyPresent ? "next" : "blocked",
    priority: quotaBlocked ? 3 : 7,
    percent: ready ? 85 : diagnostic.runtime.keyPresent ? 55 : 10,
    missing: diagnostic.runtime.keyPresent ? (quotaBlocked ? ["OpenAI project billing/quota"] : []) : ["OPENAI_API_KEY"],
    unlocks: ["live AI critique", "risk explanation review", "downgrade or needs-evidence checks"],
    engineImpact: "Lets the agent critique the deterministic decision packet without changing probabilities, publishing picks, or exposing hidden chain-of-thought.",
    proofUrl: "/api/sports/decision/openai-live-review-receipt",
    command: diagnostic.nextStep.command,
    safeToRun: diagnostic.nextStep.safeToRun,
    expectedEvidence: liveReview.providerDiagnostic.operatorMessage,
    acceptanceCriteria: [
      "The OpenAI route is invoked only through an explicit guarded run=1 proof.",
      "The response matches the strict safe-review schema.",
      "AI output remains advisory and cannot upgrade avoid or monitor into a public pick."
    ]
  };
}

function storageLane(queue: DecisionProviderActivationQueue, liveDataReadiness: DecisionLiveDataReadiness): DecisionEngineActivationRoadmapLane {
  const storageReady = queue.status !== "needs-supabase-secret" && liveDataReadiness.status !== "blocked-storage";
  return {
    id: "supabase-storage",
    label: "Supabase storage credential",
    status: storageReady ? "done" : "next",
    priority: 1,
    percent: storageReady ? 85 : 35,
    missing: storageReady ? [] : unique([...queue.currentBlocker.missing, "valid SUPABASE_SERVICE_ROLE_KEY"]),
    unlocks: [
      "provider dry-run review",
      "schema manifest proof",
      "stored fixture, odds, feature, and backtest rows after operator approval"
    ],
    engineImpact: "This is the first hard gate for a real prediction engine because provider evidence must land in OddsPadi op_ tables before training can be trusted.",
    proofUrl: queue.currentBlocker.proofUrl || "/api/sports/decision/supabase-credential-activation",
    command: queue.nextItem?.kind === "supabase-credential" ? queue.nextItem.command : null,
    safeToRun: queue.nextItem?.kind === "supabase-credential" ? queue.nextItem.safeToRun : true,
    expectedEvidence: queue.currentBlocker.nextAction,
    acceptanceCriteria: [
      "Server credential verifies the OddsPadi project only.",
      "Credential-error tables drop to zero after the app restarts.",
      "No service-role key is exposed through client env, logs, AI prompts, or browser output."
    ]
  };
}

function trainingLane(queue: DecisionProviderActivationQueue, liveDataReadiness: DecisionLiveDataReadiness): DecisionEngineActivationRoadmapLane {
  const trainingItem = queue.queue.find((item) => item.kind === "ten-year-corpus") ?? null;
  const ready = liveDataReadiness.status === "ready-shadow";
  return {
    id: "training-corpus",
    label: "10-year training corpus",
    status: ready ? "done" : trainingItem?.safeToRun ? "next" : "locked",
    priority: 8,
    percent: ready ? 70 : trainingItem?.safeToRun ? 45 : 15,
    missing: trainingItem?.missing ?? liveDataReadiness.trainingGate.minimumEvidence,
    unlocks: [
      "walk-forward backtests",
      "model-vs-market calibration",
      "learned weights promotion review",
      "shadow memory replay"
    ],
    engineImpact: "Moves the engine from synthetic or diagnostic reasoning into evidence-backed training, calibration, and promotion gates.",
    proofUrl: trainingItem?.verifyUrl ?? "/api/sports/decision/training/ten-year-corpus-execution",
    command: trainingItem?.command ?? null,
    safeToRun: Boolean(trainingItem?.safeToRun),
    expectedEvidence: trainingItem?.expectedEvidence ?? liveDataReadiness.trainingGate.reason,
    acceptanceCriteria: [
      "Historical rows include fixtures, final scores, odds snapshots, feature snapshots, and labels.",
      "Backtests use train/test or walk-forward splits and report market benchmark comparison.",
      "Learned weights stay shadow-only until promotion gates pass."
    ]
  };
}

function launchLane(): DecisionEngineActivationRoadmapLane {
  return {
    id: "public-launch",
    label: "Public launch locks",
    status: "locked",
    priority: 99,
    percent: 10,
    missing: ["provider rows", "backtests", "calibration", "promotion approval"],
    unlocks: ["public monitor language first", "eventual pick publishing only after proof"],
    engineImpact: "Keeps the product honest: public picks cannot unlock from model confidence, AI agreement, or a single dry-run.",
    proofUrl: "/api/sports/decision/answer-promotion-gate",
    command: null,
    safeToRun: false,
    expectedEvidence: "Promotion gate must show provider, storage, market calibration, abstention, backtest, and trust checks passing.",
    acceptanceCriteria: [
      "Publish, train, write, and stake controls remain false until every promotion gate passes.",
      "Public copy explains avoid or monitor decisions without pretending to be a guaranteed bet.",
      "Every pick candidate has source-stamped provider, odds, market, and risk evidence."
    ]
  };
}

function statusFor({
  queue,
  liveDataReadiness,
  liveReview,
  lanes
}: {
  queue: DecisionProviderActivationQueue;
  liveDataReadiness: DecisionLiveDataReadiness;
  liveReview: DecisionOpenAILiveReviewReceipt;
  lanes: DecisionEngineActivationRoadmapLane[];
}): DecisionEngineActivationRoadmapStatus {
  if (queue.status === "needs-supabase-secret" || liveDataReadiness.status === "blocked-storage") return "storage-first";
  if (queue.status === "needs-provider-env") return "provider-keys-first";
  if (queue.status === "ready-dry-run" || lanes.some((lane) => lane.safeToRun && lane.status === "next")) return "dry-run-ready";
  if (liveReview.status === "quota-or-billing-blocked" || liveReview.status === "rate-or-quota-limited") return "ai-quota-first";
  if (liveDataReadiness.status === "needs-provider-rows" || liveDataReadiness.status === "schema-ready-empty") return "training-data-first";
  if (liveDataReadiness.status === "ready-shadow") return "ready-shadow";
  return "blocked";
}

function summaryFor(status: DecisionEngineActivationRoadmapStatus, topPriority: DecisionEngineActivationRoadmapLane | null): string {
  if (status === "storage-first") return "Activation roadmap says the next real-engine unlock is the OddsPadi Supabase server credential; provider data cannot become trusted until storage proof is valid.";
  if (status === "provider-keys-first") return `Activation roadmap is waiting on provider keys; next lane is ${topPriority?.label ?? "provider setup"}.`;
  if (status === "dry-run-ready") return `Activation roadmap has a safe read-only dry-run candidate: ${topPriority?.label ?? "selected provider lane"}.`;
  if (status === "ai-quota-first") return "Activation roadmap is waiting on OpenAI quota or billing for live critique; deterministic logic remains active.";
  if (status === "training-data-first") return "Activation roadmap has schema or dry-run proof, but the model still needs stored provider rows, feature snapshots, and backtests.";
  if (status === "ready-shadow") return "Activation roadmap is ready for shadow evaluation; public publishing and staking remain locked.";
  return "Activation roadmap is blocked by unresolved storage, provider, AI, or training gates.";
}

export function buildDecisionEngineActivationRoadmap({
  date,
  sport,
  providerActivationQueue,
  liveDataReadiness,
  openAiKeyDiagnostic,
  openAiLiveReviewReceipt,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  providerActivationQueue: DecisionProviderActivationQueue;
  liveDataReadiness: DecisionLiveDataReadiness;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  now?: Date;
}): DecisionEngineActivationRoadmap {
  const queue = providerActivationQueue;
  const selected = queue.nextItem;
  const footballLane = providerLaneById(queue, "football-core");
  const oddsLane = providerLaneById(queue, "odds-markets");
  const newsLane = providerLaneById(queue, "news-context");
  const weatherLane = providerLaneById(queue, "weather-context");
  const basketballLane = providerLaneById(queue, "basketball-core");
  const tennisLane = providerLaneById(queue, "tennis-core");
  const lanes: DecisionEngineActivationRoadmapLane[] = [
    storageLane(queue, liveDataReadiness),
    providerLane({
      id: "football-fixtures",
      label: "Football fixtures and events",
      source: footballLane,
      feed: feedById(queue, "fixtures"),
      priority: 2,
      command: selected?.id === "epl-2026-fixture-bridge" ? selected.command : null,
      safeToRun: selected?.id === "epl-2026-fixture-bridge" ? selected.safeToRun : false,
      engineImpact: "Unlocks EPL 2026/27 fixture IDs, kickoff tracking, historical football labels, standings, form, injuries, lineups, live scores, and match events.",
      acceptanceCriteria: [
        "Provider response maps to Premier League league 39 and provider season 2026 for the opening slate.",
        "Dry-run reports fetched and normalized fixture counts without writing rows.",
        "Fixture IDs are source-stamped so odds and news can attach to the same events."
      ]
    }),
    providerLane({
      id: "odds-markets",
      label: "Bookmaker odds markets",
      source: oddsLane,
      feed: feedById(queue, "odds"),
      priority: 3,
      command: selected?.kind === "provider-signal" && selected.id.includes("odds") ? selected.command : null,
      safeToRun: selected?.kind === "provider-signal" && selected.id.includes("odds") ? selected.safeToRun : false,
      engineImpact: "Unlocks implied probability, bookmaker margin removal, no-vig probability, EV, market movement, safer alternatives, and model-vs-market calibration.",
      acceptanceCriteria: [
        "Odds response includes decimal prices, bookmaker identity, market, selection, event ID, and snapshot timestamp.",
        "No-vig probabilities and value edge are calculated from real bookmaker rows.",
        "Odds snapshots are reviewed before any write-mode storage."
      ]
    }),
    providerLane({
      id: "context-signals",
      label: "News, injuries, lineups, and weather",
      source: newsLane?.status === "missing" ? newsLane : weatherLane,
      feed: feedById(queue, "news") ?? feedById(queue, "weather"),
      priority: 5,
      command: null,
      safeToRun: false,
      engineImpact: "Unlocks injury/news adjustments, lineup confirmation, football-weather risk, and abstention reasons for late uncertainty.",
      acceptanceCriteria: [
        "Each news or weather signal includes source URL, timestamp, team/player/event mapping, and freshness window.",
        "Missing context lowers confidence or triggers avoid/monitor language instead of being treated as neutral.",
        "Weather is only required where venue and sport make it relevant."
      ]
    }),
    providerLane({
      id: "basketball-core",
      label: "Basketball data core",
      source: basketballLane,
      feed: feedById(queue, "basketball-efficiency"),
      priority: 6,
      command: null,
      safeToRun: false,
      engineImpact: "Unlocks pace, offensive/defensive efficiency, rest days, spreads, moneyline logic, and basketball backtests.",
      acceptanceCriteria: [
        "Basketball fixtures, box-score/team efficiency, odds, and rest-day features are source-stamped.",
        "Spread and moneyline predictions are evaluated separately.",
        "Recent injuries affect projections only when source-stamped."
      ]
    }),
    providerLane({
      id: "tennis-core",
      label: "Tennis data core",
      source: tennisLane,
      feed: feedById(queue, "tennis-player-history"),
      priority: 7,
      command: null,
      safeToRun: false,
      engineImpact: "Unlocks player Elo, surface ratings, head-to-head, fatigue, tournament round, injury/news signals, and tennis backtests.",
      acceptanceCriteria: [
        "Tennis rows include player IDs, surface, tournament, round, result, and odds where available.",
        "Surface Elo and fatigue are computed from historical rows, not hard-coded assumptions.",
        "Head-to-head is explanatory, not allowed to overpower calibration by itself."
      ]
    }),
    openAiLane({ diagnostic: openAiKeyDiagnostic, liveReview: openAiLiveReviewReceipt }),
    trainingLane(queue, liveDataReadiness),
    launchLane()
  ];
  const topPriority = lanes
    .filter((lane) => lane.status === "next" || lane.status === "blocked")
    .sort((a, b) => a.priority - b.priority || b.percent - a.percent)[0] ?? null;
  const status = statusFor({
    queue,
    liveDataReadiness,
    liveReview: openAiLiveReviewReceipt,
    lanes
  });
  const sequence = lanes
    .filter((lane) => lane.status !== "done")
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 6)
    .map((lane, index) => ({
      step: index + 1,
      laneId: lane.id,
      label: lane.label,
      action: lane.missing.length ? `Resolve ${lane.missing[0]}.` : lane.expectedEvidence,
      proofUrl: lane.proofUrl
    }));
  const roadmapHash = stableHash({
    date,
    sport,
    status,
    queue: queue.queueHash,
    liveData: liveDataReadiness.readinessHash,
    openAi: openAiLiveReviewReceipt.receiptHash,
    lanes: lanes.map((lane) => [lane.id, lane.status, lane.percent, lane.missing, lane.safeToRun])
  });

  return {
    mode: "decision-engine-activation-roadmap",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    roadmapHash,
    summary: summaryFor(status, topPriority),
    topPriority,
    lanes,
    sequence,
    readiness: {
      providerQueue: queue.status,
      liveData: liveDataReadiness.status,
      openAi: openAiLiveReviewReceipt.status,
      configuredProviderLanes: queue.providerKeyPlan.configuredCriticalLanes,
      totalCriticalProviderLanes: queue.providerKeyPlan.totalCriticalLanes,
      missingCriticalKeys: queue.providerKeyPlan.missingCriticalKeys
    },
    controls: {
      canInspectReadOnly: true,
      canRunSelectedDryRun: Boolean(topPriority?.safeToRun),
      canWriteProviderRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/activation-roadmap",
      "/api/sports/decision/provider-activation-queue",
      "/api/sports/decision/provider-activation-queue-receipt",
      "/api/sports/decision/provider-key-plan",
      "/api/sports/decision/live-data-readiness",
      "/api/sports/decision/openai-live-review-receipt",
      ...lanes.map((lane) => lane.proofUrl),
      ...queue.proofUrls,
      ...liveDataReadiness.proofUrls,
      ...openAiLiveReviewReceipt.proofUrls
    ]),
    locks: unique([
      "Activation roadmap is read-only; it cannot write provider rows, train models, publish picks, stake, or upgrade public action.",
      "A configured key or safe dry-run only unlocks evidence collection, not model authority.",
      "Provider rows must be stored, feature-snapshotted, backtested, calibrated, and promotion-gated before any learned behavior can influence public picks.",
      "AI review can critique or downgrade but cannot override storage, market, abstention, or historical discipline gates.",
      ...queue.locks,
      ...liveDataReadiness.locks,
      ...openAiLiveReviewReceipt.locks
    ])
  };
}
