import { cleanEnvValue, isConfiguredSecretValue, type EnvMap } from "@/lib/env";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type ProviderCapacityName = "api-football" | "api-basketball";
export type ProviderCapacityStatus =
  | "configured"
  | "missing-key"
  | "active"
  | "inactive"
  | "near-limit"
  | "quota-exhausted"
  | "provider-error";

export type ProviderCapacityResult = {
  provider: ProviderCapacityName;
  configuredEnvName: string | null;
  configured: boolean;
  status: ProviderCapacityStatus;
  requestAttempted: boolean;
  httpStatus: number | null;
  subscription: {
    plan: string | null;
    active: boolean | null;
    endsAt: string | null;
  };
  dailyQuota: {
    used: number | null;
    limit: number | null;
    remaining: number | null;
  };
  rateLimit: {
    limit: number | null;
    remaining: number | null;
  };
  providerErrors: string[];
};

export type ProviderCapacityProbe = {
  mode: "provider-capacity-probe";
  generatedAt: string;
  runRequested: boolean;
  providers: ProviderCapacityResult[];
  controls: {
    readOnly: true;
    secretValuesReturned: false;
    providerRowsWritten: false;
    picksPublished: false;
  };
};

type ProviderDefinition = {
  provider: ProviderCapacityName;
  envNames: string[];
  endpoint: string;
};

const PROVIDERS: ProviderDefinition[] = [
  {
    provider: "api-football",
    envNames: ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
    endpoint: "https://v3.football.api-sports.io/status"
  },
  {
    provider: "api-basketball",
    envNames: ["API_BASKETBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
    endpoint: "https://v1.basketball.api-sports.io/status"
  }
];

function firstConfiguredEnv(env: EnvMap, names: string[]): { name: string; value: string } | null {
  for (const name of names) {
    const value = cleanEnvValue(env[name]);
    if (isConfiguredSecretValue(value)) return { name, value };
  }
  return null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function boolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function errors(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean).slice(0, 10);
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  return Object.values(record(value))
    .flatMap((item) => (Array.isArray(item) ? item : [item]))
    .map(String)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function emptyResult(definition: ProviderDefinition, configuredEnvName: string | null): ProviderCapacityResult {
  return {
    provider: definition.provider,
    configuredEnvName,
    configured: configuredEnvName !== null,
    status: configuredEnvName ? "configured" : "missing-key",
    requestAttempted: false,
    httpStatus: null,
    subscription: { plan: null, active: null, endsAt: null },
    dailyQuota: { used: null, limit: null, remaining: null },
    rateLimit: { limit: null, remaining: null },
    providerErrors: []
  };
}

function statusFor(input: {
  responseOk: boolean;
  active: boolean | null;
  used: number | null;
  limit: number | null;
  providerErrors: string[];
}): ProviderCapacityStatus {
  if (!input.responseOk || input.providerErrors.length) return "provider-error";
  if (input.active === false) return "inactive";
  if (input.used !== null && input.limit !== null && input.limit > 0) {
    if (input.used >= input.limit) return "quota-exhausted";
    if (input.used / input.limit >= 0.85) return "near-limit";
  }
  return "active";
}

async function probeProvider(
  definition: ProviderDefinition,
  env: EnvMap,
  runRequested: boolean,
  fetchImpl: FetchLike
): Promise<ProviderCapacityResult> {
  const configured = firstConfiguredEnv(env, definition.envNames);
  const preview = emptyResult(definition, configured?.name ?? null);
  if (!configured || !runRequested) return preview;

  try {
    const response = await fetchImpl(definition.endpoint, {
      headers: { accept: "application/json", "x-apisports-key": configured.value },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000)
    });
    const payload = record(await response.json().catch(() => null));
    const body = record(payload.response);
    const subscription = record(body.subscription);
    const requests = record(body.requests);
    const providerErrors = errors(payload.errors);
    const used = number(requests.current);
    const limit = number(requests.limit_day);
    const active = boolean(subscription.active);
    return {
      ...preview,
      status: statusFor({ responseOk: response.ok, active, used, limit, providerErrors }),
      requestAttempted: true,
      httpStatus: response.status,
      subscription: {
        plan: text(subscription.plan),
        active,
        endsAt: text(subscription.end)
      },
      dailyQuota: {
        used,
        limit,
        remaining: used !== null && limit !== null ? Math.max(0, limit - used) : null
      },
      rateLimit: {
        limit: number(response.headers.get("x-ratelimit-limit")),
        remaining: number(response.headers.get("x-ratelimit-remaining"))
      },
      providerErrors
    };
  } catch (error) {
    return {
      ...preview,
      status: "provider-error",
      requestAttempted: true,
      providerErrors: [error instanceof Error ? error.message : "Provider status request failed"]
    };
  }
}

export async function buildProviderCapacityProbe({
  env = process.env,
  runRequested = false,
  fetchImpl = fetch,
  now = new Date()
}: {
  env?: EnvMap;
  runRequested?: boolean;
  fetchImpl?: FetchLike;
  now?: Date;
} = {}): Promise<ProviderCapacityProbe> {
  const providers = await Promise.all(PROVIDERS.map((definition) => probeProvider(definition, env, runRequested, fetchImpl)));
  return {
    mode: "provider-capacity-probe",
    generatedAt: now.toISOString(),
    runRequested,
    providers,
    controls: {
      readOnly: true,
      secretValuesReturned: false,
      providerRowsWritten: false,
      picksPublished: false
    }
  };
}
