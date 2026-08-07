import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { CanonicalSport } from "@/lib/markets/canonicalMarkets";
import { parseProviderResult } from "@/lib/results/providerResults";
import { decideResultIngestion, requiresResettle } from "@/lib/results/ingestionDecision";
import { toCanonicalResult } from "@/lib/publication/canonicalSettlement";
import type { CanonicalResult } from "@/lib/results/canonicalResult";
import type { ResultObservation } from "@/lib/results/verification";
import { isMissingRelation } from "@/lib/results/migrationState";

/**
 * Populate `op_fixture_results` from what the providers actually sent.
 *
 * Thin on purpose. Every judgement lives in `decideResultIngestion`, which is
 * pure and tested without a database; this function reads, executes what the
 * decision says, and writes. When the two get out of step it should be because
 * the decision changed, not because a branch was added here.
 *
 * Observations come from two places. `op_raw_provider_payloads` holds the
 * payloads as they arrived, which is the real series. `op_fixtures` contributes
 * one more — the provider's latest word — so a fixture with no retained payload
 * still gets a single observation and reaches `manual_review` after the
 * timeout, rather than being invisible.
 */

export type ResultIngestionRun = {
  status: "completed" | "preview" | "unavailable" | "partial" | "not-migrated";
  generatedAt: string;
  totals: {
    fixturesInScope: number;
    inserted: number;
    superseded: number;
    unchanged: number;
    verified: number;
    conflicted: number;
    manualReview: number;
    provisional: number;
    resettleRequired: number;
    failed: number;
  };
  exceptions: Array<{ kind: string; fixtureId: string; detail: Record<string, unknown> }>;
  errors: string[];
};

type FixtureRow = {
  id: string;
  sport: string;
  provider: string;
  external_id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  kickoff_at: string;
  updated_at: string;
};

type PayloadRow = { external_id: string | null; payload: unknown; observed_at: string; provider: string };

const TERMINAL = ["finished", "postponed", "cancelled", "abandoned"];

function emptyTotals(): ResultIngestionRun["totals"] {
  return {
    fixturesInScope: 0,
    inserted: 0,
    superseded: 0,
    unchanged: 0,
    verified: 0,
    conflicted: 0,
    manualReview: 0,
    provisional: 0,
    resettleRequired: 0,
    failed: 0
  };
}

/**
 * The fixture row as an observation.
 *
 * `updated_at` is when ingest last wrote it, which is the closest thing we have
 * to when the provider said so. It is not a second source and must never be
 * treated as one — `sourceId` is the fixture's own provider, so the verifier
 * counts it as the same source it already has.
 */
function fixtureObservation(fixture: FixtureRow): ResultObservation {
  return {
    sourceId: fixture.provider,
    observedAt: fixture.updated_at,
    resultStatus: fixture.status as ResultObservation["resultStatus"],
    regulationHome: fixture.home_score,
    regulationAway: fixture.away_score,
    winner:
      fixture.home_score === null || fixture.away_score === null
        ? "none"
        : fixture.home_score > fixture.away_score
          ? "home"
          : fixture.away_score > fixture.home_score
            ? "away"
            : "draw"
  };
}

function observationFrom(result: CanonicalResult, sourceId: string, observedAt: string): ResultObservation {
  return {
    sourceId,
    observedAt,
    resultStatus: result.resultStatus,
    regulationHome: result.regulationHome,
    regulationAway: result.regulationAway,
    winner: result.winner
  };
}

