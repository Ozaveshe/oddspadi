import type { SupabaseClient } from "@supabase/supabase-js";
import type { DecisionSummary, Match } from "@/lib/sports/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { refreshCanonicalDecision } from "@/lib/sports/prediction/canonicalDecision";
import { buildSportsSlate, isStoredFixtureFresh, reconcileStoredFixtureStatus } from "./canonical";
import type {
  CanonicalDecision,
  CanonicalFixture,
  CanonicalOddsSnapshot,
  FixtureOddsHistory,
  ProviderRunClaim,
  ProviderRunLog,
  ProviderRunStatus,
  SportsSlate
} from "./types";

type FixturePersistence = {
  fixtureIds: Map<string, string>;
  oddsByFixture: Map<string, CanonicalOddsSnapshot[]>;
};

function chunks<T>(rows: T[], size = 300): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) result.push(rows.slice(index, index + size));
  return result;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function identityArtworkMetadata(identity?: { logo?: string | null; flag?: string | null }): Record<string, string> {
  return {
    ...(text(identity?.logo) ? { logo: text(identity?.logo) as string } : {}),
    ...(text(identity?.flag) ? { flag: text(identity?.flag) as string } : {})
  };
}

function identityKey(row: { sport: unknown; provider: unknown; external_id: unknown }): string {
  return `${String(row.sport)}:${String(row.provider)}:${String(row.external_id)}`;
}

type StoredIdentityRow = Record<string, unknown> & {
  sport: string;
  provider: string;
  external_id: string;
};

export function storedFixtureArtwork({
  fixture,
  teams,
  leagues
}: {
  fixture: Record<string, unknown>;
  teams: StoredIdentityRow[];
  leagues: StoredIdentityRow[];
}) {
  const fixtureKey = (externalId: unknown) => identityKey({ sport: fixture.sport, provider: fixture.provider, external_id: externalId });
  const home = teams.find((row) => identityKey(row) === fixtureKey(fixture.home_team_external_id));
  const away = teams.find((row) => identityKey(row) === fixtureKey(fixture.away_team_external_id));
  const league = leagues.find((row) => identityKey(row) === fixtureKey(fixture.league_external_id));
  const fixtureMetadata = record(fixture.metadata);
  return {
    leagueName: text(league?.name) ?? text(fixture.league_name) ?? text(fixtureMetadata.leagueName),
    leagueCountry: text(league?.country) ?? text(fixture.country),
    leagueLogo: text(record(league?.metadata).logo) ?? text(fixtureMetadata.leagueLogo),
    leagueFlag: text(record(league?.metadata).flag) ?? text(fixtureMetadata.leagueFlag),
    homeLogo: text(record(home?.metadata).logo),
    awayLogo: text(record(away?.metadata).logo),
    homeCountry: text(home?.country) ?? text(fixture.country),
    awayCountry: text(away?.country) ?? text(fixture.country)
  };
}

function decisionSummaryFromRow(row: Record<string, unknown>): DecisionSummary | null {
  const fixtureId = text(row.fixture_external_id);
  const generatedAt = text(row.generated_at);
  const publicStatus = text(row.public_status) as DecisionSummary["publicStatus"] | null;
  const engineStatus = text(row.engine_status) as DecisionSummary["engineStatus"] | null;
  const analyses = Array.isArray(row.all_market_analyses)
    ? row.all_market_analyses as DecisionSummary["allMarketAnalyses"]
    : [];
  const auditSummary = record(row.audit_summary) as unknown as DecisionSummary["auditSummary"];
  if (!fixtureId || !generatedAt || !publicStatus || !engineStatus || !auditSummary.thresholds) return null;
  return refreshCanonicalDecision({
    fixtureId,
    bestPublishedPick: (row.best_published_pick ?? null) as DecisionSummary["bestPublishedPick"],
    bestLean: (row.best_lean ?? null) as DecisionSummary["bestLean"],
    bestWatchlistCandidate: (row.best_watchlist_candidate ?? null) as DecisionSummary["bestWatchlistCandidate"],
    noPickReason: text(row.no_pick_reason),
    allMarketAnalyses: analyses,
    publicStatus,
    engineStatus,
    dataQuality: number(row.data_quality) ?? 0,
    evidenceQuality: row.evidence_quality as DecisionSummary["evidenceQuality"],
    confidence: row.confidence as DecisionSummary["confidence"],
    risk: row.risk as DecisionSummary["risk"],
    generatedAt,
    expiresAt: text(row.expires_at),
    auditSummary
  });
}

function providerRunStatus(value: unknown): ProviderRunStatus {
  return value === "running" || value === "completed" || value === "partial" || value === "empty" || value === "failed" || value === "unavailable"
    ? value
    : "failed";
}

