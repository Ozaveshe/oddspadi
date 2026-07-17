import type { EditorialOutcome, GeneratedEditorialStory } from "./generatedStories";

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

function fixtureFingerprint(fixtures: StoredEditorialFixture[]): string {
  let hash = 2166136261;
  const evidence = fixtures.map((fixture) => [
    fixture.external_id,
    fixture.kickoff_at,
    fixture.last_synced_at ?? "",
    fixture.league_name ?? "",
    fixture.home_team_name ?? "",
    fixture.away_team_name ?? ""
  ].join(":"));
  for (const char of evidence.join("|")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `fixture-desk-fnv1a-${(hash >>> 0).toString(16)}`;
}

/** Build a factual daily desk when fixtures are fresh but no current model
 * decision is publishable. No probability, price, or selection is inferred. */
export function generateFreshFixtureDeskStory(
  fixtures: StoredEditorialFixture[],
  now = new Date(),
  revision = 1
): GeneratedEditorialStory | null {
  const maxFixtureAgeMs = 6 * 60 * 60_000;
  const horizonMs = now.getTime() + 7 * 86_400_000;
  const seen = new Set<string>();
  const fresh = fixtures.filter((fixture) => {
    const kickoff = Date.parse(fixture.kickoff_at);
    const syncedAt = Date.parse(fixture.last_synced_at ?? "");
    if (
      seen.has(fixture.external_id)
      || !Number.isFinite(kickoff)
      || kickoff < now.getTime()
      || kickoff >= horizonMs
      || !Number.isFinite(syncedAt)
      || now.getTime() - syncedAt > maxFixtureAgeMs
      || syncedAt > now.getTime() + 5 * 60_000
    ) return false;
    seen.add(fixture.external_id);
    return true;
  }).sort((left, right) => Date.parse(left.kickoff_at) - Date.parse(right.kickoff_at)).slice(0, 8);
  if (!fresh.length) return null;

  const date = now.toISOString().slice(0, 10);
  const matchName = (fixture: StoredEditorialFixture) => fixture.home_team_name && fixture.away_team_name
    ? `${fixture.home_team_name} vs ${fixture.away_team_name}`
    : fixture.external_id;
  return {
    slug: `daily-slate-${date}`,
    generator: "daily-slate",
    title: `Matchday fixture desk: ${fresh.length} upcoming ${fresh.length === 1 ? "fixture" : "fixtures"}`,
    excerpt: `${fresh.length} fresh provider-synced fixtures are on the board while current model decisions remain withheld.`,
    category: "Daily preview",
    sport: "All sports",
    body: [
      `This daily desk was generated from fresh provider-synced fixture records available at ${now.toISOString()}. No model probability, price or selection has been invented.`,
      ...fresh.map((fixture) => `${matchName(fixture)} — scheduled ${new Date(fixture.kickoff_at).toISOString()}.${fixture.league_name ? ` Competition: ${fixture.league_name}.` : " The competition label is unavailable."}`),
      "OddsPadi has no current publishable decision summary for these fixtures. Public action remains withheld until the model, market and evidence gates complete."
    ],
    sources: [
      { label: "OddsPadi weekly fixture radar", url: "/predictions/week", checkedAt: date },
      { label: "OddsPadi live scores", url: "/live-scores", checkedAt: date }
    ],
    revision,
    sourceAsOf: now.toISOString(),
    publishedAt: now.toISOString(),
    readMinutes: 2,
    dataFingerprint: fixtureFingerprint(fresh)
  };
}