export async function runResultIngestion({
  limit = 200,
  persist = false,
  now = new Date(),
  client = getSupabaseServerClient()
}: {
  limit?: number;
  persist?: boolean;
  now?: Date;
  client?: SupabaseClient | null;
} = {}): Promise<ResultIngestionRun> {
  const generatedAt = now.toISOString();
  const totals = emptyTotals();
  const exceptions: ResultIngestionRun["exceptions"] = [];
  const errors: string[] = [];

  if (!client) {
    return {
      status: "unavailable",
      generatedAt,
      totals,
      exceptions,
      errors: ["OddsPadi Supabase server storage is not configured."]
    };
  }

  const { data: fixtureData, error: fixtureError } = await client
    .from("op_fixtures")
    .select("id,sport,provider,external_id,status,home_score,away_score,kickoff_at,updated_at")
    .in("status", TERMINAL)
    .lt("kickoff_at", generatedAt)
    .order("kickoff_at", { ascending: false })
    .limit(Math.max(1, Math.min(1000, limit)));
  if (fixtureError) {
    return { status: "unavailable", generatedAt, totals, exceptions, errors: [fixtureError.message] };
  }

  const fixtures = (fixtureData ?? []) as unknown as FixtureRow[];
  totals.fixturesInScope = fixtures.length;
  if (!fixtures.length) {
    return { status: persist ? "completed" : "preview", generatedAt, totals, exceptions, errors };
  }

  const existingById = new Map<string, CanonicalResult>();
  const { data: existingData, error: existingError } = await client
    .from("op_fixture_results")
    .select(
      "id,fixture_id,sport,result_status,regulation_home,regulation_away,extra_time_home,extra_time_away," +
        "shootout_home,shootout_away,sets_home,sets_away,games_home,games_away,period_scores,winner," +
        "winner_basis,final_at,verification_state,revision"
    )
    .eq("is_current", true)
    .in(
      "fixture_id",
      fixtures.map((fixture) => fixture.id)
    );
  if (existingError) {
    // Shipping ahead of the migration must not 503 the results-refresh cron and
    // take the fixture refresh, expiry and lifecycle reconciliation down with
    // it. A real read failure still does.
    if (isMissingRelation(existingError, "op_fixture_results")) {
      return {
        status: "not-migrated",
        generatedAt,
        totals,
        exceptions,
        errors: [`op_fixture_results is not present yet: ${existingError.message}. Apply the migration.`]
      };
    }
    return { status: "unavailable", generatedAt, totals, exceptions, errors: [existingError.message] };
  }
  for (const row of (existingData ?? []) as unknown as Parameters<typeof toCanonicalResult>[0][]) {
    existingById.set(row.fixture_id, toCanonicalResult(row));
  }

  const { data: payloadData, error: payloadError } = await client
    .from("op_raw_provider_payloads")
    .select("external_id,payload,observed_at,provider")
    .in(
      "external_id",
      fixtures.map((fixture) => fixture.external_id)
    )
    .order("observed_at", { ascending: true })
    .limit(2000);
  if (payloadError) {
    // A payload read failing is not a licence to proceed on the fixture row
    // alone: that would silently reduce every fixture to one observation and
    // make the whole batch look like a provider that never confirms anything.
    return { status: "unavailable", generatedAt, totals, exceptions, errors: [payloadError.message] };
  }

  const payloadsByExternalId = new Map<string, PayloadRow[]>();
  for (const row of (payloadData ?? []) as unknown as PayloadRow[]) {
    if (!row.external_id) continue;
    const held = payloadsByExternalId.get(row.external_id) ?? [];
    held.push(row);
    payloadsByExternalId.set(row.external_id, held);
  }

  for (const fixture of fixtures) {
    const sport = fixture.sport as CanonicalSport;
    const observations: ResultObservation[] = [];
    let latestParsed: CanonicalResult | null = null;

    for (const row of payloadsByExternalId.get(fixture.external_id) ?? []) {
      const parsed = parseProviderResult(sport, fixture.id, row.payload);
      if (!parsed) continue;
      observations.push(observationFrom(parsed, row.provider, row.observed_at));
      latestParsed = parsed;
    }

    observations.push(fixtureObservation(fixture));
    // Fall back to the fixture row's own aggregate only when no payload parsed.
    // It carries no extra time, so a market needing one stays ungradeable
    // rather than being graded against a number that is not its basis.
    if (!latestParsed) latestParsed = fixtureShapedResult(fixture, sport);

    const decision = decideResultIngestion({
      sport,
      observations,
      parsed: latestParsed,
      existing: existingById.get(fixture.id) ?? null,
      now
    });

    if (decision.action === "none") {
      totals.unchanged += 1;
      continue;
    }
    if (decision.action === "raise") {
      exceptions.push({ kind: decision.kind, fixtureId: fixture.id, detail: decision.detail });
      continue;
    }

    countState(totals, decision.result.verificationState);
    if (decision.verdict.exception) {
      exceptions.push({
        kind: decision.verdict.exception.kind,
        fixtureId: fixture.id,
        detail: decision.verdict.exception.detail
      });
    }
    if (requiresResettle(decision, existingById.get(fixture.id) ?? null)) {
      totals.resettleRequired += 1;
      exceptions.push({
        kind: "provider_correction",
        fixtureId: fixture.id,
        detail: { correctionReason: decision.action === "supersede" ? decision.correctionReason : null }
      });
    }

    if (!persist) {
      if (decision.action === "insert") totals.inserted += 1;
      else totals.superseded += 1;
      continue;
    }

    const { error } = await client.rpc("op_record_fixture_result", {
      p_fixture_id: fixture.id,
      p_result: serialise(decision.result, fixture, generatedAt),
      p_correction_reason: decision.action === "supersede" ? decision.correctionReason : null
    });
    if (error) {
      totals.failed += 1;
      errors.push(`${fixture.id}: ${error.message}`);
      continue;
    }
    if (decision.action === "insert") totals.inserted += 1;
    else totals.superseded += 1;
  }

  const status = !persist ? "preview" : errors.length ? "partial" : "completed";
  return { status, generatedAt, totals, exceptions, errors };
}

