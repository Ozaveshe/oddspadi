import { ODDSPADI_SUPABASE_PROJECT_REF, getSupabaseRuntimeStatus } from "@/lib/supabase/server";
import { hasConfiguredEnv } from "@/lib/env";
import type { Sport } from "@/lib/sports/types";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import { BASKETBALL_BACKTEST_MODEL_KEY } from "./basketballBacktest";
import { buildTenYearFootballCorpusBackfillPlan, type CorpusLeagueTarget } from "./corpusBackfillPlan";
import { FOOTBALL_BACKTEST_MODEL_KEY } from "./footballBacktest";
import { TENNIS_BACKTEST_MODEL_KEY } from "./tennisBacktest";

type EnvMap = Record<string, string | undefined>;

export type TrainingCorpusSport = Extract<Sport, "football" | "basketball" | "tennis">;
export type MultiSportCorpusPlanStatus = "ready" | "waiting" | "blocked";
export type TrainingAdapterStatus = "implemented" | "planned";
export type TrainingBacktestRunnerStatus = "implemented" | "planned";

export type TrainingCorpusTarget = {
  id: string;
  name: string;
  country: string;
  providerLeagueId: string | null;
  oddsSportKey: string;
  typicalMatchesPerSeason: number;
};

export type TrainingCorpusSignal = {
  id: string;
  label: string;
  status: "planned" | "blocked" | "provider-dependent" | "phase-two" | "adapter-missing";
  source: string;
  tables: string[];
};

export type TrainingCorpusCommand = {
  label: string;
  command: string;
  verifyUrl: string | null;
  safeToRun: boolean;
  missingEnv: string[];
  expectedEvidence: string;
};

export type TrainingCorpusSportPlan = {
  sport: TrainingCorpusSport;
  status: MultiSportCorpusPlanStatus;
  adapterStatus: TrainingAdapterStatus;
  backtestRunnerStatus: TrainingBacktestRunnerStatus;
  backtestModelKey: string | null;
  adapter: string;
  seasonFrom: number;
  seasonTo: number;
  seasonCount: number;
  targetCompetitions: TrainingCorpusTarget[];
  estimatedHistoricalMatches: number;
  estimatedOddsSnapshots: number;
  requiredEnvKeys: string[];
  configuredEnvKeys: string[];
  missingEnvKeys: string[];
  modelFeatures: string[];
  signalCoverage: TrainingCorpusSignal[];
  firstDryRunCommand: TrainingCorpusCommand | null;
  blockers: string[];
  warnings: string[];
  nextSteps: string[];
};

export type MultiSportCorpusPlan = {
  id: "multi-sport-10-year-core-v1";
  generatedAt: string;
  status: MultiSportCorpusPlanStatus;
  mode: "multi-sport-corpus-plan";
  dryRun: true;
  seasonFrom: number;
  seasonTo: number;
  seasons: string[];
  sports: TrainingCorpusSportPlan[];
  sportCount: number;
  adapterReadySports: number;
  plannedAdapterSports: number;
  totalEstimatedHistoricalMatches: number;
  totalEstimatedOddsSnapshots: number;
  requiredEnvKeys: string[];
  configuredEnvKeys: string[];
  missingEnvKeys: string[];
  blockers: string[];
  warnings: string[];
  nextSafeCommand: TrainingCorpusCommand;
  supabaseExpectedRef: string;
  proofUrls: string[];
};

export type MultiSportCorpusPlanOptions = {
  env?: EnvMap;
  baseUrl?: string;
  generatedAt?: string;
  seasonFrom?: number;
  seasonTo?: number;
  sports?: TrainingCorpusSport[];
  maxJobsPerLeague?: number;
};

const DEFAULT_SEASON_FROM = 2016;
const DEFAULT_SEASON_TO = 2025;

const BASKETBALL_TARGETS: TrainingCorpusTarget[] = [
  {
    id: "nba",
    name: "NBA",
    country: "United States",
    providerLeagueId: "12",
    oddsSportKey: "basketball_nba",
    typicalMatchesPerSeason: 1230
  },
  {
    id: "euroleague",
    name: "EuroLeague",
    country: "Europe",
    providerLeagueId: null,
    oddsSportKey: "basketball_euroleague",
    typicalMatchesPerSeason: 300
  },
  {
    id: "bal",
    name: "Basketball Africa League",
    country: "Africa",
    providerLeagueId: null,
    oddsSportKey: "basketball_bal",
    typicalMatchesPerSeason: 50
  }
];

