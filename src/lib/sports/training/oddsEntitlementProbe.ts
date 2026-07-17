import { hasAnyConfiguredEnv } from "@/lib/env";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import { syncHistoricalFootballProvider, type ProviderSyncRequest, type ProviderSyncResult } from "@/lib/sports/training/providerSync";

type EnvMap = Record<string, string | undefined>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type SyncImpl = (input: { request: ProviderSyncRequest; env?: EnvMap; fetchImpl?: FetchLike }) => Promise<ProviderSyncResult>;

export type OddsEntitlementProbeStatus =
  | "ready-admin-run"
  | "missing-provider-key"
  | "admin-required"
  | "historical-odds-ready"
  | "historical-plan-blocked"
  | "provider-error"
  | "safe-hold";

export type OddsEntitlementTargetStatus = "not-run" | "missing-provider-key" | "admin-required" | "accessible" | "blocked" | "empty" | "error";

export type OddsEntitlementTarget = {
  id: string;
  label: string;
  sportKey: "basketball_nba" | "soccer_epl";
  role: "basketball-history" | "football-history";
  date: string;
  regions: string;
  request: ProviderSyncRequest;
  status: OddsEntitlementTargetStatus;
  syncStatus: ProviderSyncResult["status"] | "not-run";
  fetched: number;
  normalized: number;
  endpoint: string | null;
  reason: string | null;
  entitlementSignal: "accessible" | "paid-plan-required" | "missing-key" | "admin-required" | "empty" | "unknown";
  nextAction: string;
};

export type OddsEntitlementProbe = {
  mode: "odds-entitlement-probe";
  generatedAt: string;
  provider: "the-odds-api";
  runRequested: boolean;
  adminAuthorized: boolean;
  providerConfigured: boolean;
  status: OddsEntitlementProbeStatus;
  summary: string;
  primaryTarget: OddsEntitlementTarget;
  targets: OddsEntitlementTarget[];
  totals: {
    targets: number;
    accessible: number;
    blocked: number;
    empty: number;
    errors: number;
  };
  nextAction: string;
  runCommand: string | null;
  attachmentDryRun: {
    ready: boolean;
    verifyUrl: string;
    command: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canAttachBasketballOdds: boolean;
    canWriteProviderRows: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  proofUrls: string[];
  locks: string[];
};

const REQUIRED_ENV = ["THE_ODDS_API_KEY", "ODDS_API_KEY"];

function targetDefinitions(): Array<Pick<OddsEntitlementTarget, "id" | "label" | "sportKey" | "role" | "date" | "regions" | "request">> {
  return [
    {
      id: "nba-2024-historical-moneyline",
      label: "NBA historical moneyline odds",
      sportKey: "basketball_nba",
      role: "basketball-history",
      date: "2024-02-01T12:00:00Z",
      regions: "us",
      request: {
        provider: "the-odds-api",
        sportKey: "basketball_nba",
        date: "2024-02-01T12:00:00Z",
        regions: "us",
        dryRun: true,
        limit: 25
      }
    },
    {
      id: "epl-2024-historical-h2h",
      label: "EPL historical h2h odds",
      sportKey: "soccer_epl",
      role: "football-history",
      date: "2024-02-01T12:00:00Z",
      regions: "uk,eu",
      request: {
        provider: "the-odds-api",
        sportKey: "soccer_epl",
        date: "2024-02-01T12:00:00Z",
        regions: "uk,eu",
        dryRun: true,
        limit: 25
      }
    }
  ];
}

function hasProviderKey(env: EnvMap): boolean {
  return hasAnyConfiguredEnv(env, REQUIRED_ENV);
}

function isPlanRestriction(reason: string | null | undefined): boolean {
  const normalized = reason?.toLowerCase() ?? "";
  return (
    normalized.includes("paid") ||
    normalized.includes("plan") ||
    normalized.includes("access") ||
    normalized.includes("subscription") ||
    normalized.includes("historical odds")
  );
}

function targetStatusFromResult(result: ProviderSyncResult): Pick<OddsEntitlementTarget, "status" | "entitlementSignal" | "nextAction"> {
  if (result.status === "dry-run" || result.status === "stored") {
    if (result.normalized > 0 || result.fetched > 0) {
      return {
        status: "accessible",
        entitlementSignal: "accessible",
        nextAction: "Use this as read-only odds entitlement proof, then run sport-specific odds attachment or provider dry-runs."
      };
    }
    return {
      status: "empty",
      entitlementSignal: isPlanRestriction(result.reason) ? "paid-plan-required" : "empty",
      nextAction: isPlanRestriction(result.reason)
        ? "Upgrade The Odds API to a paid historical odds plan, then rerun this probe."
        : "Try a timestamp closer to known fixtures before treating this market as unavailable."
    };
  }

  if (result.status === "not-configured") {
    return {
      status: "missing-provider-key",
      entitlementSignal: "missing-key",
      nextAction: "Add THE_ODDS_API_KEY or ODDS_API_KEY as a server-only env var."
    };
  }

  if (result.status === "provider-error" || result.status === "failed" || result.status === "invalid-response") {
    return {
      status: isPlanRestriction(result.reason) ? "blocked" : "error",
      entitlementSignal: isPlanRestriction(result.reason) ? "paid-plan-required" : "unknown",
      nextAction: isPlanRestriction(result.reason)
        ? "Upgrade The Odds API to a paid historical odds plan, then rerun this probe."
        : "Fix provider credentials, quota, request parameters, or response normalization."
    };
  }

  return {
    status: "error",
    entitlementSignal: "unknown",
    nextAction: "Inspect the provider result before using this target for model training."
  };
}

function notRunTarget(
  target: ReturnType<typeof targetDefinitions>[number],
  status: OddsEntitlementTargetStatus,
  entitlementSignal: OddsEntitlementTarget["entitlementSignal"],
  nextAction: string
): OddsEntitlementTarget {
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
  primaryTarget,
  totals
}: {
  providerConfigured: boolean;
  runRequested: boolean;
  adminAuthorized: boolean;
  primaryTarget: OddsEntitlementTarget;
  totals: OddsEntitlementProbe["totals"];
}): OddsEntitlementProbeStatus {
  if (!providerConfigured) return "missing-provider-key";
  if (!runRequested) return "ready-admin-run";
  if (!adminAuthorized) return "admin-required";
  if (primaryTarget.status === "accessible") return "historical-odds-ready";
  if (primaryTarget.entitlementSignal === "paid-plan-required" || totals.blocked > 0) return "historical-plan-blocked";
  if (totals.errors > 0) return "provider-error";
  return "safe-hold";
}