function fixtureShapedResult(fixture: FixtureRow, sport: CanonicalSport): CanonicalResult {
  const observation = fixtureObservation(fixture);
  return {
    fixtureId: fixture.id,
    sport,
    resultStatus: fixture.status === "finished" ? "finished" : (fixture.status as CanonicalResult["resultStatus"]),
    regulationHome: fixture.home_score,
    regulationAway: fixture.away_score,
    extraTimeHome: null,
    extraTimeAway: null,
    shootoutHome: null,
    shootoutAway: null,
    setsHome: null,
    setsAway: null,
    gamesHome: null,
    gamesAway: null,
    periodScores: [],
    winner: observation.winner,
    winnerBasis: fixture.status === "finished" ? "regulation" : null,
    finalAt: fixture.updated_at,
    verificationState: "provisional",
    revision: 1
  };
}

function countState(totals: ResultIngestionRun["totals"], state: CanonicalResult["verificationState"]): void {
  if (state === "verified") totals.verified += 1;
  else if (state === "conflicted") totals.conflicted += 1;
  else if (state === "manual_review") totals.manualReview += 1;
  else totals.provisional += 1;
}

function serialise(result: CanonicalResult, fixture: FixtureRow, generatedAt: string): Record<string, unknown> {
  return {
    sport: result.sport,
    result_status: result.resultStatus,
    regulation_home: result.regulationHome,
    regulation_away: result.regulationAway,
    extra_time_home: result.extraTimeHome,
    extra_time_away: result.extraTimeAway,
    shootout_home: result.shootoutHome,
    shootout_away: result.shootoutAway,
    sets_home: result.setsHome,
    sets_away: result.setsAway,
    games_home: result.gamesHome,
    games_away: result.gamesAway,
    period_scores: result.periodScores,
    winner: result.winner,
    winner_basis: result.winnerBasis,
    final_at: result.finalAt,
    primary_provider: fixture.provider,
    verification_state: result.verificationState,
    verified_at: result.verificationState === "verified" ? generatedAt : null,
    verified_by: result.verificationState === "verified" ? "automatic" : null
  };
}