const TENNIS_TARGETS: TrainingCorpusTarget[] = [
  {
    id: "atp-hard",
    name: "ATP hard court",
    country: "World",
    providerLeagueId: null,
    oddsSportKey: "tennis_atp",
    typicalMatchesPerSeason: 950
  },
  {
    id: "atp-clay-grass",
    name: "ATP clay and grass",
    country: "World",
    providerLeagueId: null,
    oddsSportKey: "tennis_atp",
    typicalMatchesPerSeason: 700
  },
  {
    id: "wta-main-tour",
    name: "WTA main tour",
    country: "World",
    providerLeagueId: null,
    oddsSportKey: "tennis_wta",
    typicalMatchesPerSeason: 1400
  }
];

function boolEnv(env: EnvMap, key: string): boolean {
  return hasConfiguredEnv(env, key);
}

function configuredFromGroups(env: EnvMap, groups: string[][]): string[] {
  return unique(groups.flatMap((group) => group.filter((key) => boolEnv(env, key))));
}

function missingFromGroups(env: EnvMap, groups: string[][]): string[] {
  return unique(groups.flatMap((group) => (group.some((key) => boolEnv(env, key)) ? [] : group)));
}

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  return Array.from(new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))).slice(0, limit);
}

function seasonsFromRange(from: number, to: number): string[] {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const seasons: string[] = [];
  for (let season = low; season <= high; season += 1) seasons.push(String(season));
  return seasons;
}

function commandBaseUrl(baseUrl: string | undefined): string {
  return baseUrl?.trim().replace(/\/$/, "") || decisionSiteOrigin();
}

function estimateMatches(targets: TrainingCorpusTarget[], seasonCount: number): number {
  return targets.reduce((sum, target) => sum + target.typicalMatchesPerSeason * seasonCount, 0);
}

function estimateOddsSnapshots(targets: TrainingCorpusTarget[], seasonCount: number): number {
  return estimateMatches(targets, seasonCount) * 3;
}

function commonBlockers(env: EnvMap): string[] {
  const runtime = getSupabaseRuntimeStatus(env);
  return [
    runtime.projectRef && runtime.projectRef !== ODDSPADI_SUPABASE_PROJECT_REF ? `Configured project ref is ${runtime.projectRef}.` : "",
    runtime.urlProjectRef && runtime.urlProjectRef !== ODDSPADI_SUPABASE_PROJECT_REF
      ? `Configured Supabase URL points at ${runtime.urlProjectRef}.`
      : ""
  ].filter(Boolean);
}

function statusFor(blockers: string[], missingEnv: string[]): MultiSportCorpusPlanStatus {
  if (blockers.length) return "blocked";
  if (missingEnv.length) return "waiting";
  return "ready";
}

function planCheckCommand(baseUrl: string, sport: TrainingCorpusSport): TrainingCorpusCommand {
  return {
    label: `${sport} corpus plan check`,
    command: `curl.exe -sS "${baseUrl}/api/sports/decision/training/multi-sport-corpus-plan?sport=${sport}"`,
    verifyUrl: `/api/sports/decision/training/multi-sport-corpus-plan?sport=${sport}`,
    safeToRun: true,
    missingEnv: [],
    expectedEvidence: `Returns the ${sport} training corpus contract, adapter status, blockers, model features, and next steps without writing data.`
  };
}

function providerDryRunCommand({
  baseUrl,
  sport,
  missingEnv,
  blockerCount
}: {
  baseUrl: string;
  sport: Extract<TrainingCorpusSport, "basketball" | "tennis">;
  missingEnv: string[];
  blockerCount: number;
}): TrainingCorpusCommand {
  const path =
    sport === "basketball"
      ? "/api/sports/decision/training/backfill?provider=api-basketball&league=12&seasonFrom=2025&seasonTo=2025&maxJobs=1&dryRun=1"
      : "/api/sports/decision/training/backfill?provider=api-tennis&from=2025-01-01&to=2025-01-07&intervalDays=7&maxJobs=1&dryRun=1";
  return {
    label: `${sport} provider dry-run`,
    command: `curl.exe -X POST "${baseUrl}${path}" -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`,
    verifyUrl: path,
    safeToRun: missingEnv.length === 0 && blockerCount === 0,
    missingEnv,
    expectedEvidence: `Dry-run one ${sport} historical provider slice and return normalized fixture, feature, odds, and feature-snapshot counts without writing data.`
  };
}

