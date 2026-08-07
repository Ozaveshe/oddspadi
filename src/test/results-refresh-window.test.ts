import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The defect these tests pin is a direction-of-time error, not a broken query.
 *
 * `utcDateWindow(start, count, offsetDays)` walks forward from today's UTC
 * midnight, and every pipeline job passed `offsetDays = 0`. So a fixture was
 * written while it was still upcoming and then never asked about again. When it
 * kicked off, finished and got a scoreline, nothing re-read it — the row kept
 * `scheduled` forever.
 *
 * Measured in production on 2026-08-03: 1,929 fixtures past kickoff and still
 * `scheduled`, the oldest by 22 days. They never reached the results tally
 * because no job ever looked backwards.
 */

const mocks = vi.hoisted(() => ({
  getFixtures: vi.fn(),
  getPredictions: vi.fn(),
  startProviderRun: vi.fn(),
  persistFixturesAndOdds: vi.fn(),
  rpc: vi.fn()
}));

vi.mock("@/lib/sports/service", () => ({
  getPredictions: mocks.getPredictions,
  sportsProvider: { getFixtures: mocks.getFixtures }
}));
vi.mock("@/lib/sports/providers/providerBackedProvider", () => ({
  getRecentSportsProviderIssues: vi.fn(() => []),
  getSportsProviderRuntimeStatus: vi.fn(() => ({ liveRuntimeBacked: true }))
}));
vi.mock("@/lib/supabase/server", () => ({
  getSupabaseRuntimeStatus: vi.fn(() => ({ serverWriteReady: false })),
  getSupabaseServerClient: vi.fn(() => ({ rpc: mocks.rpc }))
}));
vi.mock("@/lib/sports/intelligence/repository", () => ({
  finishProviderRun: vi.fn(),
  persistFixturesAndOdds: mocks.persistFixturesAndOdds,
  persistMarketDecisions: vi.fn(),
  persistDecisionSummaries: vi.fn(),
  readFreshStoredOdds: vi.fn(),
  readStoredSlate: vi.fn(),
  startProviderRun: mocks.startProviderRun
}));
vi.mock("@/lib/sports/results/publicPicks", () => ({ persistCanonicalPublicPicks: vi.fn() }));

import { refreshResults } from "@/lib/sports/intelligence/pipeline";
import { expireStaleFixtures } from "@/lib/sports/results/staleFixtures";

const NOW = new Date("2026-08-03T09:00:00.000Z");

function requestedDates(): string[] {
  return [...new Set(mocks.getFixtures.mock.calls.map((call) => String(call[0])))].sort();
}

describe("the results pass reads days that have already happened", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFixtures.mockResolvedValue([]);
  });

  it("asks for past dates, never the future", async () => {
    await refreshResults({ now: NOW, sports: ["football"], lookbackDays: 3, persist: false });

    const dates = requestedDates();
    expect(dates).toEqual(["2026-07-31", "2026-08-01", "2026-08-02"]);
    for (const date of dates) expect(date < "2026-08-03").toBe(true);
  });

  it("stops at yesterday, because the daily engine already re-reads today", async () => {
    await refreshResults({ now: NOW, sports: ["football"], lookbackDays: 5, persist: false });

    expect(requestedDates()).not.toContain("2026-08-03");
    expect(requestedDates().at(-1)).toBe("2026-08-02");
  });

  it("spends one provider call per day per sport and no prediction calls", async () => {
    // generateDecisions:false takes the fixtures endpoint and reads odds off the
    // same payload. Going down the predictions path would re-price matches that
    // have already been played, and cost odds quota to do it.
    await refreshResults({ now: NOW, sports: ["football", "basketball"], lookbackDays: 3, persist: false });

    expect(mocks.getFixtures).toHaveBeenCalledTimes(6);
    expect(mocks.getPredictions).not.toHaveBeenCalled();
  });

  it("bounds the lookback so an operator cannot ask for a year of provider calls", async () => {
    await refreshResults({ now: NOW, sports: ["football"], lookbackDays: 365, persist: false });

    expect(requestedDates()).toHaveLength(30);
  });
});

describe("stale expiry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("previews without committing by default", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ sport: "football", quarantined: 1172, oldest_hours: "542.7" }], error: null });

    const result = await expireStaleFixtures({ now: NOW });

    expect(mocks.rpc).toHaveBeenCalledWith("op_expire_stale_fixtures", { p_commit: false });
    expect(result.status).toBe("preview");
    expect(result.committed).toBe(false);
    expect(result.total).toBe(1172);
    expect(result.bySport[0].oldestHours).toBeCloseTo(542.7, 1);
  });

  it("commits only when asked", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });

    const result = await expireStaleFixtures({ now: NOW, commit: true });

    expect(mocks.rpc).toHaveBeenCalledWith("op_expire_stale_fixtures", { p_commit: true });
    expect(result.status).toBe("completed");
    expect(result.total).toBe(0);
  });

  it("reports an error rather than a clean zero", async () => {
    // A failed sweep that returns "0 expired" reads identically to a healthy
    // board with nothing to clear. It must not.
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "statement timeout" } });

    const result = await expireStaleFixtures({ now: NOW, commit: true });

    expect(result.status).toBe("unavailable");
    expect(result.errors).toEqual(["statement timeout"]);
  });
});
