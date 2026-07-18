import type { SupabaseClient } from "@supabase/supabase-js";
import { buildConsensusResearchReceipt, type ConsensusDistribution, type ConsensusSide } from "@/lib/community/consensusResearch";
import { isMissingDatabaseRelation } from "@/lib/security/databaseError";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;

export type ConsensusResearchBackfillRun = {
  status: "completed" | "partial" | "empty" | "unavailable" | "not_enabled";
  generatedAt: string;
  totals: { pollsRead: number; eligible: number; inserted: number; skipped: number; failed: number };
  errors: string[];
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function number(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function providerBacked(value: unknown): boolean {
  const provider = text(value)?.toLowerCase();
  return Boolean(provider && !["manual", "mock", "demo", "preview", "seed"].some((marker) => provider.includes(marker)));
}

function modelDistribution(summary: Row, sport: string): ConsensusDistribution | null {
  const analyses = Array.isArray(summary.all_market_analyses) ? summary.all_market_analyses as Row[] : [];
  const winnerRows = analyses.filter((row) => text(row.marketId ?? row.market_id) === "match_winner");
  const probability = (side: ConsensusSide) => number(winnerRows.find((row) => text(row.selectionId ?? row.selection_id) === side)?.modelProbability ?? winnerRows.find((row) => text(row.selectionId ?? row.selection_id) === side)?.model_probability);
  const home = probability("home");
  const away = probability("away");
  const draw = probability("draw");
  if (home === null || away === null || (sport === "football" && draw === null)) return null;
  return { home, ...(sport === "football" ? { draw: draw ?? 0 } : {}), away };
}

function settledOutcome(fixture: Row, sport: string): ConsensusSide | null {
  const home = number(fixture.home_score);
  const away = number(fixture.away_score);
  if (text(fixture.status) !== "finished" || home === null || away === null) return null;
  if (home > away) return "home";
  if (away > home) return "away";
  return sport === "football" ? "draw" : null;
}

export async function runConsensusResearchBackfill({
  now = new Date(),
  limit = 250,
  persist = true,
  client = getSupabaseServerClient()
}: {
  now?: Date;
  limit?: number;
  persist?: boolean;
  client?: SupabaseClient | null;
} = {}): Promise<ConsensusResearchBackfillRun> {
  const generatedAt = now.toISOString();
  const totals = { pollsRead: 0, eligible: 0, inserted: 0, skipped: 0, failed: 0 };
  if (!client) return { status: "unavailable", generatedAt, totals, errors: ["OddsPadi Supabase server storage is not configured."] };
  const safeLimit = Math.max(1, Math.min(1000, Math.trunc(limit)));
  const { data: pollData, error: pollError } = await client.from("op_match_polls")
    .select("id,fixture_id,sport,status,home_votes,draw_votes,away_votes")
    .eq("status", "closed")
    .order("kickoff_at", { ascending: true })
    .limit(safeLimit);
  if (pollError && isMissingDatabaseRelation(pollError)) return { status: "not_enabled", generatedAt, totals, errors: [] };
  if (pollError) return { status: "unavailable", generatedAt, totals, errors: [pollError.message] };
  const polls = (pollData ?? []) as Row[];
  totals.pollsRead = polls.length;
  if (!polls.length) return { status: "empty", generatedAt, totals, errors: [] };

  const pollIds = polls.map((row) => String(row.id));
  const fixtureIds = [...new Set(polls.map((row) => String(row.fixture_id)))];
  const [existingRead, fixtureRead, summaryRead] = await Promise.all([
    client.from("op_community_consensus_research_receipts").select("poll_id").in("poll_id", pollIds),
    client.from("op_fixtures").select("id,external_id,provider,status,home_score,away_score,last_synced_at").in("external_id", fixtureIds).order("last_synced_at", { ascending: false }),
    client.from("op_fixture_decision_summaries").select("id,fixture_external_id,sport,all_market_analyses,generated_at").in("fixture_external_id", fixtureIds).is("superseded_by", null).order("generated_at", { ascending: false })
  ]);
  const readError = existingRead.error ?? fixtureRead.error ?? summaryRead.error;
  if (readError && isMissingDatabaseRelation(readError)) return { status: "not_enabled", generatedAt, totals, errors: [] };
  if (readError) return { status: "unavailable", generatedAt, totals, errors: [readError.message] };

  const existing = new Set(((existingRead.data ?? []) as Row[]).map((row) => String(row.poll_id)));
  const fixtures = new Map<string, Row>();
  for (const row of (fixtureRead.data ?? []) as Row[]) if (!fixtures.has(String(row.external_id))) fixtures.set(String(row.external_id), row);
  const summaries = new Map<string, Row>();
  for (const row of (summaryRead.data ?? []) as Row[]) if (!summaries.has(String(row.fixture_external_id))) summaries.set(String(row.fixture_external_id), row);

  const receipts: Row[] = [];
  for (const poll of polls) {
    if (existing.has(String(poll.id))) { totals.skipped += 1; continue; }
    const sport = String(poll.sport);
    const fixture = fixtures.get(String(poll.fixture_id));
    const summary = summaries.get(String(poll.fixture_id));
    const outcome = fixture ? settledOutcome(fixture, sport) : null;
    const model = summary ? modelDistribution(summary, sport) : null;
    if (!fixture || !summary || !outcome || !model || !providerBacked(fixture.provider)) { totals.skipped += 1; continue; }
    const receipt = buildConsensusResearchReceipt({
      model,
      votes: { home: number(poll.home_votes) ?? 0, ...(sport === "football" ? { draw: number(poll.draw_votes) ?? 0 } : {}), away: number(poll.away_votes) ?? 0 },
      outcome
    });
    if (receipt.status !== "research_ready" || !receipt.crowd || !receipt.brier || receipt.totalVariation === null) { totals.skipped += 1; continue; }
    totals.eligible += 1;
    receipts.push({
      poll_id: poll.id,
      fixture_db_id: fixture.id,
      decision_summary_id: summary.id,
      sport,
      vote_count: receipt.voteCount,
      model_distribution: receipt.model,
      crowd_distribution: receipt.crowd,
      outcome,
      model_brier: receipt.brier.model,
      crowd_brier: receipt.brier.crowd,
      total_variation: receipt.totalVariation,
      better_forecast: receipt.brier.better,
      controls: receipt.controls,
      generated_at: generatedAt
    });
  }

  const errors: string[] = [];
  if (persist && receipts.length) {
    const { data: inserted, error } = await client.from("op_community_consensus_research_receipts")
      .upsert(receipts, { onConflict: "poll_id", ignoreDuplicates: true })
      .select("id");
    if (error) {
      totals.failed = receipts.length;
      errors.push(error.message);
    } else totals.inserted = inserted?.length ?? 0;
  } else if (!persist) totals.inserted = receipts.length;
  const status: ConsensusResearchBackfillRun["status"] = errors.length ? "partial" : receipts.length || totals.skipped ? "completed" : "empty";
  return { status, generatedAt, totals, errors };
}
