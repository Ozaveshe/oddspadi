import { hasAnyConfiguredEnv } from "@/lib/env";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import { syncHistoricalFootballProvider, type ProviderSyncRequest, type ProviderSyncResult } from "@/lib/sports/training/providerSync";

type EnvMap = Record<string, string | undefined>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type SyncImpl = (input: { request: ProviderSyncRequest; env?: EnvMap; fetchImpl?: FetchLike }) => Promise<ProviderSyncResult>;

export type ApiFootballEntitlementProbeStatus =
  | "ready-admin-run"
  | "missing-provider-key"
  | "admin-required"
  | "future-season-ready"
  | "historical-fallback-ready"
  | "future-season-blocked"
  | "provider-error"
  | "safe-hold";

export type ApiFootballEntitlementProbeTargetStatus = "not-run" | "missing-provider-key" | "admin-required" | "accessible" | "blocked" | "empty" | "error";

export type ApiFootballEntitlementProbeTarget = {
  id: string;
  label: string;
  role: "future-epl" | "historical-fallback";
  league: "39";
  season: string;
  date: string | null;
  request: ProviderSyncRequest;
  status: ApiFootballEntitlementProbeTargetStatus;
  syncStatus: ProviderSyncResult["status"] | "not-run";
  fetched: number;
  normalized: number;
  endpoint: string | null;
  reason: string | null;
  entitlementSignal: "accessible" | "plan-restricted" | "missing-key" | "admin-required" | "empty" | "unknown";
  nextAction: string;
};

export type ApiFootballEntitlementProbe = {
  mode: "api-football-entitlement-probe";
  generatedAt: string;
  provider: "api-football";
  runRequested: boolean;
  adminAuthorized: boolean;
  providerConfigured: boolean;
  status: ApiFootballEntitlementProbeStatus;
  summary: string;
  currentSeason: ApiFootballEntitlementProbeTarget;
  historicalFallback: ApiFootballEntitlementProbeTarget[];
  targets: ApiFootballEntitlementProbeTarget[];
  totals: {
    targets: number;
    accessible: number;
    blocked: number;
    empty: number;
    errors: number;
    historicalAccessible: number;
  };
  providerCorpusDryRun: {
    ready: boolean;
    source: "future-epl" | "historical-fallback" | "none";
    season: string | null;
    jobId: string | null;
    verifyUrl: string | null;
    runUrl: string | null;
    command: string | null;
    expectedEvidence: string;
  };
  nextAction: string;
  runCommand: string | null;
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canUseFutureEplFixtures: boolean;
    canUseHistoricalFallbackForTraining: boolean;
    canWriteProviderRows: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  proofUrls: string[];
  locks: string[];
};

const REQUIRED_ENV = ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"];

function targetDefinitions(): Array<Pick<ApiFootballEntitlementProbeTarget, "id" | "label" | "role" | "league" | "season" | "date" | "request">> {
  return [
    {
      id: "epl-2026-opening-day",
      label: "EPL 2026 opening-day fixtures",
      role: "future-epl",
      league: "39",
      season: "2026",
      date: "2026-08-21",
      request: {
        provider: "api-football",
        dryRun: true,
        league: "39",
        season: "2026",
        date: "2026-08-21",
        includeContext: false,
        includeStandings: false,
        includeAvailability: false,
        includeLineups: false,
        includeWeather: false,
        limit: 25
      }
    },
    ...["2024", "2023", "2022"].map((season) => ({
      id: `epl-${season}-season-fixtures`,
      label: `EPL ${season} historical season fixtures`,
      role: "historical-fallback" as const,
      league: "39" as const,
      season,
      date: null,
      request: {
        provider: "api-football" as const,
        dryRun: true,
        league: "39",
        season,
        includeContext: false,
        includeStandings: false,
        includeAvailability: false,
        includeLineups: false,
        includeWeather: false,
        limit: 25
      }
    }))
  ];
}

function hasProviderKey(env: EnvMap): boolean {
  return hasAnyConfiguredEnv(env, REQUIRED_ENV);
}

function isPlanRestriction(reason: string | null | undefined): boolean {
  const normalized = reason?.toLowerCase() ?? "";
  return normalized.includes("plan") || normalized.includes("access") || normalized.includes("subscription") || normalized.includes("season");
}

