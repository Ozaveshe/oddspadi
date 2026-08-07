import type { SupabaseClient } from "@supabase/supabase-js";
import { assessBand, bandFor, type BandEvidence } from "@/lib/accumulator/calibratedBands";

/**
 * The publisher run, as a module rather than a script.
 *
 * `op_publish_pick` had exactly one caller in the repository — the
 * `ops:run-publisher` CLI, invoked by hand. Nothing scheduled it, so
 * the official ledger held 230 rows all stamped 2026-08-03 within 51 seconds of
 * each other: one manual run, then four silent days while the decision engine
 * kept producing ~28k qualifying decisions every twelve hours. A track record
 * cannot accumulate from a job nobody runs.
 *
 * The gate logic lives here so the scheduled worker and the CLI share one
 * implementation. Two copies of a rule that writes to an immutable ledger is
 * how the ledger ends up disagreeing with itself.
 *
 * The thresholds are not redeclared: `assessBand` owns the minimum sample, the
 * maximum calibration gap, and the edge premium a band carries. This module
 * adds only the two rules that are specific to publishing — the plausibility
 * ceiling and one claim per fixture-market.
 */

/**
 * Implausibility ceiling on edge.
 *
 * A model claiming to beat a priced market by more than this is far more likely
 * to be broken, or reading a stale or mismatched odds row, than to have found
 * value. The decision engine already applies 0.15 to uncalibrated runtimes for
 * exactly this reason; a calibrated profile earns a little more room, not
 * unlimited room.
 *
 * The first dry run put four picks above 30% at the top of the queue — a 35.7%
 * edge on a 13.00 shot, meaning the model rated a 7.7% chance at 43%. Publishing
 * that into an immutable ledger because the arithmetic said so would be trusting
 * the model over the market at precisely the point the model is least credible.
 */
export const MAX_PLAUSIBLE_EDGE = 0.2;

export type DecisionRow = {
  fixture_id: string | null;
  fixture_external_id: string | null;
  sport: string;
  market: string;
  selection: string;
  model_probability: number | string | null;
  implied_probability: number | string | null;
  no_vig_probability: number | string | null;
  odds_snapshot_id: string | null;
  engine_version: string | null;
  data_quality: string | null;
  generated_at: string;
};

export type FixtureRow = {
  id: string;
  external_id: string | null;
  league_name: string | null;
  kickoff_at: string;
  status: string;
};

export type ApprovedPromotion = {
  sport: string;
  model_key: string;
  engine_version: string | null;
};

export type SelectedPick = {
  row: DecisionRow;
  fixture: FixtureRow;
  edge: number;
  model: number;
  implied: number;
  fair: number;
  /** True when this exact claim is already live, so the RPC would be a no-op. */
  alreadyLive: boolean;
};

export type CycleEvaluation = {
  /** Decisions considered, before any gate. */
  read: number;
  selected: SelectedPick[];
  /** `selected` trimmed to the blast-radius cap. */
  capped: SelectedPick[];
  /** Rejection reason to count, for the run report. */
  rejections: Record<string, number>;
  distinctFixtures: number;
};

const DATA_QUALITIES = ["complete", "partial", "stale", "unavailable", "confirmed_empty"];

/**
 * Failures that are about the moment, not the query.
 *
 * PostgREST cancels a statement at 8 seconds, and the decision table is being
 * written to by the pipeline for a good part of most minutes — a dry run
 * against the real slate hit `canceling statement due to statement timeout` on
 * one attempt and completed on the next with identical counts. On an hourly
 * schedule that would be a 502 and a skipped hour of publishing, so the read
 * retries rather than surfacing a transient loss as an outage.
 */
const RETRYABLE = /statement timeout|canceling statement|timeout|fetch failed|ECONNRESET|502|503|504/i;

export type QueryResult<T> = { data: T[] | null; error: { message: string } | null };

async function readWithRetry<T>(
  label: string,
  runQuery: () => PromiseLike<QueryResult<T>>,
  waitMs: (ms: number) => Promise<void>
): Promise<T[]> {
  let lastMessage = "unknown error";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // A fresh builder per attempt: a PostgREST query is a thenable that does
    // not re-execute when awaited twice.
    const { data, error } = await runQuery();
    if (!error) return data ?? [];
    lastMessage = error.message;
    if (!RETRYABLE.test(error.message)) break;
    if (attempt < 2) await waitMs(1_000 * (attempt + 1));
  }
  throw new Error(`${label}: ${lastMessage}`);
}

