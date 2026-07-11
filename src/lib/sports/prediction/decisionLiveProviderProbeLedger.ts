import { hasAnyConfiguredEnv } from "@/lib/env";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import { syncHistoricalFootballProvider, type ProviderName, type ProviderSyncRequest, type ProviderSyncResult } from "@/lib/sports/training/providerSync";
import type { Sport } from "@/lib/sports/types";

type EnvMap = Record<string, string | undefined>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type SyncImpl = (input: { request: ProviderSyncRequest; env?: EnvMap; fetchImpl?: FetchLike }) => Promise<ProviderSyncResult>;

export type DecisionLiveProviderProbeStatus = "not-requested" | "admin-required" | "missing-env" | "probe-ready" | "probe-passed" | "provider-warning" | "provider-error";
export type DecisionLiveProviderProbeLaneId = "football-core" | "football-odds" | "basketball-core" | "tennis-core";
export type DecisionLiveProviderProbeLaneStatus = "not-requested" | "admin-required" | "missing-env" | "ready-to-run" | "passed" | "warning" | "error";

export type DecisionLiveProviderProbeLane = {
  id: DecisionLiveProviderProbeLaneId;
  label: string;
  sport: Sport;
  provider: ProviderName;
  status: DecisionLiveProviderProbeLaneStatus;
  configured: boolean;
  requiredEnv: string[];
  missingEnv: string[];
  request: ProviderSyncRequest;
  command: string;
  safeToRun: boolean;
  runAttempted: boolean;
  result: {
    syncStatus: ProviderSyncResult["status"] | "not-run";
    fetched: number;
    normalized: number;
    endpoint: string | null;
    reason: string | null;
  };
  unlocks: string;
  nextAction: string;
};

