import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import type { Match, Sport } from "@/lib/sports/types";
import { buildDecisionOutcomeSettlement, type OutcomeSettlementPreview } from "@/lib/sports/prediction/decisionOutcomeSettlement";
import {
  refreshPredictionOutcomeClosingLine,
  storePredictionOutcome,
  type PredictionOutcomeWriteResult
} from "@/lib/sports/prediction/decisionOutcomes";
import { runAndStoreCalibration, type CalibrationRunResult } from "@/lib/sports/prediction/decisionCalibration";

type EnvLike = Record<string, string | undefined>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;
export type AutonomousSettlementSport = Extract<Sport, "football" | "basketball" | "tennis">;

export type AutonomousPendingOutcomeRow = {
  id: string;
  decision_run_id: string | null;
  fixture_external_id: string;
  sport: AutonomousSettlementSport;
  market: string;
  selection: string;
  model_probability: number | null;
  implied_probability: number | null;
  value_edge: number | null;
  odds: number | null;
  closing_odds: number | null;
  result: "pending";
  source: string;
  metadata: JsonRecord;
  created_at: string;
};

export type DecisionAutonomousSettlementStatus =
  | "settled"
  | "ready"
  | "waiting-results"
  | "no-pending"
  | "partial"
  | "waiting-supabase"
  | "blocked"
  | "failed";

