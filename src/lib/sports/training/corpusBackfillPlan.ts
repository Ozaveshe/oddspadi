import { hasConfiguredEnv } from "@/lib/env";
import { getSupabaseRuntimeStatus, ODDSPADI_SUPABASE_PROJECT_REF } from "@/lib/supabase/server";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import { buildHistoricalProviderBackfillPlan, type HistoricalProviderBackfillPlan } from "./historicalBackfill";

type EnvMap = Record<string, string | undefined>;

export type CorpusBackfillPlanStatus = "ready" | "waiting" | "blocked";

export type CorpusLeagueTarget = {
  id: string;
  name: string;
  country: string;
  apiFootballLeagueId: string;
  oddsApiSportKey: string;
  typicalMatchesPerSeason: number;
};

export type CorpusProviderBatch = {
  id: string;
  label: string;
  provider: "api-football" | "the-odds-api";
  configured: boolean;
  configuredEnvKeys: string[];
  requiredEnvKeys: string[];
  missingEnvKeys: string[];
  totalCandidateJobs: number;
  plannedJobs: number;
  truncated: boolean;
  warnings: string[];
  errors: string[];
};

export type CorpusSignalCoverage = {
  id: string;
  label: string;
  status: "planned" | "blocked" | "phase-two" | "provider-dependent";
  source: string;
  tables: string[];
};

export type TenYearFootballCorpusBackfillPlan = {
  id: string;
  generatedAt: string;
  status: CorpusBackfillPlanStatus;
  dryRun: true;
  sport: "football";
  seasonFrom: number;
  seasonTo: number;
  seasons: string[];
  seasonCount: number;
  targetLeagues: CorpusLeagueTarget[];
  regionalExpansionWatchlist: string[];
  providerBatches: CorpusProviderBatch[];
  totalCandidateJobs: number;
  plannedJobs: number;
  estimatedFixtureDerivedOddsJobs: number;
  marketProbeDates: string[];
  canRunFirstCommand: boolean;
  firstCommand: string;
  firstCommandPurpose: string;
  firstCommandRequiredEnvKeys: string[];
  firstCommandMissingEnvKeys: string[];
  requiredEnvKeys: string[];
  configuredEnvKeys: string[];
  missingEnvKeys: string[];
  blockers: string[];
  warnings: string[];
  schemaTables: string[];
  signalCoverage: CorpusSignalCoverage[];
  nextSteps: string[];
};

export type TenYearFootballCorpusBackfillOptions = {
  env?: EnvMap;
  baseUrl?: string;
  generatedAt?: string;
  seasonFrom?: number;
  seasonTo?: number;
  maxJobsPerLeague?: number;
  includeUefaChampionsLeague?: boolean;
};

const DEFAULT_SEASON_FROM = 2016;
const DEFAULT_SEASON_TO = 2025;
const DEFAULT_MAX_JOBS_PER_LEAGUE = 10;
const FIRST_COMMAND_MAX_JOBS = 1;
const DEFAULT_MAX_EVENT_FIXTURES = 6;
const DEFAULT_MAX_CONTEXT_FIXTURES = 8;

const CORE_FOOTBALL_LEAGUES: CorpusLeagueTarget[] = [
  {
    id: "epl",
    name: "Premier League",
    country: "England",
    apiFootballLeagueId: "39",
    oddsApiSportKey: "soccer_epl",
    typicalMatchesPerSeason: 380
  },
  {
    id: "laliga",
    name: "La Liga",
    country: "Spain",
    apiFootballLeagueId: "140",
    oddsApiSportKey: "soccer_spain_la_liga",
    typicalMatchesPerSeason: 380
  },
  {
    id: "serie-a",
    name: "Serie A",
    country: "Italy",
    apiFootballLeagueId: "135",
    oddsApiSportKey: "soccer_italy_serie_a",
    typicalMatchesPerSeason: 380
  },
  {
    id: "bundesliga",
    name: "Bundesliga",
    country: "Germany",
    apiFootballLeagueId: "78",
    oddsApiSportKey: "soccer_germany_bundesliga",
    typicalMatchesPerSeason: 306
  },
  {
    id: "ligue-1",
    name: "Ligue 1",
    country: "France",
    apiFootballLeagueId: "61",
    oddsApiSportKey: "soccer_france_ligue_one",
    typicalMatchesPerSeason: 306
  }
];