function targetStatusFromResult(result: ProviderSyncResult): Pick<ApiFootballEntitlementProbeTarget, "status" | "entitlementSignal" | "nextAction"> {
  if (result.status === "dry-run" || result.status === "stored") {
    if (result.normalized > 0 || result.fetched > 0) {
      return {
        status: "accessible",
        entitlementSignal: "accessible",
        nextAction: "Keep this as read-only entitlement proof, then move to a supervised provider corpus dry-run before any writes."
      };
    }
    return {
      status: "empty",
      entitlementSignal: isPlanRestriction(result.reason) ? "plan-restricted" : "empty",
      nextAction: isPlanRestriction(result.reason)
        ? "Upgrade API-Football/APISports entitlement for this season, then rerun the probe."
        : "Try a wider date window or season target before treating this coverage as unavailable."
    };
  }

  if (result.status === "not-configured") {
    return {
      status: "missing-provider-key",
      entitlementSignal: "missing-key",
      nextAction: "Add API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY as a server-only env var."
    };
  }

  if (result.status === "provider-error" || result.status === "failed" || result.status === "invalid-response") {
    return {
      status: isPlanRestriction(result.reason) ? "blocked" : "error",
      entitlementSignal: isPlanRestriction(result.reason) ? "plan-restricted" : "unknown",
      nextAction: isPlanRestriction(result.reason)
        ? "Upgrade API-Football/APISports entitlement for this season, then rerun the probe."
        : "Fix provider credentials, quota, request parameters, or response normalization."
    };
  }

  return {
    status: "error",
    entitlementSignal: "unknown",
    nextAction: "Inspect the provider result before using this target for training or live fixture mapping."
  };
}

function notRunTarget(
  target: ReturnType<typeof targetDefinitions>[number],
  status: ApiFootballEntitlementProbeTargetStatus,
  entitlementSignal: ApiFootballEntitlementProbeTarget["entitlementSignal"],
  nextAction: string
): ApiFootballEntitlementProbeTarget {
  return {
    ...target,
    status,
    syncStatus: "not-run",
    fetched: 0,
    normalized: 0,
    endpoint: null,
    reason: null,
    entitlementSignal,
    nextAction
  };
}

function statusFor({
  providerConfigured,
  runRequested,
  adminAuthorized,
  currentSeason,
  historicalFallback,
  totals
}: {
  providerConfigured: boolean;
  runRequested: boolean;
  adminAuthorized: boolean;
  currentSeason: ApiFootballEntitlementProbeTarget;
  historicalFallback: ApiFootballEntitlementProbeTarget[];
  totals: ApiFootballEntitlementProbe["totals"];
}): ApiFootballEntitlementProbeStatus {
  if (!providerConfigured) return "missing-provider-key";
  if (!runRequested) return "ready-admin-run";
  if (!adminAuthorized) return "admin-required";
  if (currentSeason.status === "accessible") return "future-season-ready";
  if (totals.historicalAccessible > 0) return "historical-fallback-ready";
  if (currentSeason.entitlementSignal === "plan-restricted") return "future-season-blocked";
  if (totals.errors > 0 || historicalFallback.some((target) => target.status === "error")) return "provider-error";
  return "safe-hold";
}

function summaryFor(status: ApiFootballEntitlementProbeStatus, totals: ApiFootballEntitlementProbe["totals"]): string {
  if (status === "future-season-ready") return "API-Football can access the 2026 EPL fixture target; live fixture mapping can continue in read-only dry-run mode.";
  if (status === "historical-fallback-ready") {
    return `API-Football blocks the future EPL target but returned ${totals.historicalAccessible} historical season fallback(s) for training/backtest proof.`;
  }
  if (status === "future-season-blocked") return "API-Football blocks the 2026 EPL target and no historical fallback target passed in this probe.";
  if (status === "admin-required") return "API-Football entitlement probe needs run=1 plus the server-only admin token before making provider calls.";
  if (status === "missing-provider-key") return "API-Football entitlement probe is waiting for API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY.";
  if (status === "ready-admin-run") return "API-Football entitlement probe is ready for a supervised no-write run.";
  if (status === "provider-error") return "API-Football entitlement probe hit provider errors that need inspection before ingestion can advance.";
  return "API-Football entitlement probe is in safe hold.";
}

function providerCorpusDryRunFor({
  currentSeason,
  historicalFallback,
  origin
}: {
  currentSeason: ApiFootballEntitlementProbeTarget;
  historicalFallback: ApiFootballEntitlementProbeTarget[];
  origin: string;
}): ApiFootballEntitlementProbe["providerCorpusDryRun"] {
  const selected =
    historicalFallback.find((target) => target.status === "accessible") ??
    (currentSeason.status === "accessible" ? currentSeason : null);
  if (!selected) {
    return {
      ready: false,
      source: "none",
      season: null,
      jobId: null,
      verifyUrl: null,
      runUrl: null,
      command: null,
      expectedEvidence: "No API-Football EPL season in this entitlement probe returned normalized dry-run rows."
    };
  }

  const jobId = `football-epl-fixtures-${selected.season}`;
  const query = new URLSearchParams({
    sport: "football",
    seasonFrom: selected.season,
    seasonTo: selected.season,
    jobId
  });
  const verifyUrl = `/api/sports/decision/training/provider-corpus-dry-run-queue?${query.toString()}`;
  query.set("run", "1");
  const runUrl = `/api/sports/decision/training/provider-corpus-dry-run-queue?${query.toString()}`;

  return {
    ready: true,
    source: selected.role,
    season: selected.season,
    jobId,
    verifyUrl,
    runUrl,
    command: `${decisionCurlCommand(runUrl, origin)} -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`,
    expectedEvidence:
      selected.role === "historical-fallback"
        ? `Run EPL ${selected.season} fixtures/context as the first supervised historical provider dry-run while 2026 future fixtures await paid entitlement.`
        : "Run EPL 2026 opening fixtures/context as the first supervised provider dry-run."
  };
}

