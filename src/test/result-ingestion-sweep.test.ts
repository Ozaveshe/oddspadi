import { describe, expect, it, vi } from "vitest";
import { runResultIngestion } from "@/lib/results/ingestionSweep";

type Row = Record<string, unknown>;

/**
 * The sweep is deliberately thin — every judgement lives in
 * `decideResultIngestion`, which is tested without a database. These cover what
 * the sweep itself owns: which observations it assembles, and what it does with
 * a read that fails.
 */
function stubClient({
  fixtures,
  results = [],
  payloads = [],
  rpc = vi.fn().mockResolvedValue({ error: null }),
  payloadError = null,
  fixtureError = null
}: {
  fixtures: Row[];
  results?: Row[];
  payloads?: Row[];
  rpc?: ReturnType<typeof vi.fn>;
  payloadError?: { message: string } | null;
  fixtureError?: { message: string } | null;
}) {
  const chainFor = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "lt", "order"]) chain[method] = vi.fn(() => chain);
    chain.limit = vi.fn(async () => {
      if (table === "op_fixtures") return { data: fixtures, error: fixtureError };
      if (table === "op_raw_provider_payloads") return { data: payloads, error: payloadError };
      return { data: [], error: null };
    });
    chain.in = vi.fn(() => {
      if (table === "op_fixture_results") return Promise.resolve({ data: results, error: null });
      return chain;
    });
    return chain;
  };
  return { from: vi.fn((table: string) => chainFor(table)), rpc } as never;
}

const NOW = new Date("2026-08-07T21:00:00.000Z");

function fixture(overrides: Row = {}): Row {
  return {
    id: "fix-1",
    sport: "football",
    provider: "api-football",
    external_id: "af-1",
    status: "finished",
    home_score: 2,
    away_score: 1,
    kickoff_at: "2026-08-07T18:00:00.000Z",
    updated_at: "2026-08-07T20:00:00.000Z",
    ...overrides
  };
}

function payload(overrides: Row = {}): Row {
  return {
    external_id: "af-1",
    provider: "api-football",
    observed_at: "2026-08-07T19:50:00.000Z",
    payload: {
      fixture: { status: { short: "FT" } },
      goals: { home: 2, away: 1 },
      score: { fulltime: { home: 2, away: 1 } }
    },
    ...overrides
  };
}

