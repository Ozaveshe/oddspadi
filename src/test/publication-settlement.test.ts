import { describe, expect, it, vi } from "vitest";
import { runPublicationSettlement } from "@/lib/publication/settlePublications";

/**
 * `op_settle_publication` existed from the day the ledger was built and had no
 * caller. 230 published picks sat at `unsettled`, so the public track record
 * was empty by construction rather than because nothing had been decided.
 */

type Row = Record<string, unknown>;

function stubClient({
  publications,
  fixtures,
  rpc = vi.fn().mockResolvedValue({ error: null })
}: {
  publications: Row[];
  fixtures: Row[];
  rpc?: ReturnType<typeof vi.fn>;
}) {
  const builder = (rows: Row[]) => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "in", "eq", "lt", "order", "limit"]) {
      chain[method] = vi.fn(() => chain);
    }
    // `limit` and `in` are the two terminal calls in this module's reads.
    chain.limit = vi.fn(async () => ({ data: rows, error: null }));
    chain.in = vi.fn((column: string) => (column === "id" ? Promise.resolve({ data: rows, error: null }) : chain));
    return chain;
  };
  return {
    from: vi.fn((table: string) => builder(table === "op_publications" ? publications : fixtures)),
    rpc
  } as never;
}

const KICKOFF = "2026-08-03T10:00:00.000Z";
const NOW = new Date("2026-08-03T15:00:00.000Z");

function publication(overrides: Row = {}): Row {
  return {
    id: "pub-1",
    fixture_id: "fix-1",
    fixture_external_id: "ext-1",
    market: "match_winner",
    selection: "home",
    kickoff_at: KICKOFF,
    ...overrides
  };
}

describe("published claims reach a verdict", () => {
  it("grades a win from the final score and records the basis", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = stubClient({
      publications: [publication()],
      fixtures: [{ id: "fix-1", status: "finished", home_score: 2, away_score: 1 }],
      rpc
    });

    const result = await runPublicationSettlement({ client, persist: true, now: NOW });

    expect(result.totals.won).toBe(1);
    expect(result.totals.settled).toBe(1);
    expect(rpc).toHaveBeenCalledWith("op_settle_publication", expect.objectContaining({
      p_publication_id: "pub-1",
      p_status: "won"
    }));
    const basis = rpc.mock.calls[0][1].p_resolution_basis;
    expect(basis.finalScore).toEqual({ home: 2, away: 1 });
    expect(basis.fixtureStatus).toBe("finished");
  });

  it("grades a loss", async () => {
    const client = stubClient({
      publications: [publication()],
      fixtures: [{ id: "fix-1", status: "finished", home_score: 0, away_score: 3 }]
    });

    const result = await runPublicationSettlement({ client, persist: true, now: NOW });

    expect(result.totals.lost).toBe(1);
  });

  it("voids a fixture the stale sweep expired, and carries no score", async () => {
    // The sweep marks `abandoned` when no result ever arrived. Before this, the
    // grader's status union omitted `abandoned`, so all 1,112 expired fixtures
    // would have queued at needs_review indefinitely.
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = stubClient({
      publications: [publication()],
      fixtures: [{ id: "fix-1", status: "abandoned", home_score: 51, away_score: 56 }],
      rpc
    });

    const result = await runPublicationSettlement({ client, persist: true, now: NOW });

    expect(result.totals.void).toBe(1);
    expect(rpc.mock.calls[0][1].p_status).toBe("void");
    // A partial scoreline must never be published as the final score.
    expect(rpc.mock.calls[0][1].p_resolution_basis.finalScore).toBeNull();
  });

  it("leaves an unresolvable market unsettled rather than guessing", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = stubClient({
      publications: [publication({ market: "asian_handicap_first_half", selection: "home_-0.25" })],
      fixtures: [{ id: "fix-1", status: "finished", home_score: 1, away_score: 1 }],
      rpc
    });

    const result = await runPublicationSettlement({ client, persist: true, now: NOW });

    expect(result.totals.needsReview).toBe(1);
    expect(result.totals.settled).toBe(0);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("waits for a fixture that has not reached a terminal state", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = stubClient({
      publications: [publication()],
      fixtures: [{ id: "fix-1", status: "live", home_score: 1, away_score: 0 }],
      rpc
    });

    const result = await runPublicationSettlement({ client, persist: true, now: NOW });

    expect(result.totals.awaitingResult).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("writes nothing without persist", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = stubClient({
      publications: [publication()],
      fixtures: [{ id: "fix-1", status: "finished", home_score: 2, away_score: 1 }],
      rpc
    });

    const result = await runPublicationSettlement({ client, now: NOW });

    expect(result.status).toBe("preview");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("counts a failed write as failed, not as settled", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: { message: "ledger is immutable" } });
    const client = stubClient({
      publications: [publication()],
      fixtures: [{ id: "fix-1", status: "finished", home_score: 2, away_score: 1 }],
      rpc
    });

    const result = await runPublicationSettlement({ client, persist: true, now: NOW });

    expect(result.status).toBe("partial");
    expect(result.totals.failed).toBe(1);
    expect(result.totals.settled).toBe(0);
    expect(result.totals.won).toBe(0);
  });

  it("reports storage absence instead of a clean zero", async () => {
    const result = await runPublicationSettlement({ client: null, persist: true, now: NOW });

    expect(result.status).toBe("unavailable");
    expect(result.totals.settled).toBe(0);
    expect(result.errors).toHaveLength(1);
  });
});
