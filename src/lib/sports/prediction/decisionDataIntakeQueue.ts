import { hasConfiguredEnv } from "@/lib/env";
import type { DecisionEngineReadiness, ReadinessStatus } from "@/lib/sports/prediction/decisionReadiness";
import { decisionApiUrl } from "@/lib/sports/prediction/decisionUrls";
import type { DecisionDataCoverageSignal, DecisionDataSignalCategory, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

type EnvMap = Record<string, string | undefined>;
type EnvRequirement = {
  keys: string[];
  mode: "all" | "any";
};

export type DecisionDataIntakeStatus = "ready" | "blocked" | "waiting";
export type DecisionDataIntakeSignalStatus = "ready" | "needs-provider" | "blocked" | "watch";
export type DecisionDataIntakePriority = "critical" | "high" | "medium" | "low";

export type DecisionDataIntakeItem = {
  id: string;
  category: DecisionDataSignalCategory;
  label: string;
  status: DecisionDataIntakeSignalStatus;
  priority: DecisionDataIntakePriority;
  affectedMatches: number;
  totalSignals: number;
  providerBackedSignals: number;
  computedSignals: number;
  mockSignals: number;
  missingSignals: number;
  staleSignals: number;
  provider: string;
  command: string;
  verifyUrl: string;
  missingEnv: string[];
  expectedEvidence: string;
  decisionImpact: string;
  exampleMatches: string[];
};

export type DecisionDataIntakeQueue = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionDataIntakeStatus;
  summary: string;
  coverageScore: number;
  totalSignals: number;
  providerBackedSignals: number;
  computedSignals: number;
  mockSignals: number;
  missingSignals: number;
  staleSignals: number;
  items: DecisionDataIntakeItem[];
  nextItem: DecisionDataIntakeItem | null;
  readyItems: number;
  blockedItems: number;
  waitingItems: number;
  providerReadiness: {
    status: ReadinessStatus | "unknown";
    runtimeProvider: string;
    configuredCoverage: number;
    liveCoverage: number;
    totalProductionSignals: number;
    supabaseStatus: ReadinessStatus | "unknown";
    supabaseProjectRef: string | null;
    detail: string;
  };
};

type CategoryStats = {
  category: DecisionDataSignalCategory;
  label: string;
  totalSignals: number;
  providerBackedSignals: number;
  computedSignals: number;
  mockSignals: number;
  missingSignals: number;
  staleSignals: number;
  notApplicableSignals: number;
  requiredGaps: number;
  affectedMatchIds: Set<string>;
  exampleMatches: string[];
};

type CategoryConfig = {
  label: string;
  provider: string;
  requirements: EnvRequirement[];
  command: (date: string, sport: Sport) => string;
  verifyUrl: (date: string, sport: Sport) => string;
  expectedEvidence: string;
  decisionImpact: string;
  basePriority: DecisionDataIntakePriority;
};