function runLogFromRow(row: Record<string, unknown>): ProviderRunLog {
  const metadata = record(row.metadata);
  const errors = Array.isArray(row.errors) ? row.errors.filter((value): value is string => typeof value === "string") : [];
  return {
    runId: text(row.id),
    providerName: text(row.provider) ?? "unknown",
    jobType: text(row.job_type) ?? text(row.ingestion_type) ?? "provider_sync",
    startedAt: text(row.started_at) ?? text(row.created_at) ?? new Date().toISOString(),
    finishedAt: text(row.finished_at) ?? text(row.completed_at),
    status: providerRunStatus(metadata.pipelineStatus ?? row.status),
    fixturesFound: number(row.fixtures_found) ?? number(row.rows_received) ?? 0,
    oddsFound: number(row.odds_found) ?? 0,
    predictionsGenerated: number(row.predictions_generated) ?? 0,
    valuePicksPublished: number(row.value_picks_published) ?? 0,
    errors: errors.length ? errors : text(row.error_message) ? [text(row.error_message) as string] : []
  };
}

export async function startProviderRun({
  providerName,
  jobType,
  startedAt,
  sport = "multi",
  client = getSupabaseServerClient()
}: {
  providerName: string;
  jobType: string;
  startedAt: string;
  sport?: string;
  client?: SupabaseClient | null;
}): Promise<ProviderRunClaim> {
  const base: ProviderRunLog = {
    runId: null,
    providerName,
    jobType,
    startedAt,
    finishedAt: null,
    status: client ? "running" : "unavailable",
    fixturesFound: 0,
    oddsFound: 0,
    predictionsGenerated: 0,
    valuePicksPublished: 0,
    errors: client ? [] : ["OddsPadi Supabase server storage is not configured in this runtime."]
  };
  if (!client) return { run: base, acquired: false };
  const staleCutoff = new Date(new Date(startedAt).getTime() - 15 * 60_000).toISOString();
  const { error: staleRunCleanupError } = await client
    .from("op_provider_ingestion_runs")
    .update({
      status: "failed",
      completed_at: startedAt,
      finished_at: startedAt,
      error_message: "Provider run exceeded the 15-minute completion window and was closed as stale.",
      errors: ["Provider run exceeded the 15-minute completion window and was closed as stale."],
      metadata: { pipelineStatus: "failed", staleRunClosedAt: startedAt }
    })
    .eq("status", "running")
    .lt("started_at", staleCutoff);
  if (staleRunCleanupError) {
    console.warn(`[sports-intelligence] stale provider-run cleanup failed: ${staleRunCleanupError.message}`);
  }
  const { data, error } = await client
    .from("op_provider_ingestion_runs")
    .insert({
      provider: providerName,
      sport,
      ingestion_type: jobType,
      job_type: jobType,
      status: "running",
      started_at: startedAt,
      rows_received: 0,
      rows_written: 0,
      metadata: { pipelineStatus: "running" }
    })
    .select("id")
    .single();
  if (!error && text(data?.id)) return { run: { ...base, runId: String(data.id) }, acquired: true };
  if (error?.code === "23505") {
    const { data: active } = await client
      .from("op_provider_ingestion_runs")
      .select("id,provider,ingestion_type,job_type,status,started_at,completed_at,finished_at,rows_received,fixtures_found,odds_found,predictions_generated,value_picks_published,error_message,errors,metadata,created_at")
      .eq("status", "running")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const existing = active ? runLogFromRow(active as Record<string, unknown>) : base;
    return {
      run: { ...existing, errors: [...existing.errors, `Skipped ${jobType}; active ${existing.jobType} receipt owns the sports pipeline.`] },
      acquired: false
    };
  }
  return {
    run: { ...base, status: "failed", errors: [error?.message ?? "Provider run log insert did not return an ID."] },
    acquired: false
  };
}

export async function finishProviderRun(
  run: ProviderRunLog,
  update: Omit<ProviderRunLog, "runId" | "providerName" | "jobType" | "startedAt">,
  client: SupabaseClient | null = getSupabaseServerClient(),
  diagnostics?: Record<string, unknown>
): Promise<ProviderRunLog> {
  const finished = { ...run, ...update };
  if (!client || !run.runId) return finished;
  const { error } = await client
    .from("op_provider_ingestion_runs")
    .update({
      status: update.status,
      completed_at: update.finishedAt,
      finished_at: update.finishedAt,
      rows_received: update.fixturesFound,
      rows_written: update.fixturesFound + update.oddsFound + update.predictionsGenerated,
      fixtures_found: update.fixturesFound,
      odds_found: update.oddsFound,
      predictions_generated: update.predictionsGenerated,
      value_picks_published: update.valuePicksPublished,
      error_message: update.errors[0] ?? null,
      errors: update.errors,
      metadata: { pipelineStatus: update.status, ...(diagnostics ?? {}) }
    })
    .eq("id", run.runId);
  return error ? { ...finished, status: "partial", errors: [...finished.errors, `Run log update failed: ${error.message}`] } : finished;
}

