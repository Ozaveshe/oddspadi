import type { Prediction, Sport } from "@/lib/sports/types";
import {
  calculateBookmakerMargin,
  decimalOddsToImpliedProbability,
  removeBookmakerMargin
} from "@/lib/sports/prediction/odds";
import { trainingModelKey } from "@/lib/sports/training/trainingRepository";
import type { FootballDataProviderRetestFeatureRow } from "@/lib/sports/training/footballDataProviderRetestBridge";
import { assessTrainingFeatureQuality, type TrainingFeatureQuality } from "@/lib/sports/training/featureQuality";

export type LiveTrainingSport = Extract<Sport, "basketball" | "tennis">;
export type MultiSportLiveMatchPredictionRow = {
  match: Prediction extends never ? never : import("@/lib/sports/types").Match;
  prediction: Prediction;
};
type TwoWayOutcome = "home" | "away";

export type MultiSportLiveFeatureMaterializerStatus = "preview-ready" | "partial-evidence" | "blocked-no-odds" | "no-fixtures";

export type MultiSportLiveFeatureMaterializerReceipt = {
  mode: "multi-sport-live-feature-materializer";
  generatedAt: string;
  status: MultiSportLiveFeatureMaterializerStatus;
  materializerHash: string;
  summary: string;
  provider: string;
  request: {
    dryRun: true;
    targetDate: string;
    sport: LiveTrainingSport;
    sourceFixtures: number;
    targetTable: "op_training_feature_snapshots";
    modelKey: string;
    split: "live";
  };
  corpus: {
    fixtures: number;
    rowsPreviewed: number;
    rejectedFixtures: number;
    withCompleteMoneyline: number;
    providerBackedFixtures: number;
    mockSeedFixtures: number;
    withContextSignals: number;
    withSecondaryMarkets: number;
    completeCoreFeatures: number;
    partialCoreFeatures: number;
    proxyFeatureRows: number;
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
    canFeedBacktestRunner: false;
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

function contextCount(row: MultiSportLiveMatchPredictionRow, categories: string[]): number {
  return (row.match.providerContextSignals ?? []).filter((signal) => categories.includes(signal.category)).length;
}

function twoWayMarket(row: MultiSportLiveMatchPredictionRow): {
  odds: Record<TwoWayOutcome, number>;
  probabilities: Record<TwoWayOutcome, number>;
  margin: number;
} | null {
  const oddsMarket = row.match.oddsMarkets.find((market) => market.id === "match_winner");
  const modelMarket = row.prediction.markets.find((market) => market.marketId === "match_winner");
  const home = oddsMarket?.selections.find((selection) => selection.id === "home" && selection.decimalOdds > 1);
  const away = oddsMarket?.selections.find((selection) => selection.id === "away" && selection.decimalOdds > 1);
  if (!home || !away || typeof modelMarket?.probabilities.home !== "number" || typeof modelMarket.probabilities.away !== "number") return null;

  const raw = [home.decimalOdds, away.decimalOdds].map(decimalOddsToImpliedProbability);
  const noVig = removeBookmakerMargin(raw);
  return {
    odds: {
      home: home.decimalOdds,
      away: away.decimalOdds
    },
    probabilities: {
      home: round(noVig[0]) ?? 0,
      away: round(noVig[1]) ?? 0
    },
    margin: round(calculateBookmakerMargin(raw)) ?? 0
  };
}

function modelProbabilities(row: MultiSportLiveMatchPredictionRow): Record<TwoWayOutcome, number> {
  const market = row.prediction.markets.find((item) => item.marketId === "match_winner");
  return {
    home: round(market?.probabilities.home) ?? 0,
    away: round(market?.probabilities.away) ?? 0
  };
}

function secondaryMarkets(row: MultiSportLiveMatchPredictionRow): Record<string, Record<string, number>> {
  const ids = row.match.sport === "basketball" ? ["spread", "total_points"] : ["set_handicap", "total_games"];
  return Object.fromEntries(
    row.prediction.markets
      .filter((market) => ids.includes(market.marketId))
      .map((market) => [
        market.marketId,
        Object.fromEntries(Object.entries(market.probabilities).map(([key, value]) => [key, round(value) ?? 0]))
      ])
  );
}

function recentFormPoints(row: MultiSportLiveMatchPredictionRow, side: "home" | "away"): number {
  const evidence = side === "home" ? row.match.homeTeam.ratingEvidence : row.match.awayTeam.ratingEvidence;
  if (typeof evidence?.recentFormPoints === "number" && Number.isFinite(evidence.recentFormPoints)) return evidence.recentFormPoints;
  const form = side === "home" ? row.match.homeForm : row.match.awayForm;
  return form.recentResults.reduce((sum, result) => sum + (result === "W" ? 3 : result === "D" ? 1 : 0), 0);
}

function sideFeatures(row: MultiSportLiveMatchPredictionRow, side: "home" | "away") {
  const team = side === "home" ? row.match.homeTeam : row.match.awayTeam;
  const form = side === "home" ? row.match.homeForm : row.match.awayForm;
  const evidence = team.ratingEvidence;
  return {
    rating: team.rating,
    eloRating: evidence?.rawRating ?? null,
    attackStrength: evidence?.attackStrength ?? form.attackStrength,
    defenseStrength: evidence?.defenseStrength ?? form.defenseStrength,
    pace: evidence?.pace ?? null,
    offensiveEfficiency: evidence?.offensiveEfficiency ?? null,
    defensiveEfficiency: evidence?.defensiveEfficiency ?? null,
    restDays: evidence?.restDays ?? null,
    recentFormPoints: recentFormPoints(row, side),
    recentScored: form.goalsFor,
    recentAllowed: form.goalsAgainst,
    surface: evidence?.surface ?? null,
    rank: evidence?.rank ?? null,
    rankingPoints: evidence?.rankingPoints ?? null,
    metadata: {
      source: evidence?.source ?? null,
      asOf: evidence?.asOf ?? null,
      sampleSize: evidence?.sampleSize ?? 0,
      pace: evidence?.pace ?? null,
      offensiveEfficiency: evidence?.offensiveEfficiency ?? null,
      defensiveEfficiency: evidence?.defensiveEfficiency ?? null,
      surface: evidence?.surface ?? null
    }
  };
}

function evidenceFlags(row: MultiSportLiveMatchPredictionRow) {
  const providerBacked = row.match.dataSource?.kind === "provider";
  return {
    fixtureIdentity: Boolean(row.match.id && row.match.homeTeam.id && row.match.awayTeam.id && row.match.kickoffTime),
    marketOdds: Boolean(twoWayMarket(row)),
    teamStrength: Boolean(row.match.homeForm && row.match.awayForm),
    availabilityContext: contextCount(row, ["injury", "suspension", "lineup", "rest"]) > 0,
    newsWeatherContext: contextCount(row, ["news", "weather", "surface"]) > 0,
    liveAndSettlement: row.match.status === "live" && Boolean(row.match.score),
    featureSnapshot: true,
    rawPayloadLinked: providerBacked
  };
}

function rowForPrediction(provider: string, row: MultiSportLiveMatchPredictionRow, generatedAt: string): FootballDataProviderRetestFeatureRow | null {
  if (row.match.sport !== "basketball" && row.match.sport !== "tennis") return null;
  const moneyline = twoWayMarket(row);
  if (!moneyline) return null;
  const sport = row.match.sport;
  const coreFeaturePayload = {
    kickoffAt: row.match.kickoffTime,
    status: row.match.status,
    league: {
      externalId: row.match.league.id,
      name: row.match.league.name,
      country: row.match.league.country,
      strength: row.match.league.strength
    },
    homeTeam: row.match.homeTeam,
    awayTeam: row.match.awayTeam,
    homeFeatures: sideFeatures(row, "home"),
    awayFeatures: sideFeatures(row, "away"),
    modelProbabilities: modelProbabilities(row),
    marketProbabilities: moneyline.probabilities,
    odds: moneyline.odds,
    secondaryModelProbabilities: secondaryMarkets(row),
    bookmakerMargin: moneyline.margin,
    bestPick: row.prediction.bestPick,
    valueEdges: row.prediction.valueEdges,
    contextAdjustment: row.prediction.contextAdjustment,
    marketPriorAdjustment: row.prediction.marketPriorAdjustment,
    diagnostics: {
      modelVersion: row.prediction.diagnostics.modelVersion,
      expectedScoreLabel: row.prediction.diagnostics.expectedScoreLabel,
      topOutcomeLabel: row.prediction.diagnostics.topOutcomeLabel,
      expectedScore: row.prediction.diagnostics.expectedGoals,
      uncertainty: row.prediction.diagnostics.uncertainty
    },
    contextCounts: {
      availability: contextCount(row, ["injury", "suspension", "rest"]),
      lineups: contextCount(row, ["lineup"]),
      news: contextCount(row, ["news"]),
      weather: contextCount(row, ["weather"]),
      surface: contextCount(row, ["surface"]),
      liveEvents: contextCount(row, ["live-event"])
    },
    dataSource: row.match.dataSource ?? null,
    providerContextSignals: row.match.providerContextSignals ?? []
  };
  const featureQuality = assessTrainingFeatureQuality({
    sport,
    source: provider,
    split: "live",
    features: coreFeaturePayload
  });
  const featurePayload = {
    ...coreFeaturePayload,
    evidence: {
      ...evidenceFlags(row),
      providerIdentity: featureQuality.providerIdentity,
      providerStrength: featureQuality.providerStrength,
      coreFeatureComplete: featureQuality.completeForTraining,
      proxyFree: featureQuality.proxyFree
    },
    featureQuality
  };

  return {
    id: stableHash([provider, row.match.id, sport, "live", featurePayload]),
    fixture_external_id: row.match.id,
    sport,
    model_key: trainingModelKey(sport),
    generated_at: generatedAt,
    label: null,
    features: featurePayload,
    targets: {
      actualOutcome: null,
      settlementStatus: "pending",
      currentScore: row.match.score ?? null
    },
    split: "live",
    source: provider,
    feature_hash: stableHash(featurePayload),
    created_at: generatedAt
  };
}

function qualityFromFeatureRow(row: FootballDataProviderRetestFeatureRow | undefined): TrainingFeatureQuality | null {
  if (!row || !row.features || typeof row.features !== "object" || Array.isArray(row.features)) return null;
  const quality = (row.features as Record<string, unknown>).featureQuality;
  return quality && typeof quality === "object" && !Array.isArray(quality) ? (quality as TrainingFeatureQuality) : null;
}

function rejectionFor(row: MultiSportLiveMatchPredictionRow, featureRow: FootballDataProviderRetestFeatureRow | undefined): string | null {
  if (!twoWayMarket(row)) return "missing complete match_winner moneyline odds";
  const quality = qualityFromFeatureRow(featureRow);
  if (!quality) return "missing feature-quality evidence";
  if (quality.status === "proxy") return `proxy or baseline evidence: ${quality.evidenceSources.join(", ") || "unknown source"}`;
  if (quality.status !== "complete") return `incomplete model inputs: ${quality.missingCoreFeatures.join(", ")}`;
  return null;
}

function statusFor(rows: MultiSportLiveMatchPredictionRow[], previewRows: FootballDataProviderRetestFeatureRow[], rejected: MultiSportLiveFeatureMaterializerReceipt["rejectedFixtures"]): MultiSportLiveFeatureMaterializerStatus {
  if (!rows.length) return "no-fixtures";
  if (rows.every((row) => !twoWayMarket(row))) return "blocked-no-odds";
  if (rejected.length) return "partial-evidence";
  return previewRows.length ? "preview-ready" : "partial-evidence";
}

function summaryFor(status: MultiSportLiveFeatureMaterializerStatus, sport: LiveTrainingSport, rows: number): string {
  if (status === "preview-ready") return `Previewed ${rows} ${sport} live feature row(s); rows remain monitor-only until stored, settled, and backtested.`;
  if (status === "partial-evidence") return `Previewed ${rows} ${sport} live feature row(s), but some fixtures lack complete two-way moneyline odds.`;
  if (status === "blocked-no-odds") return `${sport} live feature materializer is blocked because fixtures lack complete match_winner odds.`;
  return `${sport} live feature materializer has no fixtures to preview.`;
}

export function buildMultiSportLiveFeatureMaterializer({
  provider = "provider",
  sport,
  rows,
  targetDate,
  now = new Date()
}: {
  provider?: string;
  sport: LiveTrainingSport;
  rows: MultiSportLiveMatchPredictionRow[];
  targetDate: string;
  now?: Date;
}): MultiSportLiveFeatureMaterializerReceipt {
  const generatedAt = now.toISOString();
  const sportRows = rows.filter((row) => row.match.sport === sport);
  const previewRows = sportRows.flatMap((row) => {
    const featureRow = rowForPrediction(provider, row, generatedAt);
    return featureRow ? [featureRow] : [];
  });
  const previewByFixture = new Map(previewRows.map((row) => [row.fixture_external_id, row]));
  const rejectedFixtures = sportRows.flatMap((row) => {
    const reason = rejectionFor(row, previewByFixture.get(row.match.id));
    return reason ? [{ fixtureExternalId: row.match.id, reason }] : [];
  });
  const status = statusFor(sportRows, previewRows, rejectedFixtures);
  const corpus = {
    fixtures: sportRows.length,
    rowsPreviewed: previewRows.length,
    rejectedFixtures: rejectedFixtures.length,
    withCompleteMoneyline: sportRows.filter((row) => Boolean(twoWayMarket(row))).length,
    providerBackedFixtures: sportRows.filter((row) => row.match.dataSource?.kind === "provider").length,
    mockSeedFixtures: sportRows.filter((row) => row.match.dataSource?.kind !== "provider").length,
    withContextSignals: sportRows.filter((row) => (row.match.providerContextSignals?.length ?? 0) > 0).length,
    withSecondaryMarkets: sportRows.filter((row) => Object.keys(secondaryMarkets(row)).length > 0).length,
    completeCoreFeatures: previewRows.filter((row) => qualityFromFeatureRow(row)?.status === "complete").length,
    partialCoreFeatures: previewRows.filter((row) => qualityFromFeatureRow(row)?.status === "partial").length,
    proxyFeatureRows: previewRows.filter((row) => qualityFromFeatureRow(row)?.status === "proxy").length
  };

  return {
    mode: "multi-sport-live-feature-materializer",
    generatedAt,
    status,
    materializerHash: stableHash({
      status,
      provider,
      sport,
      targetDate,
      corpus,
      previewRows: previewRows.map((row) => [row.fixture_external_id, row.model_key, row.feature_hash, row.split]),
      rejectedFixtures
    }),
    summary: summaryFor(status, sport, previewRows.length),
    provider,
    request: {
      dryRun: true,
      targetDate,
      sport,
      sourceFixtures: sportRows.length,
      targetTable: "op_training_feature_snapshots",
      modelKey: trainingModelKey(sport),
      split: "live"
    },
    corpus,
    previewRows,
    rejectedFixtures,
    controls: {
      canInspectReadOnly: true,
      canPreviewLiveFeatureRows: previewRows.length > 0,
      canWriteFeatureSnapshots: false,
      canFeedBacktestRunner: false,
      canTrainModels: false,
      canApplyThresholds: false,
      canPublishPicks: false,
      canStake: false
    },
    nextAction: {
      label: previewRows.length ? "Review multi-sport live feature preview" : "Collect two-way odds",
      verifyUrl: `/api/sports/decision/training/multi-sport-live-feature-materializer?sport=${sport}&date=${targetDate}`,
      expectedEvidence:
        "Basketball and tennis live rows include model probabilities, no-vig market probabilities, odds, secondary market probabilities, evidence flags, pending targets, and provider provenance."
    },
    locks: [
      "Multi-sport live feature materializer is a dry-run preview and cannot write op_training_feature_snapshots.",
      "Live rows cannot feed backtest runners until outcomes are settled and labels exist.",
      "Mock rows can support UI and math rehearsal only; provider-backed raw payload links are required before production storage.",
      "Training, learned thresholds, public picks, and staking remain locked."
    ],
    proofUrls: [
      "/api/sports/decision/training/multi-sport-live-feature-materializer",
      "/api/sports/decision/training/multi-sport-corpus-plan",
      "/api/sports/decision/training/provider-readiness",
      "/api/sports/decision/training/corpus-proof",
      "/api/sports/decision/supabase-proof-binder"
    ]
  };
}