const UEFA_CHAMPIONS_LEAGUE: CorpusLeagueTarget = {
  id: "ucl",
  name: "UEFA Champions League",
  country: "Europe",
  apiFootballLeagueId: "2",
  oddsApiSportKey: "soccer_uefa_champs_league",
  typicalMatchesPerSeason: 125
};

const SCHEMA_TABLES = [
  "op_provider_ingestion_runs",
  "op_raw_provider_payloads",
  "op_leagues",
  "op_teams",
  "op_fixtures",
  "op_fixture_team_features",
  "op_odds_snapshots",
  "op_live_match_events",
  "op_news_signals",
  "op_standings_snapshots",
  "op_player_availability_snapshots",
  "op_lineup_snapshots",
  "op_weather_snapshots",
  "op_training_feature_snapshots",
  "op_backtest_runs"
];

const REGIONAL_EXPANSION_WATCHLIST = [
  "Nigeria NPFL - confirm provider league id and historical depth before generating jobs",
  "CAF Champions League - confirm provider league id and coverage before generating jobs",
  "South Africa PSL - confirm provider league id, odds availability, and kickoff-time accuracy",
  "Ghana Premier League - confirm provider league id and bookmaker coverage"
];

function boolEnv(env: EnvMap, key: string): boolean {
  return hasConfiguredEnv(env, key);
}

function firstConfiguredEnv(env: EnvMap, keys: string[]): string[] {
  return keys.filter((key) => boolEnv(env, key));
}

function envGroupConfigured(env: EnvMap, keys: string[]): boolean {
  return firstConfiguredEnv(env, keys).length > 0;
}

function seasonsFromRange(from: number, to: number): string[] {
  const low = Math.min(from, to);
  const high = Math.max(from, to);
  const seasons: string[] = [];
  for (let season = low; season <= high; season += 1) {
    seasons.push(String(season));
  }
  return seasons;
}

function seasonProbeDates(seasons: string[]): string[] {
  return seasons.map((season) => `${season}-08-15T12:00:00Z`);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function commandBaseUrl(baseUrl: string | undefined): string {
  const cleaned = baseUrl?.trim().replace(/\/$/, "");
  return cleaned || decisionSiteOrigin();
}

function backfillQuery(params: Record<string, string | number | boolean | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === false) continue;
    query.set(key, value === true ? "1" : String(value));
  }
  return query.toString();
}

function providerBatchFromPlan({
  id,
  label,
  plan,
  configured,
  configuredEnvKeys,
  requiredEnvKeys
}: {
  id: string;
  label: string;
  plan: HistoricalProviderBackfillPlan;
  configured: boolean;
  configuredEnvKeys: string[];
  requiredEnvKeys: string[];
}): CorpusProviderBatch {
  return {
    id,
    label,
    provider: plan.provider as CorpusProviderBatch["provider"],
    configured,
    configuredEnvKeys,
    requiredEnvKeys,
    missingEnvKeys: configured ? [] : requiredEnvKeys,
    totalCandidateJobs: plan.totalCandidateJobs,
    plannedJobs: plan.jobs.length,
    truncated: plan.truncated,
    warnings: plan.warnings,
    errors: plan.errors
  };
}

function buildFixtureBackfillPlan({
  league,
  seasonFrom,
  seasonTo,
  maxJobsPerLeague
}: {
  league: CorpusLeagueTarget;
  seasonFrom: number;
  seasonTo: number;
  maxJobsPerLeague: number;
}) {
  return buildHistoricalProviderBackfillPlan({
    provider: "api-football",
    league: league.apiFootballLeagueId,
    seasonFrom,
    seasonTo,
    includeEvents: true,
    includeNews: true,
    includeContext: true,
    includeStandings: true,
    includeAvailability: true,
    includeLineups: true,
    includeWeather: true,
    dryRun: true,
    maxJobs: maxJobsPerLeague
  });
}

