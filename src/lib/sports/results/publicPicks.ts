import type { SupabaseClient } from "@supabase/supabase-js";
import type { DecisionSummary, Match } from "@/lib/sports/types";
import type { CanonicalDecision } from "@/lib/sports/intelligence/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type PublicPickStatus = "published" | "stale" | "suspended" | "settled" | "void";
export type PublicPickSettlementStatus =
  | "waiting_kickoff"
  | "match_live"
  | "awaiting_final_score"
  | "awaiting_market_resolution"
  | "settled"
  | "void"
  | "needs_manual_review"
  | "provider_missing";
export type PublicPickResult = "pending" | "won" | "lost" | "push" | "void";

/** Canonical market analysis row. This is the PredictionRun data model. */
export type PredictionRun = {
  runId: string;
  fixtureId: string;
  sport: Match["sport"];
  market: string;
  selection: string;
  modelVersion: string;
  oddsSnapshotId: string | null;
  generatedAt: string;
  internalOnly: boolean;
  publicDecisionId: string | null;
};

export type PublicPick = {
  publicPickId: string;
  fixtureId: string;
  sport: Match["sport"];
  league: string;
  country: string | null;
  homeTeam: string;
  awayTeam: string;
  kickoffAt: string;
  market: string;
  selection: string;
  selectionLabel: string;
  marketLine: number | null;
  odds: number;
  modelVersion: string;
  engineVersion: string;
  modelProbability: number;
  impliedProbability: number;
  noVigProbability: number;
  valueEdge: number;
  expectedValue: number;
  dataQuality?: number | null;
  confidence: CanonicalDecision["confidence"];
  risk: CanonicalDecision["risk"];
  publishedAt: string;
  status: PublicPickStatus;
  settlementStatus: PublicPickSettlementStatus;
  result: PublicPickResult;
  settlementReason: string;
  settledAt: string | null;
  closingOdds: number | null;
  closingLineValue: number | null;
  provider: string;
  providerFixtureId: string;
  revision: number;
};

