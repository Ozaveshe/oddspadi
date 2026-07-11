import { getSupabaseRuntimeStatus, getSupabaseServerClient, ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";
import { EPL_2026_OPENING_WINDOW, type DecisionEpl2026OpeningFixture } from "@/lib/sports/prediction/decisionEpl2026Fixtures";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import type { Match } from "@/lib/sports/types";
import { FOOTBALL_PROVIDER_RETEST_MODEL_KEY, type FootballDataProviderRetestFeatureRow } from "@/lib/sports/training/footballDataProviderRetestBridge";
import type { SupabaseClient } from "@supabase/supabase-js";

type EnvLike = Record<string, string | undefined>;
type JsonRecord = Record<string, unknown>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Outcome = "home" | "draw" | "away";

const FEATURE_SNAPSHOT_TABLE = "op_training_feature_snapshots";
const DEFAULT_OPENING_SOURCE = "epl-2026-opening-live-provider";

export type FootballProviderLiveSettlementLabelStatus =
  | "labels-ready"
  | "labels-stored"
  | "partial-labels"
  | "waiting-final-score"
  | "waiting-supabase"
  | "waiting-admin"
  | "no-live-rows"
  | "failed";

export type FootballProviderLiveSettlementDraft = {
  rowId: string;
  fixtureExternalId: string;
  providerFixtureExternalId: string | null;
  source: string;
  matchLabel: string;
  kickoffAt: string | null;
  status: "ready" | "waiting-final-score" | "unsupported";
  actualOutcome: Outcome | null;
  finalScore: {
    home: number;
    away: number;
  } | null;
  providerStatus: Match["status"] | null;
  matchedProviderFixtureId: string | null;
  reason: string;
  writePreview: {
    label: Outcome | null;
    settlementStatus: "settled" | "pending" | "unsupported";
    canUpdateRow: boolean;
  };
};

export type FootballProviderLiveSettlementLabelReceipt = {
  mode: "football-provider-live-settlement-label-receipt";
  generatedAt: string;
  status: FootballProviderLiveSettlementLabelStatus;
  receiptHash: string;
  summary: string;
  request: {
    runRequested: boolean;
    adminAuthorized: boolean;
    adminTokenConfigured: boolean;
    dryRun: boolean;
    limit: number;
    source: string | null;
    fixtureExternalIds: string[];
  };
  target: {
    projectRef: string | null;
    expectedProjectRef: string;
    table: typeof FEATURE_SNAPSHOT_TABLE;
    modelKey: typeof FOOTBALL_PROVIDER_RETEST_MODEL_KEY;
    split: "live";
    serverWriteReady: boolean;
    targetMatchesExpected: boolean;
  };
  totals: {
    rowsRead: number;
    pendingRows: number;
    providerDatesChecked: number;
    finalScoresMatched: number;
    labelsDrafted: number;
    rowsUpdated: number;
    waitingFinalScore: number;
    unsupportedRows: number;
  };
  drafts: FootballProviderLiveSettlementDraft[];
  storage: {
    updated: boolean;
    updatedIds: string[];
    error: string | null;
  };
  nextAction: {
    label: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canDraftOutcomeLabels: boolean;
    canPersistOutcomeLabels: boolean;
    canFeedProviderRetestRunner: boolean;
    canTrainModels: false;
    canApplyThresholds: false;
    canPublishPicks: false;
    canStake: false;
  };
  locks: string[];
  proofUrls: string[];
};

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function textFrom(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function boolFrom(value: unknown): boolean {
  return value === true || value === "true" || value === 1 || value === "1";
}

function adminTokenConfigured(env: EnvLike): boolean {
  return Boolean(env.ODDSPADI_ADMIN_TOKEN?.trim());
}

function normalizedTeam(value: string): string {
  return value.toLowerCase().replace(/\b(fc|cf|afc|sc|ac|and)\b/g, "").replace(/[^a-z0-9]+/g, "");
}

const TEAM_ALIASES_BY_NORMALIZED_NAME: Record<string, string[]> = {
  brightonhovealbion: ["brighton"],
  coventrycity: ["coventry"],
  hullcity: ["hull"],
  ipswichtown: ["ipswich"],
  leedsunited: ["leeds"],
  manchestercity: ["mancity"],
  manchesterunited: ["manutd", "manunited"],
  newcastleunited: ["newcastle"],
  tottenhamhotspur: ["tottenham", "spurs"]
};

function aliasSet(value: string): Set<string> {
  const normalized = normalizedTeam(value);
  return new Set([normalized, ...(TEAM_ALIASES_BY_NORMALIZED_NAME[normalized] ?? [])].filter(Boolean));
}

function teamsMatch(a: string, b: string): boolean {
  const left = aliasSet(a);
  const right = aliasSet(b);
  return Array.from(left).some((alias) => right.has(alias));
}

function openingFixtureById(id: string): DecisionEpl2026OpeningFixture | null {
  return EPL_2026_OPENING_WINDOW.find((fixture) => fixture.id === id) ?? null;
}

function matchLabelFromRow(row: FootballDataProviderRetestFeatureRow): string {
  const features = record(row.features);
  const homeTeam = record(features.homeTeam);
  const awayTeam = record(features.awayTeam);
  return `${textFrom(homeTeam.name) ?? "Home"} vs ${textFrom(awayTeam.name) ?? "Away"}`;
}

function kickoffFromRow(row: FootballDataProviderRetestFeatureRow): string | null {
  return textFrom(record(row.features).kickoffAt) ?? textFrom(row.generated_at);
}

function providerFixtureExternalId(row: FootballDataProviderRetestFeatureRow): string | null {
  const features = record(row.features);
  return textFrom(features.providerFixtureExternalId) ?? textFrom(features.providerFixtureId) ?? null;
}

function isPendingLiveRow(row: FootballDataProviderRetestFeatureRow): boolean {
  const targets = record(row.targets);
  return row.sport === "football" && row.model_key === FOOTBALL_PROVIDER_RETEST_MODEL_KEY && row.split === "live" && row.label === null && textFrom(targets.settlementStatus) !== "settled";
}

function actualOutcome(match: Match): Outcome | null {
  if (match.status !== "finished" || typeof match.score?.home !== "number" || typeof match.score.away !== "number") return null;
  if (match.score.home > match.score.away) return "home";
  if (match.score.away > match.score.home) return "away";
  return "draw";
}

function matchForRow(row: FootballDataProviderRetestFeatureRow, matches: Match[]): Match | null {
  const providerId = providerFixtureExternalId(row);
  const openingFixture = openingFixtureById(row.fixture_external_id);
  const kickoffAt = kickoffFromRow(row);
  const date = kickoffAt?.slice(0, 10) ?? openingFixture?.date ?? null;
  const features = record(row.features);
  const homeTeam = record(features.homeTeam);
  const awayTeam = record(features.awayTeam);
  const homeName = textFrom(homeTeam.name) ?? openingFixture?.home ?? "";
  const awayName = textFrom(awayTeam.name) ?? openingFixture?.away ?? "";

  return (
    matches.find((match) => providerId && match.id === providerId) ??
    matches.find((match) => match.id === row.fixture_external_id) ??
    matches.find(
      (match) =>
        (!date || match.kickoffTime.startsWith(date)) &&
        openingFixture !== null &&
        teamsMatch(openingFixture.home, match.homeTeam.name) &&
        teamsMatch(openingFixture.away, match.awayTeam.name)
    ) ??
    matches.find((match) => (!date || match.kickoffTime.startsWith(date)) && homeName && awayName && teamsMatch(homeName, match.homeTeam.name) && teamsMatch(awayName, match.awayTeam.name)) ??
    null
  );
}

function datesFromRows(rows: FootballDataProviderRetestFeatureRow[]): string[] {
  return Array.from(
    new Set(
      rows
        .map((row) => kickoffFromRow(row)?.slice(0, 10) ?? openingFixtureById(row.fixture_external_id)?.date ?? "")
        .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    )
  ).sort();
}

async function providerMatchesByDate({
  rows,
  env,
  fetchImpl
}: {
  rows: FootballDataProviderRetestFeatureRow[];
  env: EnvLike;
  fetchImpl?: FetchLike;
}): Promise<Map<string, Match[]>> {
  const provider = new ProviderBackedSportsDataProvider({ env, fetchImpl });
  const entries = await Promise.all(
    datesFromRows(rows).map(async (date) => {
      const matches = await provider.getFixtures(date, "football");
      return [date, matches] as const;
    })
  );
  return new Map(entries);
}

function draftForRow(row: FootballDataProviderRetestFeatureRow, matchesByDate: Map<string, Match[]>): FootballProviderLiveSettlementDraft {
  const kickoffAt = kickoffFromRow(row);
  const date = kickoffAt?.slice(0, 10) ?? openingFixtureById(row.fixture_external_id)?.date ?? "";
  const providerMatch = matchForRow(row, matchesByDate.get(date) ?? []);
  const outcome = providerMatch ? actualOutcome(providerMatch) : null;
  const finalScore =
    providerMatch?.score && typeof providerMatch.score.home === "number" && typeof providerMatch.score.away === "number"
      ? { home: providerMatch.score.home, away: providerMatch.score.away }
      : null;
  const status = outcome ? "ready" : providerMatch ? "waiting-final-score" : "unsupported";

  return {
    rowId: row.id,
    fixtureExternalId: row.fixture_external_id,
    providerFixtureExternalId: providerFixtureExternalId(row),
    source: row.source,
    matchLabel: matchLabelFromRow(row),
    kickoffAt,
    status,
    actualOutcome: outcome,
    finalScore,
    providerStatus: providerMatch?.status ?? null,
    matchedProviderFixtureId: providerMatch?.id ?? null,
    reason: outcome
      ? `Provider final score ${finalScore?.home}-${finalScore?.away} maps to ${outcome}.`
      : providerMatch
        ? `Provider fixture ${providerMatch.id} is ${providerMatch.status}; final score is not ready.`
        : "No matching provider fixture was found for this stored live row.",
    writePreview: {
      label: outcome,
      settlementStatus: outcome ? "settled" : status === "unsupported" ? "unsupported" : "pending",
      canUpdateRow: Boolean(outcome)
    }
  };
}

function settledRowPatch(row: FootballDataProviderRetestFeatureRow, draft: FootballProviderLiveSettlementDraft, settledAt: string): Partial<FootballDataProviderRetestFeatureRow> {
  const features = record(row.features);
  const targets = record(row.targets);
  const evidence = record(features.evidence);
  const settlementProof = {
    status: "settled",
    actualOutcome: draft.actualOutcome,
    finalScore: draft.finalScore,
    providerFixtureExternalId: draft.matchedProviderFixtureId,
    settledAt,
    source: "provider-final-score"
  };
  const nextFeatures = {
    ...features,
    evidence: {
      ...evidence,
      liveAndSettlement: true
    },
    settlementProof
  };
  const nextTargets = {
    ...targets,
    actualOutcome: draft.actualOutcome,
    settlementStatus: "settled",
    finalScore: draft.finalScore,
    settledAt,
    settlementSource: "provider-final-score",
    providerFixtureExternalId: draft.matchedProviderFixtureId
  };

  return {
    label: draft.actualOutcome,
    targets: nextTargets,
    features: nextFeatures,
    feature_hash: stableHash(nextFeatures)
  };
}

async function updateSettlementLabels(
  client: SupabaseClient,
  rows: FootballDataProviderRetestFeatureRow[],
  drafts: FootballProviderLiveSettlementDraft[],
  settledAt: string
): Promise<{ updatedIds: string[]; error: string | null }> {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const updatedIds: string[] = [];

  for (const draft of drafts.filter((item) => item.writePreview.canUpdateRow && item.actualOutcome)) {
    const row = rowsById.get(draft.rowId);
    if (!row) continue;
    const patch = settledRowPatch(row, draft, settledAt);
    const { data, error } = await client.from(FEATURE_SNAPSHOT_TABLE).update(patch).eq("id", row.id).select("id").single();
    if (error?.message) return { updatedIds, error: error.message };
    const id = textFrom(record(data).id);
    if (id) updatedIds.push(id);
  }

  return { updatedIds, error: null };
}

function statusFor({
  rows,
  drafts,
  runRequested,
  adminAuthorized,
  serverWriteReady,
  error,
  rowsUpdated
}: {
  rows: FootballDataProviderRetestFeatureRow[];
  drafts: FootballProviderLiveSettlementDraft[];
  runRequested: boolean;
  adminAuthorized: boolean;
  serverWriteReady: boolean;
  error: string | null;
  rowsUpdated: number;
}): FootballProviderLiveSettlementLabelStatus {
  if (error) return "failed";
  if (!serverWriteReady) return "waiting-supabase";
  if (!rows.length) return "no-live-rows";
  if (runRequested && !adminAuthorized) return "waiting-admin";
  const ready = drafts.filter((draft) => draft.status === "ready").length;
  const waiting = drafts.filter((draft) => draft.status === "waiting-final-score").length;
  const unsupported = drafts.filter((draft) => draft.status === "unsupported").length;
  if (rowsUpdated > 0) return "labels-stored";
  if (ready === rows.length) return "labels-ready";
  if (ready > 0 || unsupported > 0) return "partial-labels";
  if (waiting > 0) return "waiting-final-score";
  return "no-live-rows";
}

function summaryFor(status: FootballProviderLiveSettlementLabelStatus, totals: FootballProviderLiveSettlementLabelReceipt["totals"]): string {
  if (status === "labels-stored") return `Stored ${totals.rowsUpdated} settled outcome label(s) on live football feature row(s); training and public actions remain locked.`;
  if (status === "labels-ready") return `${totals.labelsDrafted} live football row(s) have provider final scores and are ready for admin-gated settlement labels.`;
  if (status === "partial-labels") return `${totals.labelsDrafted}/${totals.pendingRows} live football row(s) can be labeled; unresolved rows stay pending.`;
  if (status === "waiting-final-score") return "Stored live football rows are still waiting for provider final scores before outcome labels can be drafted.";
  if (status === "waiting-supabase") return "Settlement label receipt needs OddsPadi Supabase service-role readiness.";
  if (status === "waiting-admin") return "Settlement label writes require x-oddspadi-admin-token.";
  if (status === "failed") return "Settlement label receipt failed.";
  return "No pending stored live football rows were found for settlement labeling.";
}

function nextLabel(status: FootballProviderLiveSettlementLabelStatus): string {
  if (status === "labels-ready") return "Apply admin-gated settlement labels";
  if (status === "labels-stored") return "Rerun provider retest bridge";
  if (status === "partial-labels") return "Label ready rows and keep unresolved rows pending";
  if (status === "waiting-final-score") return "Refresh after final scores";
  if (status === "waiting-admin") return "Retry with admin token";
  if (status === "waiting-supabase") return "Fix Supabase service-role readiness";
  return "Collect stored live feature rows";
}

function queryString(params: Record<string, string | null | undefined>): string {
  return Object.entries(params)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

async function readStoredLiveRows({
  client,
  limit,
  source,
  fixtureExternalIds
}: {
  client: SupabaseClient;
  limit: number;
  source: string | null;
  fixtureExternalIds: string[];
}): Promise<{ rows: FootballDataProviderRetestFeatureRow[]; error: string | null }> {
  let query = client
    .from(FEATURE_SNAPSHOT_TABLE)
    .select("id, fixture_external_id, sport, model_key, generated_at, label, features, targets, split, source, feature_hash, created_at")
    .eq("sport", "football")
    .eq("model_key", FOOTBALL_PROVIDER_RETEST_MODEL_KEY)
    .eq("split", "live")
    .is("label", null)
    .order("generated_at", { ascending: false })
    .limit(limit);

  if (source) query = query.eq("source", source);
  if (fixtureExternalIds.length) query = query.in("fixture_external_id", fixtureExternalIds);

  const { data, error } = await query;
  if (error?.message) return { rows: [], error: error.message };
  return { rows: ((data ?? []) as FootballDataProviderRetestFeatureRow[]).filter(isPendingLiveRow), error: null };
}

export async function buildFootballProviderLiveSettlementLabelReceipt({
  runRequested = false,
  adminAuthorized = false,
  limit = 50,
  source = DEFAULT_OPENING_SOURCE,
  fixtureExternalIds = [],
  env = process.env,
  origin,
  now = new Date(),
  fetchImpl,
  rowsOverride
}: {
  runRequested?: boolean;
  adminAuthorized?: boolean;
  limit?: number;
  source?: string | null;
  fixtureExternalIds?: string[];
  env?: EnvLike;
  origin: string;
  now?: Date;
  fetchImpl?: FetchLike;
  rowsOverride?: FootballDataProviderRetestFeatureRow[];
}): Promise<FootballProviderLiveSettlementLabelReceipt> {
  const generatedAt = now.toISOString();
  const runtime = getSupabaseRuntimeStatus(env);
  const safeLimit = Math.max(1, Math.min(250, Math.trunc(limit)));
  let rows: FootballDataProviderRetestFeatureRow[] = [];
  let storageError: string | null = null;

  if (rowsOverride) {
    rows = rowsOverride.filter(isPendingLiveRow).slice(0, safeLimit);
  } else if (!runtime.serverWriteReady) {
    storageError = null;
  } else {
    const client = getSupabaseServerClient(env);
    if (!client) {
      storageError = "Supabase server client could not be created.";
    } else {
      const readResult = await readStoredLiveRows({ client, limit: safeLimit, source, fixtureExternalIds });
      rows = readResult.rows;
      storageError = readResult.error;
    }
  }

  const matchesByDate = rows.length ? await providerMatchesByDate({ rows, env, fetchImpl }) : new Map<string, Match[]>();
  const drafts = rows.map((row) => draftForRow(row, matchesByDate));
  let updatedIds: string[] = [];
  let writeError: string | null = null;

  if (runRequested && adminAuthorized && runtime.serverWriteReady && drafts.some((draft) => draft.writePreview.canUpdateRow)) {
    const client = getSupabaseServerClient(env);
    if (!client) {
      writeError = "Supabase server client could not be created for settlement label update.";
    } else {
      const writeResult = await updateSettlementLabels(client, rows, drafts, generatedAt);
      updatedIds = writeResult.updatedIds;
      writeError = writeResult.error;
    }
  }

  const totals = {
    rowsRead: rows.length,
    pendingRows: rows.length,
    providerDatesChecked: matchesByDate.size,
    finalScoresMatched: drafts.filter((draft) => draft.finalScore).length,
    labelsDrafted: drafts.filter((draft) => draft.status === "ready").length,
    rowsUpdated: updatedIds.length,
    waitingFinalScore: drafts.filter((draft) => draft.status === "waiting-final-score").length,
    unsupportedRows: drafts.filter((draft) => draft.status === "unsupported").length
  };
  const error = storageError ?? writeError;
  const status = statusFor({
    rows,
    drafts,
    runRequested,
    adminAuthorized,
    serverWriteReady: runtime.serverWriteReady || Boolean(rowsOverride),
    error,
    rowsUpdated: updatedIds.length
  });
  const verifyQuery = queryString({
    dryRun: "1",
    source,
    fixtureExternalIds: fixtureExternalIds.join(",") || null
  });
  const writeQuery = queryString({
    dryRun: "0",
    run: "1",
    source,
    fixtureExternalIds: fixtureExternalIds.join(",") || null
  });

  return {
    mode: "football-provider-live-settlement-label-receipt",
    generatedAt,
    status,
    receiptHash: stableHash({
      status,
      source,
      fixtureExternalIds,
      rows: rows.map((row) => [row.id, row.fixture_external_id, row.feature_hash]),
      drafts: drafts.map((draft) => [draft.rowId, draft.status, draft.actualOutcome, draft.finalScore]),
      updatedIds
    }),
    summary: summaryFor(status, totals),
    request: {
      runRequested,
      adminAuthorized,
      adminTokenConfigured: adminTokenConfigured(env),
      dryRun: !runRequested,
      limit: safeLimit,
      source,
      fixtureExternalIds
    },
    target: {
      projectRef: runtime.projectRef ?? runtime.urlProjectRef,
      expectedProjectRef: ODDSPADI_SUPABASE_PROJECT_REF,
      table: FEATURE_SNAPSHOT_TABLE,
      modelKey: FOOTBALL_PROVIDER_RETEST_MODEL_KEY,
      split: "live",
      serverWriteReady: runtime.serverWriteReady,
      targetMatchesExpected: runtime.targetMatchesExpected
    },
    totals,
    drafts,
    storage: {
      updated: updatedIds.length > 0,
      updatedIds,
      error
    },
    nextAction: {
      label: nextLabel(status),
      verifyUrl: `/api/sports/decision/training/football-provider-live-settlement-label-receipt?${status === "labels-ready" || status === "partial-labels" ? writeQuery : verifyQuery}`,
      expectedEvidence:
        "Stored split=live football rows receive actualOutcome labels only after provider final scores are matched; training, thresholds, public picks, and staking remain locked."
    },
    controls: {
      canInspectReadOnly: true,
      canDraftOutcomeLabels: totals.labelsDrafted > 0,
      canPersistOutcomeLabels: Boolean(runRequested && adminAuthorized && runtime.serverWriteReady && totals.labelsDrafted > 0 && !error),
      canFeedProviderRetestRunner: updatedIds.length > 0,
      canTrainModels: false,
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: [
      "Settlement labels require provider final scores and cannot be inferred from odds, AI text, or incomplete live states.",
      "Writes require dryRun=0, run=1, x-oddspadi-admin-token, OddsPadi Supabase service-role readiness, and a stored live feature row.",
      "A stored label may feed the read-only provider retest bridge, but it still cannot train models, apply thresholds, publish picks, or stake.",
      "Rows without matching provider final scores remain pending."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-provider-live-settlement-label-receipt",
      "/api/sports/decision/training/football-data-provider-retest-bridge",
      "/api/sports/decision/training/football-data-provider-retest-runner",
      "/api/sports/decision/training/football-provider-live-opening-round-storage",
      "/api/sports/decision/outcome-settlement"
    ]
  };
}
