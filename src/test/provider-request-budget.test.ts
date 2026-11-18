import { syncHistoricalFootballProvider } from "@/lib/sports/training/providerSync";
import { describe, expect, it, vi } from "vitest";
import { reserveProviderRequest } from "@/lib/sports/providers/requestBudget";

const env = { ODDS_API_DAILY_CREDIT_CAP: "200", API_FOOTBALL_DAILY_REQUEST_CAP: "70" };
describe("shared daily provider budget", () => {
  it.each([
    ["https://v3.football.api-sports.io/odds?page=4", "api-football", 1, 70],
    ["https://api.the-odds-api.com/v4/sports/test/scores/?daysFrom=3", "the-odds-api", 2, 200],
    ["https://api.the-odds-api.com/v4/historical/sports/test/odds/?regions=us,uk&markets=h2h,spreads,totals", "the-odds-api", 60, 200]
  ] as const)("reserves the cost before dispatch for %s", async (url, provider, units, limit) => {
    const claim = vi.fn(async () => true);
    await reserveProviderRequest(new URL(url), env, claim);
    expect(claim).toHaveBeenCalledWith(provider, units, limit);
  });
  it("refuses an over-budget two-region import before the training job contacts the provider", async () => {
    const upstream = vi.fn(async () => Response.json([]));
    const result = await syncHistoricalFootballProvider({
      request: { provider: "the-odds-api", regions: "uk,eu", dryRun: true },
      env: { THE_ODDS_API_KEY: "offline", ODDS_API_DAILY_CREDIT_CAP: "1" },
      fetchImpl: upstream
    });
    expect(result.status).toBe("provider-error");
    expect(result.reason).toMatch(/daily budget/);
    expect(upstream).not.toHaveBeenCalled();
  });
  it("keeps free discovery available and stops paid reads when the shared counter refuses", async () => {
    const claim = vi.fn(async () => false);
    await reserveProviderRequest(new URL("https://api.the-odds-api.com/v4/sports/epl/events/"), env, claim);
    expect(claim).not.toHaveBeenCalled();
    await expect(reserveProviderRequest(new URL("https://api.the-odds-api.com/v4/sports/epl/odds/"), env, claim)).rejects.toThrow("budget");
  });
});
