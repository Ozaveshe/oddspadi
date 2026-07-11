import type { DecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import type { DecisionDataCoverageSignal, DecisionDataSignalCategory, DecisionDataSignalStatus, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionCoverageSport = Extract<Sport, "football" | "basketball" | "tennis">;
export type DecisionDataSourceCoverageStatus = "ready-proof" | "needs-provider" | "blocked";
export type DecisionDataSourceCellStatus = "provider-backed" | "computed" | "mock" | "missing" | "not-applicable";

export type DecisionDataSourceCoverageCell = {
  id: string;
  sport: DecisionCoverageSport;
  category: DecisionDataSignalCategory;
  label: string;
  requirement: string;
  status: DecisionDataSourceCellStatus;
  requiredForLive: boolean;
  provider: string;
  storageTables: string[];
  missingEnv: string[];
  evidence: {
    totalSignals: number;
    providerBacked: number;
    computed: number;
    mock: number;
    missing: number;
    stale: number;
    notApplicable: number;
    realTrainingRows: number;
    realOddsSnapshots: number;
    featureSnapshots: number;
  };
  proofUrl: string;
  nextAction: string;
};

export type DecisionDataSourceCoverage = {
  mode: "data-source-coverage";
  generatedAt: string;
  date: string;
  status: DecisionDataSourceCoverageStatus;
  coverageHash: string;
  summary: string;
  totals: {
    sports: number;
    cells: number;
    providerBacked: number;
    computed: number;
    mock: number;
    missing: number;
    notApplicable: number;
    blockedRequired: number;
    readyRequired: number;
  };
  sports: Array<{
    sport: DecisionCoverageSport;
    status: DecisionDataSourceCoverageStatus;
    providerBacked: number;
    computed: number;
    mock: number;
    missing: number;
    notApplicable: number;
    blockedRequired: number;
    nextAction: string;
  }>;
  cells: DecisionDataSourceCoverageCell[];
  topGaps: DecisionDataSourceCoverageCell[];
  controls: {
    canInspectReadOnly: true;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canCallOpenAI: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
};

type SlateInput = {
  sport: DecisionCoverageSport;
  rows: DecisionRow[];
  dataIntake: DecisionDataIntakeQueue;
  training: TrainingDataSnapshot;
};

const CATEGORIES: DecisionDataSignalCategory[] = [
  "fixtures",
  "historical-results",
  "standings",
  "home-away",
  "recent-form",
  "injuries",
  "suspensions",
  "lineups",
  "odds",
  "live-scores",
  "match-events",
  "news",
  "weather",
  "training"
];

const LABELS: Record<DecisionDataSignalCategory, string> = {
  fixtures: "Fixtures for the day",
  "historical-results": "Team/player historical results",
  standings: "League standings",
  "home-away": "Home/away performance",
  "recent-form": "Recent form",
  injuries: "Injuries",
  suspensions: "Suspensions",
  lineups: "Lineups when available",
  odds: "Bookmaker odds",
  "live-scores": "Live scores",
  "match-events": "Match events",
  news: "News signals",
  weather: "Weather where relevant",
  training: "10-year training corpus"
};

const REQUIREMENTS: Record<DecisionDataSignalCategory, string> = {
  fixtures: "Collect today's fixtures before slate ranking.",
  "historical-results": "Collect settled team/player historical results for model training and calibration.",
  standings: "Collect league standings or equivalent competition position context.",
  "home-away": "Track home/away or venue/surface split before weighting advantage.",
  "recent-form": "Track recent form windows for teams or players.",
  injuries: "Collect player injury or availability context where relevant.",
  suspensions: "Collect suspensions and other availability restrictions.",
  lineups: "Collect starting lineups, rotations, or confirmed participants when available.",
  odds: "Collect bookmaker odds before no-vig edge and EV ranking.",
  "live-scores": "Collect live score and match clock for in-play decisions.",
  "match-events": "Collect goals, cards, substitutions, injuries, or match events.",
  news: "Collect bounded news signals with source and timestamp.",
  weather: "Collect weather for outdoor football where relevant.",
  training: "Backfill real fixtures, odds, features, outcomes, and backtests before learned guardrails influence live trust."
};

const STORAGE_TABLES: Record<DecisionDataSignalCategory, string[]> = {
  fixtures: ["op_fixtures", "op_teams", "op_leagues"],
  "historical-results": ["op_fixtures", "op_fixture_team_features"],
  standings: ["op_standings_snapshots"],
  "home-away": ["op_fixture_team_features", "op_training_feature_snapshots"],
  "recent-form": ["op_fixture_team_features", "op_training_feature_snapshots"],
  injuries: ["op_player_availability_snapshots"],
  suspensions: ["op_player_availability_snapshots"],
  lineups: ["op_lineup_snapshots"],
  odds: ["op_odds_snapshots"],
  "live-scores": ["op_fixtures", "op_live_match_events"],
  "match-events": ["op_live_match_events"],
  news: ["op_news_signals"],
  weather: ["op_weather_snapshots"],
  training: ["op_training_feature_snapshots", "op_backtest_runs", "op_provider_ingestion_runs", "op_raw_provider_payloads"]
};

const PROVIDERS: Record<DecisionCoverageSport, Partial<Record<DecisionDataSignalCategory, string>>> = {
  football: {
    fixtures: "API-Football",
    "historical-results": "API-Football historical fixtures",
    standings: "API-Football standings",
    "home-away": "Historical fixture features",
    "recent-form": "API-Football form or stored feature windows",
    injuries: "API-Football injuries",
    suspensions: "API-Football availability/events",
    lineups: "API-Football lineups",
    odds: "The Odds API",
    "live-scores": "API-Football live fixtures",
    "match-events": "API-Football events",
    news: "NewsAPI",
    weather: "OpenWeather/weather provider",
    training: "OddsPadi Supabase op_ corpus"
  },
  basketball: {
    fixtures: "API-Basketball or sports provider",
    "historical-results": "API-Basketball historical games",
    standings: "API-Basketball standings",
    "home-away": "Historical game features",
    "recent-form": "API-Basketball form or stored feature windows",
    injuries: "Basketball injury/availability feed",
    suspensions: "Basketball availability feed",
    lineups: "Basketball starting lineup/rotation feed",
    odds: "The Odds API",
    "live-scores": "Basketball live scores provider",
    "match-events": "Basketball play-by-play provider",
    news: "NewsAPI or basketball news feed",
    training: "OddsPadi Supabase op_ corpus"
  },
  tennis: {
    fixtures: "API-Tennis or sports provider",
    "historical-results": "API-Tennis historical matches",
    "home-away": "Surface/venue feature history",
    "recent-form": "API-Tennis form or stored feature windows",
    injuries: "Tennis injury/withdrawal feed",
    odds: "The Odds API",
    "live-scores": "Tennis live scores provider",
    "match-events": "Tennis point/set event provider",
    news: "NewsAPI or tennis news feed",
    training: "OddsPadi Supabase op_ corpus"
  }
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

function unique(values: Array<string | null | undefined>, limit = 20): string[] {
  return Array.from(new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))).slice(0, limit);
}

function isApplicable(sport: DecisionCoverageSport, category: DecisionDataSignalCategory): boolean {
  if (category === "weather") return sport === "football";
  if (sport === "tennis" && (category === "standings" || category === "suspensions" || category === "lineups")) return false;
  return true;
}

function requiredForLive(sport: DecisionCoverageSport, category: DecisionDataSignalCategory): boolean {
  if (!isApplicable(sport, category)) return false;
  if (category === "weather" || category === "news" || category === "match-events" || category === "live-scores") return sport === "football";
  return true;
}

function signalsFor(rows: DecisionRow[], category: DecisionDataSignalCategory): DecisionDataCoverageSignal[] {
  return rows.flatMap((row) => row.prediction.decision.dataCoverage.signals.filter((signal) => signal.category === category));
}

function countStatus(signals: DecisionDataCoverageSignal[], status: DecisionDataSignalStatus): number {
  return signals.filter((signal) => signal.status === status).length;
}

function statusFor({
  applicable,
  providerBacked,
  computed,
  mock,
  missing,
  stale,
  notApplicable,
  trainingReady
}: {
  applicable: boolean;
  providerBacked: number;
  computed: number;
  mock: number;
  missing: number;
  stale: number;
  notApplicable: number;
  trainingReady?: boolean;
}): DecisionDataSourceCellStatus {
  if (!applicable || notApplicable > 0) return "not-applicable";
  if (trainingReady === true || (providerBacked > 0 && mock + missing + stale === 0)) return "provider-backed";
  if (computed > 0) return "computed";
  if (mock > 0) return "mock";
  return "missing";
}

function nextActionFor(status: DecisionDataSourceCellStatus, sport: DecisionCoverageSport, category: DecisionDataSignalCategory, missingEnv: string[]): string {
  if (status === "provider-backed") return "Keep refreshing this feed before each decision window and store freshness evidence.";
  if (status === "not-applicable") return "No live feed is required for this sport/category in the current MVP scope.";
  if (missingEnv.length) return `Configure ${missingEnv.join(", ")} and rerun the read-only provider dry-run.`;
  if (category === "training" || category === "historical-results") return `Backfill real ${sport} fixtures, odds, features, outcomes, and backtests into the op_ corpus.`;
  if (category === "odds") return "Run bookmaker odds dry-runs and compare model probability against no-vig market probability.";
  if (category === "injuries" || category === "suspensions" || category === "lineups" || category === "news") {
    return "Connect availability/news feeds and require source timestamps before using team-news adjustments.";
  }
  if (category === "live-scores" || category === "match-events") return "Connect live score/event feeds before enabling in-play recalculation.";
  return "Replace mock or computed coverage with provider-backed evidence before raising trust.";
}

function proofUrlFor(date: string, sport: DecisionCoverageSport, category: DecisionDataSignalCategory, intakeUrl: string | null): string {
  if (category === "training" || category === "historical-results") {
    return `/api/sports/decision/training?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`;
  }
  return intakeUrl ?? `/api/sports/decision/data-intake?sport=${sport}`;
}

function cellFor(date: string, slate: SlateInput, category: DecisionDataSignalCategory): DecisionDataSourceCoverageCell {
  const applicable = isApplicable(slate.sport, category);
  const signals = signalsFor(slate.rows, category);
  const providerBacked = countStatus(signals, "provider-backed");
  const computed = countStatus(signals, "computed");
  const mock = countStatus(signals, "mock");
  const missing = countStatus(signals, "missing");
  const stale = countStatus(signals, "stale");
  const notApplicable = countStatus(signals, "not-applicable");
  const intakeItem = slate.dataIntake.items.find((item) => item.category === category);
  const trainingReady = category === "training" || category === "historical-results" ? slate.training.readiness.readyForTraining : undefined;
  const status = statusFor({ applicable, providerBacked, computed, mock, missing, stale, notApplicable, trainingReady });
  const missingEnv = status === "not-applicable" ? [] : unique(intakeItem?.missingEnv ?? []);
  const required = requiredForLive(slate.sport, category);

  return {
    id: `${slate.sport}-${category}`,
    sport: slate.sport,
    category,
    label: LABELS[category],
    requirement: REQUIREMENTS[category],
    status,
    requiredForLive: required,
    provider: PROVIDERS[slate.sport][category] ?? "No sport-specific provider required",
    storageTables: STORAGE_TABLES[category],
    missingEnv,
    evidence: {
      totalSignals: signals.length,
      providerBacked,
      computed,
      mock,
      missing,
      stale,
      notApplicable,
      realTrainingRows: category === "training" || category === "historical-results" ? slate.training.counts.realFinishedFixtures : 0,
      realOddsSnapshots: category === "training" || category === "odds" ? slate.training.counts.realOddsSnapshots : 0,
      featureSnapshots: category === "training" ? slate.training.counts.featureSnapshots : 0
    },
    proofUrl: proofUrlFor(date, slate.sport, category, intakeItem?.verifyUrl ?? null),
    nextAction: nextActionFor(status, slate.sport, category, missingEnv)
  };
}

function rankGap(cell: DecisionDataSourceCoverageCell): number {
  if (!cell.requiredForLive) return 0;
  if (cell.status === "missing") return 5;
  if (cell.status === "mock") return 4;
  if (cell.status === "computed") return 3;
  return 0;
}

function coverageStatus(blockedRequired: number, mock: number, computed: number): DecisionDataSourceCoverageStatus {
  if (blockedRequired > 0) return "blocked";
  if (mock > 0 || computed > 0) return "needs-provider";
  return "ready-proof";
}

export function buildDecisionDataSourceCoverage({
  date,
  slates,
  now = new Date()
}: {
  date: string;
  slates: SlateInput[];
  now?: Date;
}): DecisionDataSourceCoverage {
  const cells = slates.flatMap((slate) => CATEGORIES.map((category) => cellFor(date, slate, category)));
  const totals = {
    sports: slates.length,
    cells: cells.length,
    providerBacked: cells.filter((cell) => cell.status === "provider-backed").length,
    computed: cells.filter((cell) => cell.status === "computed").length,
    mock: cells.filter((cell) => cell.status === "mock").length,
    missing: cells.filter((cell) => cell.status === "missing").length,
    notApplicable: cells.filter((cell) => cell.status === "not-applicable").length,
    blockedRequired: cells.filter((cell) => cell.requiredForLive && (cell.status === "missing" || cell.status === "mock")).length,
    readyRequired: cells.filter((cell) => cell.requiredForLive && cell.status === "provider-backed").length
  };
  const status = coverageStatus(totals.blockedRequired, totals.mock, totals.computed);
  const sports = slates.map((slate) => {
    const sportCells = cells.filter((cell) => cell.sport === slate.sport);
    const blockedRequired = sportCells.filter((cell) => cell.requiredForLive && (cell.status === "missing" || cell.status === "mock")).length;
    const mock = sportCells.filter((cell) => cell.status === "mock").length;
    const computed = sportCells.filter((cell) => cell.status === "computed").length;
    const topGap = sportCells.slice().sort((a, b) => rankGap(b) - rankGap(a))[0];
    return {
      sport: slate.sport,
      status: coverageStatus(blockedRequired, mock, computed),
      providerBacked: sportCells.filter((cell) => cell.status === "provider-backed").length,
      computed,
      mock,
      missing: sportCells.filter((cell) => cell.status === "missing").length,
      notApplicable: sportCells.filter((cell) => cell.status === "not-applicable").length,
      blockedRequired,
      nextAction: topGap?.nextAction ?? "Keep provider freshness attached to this sport."
    };
  });
  const topGaps = cells
    .filter((cell) => rankGap(cell) > 0)
    .sort((a, b) => rankGap(b) - rankGap(a) || a.sport.localeCompare(b.sport) || a.label.localeCompare(b.label))
    .slice(0, 12);
  const coverageHash = stableHash({
    date,
    status,
    totals,
    cells: cells.map((cell) => [cell.sport, cell.category, cell.status, cell.requiredForLive])
  });

  return {
    mode: "data-source-coverage",
    generatedAt: now.toISOString(),
    date,
    status,
    coverageHash,
    summary:
      status === "ready-proof"
        ? `Data-source coverage is provider-backed across ${totals.readyRequired} required live cell(s).`
        : status === "needs-provider"
          ? `Data-source coverage has provider evidence, but ${totals.computed + totals.mock} cell(s) still rely on computed or mock inputs.`
          : `Data-source coverage is blocked by ${totals.blockedRequired} required live data cell(s).`,
    totals,
    sports,
    cells,
    topGaps,
    controls: {
      canInspectReadOnly: true,
      canRunProviderDryRun: topGaps.some((cell) => !cell.missingEnv.length && cell.status !== "not-applicable"),
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canCallOpenAI: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/data-source-coverage",
      "/api/sports/decision/data-intake",
      "/api/sports/decision/provider-ingestion-evidence",
      "/api/sports/decision/context-signal-proof",
      "/api/sports/decision/training",
      "/api/sports/decision/training/multi-sport-corpus-plan",
      ...cells.map((cell) => cell.proofUrl)
    ]),
    locks: [
      "Coverage is read-only and cannot create provider rows, persist decisions, train models, publish picks, call OpenAI, or upgrade public action.",
      "Computed and mock cells can explain uncertainty, but they cannot raise trust by themselves.",
      "Weather is only required where sport and venue make it relevant; unavailable feeds must be explicit, not treated as neutral."
    ]
  };
}
