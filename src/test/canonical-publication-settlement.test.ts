import { describe, expect, it, vi } from "vitest";
import { runCanonicalPublicationSettlement } from "@/lib/publication/canonicalSettlement";

/**
 * Settling published claims from canonical results rather than an aggregate
 * final score.
 *
 * The failure being closed: a cup tie decided on penalties settled 1X2 against
 * the post-shootout result. Correct for a match that went the regulation
 * distance, wrong for one that did not, and silent either way.
 */

type Row = Record<string, unknown>;

function stubClient({
  publications,
  results,
  rpc = vi.fn().mockResolvedValue({ error: null })
}: {
  publications: Row[];
  results: Row[];
  rpc?: ReturnType<typeof vi.fn>;
}) {
  const builder = (rows: Row[], terminalOn: "limit" | "in") => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "in", "eq", "lt", "order", "limit"]) {
      chain[method] = vi.fn(() => chain);
    }
    if (terminalOn === "limit") {
      chain.limit = vi.fn(async () => ({ data: rows, error: null }));
    } else {
      chain.in = vi.fn((column: string) =>
        column === "fixture_id" ? Promise.resolve({ data: rows, error: null }) : chain
      );
    }
    return chain;
  };
  return {
    from: vi.fn((table: string) =>
      table === "op_publications" ? builder(publications, "limit") : builder(results, "in")
    ),
    rpc
  } as never;
}

const KICKOFF = "2026-08-06T18:00:00.000Z";
const NOW = new Date("2026-08-06T21:00:00.000Z");

function publication(overrides: Row = {}): Row {
  return {
    id: "pub-1",
    fixture_id: "fix-1",
    sport: "football",
    market: "match_winner",
    selection: "home",
    market_line: null,
    kickoff_at: KICKOFF,
    ...overrides
  };
}

function result(overrides: Row = {}): Row {
  return {
    id: "res-1",
    fixture_id: "fix-1",
    sport: "football",
    result_status: "finished",
    regulation_home: 2,
    regulation_away: 1,
    extra_time_home: null,
    extra_time_away: null,
    shootout_home: null,
    shootout_away: null,
    sets_home: null,
    sets_away: null,
    games_home: null,
    games_away: null,
    period_scores: [],
    winner: "home",
    winner_basis: "regulation",
    final_at: KICKOFF,
    verification_state: "verified",
    revision: 1,
    ...overrides
  };
}

function run(publications: Row[], results: Row[], rpc = vi.fn().mockResolvedValue({ error: null })) {
  return runCanonicalPublicationSettlement({
    persist: true,
    now: NOW,
    client: stubClient({ publications, results, rpc })
  });
}

describe("canonical settlement", () => {
  it("grades a win and records the market key, rule version and basis", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const outcome = await run([publication()], [result()], rpc);

    expect(outcome.status).toBe("completed");
    expect(outcome.totals.won).toBe(1);
    expect(outcome.totals.settled).toBe(1);

    const basis = rpc.mock.calls[0]![1].p_resolution_basis;
    expect(rpc.mock.calls[0]![1].p_status).toBe("won");
    expect(basis.marketKey).toBe("football.1x2.regulation");
    expect(basis.ruleVersion).toBe("2026-08-07.1");
    expect(basis.settlementBasis).toBe("regulation");
    expect(basis.resultRevision).toBe(1);
    expect(basis.settledBy).toBe("canonical-publication-settlement");
  });

  it("settles a penalty shootout tie as a regulation draw", async () => {
    // The verdict the aggregate-score grader got wrong.
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const outcome = await run(
      [publication({ selection: "draw" })],
      [
        result({
          regulation_home: 1,
          regulation_away: 1,
          extra_time_home: 2,
          extra_time_away: 2,
          shootout_home: 4,
          shootout_away: 3,
          winner: "home",
          winner_basis: "shootout"
        })
      ],
      rpc
    );
    expect(outcome.totals.won).toBe(1);
    expect(rpc.mock.calls[0]![1].p_status).toBe("won");
    expect(rpc.mock.calls[0]![1].p_resolution_basis.winnerBasis).toBe("shootout");
  });

  it("persists a half win with its own status rather than rounding it", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const outcome = await run(
      [publication({ market: "asian_handicap", selection: "home", market_line: 0.25 })],
      [result({ regulation_home: 1, regulation_away: 1, winner: "draw", winner_basis: "regulation" })],
      rpc
    );
    expect(outcome.totals.half_won).toBe(1);
    expect(rpc.mock.calls[0]![1].p_status).toBe("half_won");
  });
});

