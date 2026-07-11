import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type EnvMap = Record<string, string | undefined>;

export const ODDSPADI_SUPABASE_PROJECT_REF = "wncwtzqipnoqwmqlznqn";
const SERVER_SECRET_ENV_KEYS = ["SUPABASE_SECRET_KEY", "SUPABASE_SECRET_API_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const PUBLIC_KEY_ENV_KEYS = ["SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];

export type SupabaseApiKeyKind =
  | "modern-secret"
  | "modern-publishable"
  | "legacy-service-role-jwt"
  | "legacy-anon-jwt"
  | "jwt"
  | "placeholder"
  | "unknown"
  | "missing";

export type SupabaseApiKeyProfile = {
  configured: boolean;
  sourceEnvKey: string | null;
  kind: SupabaseApiKeyKind;
  serverSafe: boolean;
  browserSafe: boolean;
  legacyJwtRole: string | null;
  legacyJwtProjectRef: string | null;
  recommendation: string;
};

export type SupabaseRuntimeStatus = {
  urlConfigured: boolean;
  publishableKeyConfigured: boolean;
  serviceRoleKeyConfigured: boolean;
  publishableKeyProfile: SupabaseApiKeyProfile;
  serverKeyProfile: SupabaseApiKeyProfile;
  restReadReady: boolean;
  serverWriteReady: boolean;
  expectedProjectRef: string;
  projectRef: string | null;
  urlProjectRef: string | null;
  projectHost: string | null;
  targetMatchesExpected: boolean;
  missingServerEnv: string[];
  missingPublicEnv: string[];
};

let cachedClient: { cacheKey: string; client: SupabaseClient } | null = null;

function readEnv(env: EnvMap, keys: string[]): string {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return value;
  }
  return "";
}

function readEnvWithSource(env: EnvMap, keys: string[]): { key: string | null; value: string } {
  for (const key of keys) {
    const value = env[key]?.trim();
    if (value) return { key, value };
  }
  return { key: null, value: "" };
}

function decodeJwtPayload(value: string): { role: string | null; ref: string | null } | null {
  const parts = value.split(".");
  if (parts.length !== 3) return null;

  try {
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4) payload += "=";
    const decoded = JSON.parse(Buffer.from(payload, "base64").toString("utf8")) as { role?: unknown; ref?: unknown };
    return {
      role: typeof decoded.role === "string" ? decoded.role : null,
      ref: typeof decoded.ref === "string" ? decoded.ref : null
    };
  } catch {
    return null;
  }
}

function isPlaceholderKey(value: string): boolean {
  const lower = value.toLowerCase();
  return !lower || lower.includes("paste_") || lower.includes("placeholder") || lower.includes("your_") || lower === "changeme";
}

