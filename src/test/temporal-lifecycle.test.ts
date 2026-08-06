import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { fixtureLifecycle, playWindowMs } from "@/lib/sports/lifecycle/fixtureState";
import { priceState, priceTtlMs } from "@/lib/sports/lifecycle/priceState";
import { dayInZone, dayWindow, dayWindowRange, normalizeTimeZone, todayWindow } from "@/lib/time/dayWindow";

/**
 * Time is the one input a test cannot be allowed to read from the machine it
 * runs on. Every instant here is pinned, so a suite that runs at 23:59 in
 * Lagos gets the same answers as one that runs at noon in London.
 */

const at = (iso: string) => new Date(iso);

describe("day windows follow the visitor, not the server", () => {
  it("puts a 22:00 UTC kick-off on tomorrow's board in Sydney and today's in London", () => {
    // The concrete failure: a Sydney visitor was shown a UTC day that, where
    // they were standing, had already ended.
    const kickoff = at("2026-08-06T22:00:00Z");
    expect(dayInZone(kickoff, "Europe/London")).toBe("2026-08-06");
    expect(dayInZone(kickoff, "Australia/Sydney")).toBe("2026-08-07");
    expect(dayInZone(kickoff, "America/Los_Angeles")).toBe("2026-08-06");
  });

  it("starts the Lagos day one hour before the UTC day", () => {
    const window = dayWindow("2026-08-06", "Africa/Lagos");
    expect(window.startUtc.toISOString()).toBe("2026-08-05T23:00:00.000Z");
    expect(window.endUtc.toISOString()).toBe("2026-08-06T23:00:00.000Z");
  });

  it("gives a spring-forward day 23 hours and an autumn day 25", () => {
    // Adding 24 hours to a start instant is the bug this guards. In London on
    // 2026-03-29 the clocks go forward at 01:00; on 2026-10-25 they go back.
    const spring = dayWindow("2026-03-29", "Europe/London");
    const autumn = dayWindow("2026-10-25", "Europe/London");
    const hours = (w: { startUtc: Date; endUtc: Date }) => (w.endUtc.getTime() - w.startUtc.getTime()) / 3_600_000;
    expect(hours(spring)).toBe(23);
    expect(hours(autumn)).toBe(25);
  });

  it("covers a whole local day with no gap and no overlap", () => {
    const first = dayWindow("2026-08-06", "Asia/Kolkata");
    const second = dayWindow("2026-08-07", "Asia/Kolkata");
    expect(first.endUtc.getTime()).toBe(second.startUtc.getTime());
  });

  it("anchors today to the visitor's clock", () => {
    // 2026-08-06 23:30 UTC is already the 7th in Lagos.
    const now = at("2026-08-06T23:30:00Z");
    expect(todayWindow(now, "Africa/Lagos").day).toBe("2026-08-07");
    expect(todayWindow(now, "Europe/London").day).toBe("2026-08-07");
    expect(todayWindow(now, "America/Los_Angeles").day).toBe("2026-08-06");
  });

  it("walks forward and backward from the visitor's today", () => {
    const now = at("2026-08-06T12:00:00Z");
    expect(dayWindowRange(now, "Africa/Lagos", 3).days).toEqual(["2026-08-06", "2026-08-07", "2026-08-08"]);
    expect(dayWindowRange(now, "Africa/Lagos", 3, -3).days).toEqual(["2026-08-03", "2026-08-04", "2026-08-05"]);
  });

  it("falls back to the default rather than throwing on a bad cookie", () => {
    // The timezone arrives from visitor-controlled input; a typo must not be
    // able to blank a server-rendered board.
    expect(normalizeTimeZone("Mars/Olympus_Mons")).toBe("Africa/Lagos");
    expect(normalizeTimeZone("")).toBe("Africa/Lagos");
    expect(normalizeTimeZone(null)).toBe("Africa/Lagos");
    expect(normalizeTimeZone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });
});

describe("fixture state never rests on the clock alone", () => {
  const kickoff = at("2026-08-06T12:00:00Z");
  const base = { sport: "football", kickoffAt: kickoff };

  it("is scheduled before kick-off", () => {
    const state = fixtureLifecycle(base, at("2026-08-06T11:00:00Z"));
    expect(state.state).toBe("scheduled");
    expect(state.actionable).toBe(true);
  });

  it("does not call a match live just because kick-off passed", () => {
    // This is the constraint in the brief. With no provider evidence, the only
    // honest answer is that we are waiting.
    const state = fixtureLifecycle(base, at("2026-08-06T12:30:00Z"));
    expect(state.state).toBe("due");
    expect(state.basis).toBe("no-evidence");
    expect(state.actionable).toBe(false);
  });

  it("does not call a match finished just because the window elapsed", () => {
    const state = fixtureLifecycle(base, at("2026-08-06T18:00:00Z"));
    expect(state.state).toBe("unresolved");
    expect(state.terminal).toBe(false);
    expect(state.overdueByMs).toBe(2 * 60 * 60 * 1000);
  });

  it("goes live on observed start, and finished on observed result", () => {
    const live = fixtureLifecycle({ ...base, startedAt: at("2026-08-06T12:02:00Z") }, at("2026-08-06T12:30:00Z"));
    expect(live.state).toBe("live");
    expect(live.basis).toBe("start-observed");

    const done = fixtureLifecycle(
      { ...base, startedAt: at("2026-08-06T12:02:00Z"), resultedAt: at("2026-08-06T13:55:00Z") },
      at("2026-08-06T14:00:00Z")
    );
    expect(done.state).toBe("finished");
    expect(done.terminal).toBe(true);
  });

  it("lets an observed result outrank a provider status still saying live", () => {
    const state = fixtureLifecycle(
      { ...base, status: "live", resultedAt: at("2026-08-06T13:55:00Z") },
      at("2026-08-06T14:00:00Z")
    );
    expect(state.state).toBe("finished");
  });

  it("distrusts a legacy 'finished' with no score and no result time", () => {
    // History predates `resulted_at`. A status with nothing behind it is the
    // batch job's guess, which is what this replaces.
    const unscored = fixtureLifecycle({ ...base, status: "finished" }, at("2026-08-06T18:00:00Z"));
    expect(unscored.state).toBe("unresolved");

    const scored = fixtureLifecycle(
      { ...base, status: "finished", homeScore: 2, awayScore: 1 },
      at("2026-08-06T18:00:00Z")
    );
    expect(scored.state).toBe("finished");
  });

  it("takes disruptions only from the provider, since no timestamp implies them", () => {
    for (const [status, expected] of [["postponed", "postponed"], ["cancelled", "cancelled"], ["abandoned", "abandoned"]] as const) {
      expect(fixtureLifecycle({ ...base, status }, at("2026-08-06T12:30:00Z")).state).toBe(expected);
    }
  });

  it("gives tennis a longer window than football at the same elapsed time", () => {
    const elapsed = at("2026-08-06T17:00:00Z"); // five hours after kick-off
    expect(fixtureLifecycle({ ...base, sport: "football" }, elapsed).state).toBe("unresolved");
    expect(fixtureLifecycle({ ...base, sport: "tennis" }, elapsed).state).toBe("due");
  });

  it("keeps the TypeScript windows equal to the ones the SQL sweep uses", () => {
    // Two copies of a policy drift. The migration is the other copy.
    const sql = readFileSync("supabase/migrations/20260803150000_expire_stale_fixtures_cte.sql", "utf8");
    const windows = new Map<string, number>();
    for (const match of sql.matchAll(/when\s+'(\w+)'\s+then\s+interval\s+'([^']+)'/g)) {
      const [hours, minutes] = [/(\d+)\s*hour/.exec(match[2])?.[1], /(\d+)\s*minute/.exec(match[2])?.[1]];
      windows.set(match[1], (Number(hours ?? 0) * 60 + Number(minutes ?? 0)) * 60_000);
    }
    expect(windows.size, "no sport windows parsed from the migration").toBeGreaterThan(0);
    for (const [sport, ms] of windows) {
      expect(playWindowMs(sport), `${sport} window differs between SQL and TypeScript`).toBe(ms);
    }
  });
});

