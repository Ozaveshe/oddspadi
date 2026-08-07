import { beforeEach, describe, expect, it, vi } from "vitest";

const getSupabaseServerClientMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/server", () => ({
  getSupabaseServerClient: getSupabaseServerClientMock,
  getSupabaseRuntimeStatus: vi.fn(() => ({ serverWriteReady: true, missingServerEnv: [] }))
}));

import { readHomepageModelRecordSummary } from "@/lib/sports/homepageSummary";
import { formatRecordHitRate, MIN_SEGMENT_SAMPLE } from "@/lib/performance/ledgerMetrics";

type Row = { fixture_external_id: string; market: string; selection: string; result: string };

/** One decision, quoted at `prices` bookmakers — the row shape production actually stores. */
function quotedAt(fixture: string, result: string, prices: number, selection = "home"): Row[] {
  return Array.from({ length: prices }, () => ({
    fixture_external_id: fixture,
    market: "match_winner",
    selection,
    result
  }));
}

function decisions(count: number, result: string, prefix: string): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    fixture_external_id: `${prefix}-${index}`,
    market: "match_winner",
    selection: "home",
    result
  }));
}

function client({
  settled = [] as Row[],
  pending = [] as Row[],
  unresolved = [] as string[],
  settledError = null as unknown,
  fixturesError = null as unknown
} = {}) {
  const build = (table: string) => {
    const eqs: Array<[string, unknown]> = [];
    const ins: string[] = [];
    const query: Record<string, unknown> = {};
    for (const method of ["select", "gte", "lt", "limit", "order", "is", "neq"]) {
      query[method] = vi.fn(() => query);
    }
    query.eq = vi.fn((column: string, value: unknown) => {
      eqs.push([column, value]);
      return query;
    });
    query.in = vi.fn((_column: string, values: string[]) => {
      ins.push(...values);
      return query;
    });
    query.then = (onOk: (value: unknown) => unknown, onErr?: (reason: unknown) => unknown) => {
      if (table === "op_fixtures") {
        if (fixturesError) return Promise.resolve({ data: null, error: fixturesError }).then(onOk, onErr);
        const data = unresolved
          .filter((id) => ins.includes(id))
          .map((external_id) => ({ external_id, lifecycle_state: "unresolved" }));
        return Promise.resolve({ data, error: null }).then(onOk, onErr);
      }
      // The pending read is the one that filters `result=pending`; the settled
      // read filters only on the settled_at window.
      const wantsPending = eqs.some(([column, value]) => column === "result" && value === "pending");
      if (!wantsPending && settledError) return Promise.resolve({ data: null, error: settledError }).then(onOk, onErr);
      return Promise.resolve({ data: wantsPending ? pending : settled, error: null }).then(onOk, onErr);
    };
    return query;
  };
  return { from: vi.fn((table: string) => build(table)) };
}

const now = new Date("2026-08-07T09:00:00.000Z");

