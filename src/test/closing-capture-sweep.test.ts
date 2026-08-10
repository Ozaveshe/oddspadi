import { describe, expect, it, vi } from "vitest";
import { chunkByKickoffSpan, runClosingCapture } from "@/lib/closing/captureSweep";

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
        return { data: [], error: null };
      });
      /**
       * Snapshots are read through `range`, and the stub pages the way
       * PostgREST does — including the part that caused the outage: a server
       * that stops at its own page size without saying so. Modelling `limit`
       * here instead would let a sweep that silently truncates keep passing.
       */
      chain.range = vi.fn(async (from: number, to: number) => {
        if (table !== "op_odds_snapshots") return { data: [], error: null };
        if (snapshotError) return { data: null, error: snapshotError };
        // is_live moved from a JS filter into the SQL query (where the
        // partial index lives), so the stub models the database honouring it.
        const live = snapshots.filter((row) => row.is_live !== true);
        const pageSize = to - from + 1;
        return { data: live.slice(from, from + pageSize), error: null };
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

/**
 * Supersede calls only. The exception writer shares this rpc mock, so a bare
 * "was rpc called" assertion would pass or fail on the wrong thing.
 */
function supersedeCalls(rpc: ReturnType<typeof vi.fn>) {
  return rpc.mock.calls.filter((call) => call[0] === "op_supersede_closing_price");
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

  /**
   * The bug that made tennis coverage structurally impossible.
   *
   * A tennis claim's `home` resolves to `...full_match.player_a`, while the
   * odds snapshots for the same match store the selection as `home`. Comparing
   * the canonical id against the raw snapshot text never matched, so every
   * tennis claim was written off as `no_quotes` — a reason that was not merely
   * unhelpful but false. Measured on 2026-08-08: all 80 eligible tennis claims
   * had a fully priced market inside their window.
   */
  it("matches tennis quotes stored as home/away against a player_a claim", async () => {
    const tennisQuotes = ["a", "b", "c"].flatMap((book, index) => [
      { fixture_id: "fix-1", bookmaker: book, market: "match_winner", selection: "home", line: null, decimal_odds: 1.9 + index * 0.1, observed_at: before(20 - index * 5), is_live: false },
      { fixture_id: "fix-1", bookmaker: book, market: "match_winner", selection: "away", line: null, decimal_odds: 2.1, observed_at: before(20 - index * 5), is_live: false }
    ]);
    const insert = vi.fn().mockResolvedValue({ error: null });
    const run = await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({
        publications: [publication({ sport: "tennis", market: "match_winner", selection: "home" })],
        snapshots: tennisQuotes,
        insert
      })
    });

    expect(run.byStatus.no_quotes).toBe(0);
    expect(run.totals.captured).toBe(1);
    const written = insert.mock.calls[0]![0];
    expect(written.canonical_selection_key).toBe("tennis.match_winner.full_match.player_a");
    expect(written.closing_odds).toBe(2.0);
    expect(written.source_count).toBe(3);
  });

  /**
   * A football claim and a tennis claim in the same run.
   *
   * `match_winner/home` resolves to `football.1x2.regulation.home` for one and
   * `tennis.match_winner.full_match.player_a` for the other. The per-run
   * resolver cache keyed those identically at first, so whichever sport the
   * sweep reached first answered for both and the other's quotes were filtered
   * out as belonging to a different market. A single-publication test cannot
   * see that; this one can.
   */
  it("keeps sports apart when both are in one run", async () => {
    const quotesFor = (fixture: string) =>
      ["a", "b", "c"].flatMap((book, index) => [
        { fixture_id: fixture, bookmaker: book, market: "match_winner", selection: "home", line: null, decimal_odds: 1.9 + index * 0.1, observed_at: before(20 - index * 5), is_live: false },
        { fixture_id: fixture, bookmaker: book, market: "match_winner", selection: "away", line: null, decimal_odds: 2.1, observed_at: before(20 - index * 5), is_live: false }
      ]);
    const insert = vi.fn().mockResolvedValue({ error: null });
    const run = await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({
        publications: [
          publication({ id: "pub-football", fixture_id: "fix-1", sport: "football" }),
          publication({ id: "pub-tennis", fixture_id: "fix-2", sport: "tennis" })
        ],
        snapshots: [...quotesFor("fix-1"), ...quotesFor("fix-2")],
        insert
      })
    });

    expect(run.totals.captured).toBe(2);
    expect(run.byStatus.no_quotes).toBe(0);
    const keys = insert.mock.calls.map((call) => call[0].canonical_selection_key).sort();
    expect(keys).toEqual(["football.1x2.regulation.home", "tennis.match_winner.full_match.player_a"]);
  });

  it("does not let another market's quote satisfy a claim", async () => {
    // A totals quote is not a match-winner close, whatever words the two
    // markets happen to share.
    const totals = ["a", "b", "c"].flatMap((book) => [
      { fixture_id: "fix-1", bookmaker: book, market: "over_under_25", selection: "over_25", line: 2.5, decimal_odds: 1.9, observed_at: before(10), is_live: false },
      { fixture_id: "fix-1", bookmaker: book, market: "over_under_25", selection: "under_25", line: 2.5, decimal_odds: 1.9, observed_at: before(10), is_live: false }
    ]);
    const run = await runClosingCapture({
      persist: false,
      now: NOW,
      client: stubClient({ publications: [publication()], snapshots: totals })
    });
    expect(run.totals.captured).toBe(0);
    expect(run.byStatus.no_quotes).toBe(1);
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

  it("skips a claim whose close was already captured", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const run = await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({
        publications: [publication()],
        snapshots: THREE_BOOKS,
        existing: [{ publication_id: "pub-1", capture_status: "captured", closing_odds: 2 }],
        insert
      })
    });
    expect(run.totals.eligible).toBe(0);
    expect(insert).not.toHaveBeenCalled();
  });

  /**
   * The regression this whole retry path exists for.
   *
   * Measured on 2026-08-08: all 139 eligible claims held an absent-capture row
   * and 91 of them had qualifying quotes in the database at the moment their
   * miss was written. The sweep skipped anything with a current row, so the
   * `no_quotes` it wrote first was the reason it never looked again.
   */
  it("retries a claim whose close was absent and supersedes the miss", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const run = await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({
        publications: [publication()],
        snapshots: THREE_BOOKS,
        existing: [{ publication_id: "pub-1", capture_status: "no_quotes", closing_odds: null }],
        insert,
        rpc
      })
    });
    expect(run.totals.eligible).toBe(1);
    expect(run.totals.captured).toBe(1);
    // Superseded through the RPC, never a bare insert: one current row per
    // claim is a unique index, so retire-and-insert has to be one statement.
    expect(insert).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledWith("op_supersede_closing_price", expect.objectContaining({
      p_publication_id: "pub-1",
      p_capture_status: "captured",
      p_closing_odds: 2
    }));
  });

  it("does not overrule an operator's unavailable mark", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const run = await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({
        publications: [publication()],
        snapshots: THREE_BOOKS,
        existing: [{ publication_id: "pub-1", capture_status: "operator_unavailable", closing_odds: null }],
        insert,
        rpc
      })
    });
    expect(run.totals.eligible).toBe(0);
    expect(insert).not.toHaveBeenCalled();
    expect(supersedeCalls(rpc)).toHaveLength(0);
  });

  /**
   * Idempotence. An hourly sweep re-reading a market that has not moved must
   * not stack a new revision every hour — the retry exists to catch late data,
   * not to churn the table.
   */
  it("rewrites nothing when a retry reaches the same absent outcome", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const run = await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({
        publications: [publication()],
        snapshots: [],
        existing: [{ publication_id: "pub-1", capture_status: "no_quotes", closing_odds: null, source_count: 0 }],
        insert,
        rpc
      })
    });
    expect(run.totals.eligible).toBe(1);
    expect(run.byStatus.no_quotes).toBe(1);
    expect(insert).not.toHaveBeenCalled();
    expect(supersedeCalls(rpc)).toHaveLength(0);
  });

  it("rewrites an absent outcome when the book count moved under it", async () => {
    // Still `insufficient_sources`, but "Only 1 book priced this selection" is
    // no longer true once a second book has quoted.
    const rpc = vi.fn().mockResolvedValue({ error: null });
    await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({
        publications: [publication()],
        snapshots: [...quoteRows("a", 20, 1.9), ...quoteRows("b", 15, 2.0)],
        existing: [{ publication_id: "pub-1", capture_status: "insufficient_sources", closing_odds: null, source_count: 1 }],
        rpc
      })
    });
    const [call] = supersedeCalls(rpc);
    expect(call?.[1]).toMatchObject({ p_capture_status: "insufficient_sources", p_source_count: 2 });
    expect(call?.[1].p_missing_reason).toContain("Only 2 books");
  });

  it("rewrites nothing when a captured close is re-derived unchanged", async () => {
    const insert = vi.fn().mockResolvedValue({ error: null });
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const run = await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({
        publications: [publication()],
        snapshots: THREE_BOOKS,
        // Not terminal, so it is retried; the retry lands on the same number.
        existing: [{ publication_id: "pub-1", capture_status: "insufficient_sources", closing_odds: null }],
        insert,
        rpc
      })
    });
    // The status did change (insufficient_sources -> captured), so this one
    // must write. The guard is on sameness, not on having been retried.
    expect(supersedeCalls(rpc)).toHaveLength(1);
    expect(insert).not.toHaveBeenCalled();
  });

  /**
   * The silent cap.
   *
   * PostgREST answers with at most `db-max-rows` (1,000 here) and does not
   * mention having truncated. The sweep asked for 6,000 and treated anything
   * under that as complete, so it proceeded on the newest 1,000 quotes in the
   * window — which, ordered by observation time across a whole chunk, belong to
   * the chunk's latest kickoffs. Measured on 2026-08-08, a 21-fixture chunk
   * came back with 1,000 rows covering 12 fixtures: 9 claims were handed a
   * confident, false "nobody priced this".
   *
   * Here the claim's quotes sit past the first page, so a sweep that reads one
   * page reports no_quotes and a sweep that pages through captures.
   */
  it("pages past the server's row cap rather than trusting one response", async () => {
    // 1,000 rows of an unrelated market fill page one; the real quotes follow.
    const filler = Array.from({ length: 1000 }, (_, index) => ({
      fixture_id: "fix-1",
      bookmaker: `filler-${index}`,
      market: "corners",
      selection: "over_95",
      line: null,
      decimal_odds: 1.5,
      observed_at: before(60),
      is_live: false
    }));
    const insert = vi.fn().mockResolvedValue({ error: null });
    const run = await runClosingCapture({
      persist: true,
      now: NOW,
      client: stubClient({ publications: [publication()], snapshots: [...filler, ...THREE_BOOKS], insert })
    });

    expect(run.byStatus.no_quotes).toBe(0);
    expect(run.totals.captured).toBe(1);
    expect(insert.mock.calls[0]![0].closing_odds).toBe(2.0);
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

/**
 * The read window, which is the other half of why coverage was zero.
 *
 * A chunk reads `[min(kickoff) − 90m, max(kickoff)]`, so bounding it by pick
 * count alone lets a quiet stretch of the calendar stretch one read across
 * days. Measured on 2026-08-08: a 25-pick chunk spanning 74 hours matched
 * 12,966 rows against a 6,000-row cap, deferring 50 of 139 claims for reasons
 * that had nothing to do with the market.
 */
describe("chunkByKickoffSpan", () => {
  const HOUR = 3_600_000;
  const at = (hoursFromZero: number) => ({ kickoff_at: new Date(Date.UTC(2026, 7, 3) + hoursFromZero * HOUR).toISOString() });

  it("closes a chunk on the pick count", () => {
    const rows = Array.from({ length: 7 }, (_, index) => at(index * 0.1));
    expect(chunkByKickoffSpan(rows, 3, 6 * HOUR).map((chunk) => chunk.length)).toEqual([3, 3, 1]);
  });

  it("closes a chunk on the kickoff span before the count is reached", () => {
    // Four picks inside six hours, then a gap: the gap must start a new read
    // rather than widen the current one.
    const rows = [at(0), at(1), at(2), at(80), at(81)];
    const chunks = chunkByKickoffSpan(rows, 25, 6 * HOUR);
    expect(chunks.map((chunk) => chunk.length)).toEqual([3, 2]);
  });

  it("never lets a chunk's kickoff span exceed the cap", () => {
    const rows = Array.from({ length: 40 }, (_, index) => at(index * 2));
    for (const chunk of chunkByKickoffSpan(rows, 25, 6 * HOUR)) {
      const times = chunk.map((row) => new Date(row.kickoff_at).getTime());
      expect(Math.max(...times) - Math.min(...times)).toBeLessThanOrEqual(6 * HOUR);
    }
  });

  it("keeps every row exactly once", () => {
    const rows = Array.from({ length: 33 }, (_, index) => at(index * 3));
    const chunks = chunkByKickoffSpan(rows, 25, 6 * HOUR);
    expect(chunks.flat()).toEqual(rows);
  });

  it("returns nothing for nothing", () => {
    expect(chunkByKickoffSpan([], 25, 6 * HOUR)).toEqual([]);
  });
});