/** Key for the one-live-claim-per-(fixture, market, selection) rule. */
export function claimKey(fixtureId: string, market: string, selection: string): string {
  return `${fixtureId}::${market}::${selection}`;
}

function numeric(value: number | string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Decile calibration bands from settled outcomes.
 *
 * `op_calibration_runs` stores headline metrics but not the per-bucket
 * breakdown, so the buckets are derived here with the same definition the
 * calibration module uses: settled outcomes grouped into deciles, each carrying
 * its count and the gap between mean predicted probability and realised rate.
 */
export function computeBands(outcomes: Array<{ model_probability: number | string | null; result: string }>): BandEvidence[] {
  return Array.from({ length: 10 }, (_, index) => {
    const lowerBound = index / 10;
    const upperBound = (index + 1) / 10;
    const inBand = outcomes.filter((row) => {
      const probability = numeric(row.model_probability);
      return probability !== null && probability >= lowerBound && probability < upperBound;
    });
    if (!inBand.length) return { lowerBound, upperBound, settledSize: 0, calibrationGap: null };
    const wins = inBand.filter((row) => row.result === "won").length;
    const winRate = wins / inBand.length;
    const meanProbability = inBand.reduce((sum, row) => sum + (numeric(row.model_probability) ?? 0), 0) / inBand.length;
    return { lowerBound, upperBound, settledSize: inBand.length, calibrationGap: Math.abs(meanProbability - winRate) };
  });
}

/**
 * Every gate, applied in order, with a counted reason for each refusal.
 *
 * Pure: no database, no clock of its own. A run that publishes 101 of 28,032
 * candidates and cannot say what happened to the other 27,931 is not auditable,
 * so nothing is dropped silently.
 */
export function evaluatePublicationCycle({
  decisions,
  fixtures,
  bandsBySport,
  approvedSports,
  alreadyPublished = new Set<string>(),
  cap,
  now
}: {
  decisions: DecisionRow[];
  fixtures: Map<string, FixtureRow>;
  bandsBySport: Map<string, BandEvidence[]>;
  approvedSports: Set<string>;
  alreadyPublished?: Set<string>;
  cap: number;
  now: Date;
}): CycleEvaluation {
  const rejections: Record<string, number> = {};
  const reject = (reason: string) => {
    rejections[reason] = (rejections[reason] ?? 0) + 1;
  };
  const bestByMarket = new Map<string, SelectedPick>();
  const nowMs = now.getTime();

  for (const row of decisions) {
    if (!approvedSports.has(row.sport)) {
      reject(`no approved calibration promotion for ${row.sport}`);
      continue;
    }
    const fixture = row.fixture_id ? fixtures.get(row.fixture_id) : undefined;
    if (!fixture) {
      reject("fixture row missing");
      continue;
    }
    if (fixture.status !== "scheduled") {
      reject("fixture is not scheduled");
      continue;
    }
    // A pick published after kickoff is not a forecast. The database refuses it
    // too; catching it here keeps the run's report readable.
    if (Date.parse(fixture.kickoff_at) <= nowMs) {
      reject("kickoff has passed");
      continue;
    }

    const model = numeric(row.model_probability);
    const implied = numeric(row.implied_probability);
    const fair = numeric(row.no_vig_probability);
    if (model === null || implied === null || implied <= 0) {
      reject("no usable probability");
      continue;
    }
    if (fair === null) {
      reject("no margin-free price, so edge cannot be separated from the bookmaker's margin");
      continue;
    }

    const bands = bandsBySport.get(row.sport) ?? [];
    const band = bandFor(model, bands);
    if (!band) {
      reject("no calibration band covers this probability");
      continue;
    }
    const verdict = assessBand(band);
    if (!verdict.supported) {
      reject(verdict.reason);
      continue;
    }

    const edge = model - fair;
    if (edge <= verdict.edgePremium) {
      reject("edge does not clear the band premium");
      continue;
    }
    if (edge > MAX_PLAUSIBLE_EDGE) {
      reject(
        `edge ${(edge * 100).toFixed(0)}% exceeds the ${MAX_PLAUSIBLE_EDGE * 100}% plausibility ceiling; treated as a model fault, not value`
      );
      continue;
    }

    const key = `${fixture.id}::${row.market}`;
    const incumbent = bestByMarket.get(key);
    const better =
      !incumbent || edge > incumbent.edge || (edge === incumbent.edge && model > incumbent.model);
    if (better) {
      if (incumbent) reject("superseded by a larger edge in the same market");
      bestByMarket.set(key, {
        row,
        fixture,
        edge,
        model,
        implied,
        fair,
        alreadyLive: alreadyPublished.has(claimKey(fixture.id, row.market, row.selection))
      });
    } else {
      reject("another selection in this market carries a larger edge");
    }
  }

  const selected = [...bestByMarket.values()].sort((a, b) => b.edge - a.edge);
  const capped = selected.slice(0, Math.max(0, cap));
  return {
    read: decisions.length,
    selected,
    capped,
    rejections,
    distinctFixtures: new Set(capped.map((entry) => entry.fixture.id)).size
  };
}

export type CycleResult = CycleEvaluation & {
  /** Set when the run stopped before evaluating anything. */
  haltedReason: string | null;
  committed: boolean;
  published: number;
  /** Claims that were already live, so the idempotent RPC was skipped. */
  reused: number;
  failures: Record<string, number>;
  bandSummary: Record<string, { settledOutcomes: number; publishableBands: number }>;
};

function emptyResult(haltedReason: string): CycleResult {
  return {
    read: 0,
    selected: [],
    capped: [],
    rejections: {},
    distinctFixtures: 0,
    haltedReason,
    committed: false,
    published: 0,
    reused: 0,
    failures: {},
    bandSummary: {}
  };
}

type OutcomeRow = { model_probability: number | string | null; result: string };

async function readAllOutcomes(
  client: SupabaseClient,
  sport: string,
  waitMs: (ms: number) => Promise<void>
): Promise<OutcomeRow[]> {
  const outcomes: OutcomeRow[] = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const page = await readWithRetry<OutcomeRow>(
      `could not read ${sport} outcomes`,
      () =>
        client
          .from("op_prediction_outcomes")
          .select("model_probability,result")
          .eq("sport", sport)
          .in("result", ["won", "lost"])
          .not("model_probability", "is", null)
          .range(offset, offset + 999) as PromiseLike<QueryResult<OutcomeRow>>,
      waitMs
    );
    if (!page.length) break;
    outcomes.push(...page);
    if (page.length < 1000) break;
  }
  return outcomes;
}

