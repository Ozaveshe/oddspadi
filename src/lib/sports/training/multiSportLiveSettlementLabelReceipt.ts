import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseRuntimeStatus, getSupabaseServerClient, ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import type { Match } from "@/lib/sports/types";
import type { FootballDataProviderRetestFeatureRow } from "@/lib/sports/training/footballDataProviderRetestBridge";
import type { LiveTrainingSport } from "@/lib/sports/training/multiSportLiveFeatureMaterializer";
import { trainingModelKey } from "@/lib/sports/training/trainingRepository";

type EnvLike = Record<string, string | undefined>;
type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Outcome = "home" | "draw" | "away";

const TABLE = "op_training_feature_snapshots";

export type MultiSportLiveSettlementStatus =
  | "labels-ready"
  | "labels-stored"
  | "partial-labels"
  | "waiting-final-score"
  | "waiting-supabase"
  | "waiting-admin"
  | "no-live-rows"
  | "failed";

export type MultiSportLiveSettlementDraft = {
  rowId: string;
  fixtureExternalId: string;
  matchLabel: string;
  kickoffAt: string | null;
  status: "ready" | "waiting-final-score" | "unsupported";
  actualOutcome: Outcome | null;
  finalScore: { home: number; away: number } | null;
  providerStatus: Match["status"] | null;
  matchedProviderFixtureId: string | null;
  reason: string;
  canUpdateRow: boolean;
};

