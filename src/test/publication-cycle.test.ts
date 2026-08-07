import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MAX_PLAUSIBLE_EDGE,
  computeBands,
  evaluatePublicationCycle,
  runPublicationCycle,
  type DecisionRow,
  type FixtureRow
} from "@/lib/publication/runPublicationCycle";
import { runPublicationWorker } from "../../netlify/functions/publication-worker-background";
import type { BandEvidence } from "@/lib/accumulator/calibratedBands";

/**
 * The ledger held 230 rows, every one stamped 2026-08-03 inside a 51-second
 * window, while the decision engine kept producing ~28k qualifying decisions
 * every twelve hours. The gate was never the problem: `op_publish_pick` simply
 * had no caller but a CLI somebody ran once by hand.
 */

const NOW = new Date("2026-08-07T12:00:00.000Z");

/** A well-measured band and an unmeasured one, shaped like production's. */
const BANDS: BandEvidence[] = [
  { lowerBound: 0.4, upperBound: 0.5, settledSize: 217, calibrationGap: 0.007 },
  { lowerBound: 0.5, upperBound: 0.6, settledSize: 221, calibrationGap: 0.024 },
  { lowerBound: 0.8, upperBound: 0.9, settledSize: 7, calibrationGap: 0.259 }
];

const FIXTURE: FixtureRow = {
  id: "fixture-1",
  external_id: "ext-1",
  league_name: "WTA Canadian Open",
  kickoff_at: "2026-08-07T18:00:00.000Z",
  status: "scheduled"
};

function decision(overrides: Partial<DecisionRow> = {}): DecisionRow {
  return {
    fixture_id: "fixture-1",
    fixture_external_id: "ext-1",
    sport: "tennis",
    market: "match_winner",
    selection: "home",
    model_probability: 0.55,
    implied_probability: 0.5,
    no_vig_probability: 0.48,
    odds_snapshot_id: null,
    engine_version: "decision-engine-v2",
    data_quality: "complete",
    generated_at: "2026-08-07T11:30:00.000Z",
    ...overrides
  };
}

function run(
  decisions: DecisionRow[],
  {
    fixtures = [FIXTURE],
    approved = ["tennis"],
    alreadyPublished = new Set<string>(),
    cap = 400
  }: { fixtures?: FixtureRow[]; approved?: string[]; alreadyPublished?: Set<string>; cap?: number } = {}
) {
  return evaluatePublicationCycle({
    decisions,
    fixtures: new Map(fixtures.map((fixture) => [fixture.id, fixture])),
    bandsBySport: new Map([["tennis", BANDS]]),
    approvedSports: new Set(approved),
    alreadyPublished,
    cap,
    now: NOW
  });
}

describe("publication gates", () => {
  it("publishes a decision that clears every gate", () => {
    const result = run([decision()]);
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].edge).toBeCloseTo(0.07, 10);
    expect(result.rejections).toEqual({});
  });

  it("refuses a sport with no approved calibration promotion", () => {
    const result = run([decision({ sport: "tennis" })], { approved: [] });
    expect(result.selected).toHaveLength(0);
    expect(result.rejections["no approved calibration promotion for tennis"]).toBe(1);
  });

  it("refuses a pick whose kickoff has passed, because that is not a forecast", () => {
    const started = { ...FIXTURE, kickoff_at: "2026-08-07T09:00:00.000Z" };
    const result = run([decision()], { fixtures: [started] });
    expect(result.selected).toHaveLength(0);
    expect(result.rejections["kickoff has passed"]).toBe(1);
  });

  it("refuses a fixture that is no longer scheduled", () => {
    const result = run([decision()], { fixtures: [{ ...FIXTURE, status: "postponed" }] });
    expect(result.rejections["fixture is not scheduled"]).toBe(1);
  });

  it("refuses an edge measured against a vigged price", () => {
    const result = run([decision({ no_vig_probability: null })]);
    expect(result.rejections["no margin-free price, so edge cannot be separated from the bookmaker's margin"]).toBe(1);
  });

  it("refuses a band with too little settled evidence to mean anything", () => {
    // p80-90 read 57% on seven outcomes: neither evidence the model works nor
    // that it is broken.
    const result = run([decision({ model_probability: 0.85, no_vig_probability: 0.5 })]);
    expect(result.selected).toHaveLength(0);
    expect(Object.keys(result.rejections)[0]).toMatch(/only 7 settled outcomes/);
  });

  it("requires the edge to clear the premium its own band carries", () => {
    // The p50-60 band is off by 2.4%, so a 2% edge cannot support a claim.
    const result = run([decision({ model_probability: 0.55, no_vig_probability: 0.53 })]);
    expect(result.rejections["edge does not clear the band premium"]).toBe(1);
  });

  it("treats an implausibly large edge as a model fault rather than value", () => {
    const result = run([decision({ model_probability: 0.55, no_vig_probability: 0.2 })]);
    expect(result.selected).toHaveLength(0);
    expect(Object.keys(result.rejections)[0]).toMatch(/exceeds the 20% plausibility ceiling/);
    expect(MAX_PLAUSIBLE_EDGE).toBe(0.2);
  });
});

