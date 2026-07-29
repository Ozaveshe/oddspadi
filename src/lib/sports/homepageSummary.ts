import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Counts-only read for the homepage's matchday card.
 *
 * The homepage previously derived those numbers from
 * `getDailyTipsProduct({ ensure: false })`, which reads the whole stored slate
 * and builds every tips section for ~700 fixtures. That measures ~14s on a cold
 * serverless start against a 2.5s render budget, so in production the read
 * failed on essentially every load and the card fell back to a live-score
 * board — the engine's fixtures never reached the homepage at all.
 *
 * The card needs five integers and a timestamp. Head-count queries return those
 * without materialising a single fixture row.
 */
export type HomepageMatchdaySummary = {
  fixtureCount: number;
  analysedCount: number;
  valuePickCount: number;
  watchlistCount: number;
  lastRunAt: string | null;
};

function dayBounds(now: Date): { from: string; to: string } {
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = new Date(from);
  to.setUTCDate(to.getUTCDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export async function readHomepageMatchdaySummary(now = new Date()): Promise<HomepageMatchdaySummary | null> {
  const client = getSupabaseServerClient();
  if (!client) return null;
  const { from, to } = dayBounds(now);

  const countOf = async (build: () => PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> => {
    const { count, error } = await build();
    return error ? null : count ?? 0;
  };

  const decisionsFor = (status?: string) => () => {
    let query = client
      .from("op_fixture_decision_summaries")
      .select("id", { count: "exact", head: true })
      .is("superseded_by", null)
      .gte("generated_at", from)
      .lt("generated_at", to);
    if (status) query = query.eq("public_status", status);
    return query;
  };

  const [fixtureCount, analysedCount, valuePickCount, watchlistCount, lastRun] = await Promise.all([
    countOf(() => client
      .from("op_fixtures")
      .select("id", { count: "exact", head: true })
      .gte("kickoff_at", from)
      .lt("kickoff_at", to)),
    countOf(decisionsFor()),
    countOf(decisionsFor("value_pick")),
    countOf(decisionsFor("watchlist")),
    (async () => {
      const { data, error } = await client
        .from("op_decision_runs")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return error ? null : ((data?.created_at as string | null) ?? null);
    })()
  ]);

  // A failed count is not a zero. If the fixture count itself could not be
  // read there is nothing trustworthy to show, so report nothing and let the
  // caller keep its pending state.
  if (fixtureCount === null) return null;

  return {
    fixtureCount,
    analysedCount: analysedCount ?? 0,
    valuePickCount: valuePickCount ?? 0,
    watchlistCount: watchlistCount ?? 0,
    lastRunAt: lastRun
  };
}
