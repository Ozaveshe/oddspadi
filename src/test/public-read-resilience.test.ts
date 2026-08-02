import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  readProjection,
  readProjectionList,
  FRESHNESS_THRESHOLD_MS,
  PROJECTION_REFRESH_INTERVAL_MS
} from "@/lib/readmodel/publicProjection";
import { toPublicStatus, type OperationalStatus } from "@/lib/readmodel/publicStatus";

/**
 * Failure-state contracts for the public read path.
 *
 * The bug these encode: public pages caught database timeouts and rendered the
 * result as "0 fixtures" / "no value picks". Every test below asserts that a
 * failure produces a state a page can honestly render, and never a number.
 */
const NOW = Date.parse("2026-08-01T12:00:00.000Z");

function clientReturning(result: { data?: unknown; error?: { message: string } | null }): SupabaseClient {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq"]) builder[method] = () => builder;
  builder.maybeSingle = async () => ({ data: result.data ?? null, error: result.error ?? null });
  return { from: () => builder } as unknown as SupabaseClient;
}

function projectionRow(overrides: Record<string, unknown> = {}) {
  return {
    payload: [{ fixtureId: "api-football:1" }],
    row_count: 1,
    source_max_at: "2026-08-01T11:50:00.000Z",
    built_at: "2026-08-01T11:55:00.000Z",
    builder_version: 1,
    status: "ready",
    last_error: null,
    ...overrides
  };
}

describe("a failed read is never a zero", () => {
  it("reports unavailable when the database read errors", async () => {
    const read = await readProjection("daily_fixture_slate", "2026-08-01", {
      client: clientReturning({ error: { message: "canceling statement due to statement timeout" } }),
      now: NOW
    });
    expect(read.availability).toBe("unavailable");
    // The critical assertion: no row count a page could render as a fact.
    expect(read.data).toBeNull();
    expect(read.rowCount).toBe(0);
  });

  it("reports unavailable when no snapshot has ever been built", async () => {
    const read = await readProjection("daily_fixture_slate", "2026-08-01", {
      client: clientReturning({ data: null }),
      now: NOW
    });
    expect(read.availability).toBe("unavailable");
    expect(read.data).toBeNull();
  });

  it("reports unavailable when the runtime has no database configured", async () => {
    const read = await readProjection("live_fixture_board", "", { client: null, now: NOW });
    expect(read.availability).toBe("unavailable");
  });

  it("never reports unavailable and a non-zero row count together", async () => {
    for (const result of [{ error: { message: "boom" } }, { data: null }]) {
      const read = await readProjection("daily_fixture_slate", "2026-08-01", { client: clientReturning(result), now: NOW });
      expect(read.availability).toBe("unavailable");
      expect(read.rowCount).toBe(0);
    }
  });
});

