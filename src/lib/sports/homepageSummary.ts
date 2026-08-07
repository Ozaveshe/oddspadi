import { getSupabaseServerClient } from "@/lib/supabase/server";
import { rateWithMinimumSample, type MetricValue } from "@/lib/performance/ledgerMetrics";

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
 *
 * Three defects made this panel read "18 wins, 0 losses, 0 pending, 100%" on a
 * day the engine actually resolved two calls.
 *
 * **`op_prediction_outcomes` stores one row per bookmaker price, not per
 * decision.** The previous head-counts counted rows, so a single call on
 * Ararat-Armenia held at seven quotes counted as seven wins. On 2026-08-06 the
 * eighteen "wins" were three decisions fanned out 7/7/4. Rows are therefore
 * collapsed to one record per (fixture, market, selection) before anything is
 * counted — the engine made one call, and it counts once.
 *
 * **Pending could never be anything but zero.** Every branch of the old count
 * filtered `settled_at` into the window, including the pending branch; a
 * pending row has `settled_at IS NULL` by construction, so the tile was a
 * hardcoded zero. Pending is windowed on the fixture's kickoff instead, which
 * is the only timestamp an ungraded decision has. The two windows answer two
 * questions on purpose: won/lost is what the grader resolved during the day,
 * pending is what yesterday's fixtures still owe it.
 *
 * **Nothing refused to print a rate.** A denominator of two produced a bare
 * "100%" on the credibility page. The rate now goes through the same
 * `MIN_SEGMENT_SAMPLE` gate the publication ledger uses, so a sample too small
 * to mean anything reports that instead of a number.
 *
 * Decisions sitting on a fixture whose lifecycle is `unresolved` — no provider
 * ever returned a result — are excluded from both numerator and denominator and
 * reported as pending. An ungraded decision stays ungraded; it is never
 * counted as a loss, and never quietly dropped so the rate looks better.
 */
export type HomepageModelRecordSummary = {
  won: number;
  lost: number;
  pending: number;
  /** Void and push: settled, but no verdict a rate can use. */
  voided: number;
  /** Null below the sample threshold — never a bare 0% or 100%. */
  hitRate: MetricValue;
};

type OutcomeRow = { fixture_external_id: string; market: string; selection: string; result: string };

/** One record per call the engine made, regardless of how many prices it was quoted at. */
function dedupeDecisions(rows: OutcomeRow[]): OutcomeRow[] {
  const byDecision = new Map<string, OutcomeRow>();
  for (const row of rows) {
    const key = `${row.fixture_external_id}|${row.market}|${row.selection}`;
    if (!byDecision.has(key)) byDecision.set(key, row);
  }
  return [...byDecision.values()];
}

/**
 * Fixtures whose lifecycle says no result ever arrived. Read in chunks because
 * a busy day touches several hundred fixtures and `in.()` travels in the URL.
 */
async function unresolvedFixtureIds(
  client: NonNullable<ReturnType<typeof getSupabaseServerClient>>,
  externalIds: string[]
): Promise<Set<string> | null> {
  const unresolved = new Set<string>();
  for (let index = 0; index < externalIds.length; index += 150) {
    const { data, error } = await client
      .from("op_fixtures")
      .select("external_id,lifecycle_state")
      .in("external_id", externalIds.slice(index, index + 150))
      .eq("lifecycle_state", "unresolved");
    // A lifecycle read we could not make is not proof that everything resolved.
    // Fail closed rather than counting decisions we cannot vouch for.
    if (error) return null;
    for (const row of data ?? []) if (typeof row.external_id === "string") unresolved.add(row.external_id);
  }
  return unresolved;
}

export async function readHomepageModelRecordSummary(now = new Date()): Promise<HomepageModelRecordSummary | null> {
  const client = getSupabaseServerClient();
  if (!client) return null;
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 1);
  const columns = "fixture_external_id,market,selection,result";

  const [settledRead, pendingRead] = await Promise.all([
    client
      .from("op_prediction_outcomes")
      .select(columns)
      .gte("settled_at", from.toISOString())
      .lt("settled_at", to.toISOString())
      .limit(5000),
    // Kickoff, not settlement: an ungraded decision has no settled_at at all.
    client
      .from("op_prediction_outcomes")
      .select(columns)
      .eq("result", "pending")
      .gte("metadata->>kickoffTime", from.toISOString().slice(0, 10))
      .lt("metadata->>kickoffTime", to.toISOString().slice(0, 10))
      .limit(5000)
  ]);
  // A failed read is not a zero.
  if (settledRead.error || pendingRead.error) return null;

  const settled = dedupeDecisions((settledRead.data ?? []) as OutcomeRow[]);
  const pendingRows = dedupeDecisions((pendingRead.data ?? []) as OutcomeRow[]);
  const unresolved = await unresolvedFixtureIds(
    client,
    [...new Set([...settled, ...pendingRows].map((row) => row.fixture_external_id))]
  );
  if (unresolved === null) return null;

  let won = 0;
  let lost = 0;
  let voided = 0;
  let pending = pendingRows.length;
  for (const row of settled) {
    // Graded against a fixture no provider ever resolved: back to pending.
    if (unresolved.has(row.fixture_external_id)) {
      pending += 1;
      continue;
    }
    if (row.result === "won") won += 1;
    else if (row.result === "lost") lost += 1;
    else if (row.result === "void" || row.result === "push") voided += 1;
    else pending += 1;
  }

  return { won, lost, pending, voided, hitRate: rateWithMinimumSample(won, won + lost) };
}