/**
 * One publisher pass: read the slate, apply the gates, optionally commit.
 *
 * Safe to run on a schedule. `op_publish_pick` returns the existing row's id
 * when a claim is already live rather than inserting a second one, and this
 * skips the call entirely for claims it can see are live — so a repeated pass
 * over the same slate publishes nothing new instead of churning the ledger.
 */
export async function runPublicationCycle({
  client,
  hours = 12,
  commit = false,
  now = new Date(),
  waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}: {
  client: SupabaseClient;
  hours?: number;
  commit?: boolean;
  now?: Date;
  /** Test hook; production uses real waits between retried reads. */
  waitMs?: (ms: number) => Promise<void>;
}): Promise<CycleResult> {
  const controls = await client.from("op_publication_controls").select("*").maybeSingle();
  if (controls.error) throw new Error(`could not read controls: ${controls.error.message}`);
  if (!controls.data?.publishing_enabled) {
    return emptyResult(
      `publishing is disabled${controls.data?.disabled_reason ? ` — ${controls.data.disabled_reason}` : ""}`
    );
  }
  const cap = Number(controls.data.max_publications_per_run) || 0;

  // Live approvals decide which sports may publish at all.
  const promos = await client
    .from("op_calibration_promotions")
    .select("sport,model_key,engine_version")
    .eq("status", "approved");
  if (promos.error) throw new Error(`could not read promotions: ${promos.error.message}`);
  const approvedBySport = new Map<string, ApprovedPromotion>(
    ((promos.data ?? []) as ApprovedPromotion[]).map((row) => [row.sport, row])
  );
  if (!approvedBySport.size) {
    return emptyResult("no approved calibration promotion exists, so nothing may publish");
  }

  const bandsBySport = new Map<string, BandEvidence[]>();
  const bandSummary: CycleResult["bandSummary"] = {};
  for (const sport of approvedBySport.keys()) {
    const outcomes = await readAllOutcomes(client, sport, waitMs);
    const bands = computeBands(outcomes);
    bandsBySport.set(sport, bands);
    bandSummary[sport] = {
      settledOutcomes: outcomes.length,
      publishableBands: bands.filter((band) => assessBand(band).supported).length
    };
  }

  // Candidates: decisions generated recently, on fixtures that have not started.
  const since = new Date(now.getTime() - hours * 3_600_000).toISOString();
  const decisions: DecisionRow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 80; page += 1) {
    const before = cursor;
    const rows = await readWithRetry<DecisionRow>(
      "could not read decisions",
      () => {
        let query = client
          .from("op_market_decisions")
          .select(
            "fixture_id,fixture_external_id,sport,market,selection,model_probability,implied_probability,no_vig_probability,odds_snapshot_id,engine_version,data_quality,generated_at"
          )
          .gte("generated_at", since)
          .in("sport", [...approvedBySport.keys()])
          .order("generated_at", { ascending: false })
          .limit(1000);
        if (before) query = query.lt("generated_at", before);
        return query as PromiseLike<QueryResult<DecisionRow>>;
      },
      waitMs
    );
    if (!rows.length) break;
    decisions.push(...rows);
    const last = rows[rows.length - 1].generated_at;
    if (last === cursor) break;
    cursor = last;
    if (rows.length < 1000) break;
  }

  const fixtureIds = [...new Set(decisions.map((row) => row.fixture_id).filter((id): id is string => Boolean(id)))];
  const fixtures = new Map<string, FixtureRow>();
  for (let index = 0; index < fixtureIds.length; index += 200) {
    const batch = fixtureIds.slice(index, index + 200);
    const rows = await readWithRetry<FixtureRow>(
      "could not read fixtures",
      () =>
        client
          .from("op_fixtures")
          .select("id,external_id,league_name,kickoff_at,status")
          .in("id", batch) as PromiseLike<QueryResult<FixtureRow>>,
      waitMs
    );
    for (const fixture of rows) fixtures.set(fixture.id, fixture);
  }

  // Claims already live, so a repeated pass skips them instead of re-calling
  // the RPC several hundred times an hour to be told what it already knows.
  const alreadyPublished = new Set<string>();
  type LiveClaim = { fixture_id: string; market: string; selection: string };
  for (let index = 0; index < fixtureIds.length; index += 200) {
    const batch = fixtureIds.slice(index, index + 200);
    const rows = await readWithRetry<LiveClaim>(
      "could not read existing publications",
      () =>
        client
          .from("op_publications")
          .select("fixture_id,market,selection")
          .eq("publication_status", "published")
          .in("fixture_id", batch) as PromiseLike<QueryResult<LiveClaim>>,
      waitMs
    );
    for (const row of rows) alreadyPublished.add(claimKey(row.fixture_id, row.market, row.selection));
  }

  const evaluation = evaluatePublicationCycle({
    decisions,
    fixtures,
    bandsBySport,
    approvedSports: new Set(approvedBySport.keys()),
    alreadyPublished,
    cap,
    now
  });

  const result: CycleResult = {
    ...evaluation,
    haltedReason: null,
    committed: commit,
    published: 0,
    reused: evaluation.capped.filter((entry) => entry.alreadyLive).length,
    failures: {},
    bandSummary
  };
  if (!commit) return result;

  for (const entry of evaluation.capped) {
    if (entry.alreadyLive) continue;
    const promo = approvedBySport.get(entry.row.sport);
    if (!promo) continue;
    const { error } = await client.rpc("op_publish_pick", {
      p_fixture_id: entry.row.fixture_id,
      p_fixture_external_id: entry.row.fixture_external_id ?? entry.fixture.external_id,
      p_sport: entry.row.sport,
      p_competition: entry.fixture.league_name ?? "Unknown",
      p_market: entry.row.market,
      p_selection: entry.row.selection,
      p_selection_label: `${entry.row.market} / ${entry.row.selection}`,
      p_model_version: promo.model_key,
      p_feature_set_version: `${entry.row.sport}-runtime-features-v5`,
      p_calibration_version: promo.model_key,
      p_decision_policy_version: entry.row.engine_version ?? "decision-engine-v2",
      p_model_probability: entry.model,
      p_odds_at_publication: 1 / entry.implied,
      p_implied_probability: entry.implied,
      p_kickoff_at: entry.fixture.kickoff_at,
      p_evidence_cutoff_at: entry.row.generated_at,
      p_odds_snapshot_at: entry.row.generated_at,
      p_odds_snapshot_id: entry.row.odds_snapshot_id,
      p_data_quality: DATA_QUALITIES.includes(entry.row.data_quality ?? "") ? entry.row.data_quality : "partial",
      p_market_line: null
    });
    if (error) {
      result.failures[error.message] = (result.failures[error.message] ?? 0) + 1;
      continue;
    }
    result.published += 1;
  }

  return result;
}
