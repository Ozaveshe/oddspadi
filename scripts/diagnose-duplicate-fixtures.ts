/**
 * How many real matches does `op_fixtures` hold twice?
 *
 *   npm run ops:duplicate-fixtures -- [--from ISO] [--to ISO] [--samples 12]
 *
 * `op_fixtures` is keyed on `(provider, sport, external_id)`, so one match
 * arriving from two providers is two rows. Measured 2026-08-03, "Lanus vs
 * Instituto de Córdoba" (the-odds-api-events) sat next to "Lanus vs Instituto
 * Cordoba" (api-football) at the same kickoff: the first ended `abandoned` with
 * no reachable result, the second finished 0-1.
 *
 * Read-only. It reports what a merge or a slate exclusion would touch and
 * changes nothing.
 */
import { createClient } from "@supabase/supabase-js";

import {
  findDuplicateFixtures,
  type DuplicateFixtureGroup,
  type DuplicateFixtureRow
} from "../src/lib/sports/intelligence/duplicateFixtures";

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const from = argValue("from") ?? "1970-01-01T00:00:00.000Z";
const toExclusive = argValue("to") ?? "2100-01-01T00:00:00.000Z";
const sampleLimit = Number(argValue("samples") ?? 12);

type StoredRow = DuplicateFixtureRow & {
  leagueName: string | null;
  lastSyncedAt: string | null;
  homeExternalId: string;
  awayExternalId: string;
};

/**
 * Keyset by kickoff, the same way `readStoredSlate` pages. A bare `.limit()`
 * would return the first page and report it as the whole table.
 */
async function readFixtures(): Promise<StoredRow[]> {
  const rows: StoredRow[] = [];
  const seen = new Set<string>();
  let cursor = from;
  for (let page = 0; page < 200; page += 1) {
    const { data, error } = await db
      .from("op_fixtures")
      .select("id,sport,provider,external_id,kickoff_at,status,home_team_name,away_team_name,home_team_external_id,away_team_external_id,home_score,away_score,league_name,last_synced_at,metadata")
      .gte("kickoff_at", cursor)
      .lt("kickoff_at", toExclusive)
      .order("kickoff_at", { ascending: true })
      .limit(1000);
    if (error) throw new Error(`op_fixtures: ${error.message}`);
    if (!data?.length) break;
    const fresh = data.filter((row) => !seen.has(String(row.id)));
    for (const row of fresh) {
      seen.add(String(row.id));
      const metadata = (row.metadata ?? {}) as Record<string, unknown>;
      // Same exclusion the slate read applies, so the counts describe rows that
      // can actually reach a page.
      if (String(row.provider).toLowerCase().includes("mock")) continue;
      if (metadata.sourceKind === "demo" || metadata.sourceKind === "mock") continue;
      rows.push({
        id: String(row.id),
        sport: String(row.sport),
        provider: String(row.provider),
        externalId: String(row.external_id),
        kickoffAt: String(row.kickoff_at),
        status: String(row.status),
        homeTeamName: String(row.home_team_name ?? ""),
        awayTeamName: String(row.away_team_name ?? ""),
        homeScore: row.home_score === null ? null : Number(row.home_score),
        awayScore: row.away_score === null ? null : Number(row.away_score),
        leagueName: row.league_name === null ? null : String(row.league_name),
        lastSyncedAt: row.last_synced_at === null ? null : String(row.last_synced_at),
        homeExternalId: String(row.home_team_external_id ?? ""),
        awayExternalId: String(row.away_team_external_id ?? "")
      });
    }
    if (data.length < 1000) break;
    const next = String(data[data.length - 1].kickoff_at);
    if (next === cursor) {
      console.warn(`  ! a full page shares kickoff ${next}; the sweep stops here rather than looping.`);
      break;
    }
    cursor = next;
  }
  return rows;
}

/** Distinct bookmakers stored per fixture — the depth a merge would recover. */
async function readBookmakerDepth(fixtureIds: string[]): Promise<Map<string, Set<string>>> {
  const depth = new Map<string, Set<string>>();
  for (let index = 0; index < fixtureIds.length; index += 50) {
    const chunk = fixtureIds.slice(index, index + 50);
    const { data, error } = await db
      .from("op_odds_snapshots")
      .select("fixture_id,bookmaker")
      .in("fixture_id", chunk)
      .limit(20000);
    if (error) throw new Error(`op_odds_snapshots: ${error.message}`);
    for (const row of data ?? []) {
      const id = String(row.fixture_id);
      if (!depth.has(id)) depth.set(id, new Set());
      depth.get(id)?.add(String(row.bookmaker));
    }
  }
  return depth;
}