describe("what it refuses to settle", () => {
  it("waits on an unverified result whatever the score says", async () => {
    for (const state of ["provisional", "conflicted", "manual_review"]) {
      const rpc = vi.fn().mockResolvedValue({ error: null });
      const outcome = await run([publication()], [result({ verification_state: state })], rpc);
      expect(outcome.totals.awaitingResult).toBe(1);
      expect(outcome.totals.settled).toBe(0);
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("raises unknown_market instead of voiding a market it cannot read", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const outcome = await run([publication({ market: "corners", selection: "over_95" })], [result()], rpc);

    expect(outcome.totals.unknownMarket).toBe(1);
    expect(outcome.totals.void).toBe(0);
    expect(outcome.exceptions[0]).toMatchObject({ kind: "unknown_market", publicationId: "pub-1" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("raises unknown_market for a spread with no stored line", async () => {
    // Inventing a line here would turn an honest gap into a wrong verdict.
    const outcome = await run(
      [publication({ sport: "basketball", market: "spread", selection: "home_cover", market_line: null })],
      [result({ sport: "basketball" })]
    );
    expect(outcome.totals.unknownMarket).toBe(1);
  });

  it("waits when the fixture has no canonical result at all", async () => {
    const outcome = await run([publication(), publication({ id: "pub-2", fixture_id: "fix-2" })], [result()]);
    expect(outcome.totals.awaitingResult).toBe(1);
    expect(outcome.totals.settled).toBe(1);
  });
});

describe("the sequencing requirement is loud", () => {
  it("says the results store is unpopulated rather than reporting a clean empty run", async () => {
    // An unpopulated store and a batch genuinely awaiting results produce
    // identical totals. Reporting "completed, 0 settled" here is the failure
    // this codebase keeps rediscovering.
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const outcome = await run([publication()], [], rpc);

    expect(outcome.status).toBe("canonical-results-missing");
    expect(outcome.totals.awaitingResult).toBe(1);
    expect(outcome.errors[0]).toContain("no fallback");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("has no fallback to the aggregate-score grader", async () => {
    // A fallback would keep the wrong-basis path alive under a name that says
    // it was fixed, on exactly the fixtures it handles worst.
    const outcome = await run([publication()], []);
    expect(outcome.totals.won).toBe(0);
    expect(outcome.status).not.toBe("completed");
  });

  it("reports a preview without writing", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const outcome = await runCanonicalPublicationSettlement({
      persist: false,
      now: NOW,
      client: stubClient({ publications: [publication()], results: [result()], rpc })
    });
    expect(outcome.status).toBe("preview");
    expect(outcome.totals.won).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("does not count a failed write as settled", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "constraint violation" } });
    const outcome = await run([publication()], [result()], rpc);
    expect(outcome.status).toBe("partial");
    expect(outcome.totals.settled).toBe(0);
    expect(outcome.totals.won).toBe(0);
    expect(outcome.errors[0]).toContain("constraint violation");
  });

  it("is unavailable rather than clean when storage is not configured", async () => {
    const outcome = await runCanonicalPublicationSettlement({ client: null, now: NOW });
    expect(outcome.status).toBe("unavailable");
    expect(outcome.totals.settled).toBe(0);
  });

  it("treats a not-yet-created results table as a migration state, not a failure", async () => {
    // Shipping ahead of the migration must not 503 the settle-results cron and
    // take the transitional pass down with it.
    const client = {
      from: vi.fn((table: string) => {
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "eq", "lt", "order"]) chain[method] = vi.fn(() => chain);
        chain.limit = vi.fn(async () => ({ data: [publication()], error: null }));
        chain.in = vi.fn(() =>
          table === "op_fixture_results"
            ? Promise.resolve({
                data: null,
                error: { code: "42P01", message: 'relation "op_fixture_results" does not exist' }
              })
            : chain
        );
        return chain;
      }),
      rpc: vi.fn()
    } as never;

    const outcome = await runCanonicalPublicationSettlement({ persist: true, now: NOW, client });
    expect(outcome.status).toBe("canonical-results-missing");
    expect(outcome.errors[0]).toContain("Apply the migration");
  });

  it("still reports a permission failure as unavailable", async () => {
    // A denied read and an empty table return the same rows and opposite
    // conclusions; only the missing relation is forgiven.
    const client = {
      from: vi.fn((table: string) => {
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "eq", "lt", "order"]) chain[method] = vi.fn(() => chain);
        chain.limit = vi.fn(async () => ({ data: [publication()], error: null }));
        chain.in = vi.fn(() =>
          table === "op_fixture_results"
            ? Promise.resolve({ data: null, error: { code: "42501", message: "permission denied" } })
            : chain
        );
        return chain;
      }),
      rpc: vi.fn()
    } as never;

    const outcome = await runCanonicalPublicationSettlement({ persist: true, now: NOW, client });
    expect(outcome.status).toBe("unavailable");
  });
});
