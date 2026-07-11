import type { Sport } from "@/lib/sports/types";

export type TrainingFeatureSport = Extract<Sport, "football" | "basketball" | "tennis">;
export type TrainingFeatureQualityStatus = "complete" | "partial" | "proxy" | "invalid";

export type TrainingFeatureRequirement = Readonly<{
  key: string;
  paths: readonly string[];
}>;

export type TrainingFeatureQuality = Readonly<{
  status: TrainingFeatureQualityStatus;
  score: number;
  completeForTraining: boolean;
  providerBacked: boolean;
  providerIdentity: boolean;
  providerStrength: boolean;
  marketEvidence: boolean;
  proxyFree: boolean;
  missingCoreFeatures: readonly string[];
  evidenceSources: readonly string[];
}>;

const COMMON_REQUIREMENTS: readonly TrainingFeatureRequirement[] = [
  { key: "home team identity", paths: ["homeTeam.externalId", "homeTeam.id", "homeTeam.name"] },
  { key: "away team identity", paths: ["awayTeam.externalId", "awayTeam.id", "awayTeam.name"] },
  { key: "league identity", paths: ["league.externalId", "league.id", "league.name"] }
];

const SPORT_REQUIREMENTS: Record<TrainingFeatureSport, readonly TrainingFeatureRequirement[]> = {
  football: [
    { key: "home attack strength", paths: ["homeFeatures.attackStrength"] },
    { key: "home defense strength", paths: ["homeFeatures.defenseStrength"] },
    { key: "home recent form", paths: ["homeFeatures.recentFormPoints"] },
    { key: "away attack strength", paths: ["awayFeatures.attackStrength"] },
    { key: "away defense strength", paths: ["awayFeatures.defenseStrength"] },
    { key: "away recent form", paths: ["awayFeatures.recentFormPoints"] }
  ],
  basketball: [
    { key: "home Elo", paths: ["homeFeatures.eloRating", "homeFeatures.rawRating"] },
    { key: "home pace", paths: ["homeFeatures.pace", "homeFeatures.metadata.pace"] },
    { key: "home offensive efficiency", paths: ["homeFeatures.offensiveEfficiency", "homeFeatures.metadata.offensiveEfficiency"] },
    { key: "home defensive efficiency", paths: ["homeFeatures.defensiveEfficiency", "homeFeatures.metadata.defensiveEfficiency"] },
    { key: "home rest", paths: ["homeFeatures.restDays"] },
    { key: "home recent form", paths: ["homeFeatures.recentFormPoints"] },
    { key: "away Elo", paths: ["awayFeatures.eloRating", "awayFeatures.rawRating"] },
    { key: "away pace", paths: ["awayFeatures.pace", "awayFeatures.metadata.pace"] },
    { key: "away offensive efficiency", paths: ["awayFeatures.offensiveEfficiency", "awayFeatures.metadata.offensiveEfficiency"] },
    { key: "away defensive efficiency", paths: ["awayFeatures.defensiveEfficiency", "awayFeatures.metadata.defensiveEfficiency"] },
    { key: "away rest", paths: ["awayFeatures.restDays"] },
    { key: "away recent form", paths: ["awayFeatures.recentFormPoints"] }
  ],
  tennis: [
    { key: "home Elo", paths: ["homeFeatures.eloRating", "homeFeatures.rawRating"] },
    { key: "home surface strength", paths: ["homeFeatures.attackStrength"] },
    { key: "home defense strength", paths: ["homeFeatures.defenseStrength"] },
    { key: "home rest", paths: ["homeFeatures.restDays"] },
    { key: "home recent form", paths: ["homeFeatures.recentFormPoints"] },
    { key: "away Elo", paths: ["awayFeatures.eloRating", "awayFeatures.rawRating"] },
    { key: "away surface strength", paths: ["awayFeatures.attackStrength"] },
    { key: "away defense strength", paths: ["awayFeatures.defenseStrength"] },
    { key: "away rest", paths: ["awayFeatures.restDays"] },
    { key: "away recent form", paths: ["awayFeatures.recentFormPoints"] },
    {
      key: "court surface",
      paths: [
        "homeFeatures.surface",
        "homeFeatures.metadata.surface",
        "awayFeatures.surface",
        "awayFeatures.metadata.surface",
        "league.metadata.surface",
        "league.metadata.court"
      ]
    }
  ]
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function valueAtPath(value: unknown, path: string): unknown {
  let current = value;
  for (const part of path.split(".")) {
    if (!isRecord(current)) return undefined;
    current = current[part];
  }
  return current;
}

function hasValue(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "boolean") return true;
  return false;
}

function sourceText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function isProxySource(value: string): boolean {
  return /(^|[^a-z0-9])(demo|mock|synthetic|proxy|baseline|fallback|fake|test|seed)(?=$|[^a-z0-9])/i.test(value);
}

function completeMarketEvidence(features: Record<string, unknown>, sport: TrainingFeatureSport): boolean {
  const outcomes = sport === "football" ? ["home", "draw", "away"] : ["home", "away"];
  return ["odds", "marketProbabilities", "modelProbabilities"].every((group) => {
    const row = valueAtPath(features, group);
    return isRecord(row) && outcomes.every((outcome) => hasValue(row[outcome]));
  });
}

