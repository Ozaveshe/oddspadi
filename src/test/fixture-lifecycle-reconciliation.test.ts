import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { reconcileFixtureLifecycles } from "@/lib/sports/lifecycle/reconcile";

/**
 * The reconciler's three promises: idempotent, auditable, non-destructive.
 *
 * The job it replaces broke all three. It wrote its reason onto the fixture, so
 * the second correction erased the first; it re-decided the same rows every
 * run; and it marked matches abandoned on nothing but elapsed time.
 */

const NOW = new Date("2026-08-06T18:00:00Z");

type Row = Record<string, unknown>;

/** Minimal PostgREST-shaped double, recording what it was asked to write. */
function fakeClient(rows: Row[]) {
  const inserted: Row[] = [];
  const updated: { patch: Row; ids: string[] }[] = [];

  const select = () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "lt", "gte", "in", "limit"]) {
      builder[method] = () => builder;
    }
    // `limit` terminates the chain and is awaited.
    builder.limit = () => Promise.resolve({ data: rows, error: null });
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
    // than writing off.
    const { client } = fakeClient([
      fixture({ lifecycle_state: "unresolved", status: "finished", home_score: 2, away_score: 1, resulted_at: "2026-08-06T14:00:00Z" })
    ]);
    const report = await reconcileFixtureLifecycles({ commit: true, now: NOW, client });

    expect(report.changes[0].to).toBe("finished");
    expect(report.changes[0].basis).toBe("result-observed");
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
