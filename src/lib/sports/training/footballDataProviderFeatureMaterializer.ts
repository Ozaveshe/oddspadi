import { buildScoreMatrix, probabilityFromScoreMatrix } from "@/lib/sports/prediction/poisson";
import { deriveFootballChronologyFeatures } from "@/lib/sports/training/footballChronologyFeatures";
import { resolveHistoricalFootballOdds } from "@/lib/sports/training/historicalFootballOdds";
import type { HistoricalFootballFixtureInput } from "@/lib/sports/training/historicalIngestion";
import { FOOTBALL_PROVIDER_RETEST_MODEL_KEY, type FootballDataProviderRetestFeatureRow } from "@/lib/sports/training/footballDataProviderRetestBridge";
import type { FootballProviderCorpusSource } from "@/lib/sports/training/footballProviderFeatureCorpusRepository";

type Outcome = "home" | "draw" | "away";

export type FootballProviderFeatureMaterializerStatus =
  | "preview-ready"
  | "partial-evidence"
  | "no-fixtures"
  | "blocked-no-odds"
  | "blocked-no-outcomes";

export type FootballProviderFeatureMaterializerReceipt = {
  mode: "football-provider-feature-materializer";
  generatedAt: string;
  status: FootballProviderFeatureMaterializerStatus;
  materializerHash: string;
  summary: string;
  provider: string;
  source: FootballProviderCorpusSource | {
    kind: "in-memory";
    provider: string;
    rawPayloadLinkedFixtures: number;
  };
  request: {
    dryRun: true;
    sourceFixtures: number;
    targetTable: "op_training_feature_snapshots";
    modelKey: typeof FOOTBALL_PROVIDER_RETEST_MODEL_KEY;
  };
  corpus: {
    fixtures: number;
    rowsPreviewed: number;
    rejectedFixtures: number;
    withCompleteOdds: number;
    withClosingOdds: number;
    withOutcomes: number;
    withAvailability: number;
    withLineups: number;
    withNews: number;
    withWeather: number;
    withChronologyFeatures: number;
    chronologyWarmupFixtures: number;
    withCrossSeasonHistory: number;
  };
  previewRows: FootballDataProviderRetestFeatureRow[];
  rejectedFixtures: Array<{
    fixtureExternalId: string;
    reason: string;
  }>;
  controls: {
    canInspectReadOnly: true;
    canPreviewFeatureRows: boolean;
    canWriteFeatureSnapshots: false;
    canPersistBacktestMemory: false;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function actualOutcome(fixture: HistoricalFootballFixtureInput): Outcome | null {
  if (fixture.status !== "finished") return null;
  if (typeof fixture.homeScore !== "number" || typeof fixture.awayScore !== "number") return null;
  if (fixture.homeScore > fixture.awayScore) return "home";
  if (fixture.homeScore < fixture.awayScore) return "away";
  return "draw";
}

function providerFetchSucceeded(fixture: HistoricalFootballFixtureInput, key: "events" | "availability"): boolean {
  const evidence = fixture.metadata?.providerFetchEvidence;
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return false;
  const receipt = (evidence as Record<string, unknown>)[key];
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) return false;
  const fields = receipt as Record<string, unknown>;
  return fields.attempted === true && fields.succeeded === true;
}

function chronologyPriorMatches(
  fixture: HistoricalFootballFixtureInput,
  side: "home" | "away"
): number | null {
  const features = side === "home" ? fixture.homeFeatures : fixture.awayFeatures;
  const chronology = features?.metadata?.chronology;
  if (!chronology || typeof chronology !== "object" || Array.isArray(chronology)) return null;
  const priorMatches = (chronology as Record<string, unknown>).priorMatches;
  return typeof priorMatches === "number" && Number.isFinite(priorMatches) ? priorMatches : null;
}

function chronologyCrossSeasonHistory(
  fixture: HistoricalFootballFixtureInput,
  side: "home" | "away"
): boolean {
  const features = side === "home" ? fixture.homeFeatures : fixture.awayFeatures;
  const chronology = features?.metadata?.chronology;
  return Boolean(
    chronology &&
      typeof chronology === "object" &&
      !Array.isArray(chronology) &&
      (chronology as Record<string, unknown>).crossSeasonHistory === true
  );
}

function completeOdds(
  fixture: HistoricalFootballFixtureInput,
  closing: boolean
): {
  odds: Record<Outcome, number>;
  probabilities: Record<Outcome, number>;
  margin: number;
} | null {
  const resolution = resolveHistoricalFootballOdds(fixture.odds ?? [], { kickoffAt: fixture.kickoffAt });
  const snapshot = closing ? resolution.closingSnapshot : resolution.decisionSnapshot;
  if (!snapshot) return null;
  return {
    odds: snapshot.odds,
    probabilities: {
      home: round(snapshot.noVigProbabilities.home) ?? 0,
      draw: round(snapshot.noVigProbabilities.draw) ?? 0,
      away: round(snapshot.noVigProbabilities.away) ?? 0
    },
    margin: round(snapshot.bookmakerMargin) ?? 0
  };
}

function latestMarketOdds(fixture: HistoricalFootballFixtureInput) {
  return completeOdds(fixture, false);
}

function modelProbabilities(fixture: HistoricalFootballFixtureInput): Record<Outcome, number> {
  const home = fixture.homeFeatures ?? {};
  const away = fixture.awayFeatures ?? {};
  const homeAttack = finite(home.attackStrength, 1);
  const awayAttack = finite(away.attackStrength, 1);
  const homeDefense = finite(home.defenseStrength, 1);
  const awayDefense = finite(away.defenseStrength, 1);
  const homeElo = finite(home.eloRating, 1500);
  const awayElo = finite(away.eloRating, 1500);
  const homeForm = finite(home.recentFormPoints, 7.5) / 15;
  const awayForm = finite(away.recentFormPoints, 7.5) / 15;
  const homeAbsence = finite(home.injuriesCount, 0) + finite(home.suspensionsCount, 0);
  const awayAbsence = finite(away.injuriesCount, 0) + finite(away.suspensionsCount, 0);
  const weatherDrag = Math.abs((fixture.weather ?? []).reduce((sum, item) => sum + Math.min(0, finite(item.impactScore, 0)), 0));
  const newsEdge = (fixture.news ?? []).reduce((sum, item) => sum + finite(item.impactScore, 0), 0);
  const ratingEdge = (homeElo - awayElo) / 400;
  const formEdge = homeForm - awayForm;
  const absenceEdge = (awayAbsence - homeAbsence) * 0.025;
  const homeAdvantage = fixture.neutralVenue ? 0 : 0.24;
  const homeExpected = clamp(1.18 + homeAdvantage + ratingEdge * 0.65 + formEdge * 0.28 + (homeAttack - awayDefense) * 0.22 + absenceEdge + newsEdge * 0.08 - weatherDrag * 0.08, 0.25, 3.8);
  const awayExpected = clamp(1.05 - ratingEdge * 0.55 - formEdge * 0.22 + (awayAttack - homeDefense) * 0.2 - absenceEdge * 0.7 - newsEdge * 0.05 - weatherDrag * 0.07, 0.2, 3.5);
  const matrix = buildScoreMatrix(homeExpected, awayExpected);
  const homeWin = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals > cell.awayGoals);
  const draw = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals === cell.awayGoals);
  const awayWin = probabilityFromScoreMatrix(matrix, (cell) => cell.homeGoals < cell.awayGoals);
  const total = homeWin + draw + awayWin || 1;
  return {
    home: round(homeWin / total) ?? 0,
    draw: round(draw / total) ?? 0,
    away: round(awayWin / total) ?? 0
  };
}

