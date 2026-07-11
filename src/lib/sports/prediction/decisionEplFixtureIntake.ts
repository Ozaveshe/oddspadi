import { hasConfiguredEnv } from "@/lib/env";
import type { DecisionDataAuthority } from "@/lib/sports/prediction/decisionDataAuthority";
import type { DecisionDataSourceCoverage } from "@/lib/sports/prediction/decisionDataSourceCoverage";
import { EPL_2026_FIXTURE_SOURCE_URL, EPL_2026_OPENING_WINDOW, EPL_2026_SEASON } from "@/lib/sports/prediction/decisionEpl2026Fixtures";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

type EnvMap = Record<string, string | undefined>;

export type DecisionEplFixtureIntakeStatus = "ready-dry-run" | "needs-provider" | "needs-storage-proof" | "blocked";
export type DecisionEplFixtureIntakeCheckStatus = "pass" | "watch" | "block";
export type DecisionEplFixtureIntakeTaskStatus = "ready" | "waiting" | "blocked";

export type DecisionEplFixtureIntakeCheck = {
  id: "official-source" | "provider-key" | "storage-proof" | "fixture-mutability" | "preseason-context" | "odds-linkage";
  label: string;
  status: DecisionEplFixtureIntakeCheckStatus;
  evidence: string[];
  nextAction: string;
};

export type DecisionEplFixtureIntakeTask = {
  id:
    | "fetch-official-fixtures"
    | "normalize-teams"
    | "upsert-fixtures"
    | "track-fixture-changes"
    | "attach-context"
    | "attach-odds";
  label: string;
  status: DecisionEplFixtureIntakeTaskStatus;
  command: string | null;
  verifyUrl: string;
  missingEnv: string[];
  expectedEvidence: string;
};

