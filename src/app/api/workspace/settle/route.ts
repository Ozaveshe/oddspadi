import { getSupabaseServerClient } from "@/lib/supabase/server";
import { privateJson } from "@/lib/security/privateJson";
import { rejectCrossSiteMutation } from "@/lib/security/mutationOrigin";
import { databaseUnavailable } from "@/lib/security/databaseError";
import { readBoundedJson } from "@/lib/security/boundedJson";
import { toCanonicalResult } from "@/lib/publication/canonicalSettlement";
import { gradePersonalLeg, combinePersonalOutcomes, PERSONAL_RECORD_COPY } from "@/lib/workspace/personalSettlement";
import type { CanonicalResult } from "@/lib/results/canonicalResult";
import type { CanonicalSelection } from "@/lib/workspace/selection";

export const dynamic = "force-dynamic";

/**
 * Personal settlement: grade a user's legs against verified canonical results.
 *
 * The same grader, the same verified-only rule, the same result rows the
 * official ledger settles from — and none of the official tables written.
 * The response says whose record this is (`PERSONAL_RECORD_COPY`) so no
 * surface can present a personal outcome as OddsPadi performance.
 *
 * Results are public facts, so no authentication is required; guests settle
 * their local workspaces through the same route.
 */

const MAX_LEGS = 20;

type SettleLegInput = {
  legId: string;
  fixtureId: string;
  canonicalSelectionKey: string | null;
  userOdds: number;
};

function isSettleLeg(value: unknown): value is SettleLegInput {
  if (!value || typeof value !== "object") return false;
  const leg = value as Partial<SettleLegInput>;
  return (
    typeof leg.legId === "string" &&
    typeof leg.fixtureId === "string" &&
    (typeof leg.canonicalSelectionKey === "string" || leg.canonicalSelectionKey === null) &&
    typeof leg.userOdds === "number" &&
    Number.isFinite(leg.userOdds) &&
    leg.userOdds > 1
  );
}

export async function POST(request: Request) {
  const originError = rejectCrossSiteMutation(request);
  if (originError) return originError;
  const service = getSupabaseServerClient();
  if (!service) return privateJson({ error: "Settlement reads are not configured." }, { status: 503 });

  const parsed = await readBoundedJson<{ legs?: unknown }>(request, 64_000);
  if (!parsed.ok) return parsed.response;
  const legsRaw = Array.isArray(parsed.value.legs) ? parsed.value.legs : null;
  if (!legsRaw || !legsRaw.length) return privateJson({ error: "Send { legs: [...] }." }, { status: 400 });
  if (legsRaw.length > MAX_LEGS) return privateJson({ error: `At most ${MAX_LEGS} legs settle at once.` }, { status: 400 });
  if (!legsRaw.every(isSettleLeg)) {
    return privateJson({ error: "Each leg needs legId, fixtureId, canonicalSelectionKey and userOdds." }, { status: 400 });
  }
  const legs = legsRaw as SettleLegInput[];

  // The workspace stores provider-facing external ids; results are keyed by
  // internal fixture ids. Resolve, then read only verified current results —
  // a provisional or conflicted result settles nothing, for anyone.
  const externalIds = [...new Set(legs.map((leg) => leg.fixtureId))];
  const { data: fixtures, error: fixtureError } = await service
    .from("op_fixtures")
    .select("id,external_id,status,home_score,away_score")
    .in("external_id", externalIds);
  if (fixtureError) return databaseUnavailable("workspace settle fixtures", fixtureError, "Settlement is temporarily unavailable.");

  const internalByExternal = new Map((fixtures ?? []).map((row) => [String(row.external_id), String(row.id)]));
  const fixtureStateByExternal = new Map(
    (fixtures ?? []).map((row) => [
      String(row.external_id),
      {
        status: String(row.status ?? "unknown"),
        homeScore: row.home_score === null || row.home_score === undefined ? null : Number(row.home_score),
        awayScore: row.away_score === null || row.away_score === undefined ? null : Number(row.away_score)
      }
    ])
  );

  const internalIds = [...internalByExternal.values()];
  const resultsByExternal = new Map<string, CanonicalResult>();
  if (internalIds.length) {
    const { data: results, error: resultsError } = await service
      .from("op_fixture_results")
      .select(
        "id,fixture_id,sport,result_status,regulation_home,regulation_away,extra_time_home,extra_time_away," +
          "shootout_home,shootout_away,sets_home,sets_away,games_home,games_away,period_scores,winner," +
          "winner_basis,final_at,verification_state,revision"
      )
      .eq("is_current", true)
      .eq("verification_state", "verified")
      .in("fixture_id", internalIds);
    if (resultsError) return databaseUnavailable("workspace settle results", resultsError, "Settlement is temporarily unavailable.");
    const externalByInternal = new Map([...internalByExternal.entries()].map(([external, internal]) => [internal, external]));
    for (const row of (results ?? []) as unknown as Array<Parameters<typeof toCanonicalResult>[0]>) {
      const external = externalByInternal.get(String(row.fixture_id));
      if (external) resultsByExternal.set(external, toCanonicalResult(row));
    }
  }

  const settlements = legs.map((leg) =>
    gradePersonalLeg(
      // Only the fields the grader reads; the workspace keeps the rest client-side.
      { legId: leg.legId, fixtureId: leg.fixtureId, canonicalSelectionKey: leg.canonicalSelectionKey, userOdds: leg.userOdds } as CanonicalSelection,
      resultsByExternal.get(leg.fixtureId) ?? null
    )
  );

  return privateJson({
    settlements,
    combined: combinePersonalOutcomes(settlements),
    // Live scores travel beside settlement, never inside it: the frozen
    // analysis is not rewritten, the score is today's context.
    fixtureStates: Object.fromEntries(fixtureStateByExternal),
    recordNote: PERSONAL_RECORD_COPY
  });
}