function evidenceFlags(fixture: HistoricalFootballFixtureInput) {
  const hasOdds = Boolean(latestMarketOdds(fixture));
  return {
    fixtureIdentity: Boolean(fixture.externalId && fixture.homeTeam?.externalId && fixture.awayTeam?.externalId && fixture.kickoffAt),
    marketOdds: hasOdds,
    teamStrength: Boolean(fixture.homeFeatures || fixture.awayFeatures || fixture.standings?.length),
    availabilityContext: Boolean(
      (fixture.availability?.length ?? 0) > 0 ||
      (fixture.homeFeatures?.injuriesCount ?? 0) > 0 ||
      (fixture.awayFeatures?.injuriesCount ?? 0) > 0 ||
      providerFetchSucceeded(fixture, "availability")
    ),
    newsWeatherContext: Boolean((fixture.news?.length ?? 0) > 0 || (fixture.weather?.length ?? 0) > 0),
    liveAndSettlement: Boolean(
      actualOutcome(fixture) && ((fixture.events?.length ?? 0) > 0 || providerFetchSucceeded(fixture, "events"))
    ),
    featureSnapshot: true,
    rawPayloadLinked: Boolean(fixture.metadata?.rawPayloadId || fixture.metadata?.ingestionRunId || fixture.metadata?.payloadHash)
  };
}

