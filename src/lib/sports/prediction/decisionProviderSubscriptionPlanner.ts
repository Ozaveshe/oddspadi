import type { DecisionProviderActivationQueue } from "@/lib/sports/prediction/decisionProviderActivationQueue";
import type { DecisionProviderKeyPlan } from "@/lib/sports/prediction/decisionProviderKeyPlan";
import type { Sport } from "@/lib/sports/types";

type EnvMap = Record<string, string | undefined>;

export type DecisionApiFootballPlanId = "free" | "pro" | "ultra" | "mega";
export type DecisionOddsApiPlanId = "free" | "20k" | "100k" | "5m" | "15m";
export type DecisionProviderSubscriptionPlannerStatus =
  | "ready-controlled-dry-runs"
  | "waiting-paid-odds"
  | "waiting-football-plan"
  | "quota-risk"
  | "storage-held";
export type DecisionProviderSubscriptionPlannerOperationStatus = "ready" | "waiting-plan" | "quota-risk" | "storage-held" | "locked";

export type DecisionProviderSubscriptionPlannerOperation = {
  id:
    | "epl-opening-fixtures"
    | "epl-opening-odds"
    | "fixture-context-refresh"
    | "historical-football-window"
    | "odds-history-window"
    | "basketball-tennis-preview"
    | "lineup-injury-refresh"
    | "closing-line-validation";
  label: string;
  status: DecisionProviderSubscriptionPlannerOperationStatus;
  priority: number;
  sport: Sport | "all";
  provider: "api-football" | "the-odds-api" | "both";
  cadence: "once" | "hourly" | "daily" | "backfill";
  estimatedApiFootballCalls: number;
  estimatedOddsCredits: number;
  verifyUrl: string;
  reason: string;
  expectedEvidence: string;
  blocks: string[];
};

export type DecisionProviderSubscriptionPlanner = {
  mode: "provider-subscription-planner";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionProviderSubscriptionPlannerStatus;
  plannerHash: string;
  summary: string;
  selectedPlans: {
    apiFootball: {
      id: DecisionApiFootballPlanId;
      label: string;
      dailyRequests: number;
      configured: boolean;
      recommended: DecisionApiFootballPlanId;
    };
    oddsApi: {
      id: DecisionOddsApiPlanId;
      label: string;
      monthlyCredits: number;
      estimatedDailyCredits: number;
      configured: boolean;
      recommended: DecisionOddsApiPlanId;
    };
  };
  quota: {
    estimatedApiFootballDaily: number;
    estimatedOddsDaily: number;
    apiFootballHeadroom: number;
    oddsDailyHeadroom: number;
    apiFootballUtilization: number;
    oddsUtilization: number;
  };
  decision: {
    firstPaidMove: string;
    firstEngineeringMove: string;
    why: string;
    riskIfUnderfunded: string;
  };
  operations: DecisionProviderSubscriptionPlannerOperation[];
  nextOperation: DecisionProviderSubscriptionPlannerOperation | null;
  checkout: Array<{
    provider: "API-Football" | "The Odds API" | "Sportmonks" | "Sportradar/Opta";
    action: "pay-now" | "defer" | "enterprise-later";
    plan: string;
    reason: string;
  }>;
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canBackfillHistoricalRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  locks: string[];
  proofUrls: string[];
};

const API_FOOTBALL_PLANS: Record<DecisionApiFootballPlanId, { label: string; dailyRequests: number }> = {
  free: { label: "Free", dailyRequests: 100 },
  pro: { label: "Pro", dailyRequests: 7500 },
  ultra: { label: "Ultra", dailyRequests: 75000 },
  mega: { label: "Mega", dailyRequests: 150000 }
};

const ODDS_API_PLANS: Record<DecisionOddsApiPlanId, { label: string; monthlyCredits: number }> = {
  free: { label: "Starter", monthlyCredits: 500 },
  "20k": { label: "20K", monthlyCredits: 20000 },
  "100k": { label: "100K", monthlyCredits: 100000 },
  "5m": { label: "5M", monthlyCredits: 5000000 },
  "15m": { label: "15M", monthlyCredits: 15000000 }
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

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function normalizeApiFootballPlan(value: string | null | undefined): DecisionApiFootballPlanId {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "pro" || normalized === "ultra" || normalized === "mega") return normalized;
  return "free";
}

