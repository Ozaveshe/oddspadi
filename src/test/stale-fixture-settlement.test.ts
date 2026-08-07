import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { gradeMarketDecision } from "@/lib/sports/results/marketDecisionSettlement";
import { fixtureLifecycle } from "@/lib/sports/lifecycle/fixtureState";
import { runPublicationSettlement } from "@/lib/publication/settlePublications";

/**
 * The defect this file exists to keep fixed.
 *
 * `op_expire_stale_fixtures` wrote `status = 'abandoned'` on any fixture past
 * kickoff plus its sport's window. `abandoned` means the provider says the
 * match was called off; the sweep meant "we never heard". Settlement could not
 * tell the two apart, so it graded the second as the first: 52 of 134 settled
 * publications were `void`, and about 50 of those were matches that had been
 * played — Leagues Cup, EFL Cup, Liga Profesional, 22 competitions over four
 * days.
 *
 * Two facts have to stay separable for that not to recur. What the provider
 * told us lives in `status`. What we infer lives in `lifecycle_state`. An
 * inference in the evidence column is the whole bug, and the assertions below
 * are mostly about that one sentence.
 */

const MIGRATIONS = "supabase/migrations";

/**
 * Migrations are forward-only, so a function is defined by whichever file
 * defines it last. Asserting against a named file would mean these tests kept
 * passing against a definition production had already replaced.
 */
function latestMigrationDefining(functionName: string): string {
  const declares = new RegExp(`create\\s+(or\\s+replace\\s+)?function\\s+public\\.${functionName}\\b`, "i");
  const file = readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .filter((name) => declares.test(readFileSync(`${MIGRATIONS}/${name}`, "utf8")))
    .at(-1);
  expect(file, `no migration defines ${functionName}`).toBeDefined();
  return readFileSync(`${MIGRATIONS}/${file}`, "utf8");
}

/** Everything inside the `$$ ... $$` body, which is where the behaviour is. */
function functionBody(sql: string): string {
  return sql.replace(/--[^\n]*/g, "").match(/\$\$([\s\S]*)\$\$/)?.[1] ?? "";
}

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
    chain.limit = vi.fn(async () => ({ data: rows, error: null }));
    chain.in = vi.fn((column: string) => (column === "id" ? Promise.resolve({ data: rows, error: null }) : chain));
    return chain;
  };
  return {
    from: vi.fn((table: string) => builder(table === "op_publications" ? publications : fixtures)),
    rpc
  } as never;
}

const NOW = new Date("2026-08-07T04:00:00.000Z");

function publication(overrides: Row = {}): Row {
  return {
    id: "pub-1",
    fixture_id: "fix-1",
    fixture_external_id: "api-football:1530107",
    market: "match_winner",
    selection: "away",
    kickoff_at: "2026-08-06T22:00:00.000Z",
    ...overrides
  };
}

describe("the stale sweep quarantines instead of writing a match off", () => {
  const sweep = latestMigrationDefining("op_expire_stale_fixtures");
  const body = functionBody(sweep);

  it("records our inference in our own column", () => {
    expect(body).toMatch(/set\s+lifecycle_state\s*=\s*'unresolved'/i);
  });

  it("never writes the provider's status column", () => {
    // The single assertion that would have caught the original defect. An
    // update that sets `status` here is a clock claiming to be a source.
    const updates = body.match(/update\s+public\.op_fixtures[\s\S]*?returning/gi) ?? [];
    expect(updates.length).toBeGreaterThan(0);
    for (const update of updates) {
      expect(update, "the sweep must not write op_fixtures.status").not.toMatch(/\bset\b[\s\S]*?\bstatus\s*=/i);
    }
    expect(body).not.toMatch(/status\s*=\s*'abandoned'/i);
  });

  it("keeps the audit trail the old sweep did get right", () => {
    for (const key of ["expiredReason", "expiredAt", "statusBeforeExpiry"]) {
      expect(body, `${key} is how the damage was repairable at all`).toContain(key);
    }
  });

  it("appends a transition row rather than only stamping the fixture", () => {
    expect(body).toMatch(/insert\s+into\s+public\.op_fixture_lifecycle_transitions/i);
  });

  it("skips a fixture it has already quarantined, so a re-run is a no-op", () => {
    expect(body).toMatch(/lifecycle_state[\s\S]{0,60}is\s+distinct\s+from\s+'unresolved'/i);
  });

  it("derives the same state the sweep writes", () => {
    // The sweep and the read path must agree, or "is this match over?" has two
    // answers again. A football match nine hours past a four-hour window:
    const state = fixtureLifecycle(
      { sport: "football", kickoffAt: new Date("2026-08-06T19:00:00Z"), status: "scheduled" },
      NOW
    );
    expect(state.state).toBe("unresolved");
    expect(state.terminal, "quarantine must stay re-openable").toBe(false);
  });
});

