import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isMissingRelation } from "@/lib/results/migrationState";
import { legacySelectionKey } from "@/lib/markets/legacyKeys";
import type { CanonicalSport } from "@/lib/markets/canonicalMarkets";
import { settle } from "@/lib/settlement/grade";
import { toCanonicalResult } from "@/lib/publication/canonicalSettlement";
import type { CanonicalResult } from "@/lib/results/canonicalResult";

/**
 * Re-grade settled claims under the canonical rules and report what changes.
 *
 * Settlements recorded before the canonical engine were graded from an
 * aggregate final score. Correct for a match that went the regulation distance,
 * wrong for one that did not — a cup tie decided on penalties was settled 1X2
 * against the post-shootout result.
 *
 * Correcting those is not a backfill. It is a change to a public record, so it
 * happens in two steps that cannot be collapsed: a dry run that reports every
 * verdict that would move, and a commit that only runs after somebody has read
 * it. `persist` defaults to false and the CLI requires an explicit flag.
 *
 * Nothing here writes to `op_publications`. A corrected verdict supersedes the
 * settlement; the claim — its odds, its probability, its timestamp — is
 * untouched, because a claim cannot be revised after the fact and remain
 * evidence of anything.
 */

export type VerdictChange = {
  publicationId: string;
  sport: string;
  market: string;
  selection: string;
  kickoffAt: string;
  from: string;
  to: string;
  marketKey: string;
  ruleVersion: string;
  basis: string;
  reason: string;
};

export type ResettleRun = {
  status: "preview" | "committed" | "unavailable" | "partial" | "not-migrated";
  generatedAt: string;
  totals: {
    examined: number;
    unchanged: number;
    changed: number;
    ungradeable: number;
    awaitingResult: number;
    failed: number;
  };
  /** Every distinct transition and how many claims make it. */
  transitions: Record<string, number>;
  changes: VerdictChange[];
  errors: string[];
};

type SettledRow = {
  id: string;
  fixture_id: string | null;
  sport: string;
  market: string;
  selection: string;
  market_line: number | null;
  kickoff_at: string;
  settlement_status: string;
};

export async function runResettle({
  limit = 500,
  persist = false,
  now = new Date(),
  client = getSupabaseServerClient()
}: {
  limit?: number;
  persist?: boolean;
  now?: Date;
  client?: SupabaseClient | null;
} = {}): Promise<ResettleRun> {
  const generatedAt = now.toISOString();
  const totals = { examined: 0, unchanged: 0, changed: 0, ungradeable: 0, awaitingResult: 0, failed: 0 };
  const transitions: Record<string, number> = {};
  const changes: VerdictChange[] = [];
  const errors: string[] = [];

  if (!client) {
    return {
      status: "unavailable",
      generatedAt,
      totals,
      transitions,
      changes,
      errors: ["OddsPadi Supabase server storage is not configured."]
    };
  }

  const { data, error } = await client
    .from("op_publications")
    .select("id,fixture_id,sport,market,selection,market_line,kickoff_at,settlement_status")
    .eq("publication_status", "published")
    .not("settlement_status", "in", "(unsettled,pending_verification)")
    .order("kickoff_at", { ascending: false })
    .limit(Math.max(1, Math.min(2000, limit)));
  if (error) {
    return { status: "unavailable", generatedAt, totals, transitions, changes, errors: [error.message] };
  }

  const rows = (data ?? []) as unknown as SettledRow[];
  totals.examined = rows.length;
  if (!rows.length) {
    return { status: persist ? "committed" : "preview", generatedAt, totals, transitions, changes, errors };
  }

  const fixtureIds = [...new Set(rows.map((row) => row.fixture_id).filter((value): value is string => Boolean(value)))];
  const results = new Map<string, CanonicalResult>();
  for (let index = 0; index < fixtureIds.length; index += 200) {
    const { data: resultData, error: resultError } = await client
      .from("op_fixture_results")
      .select(
        "id,fixture_id,sport,result_status,regulation_home,regulation_away,extra_time_home,extra_time_away," +
          "shootout_home,shootout_away,sets_home,sets_away,games_home,games_away,period_scores,winner," +
          "winner_basis,final_at,verification_state,revision"
      )
      .eq("is_current", true)
      .in("fixture_id", fixtureIds.slice(index, index + 200));
    if (resultError) {
      if (isMissingRelation(resultError, "op_fixture_results")) {
        return {
          status: "not-migrated",
          generatedAt,
          totals,
          transitions,
          changes,
          errors: [`op_fixture_results is not present yet: ${resultError.message}.`]
        };
      }
      return { status: "unavailable", generatedAt, totals, transitions, changes, errors: [resultError.message] };
    }
    for (const row of (resultData ?? []) as unknown as Parameters<typeof toCanonicalResult>[0][]) {
      results.set(row.fixture_id, toCanonicalResult(row));
    }
  }

  for (const row of rows) {
    const result = row.fixture_id ? results.get(row.fixture_id) : undefined;
    // No canonical result, or one we do not yet believe. Either way there is no
    // better verdict to offer, and the existing one stands rather than being
    // revoked in favour of nothing.
    if (!result || result.verificationState !== "verified") {
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
      totals.ungradeable += 1;
      continue;
    }

    const verdict = settle(result, { selectionKey });
    if (verdict.outcome === "needs_review") {
      // The canonical engine declines to grade something already settled. That
      // is a finding for an operator, not a licence to void a public verdict.
      totals.ungradeable += 1;
      continue;
    }

    if (verdict.outcome === row.settlement_status) {
      totals.unchanged += 1;
      continue;
    }

    totals.changed += 1;
    const transition = `${row.settlement_status}→${verdict.outcome}`;
    transitions[transition] = (transitions[transition] ?? 0) + 1;
    changes.push({
      publicationId: row.id,
      sport: row.sport,
      market: row.market,
      selection: row.selection,
      kickoffAt: row.kickoff_at,
      from: row.settlement_status,
      to: verdict.outcome,
      marketKey: verdict.marketKey ?? "",
      ruleVersion: verdict.ruleVersion ?? "",
      basis: verdict.basis ?? "",
      reason: verdict.reason
    });

    if (!persist) continue;

    const { error: writeError } = await client.rpc("op_settle_publication", {
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
        supersedes: row.settlement_status,
        correction:
          `Re-graded under ${verdict.marketKey} ${verdict.ruleVersion}, which settles on ${verdict.basis}. ` +
          `The previous verdict was produced from an aggregate final score.`,
        settledBy: "canonical-resettle",
        settledAt: generatedAt
      }
    });
    if (writeError) {
      totals.failed += 1;
      errors.push(`${row.id}: ${writeError.message}`);
    }
  }

  const status = !persist ? "preview" : errors.length ? "partial" : "committed";
  return { status, generatedAt, totals, transitions, changes, errors };
}