describe("state semantics", () => {
  it("distinguishes a confirmed-empty slate from a failed one", async () => {
    const read = await readProjection("daily_fixture_slate", "2026-08-01", {
      client: clientReturning({ data: projectionRow({ payload: [], row_count: 0, status: "confirmed_empty" }) }),
      now: NOW
    });
    expect(read.availability).toBe("confirmed_empty");
    expect(read.rowCount).toBe(0);
    // Distinguishable from unavailable by carrying a verified build time.
    expect(read.builtAt).not.toBeNull();
  });

  it("marks a snapshot stale once it passes its freshness threshold", async () => {
    const read = await readProjection("live_fixture_board", "", {
      client: clientReturning({ data: projectionRow({ built_at: "2026-08-01T11:00:00.000Z" }) }),
      now: NOW
    });
    expect(read.availability).toBe("stale");
    expect(read.ageMs).toBe(60 * 60_000);
    // Still serves the verified rows — stale but usable.
    expect(read.rowCount).toBe(1);
  });

  it("keeps a fresh snapshot complete", async () => {
    const read = await readProjection("daily_fixture_slate", "2026-08-01", {
      client: clientReturning({ data: projectionRow() }),
      now: NOW
    });
    expect(read.availability).toBe("complete");
  });

  it("surfaces partial coverage rather than hiding the gap", async () => {
    const read = await readProjection("daily_fixture_slate", "2026-08-01", {
      client: clientReturning({ data: projectionRow({ status: "partial" }) }),
      now: NOW
    });
    expect(read.availability).toBe("partial");
    expect(read.rowCount).toBe(1);
  });

  it("serves the last good payload as stale when the newest refresh failed", async () => {
    const read = await readProjection("daily_fixture_slate", "2026-08-01", {
      client: clientReturning({ data: projectionRow({ status: "refresh_failed", last_error: "timeout" }) }),
      now: NOW
    });
    // Verified rows survive a failed refresh; they are just no longer fresh.
    expect(read.availability).toBe("stale");
    expect(read.rowCount).toBe(1);
  });

  it("refuses a payload written by a newer builder instead of misreading it", async () => {
    const read = await readProjection("daily_fixture_slate", "2026-08-01", {
      client: clientReturning({ data: projectionRow({ builder_version: 99 }) }),
      now: NOW
    });
    expect(read.availability).toBe("unavailable");
    expect(read.data).toBeNull();
  });

  it("rejects a payload whose shape is not the expected list", async () => {
    const read = await readProjectionList("daily_fixture_slate", "2026-08-01", {
      client: clientReturning({ data: projectionRow({ payload: { not: "an array" } }) }),
      now: NOW
    });
    expect(read.availability).toBe("unavailable");
  });

  it("keeps every freshness threshold above the refresh cadence", () => {
    // Found in production: the live board's 3-minute threshold sat below the
    // 5-minute sweep, so it was over threshold most of the time and the public
    // status read "delayed" almost permanently. A threshold below the cadence
    // is not strict, it is broken — it reports a fault the system cannot avoid.
    for (const [name, threshold] of Object.entries(FRESHNESS_THRESHOLD_MS)) {
      expect(threshold, `${name} must tolerate at least one missed sweep`).toBeGreaterThan(
        PROJECTION_REFRESH_INTERVAL_MS * 2
      );
    }
  });

  it("gives live scores a tighter freshness threshold than the ledger", () => {
    expect(FRESHNESS_THRESHOLD_MS.live_fixture_board).toBeLessThan(FRESHNESS_THRESHOLD_MS.daily_fixture_slate);
    expect(FRESHNESS_THRESHOLD_MS.daily_fixture_slate).toBeLessThan(FRESHNESS_THRESHOLD_MS.performance_summary);
  });
});

describe("public status sanitisation", () => {
  const projection = (overrides: Partial<OperationalStatus["projections"][number]> = {}) => ({
    name: "daily_fixture_slate",
    scope: "2026-08-01",
    status: "ready",
    rowCount: 10,
    builtAt: "2026-08-01T11:55:00.000Z",
    sourceMaxAt: "2026-08-01T11:50:00.000Z",
    ageMs: 5 * 60_000,
    buildDurationMs: 79,
    lastAttemptAt: "2026-08-01T11:55:00.000Z",
    lastError: null,
    archived: false,
    overThreshold: false,
    ...overrides
  });

  it("emits only a level and a timestamp", () => {
    const payload = toPublicStatus({ readable: true, projections: [projection()], jobs: { "import-fixtures": "x" } });
    expect(Object.keys(payload).sort()).toEqual(["lastUpdatedAt", "status"]);
    expect(payload.status).toBe("operational");
  });

  it("never leaks provider names, run ids, job names or raw errors", () => {
    const payload = toPublicStatus({
      readable: true,
      projections: [
        projection({
          status: "refresh_failed",
          lastError: 'canceling statement due to statement timeout on relation "op_odds_snapshots"'
        })
      ],
      jobs: { "api-football-import": "2026-08-01T10:00:00.000Z" }
    });
    const serialised = JSON.stringify(payload);
    for (const secret of ["op_odds_snapshots", "statement timeout", "api-football", "canceling", "import"]) {
      expect(serialised.toLowerCase()).not.toContain(secret.toLowerCase());
    }
    expect(payload.status).toBe("delayed");
  });

  it("does not let yesterday's archived slate pin the status to delayed", () => {
    // Found in production: the status read "delayed" permanently because
    // daily_fixture_slate/<yesterday> was 36 hours old. A past-dated scope is
    // an archive the refresh no longer rebuilds, so its age is expected and
    // must not describe the health of the live site.
    const payload = toPublicStatus({
      readable: true,
      projections: [
        projection({ scope: "2026-08-01", ageMs: 36 * 60 * 60_000, archived: true, overThreshold: false }),
        projection({ scope: "2026-08-02", ageMs: 3 * 60_000 })
      ],
      jobs: {}
    });
    expect(payload.status).toBe("operational");
  });

  it("still reports a genuinely stale live surface", () => {
    const payload = toPublicStatus({
      readable: true,
      projections: [projection({ scope: "2026-08-02", ageMs: 90 * 60_000, overThreshold: true })],
      jobs: {}
    });
    expect(payload.status).toBe("delayed");
  });

  it("ignores a failed refresh on an archived scope but not on a live one", () => {
    const archivedFailure = toPublicStatus({
      readable: true,
      projections: [
        projection({ scope: "2026-08-01", status: "refresh_failed", archived: true }),
        projection({ scope: "2026-08-02" })
      ],
      jobs: {}
    });
    expect(archivedFailure.status).toBe("operational");

    const liveFailure = toPublicStatus({
      readable: true,
      projections: [projection({ scope: "2026-08-02", status: "refresh_failed" })],
      jobs: {}
    });
    expect(liveFailure.status).toBe("delayed");
  });

  it("reports unavailable when operational data cannot be read", () => {
    expect(toPublicStatus({ readable: false, projections: [], jobs: {} })).toEqual({
      status: "unavailable",
      lastUpdatedAt: null
    });
  });

  it("reports partial and delayed distinctly", () => {
    expect(toPublicStatus({ readable: true, projections: [projection({ status: "partial" })], jobs: {} }).status).toBe("partial");
    expect(toPublicStatus({ readable: true, projections: [projection({ overThreshold: true })], jobs: {} }).status).toBe("delayed");
  });
});

