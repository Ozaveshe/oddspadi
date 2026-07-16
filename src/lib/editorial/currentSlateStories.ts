import type { EditorialOutcome } from "./generatedStories";

export type StoredEditorialFixture = {
  external_id: string;
  sport: string;
  league_name: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  kickoff_at: string;
  last_synced_at: string | null;
};

export type StoredEditorialDecisionSummary = {
  fixture_external_id: string;
  generated_at: string;
  expires_at: string | null;
  best_published_pick: unknown;
  best_lean: unknown;
  best_watchlist_candidate: unknown;
  all_market_analyses: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finite(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function strongestAnalysis(summary: StoredEditorialDecisionSummary): Record<string, unknown> | null {
  for (const value of [summary.best_published_pick, summary.best_lean, summary.best_watchlist_candidate]) {
    const candidate = record(value);
    if (Object.keys(candidate).length) return candidate;
  }
  const analyses = Array.isArray(summary.all_market_analyses) ? summary.all_market_analyses.map(record) : [];
  return analyses
    .filter((candidate) => finite(candidate.modelProbability) !== null && finite(candidate.odds) !== null)
    .sort((left, right) => (finite(right.edge) ?? Number.NEGATIVE_INFINITY) - (finite(left.edge) ?? Number.NEGATIVE_INFINITY))[0] ?? null;
}

/** Convert the current stored slate into factual editorial inputs. The mapper
 * refuses expired analyses and never creates a probability or price. */
export function buildStoredSlateEditorialOutcomes(
  fixtures: StoredEditorialFixture[],
  summaries: StoredEditorialDecisionSummary[],
  now = new Date()
): EditorialOutcome[] {
  const latestSummary = new Map<string, StoredEditorialDecisionSummary>();
  for (const summary of summaries.slice().sort((left, right) => Date.parse(right.generated_at) - Date.parse(left.generated_at))) {
    if (!latestSummary.has(summary.fixture_external_id)) latestSummary.set(summary.fixture_external_id, summary);
  }

  return fixtures.flatMap((fixture) => {
    const kickoff = Date.parse(fixture.kickoff_at);
    if (!Number.isFinite(kickoff) || kickoff < now.getTime()) return [];
    const summary = latestSummary.get(fixture.external_id);
    if (!summary) return [];
    const candidate = strongestAnalysis(summary);
    if (!candidate) return [];
    const expiry = text(candidate.expiresAt) ?? summary.expires_at;
    if (expiry && Date.parse(expiry) <= now.getTime()) return [];
    const market = text(candidate.marketId);
    const selection = text(candidate.selectionId);
    const label = text(candidate.label);
    const modelProbability = finite(candidate.modelProbability);
    const valueEdge = finite(candidate.edge);
    const odds = finite(candidate.odds);
    if (!market || !selection || !label || modelProbability === null || valueEdge === null || odds === null || odds <= 1) return [];
    return [{
      id: `stored-slate:${fixture.external_id}:${summary.generated_at}:${market}:${selection}`,
      fixture_external_id: fixture.external_id,
      sport: fixture.sport,
      league: fixture.league_name,
      home_team: fixture.home_team_name,
      away_team: fixture.away_team_name,
      kickoff_at: fixture.kickoff_at,
      market,
      selection,
      recommended_selection: label,
      model_probability: modelProbability,
      value_edge: valueEdge,
      odds,
      result: "pending",
      settled_at: null,
      created_at: summary.generated_at
    } satisfies EditorialOutcome];
  }).sort((left, right) => Date.parse(left.kickoff_at ?? "") - Date.parse(right.kickoff_at ?? ""));
}

export function mergeEditorialOutcomes(publicRows: EditorialOutcome[], storedRows: EditorialOutcome[]): EditorialOutcome[] {
  const publicPendingFixtures = new Set(publicRows.filter((row) => row.result === "pending").map((row) => row.fixture_external_id));
  return [...publicRows, ...storedRows.filter((row) => !publicPendingFixtures.has(row.fixture_external_id))];
}
