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
});