function splitFor(fixture: HistoricalFootballFixtureInput): "train" | "validation" | "test" | "live" {
  if (fixture.status !== "finished") return "live";
  const hash = stableHash(fixture.externalId);
  const bucket = parseInt(hash.slice(-2), 16) % 10;
  if (bucket >= 8) return "test";
  if (bucket >= 6) return "validation";
  return "train";
}

function rowForFixture(provider: string, fixture: HistoricalFootballFixtureInput, generatedAt: string): FootballDataProviderRetestFeatureRow | null {
  const outcome = actualOutcome(fixture);
  const market = latestMarketOdds(fixture);
  if (!outcome || !market) return null;
  const closing = completeOdds(fixture, true);
  const featurePayload = {
    kickoffAt: fixture.kickoffAt,
    league: fixture.league,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    homeFeatures: fixture.homeFeatures ?? null,
    awayFeatures: fixture.awayFeatures ?? null,
    modelProbabilities: modelProbabilities(fixture),
    marketProbabilities: market.probabilities,
    odds: market.odds,
    closingOdds: closing?.odds ?? {},
    bookmakerMargin: market.margin,
    evidence: evidenceFlags(fixture),
    contextCounts: {
      standings: fixture.standings?.length ?? 0,
      availability: fixture.availability?.length ?? 0,
      lineups: fixture.lineups?.length ?? 0,
      news: fixture.news?.length ?? 0,
      weather: fixture.weather?.length ?? 0,
      events: fixture.events?.length ?? 0
    }
  };
  return {
    id: stableHash([provider, fixture.externalId, featurePayload]),
    fixture_external_id: fixture.externalId,
    sport: "football",
    model_key: FOOTBALL_PROVIDER_RETEST_MODEL_KEY,
    generated_at: generatedAt,
    label: outcome,
    features: featurePayload,
    targets: {
      actualOutcome: outcome,
      homeScore: fixture.homeScore ?? null,
      awayScore: fixture.awayScore ?? null,
      homeXg: fixture.homeXg ?? null,
      awayXg: fixture.awayXg ?? null
    },
    split: splitFor(fixture),
    source: provider,
    feature_hash: stableHash(featurePayload),
    created_at: generatedAt
  };
}

function rejectionFor(fixture: HistoricalFootballFixtureInput): string | null {
  if (!actualOutcome(fixture)) return "missing finished outcome";
  if (!latestMarketOdds(fixture)) return "missing complete match_winner odds";
  return null;
}

function statusFor(fixtures: HistoricalFootballFixtureInput[], rows: FootballDataProviderRetestFeatureRow[], rejected: FootballProviderFeatureMaterializerReceipt["rejectedFixtures"]): FootballProviderFeatureMaterializerStatus {
  if (!fixtures.length) return "no-fixtures";
  if (fixtures.every((fixture) => !latestMarketOdds(fixture))) return "blocked-no-odds";
  if (fixtures.every((fixture) => !actualOutcome(fixture))) return "blocked-no-outcomes";
  if (rejected.length) return "partial-evidence";
  return rows.length ? "preview-ready" : "partial-evidence";
}

function summaryFor(status: FootballProviderFeatureMaterializerStatus, rows: number): string {
  if (status === "preview-ready") return `Previewed ${rows} provider-enriched retest feature row(s); storage remains locked.`;
  if (status === "partial-evidence") return `Previewed ${rows} provider-enriched row(s), but some fixtures lack outcomes or complete market odds.`;
  if (status === "blocked-no-odds") return "Provider feature materializer is blocked because fixtures lack complete match_winner odds.";
  if (status === "blocked-no-outcomes") return "Provider feature materializer is blocked because fixtures lack finished outcomes.";
  return "Provider feature materializer has no fixtures to preview.";
}

