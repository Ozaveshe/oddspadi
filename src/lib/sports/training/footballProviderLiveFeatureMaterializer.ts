import { calculateBookmakerMargin, decimalOddsToImpliedProbability, removeBookmakerMargin } from "@/lib/sports/prediction/odds";
import { modelFootballMatch } from "@/lib/sports/prediction/footballModel";
import { EPL_2026_OPENING_WINDOW, type DecisionEpl2026OpeningFixture } from "@/lib/sports/prediction/decisionEpl2026Fixtures";
import type { Match } from "@/lib/sports/types";
import { FOOTBALL_PROVIDER_RETEST_MODEL_KEY, type FootballDataProviderRetestFeatureRow } from "@/lib/sports/training/footballDataProviderRetestBridge";

type Outcome = "home" | "draw" | "away";

export type FootballProviderLiveFeatureMaterializerStatus = "preview-ready" | "partial-evidence" | "no-fixtures" | "blocked-no-odds";

export type FootballProviderLiveFeatureMaterializerReceipt = {
  mode: "football-provider-live-feature-materializer";
  generatedAt: string;
  status: FootballProviderLiveFeatureMaterializerStatus;
  materializerHash: string;
  summary: string;
  provider: string;
  request: {
    dryRun: true;
    targetDate: string;
    sourceFixtures: number;
    targetTable: "op_training_feature_snapshots";
    modelKey: typeof FOOTBALL_PROVIDER_RETEST_MODEL_KEY;
    split: "live";
  };
  corpus: {
    fixtures: number;
    rowsPreviewed: number;
    rejectedFixtures: number;
    withCompleteOdds: number;
    providerBackedFixtures: number;
    mockSeedFixtures: number;
    withContextSignals: number;
    withLiveScores: number;
  };
  previewRows: FootballDataProviderRetestFeatureRow[];
  rejectedFixtures: Array<{
    fixtureExternalId: string;
    reason: string;
  }>;
  controls: {
    canInspectReadOnly: true;
    canPreviewLiveFeatureRows: boolean;
    canWriteFeatureSnapshots: false;
    canFeedProviderRetestRunner: false;
    canTrainModels: false;
    canApplyThresholds: false;
    canPublishPicks: false;
    canStake: false;
  };
  nextAction: {
    label: string;
    verifyUrl: string;
    expectedEvidence: string;
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

function round(value: number | null | undefined, digits = 6): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const OPENING_TEAM_ALIASES_BY_NORMALIZED_NAME: Record<string, string[]> = {
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

function normalizedOpeningTeam(value: string): string {
  return value.toLowerCase().replace(/\b(fc|cf|afc|sc|ac|and)\b/g, "").replace(/[^a-z0-9]+/g, "");
}

function openingTeamAliasSet(value: string): Set<string> {
  const normalized = normalizedOpeningTeam(value);
  return new Set([normalized, ...(OPENING_TEAM_ALIASES_BY_NORMALIZED_NAME[normalized] ?? [])].filter(Boolean));
}

function openingTeamNamesMatch(a: string, b: string): boolean {
  const left = openingTeamAliasSet(a);
  const right = openingTeamAliasSet(b);
  return Array.from(left).some((alias) => right.has(alias));
}

function openingFixtureForMatch(match: Match): DecisionEpl2026OpeningFixture | null {
  const date = match.kickoffTime.slice(0, 10);
  return (
    EPL_2026_OPENING_WINDOW.find(
      (fixture) => fixture.date === date && openingTeamNamesMatch(fixture.home, match.homeTeam.name) && openingTeamNamesMatch(fixture.away, match.awayTeam.name)
    ) ?? null
  );
}

function liveTrainingFixtureExternalId(match: Match, openingFixture: DecisionEpl2026OpeningFixture | null): string {
  return openingFixture?.id ?? match.id;
}

function liveTrainingSource(provider: string, openingFixture: DecisionEpl2026OpeningFixture | null): string {
  return openingFixture ? "epl-2026-opening-live-provider" : provider;
}

function matchWinnerOdds(match: Match): {
  odds: Record<Outcome, number>;
  probabilities: Record<Outcome, number>;
  margin: number;
} | null {
  const market = match.oddsMarkets.find((item) => item.id === "match_winner");
  const selections = (["home", "draw", "away"] as const).map((selection) => market?.selections.find((item) => item.id === selection && item.decimalOdds > 1));
  if (selections.some((selection) => !selection)) return null;
  const odds = {
    home: selections[0]!.decimalOdds,
    draw: selections[1]!.decimalOdds,
    away: selections[2]!.decimalOdds
  };
  const raw = [odds.home, odds.draw, odds.away].map(decimalOddsToImpliedProbability);
  const noVig = removeBookmakerMargin(raw);
  return {
    odds,
    probabilities: {
      home: round(noVig[0]) ?? 0,
      draw: round(noVig[1]) ?? 0,
      away: round(noVig[2]) ?? 0
    },
    margin: round(calculateBookmakerMargin(raw)) ?? 0
  };
}

function modelProbabilities(match: Match): Record<Outcome, number> {
  const market = modelFootballMatch(match).markets.find((item) => item.marketId === "match_winner");
  return {
    home: round(market?.probabilities.home) ?? 0,
    draw: round(market?.probabilities.draw) ?? 0,
    away: round(market?.probabilities.away) ?? 0
  };
}

function recentFormPoints(results: Array<"W" | "D" | "L">): number {
  return results.reduce((sum, result) => sum + (result === "W" ? 3 : result === "D" ? 1 : 0), 0);
}

function contextCount(match: Match, categories: string[]): number {
  return (match.providerContextSignals ?? []).filter((signal) => categories.includes(signal.category)).length;
}

function evidenceFlags(match: Match) {
  const odds = Boolean(matchWinnerOdds(match));
  const providerBacked = match.dataSource?.kind === "provider";
  return {
    fixtureIdentity: Boolean(match.id && match.homeTeam.id && match.awayTeam.id && match.kickoffTime),
    marketOdds: odds,
    teamStrength: Boolean(match.homeForm && match.awayForm),
    availabilityContext: contextCount(match, ["injury", "suspension", "lineup"]) > 0,
    newsWeatherContext: contextCount(match, ["news", "weather"]) > 0,
    liveAndSettlement: match.status === "live" && Boolean(match.score),
    featureSnapshot: true,
    rawPayloadLinked: providerBacked
  };
}

function rowForMatch(provider: string, match: Match, generatedAt: string): FootballDataProviderRetestFeatureRow | null {
  const market = matchWinnerOdds(match);
  if (!market) return null;
  const openingFixture = openingFixtureForMatch(match);
  const fixtureExternalId = liveTrainingFixtureExternalId(match, openingFixture);
  const source = liveTrainingSource(provider, openingFixture);
  const featurePayload = {
    providerFixtureExternalId: match.id,
    canonicalFixtureExternalId: openingFixture?.id ?? null,
    kickoffAt: match.kickoffTime,
    status: match.status,
    league: {
      externalId: match.league.id,
      name: match.league.name,
      country: match.league.country,
      strength: match.league.strength
    },
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeFeatures: {
      eloRating: match.homeTeam.rating,
      attackStrength: match.homeForm.attackStrength,
      defenseStrength: match.homeForm.defenseStrength,
      recentFormPoints: recentFormPoints(match.homeForm.recentResults),
      recentGoalsFor: match.homeForm.goalsFor,
      recentGoalsAgainst: match.homeForm.goalsAgainst,
      xgFor: match.homeForm.xgFor ?? null,
      xgAgainst: match.homeForm.xgAgainst ?? null
    },
    awayFeatures: {
      eloRating: match.awayTeam.rating,
      attackStrength: match.awayForm.attackStrength,
      defenseStrength: match.awayForm.defenseStrength,
      recentFormPoints: recentFormPoints(match.awayForm.recentResults),
      recentGoalsFor: match.awayForm.goalsFor,
      recentGoalsAgainst: match.awayForm.goalsAgainst,
      xgFor: match.awayForm.xgFor ?? null,
      xgAgainst: match.awayForm.xgAgainst ?? null
    },
    modelProbabilities: modelProbabilities(match),
    marketProbabilities: market.probabilities,
    odds: market.odds,
    closingOdds: {},
    bookmakerMargin: market.margin,
    evidence: evidenceFlags(match),
    contextCounts: {
      availability: contextCount(match, ["injury", "suspension"]),
      lineups: contextCount(match, ["lineup"]),
      news: contextCount(match, ["news"]),
      weather: contextCount(match, ["weather"]),
      liveEvents: contextCount(match, ["live-event"])
    },
    dataSource: match.dataSource ?? null,
    providerContextSignals: match.providerContextSignals ?? []
  };
  return {
    id: stableHash([source, fixtureExternalId, "live", featurePayload]),
    fixture_external_id: fixtureExternalId,
    sport: "football",
    model_key: FOOTBALL_PROVIDER_RETEST_MODEL_KEY,
    generated_at: generatedAt,
    label: null,
    features: featurePayload,
    targets: {
      actualOutcome: null,
      settlementStatus: "pending",
      currentScore: match.score ?? null
    },
    split: "live",
    source,
    feature_hash: stableHash(featurePayload),
    created_at: generatedAt
  };
}

function rejectionFor(match: Match): string | null {
  if (!matchWinnerOdds(match)) return "missing complete match_winner odds";
  return null;
}

function statusFor(matches: Match[], rows: FootballDataProviderRetestFeatureRow[], rejected: FootballProviderLiveFeatureMaterializerReceipt["rejectedFixtures"]): FootballProviderLiveFeatureMaterializerStatus {
  if (!matches.length) return "no-fixtures";
  if (matches.every((match) => !matchWinnerOdds(match))) return "blocked-no-odds";
  if (rejected.length) return "partial-evidence";
  return rows.length ? "preview-ready" : "partial-evidence";
}

function summaryFor(status: FootballProviderLiveFeatureMaterializerStatus, rows: number): string {
  if (status === "preview-ready") return `Previewed ${rows} live provider feature row(s); rows remain watchlist-only until stored and settled.`;
  if (status === "partial-evidence") return `Previewed ${rows} live row(s), but some fixtures lack complete match_winner odds.`;
  if (status === "blocked-no-odds") return "Live provider feature materializer is blocked because fixtures lack complete match_winner odds.";
  return "Live provider feature materializer has no fixtures to preview.";
}

export function buildFootballProviderLiveFeatureMaterializer({
  provider = "provider",
  matches,
  targetDate,
  now = new Date()
}: {
  provider?: string;
  matches: Match[];
  targetDate: string;
  now?: Date;
}): FootballProviderLiveFeatureMaterializerReceipt {
  const generatedAt = now.toISOString();
  const footballMatches = matches.filter((match) => match.sport === "football");
  const previewRows = footballMatches.flatMap((match) => {
    const row = rowForMatch(provider, match, generatedAt);
    return row ? [row] : [];
  });
  const rejectedFixtures = footballMatches.flatMap((match) => {
    const reason = rejectionFor(match);
    return reason ? [{ fixtureExternalId: match.id, reason }] : [];
  });
  const status = statusFor(footballMatches, previewRows, rejectedFixtures);
  const corpus = {
    fixtures: footballMatches.length,
    rowsPreviewed: previewRows.length,
    rejectedFixtures: rejectedFixtures.length,
    withCompleteOdds: footballMatches.filter((match) => Boolean(matchWinnerOdds(match))).length,
    providerBackedFixtures: footballMatches.filter((match) => match.dataSource?.kind === "provider").length,
    mockSeedFixtures: footballMatches.filter((match) => match.dataSource?.kind !== "provider").length,
    withContextSignals: footballMatches.filter((match) => (match.providerContextSignals?.length ?? 0) > 0).length,
    withLiveScores: footballMatches.filter((match) => match.status === "live" && Boolean(match.score)).length
  };

  return {
    mode: "football-provider-live-feature-materializer",
    generatedAt,
    status,
    materializerHash: stableHash({
      status,
      provider,
      targetDate,
      corpus,
      previewRows: previewRows.map((row) => [row.fixture_external_id, row.feature_hash, row.split]),
      rejectedFixtures
    }),
    summary: summaryFor(status, previewRows.length),
    provider,
    request: {
      dryRun: true,
      targetDate,
      sourceFixtures: footballMatches.length,
      targetTable: "op_training_feature_snapshots",
      modelKey: FOOTBALL_PROVIDER_RETEST_MODEL_KEY,
      split: "live"
    },
    corpus,
    previewRows,
    rejectedFixtures,
    controls: {
      canInspectReadOnly: true,
      canPreviewLiveFeatureRows: previewRows.length > 0,
      canWriteFeatureSnapshots: false,
      canFeedProviderRetestRunner: false,
      canTrainModels: false,
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: {
      label: previewRows.length ? "Review live feature preview" : "Collect fixture odds",
      verifyUrl: "/api/sports/decision/training/football-provider-live-feature-materializer",
      expectedEvidence:
        "Upcoming or live football fixtures produce split=live feature rows with model probabilities, no-vig market probabilities, odds, evidence flags, and pending settlement targets."
    },
    locks: [
      "Live feature materializer is a dry-run preview and cannot write op_training_feature_snapshots.",
      "Live rows cannot feed provider retest runner until outcomes are settled and labels exist.",
      "Upcoming EPL rows can support watchlist reasoning only; they cannot train models, apply thresholds, publish picks, or stake.",
      "Provider-backed raw payload links are required before live rows can become production evidence."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-provider-live-feature-materializer",
      "/api/sports/decision/training/football-provider-feature-intake-gap",
      "/api/sports/decision/training/football-provider-feature-storage-receipt",
      "/api/sports/decision/training/football-data-provider-learning-activation",
      "/api/sports/decision/epl-fixture-intake"
    ]
  };
}