function oddsProbabilities(snapshots: CanonicalOddsSnapshot[]) {
  const byMarket = new Map<string, CanonicalOddsSnapshot[]>();
  for (const snapshot of snapshots) byMarket.set(snapshot.market, [...(byMarket.get(snapshot.market) ?? []), snapshot]);
  const result = new Map<string, { implied: number; noVig: number }>();
  for (const [market, rows] of byMarket) {
    const implied = rows.map((row) => 1 / row.decimalOdds);
    const total = implied.reduce((sum, value) => sum + value, 0);
    rows.forEach((row, index) => result.set(`${market}:${row.selection}`, { implied: implied[index], noVig: total > 0 ? implied[index] / total : implied[index] }));
  }
  return result;
}

export async function persistFixturesAndOdds({
  matches,
  fixtures,
  oddsByFixture,
  client = getSupabaseServerClient()
}: {
  matches: Match[];
  fixtures: CanonicalFixture[];
  oddsByFixture: Map<string, CanonicalOddsSnapshot[]>;
  client?: SupabaseClient | null;
}): Promise<FixturePersistence> {
  if (!client || !fixtures.length) return { fixtureIds: new Map(), oddsByFixture };
  const matchById = new Map(matches.map((match) => [match.id, match]));
  const leagueRows = fixtures.map((fixture) => {
    const match = matchById.get(fixture.fixtureId);
    return {
      sport: fixture.sport,
      provider: fixture.provider,
      external_id: fixture.leagueId,
      name: fixture.league,
      country: fixture.country,
      strength: match?.league.strength ?? null,
      metadata: identityArtworkMetadata(match?.league)
    };
  });
  const teamRows = fixtures.flatMap((fixture) => {
    const match = matchById.get(fixture.fixtureId);
    return [
      { sport: fixture.sport, provider: fixture.provider, external_id: fixture.homeTeam.id, name: fixture.homeTeam.name, country: fixture.homeTeam.country ?? fixture.country, metadata: identityArtworkMetadata(match?.homeTeam) },
      { sport: fixture.sport, provider: fixture.provider, external_id: fixture.awayTeam.id, name: fixture.awayTeam.name, country: fixture.awayTeam.country ?? fixture.country, metadata: identityArtworkMetadata(match?.awayTeam) }
    ];
  });
  const uniqueRows = <T extends { provider: string; sport: string; external_id: string }>(rows: T[]) => [...new Map(rows.map((row) => [`${row.provider}:${row.sport}:${row.external_id}`, row])).values()];
  for (const rows of chunks(uniqueRows(leagueRows))) {
    const { error } = await client.from("op_leagues").upsert(rows, { onConflict: "provider,sport,external_id" });
    if (error) throw new Error(`League persistence failed: ${error.message}`);
  }
  for (const rows of chunks(uniqueRows(teamRows))) {
    const { error } = await client.from("op_teams").upsert(rows, { onConflict: "provider,sport,external_id" });
    if (error) throw new Error(`Team persistence failed: ${error.message}`);
  }

  const fixtureIds = new Map<string, string>();
  const fixtureRows = fixtures.map((fixture) => {
    const match = matchById.get(fixture.fixtureId);
    return {
      sport: fixture.sport,
      provider: fixture.provider,
      external_id: fixture.fixtureId,
      provider_fixture_id: fixture.providerFixtureId,
      league_external_id: fixture.leagueId,
      league_name: fixture.league,
      season: fixture.season,
      round: match?.dataSource?.round ?? null,
      kickoff_at: fixture.kickoffAt,
      status: fixture.status,
      home_team_external_id: fixture.homeTeam.id,
      away_team_external_id: fixture.awayTeam.id,
      home_team_name: fixture.homeTeam.name,
      away_team_name: fixture.awayTeam.name,
      home_score: fixture.score?.home ?? null,
      away_score: fixture.score?.away ?? null,
      neutral_venue: false,
      venue: match?.venue?.name ?? null,
      country: fixture.country,
      data_quality: fixture.dataQuality,
      last_synced_at: fixture.lastSyncedAt,
      metadata: {
        sourceKind: "real",
        fixtureProviderId: fixture.providerFixtureId,
        elapsed: fixture.score?.minute ?? null,
        venueCity: match?.venue?.city ?? null,
        leagueLogo: match?.league.logo ?? null,
        leagueFlag: match?.league.flag ?? null
      }
    };
  });
  for (const rows of chunks(fixtureRows)) {
    const { data, error } = await client.from("op_fixtures").upsert(rows, { onConflict: "provider,sport,external_id" }).select("id,external_id");
    if (error) throw new Error(`Fixture persistence failed: ${error.message}`);
    for (const row of data ?? []) fixtureIds.set(String(row.external_id), String(row.id));
  }

  const persistedOdds = new Map<string, CanonicalOddsSnapshot[]>();
  for (const fixture of fixtures) {
    const fixtureId = fixtureIds.get(fixture.fixtureId);
    const snapshots = oddsByFixture.get(fixture.fixtureId) ?? [];
    if (!fixtureId || !snapshots.length) {
      persistedOdds.set(fixture.fixtureId, snapshots);
      continue;
    }
    const probabilities = oddsProbabilities(snapshots);
    const rows = snapshots.map((snapshot) => {
      const probability = probabilities.get(`${snapshot.market}:${snapshot.selection}`);
      return {
        fixture_id: fixtureId,
        fixture_external_id: fixture.fixtureId,
        sport: fixture.sport,
        provider: snapshot.provider,
        bookmaker: snapshot.bookmaker,
        market: snapshot.market,
        selection: snapshot.selection,
        decimal_odds: snapshot.decimalOdds,
        implied_probability: probability?.implied ?? 1 / snapshot.decimalOdds,
        margin_adjusted_probability: probability?.noVig ?? null,
        is_closing: false,
        observed_at: snapshot.capturedAt,
        captured_at: snapshot.capturedAt,
        source: snapshot.source,
        is_live: snapshot.isLive,
        expires_at: snapshot.expiresAt,
        metadata: { label: snapshot.label }
      };
    });
    const { data, error } = await client.from("op_odds_snapshots").insert(rows).select("id,market,selection,captured_at");
    if (error) throw new Error(`Odds persistence failed: ${error.message}`);
    const ids = new Map((data ?? []).map((row) => [`${row.market}:${row.selection}:${row.captured_at}`, String(row.id)]));
    persistedOdds.set(
      fixture.fixtureId,
      snapshots.map((snapshot) => ({ ...snapshot, oddsSnapshotId: ids.get(`${snapshot.market}:${snapshot.selection}:${snapshot.capturedAt}`) ?? null }))
    );
  }
  return { fixtureIds, oddsByFixture: persistedOdds };
}