function mapFootballTargets(targets: CorpusLeagueTarget[]): TrainingCorpusTarget[] {
  return targets.map((target) => ({
    id: target.id,
    name: target.name,
    country: target.country,
    providerLeagueId: target.apiFootballLeagueId,
    oddsSportKey: target.oddsApiSportKey,
    typicalMatchesPerSeason: target.typicalMatchesPerSeason
  }));
}

function footballPlan(options: Required<Pick<MultiSportCorpusPlanOptions, "seasonFrom" | "seasonTo">> & MultiSportCorpusPlanOptions): TrainingCorpusSportPlan {
  const football = buildTenYearFootballCorpusBackfillPlan({
    env: options.env,
    baseUrl: options.baseUrl,
    generatedAt: options.generatedAt,
    seasonFrom: options.seasonFrom,
    seasonTo: options.seasonTo,
    maxJobsPerLeague: options.maxJobsPerLeague
  });
  const targetCompetitions = mapFootballTargets(football.targetLeagues);
  const firstDryRunCommand: TrainingCorpusCommand = {
    label: "Football fixture/context dry-run",
    command: football.firstCommand,
    verifyUrl: "/api/sports/decision/training/backfill",
    safeToRun: football.canRunFirstCommand,
    missingEnv: football.firstCommandMissingEnvKeys,
    expectedEvidence: football.firstCommandPurpose
  };

  return {
    sport: "football",
    status: football.status,
    adapterStatus: "implemented",
    backtestRunnerStatus: "implemented",
    backtestModelKey: FOOTBALL_BACKTEST_MODEL_KEY,
    adapter: "API-Football fixtures/context plus The Odds API historical odds",
    seasonFrom: football.seasonFrom,
    seasonTo: football.seasonTo,
    seasonCount: football.seasonCount,
    targetCompetitions,
    estimatedHistoricalMatches: estimateMatches(targetCompetitions, football.seasonCount),
    estimatedOddsSnapshots: football.estimatedFixtureDerivedOddsJobs,
    requiredEnvKeys: football.requiredEnvKeys,
    configuredEnvKeys: football.configuredEnvKeys,
    missingEnvKeys: football.missingEnvKeys,
    modelFeatures: [
      "Poisson expected goals",
      "Elo/team strength",
      "home advantage",
      "recent form",
      "home/away features",
      "availability and lineup snapshots",
      "market no-vig probability",
      "closing-line value"
    ],
    signalCoverage: football.signalCoverage,
    firstDryRunCommand,
    blockers: football.blockers,
    warnings: football.warnings,
    nextSteps: football.nextSteps
  };
}

function basketballSignals(): TrainingCorpusSignal[] {
  return [
    {
      id: "games-results",
      label: "Games, scores, and historical results",
      status: "planned",
      source: "API-Basketball historical games adapter",
      tables: ["op_fixtures", "op_teams", "op_leagues"]
    },
    {
      id: "efficiency-pace",
      label: "Pace, offensive efficiency, and defensive efficiency",
      status: "provider-dependent",
      source: "API-Basketball games now, box-score and team-rating enrichment next",
      tables: ["op_fixture_team_features", "op_training_feature_snapshots"]
    },
    {
      id: "availability-rest",
      label: "Rest days, injuries, rotation, and player availability",
      status: "provider-dependent",
      source: "Player status and schedule feeds",
      tables: ["op_player_availability_snapshots", "op_lineup_snapshots"]
    },
    {
      id: "basketball-odds",
      label: "Moneyline, spread, and total odds history",
      status: "phase-two",
      source: "The Odds API basketball historical markets",
      tables: ["op_odds_snapshots"]
    }
  ];
}

function tennisSignals(): TrainingCorpusSignal[] {
  return [
    {
      id: "matches-results",
      label: "Matches, results, rounds, and tournament context",
      status: "planned",
      source: "API-Tennis historical events adapter",
      tables: ["op_fixtures", "op_teams", "op_leagues"]
    },
    {
      id: "surface-elo",
      label: "Player Elo and surface-specific rating",
      status: "provider-dependent",
      source: "API-Tennis events now, surface Elo enrichment next",
      tables: ["op_fixture_team_features", "op_training_feature_snapshots"]
    },
    {
      id: "fatigue-h2h",
      label: "Recent form, head-to-head, fatigue, travel, and round pressure",
      status: "provider-dependent",
      source: "Player match-history and tournament draw feeds",
      tables: ["op_training_feature_snapshots", "op_news_signals"]
    },
    {
      id: "tennis-odds",
      label: "Match winner, set handicap, and total games odds history",
      status: "phase-two",
      source: "The Odds API tennis historical markets",
      tables: ["op_odds_snapshots"]
    }
  ];
}