export type PublicPickDraft = Omit<PublicPick, "publicPickId" | "settledAt" | "closingOdds" | "closingLineValue"> & {
  fixtureDbId: string;
  predictionRunId: string;
  publicDecisionId: string;
  publishedDate: string;
};

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function marketLineFromLabel(label: string): number | null {
  const match = label.match(/(?:over|under|\s)([+-]?\d+(?:\.\d+)?)\s*$/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

export function buildPublicPickKey(input: Pick<PublicPickDraft, "fixtureId" | "market" | "selection" | "modelVersion" | "publishedDate">): string {
  return [input.fixtureId, input.market, input.selection, input.modelVersion, input.publishedDate].join("|");
}

export function dedupePublicPickDrafts(drafts: PublicPickDraft[]): PublicPickDraft[] {
  const unique = new Map<string, PublicPickDraft>();
  for (const draft of drafts) {
    const key = buildPublicPickKey(draft);
    const existing = unique.get(key);
    if (!existing || draft.publishedAt > existing.publishedAt) unique.set(key, draft);
  }
  return [...unique.values()];
}

export function isCanonicalPublicPickEligible(decision: CanonicalDecision | undefined, summary: DecisionSummary): decision is CanonicalDecision {
  return Boolean(
    summary.publicStatus === "value_pick" &&
      summary.bestPublishedPick &&
      summary.auditSummary.publicInvariantPassed &&
      decision &&
      !decision.isPreliminary &&
      decision.publicStatus === "value_pick" &&
      finite(decision.valueEdge) && decision.valueEdge > 0 &&
      finite(decision.expectedValue) && decision.expectedValue > 0 &&
      finite(decision.modelProbability) &&
      finite(decision.impliedProbability) &&
      finite(decision.noVigProbability) &&
      finite(decision.decimalOdds) && decision.decimalOdds > 1
  );
}

function databaseRow(draft: PublicPickDraft) {
  return {
    fixture_id: draft.fixtureId,
    fixture_db_id: draft.fixtureDbId,
    prediction_run_id: draft.predictionRunId,
    public_decision_id: draft.publicDecisionId,
    sport: draft.sport,
    league: draft.league,
    country: draft.country,
    home_team: draft.homeTeam,
    away_team: draft.awayTeam,
    kickoff_at: draft.kickoffAt,
    market: draft.market,
    selection: draft.selection,
    selection_label: draft.selectionLabel,
    market_line: draft.marketLine,
    odds: draft.odds,
    model_version: draft.modelVersion,
    engine_version: draft.engineVersion,
    model_probability: draft.modelProbability,
    implied_probability: draft.impliedProbability,
    no_vig_probability: draft.noVigProbability,
    value_edge: draft.valueEdge,
    expected_value: draft.expectedValue,
    data_quality: draft.dataQuality ?? null,
    confidence: draft.confidence,
    risk: draft.risk,
    published_at: draft.publishedAt,
    published_date: draft.publishedDate,
    status: draft.status,
    settlement_status: draft.settlementStatus,
    result: draft.result,
    settlement_reason: draft.settlementReason,
    provider: draft.provider,
    provider_fixture_id: draft.providerFixtureId,
    revision: draft.revision,
    metadata: { publicationPolicy: "canonical-decision-summary", publicInvariantPassed: true },
    updated_at: draft.publishedAt
  };
}

export type PublicPickPublicationResult = {
  attempted: number;
  published: number;
  revised: number;
  stale: number;
  errors: string[];
};

export async function persistCanonicalPublicPicks({
  matches,
  summariesByFixture,
  decisionsByFixture,
  fixtureIds,
  client = getSupabaseServerClient()
}: {
  matches: Match[];
  summariesByFixture: Map<string, DecisionSummary>;
  decisionsByFixture: Map<string, CanonicalDecision[]>;
  fixtureIds: Map<string, string>;
  client?: SupabaseClient | null;
}): Promise<PublicPickPublicationResult> {
  const result: PublicPickPublicationResult = { attempted: 0, published: 0, revised: 0, stale: 0, errors: [] };
  if (!client || !matches.length) return result;

  const fixtureDbIds = [...fixtureIds.values()];
  const [{ data: summaryRows, error: summaryError }, { data: existingRows, error: existingError }] = await Promise.all([
    fixtureDbIds.length
      ? client.from("op_fixture_decision_summaries").select("id,fixture_id,fixture_external_id").in("fixture_id", fixtureDbIds).is("superseded_by", null)
      : Promise.resolve({ data: [], error: null }),
    client.from("op_public_picks")
      .select("id,fixture_id,market,selection,model_version,published_date,revision,status,settlement_status")
      .in("fixture_id", matches.map((match) => match.id))
  ]);
  if (summaryError || existingError) {
    result.errors.push(summaryError?.message ?? existingError?.message ?? "Public pick prerequisite read failed.");
    return result;
  }

  const summaryIdByFixture = new Map((summaryRows ?? []).map((row) => [String(row.fixture_external_id), String(row.id)]));
  const existingByKey = new Map((existingRows ?? []).map((row) => [
    [row.fixture_id, row.market, row.selection, row.model_version, row.published_date].join("|"),
    row as Record<string, unknown>
  ]));
  const drafts: PublicPickDraft[] = [];
  for (const match of matches) {
    const summary = summariesByFixture.get(match.id);
    const published = summary?.bestPublishedPick;
    if (!summary || !published || match.dataSource?.kind !== "provider") continue;
    const decision = (decisionsByFixture.get(match.id) ?? []).find(
      (row) => row.market === published.marketId && row.selection === published.selectionId
    );
    const fixtureDbId = fixtureIds.get(match.id);
    const publicDecisionId = summaryIdByFixture.get(match.id);
    if (!fixtureDbId || !publicDecisionId || !isCanonicalPublicPickEligible(decision, summary)) continue;
    const publishedDate = summary.generatedAt.slice(0, 10);
    const key = [match.id, decision.market, decision.selection, decision.modelVersion, publishedDate].join("|");
    const existing = existingByKey.get(key);
    drafts.push({
      fixtureId: match.id,
      fixtureDbId,
      predictionRunId: decision.decisionId,
      publicDecisionId,
      sport: match.sport,
      league: match.league.name,
      country: match.league.country || null,
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      kickoffAt: match.kickoffTime,
      market: decision.market,
      selection: decision.selection,
      selectionLabel: decision.label,
      marketLine: marketLineFromLabel(decision.label),
      odds: published.odds,
      modelVersion: decision.modelVersion,
      engineVersion: decision.engineVersion,
      modelProbability: published.modelProbability,
      impliedProbability: published.rawImpliedProbability,
      noVigProbability: published.noVigImpliedProbability,
      valueEdge: published.edge,
      expectedValue: published.expectedValue,
      dataQuality: summary.dataQuality,
      confidence: decision.confidence,
      risk: decision.risk,
      publishedAt: summary.generatedAt,
      publishedDate,
      status: "published",
      settlementStatus: new Date(match.kickoffTime).getTime() > Date.now() ? "waiting_kickoff" : "awaiting_final_score",
      result: "pending",
      settlementReason: new Date(match.kickoffTime).getTime() > Date.now() ? "Waiting for kickoff." : "Waiting for provider final score.",
      provider: match.dataSource.fixtureProvider ?? "unknown",
      providerFixtureId: match.dataSource.fixtureProviderId ?? match.id,
      revision: Number(existing?.revision ?? 0) + 1
    });
  }

  const uniqueDrafts = dedupePublicPickDrafts(drafts);
  result.attempted = uniqueDrafts.length;
  const currentKeys = new Set(uniqueDrafts.map(buildPublicPickKey));
  const staleIds = (existingRows ?? []).filter((row) =>
    !["settled", "void"].includes(String(row.settlement_status)) &&
    !currentKeys.has([row.fixture_id, row.market, row.selection, row.model_version, row.published_date].join("|"))
  ).map((row) => String(row.id));
  if (staleIds.length) {
    const { error } = await client.from("op_public_picks").update({ status: "stale", updated_at: new Date().toISOString() }).in("id", staleIds);
    if (error) result.errors.push(`Stale public pick update failed: ${error.message}`);
    else result.stale = staleIds.length;
  }

  if (!uniqueDrafts.length) return result;
  const { data: stored, error } = await client
    .from("op_public_picks")
    .upsert(uniqueDrafts.map(databaseRow), {
      onConflict: "fixture_id,market,selection,model_version,published_date",
      ignoreDuplicates: false
    })
    .select("id,fixture_id,market,selection,model_version,published_date,revision,public_decision_id");
  if (error) {
    result.errors.push(`Public pick persistence failed: ${error.message}`);
    return result;
  }

  result.published = (stored ?? []).length;
  result.revised = (stored ?? []).filter((row) => Number(row.revision) > 1).length;
  for (const row of stored ?? []) {
    const { error: linkError } = await client.from("op_market_decisions").update({
      internal_only: false,
      public_decision_id: row.public_decision_id,
      updated_at: new Date().toISOString()
    }).eq("id", uniqueDrafts.find((draft) => buildPublicPickKey(draft) === [row.fixture_id, row.market, row.selection, row.model_version, row.published_date].join("|"))?.predictionRunId ?? "");
    if (linkError) result.errors.push(`Prediction run publication link failed: ${linkError.message}`);
  }
  return result;
}