describe("one claim per fixture-market", () => {
  it("never publishes both sides of the same market", () => {
    const result = run([
      decision({ selection: "home", model_probability: 0.55, no_vig_probability: 0.48 }),
      decision({ selection: "away", model_probability: 0.45, no_vig_probability: 0.42 })
    ]);
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].row.selection).toBe("home");
    expect(result.rejections["another selection in this market carries a larger edge"]).toBe(1);
  });

  it("keeps the larger edge regardless of the order rows arrive in", () => {
    const smaller = decision({ selection: "away", model_probability: 0.45, no_vig_probability: 0.42 });
    const larger = decision({ selection: "home", model_probability: 0.55, no_vig_probability: 0.48 });
    expect(run([smaller, larger]).selected[0].row.selection).toBe("home");
    expect(run([larger, smaller]).selected[0].row.selection).toBe("home");
  });
});

describe("repeat runs", () => {
  it("marks a claim that is already live so an hourly pass does not churn the ledger", () => {
    // The schedule re-reads the same slate every hour. Without this the worker
    // would re-call the RPC for every live claim to be told it already exists.
    const result = run([decision()], { alreadyPublished: new Set(["fixture-1::match_winner::home"]) });
    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].alreadyLive).toBe(true);
  });

  it("holds the run inside the blast-radius cap", () => {
    const decisions = Array.from({ length: 5 }, (_, index) =>
      decision({ market: `market-${index}`, model_probability: 0.55, no_vig_probability: 0.45 })
    );
    const result = run(decisions, { cap: 2 });
    expect(result.selected).toHaveLength(5);
    expect(result.capped).toHaveLength(2);
  });
});

describe("band derivation", () => {
  it("measures each decile's sample and the gap between predicted and realised", () => {
    const outcomes = [
      ...Array.from({ length: 6 }, () => ({ model_probability: 0.55, result: "won" })),
      ...Array.from({ length: 4 }, () => ({ model_probability: 0.55, result: "lost" }))
    ];
    const band = computeBands(outcomes).find((entry) => entry.lowerBound === 0.5)!;
    expect(band.settledSize).toBe(10);
    // Claimed 55%, realised 60%.
    expect(band.calibrationGap).toBeCloseTo(0.05, 10);
  });

  it("reports an empty decile as unmeasured rather than perfect", () => {
    const band = computeBands([]).find((entry) => entry.lowerBound === 0.9)!;
    expect(band.settledSize).toBe(0);
    expect(band.calibrationGap).toBeNull();
  });
});