function plannedSportPlan({
  sport,
  env,
  baseUrl,
  seasonFrom,
  seasonTo,
  targets,
  requiredEnvGroups,
  adapter,
  backtestModelKey,
  modelFeatures,
  signalCoverage
}: {
  sport: Extract<TrainingCorpusSport, "basketball" | "tennis">;
  env: EnvMap;
  baseUrl: string;
  seasonFrom: number;
  seasonTo: number;
  targets: TrainingCorpusTarget[];
  requiredEnvGroups: string[][];
  adapter: string;
  backtestModelKey: string;
  modelFeatures: string[];
  signalCoverage: TrainingCorpusSignal[];
}): TrainingCorpusSportPlan {
  const seasons = seasonsFromRange(seasonFrom, seasonTo);
  const missingEnvKeys = missingFromGroups(env, requiredEnvGroups);
  const blockers = unique([...commonBlockers(env)]);
  const firstDryRunCommand = providerDryRunCommand({ baseUrl, sport, missingEnv: missingEnvKeys, blockerCount: blockers.length });

  return {
    sport,
    status: statusFor(blockers, missingEnvKeys),
    adapterStatus: "implemented",
    backtestRunnerStatus: "implemented",
    backtestModelKey,
    adapter,
    seasonFrom,
    seasonTo,
    seasonCount: seasons.length,
    targetCompetitions: targets,
    estimatedHistoricalMatches: estimateMatches(targets, seasons.length),
    estimatedOddsSnapshots: estimateOddsSnapshots(targets, seasons.length),
    requiredEnvKeys: unique(requiredEnvGroups.flat()),
    configuredEnvKeys: configuredFromGroups(env, requiredEnvGroups),
    missingEnvKeys,
    modelFeatures,
    signalCoverage,
    firstDryRunCommand,
    blockers,
    warnings: unique([
      `${sport} provider dry-runs are implemented, but learned guardrails need real historical rows before they can activate.`,
      "Opening, pre-match, and closing odds snapshots are required to measure CLV and learned market-prior weights."
    ]),
    nextSteps: [
      `Run the first ${sport} dry-run adapter and inspect normalized fixture, feature, odds, and context counts.`,
      "Only allow dryRun=0 after Supabase project proof, schema checks, provider quotas, and normalized dry-run counts pass.",
      `Connect stored ${sport} rows to ${backtestModelKey} before learned guardrails can affect live ${sport} decisions.`
    ]
  };
}