export async function persistMarketDecisions({
  decisionsByFixture,
  fixtureIds,
  fixtureSports,
  client = getSupabaseServerClient()
}: {
  decisionsByFixture: Map<string, CanonicalDecision[]>;
  fixtureIds: Map<string, string>;
  fixtureSports: Map<string, Match["sport"]>;
  client?: SupabaseClient | null;
}): Promise<Map<string, CanonicalDecision[]>> {
  if (!client) return decisionsByFixture;
  const allDecisions = [...decisionsByFixture.values()].flat().filter((decision) => fixtureIds.has(decision.fixtureId));
  if (!allDecisions.length) return decisionsByFixture;
  const databaseFixtureIds = [...new Set(allDecisions.map((decision) => fixtureIds.get(decision.fixtureId) as string))];
  const { data: previous, error: previousError } = await client
    .from("op_market_decisions")
    .select("id,fixture_id,market,selection,settlement_status")
    .in("fixture_id", databaseFixtureIds)
    .is("superseded_by", null);
  if (previousError) throw new Error(`Previous decision read failed: ${previousError.message}`);
  const previousByKey = new Map((previous ?? []).map((row) => [`${row.fixture_id}:${row.market}:${row.selection}`, row]));
  const insertedRows: Array<{ id: string; fixture_id: string; market: string; selection: string }> = [];
  for (const decisions of chunks(allDecisions)) {
    const rows = decisions.map((decision) => ({
      id: decision.decisionId,
      fixture_id: fixtureIds.get(decision.fixtureId),
      fixture_external_id: decision.fixtureId,
      sport: fixtureSports.get(decision.fixtureId) ?? "football",
      market: decision.market,
      selection: decision.selection,
      odds_snapshot_id: decision.oddsSnapshotId,
      model_version: decision.modelVersion,
      engine_version: decision.engineVersion,
      model_probability: decision.modelProbability,
      implied_probability: decision.impliedProbability,
      no_vig_probability: decision.noVigProbability,
      value_edge: decision.valueEdge,
      expected_value: decision.expectedValue,
      confidence: decision.confidence,
      risk: decision.risk,
      data_quality: decision.dataQuality,
      evidence_quality: decision.evidenceQuality,
      decision_status: decision.decisionStatus,
      public_status: decision.publicStatus,
      reason: decision.reason,
      generated_at: decision.generatedAt,
      expires_at: decision.expiresAt,
      superseded_by: null,
      settlement_status: decision.settlementStatus,
      is_preliminary: decision.isPreliminary,
      internal_only: true,
      public_decision_id: null,
      provider: decision.provider,
      updated_at: decision.generatedAt
    }));
    const { data, error } = await client.from("op_market_decisions").insert(rows).select("id,fixture_id,market,selection");
    if (error) throw new Error(`Decision persistence failed: ${error.message}`);
    insertedRows.push(...((data ?? []) as Array<{ id: string; fixture_id: string; market: string; selection: string }>));
  }
  for (const inserted of insertedRows) {
    const prior = previousByKey.get(`${inserted.fixture_id}:${inserted.market}:${inserted.selection}`);
    if (!prior || prior.id === inserted.id || prior.settlement_status !== "pending") continue;
    const { error } = await client
      .from("op_market_decisions")
      .update({ superseded_by: inserted.id, decision_status: "stale", public_status: "stale", updated_at: new Date().toISOString() })
      .eq("id", prior.id);
    if (error) throw new Error(`Decision supersession failed: ${error.message}`);
  }
  return decisionsByFixture;
}

