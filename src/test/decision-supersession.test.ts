import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * "Current" must identify one decision per selection. It identified eighty.
 *
 * `persistMarketDecisions` built its prior lookup with
 * `new Map(rows.map(row => [key, row]))`. A Map keeps one value per key, and
 * there is one prior per selection *per engine run*, so supersession retired a
 * single arbitrary row and left every other generation marked current. One row
 * added and at most one retired per run — the backlog could only grow.
 *
 * It also did `if (prior.settlement_status !== "pending") continue`, so when
 * that arbitrary prior happened to be settled, nothing for that selection was
 * retired at all.
 *
 * Measured in production 2026-08-03, on a single day's board: 534 distinct
 * selections carrying 43,586 rows with `superseded_by is null`, 81.6
 * generations each, oldest six days old. The slate read pulled all of them,
 * taking 5,027ms against an 8s statement timeout — one of the reads that made
 * the board intermittently blank. 244,992 rows were retired by the backfill.
 *
 * These are source assertions rather than behavioural ones because the writer
 * needs a live PostgREST client; the shapes below are exactly what regressed.
 */
const REPOSITORY = "src/lib/sports/intelligence/repository.ts";

async function repository(): Promise<string> {
  return readFile(REPOSITORY, "utf8");
}

describe("market decision supersession", () => {
  it("keeps every prior for a selection, not the last one a Map survived", async () => {
    const source = await repository();

    // The exact construction that lost 80 of 81 priors.
    expect(source, "previousByKey must not collapse duplicate keys through a Map constructor").not.toMatch(
      /previousByKey\s*=\s*new Map\(\s*\(previous/
    );
    // It must accumulate into per-key buckets.
    expect(source).toMatch(/previousByKey\s*=\s*new Map<string,\s*Array</);
    expect(source).toMatch(/bucket\.push\(entry\)/);
  });

  it("retires all pending priors and never lets a settled one block them", async () => {
    const source = await repository();

    // Settled rows stay untouched — grading must not be rewritten — but the
    // filter has to be per-row, not an early continue for the whole selection.
    expect(source).toMatch(/prior\.settlement_status === "pending"/);
    expect(source, "a settled prior must not skip the whole selection").not.toMatch(
      /prior\.settlement_status !== "pending"\)\s*continue/
    );
  });

  it("supersedes in batches rather than one request per prior", async () => {
    const source = await repository();
    // lastIndexOf: `return decisionsByFixture` also appears as an early return
    // at the top of the function, which would slice to nothing.
    const loop = source.slice(source.indexOf("const supersededAt"), source.lastIndexOf("return decisionsByFixture"));
    expect(loop, "supersession loop not found").not.toBe("");

    // 244,992 rows needed retiring; one round trip each is not an option.
    expect(loop).toMatch(/for \(const idChunk of chunks\(retirable\)\)/);
    expect(loop).toMatch(/\.in\("id", idChunk\)/);
    expect(loop).not.toMatch(/\.eq\("id", prior\.id\)/);
  });
});

describe("slate reads stay off the statement timeout", () => {
  it("reads current odds from the projection, not a distinct-on over history", async () => {
    // op_odds_snapshots holds 1.59M rows, ~405 per fixture, and the read did
    // `distinct on (fixture, market, selection) order by captured_at desc` over
    // all of them: 105,277 rows scanned to return 534, 8,212ms against an 8s
    // timeout. Roughly one request in eight lost that race and the board came
    // back empty.
    const migration = await readFile("supabase/migrations/20260803170000_current_odds_projection.sql", "utf8");

    expect(migration).toMatch(/create table if not exists public\.op_current_odds/);
    expect(migration).toMatch(/primary key \(fixture_id, market, selection\)/);
    // Only ever moves forward, so a backfill cannot overwrite a newer quote.
    expect(migration).toMatch(/where excluded\.captured_at >= c\.captured_at/);
    // Maintained by trigger, so the write side pays instead of every page view.
    expect(migration).toMatch(/after insert on public\.op_odds_snapshots/);
  });

  it("indexes the current-row lookups by fixture, not by superseded_by alone", async () => {
    const migration = await readFile("supabase/migrations/20260803180000_slate_read_current_rows.sql", "utf8");

    for (const table of ["op_fixture_decision_summaries", "op_market_decisions"]) {
      expect(migration).toMatch(new RegExp(`on public\\.${table} \\(fixture_id, generated_at desc\\)`));
    }
    expect(migration.match(/where superseded_by is null/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