/** Crest coverage, so "prefer the provider that supplies artwork" is measured rather than assumed. */
async function readCrestCoverage(rows: StoredRow[]): Promise<Map<string, { withLogo: number; total: number }>> {
  const byProvider = new Map<string, { withLogo: number; total: number }>();
  const wanted = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!wanted.has(row.provider)) wanted.set(row.provider, new Set());
    wanted.get(row.provider)?.add(row.homeExternalId);
    wanted.get(row.provider)?.add(row.awayExternalId);
  }
  for (const [provider, ids] of wanted) {
    const list = [...ids];
    let withLogo = 0;
    for (let index = 0; index < list.length; index += 100) {
      const { data, error } = await db
        .from("op_teams")
        .select("external_id,metadata")
        .eq("provider", provider)
        .in("external_id", list.slice(index, index + 100));
      if (error) throw new Error(`op_teams: ${error.message}`);
      for (const team of data ?? []) {
        const metadata = (team.metadata ?? {}) as Record<string, unknown>;
        if (typeof metadata.logo === "string" && metadata.logo.trim()) withLogo += 1;
      }
    }
    byProvider.set(provider, { withLogo, total: list.length });
  }
  return byProvider;
}

function tally<T>(items: T[], keyOf: (item: T) => string): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1]);
}

function printTally(label: string, entries: Array<[string, number]>, indent = "  ") {
  console.log(`${indent}${label}`);
  for (const [name, count] of entries) console.log(`${indent}  ${String(count).padStart(6)}  ${name}`);
}

function describe(row: StoredRow): string {
  const score = row.homeScore === null || row.awayScore === null ? "no score" : `${row.homeScore}-${row.awayScore}`;
  return `${row.provider} | ${row.homeTeamName} vs ${row.awayTeamName} | ${row.kickoffAt} | ${row.status} | ${score} | ${row.leagueName ?? "no league"}`;
}

const RESULTS_BACKED = new Set(["api-football", "api-basketball", "api-tennis"]);

const fixtures = await readFixtures();
console.log(`\nop_fixtures scanned: ${fixtures.length} rows in [${from} .. ${toExclusive})`);
printTally("by provider:", tally(fixtures, (row) => row.provider));
printTally("by sport:", tally(fixtures, (row) => row.sport));

/**
 * Duplicates that need no matcher at all: the same provider external id filed
 * under two spellings of the provider name. `op_fixtures` is unique on
 * `(provider, sport, external_id)`, so `api-football` and `api_football` are two
 * rows for one fixture by construction. The name matcher cannot see these — the
 * second lane stores no team names — so they are counted separately.
 */
const byExternalId = new Map<string, StoredRow[]>();
for (const row of fixtures) {
  const key = `${row.sport}:${row.externalId}`;
  byExternalId.set(key, [...(byExternalId.get(key) ?? []), row]);
}
const externalIdCollisions = [...byExternalId.values()].filter((rows) => new Set(rows.map((row) => row.provider)).size > 1);
console.log(`\nSame external id under more than one provider name: ${externalIdCollisions.length} fixtures`);
printTally(
  "provider spellings involved:",
  tally(externalIdCollisions.flat(), (row) => `${row.provider}${row.homeTeamName ? "" : " (no team names stored)"}`)
);

const { groups, review } = findDuplicateFixtures(fixtures);
const duplicateRows = groups.flatMap((group) => group.duplicates) as StoredRow[];

console.log(`\nDuplicate groups: ${groups.length}`);
console.log(`  rows a slate exclusion would drop: ${duplicateRows.length} (${((duplicateRows.length / Math.max(1, fixtures.length)) * 100).toFixed(1)}% of the table)`);
printTally("by evidence tier:", tally(groups, (group) => group.qualifierMatch));
printTally("by sport:", tally(groups, (group) => group.canonical.sport));
printTally(
  "by provider pair (canonical <- dropped):",
  tally(groups, (group) => `${group.canonical.provider} <- ${group.duplicates.map((row) => row.provider).sort().join(", ")}`)
);