const FOOTBALL_PROVIDER: EnvRequirement = { mode: "any", keys: ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"] };
const LIVE_PROVIDER: EnvRequirement = { mode: "any", keys: ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY", "LIVE_SCORES_API_KEY"] };
const ODDS_PROVIDER: EnvRequirement = { mode: "any", keys: ["THE_ODDS_API_KEY", "ODDS_API_KEY"] };
const NEWS_PROVIDER: EnvRequirement = { mode: "all", keys: ["NEWS_API_KEY"] };
const ADMIN_TOKEN: EnvRequirement = { mode: "all", keys: ["ODDSPADI_ADMIN_TOKEN"] };
const SUPABASE_WRITES: EnvRequirement = { mode: "all", keys: ["SUPABASE_SERVICE_ROLE_KEY"] };

function localUrl(path: string): string {
  return decisionApiUrl(path);
}

function getCommand(path: string): string {
  return `curl.exe -sS "${localUrl(path)}"`;
}

function postCommand(path: string): string {
  return `curl.exe -sS -X POST -H "x-oddspadi-admin-token: <ODDSPADI_ADMIN_TOKEN>" "${localUrl(path)}"`;
}

function apiFootballSyncPath(date: string, extras = ""): string {
  const suffix = extras ? `&${extras}` : "";
  return `/api/sports/decision/training/provider-sync?provider=api-football&league=39&season=2025&date=${encodeURIComponent(date)}${suffix}&dryRun=1`;
}

function oddsSyncPath(date: string): string {
  return `/api/sports/decision/training/provider-sync?provider=the-odds-api&sportKey=soccer_epl&date=${encodeURIComponent(`${date}T12:00:00Z`)}&dryRun=1`;
}

const CATEGORY_CONFIG: Record<DecisionDataSignalCategory, CategoryConfig> = {
  fixtures: {
    label: "Fixtures for the day",
    provider: "API-Football or SportsDataProvider",
    requirements: [FOOTBALL_PROVIDER],
    command: (date, sport) => getCommand(`/api/sports/fixtures?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`),
    verifyUrl: (date, sport) => `/api/sports/fixtures?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`,
    expectedEvidence: "Fixtures return provider dataSource metadata instead of the MVP mock provider.",
    decisionImpact: "Removes the first trust gap by proving today's slate is real provider data.",
    basePriority: "critical"
  },
  "historical-results": {
    label: "Team/player historical results",
    provider: "API-Football historical fixtures",
    requirements: [ADMIN_TOKEN, FOOTBALL_PROVIDER],
    command: () =>
      postCommand("/api/sports/decision/training/backfill?provider=api-football&league=39&seasonFrom=2016&seasonTo=2025&includeEvents=1&includeContext=1&maxJobs=1&dryRun=1"),
    verifyUrl: () => "/api/sports/decision/training/corpus-plan",
    expectedEvidence: "Dry-run reports normalized historical fixture counts before any write-mode import.",
    decisionImpact: "Builds the 10-year result base for Poisson priors, Elo updates, team strength, and form validation.",
    basePriority: "critical"
  },
  standings: {
    label: "League standings",
    provider: "API-Football standings",
    requirements: [ADMIN_TOKEN, FOOTBALL_PROVIDER],
    command: (date) => postCommand(apiFootballSyncPath(date, "includeContext=1")),
    verifyUrl: () => "/api/sports/decision/training",
    expectedEvidence: "Provider sync returns standings snapshots with league, season, team, rank, and points context.",
    decisionImpact: "Adds table-position context and reduces false positives driven by weak fixture-only ratings.",
    basePriority: "high"
  },
  "home-away": {
    label: "Home/away performance",
    provider: "Computed from provider historical fixtures",
    requirements: [ADMIN_TOKEN, FOOTBALL_PROVIDER],
    command: () =>
      postCommand("/api/sports/decision/training/backfill?provider=api-football&league=39&seasonFrom=2016&seasonTo=2025&maxJobs=1&dryRun=1"),
    verifyUrl: () => "/api/sports/decision/training",
    expectedEvidence: "Training rows include enough real home and away fixtures to compute team-strength splits.",
    decisionImpact: "Turns home advantage from a generic factor into a team-specific historical feature.",
    basePriority: "medium"
  },
  "recent-form": {
    label: "Recent form",
    provider: "API-Football fixtures and deterministic form builder",
    requirements: [FOOTBALL_PROVIDER],
    command: (date, sport) => getCommand(`/api/sports/predictions?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`),
    verifyUrl: (date, sport) => `/api/sports/predictions?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`,
    expectedEvidence: "Predictions show provider-backed recent-form sources or deterministic provider proxies.",
    decisionImpact: "Improves short-horizon team shape without pretending stale mock form is live evidence.",
    basePriority: "medium"
  },
  injuries: {
    label: "Injuries",
    provider: "API-Football injuries",
    requirements: [ADMIN_TOKEN, FOOTBALL_PROVIDER],
    command: (date) => postCommand(apiFootballSyncPath(date, "includeContext=1")),
    verifyUrl: () => "/api/sports/decision/training",
    expectedEvidence: "Provider sync returns player availability snapshots with injury status and fixture linkage.",
    decisionImpact: "Reduces lineup and player-availability blind spots before the engine trusts a side or total.",
    basePriority: "critical"
  },
  suspensions: {
    label: "Suspensions",
    provider: "API-Football availability context",
    requirements: [ADMIN_TOKEN, FOOTBALL_PROVIDER],
    command: (date) => postCommand(apiFootballSyncPath(date, "includeContext=1")),
    verifyUrl: () => "/api/sports/decision/training",
    expectedEvidence: "Availability snapshots identify suspended or unavailable players where the provider exposes them.",
    decisionImpact: "Prevents the agent from treating missing suspended-player context as neutral team news.",
    basePriority: "high"
  },
  lineups: {
    label: "Lineups",
    provider: "API-Football lineups",
    requirements: [ADMIN_TOKEN, FOOTBALL_PROVIDER],
    command: (date) => postCommand(apiFootballSyncPath(date, "includeContext=1")),
    verifyUrl: () => "/api/sports/decision/training",
    expectedEvidence: "Provider sync returns lineup snapshots with starters, formations, and fixture linkage when available.",
    decisionImpact: "Lets the agent downgrade picks when starters, formations, or rotation risks contradict the model.",
    basePriority: "critical"
  },
  odds: {
    label: "Bookmaker odds",
    provider: "The Odds API",
    requirements: [ADMIN_TOKEN, ODDS_PROVIDER],
    command: (date) => postCommand(oddsSyncPath(date)),
    verifyUrl: () => "/api/sports/decision/training",
    expectedEvidence: "Dry-run returns normalized odds snapshots with bookmaker, market, selection, price, and timestamp.",
    decisionImpact: "Unlocks no-vig probabilities, value edge, EV, closing-line value, and market-movement checks.",
    basePriority: "critical"
  },
  "live-scores": {
    label: "Live scores",
    provider: "API-Football or live scores provider",
    requirements: [LIVE_PROVIDER],
    command: (date, sport) => getCommand(`/api/sports/live-scores?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`),
    verifyUrl: (date, sport) => `/api/sports/live-scores?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`,
    expectedEvidence: "Live endpoint returns current score, clock, status, and provider metadata for in-play fixtures.",
    decisionImpact: "Feeds the in-play Poisson recalculation and late abstention gates.",
    basePriority: "high"
  },
  "match-events": {
    label: "Match events",
    provider: "API-Football events",
    requirements: [ADMIN_TOKEN, FOOTBALL_PROVIDER],
    command: (date) => postCommand(apiFootballSyncPath(date, "includeEvents=1")),
    verifyUrl: () => "/api/sports/decision/training",
    expectedEvidence: "Provider sync returns event snapshots for goals, cards, substitutions, and other match events.",
    decisionImpact: "Adds red-card, substitution, injury, and tempo evidence to live monitoring and post-match learning.",
    basePriority: "high"
  },
  news: {
    label: "News signals",
    provider: "NewsAPI plus team/source filters",
    requirements: [ADMIN_TOKEN, FOOTBALL_PROVIDER, NEWS_PROVIDER],
    command: (date) => postCommand(apiFootballSyncPath(date, "includeNews=1")),
    verifyUrl: () => "/api/sports/decision/training",
    expectedEvidence: "Provider sync returns normalized news signals with source, title, published time, and team relevance.",
    decisionImpact: "Lets the AI reviewer cite late team news while avoiding unsupported or stale claims.",
    basePriority: "high"
  },
  weather: {
    label: "Weather",
    provider: "Open-Meteo fallback or configured weather provider",
    requirements: [ADMIN_TOKEN, FOOTBALL_PROVIDER],
    command: (date) => postCommand(apiFootballSyncPath(date, "includeContext=1")),
    verifyUrl: () => "/api/sports/decision/training",
    expectedEvidence: "Provider sync returns weather snapshots by venue city and kickoff window.",
    decisionImpact: "Improves totals, tempo, and avoid rules for outdoor football and tennis contexts.",
    basePriority: "medium"
  },
  training: {
    label: "Historical training corpus",
    provider: "Supabase op_* training tables",
    requirements: [ADMIN_TOKEN, FOOTBALL_PROVIDER, ODDS_PROVIDER, SUPABASE_WRITES],
    command: () =>
      postCommand("/api/sports/decision/training/backfill?provider=api-football&league=39&seasonFrom=2016&seasonTo=2025&includeEvents=1&includeContext=1&maxJobs=1&dryRun=1"),
    verifyUrl: () => "/api/sports/decision/training/corpus-plan",
    expectedEvidence: "Corpus plan and dry-run prove real fixture, odds, event, context, and feature rows before write-mode import.",
    decisionImpact: "Creates the real-data base for backtesting, calibration, learned thresholds, and case-memory reliability.",
    basePriority: "critical"
  }
};

function envConfigured(env: EnvMap, key: string): boolean {
  return hasConfiguredEnv(env, key);
}

function missingForRequirement(env: EnvMap, requirement: EnvRequirement): string[] {
  if (requirement.mode === "all") return requirement.keys.filter((key) => !envConfigured(env, key));
  return requirement.keys.some((key) => envConfigured(env, key)) ? [] : requirement.keys;
}

function missingEnvForRequirements(env: EnvMap, requirements: EnvRequirement[]): string[] {
  return Array.from(new Set(requirements.flatMap((requirement) => missingForRequirement(env, requirement))));
}

function createStats(category: DecisionDataSignalCategory, label: string): CategoryStats {
  return {
    category,
    label,
    totalSignals: 0,
    providerBackedSignals: 0,
    computedSignals: 0,
    mockSignals: 0,
    missingSignals: 0,
    staleSignals: 0,
    notApplicableSignals: 0,
    requiredGaps: 0,
    affectedMatchIds: new Set(),
    exampleMatches: []
  };
}

function matchLabel(match: Match): string {
  return `${match.homeTeam.name} vs ${match.awayTeam.name}`;
}

function addSignal(stats: CategoryStats, signal: DecisionDataCoverageSignal, match: Match) {
  stats.totalSignals += 1;
  if (signal.status === "provider-backed") stats.providerBackedSignals += 1;
  if (signal.status === "computed") stats.computedSignals += 1;
  if (signal.status === "mock") stats.mockSignals += 1;
  if (signal.status === "missing") stats.missingSignals += 1;
  if (signal.status === "stale") stats.staleSignals += 1;
  if (signal.status === "not-applicable") stats.notApplicableSignals += 1;
  if (signal.requiredForProduction && (signal.status === "mock" || signal.status === "missing" || signal.status === "stale")) {
    stats.requiredGaps += 1;
    stats.affectedMatchIds.add(match.id);
    if (stats.exampleMatches.length < 3) {
      stats.exampleMatches.push(`${matchLabel(match)}: ${signal.detail}`);
    }
  }
}

function priorityFor(config: CategoryConfig, stats: CategoryStats): DecisionDataIntakePriority {
  if (config.basePriority === "critical") return "critical";
  if (stats.missingSignals + stats.staleSignals >= 3) return "critical";
  if (stats.requiredGaps >= 4 && config.basePriority === "medium") return "high";
  if (stats.requiredGaps > 0) return config.basePriority;
  return config.basePriority === "high" ? "medium" : "low";
}

function statusFor(stats: CategoryStats, missingEnv: string[]): DecisionDataIntakeSignalStatus {
  const gapCount = stats.mockSignals + stats.missingSignals + stats.staleSignals;
  if (gapCount > 0 && missingEnv.length) return "blocked";
  if (gapCount > 0) return "needs-provider";
  if (stats.computedSignals > 0 && stats.providerBackedSignals === 0) return "watch";
  return "ready";
}

function sortItems(items: DecisionDataIntakeItem[]): DecisionDataIntakeItem[] {
  const priorityRank: Record<DecisionDataIntakePriority, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const statusRank: Record<DecisionDataIntakeSignalStatus, number> = { blocked: 4, "needs-provider": 3, watch: 2, ready: 1 };
  const categoryRank: Record<DecisionDataSignalCategory, number> = {
    training: 14,
    odds: 13,
    fixtures: 12,
    "historical-results": 11,
    lineups: 10,
    injuries: 9,
    standings: 8,
    suspensions: 7,
    "recent-form": 6,
    "home-away": 5,
    "live-scores": 4,
    "match-events": 3,
    news: 2,
    weather: 1
  };
  return items.slice().sort((a, b) => {
    const priority = priorityRank[b.priority] - priorityRank[a.priority];
    if (priority !== 0) return priority;
    const status = statusRank[b.status] - statusRank[a.status];
    if (status !== 0) return status;
    const category = categoryRank[b.category] - categoryRank[a.category];
    if (category !== 0) return category;
    return b.affectedMatches - a.affectedMatches;
  });
}

function shouldInclude(stats: CategoryStats): boolean {
  if (stats.totalSignals === stats.notApplicableSignals) return false;
  if (stats.mockSignals + stats.missingSignals + stats.staleSignals > 0) return true;
  return stats.computedSignals > 0 && stats.providerBackedSignals === 0;
}

export function buildDecisionDataCapabilityItems({
  date,
  sport,
  env = process.env
}: {
  date: string;
  sport: Sport;
  env?: EnvMap;
}): DecisionDataIntakeItem[] {
  return (Object.entries(CATEGORY_CONFIG) as Array<[DecisionDataSignalCategory, CategoryConfig]>).map(([category, config]) => {
    const missingEnv = missingEnvForRequirements(env, config.requirements);
    return {
      id: `data-capability-${category}`,
      category,
      label: config.label,
      status: missingEnv.length ? "blocked" : "ready",
      priority: config.basePriority,
      affectedMatches: 0,
      totalSignals: 0,
      providerBackedSignals: 0,
      computedSignals: 0,
      mockSignals: 0,
      missingSignals: 0,
      staleSignals: 0,
      provider: config.provider,
      command: config.command(date, sport),
      verifyUrl: config.verifyUrl(date, sport),
      missingEnv,
      expectedEvidence: config.expectedEvidence,
      decisionImpact: config.decisionImpact,
      exampleMatches: [`No ${sport} fixture on the selected slate produced event-level ${config.label.toLowerCase()} evidence.`]
    };
  });
}

export function buildDecisionDataIntakeQueue({
  rows,
  date,
  sport,
  readiness = null,
  env = process.env,
  limit = 8
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  readiness?: DecisionEngineReadiness | null;
  env?: EnvMap;
  limit?: number;
}): DecisionDataIntakeQueue {
  const statsByCategory = new Map<DecisionDataSignalCategory, CategoryStats>();
  let totalSignals = 0;
  let providerBackedSignals = 0;
  let computedSignals = 0;
  let mockSignals = 0;
  let missingSignals = 0;
  let staleSignals = 0;

  for (const row of rows) {
    for (const signal of row.prediction.decision.dataCoverage.signals) {
      const config = CATEGORY_CONFIG[signal.category];
      const stats = statsByCategory.get(signal.category) ?? createStats(signal.category, config?.label ?? signal.label);
      addSignal(stats, signal, row.match);
      statsByCategory.set(signal.category, stats);
      totalSignals += 1;
      if (signal.status === "provider-backed") providerBackedSignals += 1;
      if (signal.status === "computed") computedSignals += 1;
      if (signal.status === "mock") mockSignals += 1;
      if (signal.status === "missing") missingSignals += 1;
      if (signal.status === "stale") staleSignals += 1;
    }
  }

  const coverageScore = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + row.prediction.decision.dataCoverage.score, 0) / rows.length)
    : 0;

  const items = sortItems(
    Array.from(statsByCategory.values())
      .filter(shouldInclude)
      .map((stats) => {
        const config = CATEGORY_CONFIG[stats.category];
        const missingEnv = missingEnvForRequirements(env, config.requirements);
        const status = statusFor(stats, missingEnv);
        return {
          id: `data-intake-${stats.category}`,
          category: stats.category,
          label: config.label,
          status,
          priority: priorityFor(config, stats),
          affectedMatches: stats.affectedMatchIds.size || rows.length,
          totalSignals: stats.totalSignals,
          providerBackedSignals: stats.providerBackedSignals,
          computedSignals: stats.computedSignals,
          mockSignals: stats.mockSignals,
          missingSignals: stats.missingSignals,
          staleSignals: stats.staleSignals,
          provider: config.provider,
          command: config.command(date, sport),
          verifyUrl: config.verifyUrl(date, sport),
          missingEnv,
          expectedEvidence: config.expectedEvidence,
          decisionImpact: config.decisionImpact,
          exampleMatches: stats.exampleMatches.length ? stats.exampleMatches : [`${stats.label}: no production gap examples were found.`]
        };
      })
  ).slice(0, limit);

  const readyItems = items.filter((item) => item.status === "needs-provider").length;
  const blockedItems = items.filter((item) => item.status === "blocked").length;
  const waitingItems = items.filter((item) => item.status === "watch" || item.status === "ready").length;
  const nextItem = items.find((item) => item.status === "needs-provider") ?? items.find((item) => item.status === "blocked") ?? items[0] ?? null;
  const status: DecisionDataIntakeStatus = readyItems ? "ready" : blockedItems ? "blocked" : "waiting";

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    summary:
      status === "ready"
        ? `Data intake has ${readyItems} provider action(s) ready; start with ${nextItem?.label ?? "the top item"}.`
        : status === "blocked"
          ? `Data intake is blocked on ${blockedItems} provider/configuration item(s) before real-data trust can rise.`
          : "Data intake is waiting on provider-backed evidence or computed-signal validation.",
    coverageScore,
    totalSignals,
    providerBackedSignals,
    computedSignals,
    mockSignals,
    missingSignals,
    staleSignals,
    items,
    nextItem,
    readyItems,
    blockedItems,
    waitingItems,
    providerReadiness: {
      status: readiness?.dataProviders.status ?? "unknown",
      runtimeProvider: readiness?.dataProviders.runtimeProvider ?? "unknown",
      configuredCoverage: readiness?.dataProviders.configuredSignalCoverage ?? 0,
      liveCoverage: readiness?.dataProviders.liveRuntimeSignalCoverage ?? 0,
      totalProductionSignals: readiness?.dataProviders.totalProductionSignals ?? 14,
      supabaseStatus: readiness?.supabase.status ?? "unknown",
      supabaseProjectRef: readiness?.supabase.projectRef ?? null,
      detail: readiness?.dataProviders.detail ?? "Provider readiness has not been checked for this intake queue."
    }
  };
}
