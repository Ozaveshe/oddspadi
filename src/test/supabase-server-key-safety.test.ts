import { describe, expect, it } from "vitest";

import {
  getSupabaseRuntimeStatus,
  getSupabaseServerClient,
  ODDSPADI_SUPABASE_PROJECT_REF
} from "@/lib/supabase/server";

function jwt(payload: Record<string, unknown>): string {
  const encode = (value: Record<string, unknown>) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode(payload)}.test-signature`;
}

describe("Supabase server-key safety", () => {
  it("refuses to create a privileged server client from an anon key stored in a server env slot", () => {
    const env = {
      NEXT_PUBLIC_SUPABASE_URL: `https://${ODDSPADI_SUPABASE_PROJECT_REF}.supabase.co`,
      SUPABASE_PROJECT_REF: ODDSPADI_SUPABASE_PROJECT_REF,
      SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "anon", ref: ODDSPADI_SUPABASE_PROJECT_REF })
    };

    const runtime = getSupabaseRuntimeStatus(env);

    expect(runtime.serverWriteReady).toBe(false);
    expect(runtime.serverKeyProfile.kind).toBe("legacy-anon-jwt");
    expect(getSupabaseServerClient(env)).toBeNull();
  });

  it("rejects masked and unknown server-key values instead of treating presence as readiness", () => {
    const base = {
      SUPABASE_URL: `https://${ODDSPADI_SUPABASE_PROJECT_REF}.supabase.co`,
      SUPABASE_PROJECT_REF: ODDSPADI_SUPABASE_PROJECT_REF
    };

    const masked = getSupabaseRuntimeStatus({ ...base, SUPABASE_SECRET_KEY: "*******************0" });
    const unknown = getSupabaseRuntimeStatus({ ...base, SUPABASE_SECRET_KEY: "configured-server-key" });

    expect(masked.serverWriteReady).toBe(false);
    expect(masked.serverKeyProfile.kind).toBe("placeholder");
    expect(unknown.serverWriteReady).toBe(false);
    expect(unknown.serverKeyProfile).toMatchObject({ kind: "unknown", serverSafe: false });
    expect(getSupabaseServerClient({ ...base, SUPABASE_SECRET_KEY: "*******************0" })).toBeNull();
  });

  it("skips an invalid preferred key and selects a valid OddsPadi-scoped fallback", () => {
    const env = {
      SUPABASE_URL: `https://${ODDSPADI_SUPABASE_PROJECT_REF}.supabase.co`,
      SUPABASE_PROJECT_REF: ODDSPADI_SUPABASE_PROJECT_REF,
      SUPABASE_SECRET_KEY: "*******************0",
      SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref: ODDSPADI_SUPABASE_PROJECT_REF })
    };

    const runtime = getSupabaseRuntimeStatus(env);

    expect(runtime.serverWriteReady).toBe(true);
    expect(runtime.serverKeyProfile).toMatchObject({
      sourceEnvKey: "SUPABASE_SERVICE_ROLE_KEY",
      kind: "legacy-service-role-jwt",
      legacyJwtProjectRef: ODDSPADI_SUPABASE_PROJECT_REF
    });
    expect(getSupabaseServerClient(env)).not.toBeNull();
  });

  it("does not fall back to a service-role key from another product", () => {
    const env = {
      SUPABASE_URL: `https://${ODDSPADI_SUPABASE_PROJECT_REF}.supabase.co`,
      SUPABASE_PROJECT_REF: ODDSPADI_SUPABASE_PROJECT_REF,
      SUPABASE_SECRET_KEY: "*******************0",
      SUPABASE_SERVICE_ROLE_KEY: jwt({ role: "service_role", ref: "zpclagtgczsygrgztlts" })
    };

    const runtime = getSupabaseRuntimeStatus(env);

    expect(runtime.serverWriteReady).toBe(false);
    expect(runtime.serverKeyProfile).toMatchObject({
      sourceEnvKey: "SUPABASE_SERVICE_ROLE_KEY",
      legacyJwtProjectRef: "zpclagtgczsygrgztlts"
    });
    expect(getSupabaseServerClient(env)).toBeNull();
  });
});
