import type { SearchableEntity } from "@/lib/discovery/search";
import { fixtureRoute } from "@/lib/discovery/liveContinuity";
import { footballLeagueRegistry } from "@/lib/sports/footballLeagues";

/**
 * Building the searchable catalogue.
 *
 * Pure given its rows, so the ranking behaviour is testable without a
 * database; the API route supplies whatever it can read and this degrades to
 * what remains. Competitions come from the registry and are always available —
 * a search that returns nothing because a database read failed should still
 * find the Premier League.
 *
 * Every entity resolves to a destination:
 *   competition → its table page
 *   fixture     → the canonical match route, the same one in every phase
 *   team        → its next upcoming fixture where one exists, else the live
 *                 board it would appear on
 *
 * The team compromise is stated rather than hidden: OddsPadi has no team page,
 * and inventing a route here would 404. When a team page exists this is the
 * one place to change.
 */

export type CatalogueEntity = SearchableEntity & { href: string };

const TIER_PROMINENCE: Record<string, number> = {
  global: 25,
  "top-five": 22,
  continental: 18,
  "africa-primary": 20,
  regional: 8
};

export function competitionEntities(): CatalogueEntity[] {
  return footballLeagueRegistry.map((league) => ({
    kind: "competition" as const,
    id: league.slug,
    name: league.name,
    context: league.country,
    prominence: TIER_PROMINENCE[league.tier] ?? 4,
    href: `/predictions/league/${encodeURIComponent(league.slug)}/table`
  }));
}

export type TeamRow = {
  id: string;
  name: string;
  country: string | null;
  /** The team's next scheduled fixture, where the read could supply one. */
  nextFixtureId: string | null;
};

export function teamEntities(rows: TeamRow[]): CatalogueEntity[] {
  return rows
    .filter((row) => row.name.trim().length > 1)
    .map((row) => ({
      kind: "team" as const,
      id: row.id,
      name: row.name,
      context: row.country,
      prominence: 6,
      href: row.nextFixtureId ? fixtureRoute(row.nextFixtureId) : "/live-scores"
    }));
}

export type FixtureRow = {
  id: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoffAt: string;
};

export function fixtureEntities(rows: FixtureRow[]): CatalogueEntity[] {
  return rows.map((row) => ({
    kind: "fixture" as const,
    id: row.id,
    name: `${row.homeTeam} v ${row.awayTeam}`,
    context: row.league,
    kickoffAt: row.kickoffAt,
    // Findable by either side's name alone, not only the exact pairing.
    aliases: [row.homeTeam, row.awayTeam],
    href: fixtureRoute(row.id)
  }));
}

export function buildCatalogue(teams: TeamRow[], fixtures: FixtureRow[]): CatalogueEntity[] {
  return [...competitionEntities(), ...teamEntities(teams), ...fixtureEntities(fixtures)];
}