function summaryFor(status: OddsEntitlementProbeStatus, totals: OddsEntitlementProbe["totals"]): string {
  if (status === "historical-odds-ready") return "The Odds API historical odds entitlement passed; NBA odds attachment can run in dry-run mode.";
  if (status === "historical-plan-blocked") return "The Odds API key is configured, but historical odds access is blocked by the current plan.";
  if (status === "admin-required") return "The Odds API entitlement probe needs run=1 plus the server-only admin token before making provider calls.";
  if (status === "missing-provider-key") return "The Odds API entitlement probe is waiting for THE_ODDS_API_KEY or ODDS_API_KEY.";
  if (status === "ready-admin-run") return "The Odds API entitlement probe is ready for a supervised no-write run.";
  if (status === "provider-error") return `${totals.errors} odds entitlement target(s) hit provider errors that need inspection.`;
  return "The Odds API entitlement probe is in safe hold; inspect empty targets before training use.";
}

function nextActionFor(status: OddsEntitlementProbeStatus, primaryTarget: OddsEntitlementTarget): string {
  if (status === "historical-odds-ready") return "Plan basketball-odds-backfill with run=0, then execute a quota-bounded dry run before enabling storage.";
  if (status === "historical-plan-blocked") return primaryTarget.reason ?? "Upgrade The Odds API to include historical odds, then rerun this entitlement probe.";
  if (status === "admin-required") return "Re-run with run=1 and x-oddspadi-admin-token.";
  if (status === "missing-provider-key") return "Set THE_ODDS_API_KEY or ODDS_API_KEY before probing odds entitlement.";
  if (status === "ready-admin-run") return "Run this probe to classify historical odds plan access before trying basketball odds attachment.";
  return "Inspect provider reason strings and retry with a smaller target if needed.";
}

export async function buildOddsEntitlementProbe({
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
} = {}): Promise<OddsEntitlementProbe> {
  const providerConfigured = hasProviderKey(env);
  const definitions = targetDefinitions();
  const targets = await Promise.all(
    definitions.map(async (target): Promise<OddsEntitlementTarget> => {
      if (!providerConfigured) return notRunTarget(target, "missing-provider-key", "missing-key", "Add The Odds API credentials before this entitlement probe can run.");
      if (!runRequested) return notRunTarget(target, "not-run", "unknown", "Run the probe with run=1 after confirming provider-call intent.");
      if (!adminAuthorized) return notRunTarget(target, "admin-required", "admin-required", "Re-run with the server-only admin token header.");

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
  const primaryTarget = targets.find((target) => target.role === "basketball-history") ?? targets[0];
  const totals = {
    targets: targets.length,
    accessible: targets.filter((target) => target.status === "accessible").length,
    blocked: targets.filter((target) => target.status === "blocked").length,
    empty: targets.filter((target) => target.status === "empty").length,
    errors: targets.filter((target) => target.status === "error").length
  };
  const status = statusFor({ providerConfigured, runRequested, adminAuthorized, primaryTarget, totals });
  const attachmentVerifyUrl = `/api/sports/decision/training/basketball-odds-backfill?from=${encodeURIComponent(primaryTarget.date)}&to=${encodeURIComponent(primaryTarget.date)}&regions=us&maxJobs=1&maxCredits=10&run=0`;
  const route = "/api/sports/decision/training/odds-entitlement-probe?run=1";

  return {
    mode: "odds-entitlement-probe",
    generatedAt: now.toISOString(),
    provider: "the-odds-api",
    runRequested,
    adminAuthorized,
    providerConfigured,
    status,
    summary: summaryFor(status, totals),
    primaryTarget,
    targets,
    totals,
    nextAction: nextActionFor(status, primaryTarget),
    runCommand: providerConfigured ? `${decisionCurlCommand(route, origin)} -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"` : null,
    attachmentDryRun: {
      ready: status === "historical-odds-ready",
      verifyUrl: attachmentVerifyUrl,
      command: `${decisionCurlCommand(attachmentVerifyUrl, origin)} -X POST -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`,
      expectedEvidence: "The basketball odds attachment preview returns matched finished NBA fixture IDs and op_odds_snapshots row counts without writing rows."
    },
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun: providerConfigured && (!runRequested || adminAuthorized),
      canAttachBasketballOdds: status === "historical-odds-ready",
      canWriteProviderRows: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: [
      "/api/sports/decision/training/odds-entitlement-probe",
      "/api/sports/decision/training/basketball-odds-backfill",
      "/api/sports/decision/training/provider-sync"
    ],
    locks: [
      "The Odds API entitlement probe is read-only and always requests dry-run provider sync.",
      "A ready entitlement only unlocks the basketball odds attachment dry-run; dryRun=0 remains a separate operator decision.",
      "Stored odds snapshots still cannot train models, publish picks, or stake until backtests and governance pass.",
      "Provider keys and admin tokens must never appear in this packet."
    ]
  };
}
