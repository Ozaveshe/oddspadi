import { describe, expect, it, vi } from "vitest";
import { runResettle } from "@/lib/publication/resettle";

type Row = Record<string, unknown>;

function stubClient({
  publications,
  results = [],
  rpc = vi.fn().mockResolvedValue({ error: null }),
  resultError = null
}: {
  publications: Row[];
  results?: Row[];
  rpc?: ReturnType<typeof vi.fn>;
  resultError?: { code?: string; message: string } | null;
}) {
  return {
    rpc,
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "not", "order"]) chain[method] = vi.fn(() => chain);
      chain.limit = vi.fn(async () => ({ data: publications, error: null }));
      chain.in = vi.fn(() =>
        table === "op_fixture_results" ? Promise.resolve({ data: results, error: resultError }) : chain
      );
      return chain;
    })
  } as never;
}

const NOW = new Date("2026-08-07T21:00:00.000Z");

function publication(overrides: Row = {}): Row {
  return {
    id: "pub-1",
    fixture_id: "fix-1",
    sport: "football",
    market: "match_winner",
    selection: "draw",
    market_line: null,
    kickoff_at: "2026-08-01T18:00:00.000Z",
    settlement_status: "lost",
    ...overrides
  };
}

/** The cup tie the aggregate-score grader settled wrong. */
function shootoutResult(overrides: Row = {}): Row {
  return {
    id: "res-1",
    fixture_id: "fix-1",
    sport: "football",
    result_status: "finished",
    regulation_home: 1,
    regulation_away: 1,
    extra_time_home: 2,
    extra_time_away: 2,
    shootout_home: 4,
    shootout_away: 3,
    sets_home: null,
    sets_away: null,
    games_home: null,
    games_away: null,
    period_scores: [],
    winner: "home",
    winner_basis: "shootout",
    final_at: "2026-08-01T20:00:00.000Z",
    verification_state: "verified",
    revision: 1,
    ...overrides
  };
}

describe("the dry run", () => {
  it("reports what would change and writes nothing", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const run = await runResettle({
      persist: false,
      now: NOW,
      client: stubClient({ publications: [publication()], results: [shootoutResult()], rpc })
    });

    expect(run.status).toBe("preview");
    expect(run.totals.changed).toBe(1);
    // The draw was settled `lost` against the post-shootout score; on
    // regulation it won.
    expect(run.transitions["lost→won"]).toBe(1);
    expect(run.changes[0]).toMatchObject({
      from: "lost",
      to: "won",
      marketKey: "football.1x2.regulation",
      basis: "regulation"
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("leaves a verdict the canonical rules agree with alone", async () => {
    const run = await runResettle({
      persist: false,
      now: NOW,
      client: stubClient({ publications: [publication({ settlement_status: "won" })], results: [shootoutResult()] })
    });
    expect(run.totals.unchanged).toBe(1);
    expect(run.totals.changed).toBe(0);
    expect(run.changes).toEqual([]);
  });
});

describe("what it will not revoke", () => {
  it("leaves a verdict standing when there is no canonical result", async () => {
    // Revoking a public verdict in favour of nothing is worse than leaving one
    // produced by the old rules.
    const run = await runResettle({
      persist: false,
      now: NOW,
      client: stubClient({ publications: [publication()], results: [] })
    });
    expect(run.totals.awaitingResult).toBe(1);
    expect(run.totals.changed).toBe(0);
  });

  it("leaves a verdict standing when the result is not verified", async () => {
    const run = await runResettle({
      persist: false,
      now: NOW,
      client: stubClient({
        publications: [publication()],
        results: [shootoutResult({ verification_state: "conflicted" })]
      })
    });
    expect(run.totals.awaitingResult).toBe(1);
  });

  it("counts a market it cannot grade as ungradeable rather than changing it", async () => {
    const run = await runResettle({
      persist: false,
      now: NOW,
      client: stubClient({
        publications: [publication({ market: "corners", selection: "over_95" })],
        results: [shootoutResult()]
      })
    });
    expect(run.totals.ungradeable).toBe(1);
    expect(run.totals.changed).toBe(0);
  });

  it("does not void a settled claim the engine declines to grade", async () => {
    // needs_review on an already-settled claim is a finding for an operator,
    // not a licence to void a public verdict.
    const run = await runResettle({
      persist: false,
      now: NOW,
      client: stubClient({
        publications: [publication({ market: "asian_handicap", selection: "home", market_line: null })],
        results: [shootoutResult()]
      })
    });
    expect(run.totals.ungradeable).toBe(1);
    expect(run.changes).toEqual([]);
  });
});

describe("the commit", () => {
  it("supersedes through op_settle_publication with the rule version as the reason", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const run = await runResettle({
      persist: true,
      now: NOW,
      client: stubClient({ publications: [publication()], results: [shootoutResult()], rpc })
    });

    expect(run.status).toBe("committed");
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe("op_settle_publication");
    expect(args.p_status).toBe("won");
    expect(args.p_resolution_basis.supersedes).toBe("lost");
    expect(args.p_resolution_basis.ruleVersion).toBe("2026-08-07.1");
    expect(args.p_resolution_basis.correction).toContain("aggregate final score");
    expect(args.p_resolution_basis.settledBy).toBe("canonical-resettle");
  });

  it("never writes to op_publications", async () => {
    // The claim's odds, probability and timestamp are immutable. Only the
    // verdict moves.
    const from = vi.fn();
    const client = stubClient({ publications: [publication()], results: [shootoutResult()] }) as unknown as {
      from: typeof from;
    };
    await runResettle({ persist: true, now: NOW, client: client as never });
    const written = (client.from as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0]);
    // Reads from op_publications are fine; the guarantee is that no update or
    // insert is issued against it, which this module has no code path for.
    expect(written).toContain("op_publications");
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/lib/publication/resettle.ts", "utf8")
    );
    expect(source).not.toMatch(/from\("op_publications"\)\s*\.\s*(update|insert|upsert)/);
  });

  it("counts a failed write without counting it as unchanged", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "constraint violation" } });
    const run = await runResettle({
      persist: true,
      now: NOW,
      client: stubClient({ publications: [publication()], results: [shootoutResult()], rpc })
    });
    expect(run.status).toBe("partial");
    expect(run.totals.failed).toBe(1);
    expect(run.errors[0]).toContain("constraint violation");
  });
});

describe("failure states", () => {
  it("reports not-migrated rather than an empty diff", async () => {
    const run = await runResettle({
      persist: false,
      now: NOW,
      client: stubClient({
        publications: [publication()],
        resultError: { code: "42P01", message: 'relation "op_fixture_results" does not exist' }
      })
    });
    expect(run.status).toBe("not-migrated");
    expect(run.totals.changed).toBe(0);
  });

  it("reports a denied read as unavailable", async () => {
    const run = await runResettle({
      persist: false,
      now: NOW,
      client: stubClient({
        publications: [publication()],
        resultError: { code: "42501", message: "permission denied" }
      })
    });
    expect(run.status).toBe("unavailable");
  });

  it("is unavailable when storage is not configured", async () => {
    expect((await runResettle({ client: null, now: NOW })).status).toBe("unavailable");
  });
});
