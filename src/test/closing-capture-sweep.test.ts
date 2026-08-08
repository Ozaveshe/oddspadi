import { describe, expect, it, vi } from "vitest";
import { runClosingCapture } from "@/lib/closing/captureSweep";

type Row = Record<string, unknown>;

const KICKOFF = "2026-08-07T19:00:00.000Z";
const NOW = new Date("2026-08-07T21:00:00.000Z");
const before = (minutes: number) => new Date(new Date(KICKOFF).getTime() - minutes * 60_000).toISOString();

function stubClient({
  publications,
  snapshots = [],
  existing = [],
  insert = vi.fn().mockResolvedValue({ error: null }),
  rpc = vi.fn().mockResolvedValue({ error: null }),
  existingError = null,
  snapshotError = null
}: {
  publications: Row[];
  snapshots?: Row[];
  existing?: Row[];
  insert?: ReturnType<typeof vi.fn>;
  rpc?: ReturnType<typeof vi.fn>;
  existingError?: { code?: string; message: string } | null;
  snapshotError?: { message: string } | null;
}) {
  return {
    rpc,
    from: vi.fn((table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "eq", "lt", "gte", "lte", "order"]) chain[method] = vi.fn(() => chain);
      chain.limit = vi.fn(async () => {
        if (table === "op_publications") return { data: publications, error: null };
        // is_live moved from a JS filter into the SQL query (where the
        // partial index lives), so the stub models the database honouring it.
        if (table === "op_odds_snapshots")
          return { data: snapshots.filter((row) => row.is_live !== true), error: snapshotError };
        return { data: [], error: null };
      });
      chain.in = vi.fn(() => {
        if (table === "op_closing_prices") return Promise.resolve({ data: existing, error: existingError });
        return chain;
      });
      chain.insert = insert;
      return chain;
    })
  } as never;
}

function publication(overrides: Row = {}): Row {
  return {
    id: "pub-1",
    fixture_id: "fix-1",
    sport: "football",
    market: "match_winner",
    selection: "home",
    market_line: null,
    odds_at_publication: 2.2,
    kickoff_at: KICKOFF,
    ...overrides
  };
}

function quoteRows(bookmaker: string, minutesBefore: number, homeOdds: number): Row[] {
  return [
    { fixture_id: "fix-1", bookmaker, market: "match_winner", selection: "home", line: null, decimal_odds: homeOdds, observed_at: before(minutesBefore), is_live: false },
    { fixture_id: "fix-1", bookmaker, market: "match_winner", selection: "draw", line: null, decimal_odds: 3.4, observed_at: before(minutesBefore), is_live: false },
    { fixture_id: "fix-1", bookmaker, market: "match_winner", selection: "away", line: null, decimal_odds: 3.8, observed_at: before(minutesBefore), is_live: false }
  ];
}

const THREE_BOOKS = [...quoteRows("a", 20, 1.9), ...quoteRows("b", 15, 2.0), ...quoteRows("c", 10, 2.1)];

