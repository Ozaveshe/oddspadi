import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { legacySelectionKey } from "@/lib/markets/legacyKeys";
import type { CanonicalSport } from "@/lib/markets/canonicalMarkets";
import { settle, type SettlementOutcome } from "@/lib/settlement/grade";
import type { CanonicalResult } from "@/lib/results/canonicalResult";
import { isMissingRelation } from "@/lib/results/migrationState";

/**
 * Settling published claims through the canonical engine.
 *
 * The existing job grades with `gradeMarketDecision`, which reads an aggregate
 * final score. That is correct for a match that went the regulation distance
 * and wrong for one that did not: a cup tie decided on penalties settles 1X2
 * against the post-shootout result, silently, on a public record.
 *
 * This path grades from `op_fixture_results` instead, so the basis a market
 * declares is the basis it is read at.
 *
 * ## The sequencing requirement, made loud
 *
 * Nothing settles here until canonical results exist. There is deliberately no
 * fallback to the aggregate-score grader, because a fallback would keep the
 * wrong-basis path alive under a name that says it was fixed — and it would do
 * so precisely on the fixtures the fallback handles worst.
 *
 * So a run that finds no canonical results at all reports
 * `canonical-results-missing` rather than quietly settling nothing. An empty
 * result set and an unpopulated table produce the same totals and opposite
 * conclusions, which is the failure mode this codebase keeps rediscovering.
 */

export type CanonicalSettlementRun = {
  status: "completed" | "preview" | "unavailable" | "partial" | "canonical-results-missing";
  generatedAt: string;
  totals: {
    candidates: number;
    settled: number;
    won: number;
    half_won: number;
    push: number;
    half_lost: number;
    lost: number;
    void: number;
    awaitingResult: number;
    needsReview: number;
    unknownMarket: number;
    failed: number;
  };
  /** Raised for an operator rather than guessed past. */
  exceptions: Array<{ kind: string; publicationId: string; detail: Record<string, unknown> }>;
  errors: string[];
};

type PublicationRow = {
  id: string;
  fixture_id: string | null;
  sport: string;
  market: string;
  selection: string;
  market_line: number | null;
  kickoff_at: string;
};

type ResultRow = {
  id: string;
  fixture_id: string;
  sport: string;
  result_status: string;
  regulation_home: number | null;
  regulation_away: number | null;
  extra_time_home: number | null;
  extra_time_away: number | null;
  shootout_home: number | null;
  shootout_away: number | null;
  sets_home: number | null;
  sets_away: number | null;
  games_home: number | null;
  games_away: number | null;
  period_scores: unknown;
  winner: string;
  winner_basis: string | null;
  final_at: string | null;
  verification_state: string;
  revision: number;
};

function emptyTotals(): CanonicalSettlementRun["totals"] {
  return {
    candidates: 0,
    settled: 0,
    won: 0,
    half_won: 0,
    push: 0,
    half_lost: 0,
    lost: 0,
    void: 0,
    awaitingResult: 0,
    needsReview: 0,
    unknownMarket: 0,
    failed: 0
  };
}

export function toCanonicalResult(row: ResultRow): CanonicalResult {
  return {
    resultId: row.id,
    fixtureId: row.fixture_id,
    sport: row.sport as CanonicalSport,
    resultStatus: row.result_status as CanonicalResult["resultStatus"],
    regulationHome: row.regulation_home,
    regulationAway: row.regulation_away,
    extraTimeHome: row.extra_time_home,
    extraTimeAway: row.extra_time_away,
    shootoutHome: row.shootout_home,
    shootoutAway: row.shootout_away,
    setsHome: row.sets_home,
    setsAway: row.sets_away,
    gamesHome: row.games_home,
    gamesAway: row.games_away,
    periodScores: Array.isArray(row.period_scores) ? (row.period_scores as CanonicalResult["periodScores"]) : [],
    winner: row.winner as CanonicalResult["winner"],
    winnerBasis: row.winner_basis as CanonicalResult["winnerBasis"],
    finalAt: row.final_at,
    verificationState: row.verification_state as CanonicalResult["verificationState"],
    revision: row.revision
  };
}

/**
 * Outcomes the ledger accepts. `needs_review` is not one — it settles nothing.
 *
 * A type predicate rather than a `Set.has` check, because the compiler cannot
 * narrow through a Set: without this, `totals[verdict.outcome]` would still
 * include `needs_review`, which has no counter, and the mistake would only
 * surface as an undefined increment at runtime.
 */
type PersistableOutcome = Exclude<SettlementOutcome, "needs_review">;

function isPersistable(outcome: SettlementOutcome): outcome is PersistableOutcome {
  return outcome !== "needs_review";
}

