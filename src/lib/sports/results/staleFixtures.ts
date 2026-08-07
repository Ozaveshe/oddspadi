import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * A fixture whose kickoff has passed by more than its sport plausibly takes,
 * with no provider update since.
 *
 * The obvious rule — clear yesterday's board at midnight — is the wrong one. A
 * match starting at 23:00 is still being played at 00:30, and a best-of-five
 * tennis match starting at 22:00 can run past 02:00. A calendar cutoff would
 * write off matches that are still on. So the window is measured from kickoff,
 * per sport, and the clock the sweep happens to run on does not matter.
 *
 * The windows live in `op_expire_stale_fixtures`; this is the typed caller.
 *
 * "Expiry" is the historical name and it overstates what happens. The sweep
 * quarantines: it records `lifecycle_state = 'unresolved'` — our reading, in
 * our column — and leaves `op_fixtures.status` saying whatever the provider
 * last said. It used to write `status = 'abandoned'`, which read as a claim the
 * match had been called off and settled 50 published picks void on matches that
 * were played.
 */
export type StaleFixtureExpiry = {
  status: "completed" | "preview" | "unavailable" | "partial";
  committed: boolean;
  generatedAt: string;
  total: number;
  bySport: { sport: string; quarantined: number; oldestHours: number }[];
  errors: string[];
};

type ExpiryRow = { sport: string; quarantined: number; oldest_hours: number | string };

export async function expireStaleFixtures({
  commit = false,
  now = new Date(),
  client = getSupabaseServerClient()
}: {
  commit?: boolean;
  now?: Date;
  client?: SupabaseClient | null;
} = {}): Promise<StaleFixtureExpiry> {
  const generatedAt = now.toISOString();
  const empty = { committed: commit, generatedAt, total: 0, bySport: [], errors: [] };
  if (!client) {
    return { ...empty, status: "unavailable", errors: ["OddsPadi Supabase server storage is not configured."] };
  }

  const { data, error } = await client.rpc("op_expire_stale_fixtures", { p_commit: commit });
  if (error) {
    return { ...empty, status: "unavailable", errors: [error.message] };
  }

  const rows = (data ?? []) as ExpiryRow[];
  const bySport = rows.map((row) => ({
    sport: String(row.sport),
    quarantined: Number(row.quarantined) || 0,
    oldestHours: Number(row.oldest_hours) || 0
  }));
  return {
    status: commit ? "completed" : "preview",
    committed: commit,
    generatedAt,
    total: bySport.reduce((sum, row) => sum + row.quarantined, 0),
    bySport,
    errors: []
  };
}