describe("closing capture sweep", () => {
  it("captures a consensus close and writes it", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const run = await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({ publications: [publication()], snapshots: THREE_BOOKS, insert })
    });

    expect(run.status).toBe("completed");
    expect(run.totals.captured).toBe(1);

    const written = insert.mock.calls[0]![0];
    expect(written.capture_status).toBe("captured");
    expect(written.closing_odds).toBe(2.0);
    expect(written.source_count).toBe(3);
    expect(written.missing_reason).toBeNull();
    expect(written.policy_version).toBe("close.v1");
    expect(written.canonical_selection_key).toBe("football.1x2.regulation.home");
  });

  it("writes a row saying why a close is absent rather than writing nothing", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const run = await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({ publications: [publication()], snapshots: quoteRows("a", 10, 2.0), insert })
    });

    expect(run.totals.absent).toBe(1);
    expect(run.byStatus.insufficient_sources).toBe(1);

    const written = insert.mock.calls[0]![0];
    // A gap in this table later reads as a zero. A row with a reason does not.
    expect(written.capture_status).toBe("insufficient_sources");
    expect(written.closing_odds).toBeNull();
    expect(written.missing_reason).toContain("3 required");
    expect(run.exceptions[0]).toMatchObject({ kind: "close_insufficient_sources", publicationId: "pub-1" });
  });

  it("persists the exception to the queue rather than only returning it", async () => {
    // Returned-and-discarded is how op_settlement_exceptions came to have a
    // reader and no writer — a permanently clean dashboard over a pipeline
    // with real problems.
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({ publications: [publication()], snapshots: quoteRows("a", 10, 2.0), rpc })
    });
    expect(rpc).toHaveBeenCalledWith(
      "op_record_settlement_exception",
      expect.objectContaining({ p_kind: "close_insufficient_sources", p_publication_id: "pub-1" })
    );
  });

  it("records the publication probability even when the capture failed", async () => {
    // Without it a retry could not reproduce the CLV figure.
    const insert = vi.fn().mockResolvedValue({ error: null });
    await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({ publications: [publication()], snapshots: quoteRows("a", 10, 2.0), insert })
    });
    const written = insert.mock.calls[0]![0];
    expect(written.capture_status).not.toBe("captured");
    expect(written.published_probability_novig).toBeGreaterThan(0);
  });

  it("never admits a price observed after kickoff", async () => {
    const late = quoteRows("d", -30, 1.01); // 30 minutes after kickoff
    const insert = vi.fn().mockResolvedValue({ error: null });
    await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({ publications: [publication()], snapshots: [...THREE_BOOKS, ...late], insert })
    });
    const written = insert.mock.calls[0]![0];
    expect(written.source_bookmakers).not.toContain("d");
    expect(written.closing_odds).toBe(2.0);
  });

  it("ignores live quotes entirely", async () => {
    const live = quoteRows("d", 5, 1.01).map((row) => ({ ...row, is_live: true }));
    const insert = vi.fn().mockResolvedValue({ error: null });
    await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({ publications: [publication()], snapshots: [...THREE_BOOKS, ...live], insert })
    });
    expect(insert.mock.calls[0]![0].source_bookmakers).not.toContain("d");
  });

  it("refuses a quote whose line does not match the claim's", async () => {
    // A 2.5 quote is not a closing price for a 3.5 claim, however close the
    // numbers look.
    const wrongLine = ["a", "b", "c"].flatMap((book) => [
      { fixture_id: "fix-1", bookmaker: book, market: "over_under_25", selection: "over_25", line: 2.5, decimal_odds: 1.9, observed_at: before(10), is_live: false },
      { fixture_id: "fix-1", bookmaker: book, market: "over_under_25", selection: "under_25", line: 2.5, decimal_odds: 1.9, observed_at: before(10), is_live: false }
    ]);
    const insert = vi.fn().mockResolvedValue({ error: null });
    const run = await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({
        publications: [publication({ market: "over_under_25", selection: "over_25", market_line: 3.5 })],
        snapshots: wrongLine,
        insert
      })
    });
    expect(run.byStatus.no_quotes).toBe(1);
    expect(insert.mock.calls[0]![0].closing_odds).toBeNull();
  });

  it("records an unmapped market as its own reason", async () => {
    const run = await runClosingCapture({
      persist: false,
      now: NOW,
      client: stubClient({ publications: [publication({ market: "corners", selection: "over_95" })] })
    });
    expect(run.byStatus.market_unmapped).toBe(1);
    expect(run.exceptions[0]?.kind).toBe("close_market_unmapped");
  });

  it("records a missing fixture identity as its own reason", async () => {
    const run = await runClosingCapture({
      persist: false,
      now: NOW,
      client: stubClient({ publications: [publication({ fixture_id: null })], snapshots: THREE_BOOKS })
    });
    expect(run.byStatus.identity_failure).toBe(1);
    expect(run.exceptions[0]?.kind).toBe("close_identity_failure");
  });

  it("skips claims that already have a current capture", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const run = await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({
        publications: [publication()],
        snapshots: THREE_BOOKS,
        existing: [{ publication_id: "pub-1" }],
        insert
      })
    });
    expect(run.totals.eligible).toBe(0);
    expect(insert).not.toHaveBeenCalled();
  });

  it("previews without writing", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const run = await runClosingCapture({
      persist: false,
      now: NOW,
      client: stubClient({ publications: [publication()], snapshots: THREE_BOOKS, insert })
    });
    expect(run.status).toBe("preview");
    expect(run.totals.captured).toBe(1);
    expect(insert).not.toHaveBeenCalled();
  });

  it("stops rather than writing no_quotes against a whole batch when the odds read fails", async () => {
    // That reason would be permanent, wrong, and would read as a finding.
    const insert = vi.fn().mockResolvedValue({ error: null });
    const run = await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({ publications: [publication()], snapshotError: { message: "statement timeout" }, insert })
    });
    expect(run.status).toBe("unavailable");
    expect(insert).not.toHaveBeenCalled();
  });

  it("reports not-migrated rather than failing the cron", async () => {
    const run = await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({
        publications: [publication()],
        existingError: { code: "42P01", message: 'relation "op_closing_prices" does not exist' }
      })
    });
    expect(run.status).toBe("not-migrated");
  });

  it("still reports a denied read as unavailable", async () => {
    const run = await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({
        publications: [publication()],
        existingError: { code: "42501", message: "permission denied" }
      })
    });
    expect(run.status).toBe("unavailable");
  });

  it("is unavailable when storage is not configured", async () => {
    expect((await runClosingCapture({ client: null, now: NOW })).status).toBe("unavailable");
  });
});
