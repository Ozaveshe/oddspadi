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