describe("internal model record", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("counts one record per decision, not one per bookmaker price", async () => {
    // Production, 2026-08-06: the panel read "18 model wins". Those eighteen
    // rows were three calls — Ararat-Armenia, Aarhus and Boca Juniors — held at
    // 7, 7 and 4 quoted prices. The engine made three calls, not eighteen.
    getSupabaseServerClientMock.mockReturnValue(
      client({
        settled: [
          ...quotedAt("api-football:1605370", "won", 7),
          ...quotedAt("api-football:1607163", "won", 7),
          ...quotedAt("the-odds-api:46d14ff", "won", 4)
        ]
      })
    );

    const record = await readHomepageModelRecordSummary(now);

    expect(record).not.toBeNull();
    expect(record?.won).toBe(3);
    expect(record?.lost).toBe(0);
  });

  it("reports losses on unresolved fixtures as pending, not as a 100% record", async () => {
    // The failure the panel must never repeat: calls the engine could not grade
    // because no provider ever resolved the fixture drop out of the denominator,
    // leaving only the wins and a perfect record.
    getSupabaseServerClientMock.mockReturnValue(
      client({
        settled: [
          ...decisions(3, "won", "resolved"),
          ...decisions(4, "lost", "stranded")
        ],
        unresolved: ["stranded-0", "stranded-1", "stranded-2", "stranded-3"]
      })
    );

    const record = await readHomepageModelRecordSummary(now);

    expect(record?.won).toBe(3);
    // Never fabricated as losses, and never silently dropped either.
    expect(record?.lost).toBe(0);
    expect(record?.pending).toBe(4);
    expect(record?.hitRate.value).toBeNull();
    expect(formatRecordHitRate(record!.hitRate)).not.toContain("100");
  });

  it("surfaces ungraded decisions on yesterday's fixtures as pending", async () => {
    // A pending row has no settled_at at all, so the old settled_at-windowed
    // count could never return anything but zero for this tile.
    getSupabaseServerClientMock.mockReturnValue(
      client({
        settled: decisions(2, "won", "graded"),
        pending: [...quotedAt("api-football:9001", "pending", 5), ...quotedAt("api-football:9002", "pending", 3)]
      })
    );

    const record = await readHomepageModelRecordSummary(now);

    expect(record?.pending).toBe(2);
  });

  it("refuses a hit rate on a genuine small sample rather than printing 100%", async () => {
    getSupabaseServerClientMock.mockReturnValue({ ...client({ settled: decisions(3, "won", "small") }) });

    const record = await readHomepageModelRecordSummary(now);

    expect(record?.won).toBe(3);
    expect(record?.lost).toBe(0);
    expect(record?.hitRate.value).toBeNull();
    expect(record?.hitRate.state).toBe("insufficient-sample");
    expect(formatRecordHitRate(record!.hitRate)).toBe("Not enough settled decisions yet");
  });

  it("refuses a hit rate on a small all-losing sample rather than printing 0%", async () => {
    getSupabaseServerClientMock.mockReturnValue(client({ settled: decisions(4, "lost", "small") }));

    const record = await readHomepageModelRecordSummary(now);

    expect(record?.hitRate.value).toBeNull();
    expect(formatRecordHitRate(record!.hitRate)).toBe("Not enough settled decisions yet");
  });

  it("computes a normal day correctly", async () => {
    getSupabaseServerClientMock.mockReturnValue(
      client({ settled: [...decisions(40, "won", "w"), ...decisions(60, "lost", "l")] })
    );

    const record = await readHomepageModelRecordSummary(now);

    expect(record?.won).toBe(40);
    expect(record?.lost).toBe(60);
    expect(record?.hitRate.state).toBe("measured");
    expect(record?.hitRate.value).toBeCloseTo(0.4, 10);
    expect(record?.hitRate.sampleSize).toBe(100);
    expect(formatRecordHitRate(record!.hitRate)).toBe("40.0%");
  });

  it("excludes voids and unresolved decisions from the denominator", async () => {
    getSupabaseServerClientMock.mockReturnValue(
      client({
        settled: [
          ...decisions(40, "won", "w"),
          ...decisions(60, "lost", "l"),
          ...decisions(9, "void", "v"),
          ...decisions(2, "push", "p"),
          ...decisions(5, "lost", "stranded")
        ],
        unresolved: Array.from({ length: 5 }, (_, index) => `stranded-${index}`)
      })
    );

    const record = await readHomepageModelRecordSummary(now);

    expect(record?.won).toBe(40);
    expect(record?.lost).toBe(60);
    expect(record?.voided).toBe(11);
    expect(record?.pending).toBe(5);
    // Denominator is decided calls only: 100, not 111 and not 116.
    expect(record?.hitRate.sampleSize).toBe(100);
  });

  it("publishes a rate exactly at the shared sample threshold", async () => {
    getSupabaseServerClientMock.mockReturnValue(
      client({
        settled: [
          ...decisions(MIN_SEGMENT_SAMPLE - 1, "won", "w"),
          ...decisions(1, "lost", "l")
        ]
      })
    );

    const record = await readHomepageModelRecordSummary(now);

    expect(record?.hitRate.sampleSize).toBe(MIN_SEGMENT_SAMPLE);
    expect(record?.hitRate.state).toBe("measured");
  });

  it("returns null rather than a zero when a read fails", async () => {
    getSupabaseServerClientMock.mockReturnValue(client({ settledError: { message: "statement timeout" } }));

    await expect(readHomepageModelRecordSummary(now)).resolves.toBeNull();
  });

  it("returns null rather than vouching for decisions whose fixture lifecycle is unreadable", async () => {
    getSupabaseServerClientMock.mockReturnValue(
      client({ settled: decisions(40, "won", "w"), fixturesError: { message: "statement timeout" } })
    );

    await expect(readHomepageModelRecordSummary(now)).resolves.toBeNull();
  });

  it("returns null when Supabase is not configured", async () => {
    getSupabaseServerClientMock.mockReturnValue(null);

    await expect(readHomepageModelRecordSummary(now)).resolves.toBeNull();
  });
});
