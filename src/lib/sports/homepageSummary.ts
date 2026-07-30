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

/**
 * Per-day counts for the homepage's seven-day board.
 *
 * The weekly card raced the full weekly tips product against the same 2.5s
 * budget the daily card used to lose, and lost the same way: on a cold start
 * the product read takes double-digit seconds, so production rendered "Still
 * loading the seven-day board" on essentially every visit. The board needs
 * seven integers, not seven days of materialised fixtures.
 */
export type HomepageWeeklyDaySummary = { date: string; fixtureCount: number };

export async function readHomepageWeeklySummary(now = new Date()): Promise<HomepageWeeklyDaySummary[] | null> {
  const client = getSupabaseServerClient();
  if (!client) return null;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 7);

  // One range read of kickoff timestamps only; grouping happens here. Seven
  // head-count round trips would also work but cost seven serverless hops.
  const { data, error } = await client
    .from("op_fixtures")
    .select("kickoff_at")
    .gte("kickoff_at", start.toISOString())
    .lt("kickoff_at", end.toISOString())
    .limit(20000);
  if (error || !data) return null;

  const counts = new Map<string, number>();
  for (let offset = 0; offset < 7; offset += 1) {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + offset);
    counts.set(day.toISOString().slice(0, 10), 0);
  }
  for (const row of data) {
    const day = String(row.kickoff_at ?? "").slice(0, 10);
    if (counts.has(day)) counts.set(day, (counts.get(day) ?? 0) + 1);
  }
  return [...counts.entries()].map(([date, fixtureCount]) => ({ date, fixtureCount }));
}

/**
 * Yesterday's internal model record.
 *
 * The results card counted published picks only, and until a calibration
 * profile is promoted there are none — so the card showed four zeros above a
 * note that internal runs "do not appear here". Users read four zeros as a
 * broken product. The engine settles thousands of internal decisions; showing
 * that record, clearly labelled as internal, is both honest and alive.
 */
export type HomepageModelRecordSummary = { won: number; lost: number; pending: number };

export async function readHomepageModelRecordSummary(now = new Date()): Promise<HomepageModelRecordSummary | null> {
  const client = getSupabaseServerClient();
  if (!client) return null;
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 1);

  const countOf = async (result?: string): Promise<number | null> => {
    let query = client
      .from("op_prediction_outcomes")
      .select("id", { count: "exact", head: true })
      .gte("settled_at", from.toISOString())
      .lt("settled_at", to.toISOString());
    if (result) query = query.eq("result", result);
    else query = query.eq("result", "pending");
    const { count, error } = await query;
    return error ? null : count ?? 0;
  };

  const [won, lost, pending] = await Promise.all([countOf("won"), countOf("lost"), countOf()]);
  if (won === null || lost === null) return null;
  return { won, lost, pending: pending ?? 0 };
}