export type DecisionAutonomousSettlement = {
  mode: "autonomous-decision-settlement";
  generatedAt: string;
  status: DecisionAutonomousSettlementStatus;
  summary: string;
  request: {
    runRequested: boolean;
    adminAuthorized: boolean;
    limit: number;
    sport: AutonomousSettlementSport;
  };
  totals: {
    pendingRead: number;
    providerDatesChecked: number;
    finalScoresMatched: number;
    readyToSettle: number;
    closingLineCandidates: number;
    closingLinesCaptured: number;
    closingLinesReused: number;
    closingLineFailures: number;
    settled: number;
    reused: number;
    waiting: number;
    unsupported: number;
    failed: number;
  };
  drafts: Array<{
    outcomeId: string;
    decisionRunId: string | null;
    fixtureId: string;
    match: string;
    providerFixtureId: string | null;
    status: "ready" | "waiting" | "unsupported";
    finalScore: { home: number; away: number } | null;
    result: string | null;
    closingOdds: number | null;
    closingOddsSource: "provider-pre-kickoff" | "stored-pre-kickoff" | null;
    secondsBeforeKickoff: number | null;
    closingLinePersistence: PredictionOutcomeWriteResult | null;
    reason: string;
    persistence: PredictionOutcomeWriteResult | null;
  }>;
  calibration: CalibrationRunResult | { status: "skipped"; reason: string };
  controls: {
    providerFinalScoreRequired: true;
    preKickoffClosingOddsOnly: true;
    postKickoffOddsRejected: true;
    deterministicGradingOnly: true;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
  };
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeTeam(value: string): string {
  return value.toLowerCase().replace(/\b(fc|cf|afc|sc|ac|city|united)\b/g, "").replace(/[^a-z0-9]+/g, "");
}

function teamsMatch(left: string, right: string): boolean {
  const a = normalizeTeam(left);
  const b = normalizeTeam(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function kickoffDate(row: AutonomousPendingOutcomeRow): string | null {
  const value = text(record(row.metadata).kickoffTime);
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

function secondsBeforeKickoff(row: AutonomousPendingOutcomeRow, now: Date): number | null {
  const value = text(record(row.metadata).kickoffTime);
  if (!value) return null;
  const kickoff = Date.parse(value);
  if (!Number.isFinite(kickoff)) return null;
  return Math.round((kickoff - now.getTime()) / 1000);
}

function providerFixtureId(row: AutonomousPendingOutcomeRow): string | null {
  return text(record(row.metadata).fixtureProviderId);
}

function providerSportKey(row: AutonomousPendingOutcomeRow): string | null {
  return text(record(row.metadata).providerSportKey);
}

function matchForRow(row: AutonomousPendingOutcomeRow, matches: Match[]): Match | null {
  const metadata = record(row.metadata);
  const providerId = providerFixtureId(row);
  const homeTeam = text(metadata.homeTeam);
  const awayTeam = text(metadata.awayTeam);
  const date = kickoffDate(row);
  const exactFixture = matches.find((match) => match.id === row.fixture_external_id);
  if (exactFixture) return exactFixture;

  const exactProviderFixture = matches.find(
    (match) => providerId && (match.id === providerId || match.id.endsWith(`:${providerId}`) || match.dataSource?.fixtureProviderId === providerId)
  );
  if (exactProviderFixture) return exactProviderFixture;

  const sameDayTeams = matches.filter(
    (match) =>
      (!date || match.kickoffTime.startsWith(date)) &&
      Boolean(homeTeam && awayTeam && teamsMatch(homeTeam, match.homeTeam.name) && teamsMatch(awayTeam, match.awayTeam.name))
  );
  return sameDayTeams.length === 1 ? sameDayTeams[0] : null;
}

function closingOdds(match: Match, market: string, selection: string): number | null {
  return match.oddsMarkets.find((item) => item.id === market)?.selections.find((item) => item.id === selection)?.decimalOdds ?? null;
}

async function readPendingRows(
  client: SupabaseClient,
  limit: number,
  sport: AutonomousSettlementSport
): Promise<{ rows: AutonomousPendingOutcomeRow[]; error: string | null }> {
  const { data, error } = await client
    .from("op_prediction_outcomes")
    .select(
      "id,decision_run_id,fixture_external_id,sport,market,selection,model_probability,implied_probability,value_edge,odds,closing_odds,result,source,metadata,created_at"
    )
    .eq("sport", sport)
    .eq("source", "autonomous-shadow")
    .eq("result", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return { rows: [], error: error.message };
  return { rows: (data ?? []) as AutonomousPendingOutcomeRow[], error: null };
}

async function providerMatchesByDate(
  rows: AutonomousPendingOutcomeRow[],
  sport: AutonomousSettlementSport,
  env: EnvLike,
  fetchImpl?: FetchLike
): Promise<Map<string, Match[]>> {
  const provider = new ProviderBackedSportsDataProvider({ env, fetchImpl });
  const dates = Array.from(new Set(rows.map(kickoffDate).filter((value): value is string => Boolean(value)))).slice(0, 14);
  const entries = await Promise.all(dates.map(async (date) => {
    const exactKeys = rows
      .filter((row) => kickoffDate(row) === date)
      .map(providerSportKey)
      .filter((value): value is string => Boolean(value));
    return [date, await provider.getSettlementFixtures(date, sport, exactKeys)] as const;
  }));
  return new Map(entries);
}

function statusFor({
  runRequested,
  adminAuthorized,
  serverReady,
  rows,
  ready,
  settled,
  failed,
  closingLineFailed
}: {
  runRequested: boolean;
  adminAuthorized: boolean;
  serverReady: boolean;
  rows: number;
  ready: number;
  settled: number;
  failed: number;
  closingLineFailed: number;
}): DecisionAutonomousSettlementStatus {
  if (!serverReady) return "waiting-supabase";
  if (runRequested && !adminAuthorized) return "blocked";
  if (!rows) return "no-pending";
  if (failed && failed === ready) return "failed";
  if (failed || closingLineFailed || (ready > 0 && settled < ready)) return "partial";
  if (settled > 0) return "settled";
  if (ready > 0) return "ready";
  return "waiting-results";
}

function summaryFor(status: DecisionAutonomousSettlementStatus, sport: AutonomousSettlementSport, settled: number, pending: number): string {
  if (status === "settled") return `Settled ${settled} ${sport} autonomous shadow outcome(s) from provider final scores and refreshed calibration.`;
  if (status === "ready") return `${sport} provider final scores are ready for deterministic admin-gated settlement.`;
  if (status === "waiting-results") return `${pending} ${sport} autonomous shadow outcome(s) are waiting for provider final scores.`;
  if (status === "no-pending") return `No pending ${sport} autonomous shadow outcomes need settlement.`;
  if (status === "waiting-supabase") return "Autonomous settlement is waiting for the OddsPadi Supabase server key.";
  if (status === "blocked") return "Autonomous settlement writes require server-side admin authorization.";
  if (status === "partial") return "Some autonomous outcomes settled while other ready rows failed or remained unresolved.";
  return "Autonomous settlement failed before all ready outcomes were stored.";
}

export async function runDecisionAutonomousSettlement({
  runRequested = false,
  adminAuthorized = false,
  limit = 250,
  sport = "football",
  env = process.env,
  now = new Date(),
  fetchImpl,
  rowsOverride,
  matchesByDateOverride,
  storeOutcome = storePredictionOutcome,
  refreshClosingLine = refreshPredictionOutcomeClosingLine,
  runCalibration = runAndStoreCalibration
}: {
  runRequested?: boolean;
  adminAuthorized?: boolean;
  limit?: number;
  sport?: AutonomousSettlementSport;
  env?: EnvLike;
  now?: Date;
  fetchImpl?: FetchLike;
  rowsOverride?: AutonomousPendingOutcomeRow[];
  matchesByDateOverride?: Map<string, Match[]>;
  storeOutcome?: typeof storePredictionOutcome;
  refreshClosingLine?: typeof refreshPredictionOutcomeClosingLine;
  runCalibration?: typeof runAndStoreCalibration;
} = {}): Promise<DecisionAutonomousSettlement> {
  const generatedAt = now.toISOString();
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  const runtime = getSupabaseRuntimeStatus(env);
  let rows: AutonomousPendingOutcomeRow[] = [];
  let readError: string | null = null;

  if (rowsOverride) rows = rowsOverride.slice(0, safeLimit);
  else if (runtime.serverWriteReady) {
    const client = getSupabaseServerClient(env);
    if (!client) readError = "Supabase server client could not be created.";
    else {
      const read = await readPendingRows(client, safeLimit, sport);
      rows = read.rows;
      readError = read.error;
    }
  }

  const matchesByDate =
    matchesByDateOverride ?? (rows.length ? await providerMatchesByDate(rows, sport, env, fetchImpl) : new Map<string, Match[]>());
  const drafts: DecisionAutonomousSettlement["drafts"] = [];

  for (const row of rows) {
    const date = kickoffDate(row);
    const providerMatch = matchForRow(row, date ? matchesByDate.get(date) ?? [] : []);
    const finalScore =
      providerMatch?.status === "finished" && typeof providerMatch.score?.home === "number" && typeof providerMatch.score.away === "number"
        ? { home: providerMatch.score.home, away: providerMatch.score.away }
        : null;
    const secondsToKickoff = secondsBeforeKickoff(row, now);
    const providerClose = providerMatch ? closingOdds(providerMatch, row.market, row.selection) : null;
    const captureEligible = Boolean(
      providerMatch?.status === "scheduled" &&
        providerClose &&
        providerClose > 1 &&
        secondsToKickoff !== null &&
        secondsToKickoff > 0
    );
    const closingLinePersistence =
      runRequested && adminAuthorized && captureEligible && providerClose
        ? await refreshClosingLine({
            outcomeId: row.id,
            closingOdds: providerClose,
            capturedAt: generatedAt,
            metadata: {
              source: "provider-current-pre-kickoff",
              providerFixtureId: providerMatch?.id ?? null,
              oddsProvider: providerMatch?.dataSource?.oddsProvider ?? null,
              oddsProviderEventId: providerMatch?.dataSource?.oddsProviderEventId ?? null,
              market: row.market,
              selection: row.selection,
              secondsBeforeKickoff: secondsToKickoff
            }
          })
        : null;
    const storedClose = typeof row.closing_odds === "number" && row.closing_odds > 1 ? row.closing_odds : null;
    const close = captureEligible ? providerClose : storedClose;
    const closingOddsSource = captureEligible ? "provider-pre-kickoff" : storedClose ? "stored-pre-kickoff" : null;
    const preview: OutcomeSettlementPreview | null = finalScore
      ? buildDecisionOutcomeSettlement(
          {
            decisionRunId: row.decision_run_id,
            fixtureExternalId: row.fixture_external_id,
            sport,
            market: row.market,
            selection: row.selection,
            homeScore: finalScore.home,
            awayScore: finalScore.away,
            modelProbability: row.model_probability,
            impliedProbability: row.implied_probability,
            valueEdge: row.value_edge,
            odds: row.odds,
            closingOdds: close,
            settledAt: generatedAt,
            source: "autonomous-shadow",
            metadata: { ...record(row.metadata), providerFinalScore: finalScore, providerFixtureId: providerMatch?.id ?? null }
          },
          now
        )
      : null;
    const draftStatus = preview?.outcomeInput ? "ready" : providerMatch ? "waiting" : "unsupported";
    const persistence =
      runRequested && adminAuthorized && preview?.outcomeInput ? await storeOutcome(preview.outcomeInput) : null;
    drafts.push({
      outcomeId: row.id,
      decisionRunId: row.decision_run_id,
      fixtureId: row.fixture_external_id,
      match: `${text(record(row.metadata).homeTeam) ?? "Home"} vs ${text(record(row.metadata).awayTeam) ?? "Away"}`,
      providerFixtureId: providerMatch?.id ?? null,
      status: draftStatus,
      finalScore,
      result: preview?.result ?? null,
      closingOdds: close,
      closingOddsSource,
      secondsBeforeKickoff: secondsToKickoff,
      closingLinePersistence,
      reason: preview?.summary ?? (providerMatch ? `Provider fixture is ${providerMatch.status}.` : "No matching provider fixture was found."),
      persistence
    });
  }

  const settled = drafts.filter((draft) => draft.persistence?.status === "stored").length;
  const reused = drafts.filter((draft) => draft.persistence?.status === "reused").length;
  const failed = drafts.filter(
    (draft) => draft.persistence?.status === "failed" || draft.persistence?.status === "not-configured"
  ).length;
  const ready = drafts.filter((draft) => draft.status === "ready").length;
  const closingLineFailed = drafts.filter(
    (draft) => draft.closingLinePersistence?.status === "failed" || draft.closingLinePersistence?.status === "not-configured"
  ).length;
  const serverReady = runtime.serverWriteReady || Boolean(rowsOverride);
  const status = readError
    ? "failed"
    : statusFor({
        runRequested,
        adminAuthorized,
        serverReady,
        rows: rows.length,
        ready,
        settled: settled + reused,
        failed,
        closingLineFailed
      });
  const calibration =
    runRequested && adminAuthorized && settled > 0
      ? await runCalibration(sport)
      : { status: "skipped" as const, reason: "Calibration runs only after at least one newly settled outcome." };

  return {
    mode: "autonomous-decision-settlement",
    generatedAt,
    status,
    summary: readError ?? summaryFor(status, sport, settled + reused, rows.length),
    request: { runRequested, adminAuthorized, limit: safeLimit, sport },
    totals: {
      pendingRead: rows.length,
      providerDatesChecked: matchesByDate.size,
      finalScoresMatched: drafts.filter((draft) => draft.finalScore).length,
      readyToSettle: ready,
      closingLineCandidates: drafts.filter((draft) => draft.closingOddsSource === "provider-pre-kickoff").length,
      closingLinesCaptured: drafts.filter((draft) => draft.closingLinePersistence?.status === "stored").length,
      closingLinesReused: drafts.filter((draft) => draft.closingLinePersistence?.status === "reused").length,
      closingLineFailures: closingLineFailed,
      settled,
      reused,
      waiting: drafts.filter((draft) => draft.status === "waiting").length,
      unsupported: drafts.filter((draft) => draft.status === "unsupported").length,
      failed
    },
    drafts,
    calibration,
    controls: {
      providerFinalScoreRequired: true,
      preKickoffClosingOddsOnly: true,
      postKickoffOddsRejected: true,
      deterministicGradingOnly: true,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false
    }
  };
}