const unsettleableDuplicates = duplicateRows.filter((row) => !RESULTS_BACKED.has(row.provider));
const settleableCanonicals = groups.filter((group) => RESULTS_BACKED.has(group.canonical.provider));
const scoredCanonicals = groups.filter((group) => group.canonical.homeScore !== null && group.canonical.awayScore !== null);
console.log(`\nSettlement reach`);
console.log(`  duplicate rows held by a provider with no results endpoint: ${unsettleableDuplicates.length}`);
console.log(`  groups whose canonical row is results-backed:              ${settleableCanonicals.length} of ${groups.length}`);
console.log(`  groups whose canonical row already carries a final score:  ${scoredCanonicals.length} of ${groups.length}`);

/**
 * Which row in a group actually carries the result. The reason for asking: if a
 * group's only final score sits on the row an exclusion would drop, excluding it
 * loses the result instead of recovering it.
 */
const scoreOf = (row: DuplicateFixtureRow) => (row.homeScore === null || row.awayScore === null ? null : `${row.homeScore}-${row.awayScore}`);
const membersOf = (group: DuplicateFixtureGroup) => [group.canonical, ...group.duplicates];
const resultOnlyOnDuplicate = groups.filter((group) => !scoreOf(group.canonical) && group.duplicates.some((row) => scoreOf(row)));
const conflictingScores = groups.filter((group) => new Set(membersOf(group).map(scoreOf).filter(Boolean)).size > 1);
const finishedOnlyOnDuplicate = groups.filter(
  (group) => group.canonical.status !== "finished" && group.duplicates.some((row) => row.status === "finished")
);
console.log(`\nWhere the result actually lives`);
console.log(`  groups whose only final score sits on a row an exclusion would drop: ${resultOnlyOnDuplicate.length}`);
console.log(`  groups where two rows report different scores:                       ${conflictingScores.length}`);
console.log(`  groups where only a dropped row reached status finished:             ${finishedOnlyOnDuplicate.length}`);
printTally(
  "provider holding the sole final score in those groups:",
  tally(resultOnlyOnDuplicate.flatMap((group) => group.duplicates.filter((row) => scoreOf(row))), (row) => row.provider)
);
for (const group of conflictingScores.slice(0, 5)) {
  console.log(`    conflict: ${membersOf(group).map((row) => `${row.provider}=${scoreOf(row) ?? "none"}/${row.status}`).join("  vs  ")}`);
}

const crests = await readCrestCoverage(groups.flatMap(membersOf) as StoredRow[]);
console.log(`\nCrest coverage on the teams named by these groups`);
for (const [provider, coverage] of [...crests.entries()].sort((left, right) => right[1].total - left[1].total)) {
  console.log(`  ${String(coverage.withLogo).padStart(5)} / ${String(coverage.total).padEnd(5)} teams have a logo  ${provider}`);
}

console.log(`\nAmbiguous clusters left for review: ${review.length}`);
for (const entry of review.slice(0, sampleLimit)) {
  console.log(`  - ${entry.reason}`);
  for (const row of entry.rows as StoredRow[]) console.log(`      ${describe(row)}`);
}

if (groups.length) {
  const allIds = groups.flatMap((group) => [group.canonical.id, ...group.duplicates.map((row) => row.id)]);
  const depth = await readBookmakerDepth(allIds);
  const bookmakersOf = (row: DuplicateFixtureRow) => depth.get(row.id) ?? new Set<string>();
  let splitGroups = 0;
  let depthGained = 0;
  for (const group of groups) {
    const canonical = bookmakersOf(group.canonical);
    const merged = new Set(canonical);
    for (const duplicate of group.duplicates) for (const book of bookmakersOf(duplicate)) merged.add(book);
    if (merged.size > canonical.size) {
      splitGroups += 1;
      depthGained += merged.size - canonical.size;
    }
  }
  console.log(`\nOdds split across the duplicate rows`);
  console.log(`  groups where the dropped row holds a bookmaker the canonical row lacks: ${splitGroups} of ${groups.length}`);
  console.log(`  bookmakers the canonical rows would gain from a merge:                  ${depthGained}`);
  console.log(`  groups with no stored odds on either row:                               ${groups.filter((group) => !bookmakersOf(group.canonical).size && group.duplicates.every((row) => !bookmakersOf(row).size)).length}`);

  console.log(`\nSamples (canonical first)`);
  for (const group of groups.slice(0, sampleLimit) as DuplicateFixtureGroup[]) {
    console.log(`  [${group.qualifierMatch}] ${describe(group.canonical as StoredRow)}  <${bookmakersOf(group.canonical).size} books>`);
    for (const duplicate of group.duplicates) {
      console.log(`      drop  ${describe(duplicate as StoredRow)}  <${bookmakersOf(duplicate).size} books>`);
    }
  }
}

console.log("");
