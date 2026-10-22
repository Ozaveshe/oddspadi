import { afterEach, describe, expect, it, vi } from "vitest";
const slateRead = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sports/intelligence/pipeline", () => ({ getDailySlate: slateRead }));
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
  slateRead.mockReset();
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
  it.each([
    ["completed", 1, 1, 0, 200, "ready"],
    ["empty", 0, 0, 0, 200, "empty"],
    ["failed", 0, 0, 0, 503, "degraded"],
    ["completed", 1, 0, 0, 503, "degraded"],
    ["completed", 1, 1, 60, 503, "stale"]
  ])("checks public output %s with %i fixtures and %i predictions", async (status, fixtures, predictions, ageMinutes, http, output) => {
    clearReadinessEnv();
    process.env.API_FOOTBALL_KEY = "configured-provider-key";
    process.env.SUPABASE_URL = "https://wncwtzqipnoqwmqlznqn.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_configured_server_key";
    slateRead.mockResolvedValue({
      provider: { status, lastRun: { finishedAt: new Date(Date.now() - Number(ageMinutes) * 60000).toISOString() } },
      fixtures: Array(Number(fixtures)).fill({}), summary: { predictionsGenerated: predictions }
    });
    const response = await GET(new Request("https://oddspadi.example/api/health"));
    expect(response.status).toBe(http);
    expect(await response.json()).toMatchObject({ liveDataReady: http === 200, readiness: { publicOutput: output } });
    expect(slateRead).toHaveBeenCalledWith({ ensure: false });
  });
  it("does not call provider credentials alone live-data ready", async () => {
    clearReadinessEnv();
    process.env.API_FOOTBALL_KEY = "configured-provider-key";

    const response = await GET(new Request("https://oddspadi.example/api/health"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(expect.objectContaining({
      status: "degraded",
      liveDataReady: false,
      readiness: {
        provider: "configured",
        storage: "unconfigured",
        publicOutput: "unavailable"
      }
    }));
  });

  it("does not equate configured credentials with working public output", async () => {
    clearReadinessEnv();
    process.env.API_FOOTBALL_KEY = "configured-provider-key";
    process.env.SUPABASE_URL = "https://wncwtzqipnoqwmqlznqn.supabase.co";
    process.env.SUPABASE_PROJECT_REF = "wncwtzqipnoqwmqlznqn";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_configured_server_key";

    const response = await GET(new Request("https://oddspadi.example/api/health"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual(expect.objectContaining({
      liveDataReady: false,
      readiness: {
        provider: "configured",
        storage: "configured",
        publicOutput: "unavailable"
      }
    }));
  });

  it("does not report masked Netlify secrets as configured storage", async () => {
    clearReadinessEnv();
    process.env.API_FOOTBALL_KEY = "configured-provider-key";
    process.env.SUPABASE_URL = "https://wncwtzqipnoqwmqlznqn.supabase.co";
    process.env.SUPABASE_PROJECT_REF = "wncwtzqipnoqwmqlznqn";
    process.env.SUPABASE_SECRET_KEY = "*******************0";

    const response = await GET(new Request("https://oddspadi.example/api/health"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      liveDataReady: false,
      readiness: { storage: "unconfigured" }
    });
  });

  it("accepts admin detail only through a timing-safe header check", async () => {
    clearReadinessEnv();
    process.env.ODDSPADI_ADMIN_TOKEN = "health-admin-token";

    const queryResponse = await GET(new Request("https://oddspadi.example/api/health?token=health-admin-token"));
    expect(await queryResponse.json()).not.toHaveProperty("providers");

    const headerResponse = await GET(new Request("https://oddspadi.example/api/health", {
      headers: { authorization: "Bearer health-admin-token" }
    }));
    expect(await headerResponse.json()).toHaveProperty("providers");
  });
});
