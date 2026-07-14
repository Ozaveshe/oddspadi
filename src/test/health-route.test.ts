import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/route";

const ENV_KEYS = [
  "API_FOOTBALL_KEY",
  "APISPORTS_KEY",
  "SPORTS_API_KEY",
  "THE_ODDS_API_KEY",
  "ODDS_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_PROJECT_REF",
  "ODDSPADI_ADMIN_TOKEN"
] as const;

const originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function clearReadinessEnv() {
  for (const key of ENV_KEYS) delete process.env[key];
}

describe("health route live-data readiness", () => {
  it("does not call provider credentials alone live-data ready", async () => {
    clearReadinessEnv();
    process.env.API_FOOTBALL_KEY = "configured-provider-key";

    const response = GET(new Request("https://oddspadi.example/api/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      status: "ok",
      liveDataReady: false,
      readiness: {
        provider: "configured",
        storage: "unconfigured",
        publicOutput: "not-checked"
      }
    }));
  });

  it("requires provider and private storage configuration together", async () => {
    clearReadinessEnv();
    process.env.API_FOOTBALL_KEY = "configured-provider-key";
    process.env.SUPABASE_URL = "https://wncwtzqipnoqwmqlznqn.supabase.co";
    process.env.SUPABASE_PROJECT_REF = "wncwtzqipnoqwmqlznqn";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_configured_server_key";

    const response = GET(new Request("https://oddspadi.example/api/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({
      liveDataReady: true,
      readiness: {
        provider: "configured",
        storage: "configured",
        publicOutput: "not-checked"
      }
    }));
  });

  it("does not report masked Netlify secrets as configured storage", async () => {
    clearReadinessEnv();
    process.env.API_FOOTBALL_KEY = "configured-provider-key";
    process.env.SUPABASE_URL = "https://wncwtzqipnoqwmqlznqn.supabase.co";
    process.env.SUPABASE_PROJECT_REF = "wncwtzqipnoqwmqlznqn";
    process.env.SUPABASE_SECRET_KEY = "*******************0";

    const response = GET(new Request("https://oddspadi.example/api/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      liveDataReady: false,
      readiness: { storage: "unconfigured" }
    });
  });
});