export type DecisionLiveProviderProbeLedger = {
  mode: "decision-live-provider-probe-ledger";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionLiveProviderProbeStatus;
  ledgerHash: string;
  summary: string;
  runRequested: boolean;
  adminAuthorized: boolean;
  lanes: DecisionLiveProviderProbeLane[];
  nextLane: DecisionLiveProviderProbeLane | null;
  totals: {
    lanes: number;
    configured: number;
    missingEnv: number;
    readyToRun: number;
    passed: number;
    warning: number;
    error: number;
    fetched: number;
    normalized: number;
  };
  controls: {
    canInspectReadOnly: true;
    canRunDryRun: boolean;
    requiresRunParam: true;
    requiresAdminToken: true;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrain: false;
    canPublish: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  locks: string[];
  proofUrls: string[];
};

const LANES: Array<{
  id: DecisionLiveProviderProbeLaneId;
  label: string;
  sport: Sport;
  provider: ProviderName;
  requiredEnv: string[];
  request: ProviderSyncRequest;
  unlocks: string;
}> = [
  {
    id: "football-core",
    label: "Football fixtures and context",
    sport: "football",
    provider: "api-football",
    requiredEnv: ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
    request: {
      provider: "api-football",
      dryRun: true,
      league: "39",
      season: "2026",
      from: "2026-08-21",
      to: "2026-08-24",
      includeContext: true,
      includeStandings: true,
      includeAvailability: true,
      includeLineups: true,
      includeEvents: false,
      includeNews: false,
      includeWeather: false,
      limit: 5
    },
    unlocks: "EPL 2026/27 fixtures, provider event IDs, standings, availability, and lineup dry-run evidence."
  },
  {
    id: "football-odds",
    label: "Football bookmaker odds",
    sport: "football",
    provider: "the-odds-api",
    requiredEnv: ["THE_ODDS_API_KEY", "ODDS_API_KEY"],
    request: {
      provider: "the-odds-api",
      dryRun: true,
      sportKey: "soccer_epl",
      regions: "uk,eu",
      limit: 25
    },
    unlocks: "Live/upcoming bookmaker prices for no-vig probability, edge, EV, market movement, and CLV checks."
  },
  {
    id: "basketball-core",
    label: "Basketball games",
    sport: "basketball",
    provider: "api-basketball",
    requiredEnv: ["API_BASKETBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
    request: {
      provider: "api-basketball",
      dryRun: true,
      season: "2025-2026",
      date: "2026-08-21",
      limit: 5
    },
    unlocks: "Basketball schedule/results evidence for team rating, pace, offensive efficiency, defensive efficiency, and rest-day models."
  },
  {
    id: "tennis-core",
    label: "Tennis events",
    sport: "tennis",
    provider: "api-tennis",
    requiredEnv: ["API_TENNIS_KEY", "SPORTS_API_KEY"],
    request: {
      provider: "api-tennis",
      dryRun: true,
      date: "2026-08-21",
      limit: 5
    },
    unlocks: "Tennis event evidence for player Elo, surface rating, fatigue, tournament round, and head-to-head context."
  }
];

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function hasAnyEnv(env: EnvMap, keys: string[]): boolean {
  return hasAnyConfiguredEnv(env, keys);
}

function missingEnv(env: EnvMap, keys: string[]): string[] {
  return hasAnyEnv(env, keys) ? [] : [keys.join(" or ")];
}

function routeForLane(lane: (typeof LANES)[number]): string {
  const query = new URLSearchParams();
  query.set("provider", lane.provider);
  query.set("dryRun", "1");
  query.set("limit", String(lane.request.limit ?? 5));
  if (lane.request.league) query.set("league", lane.request.league);
  if (lane.request.season) query.set("season", lane.request.season);
  if (lane.request.date) query.set("date", lane.request.date);
  if (lane.request.from) query.set("from", lane.request.from);
  if (lane.request.to) query.set("to", lane.request.to);
  if (lane.request.sportKey) query.set("sportKey", lane.request.sportKey);
  if (lane.request.regions) query.set("regions", lane.request.regions);
  if (lane.request.bookmakers) query.set("bookmakers", lane.request.bookmakers);
  if (lane.request.includeContext) query.set("includeContext", "1");
  if (lane.request.includeStandings) query.set("includeStandings", "1");
  if (lane.request.includeAvailability) query.set("includeAvailability", "1");
  if (lane.request.includeLineups) query.set("includeLineups", "1");
  if (lane.request.includeEvents) query.set("includeEvents", "1");
  if (lane.request.includeNews) query.set("includeNews", "1");
  if (lane.request.includeWeather) query.set("includeWeather", "1");
  return `/api/sports/decision/training/provider-sync?${query.toString()}`;
}

function laneStatus({
  configured,
  runRequested,
  adminAuthorized,
  result
}: {
  configured: boolean;
  runRequested: boolean;
  adminAuthorized: boolean;
  result: ProviderSyncResult | null;
}): DecisionLiveProviderProbeLaneStatus {
  if (!configured) return "missing-env";
  if (!runRequested) return "not-requested";
  if (!adminAuthorized) return "admin-required";
  if (!result) return "ready-to-run";
  if (result.status === "dry-run" && result.normalized > 0) return "passed";
  if (result.status === "dry-run" || result.status === "stored") return "warning";
  return "error";
}

function resultSummary(result: ProviderSyncResult | null): DecisionLiveProviderProbeLane["result"] {
  return {
    syncStatus: result?.status ?? "not-run",
    fetched: result?.fetched ?? 0,
    normalized: result?.normalized ?? 0,
    endpoint: result?.endpoint ?? null,
    reason: result?.reason ?? null
  };
}

function nextActionFor(status: DecisionLiveProviderProbeLaneStatus, lane: (typeof LANES)[number], result: ProviderSyncResult | null): string {
  if (status === "passed") return "Inspect normalized rows and keep write mode locked until storage proof and admin approval pass.";
  if (status === "warning") return result?.reason ?? "Provider responded, but normalized row counts need review before trust can rise.";
  if (status === "error") return result?.reason ?? "Fix provider credentials, quota, request parameters, or response normalization.";
  if (status === "admin-required") return "Call the probe with run=1 and x-oddspadi-admin-token after confirming dry-run intent.";
  if (status === "not-requested") return "Use the ledger run endpoint to execute this dry-run probe when ready.";
  if (status === "ready-to-run") return "Run the server-only provider-sync dry-run command and inspect fetched/normalized counts.";
  return `Configure ${lane.requiredEnv.join(" or ")} before this provider can be probed.`;
}

function ledgerStatus(lanes: DecisionLiveProviderProbeLane[], runRequested: boolean, adminAuthorized: boolean): DecisionLiveProviderProbeStatus {
  if (lanes.some((lane) => lane.status === "error")) return "provider-error";
  if (lanes.some((lane) => lane.status === "passed") && lanes.some((lane) => lane.status === "warning")) return "provider-warning";
  if (lanes.some((lane) => lane.status === "passed")) return "probe-passed";
  if (lanes.some((lane) => lane.status === "missing-env")) return "missing-env";
  if (runRequested && !adminAuthorized) return "admin-required";
  if (lanes.some((lane) => lane.status === "ready-to-run")) return "probe-ready";
  return "not-requested";
}

function summaryFor(status: DecisionLiveProviderProbeStatus, totals: DecisionLiveProviderProbeLedger["totals"]): string {
  if (status === "probe-passed") return `${totals.passed} live provider dry-run lane(s) returned normalized rows; writes, training, publishing, and staking remain locked.`;
  if (status === "provider-warning") return "At least one provider dry-run responded, but counts or normalization need review before trust can rise.";
  if (status === "provider-error") return `${totals.error} provider dry-run lane(s) failed and must be fixed before real-data activation.`;
  if (status === "admin-required") return "Live provider probes require run=1 plus the server-only admin token.";
  if (status === "probe-ready") return `${totals.readyToRun} provider lane(s) have keys and can run read-only dry-runs.`;
  if (status === "missing-env") return `${totals.missingEnv} provider lane(s) are missing server-only provider keys.`;
  return "Live provider probe ledger is in preview mode; no provider network calls were made.";
}

export async function buildDecisionLiveProviderProbeLedger({
  date,
  sport,
  env = process.env,
  runRequested = false,
  adminAuthorized = false,
  fetchImpl = fetch,
  syncImpl = syncHistoricalFootballProvider,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  env?: EnvMap;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  fetchImpl?: FetchLike;
  syncImpl?: SyncImpl;
  now?: Date;
}): Promise<DecisionLiveProviderProbeLedger> {
  const lanes = await Promise.all(
    LANES.map(async (lane): Promise<DecisionLiveProviderProbeLane> => {
      const configured = hasAnyEnv(env, lane.requiredEnv);
      const shouldRun = configured && runRequested && adminAuthorized;
      const result = shouldRun ? await syncImpl({ request: lane.request, env, fetchImpl }) : null;
      const status = laneStatus({ configured, runRequested, adminAuthorized, result });
      const route = routeForLane(lane);
      return {
        id: lane.id,
        label: lane.label,
        sport: lane.sport,
        provider: lane.provider,
        status,
        configured,
        requiredEnv: lane.requiredEnv,
        missingEnv: missingEnv(env, lane.requiredEnv),
        request: lane.request,
        command: `${decisionCurlCommand(route)} -X POST -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`,
        safeToRun: configured && !shouldRun,
        runAttempted: shouldRun,
        result: resultSummary(result),
        unlocks: lane.unlocks,
        nextAction: nextActionFor(status, lane, result)
      };
    })
  );
  const totals = {
    lanes: lanes.length,
    configured: lanes.filter((lane) => lane.configured).length,
    missingEnv: lanes.filter((lane) => lane.status === "missing-env").length,
    readyToRun: lanes.filter((lane) => lane.status === "ready-to-run" || lane.status === "not-requested").length,
    passed: lanes.filter((lane) => lane.status === "passed").length,
    warning: lanes.filter((lane) => lane.status === "warning").length,
    error: lanes.filter((lane) => lane.status === "error").length,
    fetched: lanes.reduce((sum, lane) => sum + lane.result.fetched, 0),
    normalized: lanes.reduce((sum, lane) => sum + lane.result.normalized, 0)
  };
  const status = ledgerStatus(lanes, runRequested, adminAuthorized);
  const nextLane =
    lanes.find((lane) => lane.status === "error") ??
    lanes.find((lane) => lane.status === "missing-env") ??
    lanes.find((lane) => lane.status === "admin-required") ??
    lanes.find((lane) => lane.status === "ready-to-run" || lane.status === "not-requested") ??
    lanes[0] ??
    null;
  const ledgerHash = stableHash({
    date,
    sport,
    status,
    runRequested,
    adminAuthorized,
    lanes: lanes.map((lane) => [lane.id, lane.status, lane.result.syncStatus, lane.result.fetched, lane.result.normalized])
  });

  return {
    mode: "decision-live-provider-probe-ledger",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    ledgerHash,
    summary: summaryFor(status, totals),
    runRequested,
    adminAuthorized,
    lanes,
    nextLane,
    totals,
    controls: {
      canInspectReadOnly: true,
      canRunDryRun: lanes.some((lane) => lane.configured) && (!runRequested || adminAuthorized),
      requiresRunParam: true,
      requiresAdminToken: true,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrain: false,
      canPublish: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    locks: [
      "Live provider probe ledger only runs dry-run provider checks; it cannot write provider rows, persist decisions, train models, publish picks, stake, or upgrade public action.",
      "run=1 and x-oddspadi-admin-token are required before any provider network probe runs.",
      "Fetched and normalized counts are evidence for readiness only; storage proof and write receipts are separate gates.",
      "Provider keys are never returned by this ledger."
    ],
    proofUrls: [
      "/api/sports/decision/live-provider-probe-ledger",
      "/api/sports/decision/training/provider-sync",
      "/api/sports/decision/training/provider-readiness",
      "/api/sports/decision/provider-evidence-ledger",
      "/api/sports/decision/answer-promotion-gate"
    ]
  };
}
