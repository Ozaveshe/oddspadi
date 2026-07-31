import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { finishProviderRun, startProviderRun } from "@/lib/sports/intelligence/repository";
import {
  gradeMarketDecision,
  type MarketDecisionResult,
  type SettleableFixtureResult
} from "@/lib/sports/results/marketDecisionSettlement";

/**
 * The scheduled outcome ledger: the four-step evidence chain that turns
 * finished fixtures into calibration outcomes, end to end.
 *
 *   1. mark closing odds        (op_mark_closing_odds)
 *   2. grade market decisions   (gradeMarketDecision over finished fixtures)
 *   3. backfill outcome rows    (op_backfill_prediction_outcomes)
 *   4. prune superseded quotes  (op_prune_stale_odds)
 *
 * Every one of these existed only as a hand-run ops script, which meant the
 * promotion gates, the engine-page status board, and the homepage model record
 * all froze whenever nobody remembered to run them. This module is the same
 * chain as a single idempotent sweep so a Netlify schedule can advance the
 * ledger without anyone prompting anything.
 *
 * Stages are deliberately independent: a failed stage marks the run partial
 * but never blocks the later stages, because each is separately idempotent and
 * will catch up on the next hourly run.
 */
export type OutcomeLedgerStageName = "closing-odds" | "decision-settlement" | "outcome-backfill" | "odds-prune";

export type OutcomeLedgerStage = {
  stage: OutcomeLedgerStageName;
  status: "completed" | "failed";
  detail: Record<string, unknown>;
  error: string | null;
};

export type OutcomeLedgerReport = {
  status: "completed" | "partial" | "unavailable" | "skipped";
  persist: boolean;
  sinceDays: number;
  note: string | null;
  stages: OutcomeLedgerStage[];
};

type LedgerFixture = {
  id: string;
  sport: string;
  /** Full fixture-status union; the sweep's query narrows to terminal states. */
  status: SettleableFixtureResult["status"];
  home_score: number | null;
  away_score: number | null;
};

const UUID_FLOOR = "00000000-0000-0000-0000-000000000000";
const PAGE_SIZE = 1000;

/**
 * PostgREST caps every response at max-rows (1000 here) regardless of
 * `.limit()`, so anything that can exceed a page must paginate by key. The
 * hand-run script paginated fixtures but not decisions; repeated manual runs
 * hid that. A scheduled sweep has to be right in one pass.
 */
async function pageFinishedFixtures(client: SupabaseClient, sinceIso: string): Promise<LedgerFixture[]> {
  const fixtures: LedgerFixture[] = [];
  let cursor = UUID_FLOOR;
  for (;;) {
    const { data, error } = await client
      .from("op_fixtures")
      .select("id,sport,status,home_score,away_score")
      .in("status", ["finished", "postponed", "cancelled"])
      .gte("kickoff_at", sinceIso)
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (error) throw new Error(`finished-fixture read failed: ${error.message}`);
    fixtures.push(...((data ?? []) as LedgerFixture[]));
    if (!data || data.length < PAGE_SIZE) return fixtures;
    cursor = String(data[data.length - 1]!.id);
  }
}

type SettlementTotals = Record<MarketDecisionResult, number> & { written: number; decisionsSeen: number };

async function settleMarketDecisions(
  client: SupabaseClient,
  sinceIso: string,
  persist: boolean
): Promise<{ totals: SettlementTotals; fixtures: number }> {
  const fixtures = await pageFinishedFixtures(client, sinceIso);
  const totals: SettlementTotals = { won: 0, lost: 0, push: 0, void: 0, needs_review: 0, written: 0, decisionsSeen: 0 };

  // Small fixture chunks and no ORDER BY: an `order by id` keyset over a
  // 200-fixture IN-list pushed the planner onto the primary key and blew the
  // 8s statement timeout in production. Unordered reads use the fixture index
  // and return within the page cap; when a full page comes back, grading
  // writes shrink the pending set, so re-reading the same chunk drains it —
  // convergence by settlement rather than by cursor.
  for (let index = 0; index < fixtures.length; index += 20) {
    const batch = fixtures.slice(index, index + 20);
    const byId = new Map(batch.map((fixture) => [fixture.id, fixture]));
    // Ungradeable rows stay pending-shaped and reappear on drain passes;
    // counting them once keeps the receipt honest.
    const seen = new Set<string>();

    for (;;) {
      const { data: decisions, error } = await client
        .from("op_market_decisions")
        .select("id,fixture_id,market,selection")
        .in("fixture_id", [...byId.keys()])
        .is("superseded_by", null)
        .in("settlement_status", ["pending", "needs_review"])
        .limit(PAGE_SIZE);
      if (error) throw new Error(`pending-decision read failed: ${error.message}`);

      const idsByResult = new Map<MarketDecisionResult, string[]>();
      for (const decision of decisions ?? []) {
        const fixture = byId.get(String(decision.fixture_id));
        if (!fixture || seen.has(String(decision.id))) continue;
        seen.add(String(decision.id));
        totals.decisionsSeen += 1;
        const grade = gradeMarketDecision({
          market: String(decision.market),
          selection: String(decision.selection),
          fixture: { status: fixture.status, homeScore: fixture.home_score, awayScore: fixture.away_score }
        });
        totals[grade.result] += 1;
        // needs_review is already the stored state for ungradeable rows; only a
        // real verdict is worth a write, so a failed grade never overwrites one.
        if (!persist || grade.result === "needs_review") continue;
        idsByResult.set(grade.result, [...(idsByResult.get(grade.result) ?? []), String(decision.id)]);
      }

      let writtenThisPass = 0;
      for (const [result, ids] of idsByResult) {
        for (let offset = 0; offset < ids.length; offset += 200) {
          const chunk = ids.slice(offset, offset + 200);
          const { error: updateError } = await client.from("op_market_decisions").update({ settlement_status: result }).in("id", chunk);
          if (updateError) throw new Error(`settlement write failed: ${updateError.message}`);
          writtenThisPass += chunk.length;
        }
      }
      totals.written += writtenThisPass;

      // Anything below a full page was the whole remaining set. A full page
      // with zero writes cannot converge (dry run, or all rows ungradeable) —
      // stop rather than loop; the counts are already representative.
      if (!decisions || decisions.length < PAGE_SIZE || writtenThisPass === 0) break;
    }
  }
  return { totals, fixtures: fixtures.length };
}

