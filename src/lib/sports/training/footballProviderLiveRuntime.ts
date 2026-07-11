import { getSportsProviderRuntimeStatus, ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import type { Match, SportsDataProvider } from "@/lib/sports/types";

type EnvLike = Record<string, string | undefined>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type FootballProviderLiveRuntimeSource = "provider-backed" | "mock-fallback";

export type FootballProviderLiveRuntimeSnapshot = {
  source: FootballProviderLiveRuntimeSource;
  providerLabel: string;
  targetDate: string;
  filters: {
    league: string | null;
    country: string | null;
    query: string | null;
  };
  matches: Match[];
  runtime: ReturnType<typeof getSportsProviderRuntimeStatus>;
  proof: {
    apiFootballConfigured: boolean;
    oddsConfigured: boolean;
    providerBackedFixtures: number;
    mockSeedFixtures: number;
    completeOddsFixtures: number;
    rawPayloadLinkedFixtures: number;
    missing: string[];
  };
};

export type FootballProviderLiveRuntimeRequest = {
  targetDate: string;
  league: string | null;
  country: string | null;
  query: string | null;
};

function hasCompleteMatchWinnerOdds(match: Match): boolean {
  const market = match.oddsMarkets.find((item) => item.id === "match_winner");
  return (["home", "draw", "away"] as const).every((selection) => market?.selections.some((item) => item.id === selection && item.decimalOdds > 1));
}

function providerLabelFor(source: FootballProviderLiveRuntimeSource, matches: Match[]): string {
  if (source === "provider-backed") {
    const fixtureProvider = matches.find((match) => match.dataSource?.fixtureProvider)?.dataSource?.fixtureProvider ?? "api-football";
    const oddsProvider = matches.find((match) => match.dataSource?.oddsProvider)?.dataSource?.oddsProvider ?? "odds-provider-pending";
    return `${fixtureProvider}+${oddsProvider}`;
  }
  return "mock_provider_or_official_seed";
}

function cleanFilter(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

function normalizedLeagueName(value: string | null): string | null {
  const text = cleanFilter(value)?.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (!text) return null;
  if (text === "epl" || text.includes("english premier league")) return "premier league";
  return text.trim();
}

export function footballProviderLiveRuntimeRequestFromUrl(url: URL): FootballProviderLiveRuntimeRequest {
  return {
    targetDate: url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10),
    league: cleanFilter(url.searchParams.get("league")),
    country: cleanFilter(url.searchParams.get("country")),
    query: cleanFilter(url.searchParams.get("query") ?? url.searchParams.get("q"))
  };
}

function matchesFilter(match: Match, filters: { league?: string | null; country?: string | null; query?: string | null }): boolean {
  const league = cleanFilter(filters.league);
  const country = cleanFilter(filters.country);
  const query = cleanFilter(filters.query)?.toLowerCase();
  const targetLeague = normalizedLeagueName(league);
  const matchLeague = normalizedLeagueName(match.league.name);
  const queryMatches =
    !query ||
    match.homeTeam.name.toLowerCase().includes(query) ||
    match.awayTeam.name.toLowerCase().includes(query) ||
    match.league.name.toLowerCase().includes(query);
  return (!targetLeague || matchLeague === targetLeague) && (!country || match.league.country === country) && queryMatches;
}

function proofFor(matches: Match[], runtime: ReturnType<typeof getSportsProviderRuntimeStatus>): FootballProviderLiveRuntimeSnapshot["proof"] {
  const providerBackedFixtures = matches.filter((match) => match.dataSource?.kind === "provider").length;
  const mockSeedFixtures = matches.filter((match) => match.dataSource?.kind !== "provider").length;
  const completeOddsFixtures = matches.filter(hasCompleteMatchWinnerOdds).length;
  const rawPayloadLinkedFixtures = matches.filter((match) => match.dataSource?.kind === "provider").length;
  return {
    apiFootballConfigured: runtime.sportsApiConfigured,
    oddsConfigured: runtime.oddsApiConfigured,
    providerBackedFixtures,
    mockSeedFixtures,
    completeOddsFixtures,
    rawPayloadLinkedFixtures,
    missing: [
      runtime.sportsApiConfigured ? "" : "API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY",
      runtime.oddsApiConfigured ? "" : "THE_ODDS_API_KEY or ODDS_API_KEY",
      providerBackedFixtures ? "" : "provider-backed fixture rows",
      completeOddsFixtures ? "" : "complete match_winner odds",
      rawPayloadLinkedFixtures ? "" : "raw provider payload proof"
    ].filter(Boolean)
  };
}

export async function getFootballProviderLiveRuntimeSnapshot({
  targetDate,
  league,
  country,
  query,
  env = process.env,
  fetchImpl,
  fallback = mockSportsDataProvider
}: {
  targetDate: string;
  league?: string | null;
  country?: string | null;
  query?: string | null;
  env?: EnvLike;
  fetchImpl?: FetchLike;
  fallback?: SportsDataProvider;
}): Promise<FootballProviderLiveRuntimeSnapshot> {
  const runtime = getSportsProviderRuntimeStatus(env);
  const provider = new ProviderBackedSportsDataProvider({ env, fetchImpl, fallback });
  const fetchedMatches = await provider.getFixtures(targetDate, "football");
  const matches = fetchedMatches.filter((match) => matchesFilter(match, { league, country, query }));
  const source: FootballProviderLiveRuntimeSource = matches.some((match) => match.dataSource?.kind === "provider") ? "provider-backed" : "mock-fallback";

  return {
    source,
    providerLabel: providerLabelFor(source, matches),
    targetDate,
    filters: {
      league: cleanFilter(league),
      country: cleanFilter(country),
      query: cleanFilter(query)
    },
    matches,
    runtime,
    proof: proofFor(matches, runtime)
  };
}