function buildOddsProbePlan({
  league,
  dates,
  maxJobsPerLeague
}: {
  league: CorpusLeagueTarget;
  dates: string[];
  maxJobsPerLeague: number;
}) {
  return buildHistoricalProviderBackfillPlan({
    provider: "the-odds-api",
    sportKey: league.oddsApiSportKey,
    dates,
    regions: "uk,eu,us",
    dryRun: true,
    maxJobs: maxJobsPerLeague
  });
}

function buildSignalCoverage(): CorpusSignalCoverage[] {
  return [
    {
      id: "fixtures-results",
      label: "Fixtures and 10-year historical results",
      status: "planned",
      source: "API-Football season backfills",
      tables: ["op_fixtures", "op_teams", "op_leagues"]
    },
    {
      id: "team-strength-form",
      label: "Team strength, home/away, and recent form",
      status: "planned",
      source: "Derived team match features after fixture import",
      tables: ["op_fixture_team_features", "op_training_feature_snapshots"]
    },
    {
      id: "standings",
      label: "League standings snapshots",
      status: "planned",
      source: "API-Football standings context",
      tables: ["op_standings_snapshots"]
    },
    {
      id: "availability-lineups",
      label: "Injuries, suspensions, and lineups",
      status: "provider-dependent",
      source: "API-Football injuries and lineup endpoints where historical coverage exists",
      tables: ["op_player_availability_snapshots", "op_lineup_snapshots"]
    },
    {
      id: "odds-history",
      label: "Bookmaker odds history",
      status: "phase-two",
      source: "The Odds API market probes first, then fixture-derived opening and closing snapshots",
      tables: ["op_odds_snapshots"]
    },
    {
      id: "events-live-state",
      label: "Match events and live-score replay",
      status: "planned",
      source: "API-Football fixture event archives",
      tables: ["op_live_match_events"]
    },
    {
      id: "news-weather",
      label: "News signals and weather context",
      status: "provider-dependent",
      source: "NewsAPI and OpenWeather enrichment during fixture/context imports",
      tables: ["op_news_signals", "op_weather_snapshots"]
    },
    {
      id: "audit-raw-payloads",
      label: "Provider audit trail and raw payload archive",
      status: "planned",
      source: "Server ingestion wrapper",
      tables: ["op_provider_ingestion_runs", "op_raw_provider_payloads"]
    }
  ];
}