export async function persistDecisionSummaries({
  decisionSummariesByFixture,
  fixtureIds,
  fixtureSports,
  client = getSupabaseServerClient()
}: {
  decisionSummariesByFixture: Map<string, DecisionSummary>;
  fixtureIds: Map<string, string>;
  fixtureSports: Map<string, Match["sport"]>;
  client?: SupabaseClient | null;
}): Promise<Map<string, DecisionSummary>> {
  if (!client) return decisionSummariesByFixture;
  const summaries = [...decisionSummariesByFixture.values()].filter((summary) => fixtureIds.has(summary.fixtureId));
  if (!summaries.length) return decisionSummariesByFixture;
  for (const batch of chunks(summaries)) {
    const rows = batch.map((summary) => ({
      fixture_id: fixtureIds.get(summary.fixtureId),
      fixture_external_id: summary.fixtureId,
      sport: fixtureSports.get(summary.fixtureId) ?? "football",
      best_published_pick: summary.bestPublishedPick,
      best_lean: summary.bestLean,
      best_watchlist_candidate: summary.bestWatchlistCandidate,
      no_pick_reason: summary.noPickReason,
      all_market_analyses: summary.allMarketAnalyses,
      public_status: summary.publicStatus,
      engine_status: summary.engineStatus,
      data_quality: summary.dataQuality,
      evidence_quality: summary.evidenceQuality,
      confidence: summary.confidence,
      risk: summary.risk,
      generated_at: summary.generatedAt,
      expires_at: summary.expiresAt,
      audit_summary: summary.auditSummary,
      superseded_by: null,
      updated_at: summary.generatedAt
    }));
    const { data: inserted, error } = await client
      .from("op_fixture_decision_summaries")
      .insert(rows)
      .select("id,fixture_id");
    if (error) throw new Error(`Canonical decision summary persistence failed: ${error.message}`);
    for (const row of inserted ?? []) {
      const { error: supersedeError } = await client
        .from("op_fixture_decision_summaries")
        .update({ superseded_by: row.id, updated_at: new Date().toISOString() })
        .eq("fixture_id", row.fixture_id)
        .is("superseded_by", null)
        .neq("id", row.id);
      if (supersedeError) throw new Error(`Canonical decision summary supersession failed: ${supersedeError.message}`);
    }
  }
  return decisionSummariesByFixture;
}

export async function readLatestDecisionSummary(
  fixtureExternalId: string,
  client: SupabaseClient | null = getSupabaseServerClient()
): Promise<DecisionSummary | null> {
  if (!client) return null;
  const { data, error } = await client
    .from("op_fixture_decision_summaries")
    .select("fixture_external_id,best_published_pick,best_lean,best_watchlist_candidate,no_pick_reason,all_market_analyses,public_status,engine_status,data_quality,evidence_quality,confidence,risk,generated_at,expires_at,audit_summary")
    .eq("fixture_external_id", fixtureExternalId)
    .is("superseded_by", null)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return decisionSummaryFromRow(data as Record<string, unknown>);
}

const FIXTURE_ODDS_HISTORY_LIMIT = 600;