function basketballPlan(options: Required<Pick<MultiSportCorpusPlanOptions, "seasonFrom" | "seasonTo">> & MultiSportCorpusPlanOptions): TrainingCorpusSportPlan {
  return plannedSportPlan({
    sport: "basketball",
    env: options.env ?? process.env,
    baseUrl: commandBaseUrl(options.baseUrl),
    seasonFrom: options.seasonFrom,
    seasonTo: options.seasonTo,
    targets: BASKETBALL_TARGETS,
    requiredEnvGroups: [
      ["ODDSPADI_ADMIN_TOKEN"],
      ["API_BASKETBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
      ["THE_ODDS_API_KEY", "ODDS_API_KEY"],
      ["SUPABASE_URL"],
      ["SUPABASE_SERVICE_ROLE_KEY"]
    ],
    adapter: "API-Basketball games adapter plus The Odds API basketball markets",
    backtestModelKey: BASKETBALL_BACKTEST_MODEL_KEY,
    modelFeatures: [
      "team rating",
      "pace",
      "offensive efficiency",
      "defensive efficiency",
      "rest days",
      "home/away split",
      "injuries and rotation availability",
      "spread, moneyline, and total closing-line value"
    ],
    signalCoverage: basketballSignals()
  });
}

function tennisPlan(options: Required<Pick<MultiSportCorpusPlanOptions, "seasonFrom" | "seasonTo">> & MultiSportCorpusPlanOptions): TrainingCorpusSportPlan {
  return plannedSportPlan({
    sport: "tennis",
    env: options.env ?? process.env,
    baseUrl: commandBaseUrl(options.baseUrl),
    seasonFrom: options.seasonFrom,
    seasonTo: options.seasonTo,
    targets: TENNIS_TARGETS,
    requiredEnvGroups: [
      ["ODDSPADI_ADMIN_TOKEN"],
      ["API_TENNIS_KEY", "SPORTS_API_KEY"],
      ["THE_ODDS_API_KEY", "ODDS_API_KEY"],
      ["NEWS_API_KEY"],
      ["SUPABASE_URL"],
      ["SUPABASE_SERVICE_ROLE_KEY"]
    ],
    adapter: "API-Tennis events adapter plus The Odds API tennis markets",
    backtestModelKey: TENNIS_BACKTEST_MODEL_KEY,
    modelFeatures: [
      "player Elo",
      "surface-specific rating",
      "recent form",
      "head-to-head",
      "fatigue and travel load",
      "tournament round",
      "injury and news context",
      "match-winner, set-handicap, and total-games closing-line value"
    ],
    signalCoverage: tennisSignals()
  });
}

function allSportPlans(options: Required<Pick<MultiSportCorpusPlanOptions, "seasonFrom" | "seasonTo">> & MultiSportCorpusPlanOptions): TrainingCorpusSportPlan[] {
  const requested = options.sports ?? ["football", "basketball", "tennis"];
  return requested.map((sport) => {
    if (sport === "football") return footballPlan(options);
    if (sport === "basketball") return basketballPlan(options);
    return tennisPlan(options);
  });
}

function overallStatus(sports: TrainingCorpusSportPlan[]): MultiSportCorpusPlanStatus {
  if (sports.some((sport) => sport.status === "blocked")) return "blocked";
  if (sports.some((sport) => sport.status === "waiting")) return "waiting";
  return "ready";
}

function nextSafeCommand(baseUrl: string, sports: TrainingCorpusSportPlan[]): TrainingCorpusCommand {
  const runnableImport = sports.map((sport) => sport.firstDryRunCommand).find((command) => command?.safeToRun);
  if (runnableImport) return runnableImport;
  const blockedSport = sports.find((sport) => sport.status === "blocked")?.sport ?? sports[0]?.sport ?? "football";
  return planCheckCommand(baseUrl, blockedSport);
}

export function buildMultiSportCorpusPlan(options: MultiSportCorpusPlanOptions = {}): MultiSportCorpusPlan {
  const seasonFrom = options.seasonFrom ?? DEFAULT_SEASON_FROM;
  const seasonTo = options.seasonTo ?? DEFAULT_SEASON_TO;
  const seasons = seasonsFromRange(seasonFrom, seasonTo);
  const baseUrl = commandBaseUrl(options.baseUrl);
  const sports = allSportPlans({ ...options, seasonFrom, seasonTo, baseUrl });
  const requiredEnvKeys = unique(sports.flatMap((sport) => sport.requiredEnvKeys));
  const configuredEnvKeys = unique(sports.flatMap((sport) => sport.configuredEnvKeys));
  const missingEnvKeys = unique(sports.flatMap((sport) => sport.missingEnvKeys));
  const blockers = unique(sports.flatMap((sport) => sport.blockers));
  const warnings = unique(sports.flatMap((sport) => sport.warnings));

  return {
    id: "multi-sport-10-year-core-v1",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    status: overallStatus(sports),
    mode: "multi-sport-corpus-plan",
    dryRun: true,
    seasonFrom,
    seasonTo,
    seasons,
    sports,
    sportCount: sports.length,
    adapterReadySports: sports.filter((sport) => sport.adapterStatus === "implemented").length,
    plannedAdapterSports: sports.filter((sport) => sport.adapterStatus === "planned").length,
    totalEstimatedHistoricalMatches: sports.reduce((sum, sport) => sum + sport.estimatedHistoricalMatches, 0),
    totalEstimatedOddsSnapshots: sports.reduce((sum, sport) => sum + sport.estimatedOddsSnapshots, 0),
    requiredEnvKeys,
    configuredEnvKeys,
    missingEnvKeys,
    blockers,
    warnings,
    nextSafeCommand: nextSafeCommand(baseUrl, sports),
    supabaseExpectedRef: ODDSPADI_SUPABASE_PROJECT_REF,
    proofUrls: [
      "/api/sports/decision/training/multi-sport-corpus-plan",
      "/api/sports/decision/training/corpus-plan",
      "/api/sports/decision/training/backfill",
      "/api/sports/decision/mvp-audit",
      "/api/sports/decision/supabase-bootstrap"
    ]
  };
}