describe("result ingestion sweep", () => {
  it("verifies from two agreeing observations and records it", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const run = await runResultIngestion({
      persist: true,
      now: NOW,
      client: stubClient({ fixtures: [fixture()], payloads: [payload()], rpc })
    });

    expect(run.status).toBe("completed");
    expect(run.totals.inserted).toBe(1);
    expect(run.totals.verified).toBe(1);

    const written = rpc.mock.calls[0]![1].p_result;
    expect(written.regulation_home).toBe(2);
    expect(written.verification_state).toBe("verified");
    expect(written.verified_by).toBe("automatic");
  });

  it("keeps extra time and penalties from the payload rather than the fixture row", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await runResultIngestion({
      persist: true,
      now: NOW,
      client: stubClient({
        // The fixture row carries only the post-shootout aggregate.
        fixtures: [fixture({ home_score: 2, away_score: 2 })],
        payloads: [
          payload({
            observed_at: "2026-08-07T19:40:00.000Z",
            payload: {
              fixture: { status: { short: "PEN" } },
              goals: { home: 2, away: 2 },
              score: {
                fulltime: { home: 1, away: 1 },
                extratime: { home: 2, away: 2 },
                penalty: { home: 4, away: 3 }
              }
            }
          })
        ],
        rpc
      })
    });

    const written = rpc.mock.calls[0]![1].p_result;
    expect(written.regulation_home).toBe(1);
    expect(written.extra_time_home).toBe(2);
    expect(written.shootout_home).toBe(4);
    expect(written.winner_basis).toBe("shootout");
  });

  it("falls back to the fixture row when no payload parses, with no extra time invented", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const run = await runResultIngestion({
      persist: true,
      now: NOW,
      client: stubClient({ fixtures: [fixture()], payloads: [], rpc })
    });

    const written = rpc.mock.calls[0]![1].p_result;
    expect(written.regulation_home).toBe(2);
    expect(written.extra_time_home).toBeNull();
    // One observation from one source: not verified, and honestly so.
    expect(run.totals.verified).toBe(0);
  });

  it("does not treat the fixture row as a second source", async () => {
    // The fixture row is written by the same provider that supplied the
    // payload; counting it as independent would verify everything instantly.
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await runResultIngestion({
      persist: true,
      now: NOW,
      client: stubClient({
        fixtures: [fixture({ updated_at: "2026-08-07T19:52:00.000Z" })],
        payloads: [payload({ observed_at: "2026-08-07T19:50:00.000Z" })],
        rpc
      })
    });
    // Two minutes apart, same source: below the agreement window.
    expect(rpc.mock.calls[0]![1].p_result.verification_state).toBe("provisional");
  });

  it("raises a conflict when the payload and the fixture row disagree", async () => {
    const run = await runResultIngestion({
      persist: true,
      now: NOW,
      client: stubClient({
        fixtures: [fixture({ home_score: 3, away_score: 1 })],
        payloads: [payload()]
      })
    });
    expect(run.totals.conflicted).toBe(1);
    expect(run.exceptions[0]).toMatchObject({ kind: "result_conflict", fixtureId: "fix-1" });
  });

  it("previews without writing", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const run = await runResultIngestion({
      persist: false,
      now: NOW,
      client: stubClient({ fixtures: [fixture()], payloads: [payload()], rpc })
    });
    expect(run.status).toBe("preview");
    expect(run.totals.inserted).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stops rather than proceeding on the fixture row when the payload read fails", async () => {
    // Proceeding would silently reduce every fixture to one observation and
    // make the batch look like a provider that never confirms anything.
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const run = await runResultIngestion({
      persist: true,
      now: NOW,
      client: stubClient({ fixtures: [fixture()], payloadError: { message: "statement timeout" }, rpc })
    });
    expect(run.status).toBe("unavailable");
    expect(run.errors[0]).toContain("statement timeout");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a fixture read failure as unavailable rather than an empty sweep", async () => {
    const run = await runResultIngestion({
      persist: true,
      now: NOW,
      client: stubClient({ fixtures: [], fixtureError: { message: "denied" } })
    });
    expect(run.status).toBe("unavailable");
  });

  it("counts a failed write without counting it as inserted", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "check constraint" } });
    const run = await runResultIngestion({
      persist: true,
      now: NOW,
      client: stubClient({ fixtures: [fixture()], payloads: [payload()], rpc })
    });
    expect(run.status).toBe("partial");
    expect(run.totals.failed).toBe(1);
    expect(run.totals.inserted).toBe(0);
  });

  it("is unavailable when storage is not configured", async () => {
    const run = await runResultIngestion({ client: null, now: NOW });
    expect(run.status).toBe("unavailable");
  });

  it("reports not-migrated rather than 503-ing the whole results refresh", async () => {
    // This sweep runs inside refresh-results alongside the fixture refresh,
    // expiry and lifecycle reconciliation. Shipping ahead of the migration must
    // not take those three down with it.
    const client = {
      from: vi.fn((table: string) => {
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "eq", "lt", "order"]) chain[method] = vi.fn(() => chain);
        chain.limit = vi.fn(async () => ({ data: [fixture()], error: null }));
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

    const run = await runResultIngestion({ persist: true, now: NOW, client });
    expect(run.status).toBe("not-migrated");
    expect(run.errors[0]).toContain("Apply the migration");
  });

  it("still reports a denied read as unavailable", async () => {
    const client = {
      from: vi.fn((table: string) => {
        const chain: Record<string, unknown> = {};
        for (const method of ["select", "eq", "lt", "order"]) chain[method] = vi.fn(() => chain);
        chain.limit = vi.fn(async () => ({ data: [fixture()], error: null }));
        chain.in = vi.fn(() =>
          table === "op_fixture_results"
            ? Promise.resolve({ data: null, error: { code: "42501", message: "permission denied" } })
            : chain
        );
        return chain;
      }),
      rpc: vi.fn()
    } as never;

    const run = await runResultIngestion({ persist: true, now: NOW, client });
    expect(run.status).toBe("unavailable");
  });
});