export async function readFixtureOddsHistory(
  fixtureExternalId: string,
  client: SupabaseClient | null = getSupabaseServerClient()
): Promise<FixtureOddsHistory> {
  if (!client) {
    return {
      status: "unavailable",
      snapshots: [],
      rowsRead: 0,
      truncated: false,
      reason: "Stored odds history is unavailable because server-side Supabase reads are not configured."
    };
  }

  try {
    const { data, error } = await client
      .from("op_odds_snapshots")
      .select("id,fixture_external_id,provider,bookmaker,market,selection,decimal_odds,captured_at,source,is_live,expires_at,metadata")
      .eq("fixture_external_id", fixtureExternalId)
      .eq("is_live", false)
      .order("captured_at", { ascending: false })
      .limit(FIXTURE_ODDS_HISTORY_LIMIT + 1);
    if (error) {
      return {
        status: "failed",
        snapshots: [],
        rowsRead: 0,
        truncated: false,
        reason: `Stored odds history read failed: ${error.message}`
      };
    }

    const rows = ((data ?? []) as Array<Record<string, unknown>>).filter((row) => {
      const metadata = record(row.metadata);
      const provider = text(row.provider)?.toLowerCase() ?? "";
      const capturedAt = text(row.captured_at);
      const decimalOdds = number(row.decimal_odds);
      return (
        !provider.includes("mock") &&
        metadata.sourceKind !== "demo" &&
        metadata.sourceKind !== "mock" &&
        Boolean(text(row.fixture_external_id)) &&
        Boolean(text(row.market)) &&
        Boolean(text(row.selection)) &&
        Boolean(capturedAt && Number.isFinite(Date.parse(capturedAt))) &&
        decimalOdds !== null &&
        decimalOdds > 1
      );
    });
    const truncated = rows.length > FIXTURE_ODDS_HISTORY_LIMIT;
    const snapshots = rows
      .slice(0, FIXTURE_ODDS_HISTORY_LIMIT)
      .map((row): CanonicalOddsSnapshot => {
        const metadata = record(row.metadata);
        const provider = text(row.provider) ?? "unknown";
        const capturedAt = text(row.captured_at) as string;
        return {
          oddsSnapshotId: text(row.id),
          fixtureId: text(row.fixture_external_id) as string,
          market: text(row.market) as string,
          selection: text(row.selection) as string,
          label: text(metadata.label) ?? text(row.selection) as string,
          decimalOdds: number(row.decimal_odds) as number,
          bookmaker: text(row.bookmaker) ?? provider,
          provider,
          capturedAt,
          source: text(row.source) ?? provider,
          isLive: false,
          expiresAt: text(row.expires_at) ?? capturedAt
        };
      })
      .sort((left, right) => Date.parse(left.capturedAt) - Date.parse(right.capturedAt));

    return snapshots.length
      ? {
          status: "ready",
          snapshots,
          rowsRead: snapshots.length,
          truncated,
          reason: truncated ? `Showing the most recent ${FIXTURE_ODDS_HISTORY_LIMIT} verified pre-match snapshots.` : null
        }
      : {
          status: "no-data",
          snapshots: [],
          rowsRead: 0,
          truncated: false,
          reason: "No verified pre-match odds snapshots are stored for this fixture yet."
        };
  } catch (error) {
    return {
      status: "failed",
      snapshots: [],
      rowsRead: 0,
      truncated: false,
      reason: `Stored odds history read failed: ${error instanceof Error ? error.message : "unknown error"}`
    };
  }
}

export async function readLatestProviderRun(jobTypes: string[], client: SupabaseClient | null = getSupabaseServerClient()): Promise<ProviderRunLog | null> {
  if (!client) return null;
  const { data, error } = await client
    .from("op_provider_ingestion_runs")
    .select("id,provider,ingestion_type,job_type,status,started_at,completed_at,finished_at,rows_received,fixtures_found,odds_found,predictions_generated,value_picks_published,error_message,errors,metadata,created_at")
    .in("job_type", jobTypes)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return runLogFromRow(data as Record<string, unknown>);
}

type FixtureRow = Record<string, unknown> & { id: string; external_id: string };