export async function runCanonicalPublicationSettlement({
  limit = 500,
  persist = false,
  now = new Date(),
  client = getSupabaseServerClient()
}: {
  limit?: number;
  persist?: boolean;
  now?: Date;
  client?: SupabaseClient | null;
} = {}): Promise<CanonicalSettlementRun> {
  const generatedAt = now.toISOString();
  const totals = emptyTotals();
  const exceptions: CanonicalSettlementRun["exceptions"] = [];

  if (!client) {
    return {
      status: "unavailable",
      generatedAt,
      totals,
      exceptions,
      errors: ["OddsPadi Supabase server storage is not configured."]
    };
  }

  const { data: publications, error: readError } = await client
    .from("op_publications")
    .select("id,fixture_id,sport,market,selection,market_line,kickoff_at")
    .in("publication_status", ["published", "corrected"])
    .eq("settlement_status", "unsettled")
    .lt("kickoff_at", generatedAt)
    .order("kickoff_at", { ascending: true })
    .limit(Math.max(1, Math.min(1000, limit)));
  if (readError) {
    return { status: "unavailable", generatedAt, totals, exceptions, errors: [readError.message] };
  }

  const rows = (publications ?? []) as PublicationRow[];
  totals.candidates = rows.length;
  if (!rows.length) {
    return { status: persist ? "completed" : "preview", generatedAt, totals, exceptions, errors: [] };
  }

  const fixtureIds = [...new Set(rows.map((row) => row.fixture_id).filter((value): value is string => Boolean(value)))];
  const results = new Map<string, CanonicalResult>();
  for (let index = 0; index < fixtureIds.length; index += 200) {
    const { data, error } = await client
      .from("op_fixture_results")
      .select(
        "id,fixture_id,sport,result_status,regulation_home,regulation_away,extra_time_home,extra_time_away," +
          "shootout_home,shootout_away,sets_home,sets_away,games_home,games_away,period_scores,winner," +
          "winner_basis,final_at,verification_state,revision"
      )
      .eq("is_current", true)
      .in("fixture_id", fixtureIds.slice(index, index + 200));
    if (error) {
      // A table that does not exist yet is a deployment-ordering fact, not a
      // failure of this run. Reporting it as `unavailable` would 503 the whole
      // settle-results cron the moment this code shipped ahead of its
      // migration, taking the legacy pass down with it — a self-inflicted
      // outage in the name of loudness.
      if (isMissingRelation(error, "op_fixture_results")) {
        return {
          status: "canonical-results-missing",
          generatedAt,
          totals: { ...totals, awaitingResult: rows.length },
          exceptions,
          errors: [`op_fixture_results is not present yet: ${error.message}. Apply the migration, then backfill.`]
        };
      }
      return { status: "unavailable", generatedAt, totals, exceptions, errors: [error.message] };
    }
    for (const row of (data ?? []) as unknown as ResultRow[]) results.set(row.fixture_id, toCanonicalResult(row));
  }

  // An unpopulated store and a batch of fixtures that genuinely have no result
  // yet produce identical totals. Saying so is the difference between "nothing
  // to do" and "the backfill has not run".
  if (results.size === 0) {
    return {
      status: "canonical-results-missing",
      generatedAt,
      totals: { ...totals, awaitingResult: rows.length },
      exceptions,
      errors: [
        `No canonical result exists for any of ${fixtureIds.length} fixture(s) with unsettled claims. ` +
          "Settlement deliberately has no fallback to the aggregate-score grader, so it will settle nothing " +
          "until op_fixture_results is populated."
      ]
    };
  }

  const errors: string[] = [];
  for (const row of rows) {
    const result = row.fixture_id ? results.get(row.fixture_id) : undefined;
    if (!result) {
      totals.awaitingResult += 1;
      continue;
    }
    // The ladder decides this, not the score. A conflicted or provisional
    // result is a fixture we are still waiting on.
    if (result.verificationState !== "verified") {
      totals.awaitingResult += 1;
      continue;
    }

    const selectionKey = legacySelectionKey({
      sport: row.sport as CanonicalSport,
      market: row.market,
      selection: row.selection,
      marketLine: row.market_line
    });
    if (!selectionKey) {
      totals.unknownMarket += 1;
      exceptions.push({
        kind: "unknown_market",
        publicationId: row.id,
        detail: { market: row.market, selection: row.selection, marketLine: row.market_line, sport: row.sport }
      });
      continue;
    }

    const verdict = settle(result, { selectionKey });
    if (!isPersistable(verdict.outcome)) {
      // Left unsettled on purpose. A guessed verdict in an append-only public
      // ledger cannot be quietly withdrawn.
      totals.needsReview += 1;
      continue;
    }

    totals[verdict.outcome] += 1;
    if (!persist) {
      totals.settled += 1;
      continue;
    }

    const { error } = await client.rpc("op_settle_publication", {
      p_publication_id: row.id,
      p_status: verdict.outcome,
      p_resolution_basis: {
        reason: verdict.reason,
        marketKey: verdict.marketKey,
        ruleVersion: verdict.ruleVersion,
        settlementBasis: verdict.basis,
        selectionKey,
        resultId: result.resultId,
        resultRevision: result.revision,
        resultStatus: result.resultStatus,
        winnerBasis: result.winnerBasis,
        settledBy: "canonical-publication-settlement",
        settledAt: generatedAt
      }
    });
    if (error) {
      totals.failed += 1;
      totals[verdict.outcome] -= 1;
      errors.push(`${row.id}: ${error.message}`);
    } else {
      totals.settled += 1;
    }
  }

  const status = !persist ? "preview" : errors.length ? "partial" : "completed";
  return { status, generatedAt, totals, exceptions, errors };
}