export function buildTenYearFootballCorpusBackfillPlan(
  options: TenYearFootballCorpusBackfillOptions = {}
): TenYearFootballCorpusBackfillPlan {
  const env = options.env ?? process.env;
  const seasonFrom = options.seasonFrom ?? DEFAULT_SEASON_FROM;
  const seasonTo = options.seasonTo ?? DEFAULT_SEASON_TO;
  const maxJobsPerLeague = Math.max(1, Math.min(120, options.maxJobsPerLeague ?? DEFAULT_MAX_JOBS_PER_LEAGUE));
  const seasons = seasonsFromRange(seasonFrom, seasonTo);
  const targetLeagues = options.includeUefaChampionsLeague === false ? CORE_FOOTBALL_LEAGUES : [...CORE_FOOTBALL_LEAGUES, UEFA_CHAMPIONS_LEAGUE];
  const marketProbeDates = seasonProbeDates(seasons);
  const apiFootballEnvKeys = ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"];
  const oddsEnvKeys = ["THE_ODDS_API_KEY", "ODDS_API_KEY"];
  const newsEnvKeys = ["NEWS_API_KEY"];
  const weatherEnvKeys = ["WEATHER_API_KEY", "OPENWEATHER_API_KEY"];
  const supabaseEnvKeys = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
  const adminEnvKeys = ["ODDSPADI_ADMIN_TOKEN"];
  const apiFootballConfiguredEnv = firstConfiguredEnv(env, apiFootballEnvKeys);
  const oddsConfiguredEnv = firstConfiguredEnv(env, oddsEnvKeys);
  const newsConfiguredEnv = firstConfiguredEnv(env, newsEnvKeys);
  const weatherConfiguredEnv = firstConfiguredEnv(env, weatherEnvKeys);
  const supabaseConfiguredEnv = firstConfiguredEnv(env, supabaseEnvKeys);
  const adminConfiguredEnv = firstConfiguredEnv(env, adminEnvKeys);
  const runtime = getSupabaseRuntimeStatus(env);

  const providerBatches = targetLeagues.flatMap((league) => {
    const fixturePlan = buildFixtureBackfillPlan({ league, seasonFrom, seasonTo, maxJobsPerLeague });
    const oddsPlan = buildOddsProbePlan({ league, dates: marketProbeDates, maxJobsPerLeague });

    return [
      providerBatchFromPlan({
        id: `${league.id}:fixture-context`,
        label: `${league.name} fixture/context seasons`,
        plan: fixturePlan,
        configured: apiFootballConfiguredEnv.length > 0,
        configuredEnvKeys: apiFootballConfiguredEnv,
        requiredEnvKeys: apiFootballEnvKeys
      }),
      providerBatchFromPlan({
        id: `${league.id}:odds-probes`,
        label: `${league.name} odds probe dates`,
        plan: oddsPlan,
        configured: oddsConfiguredEnv.length > 0,
        configuredEnvKeys: oddsConfiguredEnv,
        requiredEnvKeys: oddsEnvKeys
      })
    ];
  });

  const totalCandidateJobs = providerBatches.reduce((sum, batch) => sum + batch.totalCandidateJobs, 0);
  const plannedJobs = providerBatches.reduce((sum, batch) => sum + batch.plannedJobs, 0);
  const estimatedFixtureDerivedOddsJobs = targetLeagues.reduce(
    (sum, league) => sum + league.typicalMatchesPerSeason * seasons.length * 3,
    0
  );
  const configuredEnvKeys = unique([
    ...apiFootballConfiguredEnv,
    ...oddsConfiguredEnv,
    ...newsConfiguredEnv,
    ...weatherConfiguredEnv,
    ...supabaseConfiguredEnv,
    ...adminConfiguredEnv
  ]);
  const missingEnvKeys = unique([
    ...(apiFootballConfiguredEnv.length ? [] : apiFootballEnvKeys),
    ...(oddsConfiguredEnv.length ? [] : oddsEnvKeys),
    ...(newsConfiguredEnv.length ? [] : newsEnvKeys),
    ...(weatherConfiguredEnv.length ? [] : weatherEnvKeys),
    ...(runtime.serverWriteReady ? [] : supabaseEnvKeys),
    ...(adminConfiguredEnv.length ? [] : adminEnvKeys)
  ]);
  const blockers = [
    runtime.projectRef && runtime.projectRef !== ODDSPADI_SUPABASE_PROJECT_REF ? `Configured project ref is ${runtime.projectRef}.` : "",
    runtime.urlProjectRef && runtime.urlProjectRef !== ODDSPADI_SUPABASE_PROJECT_REF
      ? `Configured Supabase URL points at ${runtime.urlProjectRef}.`
      : ""
  ].filter(Boolean);
  const warnings = [
    !runtime.serverWriteReady ? "Supabase server writes are not ready, so only dry-run provider validation should run." : "",
    !envGroupConfigured(env, apiFootballEnvKeys) ? "API-Football is required for the first 10-season fixture/context backfill." : "",
    !envGroupConfigured(env, oddsEnvKeys) ? "The Odds API is required for odds-history probes and value-edge training." : "",
    !envGroupConfigured(env, newsEnvKeys) ? "NEWS_API_KEY is optional for the first dry-run but required for archived news signals." : "",
    !envGroupConfigured(env, weatherEnvKeys) ? "WEATHER_API_KEY or OPENWEATHER_API_KEY is optional for the first dry-run but required for weather context." : "",
    "Historical odds should become fixture-derived after fixture import, with opening, pre-kickoff, and closing snapshots."
  ].filter(Boolean);
  const firstOrigin = commandBaseUrl(options.baseUrl);
  const firstLeague = targetLeagues[0];
  const firstCommandMaxJobs = Math.min(FIRST_COMMAND_MAX_JOBS, maxJobsPerLeague);
  const firstCommandRequiredEnvKeys = unique([...adminEnvKeys, ...apiFootballEnvKeys]);
  const firstCommandMissingEnvKeys = unique([
    ...(adminConfiguredEnv.length ? [] : adminEnvKeys),
    ...(apiFootballConfiguredEnv.length ? [] : apiFootballEnvKeys)
  ]);
  const firstQuery = backfillQuery({
    provider: "api-football",
    league: firstLeague.apiFootballLeagueId,
    seasonFrom,
    seasonTo,
    includeEvents: true,
    includeContext: true,
    includeStandings: true,
    includeAvailability: true,
    includeLineups: true,
    includeNews: newsConfiguredEnv.length > 0,
    includeWeather: weatherConfiguredEnv.length > 0,
    maxEventFixtures: DEFAULT_MAX_EVENT_FIXTURES,
    maxContextFixtures: DEFAULT_MAX_CONTEXT_FIXTURES,
    maxJobs: firstCommandMaxJobs,
    dryRun: true
  });
  const firstCommand = `curl.exe -X POST "${firstOrigin}/api/sports/decision/training/backfill?${firstQuery}" -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`;
  const canRunFirstCommand = blockers.length === 0 && firstCommandMissingEnvKeys.length === 0;
  const status: CorpusBackfillPlanStatus = blockers.length ? "blocked" : missingEnvKeys.length ? "waiting" : "ready";

  return {
    id: "football-10-year-core-v1",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    status,
    dryRun: true,
    sport: "football",
    seasonFrom,
    seasonTo,
    seasons,
    seasonCount: seasons.length,
    targetLeagues,
    regionalExpansionWatchlist: REGIONAL_EXPANSION_WATCHLIST,
    providerBatches,
    totalCandidateJobs,
    plannedJobs,
    estimatedFixtureDerivedOddsJobs,
    marketProbeDates,
    canRunFirstCommand,
    firstCommand,
    firstCommandPurpose: `Dry-run the first ${firstLeague.name} season job from ${seasonFrom}-${seasonTo} with event cap ${DEFAULT_MAX_EVENT_FIXTURES} and context cap ${DEFAULT_MAX_CONTEXT_FIXTURES}; news/weather enrich only when their keys are configured.`,
    firstCommandRequiredEnvKeys,
    firstCommandMissingEnvKeys,
    requiredEnvKeys: unique([...adminEnvKeys, ...apiFootballEnvKeys, ...oddsEnvKeys, ...newsEnvKeys, ...weatherEnvKeys, ...supabaseEnvKeys]),
    configuredEnvKeys,
    missingEnvKeys,
    blockers,
    warnings,
    schemaTables: SCHEMA_TABLES,
    signalCoverage: buildSignalCoverage(),
    nextSteps: [
      "Apply the OddsPadi Supabase migrations to the new project and confirm every expected op_ table is accessible to the server client.",
      "Add provider keys and ODDSPADI_ADMIN_TOKEN to local env and Netlify environment variables.",
      "Run the first dry-run command and inspect normalized counts plus provider quota impact.",
      "Run capped dry-runs per league, then set dryRun=0 only after the payload and table checks are clean.",
      "After fixtures are stored, generate fixture-derived odds snapshot jobs for opening, pre-kickoff, and closing-line training."
    ]
  };
}