export type DecisionEplFixtureIntake = {
  generatedAt: string;
  date: string;
  sport: "football";
  mode: "decision-epl-fixture-intake";
  status: DecisionEplFixtureIntakeStatus;
  intakeHash: string;
  summary: string;
  season: {
    competition: "Premier League";
    leagueId: "39";
    season: "2026/27";
    providerSeason: "2026";
    fixtureReleaseDate: "2026-06-19";
    seasonStartDate: "2026-08-21";
    finalMatchDate: "2027-05-30";
    totalFixtures: 380;
    targetDate: string;
    asOfDate: string;
    daysUntilStart: number;
    daysSinceRelease: number;
    kickoffTimesMutable: true;
    sourceUrl: string;
  };
  openingWindow: Array<{
    date: string;
    kickoff: string | null;
    home: string;
    away: string;
    broadcaster: string | null;
  }>;
  checks: DecisionEplFixtureIntakeCheck[];
  tasks: DecisionEplFixtureIntakeTask[];
  nextTask: DecisionEplFixtureIntakeTask | null;
  controls: {
    canInspectReadOnly: true;
    canRunFixtureDryRun: boolean;
    canWriteFixtures: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
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

function unique(values: Array<string | null | undefined>, limit = 32): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function boolEnv(env: EnvMap, key: string): boolean {
  return hasConfiguredEnv(env, key);
}

function dayDiff(from: string, to: string): number {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 0;
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function providerReady(env: EnvMap): boolean {
  return boolEnv(env, "API_FOOTBALL_KEY") || boolEnv(env, "APISPORTS_KEY") || boolEnv(env, "SPORTS_API_KEY");
}

function oddsReady(env: EnvMap): boolean {
  return boolEnv(env, "THE_ODDS_API_KEY") || boolEnv(env, "ODDS_API_KEY");
}

function adminReady(env: EnvMap): boolean {
  return boolEnv(env, "ODDSPADI_ADMIN_TOKEN");
}

function storageReady(dataAuthority: DecisionDataAuthority): boolean {
  return dataAuthority.status === "live-authorized" || dataAuthority.status === "dry-run-ready";
}

function officialOpeningWindow(): DecisionEplFixtureIntake["openingWindow"] {
  return EPL_2026_OPENING_WINDOW.map(({ date, kickoff, home, away, broadcaster }) => ({ date, kickoff, home, away, broadcaster }));
}

function checksFor({
  asOfDate,
  env,
  dataAuthority,
  dataSourceCoverage
}: {
  asOfDate: string;
  env: EnvMap;
  dataAuthority: DecisionDataAuthority;
  dataSourceCoverage: DecisionDataSourceCoverage;
}): DecisionEplFixtureIntakeCheck[] {
  const footballCoverage = dataSourceCoverage.sports.find((item) => item.sport === "football");
  const hasProvider = providerReady(env);
  const hasOdds = oddsReady(env);
  const hasStorage = storageReady(dataAuthority);
  return [
    {
      id: "official-source",
      label: "Official fixture source",
      status: "pass",
      evidence: ["released:2026-06-19", "fixtures:380", "starts:2026-08-21", `days-until-start:${Math.max(0, dayDiff(asOfDate, "2026-08-21"))}`],
      nextAction: "Treat the official Premier League fixture page as the season seed and verify provider IDs against it."
    },
    {
      id: "provider-key",
      label: "API-Football provider key",
      status: hasProvider ? "pass" : "block",
      evidence: [`API_FOOTBALL_KEY:${boolEnv(env, "API_FOOTBALL_KEY")}`, `APISPORTS_KEY:${boolEnv(env, "APISPORTS_KEY")}`, `SPORTS_API_KEY:${boolEnv(env, "SPORTS_API_KEY")}`],
      nextAction: hasProvider ? "Run a league 39 season 2026 fixture dry-run." : "Configure API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY before provider fixture dry-runs."
    },
    {
      id: "storage-proof",
      label: "Fixture storage proof",
      status: hasStorage ? "watch" : "block",
      evidence: [dataAuthority.status, dataAuthority.nextCommand.verifyUrl, `can-dry-run:${dataAuthority.controls.canRunProviderDryRun}`],
      nextAction: hasStorage ? "Keep write mode locked and review dry-run counts before upserting fixtures." : "Prove OddsPadi Supabase op_ schema and valid service-role credentials before fixture storage."
    },
    {
      id: "fixture-mutability",
      label: "Mutable kickoff policy",
      status: "pass",
      evidence: ["kickoffs:subject-to-change", "weekend-default:15:00 UK", "midweek-default:20:00 UK"],
      nextAction: "Store fixture IDs separately from kickoff timestamps and refresh TV/move changes before each matchweek."
    },
    {
      id: "preseason-context",
      label: "Preseason context",
      status: footballCoverage && footballCoverage.blockedRequired === 0 ? "watch" : "block",
      evidence: [`football-status:${footballCoverage?.status ?? "missing"}`, `blocked-required:${footballCoverage?.blockedRequired ?? "missing"}`, `provider-backed:${footballCoverage?.providerBacked ?? "missing"}`],
      nextAction: "Attach standings baseline, promoted clubs, transfers, injuries, lineups, news, and weather freshness before raising confidence."
    },
    {
      id: "odds-linkage",
      label: "Odds linkage",
      status: hasOdds ? "watch" : "block",
      evidence: [`THE_ODDS_API_KEY:${boolEnv(env, "THE_ODDS_API_KEY")}`, `ODDS_API_KEY:${boolEnv(env, "ODDS_API_KEY")}`],
      nextAction: hasOdds ? "Map EPL fixtures to bookmaker event IDs and record odds snapshot times." : "Configure THE_ODDS_API_KEY or ODDS_API_KEY before value-edge ranking can use live EPL markets."
    }
  ];
}

function statusFor(checks: DecisionEplFixtureIntakeCheck[], hasProvider: boolean, hasStorage: boolean): DecisionEplFixtureIntakeStatus {
  if (checks.some((check) => check.status === "block" && check.id === "storage-proof")) return "needs-storage-proof";
  if (!hasProvider) return "needs-provider";
  if (checks.some((check) => check.status === "block")) return "blocked";
  if (hasStorage) return "ready-dry-run";
  return "needs-storage-proof";
}

function task(input: DecisionEplFixtureIntakeTask): DecisionEplFixtureIntakeTask {
  return input;
}

function tasksFor({
  status,
  env,
  hasProvider,
  hasStorage,
  hasOdds
}: {
  status: DecisionEplFixtureIntakeStatus;
  env: EnvMap;
  hasProvider: boolean;
  hasStorage: boolean;
  hasOdds: boolean;
}): DecisionEplFixtureIntakeTask[] {
  const providerMissing = hasProvider ? [] : ["API_FOOTBALL_KEY or APISPORTS_KEY"];
  const adminMissing = adminReady(env) ? [] : ["ODDSPADI_ADMIN_TOKEN"];
  const storageMissing = hasStorage ? [] : ["verified op_ fixture schema", "valid SUPABASE_SERVICE_ROLE_KEY"];
  const oddsMissing = hasOdds ? [] : ["THE_ODDS_API_KEY or ODDS_API_KEY"];
  return [
    task({
      id: "fetch-official-fixtures",
      label: "Fetch EPL 2026/27 fixture dry-run",
      status: hasProvider ? "ready" : "blocked",
      command: hasProvider
        ? `${decisionCurlCommand("/api/sports/decision/training/provider-sync?provider=api-football&league=39&season=2026&date=2026-08-21&includeContext=1&dryRun=1")} -X POST -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`
        : null,
      verifyUrl: "/api/sports/decision/training/provider-sync?provider=api-football&league=39&season=2026&date=2026-08-21&includeContext=1&dryRun=1",
      missingEnv: providerMissing,
      expectedEvidence: "API-Football dry-run returns league 39 season 2026 fixtures normalized without writing rows."
    }),
    task({
      id: "normalize-teams",
      label: "Normalize EPL clubs and promoted teams",
      status: hasProvider ? "ready" : "blocked",
      command: null,
      verifyUrl: "/api/sports/decision/epl-fixture-intake",
      missingEnv: providerMissing,
      expectedEvidence: "Provider team IDs map to official EPL club names including promoted clubs Coventry City, Hull City, Leeds United, and Sunderland."
    }),
    task({
      id: "upsert-fixtures",
      label: "Upsert fixture rows after dry-run review",
      status: hasProvider && hasStorage && adminReady(env) ? "waiting" : "blocked",
      command: null,
      verifyUrl: "/api/sports/decision/provider-ingestion-evidence",
      missingEnv: unique([...providerMissing, ...adminMissing, ...storageMissing]),
      expectedEvidence: "Operator-reviewed dry-run counts match expected fixture coverage before any dryRun=0 write is allowed."
    }),
    task({
      id: "track-fixture-changes",
      label: "Track kickoff and TV changes",
      status: hasProvider ? "ready" : "blocked",
      command: null,
      verifyUrl: "/api/sports/decision/epl-fixture-intake",
      missingEnv: providerMissing,
      expectedEvidence: "Fixture refresh policy stores original kickoff, latest kickoff, source timestamp, broadcaster, and change reason."
    }),
    task({
      id: "attach-context",
      label: "Attach preseason context",
      status: status === "ready-dry-run" ? "waiting" : "blocked",
      command: null,
      verifyUrl: "/api/sports/decision/data-source-coverage?sport=football",
      missingEnv: providerMissing,
      expectedEvidence: "Each EPL fixture has standings baseline, recent form seed, injury/news watchlist, and weather freshness checks before matchweek."
    }),
    task({
      id: "attach-odds",
      label: "Attach bookmaker event IDs",
      status: hasOdds ? "waiting" : "blocked",
      command: null,
      verifyUrl: "/api/sports/decision/market-audit-matrix?sport=football",
      missingEnv: oddsMissing,
      expectedEvidence: "Bookmaker event IDs and first odds snapshots are linked to EPL fixture IDs before value-edge ranking."
    })
  ];
}

function nextTask(tasks: DecisionEplFixtureIntakeTask[]): DecisionEplFixtureIntakeTask | null {
  return tasks.find((item) => item.status === "ready") ?? tasks.find((item) => item.status === "waiting") ?? tasks[0] ?? null;
}

function summaryFor(status: DecisionEplFixtureIntakeStatus, season: DecisionEplFixtureIntake["season"], next: DecisionEplFixtureIntakeTask | null): string {
  if (status === "ready-dry-run") return `EPL 2026/27 fixture intake is ready for read-only dry-run before kickoff in ${season.daysUntilStart} day(s).`;
  if (status === "needs-provider") return "EPL 2026/27 fixture intake needs an API-Football/APISports key before provider dry-runs can start.";
  if (status === "needs-storage-proof") return "EPL 2026/27 fixture intake needs OddsPadi Supabase schema and credential proof before fixture storage can unlock.";
  return `EPL 2026/27 fixture intake is blocked; next task is ${next?.label ?? "not selected"}.`;
}

export function buildDecisionEplFixtureIntake({
  date,
  dataAuthority,
  dataSourceCoverage,
  env = process.env,
  now = new Date()
}: {
  date: string;
  dataAuthority: DecisionDataAuthority;
  dataSourceCoverage: DecisionDataSourceCoverage;
  env?: EnvMap;
  now?: Date;
}): DecisionEplFixtureIntake {
  const asOfDate = isoDate(now);
  const season: DecisionEplFixtureIntake["season"] = {
    competition: EPL_2026_SEASON.competition,
    leagueId: EPL_2026_SEASON.leagueId,
    season: EPL_2026_SEASON.season,
    providerSeason: EPL_2026_SEASON.providerSeason,
    fixtureReleaseDate: EPL_2026_SEASON.fixtureReleaseDate,
    seasonStartDate: EPL_2026_SEASON.seasonStartDate,
    finalMatchDate: EPL_2026_SEASON.finalMatchDate,
    totalFixtures: EPL_2026_SEASON.totalFixtures,
    targetDate: date,
    asOfDate,
    daysUntilStart: Math.max(0, dayDiff(asOfDate, "2026-08-21")),
    daysSinceRelease: dayDiff("2026-06-19", asOfDate),
    kickoffTimesMutable: true,
    sourceUrl: EPL_2026_FIXTURE_SOURCE_URL
  };
  const hasProvider = providerReady(env);
  const hasStorage = storageReady(dataAuthority);
  const hasOdds = oddsReady(env);
  const checks = checksFor({ asOfDate, env, dataAuthority, dataSourceCoverage });
  const status = statusFor(checks, hasProvider, hasStorage);
  const tasks = tasksFor({ status, env, hasProvider, hasStorage, hasOdds });
  const selectedTask = nextTask(tasks);
  const intakeHash = stableHash({
    date,
    season,
    status,
    checks: checks.map((check) => [check.id, check.status]),
    tasks: tasks.map((item) => [item.id, item.status, item.missingEnv])
  });

  return {
    generatedAt: now.toISOString(),
    date,
    sport: "football",
    mode: "decision-epl-fixture-intake",
    status,
    intakeHash,
    summary: summaryFor(status, season, selectedTask),
    season,
    openingWindow: officialOpeningWindow(),
    checks: checks.map((check) => ({
      ...check,
      evidence: unique(check.evidence, 8),
      nextAction: compact(check.nextAction)
    })),
    tasks,
    nextTask: selectedTask,
    controls: {
      canInspectReadOnly: true,
      canRunFixtureDryRun: Boolean(selectedTask?.status === "ready" && selectedTask.command),
      canWriteFixtures: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/epl-fixture-intake",
      "/api/sports/decision/data-authority",
      "/api/sports/decision/data-source-coverage",
      "/api/sports/decision/provider-ingestion-evidence",
      selectedTask?.verifyUrl,
      dataAuthority.nextCommand.verifyUrl,
      ...dataAuthority.proofUrls,
      ...dataSourceCoverage.proofUrls
    ]),
    locks: unique([
      "EPL fixture intake is read-only until provider dry-run counts, Supabase schema proof, and operator review pass.",
      "Official fixtures are subject to change; kickoff timestamps must remain mutable and source-stamped.",
      "Do not publish picks, train models, write fixture rows, or attach odds from this intake planner alone.",
      "Bookmaker odds must be linked by provider event ID and snapshot timestamp before value-edge ranking.",
      ...dataAuthority.locks,
      ...dataSourceCoverage.locks
    ])
  };
}