describe("architecture guarantees", () => {
  it("keeps the public projection read to a single primary-key lookup", async () => {
    const source = await readFile(join(process.cwd(), "src", "lib", "readmodel", "publicProjection.ts"), "utf8");
    expect(source).toContain('from("op_public_projections")');
    // No public read may reach the large operational tables.
    for (const table of ["op_odds_snapshots", "op_market_decisions", "op_fixture_decision_summaries"]) {
      expect(source).not.toContain(`from("${table}")`);
    }
  });

  it("preserves the last good payload when a refresh fails", async () => {
    const migration = await readFile(
      join(process.cwd(), "supabase", "migrations", "20260801012405_public_projection_store.sql"),
      "utf8"
    );
    expect(migration).toContain("if p_status = 'refresh_failed' then");
    // The failure branch must update only bookkeeping columns, never payload.
    const failureBranch = migration.slice(migration.indexOf("if p_status = 'refresh_failed' then"), migration.indexOf("return;"));
    expect(failureBranch).not.toMatch(/set[\s\S]*payload\s*=/);
  });

  it("never renders a raw error in the public state notice", async () => {
    const component = await readFile(join(process.cwd(), "src", "components", "product", "PublicStateNotice.tsx"), "utf8");
    expect(component).not.toContain("diagnostic");
    expect(component).not.toContain("lastError");
  });

  it("refreshes projections on a schedule rather than during a request", async () => {
    const sweep = await readFile(join(process.cwd(), "netlify", "functions", "projection-refresh-sweep.ts"), "utf8");
    expect(sweep).toContain("op_refresh_public_projections");
    expect(sweep).toMatch(/schedule:\s*"\*\/5 \* \* \* \*"/);
  });
});

describe("duplicate scheduled execution", () => {
  it("is idempotent: refreshing twice yields one row per projection", async () => {
    // The store is keyed on (name, scope) and written with an upsert, so a
    // duplicated schedule tick rebuilds rather than duplicating.
    const migration = await readFile(
      join(process.cwd(), "supabase", "migrations", "20260801012405_public_projection_store.sql"),
      "utf8"
    );
    expect(migration).toContain("primary key (name, scope)");
    expect(migration).toContain("on conflict (name, scope) do update set");
  });
});

describe("no provider calls during rendering", () => {
  it("keeps third-party hosts out of the read-model path", async () => {
    for (const file of ["src/lib/readmodel/publicProjection.ts", "src/lib/readmodel/publicStatus.ts"]) {
      const source = await readFile(join(process.cwd(), file), "utf8");
      for (const host of ["api-sports.io", "the-odds-api.com", "api-tennis.com", "fetch("]) {
        expect(source, `${file} must not reach a provider`).not.toContain(host);
      }
    }
  });
});

describe("vitest sanity", () => {
  it("does not accidentally share mocked state between reads", async () => {
    const first = await readProjection("daily_fixture_slate", "a", { client: clientReturning({ data: projectionRow() }), now: NOW });
    const second = await readProjection("daily_fixture_slate", "b", { client: clientReturning({ error: { message: "x" } }), now: NOW });
    expect(first.availability).toBe("complete");
    expect(second.availability).toBe("unavailable");
    expect(vi.isMockFunction(() => {})).toBe(false);
  });
});