describe("price freshness is per sport and per market", () => {
  const kickoff = at("2026-08-06T18:00:00Z");

  it("does not use one threshold for every market", () => {
    // The explicit instruction in the brief.
    const farOut = 6 * 60 * 60 * 1000;
    const budgets = new Set([
      priceTtlMs("football", "1x2", farOut),
      priceTtlMs("football", "totals", farOut),
      priceTtlMs("tennis", "moneyline", farOut),
      priceTtlMs("basketball", "spread", farOut)
    ]);
    expect(budgets.size).toBeGreaterThan(1);
  });

  it("halves the budget inside the last hour", () => {
    expect(priceTtlMs("football", "1x2", 30 * 60_000)).toBe(priceTtlMs("football", "1x2", 6 * 60 * 60_000) / 2);
  });

  it("only lets a fresh price support a claim", () => {
    const facts = { sport: "football", market: "1x2", kickoffAt: kickoff, capturedAt: at("2026-08-06T12:00:00Z") };

    const fresh = priceState({ ...facts, capturedAt: at("2026-08-06T11:55:00Z") }, at("2026-08-06T12:00:00Z"));
    expect(fresh.state).toBe("fresh");
    expect(fresh.supportsClaim).toBe(true);

    const ageing = priceState(facts, at("2026-08-06T12:20:00Z"));
    expect(ageing.state).toBe("ageing");
    expect(ageing.supportsClaim).toBe(false);

    const stale = priceState(facts, at("2026-08-06T13:00:00Z"));
    expect(stale.state).toBe("stale");
    expect(stale.supportsClaim).toBe(false);
  });

  it("closes the market at kick-off however fresh the capture was", () => {
    const state = priceState(
      { sport: "football", market: "1x2", kickoffAt: kickoff, capturedAt: at("2026-08-06T18:00:00Z") },
      at("2026-08-06T18:00:01Z")
    );
    expect(state.state).toBe("closed");
    expect(state.supportsClaim).toBe(false);
  });

  it("honours an explicit expiry ahead of the age budget", () => {
    const state = priceState(
      {
        sport: "football",
        market: "1x2",
        kickoffAt: kickoff,
        capturedAt: at("2026-08-06T11:59:00Z"),
        expiresAt: at("2026-08-06T11:59:30Z")
      },
      at("2026-08-06T12:00:00Z")
    );
    expect(state.state).toBe("expired");
  });
});