describe("settlement refuses to turn an unknown into a verdict", () => {
  it("leaves a quarantined fixture at needs_review", () => {
    const grade = gradeMarketDecision({
      market: "match_winner",
      selection: "home",
      fixture: { status: "abandoned", lifecycleState: "unresolved", homeScore: null, awayScore: null }
    });
    expect(grade.result).toBe("needs_review");
    expect(grade.result).not.toBe("void");
  });

  it("still voids a match the provider says was called off", () => {
    for (const status of ["cancelled", "postponed", "abandoned"] as const) {
      const grade = gradeMarketDecision({
        market: "match_winner",
        selection: "home",
        // A provider statement, so `lifecycle_state` mirrors it rather than
        // quarantining. This path is not the bug and must keep working.
        fixture: { status, lifecycleState: status, homeScore: null, awayScore: null }
      });
      expect(grade.result, `${status} must still void`).toBe("void");
    }
  });

  it("keeps a publication on a quarantined fixture unsettled, not void", async () => {
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = stubClient({
      publications: [publication()],
      fixtures: [{ id: "fix-1", status: "abandoned", lifecycle_state: "unresolved", home_score: null, away_score: null }],
      rpc
    });

    const result = await runPublicationSettlement({ client, persist: true, now: NOW });

    expect(result.totals.void).toBe(0);
    expect(result.totals.awaitingResult).toBe(1);
    expect(rpc, "no verdict may be written for a match we cannot account for").not.toHaveBeenCalled();
  });

  it("keeps a repaired publication unsettled while the fixture waits", async () => {
    // After repair the fixture sits back at the provider status the sweep
    // overwrote — `scheduled` — with our quarantine recorded beside it.
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = stubClient({
      publications: [publication()],
      fixtures: [{ id: "fix-1", status: "scheduled", lifecycle_state: "unresolved", home_score: null, away_score: null }],
      rpc
    });

    const result = await runPublicationSettlement({ client, persist: true, now: NOW });

    expect(result.totals.awaitingResult).toBe(1);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("grades a repaired publication once the result finally arrives", async () => {
    // The point of the repair: `unresolved` is not terminal, so a late result
    // still produces an honest won or lost instead of finding a void.
    const rpc = vi.fn().mockResolvedValue({ error: null });
    const client = stubClient({
      publications: [publication({ selection: "away" })],
      fixtures: [{ id: "fix-1", status: "finished", lifecycle_state: "finished", home_score: 0, away_score: 2 }],
      rpc
    });

    const won = await runPublicationSettlement({ client, persist: true, now: NOW });
    expect(won.totals.won).toBe(1);
    expect(rpc.mock.calls[0][1].p_status).toBe("won");

    const lostClient = stubClient({
      publications: [publication({ selection: "home" })],
      fixtures: [{ id: "fix-1", status: "finished", lifecycle_state: "finished", home_score: 0, away_score: 2 }]
    });
    const lost = await runPublicationSettlement({ client: lostClient, persist: true, now: NOW });
    expect(lost.totals.lost).toBe(1);
  });
});

describe("the repair is auditable, reversible and idempotent", () => {
  const repair = functionBody(latestMigrationDefining("op_repair_inference_expired_fixtures"));
  const unsettle = functionBody(latestMigrationDefining("op_unsettle_publication"));

  it("only touches rows the sweep forged, never a provider statement", () => {
    expect(repair).toMatch(/expiredReason'\s*=\s*'no-provider-result'/);
    expect(repair).toMatch(/statusBeforeExpiry'\s+is\s+not\s+null/i);
  });

  it("restores the provider's own last word rather than inventing one", () => {
    expect(repair).toMatch(/set\s+status\s*=\s*f\.metadata\s*->>\s*'statusBeforeExpiry'/i);
    expect(repair, "an unknown stays unknown").not.toMatch(/status\s*=\s*'finished'/i);
    expect(repair).not.toMatch(/resulted_at\s*=/i);
    expect(repair).not.toMatch(/home_score\s*=/i);
  });

  it("writes a transition row for every fixture it moves", () => {
    expect(repair).toMatch(/insert\s+into\s+public\.op_fixture_lifecycle_transitions/i);
    // Audit before the state change, matching the reconciler.
    expect(repair.indexOf("op_fixture_lifecycle_transitions")).toBeLessThan(
      repair.search(/update\s+public\.op_fixtures/i)
    );
  });

  it("withdraws verdicts through the sanctioned path, never a bare update", () => {
    expect(repair).toMatch(/perform\s+public\.op_unsettle_publication/i);
    expect(repair, "history must not be rewritten in place").not.toMatch(/update\s+public\.op_publications/i);
    expect(unsettle).toMatch(/perform\s+public\.op_correct_publication/i);
  });

  it("retires the wrong settlement instead of deleting it", () => {
    expect(unsettle).toMatch(/set\s+is_current\s*=\s*false/i);
    expect(unsettle).not.toMatch(/delete\s+from/i);
    expect(repair).not.toMatch(/delete\s+from/i);
  });

  it("can be previewed before it writes anything", () => {
    expect(repair).toMatch(/if\s+not\s+p_commit\s+then[\s\S]{0,40}return;/i);
  });

  it("finds nothing left to do on a second run", () => {
    // Idempotence by construction rather than by a flag: the repair selects
    // `status = 'abandoned'` and its own update moves the row off that status,
    // so no row can match twice. Withdrawing a verdict is guarded the same way.
    expect(repair).toMatch(/where\s+f\.status\s*=\s*'abandoned'/i);
    expect(unsettle).toMatch(/if\s+v_current\.settlement_status\s*=\s*'unsettled'\s+then[\s\S]{0,60}return\s+v_current;/i);
  });
});