export function buildFootballProviderFeatureMaterializer({
  provider = "provider",
  fixtures,
  source,
  now = new Date()
}: {
  provider?: string;
  fixtures: HistoricalFootballFixtureInput[];
  source?: FootballProviderFeatureMaterializerReceipt["source"];
  now?: Date;
}): FootballProviderFeatureMaterializerReceipt {
  const generatedAt = now.toISOString();
  const resolvedFixtures = deriveFootballChronologyFeatures(fixtures);
  const previewRows = resolvedFixtures.flatMap((fixture) => {
    const row = rowForFixture(provider, fixture, generatedAt);
    return row ? [row] : [];
  });
  const rejectedFixtures = resolvedFixtures.flatMap((fixture) => {
    const reason = rejectionFor(fixture);
    return reason ? [{ fixtureExternalId: fixture.externalId, reason }] : [];
  });
  const status = statusFor(resolvedFixtures, previewRows, rejectedFixtures);
  const corpus = {
    fixtures: resolvedFixtures.length,
    rowsPreviewed: previewRows.length,
    rejectedFixtures: rejectedFixtures.length,
    withCompleteOdds: resolvedFixtures.filter((fixture) => Boolean(latestMarketOdds(fixture))).length,
    withClosingOdds: resolvedFixtures.filter((fixture) => Boolean(completeOdds(fixture, true))).length,
    withOutcomes: resolvedFixtures.filter((fixture) => Boolean(actualOutcome(fixture))).length,
    withAvailability: resolvedFixtures.filter((fixture) => (fixture.availability?.length ?? 0) > 0).length,
    withLineups: resolvedFixtures.filter((fixture) => (fixture.lineups?.length ?? 0) > 0).length,
    withNews: resolvedFixtures.filter((fixture) => (fixture.news?.length ?? 0) > 0).length,
    withWeather: resolvedFixtures.filter((fixture) => (fixture.weather?.length ?? 0) > 0).length,
    withChronologyFeatures: resolvedFixtures.filter(
      (fixture) => chronologyPriorMatches(fixture, "home") !== null && chronologyPriorMatches(fixture, "away") !== null
    ).length,
    chronologyWarmupFixtures: resolvedFixtures.filter(
      (fixture) => chronologyPriorMatches(fixture, "home") === 0 || chronologyPriorMatches(fixture, "away") === 0
    ).length,
    withCrossSeasonHistory: resolvedFixtures.filter(
      (fixture) => chronologyCrossSeasonHistory(fixture, "home") || chronologyCrossSeasonHistory(fixture, "away")
    ).length
  };
  const resolvedSource = source ?? {
    kind: "in-memory" as const,
    provider,
    rawPayloadLinkedFixtures: resolvedFixtures.filter((fixture) =>
      Boolean(fixture.metadata?.rawPayloadId || fixture.metadata?.ingestionRunId || fixture.metadata?.payloadHash)
    ).length
  };
  return {
    mode: "football-provider-feature-materializer",
    generatedAt,
    status,
    materializerHash: stableHash({
      status,
      provider,
      source: resolvedSource,
      corpus,
      previewRows: previewRows.map((row) => [row.fixture_external_id, row.feature_hash, row.split]),
      rejectedFixtures
    }),
    summary: summaryFor(status, previewRows.length),
    provider,
    source: resolvedSource,
    request: {
      dryRun: true,
      sourceFixtures: fixtures.length,
      targetTable: "op_training_feature_snapshots",
      modelKey: FOOTBALL_PROVIDER_RETEST_MODEL_KEY
    },
    corpus,
    previewRows,
    rejectedFixtures,
    controls: {
      canInspectReadOnly: true,
      canPreviewFeatureRows: previewRows.length > 0,
      canWriteFeatureSnapshots: false,
      canPersistBacktestMemory: false,
      canTrainModels: false,
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: {
      label: previewRows.length ? "Review provider feature preview" : "Collect provider outcomes and odds",
      verifyUrl: "/api/sports/decision/training/football-provider-feature-materializer",
      expectedEvidence:
        "Provider fixtures produce dry-run op_training_feature_snapshots rows with model probabilities, no-vig market probabilities, odds, closing odds, evidence flags, and settlement targets."
    },
    locks: [
      "Provider feature materializer is a dry-run preview and cannot write op_training_feature_snapshots.",
      "Chronology-derived team features use only finished fixtures strictly before each kickoff; simultaneous kickoffs are updated as one leakage-safe group and cross-season state uses bounded rolling history.",
      "Preview rows cannot train models or influence public probabilities until stored rows, retest runner, backtests, calibration, and promotion gates pass.",
      "Fixtures without complete odds or finished outcomes are rejected before they can feed the provider retest bridge.",
      "Public picks and staking remain locked."
    ],
    proofUrls: [
      "/api/sports/decision/training/football-provider-feature-materializer",
      "/api/sports/decision/training/football-data-provider-retest-bridge",
      "/api/sports/decision/training/football-data-provider-retest-runner",
      "/api/sports/decision/training/provider-sync",
      "/api/sports/decision/supabase-schema-manifest"
    ]
  };
}

export function buildDemoFootballProviderFeatureFixture(): HistoricalFootballFixtureInput {
  return {
    externalId: "demo-provider:epl:arsenal-burnley:2025-05-01",
    kickoffAt: "2025-05-01T15:00:00.000Z",
    league: {
      externalId: "api-football:39",
      name: "English Premier League",
      country: "England",
      strength: 0.91
    },
    season: "2025",
    status: "finished",
    homeTeam: {
      externalId: "api-football:42",
      name: "Arsenal"
    },
    awayTeam: {
      externalId: "api-football:44",
      name: "Burnley"
    },
    homeScore: 2,
    awayScore: 0,
    dataQuality: 0.84,
    homeFeatures: {
      eloRating: 1748,
      attackStrength: 1.28,
      defenseStrength: 1.18,
      recentFormPoints: 11,
      injuriesCount: 1,
      suspensionsCount: 0,
      lineupConfirmed: true
    },
    awayFeatures: {
      eloRating: 1450,
      attackStrength: 0.86,
      defenseStrength: 0.82,
      recentFormPoints: 4,
      injuriesCount: 3,
      suspensionsCount: 1,
      lineupConfirmed: true
    },
    odds: [
      { market: "match_winner", selection: "home", decimalOdds: 1.7, bookmaker: "demo-book", observedAt: "2025-05-01T10:00:00.000Z" },
      { market: "match_winner", selection: "draw", decimalOdds: 4.1, bookmaker: "demo-book", observedAt: "2025-05-01T10:00:00.000Z" },
      { market: "match_winner", selection: "away", decimalOdds: 6.2, bookmaker: "demo-book", observedAt: "2025-05-01T10:00:00.000Z" },
      { market: "match_winner", selection: "home", decimalOdds: 1.58, bookmaker: "demo-book", isClosing: true, observedAt: "2025-05-01T14:55:00.000Z" },
      { market: "match_winner", selection: "draw", decimalOdds: 4.2, bookmaker: "demo-book", isClosing: true, observedAt: "2025-05-01T14:55:00.000Z" },
      { market: "match_winner", selection: "away", decimalOdds: 6.6, bookmaker: "demo-book", isClosing: true, observedAt: "2025-05-01T14:55:00.000Z" }
    ],
    availability: [{ teamExternalId: "api-football:44", playerName: "Away Striker", status: "injured", impactScore: -0.18 }],
    lineups: [
      { teamExternalId: "api-football:42", lineupStatus: "confirmed", formation: "4-3-3", players: [{ name: "Home Starter" }] },
      { teamExternalId: "api-football:44", lineupStatus: "confirmed", formation: "4-4-2", players: [{ name: "Away Starter" }] }
    ],
    news: [
      {
        summary: "Away side missing key forward",
        signalType: "injury",
        impactScore: -0.12,
        sourceUrl: "https://example.com/provider-news"
      }
    ],
    weather: [
      {
        observedFor: "2025-05-01T15:00:00.000Z",
        condition: "Clear",
        precipitationMm: 0,
        windKph: 12,
        impactScore: 0
      }
    ],
    events: [
      { eventType: "Goal", eventValue: 1, minute: 24, teamExternalId: "api-football:42" },
      { eventType: "Goal", eventValue: 1, minute: 68, teamExternalId: "api-football:42" }
    ],
    metadata: {
      rawPayloadId: "demo-raw-payload-1",
      ingestionRunId: "demo-ingestion-run-1"
    }
  };
}