function profileApiKey(sourceEnvKey: string | null, value: string, expectedUse: "server" | "public"): SupabaseApiKeyProfile {
  if (!value) {
    return {
      configured: false,
      sourceEnvKey,
      kind: "missing",
      serverSafe: false,
      browserSafe: false,
      legacyJwtRole: null,
      legacyJwtProjectRef: null,
      recommendation:
        expectedUse === "server"
          ? "Add a server-only Supabase secret key from Settings > API Keys; prefer SUPABASE_SECRET_KEY."
          : "Add the Supabase publishable key to NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    };
  }

  if (isPlaceholderKey(value)) {
    return {
      configured: false,
      sourceEnvKey,
      kind: "placeholder",
      serverSafe: false,
      browserSafe: false,
      legacyJwtRole: null,
      legacyJwtProjectRef: null,
      recommendation: "Replace the placeholder value with a real key from the OddsPadi Supabase project."
    };
  }

  if (value.startsWith("sb_secret_")) {
    return {
      configured: true,
      sourceEnvKey,
      kind: "modern-secret",
      serverSafe: true,
      browserSafe: false,
      legacyJwtRole: null,
      legacyJwtProjectRef: null,
      recommendation: "Use this server-only key for Supabase reads/writes. Never expose it through NEXT_PUBLIC variables."
    };
  }

  if (value.startsWith("sb_publishable_")) {
    return {
      configured: true,
      sourceEnvKey,
      kind: "modern-publishable",
      serverSafe: false,
      browserSafe: true,
      legacyJwtRole: null,
      legacyJwtProjectRef: null,
      recommendation:
        expectedUse === "server"
          ? "This is a browser-safe publishable key; add a separate sb_secret_ key for server writes."
          : "Use this browser-safe key with RLS-protected client reads."
    };
  }

  const jwt = decodeJwtPayload(value);
  if (jwt) {
    const kind: SupabaseApiKeyKind =
      jwt.role === "service_role" ? "legacy-service-role-jwt" : jwt.role === "anon" ? "legacy-anon-jwt" : "jwt";
    return {
      configured: true,
      sourceEnvKey,
      kind,
      serverSafe: jwt.role === "service_role",
      browserSafe: jwt.role === "anon",
      legacyJwtRole: jwt.role,
      legacyJwtProjectRef: jwt.ref,
      recommendation:
        jwt.role === "service_role"
          ? "Legacy service_role JWT detected. If Supabase rejects it, rotate/copy the active service_role key or use a modern sb_secret_ key."
          : jwt.role === "anon"
            ? "Legacy anon JWT detected. Use it only for browser-safe reads; use a server secret for writes."
            : "JWT key detected. Confirm it belongs to the OddsPadi project and intended role."
    };
  }

  return {
    configured: true,
    sourceEnvKey,
    kind: "unknown",
    serverSafe: expectedUse === "server",
    browserSafe: expectedUse === "public",
    legacyJwtRole: null,
    legacyJwtProjectRef: null,
    recommendation: "Unknown key shape. Verify it in Supabase Settings > API Keys before trusting storage or client reads."
  };
}

function hostFromUrl(value: string): string | null {
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

function projectRefFromUrl(value: string): string | null {
  const host = hostFromUrl(value);
  if (!host) return null;
  const [ref] = host.split(".");
  return ref || null;
}

export function getSupabaseRuntimeStatus(env: EnvMap = process.env): SupabaseRuntimeStatus {
  const url = readEnv(env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const publishableKeySource = readEnvWithSource(env, PUBLIC_KEY_ENV_KEYS);
  const serverKeySource = readEnvWithSource(env, SERVER_SECRET_ENV_KEYS);
  const publishableKey = publishableKeySource.value;
  const serviceRoleKey = serverKeySource.value;
  const publishableKeyProfile = profileApiKey(publishableKeySource.key, publishableKey, "public");
  const serverKeyProfile = profileApiKey(serverKeySource.key, serviceRoleKey, "server");
  const projectRef = readEnv(env, ["SUPABASE_PROJECT_REF"]) || projectRefFromUrl(url);
  const urlProjectRef = projectRefFromUrl(url);
  const targetMatchesExpected = projectRef === ODDSPADI_SUPABASE_PROJECT_REF && urlProjectRef === ODDSPADI_SUPABASE_PROJECT_REF;
  const serverKeyProjectScoped =
    !serverKeyProfile.legacyJwtProjectRef || serverKeyProfile.legacyJwtProjectRef === ODDSPADI_SUPABASE_PROJECT_REF;
  const publicKeyProjectScoped =
    !publishableKeyProfile.legacyJwtProjectRef || publishableKeyProfile.legacyJwtProjectRef === ODDSPADI_SUPABASE_PROJECT_REF;
  const publishableKeyUsable = publishableKeyProfile.configured && publishableKeyProfile.browserSafe && publicKeyProjectScoped;
  const serverKeyUsable = serverKeyProfile.configured && serverKeyProfile.serverSafe && serverKeyProjectScoped;

  return {
    urlConfigured: Boolean(url),
    publishableKeyConfigured: publishableKeyUsable,
    serviceRoleKeyConfigured: serverKeyUsable,
    publishableKeyProfile,
    serverKeyProfile,
    restReadReady: Boolean(url && publishableKeyUsable && targetMatchesExpected),
    serverWriteReady: Boolean(url && serverKeyUsable && targetMatchesExpected),
    expectedProjectRef: ODDSPADI_SUPABASE_PROJECT_REF,
    projectRef,
    urlProjectRef,
    projectHost: hostFromUrl(url),
    targetMatchesExpected,
    missingServerEnv: [
      !url ? "SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL" : "",
      !serverKeyProfile.configured || !serverKeyProfile.serverSafe || !serverKeyProjectScoped ? "SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY for the OddsPadi project" : "",
      url && !targetMatchesExpected ? `OddsPadi Supabase project ${ODDSPADI_SUPABASE_PROJECT_REF}` : ""
    ].filter(Boolean),
    missingPublicEnv: [
      !url ? "NEXT_PUBLIC_SUPABASE_URL" : "",
      !publishableKeyProfile.configured || !publishableKeyProfile.browserSafe || !publicKeyProjectScoped ? "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY for the OddsPadi project" : "",
      url && !targetMatchesExpected ? `OddsPadi Supabase project ${ODDSPADI_SUPABASE_PROJECT_REF}` : ""
    ].filter(Boolean)
  };
}

export function getSupabaseServerClient(env: EnvMap = process.env): SupabaseClient | null {
  const url = readEnv(env, ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const serviceRoleKey = readEnv(env, SERVER_SECRET_ENV_KEYS);
  const runtime = getSupabaseRuntimeStatus(env);
  if (!url || !serviceRoleKey || !runtime.targetMatchesExpected) return null;

  const cacheKey = `${url}:${serviceRoleKey}`;
  if (cachedClient?.cacheKey === cacheKey) return cachedClient.client;

  const client = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      headers: {
        "X-Client-Info": "oddspadi-mvp"
      }
    }
  });

  cachedClient = { cacheKey, client };
  return client;
}
