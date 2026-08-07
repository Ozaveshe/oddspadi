import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { QUARANTINED_LIFECYCLE_STATES } from "@/lib/publication/settlePublications";
import { QUARANTINED_STATES, reconcileFixtureLifecycles } from "@/lib/sports/lifecycle/reconcile";

/**
 * The reconciler's three promises: idempotent, auditable, non-destructive.
 *
 * The job it replaces broke all three. It wrote its reason onto the fixture, so
 * the second correction erased the first; it re-decided the same rows every
 * run; and it marked matches abandoned on nothing but elapsed time.
 */

const NOW = new Date("2026-08-06T18:00:00Z");

/**
 * What PostgREST will hand back at most, whatever `.limit()` asked for.
 *
 * Small here so a pagination test does not need a thousand fixtures, but it
 * models the real cap: on this project `db-max-rows` is 1000, and exceeding it
 * truncates silently rather than erroring.
 */
const MAX_ROWS = 2;

type Row = Record<string, unknown>;

/**
 * Minimal PostgREST-shaped double, recording what it was asked to write.
 *
 * The `.in(...)` filter is **applied**, not stubbed out. An earlier version of
 * this double accepted every filter and returned the whole row set, which made
 * "resolves a quarantined fixture once a result arrives" pass while production
 * could not do it: the real query filtered on `status in (scheduled, live)`, so
 * a recovered fixture whose status had become `finished` was invisible to the
 * job. A double that ignores the filter cannot catch a bug in the filter.
 */
function fakeClient(rows: Row[]) {
  const inserted: Row[] = [];
  const updated: { patch: Row; ids: string[] }[] = [];

  const select = () => {
    const filters: { column: string; values: unknown[] }[] = [];
    let after: string | null = null;
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "lt", "gte", "order"]) {
      builder[method] = () => builder;
    }
    builder.in = (column: string, values: unknown[]) => {
      filters.push({ column, values });
      return builder;
    };
    // The keyset cursor is honoured, so a paginating caller terminates instead
    // of re-reading page one for ever.
    builder.gt = (column: string, value: string) => {
      if (column === "id") after = value;
      return builder;
    };
    // `limit` terminates the chain and is awaited. It caps the page the way
    // PostgREST's `db-max-rows` does, so a caller that fails to paginate sees a
    // short read here too.
    builder.limit = (size: number) => {
      const matched = rows
        .filter((row) => filters.every((f) => f.values.includes(row[f.column])))
        .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        .filter((row) => after === null || String(row.id) > after);
      return Promise.resolve({ data: matched.slice(0, Math.min(size, MAX_ROWS)), error: null });
    };
    return builder;
  };

  const client = {
    from(table: string) {
      if (table === "op_fixture_lifecycle_transitions") {
        return {
          insert: (payload: Row[]) => {
            inserted.push(...payload);
            return Promise.resolve({ error: null });
          }
        };
      }
      return {
        ...select(),
        update: (patch: Row) => ({
          in: (_column: string, ids: string[]) => {
            updated.push({ patch, ids });
            return Promise.resolve({ error: null });
          }
        })
      };
    }
  };

  return { client: client as never, inserted, updated };
}

const fixture = (overrides: Row = {}): Row => ({
  id: "fixture-1",
  sport: "football",
  status: "scheduled",
  lifecycle_state: null,
  kickoff_at: "2026-08-06T12:00:00Z",
  started_at: null,
  resulted_at: null,
  home_score: null,
  away_score: null,
  ...overrides
});