export function trainingFeatureRequirements(sport: TrainingFeatureSport): readonly TrainingFeatureRequirement[] {
  return [...COMMON_REQUIREMENTS, ...SPORT_REQUIREMENTS[sport]];
}

export function strictTrainingFeatureJsonColumns(sport: TrainingFeatureSport): readonly string[] {
  if (sport === "football") {
    return [
      "features->homeFeatures->>attackStrength",
      "features->homeFeatures->>defenseStrength",
      "features->homeFeatures->>recentFormPoints",
      "features->awayFeatures->>attackStrength",
      "features->awayFeatures->>defenseStrength",
      "features->awayFeatures->>recentFormPoints"
    ];
  }
  if (sport === "basketball") {
    return [
      "features->homeFeatures->>eloRating",
      "features->homeFeatures->>restDays",
      "features->homeFeatures->>recentFormPoints",
      "features->homeFeatures->metadata->>pace",
      "features->homeFeatures->metadata->>offensiveEfficiency",
      "features->homeFeatures->metadata->>defensiveEfficiency",
      "features->awayFeatures->>eloRating",
      "features->awayFeatures->>restDays",
      "features->awayFeatures->>recentFormPoints",
      "features->awayFeatures->metadata->>pace",
      "features->awayFeatures->metadata->>offensiveEfficiency",
      "features->awayFeatures->metadata->>defensiveEfficiency"
    ];
  }
  return [
    "features->homeFeatures->>eloRating",
    "features->homeFeatures->>attackStrength",
    "features->homeFeatures->>defenseStrength",
    "features->homeFeatures->>restDays",
    "features->homeFeatures->>recentFormPoints",
    "features->homeFeatures->metadata->>surface",
    "features->awayFeatures->>eloRating",
    "features->awayFeatures->>attackStrength",
    "features->awayFeatures->>defenseStrength",
    "features->awayFeatures->>restDays",
    "features->awayFeatures->>recentFormPoints",
    "features->awayFeatures->metadata->>surface"
  ];
}

export function assessTrainingFeatureQuality({
  sport,
  source,
  split,
  features
}: {
  sport: TrainingFeatureSport;
  source: string;
  split: string;
  features: unknown;
}): TrainingFeatureQuality {
  if (!isRecord(features)) {
    return {
      status: "invalid",
      score: 0,
      completeForTraining: false,
      providerBacked: false,
      providerIdentity: false,
      providerStrength: false,
      marketEvidence: false,
      proxyFree: false,
      missingCoreFeatures: trainingFeatureRequirements(sport).map((requirement) => requirement.key),
      evidenceSources: unique([source])
    };
  }

  const dataSource = isRecord(features.dataSource) ? features.dataSource : {};
  const homeEvidence = isRecord(valueAtPath(features, "homeTeam.ratingEvidence"))
    ? (valueAtPath(features, "homeTeam.ratingEvidence") as Record<string, unknown>)
    : {};
  const awayEvidence = isRecord(valueAtPath(features, "awayTeam.ratingEvidence"))
    ? (valueAtPath(features, "awayTeam.ratingEvidence") as Record<string, unknown>)
    : {};
  const evidenceSources = unique([
    source,
    sourceText(dataSource.fixtureProvider),
    sourceText(dataSource.oddsProvider),
    sourceText(dataSource.formProvider),
    sourceText(dataSource.strengthProvider),
    sourceText(homeEvidence.source),
    sourceText(awayEvidence.source)
  ]);
  const live = split === "live";
  const providerBacked = live ? dataSource.kind === "provider" : !isProxySource(source);
  const providerIdentity = live
    ? Boolean(
        sourceText(dataSource.fixtureProvider) &&
          (sourceText(dataSource.fixtureProviderId) || sourceText(dataSource.oddsProviderEventId))
      )
    : providerBacked;
  const providerStrength = live
    ? Boolean(
        sourceText(homeEvidence.source) &&
          sourceText(awayEvidence.source) &&
          !isProxySource(sourceText(homeEvidence.source)) &&
          !isProxySource(sourceText(awayEvidence.source))
      )
    : providerBacked;
  const marketEvidence = live ? completeMarketEvidence(features, sport) : true;
  const proxyFree = providerBacked && evidenceSources.every((item) => !isProxySource(item));
  const missingCoreFeatures = trainingFeatureRequirements(sport)
    .filter((requirement) => !requirement.paths.some((path) => hasValue(valueAtPath(features, path))))
    .map((requirement) => requirement.key);
  if (live && !providerIdentity) missingCoreFeatures.push("provider fixture identity");
  if (live && !providerStrength) missingCoreFeatures.push("provider-backed strength provenance");
  if (live && !marketEvidence) missingCoreFeatures.push("complete bookmaker/model market evidence");

  const status: TrainingFeatureQualityStatus = !proxyFree
    ? "proxy"
    : missingCoreFeatures.length
      ? "partial"
      : "complete";
  const requirementCount = trainingFeatureRequirements(sport).length + (live ? 3 : 0);
  const passed = Math.max(0, requirementCount - missingCoreFeatures.length);
  const score = status === "proxy" ? 0 : Math.round((passed / Math.max(1, requirementCount)) * 100);

  return {
    status,
    score,
    completeForTraining: status === "complete",
    providerBacked,
    providerIdentity,
    providerStrength,
    marketEvidence,
    proxyFree,
    missingCoreFeatures: unique(missingCoreFeatures),
    evidenceSources
  };
}
