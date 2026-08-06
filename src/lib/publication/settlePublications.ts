import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { gradeMarketDecision, type SettleableFixtureResult } from "@/lib/sports/results/marketDecisionSettlement";

/**
 * Grade published claims against the finished fixture.
 *
 * `op_settle_publication` has existed since the ledger was built and nothing
 * has ever called it — the only references in the repository were the migration
 * that created it, the migration checker, and two documents. So 230 published
 * picks sat at `unsettled` with no path to a verdict, and the public track
 * record could never show a single result. That is the same defect the ledger
 * itself had: the function existed, the caller did not.
 *
 * A publication is graded once its fixture reaches a terminal state. Anything
 * the grader cannot resolve from a final score is left `unsettled` rather than
 * guessed — an incorrect verdict in an append-only ledger is far worse than a
 * late one, because the correction is permanent and public.
 */
export type PublicationSettlementRun = {
  status: "completed" | "preview" | "unavailable" | "partial";
  generatedAt: string;
  totals: {
    candidates: number;
    settled: number;
    won: number;
    lost: number;
    push: number;
    void: number;
    awaitingResult: number;
    needsReview: number;
    failed: number;
  };
  errors: string[];
};

type PublicationRow = {
  id: string;
  fixture_id: string | null;
  fixture_external_id: string;
  market: string;
  selection: string;
  kickoff_at: string;
};

type FixtureRow = {
  id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
};

const TERMINAL_FIXTURE_STATUSES = new Set(["finished", "postponed", "cancelled", "abandoned"]);

function emptyTotals(): PublicationSettlementRun["totals"] {
  return { candidates: 0, settled: 0, won: 0, lost: 0, push: 0, void: 0, awaitingResult: 0, needsReview: 0, failed: 0 };
}

export async function runPublicationSettlement({
  limit = 500,
  persist = false,
  now = new Date(),
  client = getSupabaseServerClient()
}: {
  limit?: number;
  persist?: boolean;
  now?: Date;
  client?: SupabaseClient | null;
} = {}): Promise<PublicationSettlementRun> {
  const generatedAt = now.toISOString();
  const totals = emptyTotals();
  if (!client) {
    return { status: "unavailable", generatedAt, totals, errors: ["OddsPadi Supabase server storage is not configured."] };
  }

  const { data: publications, error: readError } = await client
    .from("op_publications")
    .select("id,fixture_id,fixture_external_id,market,selection,kickoff_at")
    .in("publication_status", ["published", "corrected"])
    .eq("settlement_status", "unsettled")
    .lt("kickoff_at", generatedAt)
    .order("kickoff_at", { ascending: true })
    .limit(Math.max(1, Math.min(1000, limit)));
  if (readError) {
    return { status: "unavailable", generatedAt, totals, errors: [readError.message] };
  }

  const rows = (publications ?? []) as PublicationRow[];
  totals.candidates = rows.length;
  if (!rows.length) return { status: persist ? "completed" : "preview", generatedAt, totals, errors: [] };

  const fixtureIds = [...new Set(rows.map((row) => row.fixture_id).filter((value): value is string => Boolean(value)))];
  const fixtures = new Map<string, FixtureRow>();
  for (let index = 0; index < fixtureIds.length; index += 200) {
    const { data, error } = await client
      .from("op_fixtures")
      .select("id,status,home_score,away_score")
      .in("id", fixtureIds.slice(index, index + 200));
    if (error) return { status: "unavailable", generatedAt, totals, errors: [error.message] };
    for (const fixture of (data ?? []) as FixtureRow[]) fixtures.set(fixture.id, fixture);
  }

  const errors: string[] = [];
  for (const row of rows) {
    const fixture = row.fixture_id ? fixtures.get(row.fixture_id) : undefined;
    if (!fixture || !TERMINAL_FIXTURE_STATUSES.has(fixture.status)) {
      totals.awaitingResult += 1;
      continue;
    }

    const grade = gradeMarketDecision({
      market: row.market,
      selection: row.selection,
      fixture: {
        status: fixture.status as SettleableFixtureResult["status"],
        homeScore: fixture.home_score,
        awayScore: fixture.away_score
      }
    });
    if (grade.result === "needs_review") {
      // Left unsettled on purpose. A guessed verdict in an append-only public
      // ledger cannot be quietly withdrawn.
      totals.needsReview += 1;
      continue;
    }

    totals[grade.result] += 1;
    if (!persist) {
      totals.settled += 1;
      continue;
    }

    const { error } = await client.rpc("op_settle_publication", {
      p_publication_id: row.id,
      p_status: grade.result,
      p_resolution_basis: {
        reason: grade.reason,
        fixtureStatus: fixture.status,
        finalScore: fixture.status === "finished" ? { home: fixture.home_score, away: fixture.away_score } : null,
        settledBy: "publication-settlement-job",
        settledAt: generatedAt
      }
    });
    if (error) {
      totals.failed += 1;
      totals[grade.result] -= 1;
      errors.push(`${row.id}: ${error.message}`);
    } else {
      totals.settled += 1;
    }
  }

  const status = !persist ? "preview" : errors.length ? "partial" : "completed";
  return { status, generatedAt, totals, errors };
}