export async function readStoredSlate({
  scope,
  from,
  toExclusive,
  jobTypes,
  client = getSupabaseServerClient(),
  now = new Date(),
  maxFixtureAgeMs,
  includeSuspended = false
}: {
  scope: SportsSlate["scope"];
  from: string;
  toExclusive: string;
  jobTypes: string[];
  client?: SupabaseClient | null;
  now?: Date;
  maxFixtureAgeMs: number;
  includeSuspended?: boolean;
}): Promise<SportsSlate | null> {
  if (!client) return null;
  const { data, error } = await client
    .from("op_fixtures")
    .select("id,sport,provider,external_id,provider_fixture_id,league_external_id,league_name,season,kickoff_at,status,home_team_external_id,away_team_external_id,home_team_name,away_team_name,home_score,away_score,country,data_quality,last_synced_at,metadata")
    .gte("kickoff_at", from)
    .lt("kickoff_at", toExclusive)
    .order("kickoff_at", { ascending: true })
    .limit(1000);
  if (error) throw new Error(`Stored fixture read failed: ${error.message}`);
  const providerRows = ((data ?? []) as FixtureRow[]).filter((row) => {
    const metadata = record(row.metadata);
    return !String(row.provider).toLowerCase().includes("mock") && metadata.sourceKind !== "demo" && metadata.sourceKind !== "mock";
  });
  const eligibleRows = includeSuspended ? providerRows : providerRows.filter((row) => row.status !== "suspended");
  const staleRows = eligibleRows.filter((row) => !isStoredFixtureFresh(text(row.last_synced_at), now, maxFixtureAgeMs));
  const fixtureRows = eligibleRows.filter((row) => isStoredFixtureFresh(text(row.last_synced_at), now, maxFixtureAgeMs));
  const databaseFixtureIds = fixtureRows.map((row) => String(row.id));
  const teamExternalIds = [...new Set(fixtureRows.flatMap((row) => [text(row.home_team_external_id), text(row.away_team_external_id)]).filter((value): value is string => Boolean(value)))];
  const leagueExternalIds = [...new Set(fixtureRows.map((row) => text(row.league_external_id)).filter((value): value is string => Boolean(value)))];
  const [
    { data: odds, error: oddsError },
    { data: decisions, error: decisionsError },
    { data: summaries, error: summariesError },
    { data: teams, error: teamsError },
    { data: leagues, error: leaguesError },
    lastRun
  ] = await Promise.all([
    databaseFixtureIds.length
      ? client.from("op_odds_snapshots").select("id,fixture_id,fixture_external_id,provider,bookmaker,market,selection,decimal_odds,captured_at,source,is_live,expires_at,metadata").in("fixture_id", databaseFixtureIds).order("captured_at", { ascending: false }).limit(10000)
      : Promise.resolve({ data: [], error: null }),
    databaseFixtureIds.length
      ? client.from("op_market_decisions").select("id,fixture_id,fixture_external_id,market,selection,odds_snapshot_id,model_version,engine_version,model_probability,implied_probability,no_vig_probability,value_edge,expected_value,confidence,risk,data_quality,evidence_quality,decision_status,public_status,reason,generated_at,expires_at,superseded_by,settlement_status,is_preliminary,provider").in("fixture_id", databaseFixtureIds).is("superseded_by", null).limit(10000)
      : Promise.resolve({ data: [], error: null }),
    databaseFixtureIds.length
      ? client.from("op_fixture_decision_summaries").select("fixture_id,fixture_external_id,best_published_pick,best_lean,best_watchlist_candidate,no_pick_reason,all_market_analyses,public_status,engine_status,data_quality,evidence_quality,confidence,risk,generated_at,expires_at,audit_summary").in("fixture_id", databaseFixtureIds).is("superseded_by", null).order("generated_at", { ascending: false }).limit(1000)
      : Promise.resolve({ data: [], error: null }),
    teamExternalIds.length
      ? client.from("op_teams").select("sport,provider,external_id,country,metadata").in("external_id", teamExternalIds).limit(2000)
      : Promise.resolve({ data: [], error: null }),
    leagueExternalIds.length
      ? client.from("op_leagues").select("sport,provider,external_id,country,metadata").in("external_id", leagueExternalIds).limit(1000)
      : Promise.resolve({ data: [], error: null }),
    readLatestProviderRun(jobTypes, client)
  ]);
  if (oddsError) throw new Error(`Stored odds read failed: ${oddsError.message}`);
  if (decisionsError) throw new Error(`Stored decision read failed: ${decisionsError.message}`);
  if (summariesError) throw new Error(`Stored canonical decision summary read failed: ${summariesError.message}`);
  if (teamsError) throw new Error(`Stored team identity read failed: ${teamsError.message}`);
  if (leaguesError) throw new Error(`Stored league identity read failed: ${leaguesError.message}`);

  const latestOdds = new Map<string, CanonicalOddsSnapshot>();
  for (const row of (odds ?? []) as Array<Record<string, unknown>>) {
    const metadata = record(row.metadata);
    const key = `${row.fixture_external_id}:${row.market}:${row.selection}`;
    if (latestOdds.has(key)) continue;
    latestOdds.set(key, {
      oddsSnapshotId: text(row.id),
      fixtureId: String(row.fixture_external_id),
      market: String(row.market),
      selection: String(row.selection),
      label: text(metadata.label) ?? String(row.selection),
      decimalOdds: number(row.decimal_odds) ?? 0,
      bookmaker: text(row.bookmaker) ?? text(row.provider) ?? "unknown",
      provider: text(row.provider) ?? "unknown",
      capturedAt: text(row.captured_at) ?? new Date().toISOString(),
      source: text(row.source) ?? text(row.provider) ?? "unknown",
      isLive: row.is_live === true,
      expiresAt: text(row.expires_at) ?? new Date(0).toISOString()
    });
  }
  const oddsByFixture = new Map<string, CanonicalOddsSnapshot[]>();
  for (const snapshot of latestOdds.values()) oddsByFixture.set(snapshot.fixtureId, [...(oddsByFixture.get(snapshot.fixtureId) ?? []), snapshot]);

  const decisionsByFixture = new Map<string, CanonicalDecision[]>();
  for (const row of (decisions ?? []) as Array<Record<string, unknown>>) {
    const fixtureId = String(row.fixture_external_id);
    const snapshot = latestOdds.get(`${fixtureId}:${row.market}:${row.selection}`);
    const decision: CanonicalDecision = {
      decisionId: String(row.id), fixtureId, market: String(row.market), selection: String(row.selection), label: snapshot?.label ?? String(row.selection),
      oddsSnapshotId: text(row.odds_snapshot_id), modelVersion: String(row.model_version), engineVersion: String(row.engine_version),
      modelProbability: number(row.model_probability), impliedProbability: number(row.implied_probability), noVigProbability: number(row.no_vig_probability),
      valueEdge: number(row.value_edge), expectedValue: number(row.expected_value), decimalOdds: snapshot?.decimalOdds ?? null,
      confidence: row.confidence as CanonicalDecision["confidence"], risk: row.risk as CanonicalDecision["risk"], dataQuality: number(row.data_quality) ?? 0,
      evidenceQuality: row.evidence_quality as CanonicalDecision["evidenceQuality"], decisionStatus: row.decision_status as CanonicalDecision["decisionStatus"],
      publicStatus: row.public_status as CanonicalDecision["publicStatus"], reason: String(row.reason), generatedAt: String(row.generated_at),
      expiresAt: text(row.expires_at), supersededBy: text(row.superseded_by), settlementStatus: row.settlement_status as CanonicalDecision["settlementStatus"],
      isPreliminary: row.is_preliminary === true, provider: String(row.provider)
    };
    decisionsByFixture.set(fixtureId, [...(decisionsByFixture.get(fixtureId) ?? []), decision]);
  }

  const decisionSummariesByFixture = new Map<string, DecisionSummary>();
  for (const row of (summaries ?? []) as Array<Record<string, unknown>>) {
    const summary = decisionSummaryFromRow(row);
    if (!summary || decisionSummariesByFixture.has(summary.fixtureId)) continue;
    decisionSummariesByFixture.set(summary.fixtureId, summary);
  }

  const teamRows = (teams ?? []) as StoredIdentityRow[];
  const leagueRows = (leagues ?? []) as StoredIdentityRow[];
  const fixtures: CanonicalFixture[] = fixtureRows.map((row) => {
    const artwork = storedFixtureArtwork({ fixture: row, teams: teamRows, leagues: leagueRows });
    return {
      fixtureId: String(row.external_id),
      providerFixtureId: text(row.provider_fixture_id) ?? String(row.external_id),
      sport: row.sport as CanonicalFixture["sport"],
      league: text(row.league_name) ?? artwork.leagueName ?? "Competition",
      leagueId: text(row.league_external_id) ?? "unknown",
      leagueLogo: artwork.leagueLogo,
      leagueFlag: artwork.leagueFlag,
      country: artwork.leagueCountry ?? "World",
      season: text(row.season),
      kickoffAt: String(row.kickoff_at),
      homeTeam: { id: String(row.home_team_external_id), name: text(row.home_team_name) ?? "Home", logo: artwork.homeLogo, country: artwork.homeCountry },
      awayTeam: { id: String(row.away_team_external_id), name: text(row.away_team_name) ?? "Away", logo: artwork.awayLogo, country: artwork.awayCountry },
      status: reconcileStoredFixtureStatus({
        status: row.status as Match["status"],
        kickoffAt: String(row.kickoff_at),
        lastSyncedAt: text(row.last_synced_at),
        homeScore: number(row.home_score),
        awayScore: number(row.away_score)
      }, now, maxFixtureAgeMs),
      score: number(row.home_score) !== null && number(row.away_score) !== null ? { home: number(row.home_score) as number, away: number(row.away_score) as number } : null,
      provider: String(row.provider),
      lastSyncedAt: text(row.last_synced_at) ?? String(row.kickoff_at),
      dataQuality: number(row.data_quality) ?? 0
    };
  });
  const staleReason = staleRows.length
    ? `${staleRows.length} stored fixture${staleRows.length === 1 ? " was" : "s were"} excluded because provider sync was older than ${Math.round(maxFixtureAgeMs / 60_000)} minutes.`
    : null;
  const providerStatus = staleRows.length
    ? fixtures.length ? "partial" : "failed"
    : lastRun?.status ?? (fixtures.length ? "completed" : "empty");
  return buildSportsSlate({
    scope,
    fixtures,
    oddsByFixture,
    decisionsByFixture,
    decisionSummariesByFixture,
    range: { from: from.slice(0, 10), to: new Date(new Date(toExclusive).getTime() - 1).toISOString().slice(0, 10) },
    providerStatus,
    providerErrors: [...(lastRun?.errors ?? []), ...(staleReason ? [staleReason] : [])],
    lastRun
  });
}
