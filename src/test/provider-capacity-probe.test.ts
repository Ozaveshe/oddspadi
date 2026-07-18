import { describe, expect, it, vi } from "vitest";
import { buildProviderCapacityProbe } from "@/lib/sports/training/providerCapacityProbe";

describe("provider capacity probe", () => {
  it("previews configuration without making provider calls or exposing keys", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const probe = await buildProviderCapacityProbe({
      env: { API_FOOTBALL_KEY: "football-secret", API_BASKETBALL_KEY: "basketball-secret" },
      fetchImpl,
      now: new Date("2026-07-18T16:00:00Z")
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(probe.providers.map((provider) => provider.status)).toEqual(["configured", "configured"]);
    expect(JSON.stringify(probe)).not.toContain("football-secret");
    expect(JSON.stringify(probe)).not.toContain("basketball-secret");
  });

  it("returns sanitized plan and quota evidence for both production providers", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const football = String(input).includes("football");
      return Response.json(
        {
          response: {
            subscription: { plan: football ? "Pro" : "Ultra", active: true, end: "2026-12-31" },
            requests: { current: football ? 125 : 220, limit_day: football ? 7_500 : 75_000 }
          },
          errors: {}
        },
        { status: 200, headers: { "x-ratelimit-limit": "300", "x-ratelimit-remaining": "299" } }
      );
    });
    const probe = await buildProviderCapacityProbe({
      env: { API_FOOTBALL_KEY: "football-secret", API_BASKETBALL_KEY: "basketball-secret" },
      runRequested: true,
      fetchImpl
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(probe.providers[0]).toMatchObject({
      provider: "api-football",
      status: "active",
      subscription: { plan: "Pro", active: true },
      dailyQuota: { used: 125, limit: 7_500, remaining: 7_375 }
    });
    expect(probe.providers[1]).toMatchObject({
      provider: "api-basketball",
      status: "active",
      subscription: { plan: "Ultra", active: true },
      dailyQuota: { used: 220, limit: 75_000, remaining: 74_780 }
    });
    expect(JSON.stringify(probe)).not.toContain("football-secret");
    expect(JSON.stringify(probe)).not.toContain("basketball-secret");
  });

  it("keeps provider failures isolated and reports missing keys honestly", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ errors: { token: "Invalid provider token" } }, { status: 403 }));
    const probe = await buildProviderCapacityProbe({
      env: { API_FOOTBALL_KEY: "football-secret" },
      runRequested: true,
      fetchImpl
    });

    expect(probe.providers[0]).toMatchObject({ status: "provider-error", httpStatus: 403, providerErrors: ["Invalid provider token"] });
    expect(probe.providers[1]).toMatchObject({ status: "missing-key", requestAttempted: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