describe("lifecycle reconciliation", () => {
  it("quarantines an overdue fixture instead of writing it off", async () => {
    // Six hours past a four-hour football window with no evidence either way.
    const { client, updated } = fakeClient([fixture()]);
    const report = await reconcileFixtureLifecycles({ commit: true, now: NOW, client });

    expect(report.changes).toHaveLength(1);
    expect(report.changes[0].to).toBe("unresolved");
    expect(report.changes[0].basis).toBe("no-evidence");
    // Not "abandoned", not "finished" — both would be claims we cannot support.
    expect(updated.flatMap((u) => Object.values(u.patch))).not.toContain("abandoned");
  });

  it("never touches the provider's status column", async () => {
    // Status is the provider's last word. Folding our inference into it would
    // destroy the statement the inference was drawn from.
    const { client, updated } = fakeClient([fixture()]);
    await reconcileFixtureLifecycles({ commit: true, now: NOW, client });

    for (const write of updated) {
      expect(Object.keys(write.patch), "reconciliation must not write status").not.toContain("status");
      expect(Object.keys(write.patch)).toContain("lifecycle_state");
    }
  });

  it("writes an audit row for every change, before the change", async () => {
    const { client, inserted } = fakeClient([fixture()]);
    await reconcileFixtureLifecycles({ commit: true, now: NOW, runId: "run-7", client });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      fixture_id: "fixture-1",
      from_state: "unreconciled",
      to_state: "unresolved",
      basis: "no-evidence",
      run_id: "run-7"
    });
    expect(inserted[0].overdue_hours).toBe(2);
  });

  it("writes nothing on a second run over unchanged data", async () => {
    // Idempotence: compared against our own last reading, not the provider's
    // status, which legitimately differs and would otherwise churn every run.
    const { client, inserted, updated } = fakeClient([fixture({ lifecycle_state: "unresolved" })]);
    const report = await reconcileFixtureLifecycles({ commit: true, now: NOW, client });

    expect(report.changes).toEqual([]);
    expect(inserted).toEqual([]);
    expect(updated).toEqual([]);
  });

  it("resolves a quarantined fixture once a result arrives", async () => {
    // `unresolved` is not terminal — that is the point of quarantining rather
    // than writing off. Note the status here is `finished`, which the forward
    // scan deliberately excludes; only the release path can see this row.
    const { client } = fakeClient([
      fixture({ lifecycle_state: "unresolved", status: "finished", home_score: 2, away_score: 1, resulted_at: "2026-08-06T14:00:00Z" })
    ]);
    const report = await reconcileFixtureLifecycles({ commit: true, now: NOW, client });

    expect(report.changes[0].to).toBe("finished");
    expect(report.changes[0].basis).toBe("result-observed");
  });

  it("releases a quarantined fixture whose kick-off predates the lookback window", async () => {
    // Quarantine is a backlog, not a window. Recovery runs against fixtures far
    // older than `lookbackHours` — the oldest in production was 27 days — and
    // bounding the release path by the same window would strand exactly the
    // rows the recovery just answered.
    const { client, updated } = fakeClient([
      fixture({
        kickoff_at: "2026-07-11T21:00:00Z",
        lifecycle_state: "unresolved",
        status: "finished",
        home_score: 1,
        away_score: 0,
        resulted_at: "2026-07-11T23:00:00Z"
      })
    ]);
    const report = await reconcileFixtureLifecycles({ commit: true, now: NOW, lookbackHours: 96, client });

    expect(report.changes).toHaveLength(1);
    expect(report.changes[0].to).toBe("finished");
    expect(updated[0].patch).toMatchObject({ lifecycle_state: "finished" });
  });

  it("counts a fixture matched by both scans only once", async () => {
    // A quarantined fixture the provider still calls `scheduled` satisfies the
    // forward filter and the release filter. Without de-duplication it would be
    // decided twice and audited twice for one change.
    const { client, inserted } = fakeClient([fixture({ lifecycle_state: "due", status: "scheduled" })]);
    const report = await reconcileFixtureLifecycles({ commit: true, now: NOW, client });

    expect(report.scanned).toBe(1);
    expect(report.changes).toHaveLength(1);
    expect(inserted).toHaveLength(1);
  });

  it("reads past the provider's row cap instead of stopping at page one", async () => {
    // PostgREST truncates at `db-max-rows` without saying so. Against the real
    // 1,888-row quarantine backlog a single capped read returned 1000 rows and
    // looked complete, leaving 32 football fixtures that already held a final
    // score sitting quarantined on page two.
    const backlog = Array.from({ length: MAX_ROWS * 3 + 1 }, (_, index) =>
      fixture({
        // Zero-padded so lexical id order is stable and the cursor advances.
        id: `fixture-${String(index).padStart(3, "0")}`,
        lifecycle_state: "unresolved",
        status: "finished",
        home_score: 1,
        away_score: 0,
        resulted_at: "2026-08-06T14:00:00Z"
      })
    );
    const { client, updated } = fakeClient(backlog);
    const report = await reconcileFixtureLifecycles({ commit: true, now: NOW, client });

    expect(report.scanned).toBe(backlog.length);
    expect(report.changes).toHaveLength(backlog.length);
    expect(updated.flatMap((write) => write.ids)).toHaveLength(backlog.length);
  });

  it("revisits exactly the states that block settlement", async () => {
    // If these drift, a fixture becomes unsettleable with nothing left to
    // release it: settlement refuses to grade it, and the reconciler no longer
    // looks at it.
    expect([...QUARANTINED_STATES].sort()).toEqual([...QUARANTINED_LIFECYCLE_STATES].sort());
  });

  it("changes nothing when not committing", async () => {
    const { client, inserted, updated } = fakeClient([fixture()]);
    const report = await reconcileFixtureLifecycles({ commit: false, now: NOW, client });

    expect(report.status).toBe("preview");
    expect(report.changes).toHaveLength(1);
    expect(inserted).toEqual([]);
    expect(updated).toEqual([]);
  });

  it("reports honestly rather than throwing when storage is absent", async () => {
    const report = await reconcileFixtureLifecycles({ commit: true, now: NOW, client: null });
    expect(report.status).toBe("unavailable");
    expect(report.errors).toHaveLength(1);
  });

  it("deletes nothing, anywhere", async () => {
    // The instruction was explicit: quarantine and auditable transitions, never
    // silent deletion of evidence.
    const source = readFileSync("src/lib/sports/lifecycle/reconcile.ts", "utf8");
    expect(source).not.toMatch(/\.delete\(/);
  });

  it("runs inside the scheduled results job", async () => {
    const route = readFileSync("src/app/api/cron/refresh-results/route.ts", "utf8");
    expect(route).toContain("reconcileFixtureLifecycles({ commit");
    // After the provider refresh, so a fixture is only ever reconciled once one
    // more genuine attempt to resolve it has been made. Compared against the
    // call site, not the import — `indexOf` would match the import line and
    // pass for the wrong reason.
    expect(route.indexOf("await reconcileFixtureLifecycles(")).toBeGreaterThan(route.indexOf("await refreshResults("));
  });
});