export type MultiSportLiveSettlementLabelReceipt = {
  mode: "multi-sport-live-settlement-label-receipt";
  generatedAt: string;
  status: MultiSportLiveSettlementStatus;
  receiptHash: string;
  summary: string;
  request: {
    sport: LiveTrainingSport;
    runRequested: boolean;
    adminAuthorized: boolean;
    limit: number;
  };
  target: {
    projectRef: string | null;
    expectedProjectRef: string;
    table: typeof TABLE;
    modelKey: string;
    split: "live";
    serverWriteReady: boolean;
    targetMatchesExpected: boolean;
  };
  totals: {
    rowsRead: number;
    providerDatesChecked: number;
    finalScoresMatched: number;
    labelsDrafted: number;
    rowsUpdated: number;
    waitingFinalScore: number;
    unsupportedRows: number;
  };
  drafts: MultiSportLiveSettlementDraft[];
  storage: { updated: boolean; updatedIds: string[]; error: string | null };
  controls: {
    providerFinalScoreRequired: true;
    canInspectReadOnly: true;
    canDraftOutcomeLabels: boolean;
    canPersistOutcomeLabels: boolean;
    canFeedShadowBacktest: boolean;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
  };
  proofUrls: string[];
  locks: string[];
};

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stableHash(value: unknown): string {
  const serialized = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function normalizedName(value: string): string {
  return value.toLowerCase().replace(/\b(fc|cf|afc|sc|ac|city|united)\b/g, "").replace(/[^a-z0-9]+/g, "");
}

function namesMatch(left: string, right: string): boolean {
  const a = normalizedName(left);
  const b = normalizedName(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function kickoffFromRow(row: FootballDataProviderRetestFeatureRow): string | null {
  return text(record(row.features).kickoffAt) ?? text(row.generated_at);
}

function dataSourceFromRow(row: FootballDataProviderRetestFeatureRow): JsonRecord {
  return record(record(row.features).dataSource);
}

function providerFixtureId(row: FootballDataProviderRetestFeatureRow): string | null {
  const source = dataSourceFromRow(row);
  return text(source.fixtureProviderId) ?? text(source.oddsProviderEventId);
}

function teamNames(row: FootballDataProviderRetestFeatureRow): { home: string; away: string } {
  const features = record(row.features);
  return {
    home: text(record(features.homeTeam).name) ?? "",
    away: text(record(features.awayTeam).name) ?? ""
  };
}

function pendingRow(row: FootballDataProviderRetestFeatureRow, sport: LiveTrainingSport): boolean {
  return (
    row.sport === sport &&
    row.model_key === trainingModelKey(sport) &&
    row.split === "live" &&
    row.label === null &&
    text(record(row.targets).settlementStatus) !== "settled"
  );
}

function providerMatchForRow(row: FootballDataProviderRetestFeatureRow, matches: Match[]): Match | null {
  const providerId = providerFixtureId(row);
  const teams = teamNames(row);
  const kickoffDate = kickoffFromRow(row)?.slice(0, 10) ?? null;
  return (
    matches.find(
      (match) =>
        providerId &&
        (match.id === providerId || match.id.endsWith(`:${providerId}`) || match.dataSource?.fixtureProviderId === providerId)
    ) ??
    matches.find((match) => match.id === row.fixture_external_id) ??
    matches.find(
      (match) =>
        (!kickoffDate || match.kickoffTime.startsWith(kickoffDate)) &&
        namesMatch(teams.home, match.homeTeam.name) &&
        namesMatch(teams.away, match.awayTeam.name)
    ) ??
    null
  );
}

function outcomeFromMatch(match: Match | null): Outcome | null {
  if (match?.status !== "finished" || typeof match.score?.home !== "number" || typeof match.score.away !== "number") return null;
  if (match.score.home > match.score.away) return "home";
  if (match.score.away > match.score.home) return "away";
  return "draw";
}

function draftForRow(row: FootballDataProviderRetestFeatureRow, matches: Match[]): MultiSportLiveSettlementDraft {
  const match = providerMatchForRow(row, matches);
  const outcome = outcomeFromMatch(match);
  const teams = teamNames(row);
  const finalScore =
    match?.score && typeof match.score.home === "number" && typeof match.score.away === "number"
      ? { home: match.score.home, away: match.score.away }
      : null;
  const status = outcome ? "ready" : match ? "waiting-final-score" : "unsupported";
  return {
    rowId: row.id,
    fixtureExternalId: row.fixture_external_id,
    matchLabel: `${teams.home || "Home"} vs ${teams.away || "Away"}`,
    kickoffAt: kickoffFromRow(row),
    status,
    actualOutcome: outcome,
    finalScore,
    providerStatus: match?.status ?? null,
    matchedProviderFixtureId: match?.id ?? null,
    reason: outcome
      ? `Provider final score ${finalScore?.home}-${finalScore?.away} maps to ${outcome}.`
      : match
        ? `Provider fixture is ${match.status}; a final score is not ready.`
        : "No matching provider score event was found.",
    canUpdateRow: Boolean(outcome)
  };
}

async function readRows(client: SupabaseClient, sport: LiveTrainingSport, limit: number) {
  const { data, error } = await client
    .from(TABLE)
    .select("id,fixture_external_id,sport,model_key,generated_at,label,features,targets,split,source,feature_hash,created_at")
    .eq("sport", sport)
    .eq("model_key", trainingModelKey(sport))
    .eq("split", "live")
    .is("label", null)
    .order("generated_at", { ascending: true })
    .limit(limit);
  return { rows: ((data ?? []) as FootballDataProviderRetestFeatureRow[]).filter((row) => pendingRow(row, sport)), error: error?.message ?? null };
}

async function matchesByDate(rows: FootballDataProviderRetestFeatureRow[], sport: LiveTrainingSport, env: EnvLike, fetchImpl?: FetchLike) {
  const dates = Array.from(new Set(rows.map((row) => kickoffFromRow(row)?.slice(0, 10)).filter((date): date is string => Boolean(date)))).slice(0, 4);
  const provider = new ProviderBackedSportsDataProvider({ env, fetchImpl });
  return new Map(await Promise.all(dates.map(async (date) => [date, await provider.getFixtures(date, sport)] as const)));
}

function patchFor(row: FootballDataProviderRetestFeatureRow, draft: MultiSportLiveSettlementDraft, settledAt: string) {
  const features = record(row.features);
  const targets = record(row.targets);
  const nextFeatures = {
    ...features,
    evidence: { ...record(features.evidence), liveAndSettlement: true },
    settlementProof: {
      status: "settled",
      actualOutcome: draft.actualOutcome,
      finalScore: draft.finalScore,
      providerFixtureExternalId: draft.matchedProviderFixtureId,
      settledAt,
      source: "provider-final-score"
    }
  };
  return {
    label: draft.actualOutcome,
    targets: {
      ...targets,
      actualOutcome: draft.actualOutcome,
      settlementStatus: "settled",
      finalScore: draft.finalScore,
      settledAt,
      settlementSource: "provider-final-score",
      providerFixtureExternalId: draft.matchedProviderFixtureId
    },
    features: nextFeatures,
    feature_hash: stableHash(nextFeatures)
  };
}

async function storeLabels(client: SupabaseClient, rows: FootballDataProviderRetestFeatureRow[], drafts: MultiSportLiveSettlementDraft[], settledAt: string) {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const updatedIds: string[] = [];
  for (const draft of drafts.filter((item) => item.canUpdateRow && item.actualOutcome)) {
    const row = rowsById.get(draft.rowId);
    if (!row) continue;
    const { data, error } = await client.from(TABLE).update(patchFor(row, draft, settledAt)).eq("id", row.id).select("id").single();
    if (error) return { updatedIds, error: error.message };
    const id = text(record(data).id);
    if (id) updatedIds.push(id);
  }
  return { updatedIds, error: null as string | null };
}

function statusFor({
  rows,
  drafts,
  runRequested,
  adminAuthorized,
  serverReady,
  updated,
  error
}: {
  rows: number;
  drafts: MultiSportLiveSettlementDraft[];
  runRequested: boolean;
  adminAuthorized: boolean;
  serverReady: boolean;
  updated: number;
  error: string | null;
}): MultiSportLiveSettlementStatus {
  if (error) return "failed";
  if (!serverReady) return "waiting-supabase";
  if (!rows) return "no-live-rows";
  if (runRequested && !adminAuthorized) return "waiting-admin";
  if (updated > 0) return "labels-stored";
  const ready = drafts.filter((draft) => draft.status === "ready").length;
  if (ready === rows) return "labels-ready";
  if (ready > 0 || drafts.some((draft) => draft.status === "unsupported")) return "partial-labels";
  return "waiting-final-score";
}

export async function buildMultiSportLiveSettlementLabelReceipt({
  sport,
  runRequested = false,
  adminAuthorized = false,
  limit = 100,
  env = process.env,
  now = new Date(),
  fetchImpl,
  rowsOverride,
  matchesByDateOverride
}: {
  sport: LiveTrainingSport;
  runRequested?: boolean;
  adminAuthorized?: boolean;
  limit?: number;
  env?: EnvLike;
  now?: Date;
  fetchImpl?: FetchLike;
  rowsOverride?: FootballDataProviderRetestFeatureRow[];
  matchesByDateOverride?: Map<string, Match[]>;
}): Promise<MultiSportLiveSettlementLabelReceipt> {
  const generatedAt = now.toISOString();
  const safeLimit = Math.max(1, Math.min(250, Math.trunc(limit)));
  const runtime = getSupabaseRuntimeStatus(env);
  let rows: FootballDataProviderRetestFeatureRow[] = [];
  let error: string | null = null;
  const client = runtime.serverWriteReady ? getSupabaseServerClient(env) : null;
  if (rowsOverride) rows = rowsOverride.filter((row) => pendingRow(row, sport)).slice(0, safeLimit);
  else if (client) ({ rows, error } = await readRows(client, sport, safeLimit));

  const matchMap = matchesByDateOverride ?? (rows.length ? await matchesByDate(rows, sport, env, fetchImpl) : new Map<string, Match[]>());
  const drafts = rows.map((row) => draftForRow(row, matchMap.get(kickoffFromRow(row)?.slice(0, 10) ?? "") ?? []));
  let updatedIds: string[] = [];
  if (runRequested && adminAuthorized && client && drafts.some((draft) => draft.canUpdateRow)) {
    const stored = await storeLabels(client, rows, drafts, generatedAt);
    updatedIds = stored.updatedIds;
    error = error ?? stored.error;
  }
  const serverReady = runtime.serverWriteReady || Boolean(rowsOverride);
  const status = statusFor({ rows: rows.length, drafts, runRequested, adminAuthorized, serverReady, updated: updatedIds.length, error });
  const totals = {
    rowsRead: rows.length,
    providerDatesChecked: matchMap.size,
    finalScoresMatched: drafts.filter((draft) => draft.finalScore).length,
    labelsDrafted: drafts.filter((draft) => draft.status === "ready").length,
    rowsUpdated: updatedIds.length,
    waitingFinalScore: drafts.filter((draft) => draft.status === "waiting-final-score").length,
    unsupportedRows: drafts.filter((draft) => draft.status === "unsupported").length
  };
  const summary =
    status === "labels-stored"
      ? `Stored ${totals.rowsUpdated} provider-final ${sport} feature label(s); model learning remains shadow-only.`
      : status === "labels-ready"
        ? `${totals.labelsDrafted} ${sport} feature label(s) are ready for authenticated storage.`
        : status === "partial-labels"
          ? `${totals.labelsDrafted}/${totals.rowsRead} ${sport} rows have final-score labels; unresolved rows remain pending.`
          : status === "waiting-final-score"
            ? `${totals.rowsRead} ${sport} row(s) are waiting for provider final scores.`
            : status === "no-live-rows"
              ? `No pending ${sport} live feature rows need labels.`
              : status === "waiting-supabase"
                ? "Settlement labeling is waiting for OddsPadi Supabase server readiness."
                : status === "waiting-admin"
                  ? "Settlement label writes require admin authorization."
                  : error ?? "Multi-sport settlement labeling failed.";

  return {
    mode: "multi-sport-live-settlement-label-receipt",
    generatedAt,
    status,
    receiptHash: stableHash({ sport, status, rows: rows.map((row) => [row.id, row.feature_hash]), drafts, updatedIds }),
    summary,
    request: { sport, runRequested, adminAuthorized, limit: safeLimit },
    target: {
      projectRef: runtime.projectRef ?? runtime.urlProjectRef,
      expectedProjectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      table: TABLE,
      modelKey: trainingModelKey(sport),
      split: "live",
      serverWriteReady: runtime.serverWriteReady,
      targetMatchesExpected: runtime.targetMatchesExpected
    },
    totals,
    drafts,
    storage: { updated: updatedIds.length > 0, updatedIds, error },
    controls: {
      providerFinalScoreRequired: true,
      canInspectReadOnly: true,
      canDraftOutcomeLabels: totals.labelsDrafted > 0,
      canPersistOutcomeLabels: Boolean(runRequested && adminAuthorized && runtime.serverWriteReady && totals.labelsDrafted > 0 && !error),
      canFeedShadowBacktest: updatedIds.length > 0,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: [
      "/api/sports/decision/training/multi-sport-live-settlement-label-receipt",
      "/api/sports/decision/autonomous-settlement",
      "/api/sports/decision/calibration"
    ],
    locks: [
      "Only provider event identity plus a completed final score can settle a feature row.",
      "AI text, odds movement, and incomplete scores cannot create labels.",
      "Settled rows may feed shadow backtests but cannot train, promote weights, publish picks, or stake automatically."
    ]
  };
}
