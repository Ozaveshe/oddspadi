import { unstable_cache } from "next/cache";
import { sportsProvider } from "@/lib/sports/service";
import type { LeagueTable } from "@/lib/sports/leagueStandings";

/**
 * Cached provider standings.
 *
 * The table page called `sportsProvider.getFootballLeagueTable` directly, with
 * no cache and `dynamic = "force-dynamic"` — a live third-party round trip on
 * every request, and up to twice per render for featured leagues, which also
 * ask for the previous season. Standings change a few times a week at most.
 */
export const getCachedFootballLeagueTable = unstable_cache(
  async (slug: string, season: string): Promise<LeagueTable | null> => sportsProvider.getFootballLeagueTable(slug, season),
  ["football-league-table-v1"],
  { revalidate: 900 }
);