function sumColumn(rows: unknown, column: string): number {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum: number, row) => {
    const value = Number((row as Record<string, unknown>)?.[column]);
    return sum + (Number.isFinite(value) ? value : 0);
  }, 0);
}

export async function runOutcomeLedgerSweep({
  days = 14,
  pruneOlderThanDays = 14,
  persist = false,
  client = getSupabaseServerClient(),
  maxAcquireAttempts = 5,
  retryDelayMs = 30_000
}: {
  days?: number;
  pruneOlderThanDays?: number;
  persist?: boolean;
  client?: SupabaseClient | null;
  maxAcquireAttempts?: number;
  retryDelayMs?: number;
} = {}): Promise<OutcomeLedgerReport> {
  const sinceDays = Math.max(1, Math.min(60, Math.trunc(days)));
  if (!client) {
    return {
      status: "unavailable",
      persist,
      sinceDays,
      note: "OddsPadi Supabase server storage is not configured in this runtime.",
      stages: []
    };
  }

  const sinceIso = new Date(Date.now() - sinceDays * 86_400_000).toISOString();

  // The provider-run lock is global and the pipeline holds it most minutes —
  // decision cycles alone occupy ~4 minutes twice an hour, and the first
  // scheduled ledger tick landed exactly inside one and skipped. No fixed
  // schedule minute survives that, so acquisition retries instead: the gaps
  // between pipeline jobs are one to seven minutes wide, and a few 30-second
  // retries land in one while staying inside the route's execution budget.
  let claim = await startProviderRun({ providerName: "oddspadi-engine", jobType: "outcome-ledger", startedAt: new Date().toISOString(), client });
  for (let attempt = 1; !claim.acquired && attempt < Math.max(1, maxAcquireAttempts); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, retryDelayMs)));
    claim = await startProviderRun({ providerName: "oddspadi-engine", jobType: "outcome-ledger", startedAt: new Date().toISOString(), client });
  }
  if (!claim.acquired) {
    // Still busy after every retry. Every stage is idempotent, so waiting for
    // the next scheduled pass loses nothing.
    return { status: "skipped", persist, sinceDays, note: claim.run.errors.at(-1) ?? "Pipeline is busy.", stages: [] };
  }

  const stages: OutcomeLedgerStage[] = [];
  const errors: string[] = [];

  const rpcStage = async (stage: OutcomeLedgerStageName, fn: string, args: Record<string, unknown>) => {
    const { data, error } = await client.rpc(fn, args);
    if (error) {
      errors.push(`${stage}: ${error.message}`);
      stages.push({ stage, status: "failed", detail: {}, error: error.message });
      return null;
    }
    stages.push({ stage, status: "completed", detail: { rows: data ?? [] }, error: null });
    return data as unknown;
  };

  // Closing marking gets a much narrower window than the rest of the chain:
  // it only concerns fixtures whose kickoff passed since the previous pass,
  // and the 14-day scan over ~1M odds rows blew the API role's 8s statement
  // timeout on the first production tick. Two days re-covers several missed
  // passes; the RPC's own not-exists guard keeps re-marking idempotent.
  const closingSinceIso = new Date(Date.now() - Math.min(sinceDays, 2) * 86_400_000).toISOString();
  const closingRows = await rpcStage("closing-odds", "op_mark_closing_odds", {
    p_since: closingSinceIso,
    p_window_minutes: 90,
    p_commit: persist
  });

  let settledFixtures = 0;
  let settlementTotals: SettlementTotals | null = null;
  try {
    const settlement = await settleMarketDecisions(client, sinceIso, persist);
    settledFixtures = settlement.fixtures;
    settlementTotals = settlement.totals;
    stages.push({ stage: "decision-settlement", status: "completed", detail: { fixtures: settlement.fixtures, ...settlement.totals }, error: null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Decision settlement failed.";
    errors.push(`decision-settlement: ${message}`);
    stages.push({ stage: "decision-settlement", status: "failed", detail: {}, error: message });
  }

  const outcomeRows = await rpcStage("outcome-backfill", "op_backfill_prediction_outcomes", {
    p_since: sinceIso,
    p_commit: persist
  });

  await rpcStage("odds-prune", "op_prune_stale_odds", {
    p_older_than_days: Math.max(1, Math.min(120, Math.trunc(pruneOlderThanDays))),
    p_commit: persist
  });

  const failed = stages.filter((stage) => stage.status === "failed").length;
  const status = failed === 0 ? "completed" : failed === stages.length ? "unavailable" : "partial";
  await finishProviderRun(
    claim.run,
    {
      finishedAt: new Date().toISOString(),
      status: status === "completed" ? "completed" : status === "partial" ? "partial" : "failed",
      fixturesFound: settledFixtures,
      oddsFound: sumColumn(closingRows, "quotes_marked"),
      predictionsGenerated: sumColumn(outcomeRows, "inserted"),
      valuePicksPublished: 0,
      errors
    },
    client,
    { persist, sinceDays, settlement: settlementTotals ?? undefined }
  );

  return { status, persist, sinceDays, note: null, stages };
}
