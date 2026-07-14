import { canonicalFootballTeamKey } from "@/lib/sports/prediction/historicalElo";
import type { HistoricalFootballFixtureInput } from "@/lib/sports/training/historicalIngestion";

export type FootballRuntimeFixtureConflict = {
  canonicalKey: string;
  fixtureExternalIds: string[];
  reason: string;
};

export type FootballRuntimeFixtureConsolidation = {
  fixtures: HistoricalFootballFixtureInput[];
  duplicateGroups: number;
  duplicateSourceFixturesCollapsed: number;
  conflicts: FootballRuntimeFixtureConflict[];
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function provider(fixture: HistoricalFootballFixtureInput): string {
  return cleanText(fixture.metadata?.provider).toLowerCase().replaceAll("-", "_");
}

function utcDate(value: string): string | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

function canonicalFixtureKey(fixture: HistoricalFootballFixtureInput): string | null {
  const date = utcDate(fixture.kickoffAt);
  const home = canonicalFootballTeamKey(fixture.homeTeam.name || fixture.homeTeam.externalId);
  const away = canonicalFootballTeamKey(fixture.awayTeam.name || fixture.awayTeam.externalId);
  return date && home && away ? `${date}:${home}:${away}` : null;
}

function sourceScore(fixture: HistoricalFootballFixtureInput): number {
  const source = provider(fixture);
  const providerScore = source === "api_football" ? 1_000 : source === "football_data_csv" ? 700 : 400;
  const kickoff = new Date(fixture.kickoffAt);
  const preciseKickoff = Number.isFinite(kickoff.getTime()) && (kickoff.getUTCHours() !== 0 || kickoff.getUTCMinutes() !== 0) ? 80 : 0;
  const contextScore = Math.min(80, (fixture.availability?.length ?? 0) * 2 + (fixture.lineups?.length ?? 0) * 8);
  const oddsScore = Math.min(40, (fixture.odds?.length ?? 0) * 2);
  const qualityScore = typeof fixture.dataQuality === "number" && Number.isFinite(fixture.dataQuality)
    ? fixture.dataQuality * 20
    : 0;
  return providerScore + preciseKickoff + contextScore + oddsScore + qualityScore;
}

function choosePrimary(group: HistoricalFootballFixtureInput[]): HistoricalFootballFixtureInput {
  return [...group].sort((left, right) =>
    sourceScore(right) - sourceScore(left) || left.externalId.localeCompare(right.externalId)
  )[0]!;
}

function scoreKey(fixture: HistoricalFootballFixtureInput): string | null {
  return typeof fixture.homeScore === "number" && Number.isFinite(fixture.homeScore) &&
    typeof fixture.awayScore === "number" && Number.isFinite(fixture.awayScore)
    ? `${fixture.homeScore}:${fixture.awayScore}`
    : null;
}

function uniqueRecords<T>(items: readonly T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mappedTeamExternalId(
  teamExternalId: string,
  source: HistoricalFootballFixtureInput,
  primary: HistoricalFootballFixtureInput
): string {
  if (teamExternalId === source.homeTeam.externalId) return primary.homeTeam.externalId;
  if (teamExternalId === source.awayTeam.externalId) return primary.awayTeam.externalId;
  return teamExternalId;
}

function mergedFixture(
  canonicalKey: string,
  group: HistoricalFootballFixtureInput[]
): HistoricalFootballFixtureInput {
  const primary = choosePrimary(group);
  const sources = [...group].sort((left, right) => left.externalId.localeCompare(right.externalId));
  const firstFinite = (selector: (fixture: HistoricalFootballFixtureInput) => number | null | undefined) =>
    sources.map(selector).find((value): value is number => typeof value === "number" && Number.isFinite(value)) ?? null;

  return {
    ...primary,
    homeScore: firstFinite((fixture) => fixture.homeScore),
    awayScore: firstFinite((fixture) => fixture.awayScore),
    homeXg: firstFinite((fixture) => fixture.homeXg),
    awayXg: firstFinite((fixture) => fixture.awayXg),
    dataQuality: Math.max(...sources.map((fixture) =>
      typeof fixture.dataQuality === "number" && Number.isFinite(fixture.dataQuality) ? fixture.dataQuality : 0
    )),
    odds: uniqueRecords(sources.flatMap((fixture) => fixture.odds ?? [])),
    availability: uniqueRecords(sources.flatMap((fixture) =>
      (fixture.availability ?? []).map((item) => ({
        ...item,
        teamExternalId: mappedTeamExternalId(item.teamExternalId, fixture, primary)
      }))
    )),
    lineups: uniqueRecords(sources.flatMap((fixture) =>
      (fixture.lineups ?? []).map((item) => ({
        ...item,
        teamExternalId: mappedTeamExternalId(item.teamExternalId, fixture, primary)
      }))
    )),
    metadata: {
      ...(primary.metadata ?? {}),
      runtimeConsolidation: {
        canonicalKey,
        primaryExternalId: primary.externalId,
        sourceFixtureIds: sources.map((fixture) => fixture.externalId),
        sourceProviders: Array.from(new Set(sources.map(provider).filter(Boolean))).sort()
      }
    }
  };
}

/**
 * Collapse provider copies of the same real match before chronology is built.
 * API-Football is preferred as the identity spine so player/team context stays
 * joinable, while odds and timestamped context from duplicate sources survive.
 */
export function consolidateFootballRuntimeFixtures(
  fixtures: readonly HistoricalFootballFixtureInput[]
): FootballRuntimeFixtureConsolidation {
  const groups = new Map<string, HistoricalFootballFixtureInput[]>();
  for (const fixture of fixtures) {
    const canonicalKey = canonicalFixtureKey(fixture) ?? `unresolved:${fixture.externalId}`;
    groups.set(canonicalKey, [...(groups.get(canonicalKey) ?? []), fixture]);
  }

  const consolidated: HistoricalFootballFixtureInput[] = [];
  const conflicts: FootballRuntimeFixtureConflict[] = [];
  let duplicateGroups = 0;
  let duplicateSourceFixturesCollapsed = 0;

  for (const [canonicalKey, group] of groups) {
    if (group.length === 1) {
      consolidated.push(group[0]!);
      continue;
    }

    duplicateGroups += 1;
    const scoreKeys = new Set(group.map(scoreKey).filter((value): value is string => Boolean(value)));
    if (scoreKeys.size > 1) {
      conflicts.push({
        canonicalKey,
        fixtureExternalIds: group.map((fixture) => fixture.externalId).sort(),
        reason: "duplicate provider records disagree on the final score"
      });
      continue;
    }

    duplicateSourceFixturesCollapsed += group.length - 1;
    consolidated.push(mergedFixture(canonicalKey, group));
  }

  return {
    fixtures: consolidated.sort((left, right) =>
      Date.parse(left.kickoffAt) - Date.parse(right.kickoffAt) || left.externalId.localeCompare(right.externalId)
    ),
    duplicateGroups,
    duplicateSourceFixturesCollapsed,
    conflicts
  };
}
