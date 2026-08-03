import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Borrow a crest from the same club held under a different provider.
 *
 * Crest coverage by provider, measured 2026-08-03:
 *
 *   api-football          1594 / 1594   100%
 *   api-basketball         393 /  403    98%
 *   api-tennis               0 / 3414     0%
 *   the-odds-api-events      0 /  522     0%
 *   csv / demo importers     0 /  174     0%
 *
 * The enrichment job is not failing. It works wherever a crest exists to
 * fetch. What is missing are providers that ship no imagery — and for those we
 * often already hold the identical club under a provider that does. The Odds
 * API calls it "Legia Warszawa" and so does API-Football.
 *
 * Tennis is untouched and untouchable this way: api-tennis serves individual
 * players, and a player has no club badge. Those keep the initials fallback,
 * which is a correct answer rather than a missing one.
 */
export type TeamCrestFill = {
  status: "completed" | "preview" | "unavailable";
  filled: number;
  bySport: { sport: string; filled: number }[];
  errors: string[];
};

/**
 * Flag fixture rows that duplicate another provider's row for the same match.
 *
 * The Odds API and API-Sports both write a row for the same real match under
 * different names, so the board showed it twice — and only API-Sports has a
 * results endpoint, so the duplicate could never be graded. Measured
 * 2026-08-03: 84 pairs, 47 of which disagreed on status, always the same way.
 *
 * Runs alongside identity enrichment because both are name-matching passes over
 * the same window, and both are safe to repeat.
 */
export type DuplicateFixtureFlagRun = {
  status: "completed" | "preview" | "unavailable";
  flagged: number;
  bySport: { sport: string; flagged: number }[];
  errors: string[];
};

export async function flagDuplicateFixtures({
  commit = true,
  client = getSupabaseServerClient()
}: { commit?: boolean; client?: SupabaseClient | null } = {}): Promise<DuplicateFixtureFlagRun> {
  if (!client) {
    return { status: "unavailable", flagged: 0, bySport: [], errors: ["OddsPadi Supabase server storage is not configured."] };
  }
  const { data, error } = await client.rpc("op_flag_duplicate_fixtures", { p_commit: commit });
  if (error) {
    return { status: "unavailable", flagged: 0, bySport: [], errors: [error.message] };
  }
  const bySport = ((data ?? []) as { sport: string; flagged: number }[]).map((row) => ({
    sport: String(row.sport),
    flagged: Number(row.flagged) || 0
  }));
  return {
    status: commit ? "completed" : "preview",
    flagged: bySport.reduce((sum, row) => sum + row.flagged, 0),
    bySport,
    errors: []
  };
}

export async function fillTeamLogosFromSiblings({
  commit = true,
  client = getSupabaseServerClient()
}: { commit?: boolean; client?: SupabaseClient | null } = {}): Promise<TeamCrestFill> {
  if (!client) {
    return { status: "unavailable", filled: 0, bySport: [], errors: ["OddsPadi Supabase server storage is not configured."] };
  }
  const { data, error } = await client.rpc("op_fill_team_logos_from_siblings", { p_commit: commit });
  if (error) {
    // Reported, not swallowed: a crest fill that fails silently looks exactly
    // like a board where every club already had its badge.
    return { status: "unavailable", filled: 0, bySport: [], errors: [error.message] };
  }
  const bySport = ((data ?? []) as { sport: string; filled: number }[]).map((row) => ({
    sport: String(row.sport),
    filled: Number(row.filled) || 0
  }));
  return {
    status: commit ? "completed" : "preview",
    filled: bySport.reduce((sum, row) => sum + row.filled, 0),
    bySport,
    errors: []
  };
}