describe("publication worker", () => {
  it("refuses to run without a valid schedule token", async () => {
    expect((await runPublicationWorker({ adminToken: null, scheduleToken: null })).status).toBe(503);
    expect((await runPublicationWorker({ adminToken: "token", scheduleToken: null })).status).toBe(401);
    expect((await runPublicationWorker({ adminToken: "token", scheduleToken: "wrong" })).status).toBe(401);
  });

  it("reports a disabled kill switch as a halt rather than a failure", async () => {
    const client = {
      from: () => ({
        select: () => ({
          maybeSingle: async () => ({ data: { publishing_enabled: false, disabled_reason: "under review" }, error: null })
        })
      })
    };
    const response = await runPublicationWorker({
      adminToken: "token",
      scheduleToken: "token",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: client as any
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { haltedReason: string; published: number };
    expect(body.haltedReason).toMatch(/publishing is disabled — under review/);
    expect(body.published).toBe(0);
  });
});

describe("transient database losses", () => {
  /**
   * PostgREST cancels a statement at 8 seconds and the decision table is under
   * write load for much of most minutes. A real dry run hit `canceling
   * statement due to statement timeout` on one attempt and returned identical
   * counts on the next; on an hourly schedule, not retrying means a lost hour.
   */
  function clientThatFailsFirst(message: string, attempts: { count: number }) {
    /** Chainable stub: every filter returns itself, awaiting yields `rows`. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    function builder(rows: unknown[], onRange?: () => Promise<unknown>): any {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const self: any = {
        then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
        range: onRange ?? (() => Promise.resolve({ data: rows, error: null }))
      };
      for (const method of ["select", "eq", "in", "not", "gte", "lt", "order", "limit"]) {
        self[method] = () => self;
      }
      return self;
    }

    return {
      from: (table: string) => {
        if (table === "op_publication_controls") {
          return {
            select: () => ({
              maybeSingle: async () => ({ data: { publishing_enabled: true, max_publications_per_run: 400 }, error: null })
            })
          };
        }
        if (table === "op_calibration_promotions") {
          return builder([{ sport: "tennis", model_key: "tennis-surface-elo-v5", engine_version: "v2" }]);
        }
        if (table === "op_prediction_outcomes") {
          // Fail the first attempt, succeed on the retry.
          return builder([], () => {
            attempts.count += 1;
            return Promise.resolve(attempts.count === 1 ? { data: null, error: { message } } : { data: [], error: null });
          });
        }
        return builder([]);
      }
    };
  }

  it("retries a statement timeout instead of losing the run", async () => {
    const attempts = { count: 0 };
    const result = await runPublicationCycle({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      client: clientThatFailsFirst("canceling statement due to statement timeout", attempts) as any,
      now: NOW,
      waitMs: async () => {}
    });
    expect(attempts.count).toBe(2);
    expect(result.haltedReason).toBeNull();
  });

  it("does not retry an error that will fail the same way every time", async () => {
    const attempts = { count: 0 };
    await expect(
      runPublicationCycle({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        client: clientThatFailsFirst('column "nope" does not exist', attempts) as any,
        now: NOW,
        waitMs: async () => {}
      })
    ).rejects.toThrow(/does not exist/);
    expect(attempts.count).toBe(1);
  });
});

describe("the publisher is actually scheduled", () => {
  /**
   * The whole outage was the absence of this. The ledger cannot accumulate from
   * a job that only a human ever starts, so the schedule is the regression to
   * guard, not the gate.
   */
  it("has a scheduled sweep that invokes the publication worker", async () => {
    const source = await readFile(join("netlify/functions", "publication-sweep.ts"), "utf8");
    expect(source).toMatch(/schedule:\s*"[^"]+"/);
    expect(source).toContain("/.netlify/functions/publication-worker-background");
  });

  it("keeps the authorization check on the worker, never on the sweep", async () => {
    // A scheduled function cannot verify a token it also supplies. Putting the
    // check on the sweep half froze the projection refresh for 8.5 hours.
    const sweep = await readFile(join("netlify/functions", "publication-sweep.ts"), "utf8");
    const worker = await readFile(join("netlify/functions", "publication-worker-background.ts"), "utf8");
    expect(sweep).not.toContain("timingSafeEqual");
    expect(worker).toContain("timingSafeEqual");
  });

  it("leaves no second copy of the gate outside the shared module", async () => {
    // The CLI used to carry its own plain-JS implementation of these rules.
    const scripts = await readdir("scripts");
    expect(scripts).not.toContain("run-publisher.mjs");
    const cli = await readFile(join("scripts", "run-publisher.ts"), "utf8");
    expect(cli).toContain("runPublicationCycle");
    expect(cli).not.toContain("MIN_BAND_SAMPLE");
  });
});