function normalizeOddsPlan(value: string | null | undefined): DecisionOddsApiPlanId {
  const normalized = value?.trim().toLowerCase().replaceAll("_", "").replaceAll("-", "");
  if (normalized === "20k" || normalized === "20000") return "20k";
  if (normalized === "100k" || normalized === "100000") return "100k";
  if (normalized === "5m" || normalized === "5000000") return "5m";
  if (normalized === "15m" || normalized === "15000000") return "15m";
  return "free";
}

function hasAny(env: EnvMap, keys: string[]): boolean {
  return keys.some((key) => {
    const value = env[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

function pct(used: number, limit: number): number {
  if (limit <= 0) return 1;
  return Math.min(1, Math.round((used / limit) * 1000) / 1000);
}

function statusRank(status: DecisionProviderSubscriptionPlannerOperationStatus): number {
  if (status === "ready") return 0;
  if (status === "waiting-plan") return 1;
  if (status === "quota-risk") return 2;
  if (status === "storage-held") return 3;
  return 4;
}

function operation(input: Omit<DecisionProviderSubscriptionPlannerOperation, "blocks" | "status"> & {
  blocks?: string[];
  storageHeld: boolean;
  apiFootballReady: boolean;
  oddsReady: boolean;
  apiFootballQuotaOk: boolean;
  oddsQuotaOk: boolean;
}): DecisionProviderSubscriptionPlannerOperation {
  const needsApiFootball = input.provider === "api-football" || input.provider === "both";
  const needsOdds = input.provider === "the-odds-api" || input.provider === "both";
  const blocks = unique([
    ...(input.blocks ?? []),
    input.storageHeld ? "storage proof held" : "",
    needsApiFootball && !input.apiFootballReady ? "API-Football paid/key readiness" : "",
    needsOdds && !input.oddsReady ? "The Odds API paid/key readiness" : "",
    needsApiFootball && !input.apiFootballQuotaOk ? "API-Football quota headroom" : "",
    needsOdds && !input.oddsQuotaOk ? "The Odds API credit headroom" : ""
  ]);
  const status: DecisionProviderSubscriptionPlannerOperationStatus = input.storageHeld
    ? "storage-held"
    : needsApiFootball && !input.apiFootballReady
      ? "waiting-plan"
      : needsOdds && !input.oddsReady
        ? "waiting-plan"
        : (needsApiFootball && !input.apiFootballQuotaOk) || (needsOdds && !input.oddsQuotaOk)
          ? "quota-risk"
          : "ready";

  return {
    id: input.id,
    label: input.label,
    status,
    priority: input.priority,
    sport: input.sport,
    provider: input.provider,
    cadence: input.cadence,
    estimatedApiFootballCalls: input.estimatedApiFootballCalls,
    estimatedOddsCredits: input.estimatedOddsCredits,
    verifyUrl: input.verifyUrl,
    reason: input.reason,
    expectedEvidence: input.expectedEvidence,
    blocks
  };
}

function statusFor({
  storageHeld,
  apiFootballPlan,
  oddsPlan,
  apiFootballReady,
  oddsReady,
  apiFootballQuotaOk,
  oddsQuotaOk
}: {
  storageHeld: boolean;
  apiFootballPlan: DecisionApiFootballPlanId;
  oddsPlan: DecisionOddsApiPlanId;
  apiFootballReady: boolean;
  oddsReady: boolean;
  apiFootballQuotaOk: boolean;
  oddsQuotaOk: boolean;
}): DecisionProviderSubscriptionPlannerStatus {
  if (storageHeld) return "storage-held";
  if (!apiFootballReady || apiFootballPlan === "free") return "waiting-football-plan";
  if (!oddsReady || oddsPlan === "free" || oddsPlan === "20k") return "waiting-paid-odds";
  if (!apiFootballQuotaOk || !oddsQuotaOk) return "quota-risk";
  return "ready-controlled-dry-runs";
}

function summaryFor(status: DecisionProviderSubscriptionPlannerStatus): string {
  if (status === "ready-controlled-dry-runs") return "Paid-provider plan is ready for controlled read-only dry-runs before storage or training can unlock.";
  if (status === "waiting-paid-odds") return "Provider plan is waiting on enough Odds API credits for market-prior, value-edge, and CLV work.";
  if (status === "waiting-football-plan") return "Provider plan is waiting on a paid API-Football tier before the football corpus can move beyond tiny probes.";
  if (status === "quota-risk") return "Selected plans may work for one-off probes, but estimated daily/backfill use risks exhausting provider quota.";
  return "Subscription plan is held by storage proof; do not pay for extra provider volume until storage is trusted.";
}

export function buildDecisionProviderSubscriptionPlanner({
  date,
  sport,
  providerActivationQueue,
  providerKeyPlan,
  apiFootballPlan,
  oddsApiPlan,
  env = process.env,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  providerActivationQueue: DecisionProviderActivationQueue;
  providerKeyPlan: DecisionProviderKeyPlan;
  apiFootballPlan?: string | null;
  oddsApiPlan?: string | null;
  env?: EnvMap;
  now?: Date;
}): DecisionProviderSubscriptionPlanner {
  const apiPlanId = normalizeApiFootballPlan(apiFootballPlan ?? env.ODDSPADI_API_FOOTBALL_PLAN);
  const oddsPlanId = normalizeOddsPlan(oddsApiPlan ?? env.ODDSPADI_ODDS_API_PLAN);
  const apiPlan = API_FOOTBALL_PLANS[apiPlanId];
  const oddsPlan = ODDS_API_PLANS[oddsPlanId];
  const oddsDaily = Math.floor(oddsPlan.monthlyCredits / 31);
  const footballKeyConfigured = hasAny(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
  const oddsKeyConfigured = hasAny(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]);
  const storageHeld = providerActivationQueue.status === "needs-supabase-secret";
  const apiFootballReady = footballKeyConfigured && apiPlanId !== "free";
  const oddsReady = oddsKeyConfigured && oddsPlanId !== "free" && oddsPlanId !== "20k";
  const estimatedApiFootballDaily = 1240;
  const estimatedOddsDaily = 1850;
  const apiFootballQuotaOk = apiPlan.dailyRequests >= estimatedApiFootballDaily;
  const oddsQuotaOk = oddsDaily >= estimatedOddsDaily;
  const common = {
    storageHeld,
    apiFootballReady,
    oddsReady,
    apiFootballQuotaOk,
    oddsQuotaOk
  };
  const operations = [
    operation({
      id: "epl-opening-fixtures",
      label: "Map EPL 2026/27 opening fixtures from API-Football",
      priority: 1,
      sport: "football",
      provider: "api-football",
      cadence: "once",
      estimatedApiFootballCalls: 45,
      estimatedOddsCredits: 0,
      verifyUrl: "/api/sports/decision/epl-provider-dry-run-receipt?run=1&dryRun=1",
      reason: "The first paid-provider proof must attach real league 39 fixture IDs before odds, lineups, injuries, or event history can join.",
      expectedEvidence: "Provider status, fetched fixtures, normalized rows, league 39, season 2026, dryRun=true, and zero stored rows.",
      ...common
    }),
    operation({
      id: "epl-opening-odds",
      label: "Attach opening EPL bookmaker odds from The Odds API",
      priority: 2,
      sport: "football",
      provider: "the-odds-api",
      cadence: "once",
      estimatedApiFootballCalls: 0,
      estimatedOddsCredits: 120,
      verifyUrl: "/api/sports/decision/epl-odds-dry-run-receipt?run=1&dryRun=1",
      reason: "Odds are the money feature: implied probability, margin removal, value edge, and no-vig market baseline all depend on bookmaker prices.",
      expectedEvidence: "Fetched events, normalized odds rows, bookmaker market IDs, dryRun=true, and no odds snapshot writes.",
      ...common
    }),
    operation({
      id: "fixture-context-refresh",
      label: "Daily football fixture, standings, form, and events refresh",
      priority: 3,
      sport: "football",
      provider: "api-football",
      cadence: "daily",
      estimatedApiFootballCalls: 320,
      estimatedOddsCredits: 0,
      verifyUrl: "/api/sports/decision/provider-batch-manifest",
      reason: "The model needs fresh standings, home/away context, recent form, and event status before explaining any pre-match edge.",
      expectedEvidence: "Read-only provider batches covering fixtures, standings, teams, events, and form-linked target tables.",
      ...common
    }),
    operation({
      id: "lineup-injury-refresh",
      label: "Lineup, injury, and suspension refresh near kickoff",
      priority: 4,
      sport: "football",
      provider: "api-football",
      cadence: "hourly",
      estimatedApiFootballCalls: 850,
      estimatedOddsCredits: 0,
      verifyUrl: "/api/sports/decision/context-signal-proof",
      reason: "Late availability is where model probabilities should move down or abstain, not blindly promote early edges.",
      expectedEvidence: "Source-stamped lineup/injury/sidelined context and explicit avoid/hold flags for unresolved news.",
      ...common
    }),
    operation({
      id: "historical-football-window",
      label: "Backfill 10-year football fixture/result window",
      priority: 5,
      sport: "football",
      provider: "api-football",
      cadence: "backfill",
      estimatedApiFootballCalls: 4200,
      estimatedOddsCredits: 0,
      verifyUrl: "/api/sports/decision/training/ten-year-corpus-execution?sport=football",
      reason: "Poisson, Elo, home advantage, and recent-form weights need settled historical labels before they can challenge market priors.",
      expectedEvidence: "Dry-run job counts, target tables, season window, expected fixture rows, and zero training writes.",
      ...common
    }),
    operation({
      id: "odds-history-window",
      label: "Backfill historical odds windows for market benchmark",
      priority: 6,
      sport: "football",
      provider: "the-odds-api",
      cadence: "backfill",
      estimatedApiFootballCalls: 0,
      estimatedOddsCredits: 1400,
      verifyUrl: "/api/sports/decision/training/football-data-market-consensus",
      reason: "The engine needs no-vig market consensus and closing-line value to know when the model is actually beating prices.",
      expectedEvidence: "Historical odds coverage counts, no-vig consensus rows, market benchmark readiness, and CLV gaps.",
      ...common
    }),
    operation({
      id: "basketball-tennis-preview",
      label: "Hold basketball and tennis provider expansion behind football proof",
      priority: 7,
      sport: "all",
      provider: "both",
      cadence: "daily",
      estimatedApiFootballCalls: 0,
      estimatedOddsCredits: 180,
      verifyUrl: "/api/sports/decision/training/multi-sport-corpus-plan",
      reason: "Basketball and tennis matter, but the first paid spend should prove football core plus odds intelligence before expanding feeds.",
      expectedEvidence: "Multi-sport plan stays shadow-only and lists missing sport-specific providers without consuming paid football quota.",
      blocks: ["sport-specific basketball/tennis provider not purchased yet"],
      ...common
    }),
    operation({
      id: "closing-line-validation",
      label: "Measure closing-line value before any public-confidence upgrade",
      priority: 8,
      sport: "football",
      provider: "the-odds-api",
      cadence: "daily",
      estimatedApiFootballCalls: 0,
      estimatedOddsCredits: 150,
      verifyUrl: "/api/sports/decision/odds-intelligence-proof",
      reason: "Backtest yield is not enough; the engine must show it beats or avoids adverse market movement before trusting value picks.",
      expectedEvidence: "Opening odds, latest/closing odds, no-vig movement, CLV estimate, and public-action lock if CLV is missing.",
      ...common
    })
  ].sort((a, b) => statusRank(a.status) - statusRank(b.status) || a.priority - b.priority);
  const status = statusFor({
    storageHeld,
    apiFootballPlan: apiPlanId,
    oddsPlan: oddsPlanId,
    apiFootballReady,
    oddsReady,
    apiFootballQuotaOk,
    oddsQuotaOk
  });
  const nextOperation = operations.find((item) => item.status === "ready") ?? operations[0] ?? null;
  const plannerHash = stableHash({
    date,
    sport,
    status,
    apiPlanId,
    oddsPlanId,
    keys: [footballKeyConfigured, oddsKeyConfigured],
    queue: providerActivationQueue.queueHash,
    keyPlan: [providerKeyPlan.status, providerKeyPlan.missingCriticalKeys],
    operations: operations.map((item) => [item.id, item.status, item.estimatedApiFootballCalls, item.estimatedOddsCredits])
  });

  return {
    mode: "provider-subscription-planner",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    plannerHash,
    summary: summaryFor(status),
    selectedPlans: {
      apiFootball: {
        id: apiPlanId,
        label: apiPlan.label,
        dailyRequests: apiPlan.dailyRequests,
        configured: footballKeyConfigured,
        recommended: "ultra"
      },
      oddsApi: {
        id: oddsPlanId,
        label: oddsPlan.label,
        monthlyCredits: oddsPlan.monthlyCredits,
        estimatedDailyCredits: oddsDaily,
        configured: oddsKeyConfigured,
        recommended: "100k"
      }
    },
    quota: {
      estimatedApiFootballDaily,
      estimatedOddsDaily,
      apiFootballHeadroom: apiPlan.dailyRequests - estimatedApiFootballDaily,
      oddsDailyHeadroom: oddsDaily - estimatedOddsDaily,
      apiFootballUtilization: pct(estimatedApiFootballDaily, apiPlan.dailyRequests),
      oddsUtilization: pct(estimatedOddsDaily, oddsDaily)
    },
    decision: {
      firstPaidMove: "Buy API-Football Ultra and The Odds API 100K before any extra data provider subscription.",
      firstEngineeringMove: nextOperation?.verifyUrl ?? "/api/sports/decision/provider-subscription-planner",
      why: "Ultra gives enough football request headroom for EPL fixture/context/history work, while Odds 100K gives enough daily credits for odds intelligence and CLV probes without jumping to enterprise spend.",
      riskIfUnderfunded:
        "Free/low odds tiers may pass one demo call but fail once we poll multiple markets, bookmaker regions, historical windows, and closing-line snapshots."
    },
    operations,
    nextOperation,
    checkout: [
      {
        provider: "API-Football",
        action: "pay-now",
        plan: "Ultra",
        reason: "Needed for fixture, standings, lineups, injuries, events, and 10-year football corpus dry-runs."
      },
      {
        provider: "The Odds API",
        action: "pay-now",
        plan: "100K",
        reason: "Needed for implied probability, no-vig margin removal, EV ranking, market benchmark, and closing-line value."
      },
      {
        provider: "Sportmonks",
        action: "defer",
        plan: "Growth/Pro plus add-ons later",
        reason: "Useful for richer football/xG/expected-lineup depth after the first API-Football plus odds pipeline proves gaps."
      },
      {
        provider: "Sportradar/Opta",
        action: "enterprise-later",
        plan: "Sales-led",
        reason: "Excellent data, but too expensive and procurement-heavy for MVP proof."
      }
    ],
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun: status === "ready-controlled-dry-runs" && providerActivationQueue.controls.canRunDryRun,
      canWriteProviderRows: false,
      canBackfillHistoricalRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: unique([
      "Subscription planner never prints keys, writes secrets, fetches providers, writes Supabase rows, trains models, publishes picks, or stakes.",
      "A paid plan only unlocks read-only dry-run review until storage proof, admin receipts, normalized counts, and model governance pass.",
      "API-Football and The Odds API are the first spend because they map directly to fixtures/context and odds intelligence.",
      "Sportmonks, Sportradar, and Opta stay deferred until current provider coverage gaps are proven by receipts.",
      ...providerActivationQueue.locks
    ]),
    proofUrls: unique([
      "/api/sports/decision/provider-subscription-planner",
      "/api/sports/decision/provider-activation-queue",
      "/api/sports/decision/provider-key-plan",
      "/api/sports/decision/epl-provider-dry-run-receipt",
      "/api/sports/decision/epl-odds-dry-run-receipt",
      "/api/sports/decision/training/ten-year-corpus-execution",
      ...providerActivationQueue.proofUrls
    ])
  };
}
