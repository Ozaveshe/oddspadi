import { cleanEnvValue, isConfiguredSecretValue, type EnvMap } from "@/lib/env";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Sport } from "@/lib/sports/types";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type DecisionProviderCredentialProbeStatus =
  | "missing-env"
  | "not-requested"
  | "admin-required"
  | "credential-active"
  | "credential-inactive"
  | "quota-warning"
  | "quota-exhausted"
  | "provider-error";

export type DecisionProviderCredentialQuotaStatus = "ok" | "near-limit" | "exhausted" | "unknown";

export type DecisionProviderCredentialProbe = {
  mode: "decision-provider-credential-probe";
  generatedAt: string;
  date: string;
  sport: Sport;
  provider: "api-football";
  status: DecisionProviderCredentialProbeStatus;
  summary: string;
  runRequested: boolean;
  adminAuthorized: boolean;
  configured: boolean;
  configuredEnvName: string | null;
  requiredEnv: ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"];
  endpoint: string;
  command: string;
  runAttempted: boolean;
  result: {
    httpStatus: number | null;
    subscriptionPlan: string | null;
    active: boolean | null;
    quota: {
      current: number | null;
      limitDay: number | null;
      status: DecisionProviderCredentialQuotaStatus;
    };
    providerErrors: string[];
    reason: string | null;
  };
  controls: {
    readOnly: true;
    requiresRunParam: true;
    requiresAdminToken: true;
    secretValuesReturned: false;
    canReadSecretValues: false;
    canPrintSecretValues: false;
    canWriteEnvFiles: false;
    canWriteProviderRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  locks: string[];
  proofUrls: string[];
  nextAction: string;
};

const REQUIRED_ENV: DecisionProviderCredentialProbe["requiredEnv"] = ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"];
const STATUS_ENDPOINT = "https://v3.football.api-sports.io/status";

function firstConfiguredEnv(env: EnvMap): { name: string; value: string } | null {
  for (const name of REQUIRED_ENV) {
    const value = cleanEnvValue(env[name]);
    if (isConfiguredSecretValue(value)) return { name, value };
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function providerErrors(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!isRecord(value)) return [];
  return Object.values(value)
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .map((item) => String(item))
    .filter((item) => item.trim().length > 0);
}

function quotaStatus(current: number | null, limitDay: number | null): DecisionProviderCredentialQuotaStatus {
  if (current === null || limitDay === null || limitDay <= 0) return "unknown";
  if (current >= limitDay) return "exhausted";
  if (current / limitDay >= 0.85) return "near-limit";
  return "ok";
}

function statusFromResult({
  active,
  quota,
  errors,
  httpOk
}: {
  active: boolean | null;
  quota: DecisionProviderCredentialQuotaStatus;
  errors: string[];
  httpOk: boolean;
}): DecisionProviderCredentialProbeStatus {
  if (!httpOk || errors.length > 0) return "provider-error";
  if (active === false) return "credential-inactive";
  if (quota === "exhausted") return "quota-exhausted";
  if (quota === "near-limit") return "quota-warning";
  return "credential-active";
}

function summaryFor(probe: Pick<DecisionProviderCredentialProbe, "status" | "configuredEnvName"> & { plan: string | null; quota: DecisionProviderCredentialQuotaStatus }): string {
  if (probe.status === "missing-env") return "API-Football credential proof is blocked because no accepted football provider env name is configured.";
  if (probe.status === "not-requested") return `${probe.configuredEnvName} is configured; run the guarded status proof to verify subscription and quota.`;
  if (probe.status === "admin-required") return "API-Football status proof requires run=1 plus the server-only admin token.";
  if (probe.status === "credential-inactive") return "API-Football responded, but the subscription is inactive.";
  if (probe.status === "quota-exhausted") return `API-Football ${probe.plan ?? "subscription"} is active, but today's quota is exhausted.`;
  if (probe.status === "quota-warning") return `API-Football ${probe.plan ?? "subscription"} is active, but today's quota is close to its limit.`;
  if (probe.status === "provider-error") return "API-Football status proof returned an error; inspect provider message without exposing the key.";
  return `API-Football ${probe.plan ?? "subscription"} is active and the credential status proof passed.`;
}

function nextActionFor(status: DecisionProviderCredentialProbeStatus, reason: string | null): string {
  if (status === "credential-active") return "Use this as credential proof only; fixture coverage, odds coverage, storage writes, and model training still need their own gates.";
  if (status === "quota-warning") return "Avoid broad sync runs until quota resets or the plan is upgraded; keep probes narrow.";
  if (status === "quota-exhausted") return "Wait for quota reset or upgrade API-Football before running fixture/history dry-runs.";
  if (status === "credential-inactive") return "Reactivate or replace the API-Football subscription before provider dry-runs.";
  if (status === "provider-error") return reason ?? "Fix provider credentials, plan access, quota, or provider availability before rerunning status proof.";
  if (status === "admin-required") return "Call the route with run=1 and x-oddspadi-admin-token from the server/local shell.";
  if (status === "not-requested") return "Run the credential proof endpoint when ready; no provider network call has been made in preview mode.";
  return "Add API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY to .env.local and restart localhost.";
}

function emptyResult(): DecisionProviderCredentialProbe["result"] {
  return {
    httpStatus: null,
    subscriptionPlan: null,
    active: null,
    quota: {
      current: null,
      limitDay: null,
      status: "unknown"
    },
    providerErrors: [],
    reason: null
  };
}

export async function buildDecisionProviderCredentialProbe({
  date,
  sport,
  env = process.env,
  runRequested = false,
  adminAuthorized = false,
  fetchImpl = fetch,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  env?: EnvMap;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<DecisionProviderCredentialProbe> {
  const configured = firstConfiguredEnv(env);
  const command = `${decisionCurlCommand("/api/sports/decision/provider-credential-probe?date=2026-07-05&sport=football&run=1")} -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`;

  let status: DecisionProviderCredentialProbeStatus = "missing-env";
  let result = emptyResult();
  let runAttempted = false;

  if (configured && !runRequested) {
    status = "not-requested";
  } else if (configured && runRequested && !adminAuthorized) {
    status = "admin-required";
  } else if (configured && runRequested && adminAuthorized) {
    runAttempted = true;
    try {
      const response = await fetchImpl(STATUS_ENDPOINT, {
        headers: {
          "x-apisports-key": configured.value
        },
        cache: "no-store"
      });
      const payload = await response.json().catch(() => null);
      const root = optionalRecord(payload);
      const body = optionalRecord(root.response);
      const subscription = optionalRecord(body.subscription);
      const requests = optionalRecord(body.requests);
      const errors = providerErrors(root.errors);
      const current = optionalNumber(requests.current);
      const limitDay = optionalNumber(requests.limit_day);
      const quota = quotaStatus(current, limitDay);
      const active = optionalBoolean(subscription.active);
      const plan = optionalString(subscription.plan);
      status = statusFromResult({ active, quota, errors, httpOk: response.ok });
      result = {
        httpStatus: response.status,
        subscriptionPlan: plan,
        active,
        quota: {
          current,
          limitDay,
          status: quota
        },
        providerErrors: errors,
        reason: response.ok ? errors[0] ?? null : errors[0] ?? `HTTP ${response.status}`
      };
    } catch (error) {
      status = "provider-error";
      result = {
        ...emptyResult(),
        reason: error instanceof Error ? error.message : "API-Football status request failed"
      };
    }
  }

  const summary = summaryFor({
    status,
    configuredEnvName: configured?.name ?? null,
    plan: result.subscriptionPlan,
    quota: result.quota.status
  });

  return {
    mode: "decision-provider-credential-probe",
    generatedAt: now.toISOString(),
    date,
    sport,
    provider: "api-football",
    status,
    summary,
    runRequested,
    adminAuthorized,
    configured: Boolean(configured),
    configuredEnvName: configured?.name ?? null,
    requiredEnv: REQUIRED_ENV,
    endpoint: STATUS_ENDPOINT,
    command,
    runAttempted,
    result,
    controls: {
      readOnly: true,
      requiresRunParam: true,
      requiresAdminToken: true,
      secretValuesReturned: false,
      canReadSecretValues: false,
      canPrintSecretValues: false,
      canWriteEnvFiles: false,
      canWriteProviderRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Credential proof verifies provider account status only; it does not unlock fixture access, odds access, writes, training, publishing, staking, or confidence upgrades.",
      "The provider key value is used only as an outbound server header and is never returned in the response.",
      "run=1 and x-oddspadi-admin-token are required before the API-Football status endpoint is called."
    ],
    proofUrls: ["/api/sports/decision/provider-credential-probe", "/api/sports/decision/live-provider-probe-ledger", "/api/sports/decision/provider-env-diagnostic"],
    nextAction: nextActionFor(status, result.reason)
  };
}
