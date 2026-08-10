/**
 * One real match, stored twice.
 *
 * `op_fixtures` is keyed on `(provider, sport, external_id)`, so the same match
 * arriving from two providers is two rows. Football's ingest already refuses to
 * append an odds-only event that aligns with a fixture it already holds, but
 * basketball and tennis only compared exact event keys, and every row written
 * before those guards existed is still stored. Measured 2026-08-03: 200 groups
 * over 28,300 rows, and the board counted each of those matches twice.
 *
 * Prices are not evenly split between the pair so much as stranded on one side
 * of it — in 39 of the 200 groups every stored bookmaker sat on the row a naive
 * exclusion would drop, which is why a caller should merge before it excludes.
 */
import { squadQualifiers, squadQualifiersMoveTogether, teamNamesAlign } from "@/lib/sports/providers/teamNameAlignment";

export type DuplicateFixtureRow = {
  id: string;
  sport: string;
  provider: string;
  externalId: string;
  kickoffAt: string;
  status: string;
  homeTeamName: string;
  awayTeamName: string;
  homeScore: number | null;
  awayScore: number | null;
};

export type DuplicateFixtureGroup = {
  canonical: DuplicateFixtureRow;
  duplicates: DuplicateFixtureRow[];
  /** `exact` when every row spells the squad the same way, `uniform` when the qualifier rule carried the match. */
  qualifierMatch: "exact" | "uniform";
};

/** A cluster the matcher will not resolve on its own, kept out of any merge. */
export type DuplicateFixtureReview = {
  rows: DuplicateFixtureRow[];
  reason: string;
};

/** Same tolerance the provider odds join already uses to call two kickoffs one kickoff. */
const KICKOFF_TOLERANCE_MS = 15 * 60_000;

/**
 * The lanes that carry both a results endpoint and team crests. Measured
 * 2026-08-03, every team these lanes name in a duplicate group has a logo
 * (api-football 245/245, api-basketball 34/34) against 135 of 274 for
 * `the-odds-api-events`.
 *
 * Not a claim that no other provider reports scores — `the-odds-api-scores`
 * demonstrably does, and in a handful of groups it holds a final score the
 * API-Sports row is still missing. Those are reported by the diagnostic for a
 * source-side fix; the canonical row never inherits another row's result, so
 * preferring the crested lane here costs nothing that was ever published.
 */
const RESULTS_BACKED_PROVIDERS = new Set(["api-football", "api-basketball", "api-tennis"]);

function kickoffsAlign(left: string, right: string): boolean {
  const leftMs = Date.parse(left);
  const rightMs = Date.parse(right);
  if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) return false;
  return Math.abs(leftMs - rightMs) <= KICKOFF_TOLERANCE_MS;
}

function fixturesAlign(left: DuplicateFixtureRow, right: DuplicateFixtureRow): boolean {
  return (
    left.sport === right.sport &&
    kickoffsAlign(left.kickoffAt, right.kickoffAt) &&
    teamNamesAlign(left.homeTeamName, right.homeTeamName) &&
    teamNamesAlign(left.awayTeamName, right.awayTeamName) &&
    squadQualifiersMoveTogether(left.homeTeamName, right.homeTeamName, left.awayTeamName, right.awayTeamName)
  );
}

/** Higher wins. Results capability first, then evidence the row actually carries a result. */
function canonicalRank(row: DuplicateFixtureRow): number {
  const resultsBacked = RESULTS_BACKED_PROVIDERS.has(row.provider) ? 1 : 0;
  const hasScore = row.homeScore !== null && row.awayScore !== null ? 1 : 0;
  return resultsBacked * 2 + hasScore;
}

export function findDuplicateFixtures(rows: DuplicateFixtureRow[]): {
  groups: DuplicateFixtureGroup[];
  review: DuplicateFixtureReview[];
} {
  // Bucketed by kickoff so this stays linear-ish over the whole table. Two rows
  // can only align within the tolerance, so a row need only be compared against
  // clusters in its own bucket and the two neighbouring ones.
  const clusters: DuplicateFixtureRow[][] = [];
  const clustersByBucket = new Map<string, DuplicateFixtureRow[][]>();
  const bucketsOf = (row: DuplicateFixtureRow): string[] => {
    const ms = Date.parse(row.kickoffAt);
    if (!Number.isFinite(ms)) return [`${row.sport}:unparsed`];
    const index = Math.floor(ms / KICKOFF_TOLERANCE_MS);
    return [`${row.sport}:${index}`];
  };
  const neighbourhoodOf = (row: DuplicateFixtureRow): string[] => {
    const ms = Date.parse(row.kickoffAt);
    if (!Number.isFinite(ms)) return [`${row.sport}:unparsed`];
    const index = Math.floor(ms / KICKOFF_TOLERANCE_MS);
    return [`${row.sport}:${index - 1}`, `${row.sport}:${index}`, `${row.sport}:${index + 1}`];
  };
  for (const row of rows) {
    const nearby = new Set(neighbourhoodOf(row).flatMap((bucket) => clustersByBucket.get(bucket) ?? []));
    const cluster = [...nearby].find((candidate) => candidate.some((member) => fixturesAlign(member, row)));
    if (cluster) {
      cluster.push(row);
      for (const bucket of bucketsOf(row)) clustersByBucket.set(bucket, [...(clustersByBucket.get(bucket) ?? []), cluster]);
      continue;
    }
    const created = [row];
    clusters.push(created);
    for (const bucket of bucketsOf(row)) clustersByBucket.set(bucket, [...(clustersByBucket.get(bucket) ?? []), created]);
  }
  const groups: DuplicateFixtureGroup[] = [];
  const review: DuplicateFixtureReview[] = [];
  for (const cluster of clusters) {
    if (cluster.length < 2) continue;
    const providers = new Set(cluster.map((member) => member.provider));
    if (providers.size !== cluster.length) {
      review.push({
        rows: cluster,
        reason: `A provider covers this kickoff ${cluster.length - providers.size + 1} times, so no pairing is forced by the names alone.`
      });
      continue;
    }
    // External id breaks ties so a read that shuffles the rows still keeps the
    // same fixture on the board.
    const ordered = [...cluster].sort(
      (left, right) => canonicalRank(right) - canonicalRank(left) || left.externalId.localeCompare(right.externalId)
    );
    const qualifiers = new Set(cluster.map((member) => `${squadQualifiers(member.homeTeamName)}|${squadQualifiers(member.awayTeamName)}`));
    groups.push({ canonical: ordered[0], duplicates: ordered.slice(1), qualifierMatch: qualifiers.size === 1 ? "exact" : "uniform" });
  }
  return { groups, review };
}