function nextActionFor(status: ApiFootballEntitlementProbeStatus, currentSeason: ApiFootballEntitlementProbeTarget): string {
  if (status === "historical-fallback-ready") {
    return "Use the accessible historical seasons for training/backtest dry-runs today, and upgrade API-Football/APISports before relying on 2026 EPL live fixtures.";
  }
  if (status === "future-season-ready") return "Run EPL fixture map and provider-context dry-runs, then keep writes locked until Supabase service-role proof passes.";
  if (status === "future-season-blocked") return currentSeason.reason ?? "Upgrade API-Football/APISports for future-season fixture access.";
  if (status === "admin-required") return "Re-run with run=1 and x-oddspadi-admin-token.";
  if (status === "missing-provider-key") return "Set API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY before probing provider entitlement.";
  if (status === "ready-admin-run") return "Run this probe to classify future fixture access and 2022-2024 historical fallback access.";
  return "Inspect provider reason strings and retry with a smaller target if needed.";
}

export async function buildApiFootballEntitlementProbe({
  env = process.env,
  runRequested = false,
  adminAuthorized = false,
  origin = "http://127.0.0.1:3025",
  fetchImpl = fetch,
  syncImpl = syncHistoricalFootballProvider,
  now = new Date()
}: {
  env?: EnvMap;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  origin?: string;
  fetchImpl?: FetchLike;
  syncImpl?: SyncImpl;
  now?: Date;
} = {}): Promise<ApiFootballEntitlementProbe> {
  const providerConfigured = hasProviderKey(env);
  const definitions = targetDefinitions();
  const targets = await Promise.all(
    definitions.map(async (target): Promise<ApiFootballEntitlementProbeTarget> => {
      if (!providerConfigured) {
        return notRunTarget(target, "missing-provider-key", "missing-key", "Add API-Football/APISports credentials before this entitlement probe can run.");
      }
      if (!runRequested) {
        return notRunTarget(target, "not-run", "unknown", "Run the probe with run=1 after confirming provider-call intent.");
      }
      if (!adminAuthorized) {
        return notRunTarget(target, "admin-required", "admin-required", "Re-run with the server-only admin token header.");
      }
      const result = await syncImpl({ request: target.request, env, fetchImpl });
      const interpreted = targetStatusFromResult(result);
      return {
        ...target,
        ...interpreted,
        syncStatus: result.status,
        fetched: result.fetched,
        normalized: result.normalized,
        endpoint: result.endpoint,
        reason: result.reason ?? null
      };
    })
  );
  const currentSeason = targets.find((target) => target.role === "future-epl") ?? targets[0];
  const historicalFallback = targets.filter((target) => target.role === "historical-fallback");
  const totals = {
    targets: targets.length,
    accessible: targets.filter((target) => target.status === "accessible").length,
    blocked: targets.filter((target) => target.status === "blocked").length,
    empty: targets.filter((target) => target.status === "empty").length,
    errors: targets.filter((target) => target.status === "error").length,
    historicalAccessible: historicalFallback.filter((target) => target.status === "accessible").length
  };
  const status = statusFor({ providerConfigured, runRequested, adminAuthorized, currentSeason, historicalFallback, totals });
  const route = "/api/sports/decision/training/api-football-entitlement-probe?run=1";
  const providerCorpusDryRun = providerCorpusDryRunFor({ currentSeason, historicalFallback, origin });

  return {
    mode: "api-football-entitlement-probe",
    generatedAt: now.toISOString(),
    provider: "api-football",
    runRequested,
    adminAuthorized,
    providerConfigured,
    status,
    summary: summaryFor(status, totals),
    currentSeason,
    historicalFallback,
    targets,
    totals,
    providerCorpusDryRun,
    nextAction: nextActionFor(status, currentSeason),
    runCommand: providerConfigured ? decisionCurlCommand(route, origin) : null,
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun: providerConfigured && (!runRequested || adminAuthorized),
      canUseFutureEplFixtures: currentSeason.status === "accessible",
      canUseHistoricalFallbackForTraining: totals.historicalAccessible > 0,
      canWriteProviderRows: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: [
      "/api/sports/decision/training/api-football-entitlement-probe",
      "/api/sports/decision/training/provider-corpus-dry-run-queue",
      providerCorpusDryRun.verifyUrl,
      "/api/sports/decision/epl-provider-fixture-map"
    ].filter((value): value is string => Boolean(value)),
    locks: [
      "API-Football entitlement probe is read-only and always requests dry-run provider sync.",
      "Accessible historical fallback evidence can start supervised backtest/import dry-runs, but cannot write rows or train models by itself.",
      "Future 2026 EPL fixture access must be proven before public fixture promotion.",
      "Provider keys and admin tokens must never appear in this packet."
    ]
  };
}
