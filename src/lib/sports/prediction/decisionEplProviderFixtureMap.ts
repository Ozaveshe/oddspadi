import { hasAnyConfiguredEnv } from "@/lib/env";
import type { DecisionEplFixtureIntake } from "@/lib/sports/prediction/decisionEplFixtureIntake";
import type { DecisionEplProviderDryRunInterpreter } from "@/lib/sports/prediction/decisionEplProviderDryRunInterpreter";
import type { DecisionEplProviderDryRunReceipt } from "@/lib/sports/prediction/decisionEplProviderDryRunReceipt";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Match } from "@/lib/sports/types";

type EnvMap = Record<string, string | undefined>;

export type DecisionEplProviderFixtureMapStatus =
  | "ready-admin-dry-run"
  | "waiting-provider-key"
  | "waiting-admin-token"
  | "waiting-provider-proof"
  | "waiting-storage-proof"
  | "blocked";

export type DecisionEplProviderFixtureMapRowStatus = "ready-dry-run" | "needs-provider" | "needs-admin" | "needs-storage" | "mapped-shadow";

export type DecisionEplProviderFixtureMapOddsEventIdentity = {
  provider: "the-odds-api";
  status: "matched" | "missing" | "unavailable";
  eventId: string | null;
  matchId: string | null;
  kickoffTime: string | null;
  eventKey: string;
  sourceFixtureProvider: string | null;
  sourceOddsProvider: string | null;
  confidence: "high" | "medium" | "low";
  evidence: string[];
  nextAction: string;
};

type DecisionEplProviderFixtureMapPredictionRow = {
  match: Match;
};

export type DecisionEplProviderFixtureMapRow = {
  id: string;
  date: string;
  kickoff: string | null;
  match: string;
  home: string;
  away: string;
  broadcaster: string | null;
  status: DecisionEplProviderFixtureMapRowStatus;
  providerLookup: {
    provider: "api-football";
    league: "39";
    season: "2026";
    endpointPath: string;
    matchKey: string;
    requiredParams: string[];
  };
  oddsLookup: {
    provider: "the-odds-api";
    sportKey: string;
    eventKey: string;
    requiresSnapshot: true;
  };
  oddsEventIdentity: DecisionEplProviderFixtureMapOddsEventIdentity;
  contextGates: Array<{
    id: "standings" | "recent-form" | "injuries" | "lineups" | "news" | "weather" | "odds";
    status: "watch" | "block";
    nextAction: string;
  }>;
  storageTargets: string[];
  missing: string[];
  nextAction: string;
};

export type DecisionEplProviderFixtureMap = {
  generatedAt: string;
  date: string;
  sport: "football";
  mode: "decision-epl-provider-fixture-map";
  status: DecisionEplProviderFixtureMapStatus;
  mapHash: string;
  summary: string;
  season: DecisionEplFixtureIntake["season"];
  totals: {
    fixtures: number;
    readyDryRun: number;
    needsProvider: number;
    needsAdmin: number;
    needsStorage: number;
    mappedShadow: number;
    oddsEventMatched: number;
    oddsEventMissing: number;
    contextBlocks: number;
  };
  providerPlan: {
    provider: "api-football";
    league: "39";
    season: "2026";
    dateWindow: string[];
    dryRunCommand: string | null;
    receiptUrl: string;
    interpreterUrl: string;
    requiresAdminHeader: true;
  };
  providerDryRun: {
    requested: boolean;
    receiptStatus: DecisionEplProviderDryRunReceipt["status"];
    interpreterStatus: DecisionEplProviderDryRunInterpreter["status"];
    normalized: number;
    fixtures: number;
    standings: number;
    availability: number;
    lineups: number;
    endpoint: string | null;
    proofHash: string | null;
    reason: string | null;
    nextAction: string;
  };
  rows: DecisionEplProviderFixtureMapRow[];
  selectedRow: DecisionEplProviderFixtureMapRow | null;
  controls: {
    canInspectReadOnly: true;
    canRequestAdminDryRun: boolean;
    canUseProviderProofForStorageReview: boolean;
    canWriteFixtures: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canWriteTrainingRows: false;
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

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function normalizedTeam(value: string): string {
  return slug(value)
    .replace(/^the-/, "")
    .replace(/\bfc\b/g, "")
    .replace(/-football-club\b/g, "")
    .replace(/-city\b/g, "-city")
    .replace(/--+/g, "-")
    .replace(/^-|-$/g, "");
}

function kickoffDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^\d{4}-\d{2}-\d{2}/);
  return match?.[0] ?? null;
}

function oddsEventId(matchId: string): string | null {
  return matchId.startsWith("the-odds-api:") ? matchId.replace("the-odds-api:", "") || null : null;
}

function findOddsEventIdentity({
  fixture,
  eventKey,
  predictionRows
}: {
  fixture: DecisionEplFixtureIntake["openingWindow"][number];
  eventKey: string;
  predictionRows: DecisionEplProviderFixtureMapPredictionRow[];
}): DecisionEplProviderFixtureMapOddsEventIdentity {
  const expectedHome = normalizedTeam(fixture.home);
  const expectedAway = normalizedTeam(fixture.away);
  const match = predictionRows.find((row) => {
    const source = row.match.dataSource;
    if (source?.fixtureProvider !== "the-odds-api-events" && source?.oddsProvider !== "the-odds-api") return false;
    if (kickoffDate(row.match.kickoffTime) !== fixture.date) return false;
    return normalizedTeam(row.match.homeTeam.name) === expectedHome && normalizedTeam(row.match.awayTeam.name) === expectedAway;
  })?.match;

  if (!predictionRows.length) {
    return {
      provider: "the-odds-api",
      status: "unavailable",
      eventId: null,
      matchId: null,
      kickoffTime: null,
      eventKey,
      sourceFixtureProvider: null,
      sourceOddsProvider: null,
      confidence: "low",
      evidence: ["No prediction rows were available to compare against the official EPL fixture seed."],
      nextAction: "Fetch football predictions for the fixture date with The Odds API configured, then compare event IDs."
    };
  }

  if (!match) {
    return {
      provider: "the-odds-api",
      status: "missing",
      eventId: null,
      matchId: null,
      kickoffTime: null,
      eventKey,
      sourceFixtureProvider: null,
      sourceOddsProvider: null,
      confidence: "low",
      evidence: [`No The Odds API event matched ${fixture.home} vs ${fixture.away} on ${fixture.date}.`],
      nextAction: "Keep market identity untrusted for this fixture until a same-date home/away Odds API event is returned."
    };
  }

  const source = match.dataSource;
  return {
    provider: "the-odds-api",
    status: "matched",
    eventId: oddsEventId(match.id),
    matchId: match.id,
    kickoffTime: match.kickoffTime,
    eventKey,
    sourceFixtureProvider: source?.fixtureProvider ?? null,
    sourceOddsProvider: source?.oddsProvider ?? null,
    confidence: match.oddsMarkets.length > 0 ? "high" : "medium",
    evidence: unique(
      [
        `matched:${match.homeTeam.name} vs ${match.awayTeam.name}`,
        `kickoff:${match.kickoffTime}`,
        `markets:${match.oddsMarkets.length}`,
        `fixtureProvider:${source?.fixtureProvider ?? "unknown"}`,
        `oddsProvider:${source?.oddsProvider ?? "unknown"}`,
        ...(source?.notes ?? [])
      ],
      8
    ),
    nextAction:
      "Use this Odds API event as read-only market identity, then map the same fixture to API-Football/APISports fixture ID, teams, standings, availability, and context before promotion."
  };
}

function hasAny(env: EnvMap, keys: string[]): boolean {
  return hasAnyConfiguredEnv(env, keys);
}

function rowStatus({
  providerReady,
  adminReady,
  storageReady,
  providerProofReady
}: {
  providerReady: boolean;
  adminReady: boolean;
  storageReady: boolean;
  providerProofReady: boolean;
}): DecisionEplProviderFixtureMapRowStatus {
  if (!providerReady) return "needs-provider";
  if (!adminReady) return "needs-admin";
  if (providerProofReady) return storageReady ? "mapped-shadow" : "needs-storage";
  return "ready-dry-run";
}

function contextGates(oddsReady: boolean): DecisionEplProviderFixtureMapRow["contextGates"] {
  return [
    {
      id: "standings",
      status: "block",
      nextAction: "Fetch season 2026 standings baseline before model confidence can rise."
    },
    {
      id: "recent-form",
      status: "block",
      nextAction: "Backfill prior-season and preseason feature windows for both teams."
    },
    {
      id: "injuries",
      status: "block",
      nextAction: "Attach injury and suspension snapshots with provider timestamps."
    },
    {
      id: "lineups",
      status: "watch",
      nextAction: "Keep lineup gate pending until confirmed XI data is available near kickoff."
    },
    {
      id: "news",
      status: "block",
      nextAction: "Attach source-stamped team-news signals before public action upgrades."
    },
    {
      id: "weather",
      status: "block",
      nextAction: "Fetch venue weather only for outdoor football fixtures and timestamp it."
    },
    {
      id: "odds",
      status: oddsReady ? "watch" : "block",
      nextAction: oddsReady ? "Map bookmaker event IDs and first snapshot time." : "Configure THE_ODDS_API_KEY or ODDS_API_KEY."
    }
  ];
}

function statusFor({
  providerReady,
  adminReady,
  providerProofReady,
  storageReady
}: {
  providerReady: boolean;
  adminReady: boolean;
  providerProofReady: boolean;
  storageReady: boolean;
}): DecisionEplProviderFixtureMapStatus {
  if (!providerReady) return "waiting-provider-key";
  if (!adminReady) return "waiting-admin-token";
  if (!providerProofReady) return "ready-admin-dry-run";
  if (!storageReady) return "waiting-storage-proof";
  return "waiting-provider-proof";
}

function summaryFor(status: DecisionEplProviderFixtureMapStatus, totals: DecisionEplProviderFixtureMap["totals"]): string {
  if (status === "ready-admin-dry-run") return `EPL provider fixture map is ready to dry-run ${totals.fixtures} opening fixtures with writes locked.`;
  if (status === "waiting-provider-key") return "EPL provider fixture map is waiting for API-Football/APISports credentials.";
  if (status === "waiting-admin-token") return "EPL provider fixture map is waiting for ODDSPADI_ADMIN_TOKEN before any provider call.";
  if (status === "waiting-storage-proof") return "EPL provider fixture map has provider proof but is waiting for OddsPadi storage proof before upsert.";
  if (status === "waiting-provider-proof") return "EPL provider fixture map is mapped in shadow and waiting for operator storage review.";
  return "EPL provider fixture map is blocked by unsafe provider or storage state.";
}

export function buildDecisionEplProviderFixtureMap({
  intake,
  receipt,
  interpreter,
  predictionRows = [],
  env = process.env,
  now = new Date()
}: {
  intake: DecisionEplFixtureIntake;
  receipt: DecisionEplProviderDryRunReceipt;
  interpreter: DecisionEplProviderDryRunInterpreter;
  predictionRows?: DecisionEplProviderFixtureMapPredictionRow[];
  env?: EnvMap;
  now?: Date;
}): DecisionEplProviderFixtureMap {
  const providerReady = hasAny(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]) || receipt.target.providerKeyConfigured;
  const adminReady = hasAny(env, ["ODDSPADI_ADMIN_TOKEN"]) || receipt.target.adminTokenConfigured;
  const oddsReady = hasAny(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]);
  const providerProofReady = interpreter.controls.canUseProviderProofForStorageReview;
  const storageReady = intake.checks.find((check) => check.id === "storage-proof")?.status === "watch";
  const dateWindow = unique(intake.openingWindow.map((fixture) => fixture.date), 10);
  const rows = intake.openingWindow.map((fixture): DecisionEplProviderFixtureMapRow => {
    const match = `${fixture.home} vs ${fixture.away}`;
    const id = `${fixture.date}-${slug(fixture.home)}-${slug(fixture.away)}`;
    const gates = contextGates(oddsReady);
    const eventKey = `${slug(fixture.home)}-${slug(fixture.away)}-${fixture.date}`;
    const oddsEventIdentity = findOddsEventIdentity({ fixture, eventKey, predictionRows });
    const missing = unique([
      ...(providerReady ? [] : ["API_FOOTBALL_KEY or APISPORTS_KEY"]),
      ...(adminReady ? [] : ["ODDSPADI_ADMIN_TOKEN"]),
      ...(providerProofReady ? [] : ["admin-authorized provider dry-run proof"]),
      ...(storageReady ? [] : ["OddsPadi op_ storage proof"]),
      ...(oddsEventIdentity.status === "matched" ? [] : ["The Odds API event identity"]),
      ...gates.filter((gate) => gate.status === "block").map((gate) => gate.id)
    ]);
    const status = rowStatus({ providerReady, adminReady, storageReady, providerProofReady });
    return {
      id,
      date: fixture.date,
      kickoff: fixture.kickoff,
      match,
      home: fixture.home,
      away: fixture.away,
      broadcaster: fixture.broadcaster,
      status,
      providerLookup: {
        provider: "api-football",
        league: "39",
        season: "2026",
        endpointPath: `/fixtures?league=39&season=2026&date=${fixture.date}`,
        matchKey: `${slug(fixture.home)}:${slug(fixture.away)}`,
        requiredParams: ["league=39", "season=2026", `date=${fixture.date}`, "timezone=UTC"]
      },
      oddsLookup: {
        provider: "the-odds-api",
        sportKey: env.ODDS_API_FOOTBALL_SPORT_KEY?.trim() || "soccer_epl",
        eventKey,
        requiresSnapshot: true
      },
      oddsEventIdentity,
      contextGates: gates,
      storageTargets: ["op_fixtures", "op_teams", "op_leagues", "op_fixture_team_features", "op_odds_snapshots"],
      missing,
      nextAction:
        status === "ready-dry-run"
          ? "Run the admin-authorized provider dry-run and compare normalized rows against this official fixture seed."
          : status === "needs-provider"
            ? "Configure API-Football/APISports credentials."
            : status === "needs-admin"
              ? "Configure ODDSPADI_ADMIN_TOKEN and rerun the receipt with the admin header."
              : status === "needs-storage"
                ? "Prove OddsPadi Supabase op_ schema and service role before upsert."
                : "Keep mapped shadow-only until storage review approves writes."
    };
  });
  const totals = {
    fixtures: rows.length,
    readyDryRun: rows.filter((row) => row.status === "ready-dry-run").length,
    needsProvider: rows.filter((row) => row.status === "needs-provider").length,
    needsAdmin: rows.filter((row) => row.status === "needs-admin").length,
    needsStorage: rows.filter((row) => row.status === "needs-storage").length,
    mappedShadow: rows.filter((row) => row.status === "mapped-shadow").length,
    oddsEventMatched: rows.filter((row) => row.oddsEventIdentity.status === "matched").length,
    oddsEventMissing: rows.filter((row) => row.oddsEventIdentity.status !== "matched").length,
    contextBlocks: rows.reduce((sum, row) => sum + row.contextGates.filter((gate) => gate.status === "block").length, 0)
  };
  const status = statusFor({ providerReady, adminReady, providerProofReady, storageReady });
  const selectedRow = rows.find((row) => row.status === "ready-dry-run") ?? rows.find((row) => row.status === "needs-storage") ?? rows[0] ?? null;
  const receiptUrl = `/api/sports/decision/epl-provider-dry-run-receipt?date=${encodeURIComponent(intake.date)}&run=1`;
  const interpreterUrl = `/api/sports/decision/epl-provider-dry-run-interpreter?date=${encodeURIComponent(intake.date)}`;
  const mapHash = stableHash({
    intake: intake.intakeHash,
    receipt: receipt.receiptHash,
    interpreter: interpreter.interpreterHash,
    status,
    totals,
    rows: rows.map((row) => [row.id, row.status, row.providerLookup.endpointPath, row.oddsEventIdentity.status, row.oddsEventIdentity.eventId, row.missing])
  });

  return {
    generatedAt: now.toISOString(),
    date: intake.date,
    sport: "football",
    mode: "decision-epl-provider-fixture-map",
    status,
    mapHash,
    summary: summaryFor(status, totals),
    season: intake.season,
    totals,
    providerPlan: {
      provider: "api-football",
      league: "39",
      season: "2026",
      dateWindow,
      dryRunCommand: providerReady && adminReady ? decisionCurlCommand(receiptUrl) : null,
      receiptUrl,
      interpreterUrl,
      requiresAdminHeader: true
    },
    providerDryRun: {
      requested: receipt.verification.requested,
      receiptStatus: receipt.status,
      interpreterStatus: interpreter.status,
      normalized: receipt.observation.normalized,
      fixtures: receipt.observation.counts.fixtures,
      standings: receipt.observation.counts.standings,
      availability: receipt.observation.counts.availability,
      lineups: receipt.observation.counts.lineups,
      endpoint: receipt.observation.endpoint,
      proofHash: receipt.observation.responseHash,
      reason: receipt.observation.reason ?? receipt.observation.error,
      nextAction: interpreter.interpretation.nextAction
    },
    rows,
    selectedRow,
    controls: {
      canInspectReadOnly: true,
      canRequestAdminDryRun: status === "ready-admin-dry-run",
      canUseProviderProofForStorageReview: providerProofReady,
      canWriteFixtures: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canWriteTrainingRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/epl-provider-fixture-map",
      "/api/sports/decision/training/football-provider-fixture-feature-readiness",
      "/api/sports/decision/epl-provider-dry-run-receipt",
      "/api/sports/decision/epl-provider-dry-run-interpreter",
      "/api/sports/decision/epl-fixture-intake",
      ...receipt.proofUrls,
      ...interpreter.proofUrls,
      ...intake.proofUrls
    ]),
    locks: unique([
      "EPL provider fixture map is read-only and cannot write fixture, provider, decision, or training rows.",
      "Each fixture needs provider event ID proof, odds event ID proof, context evidence, and storage review before upsert.",
      "Dry-run evidence cannot raise probability, confidence, public action, published picks, or stake.",
      "Service-role keys and provider secrets must never appear in this packet.",
      ...receipt.locks,
      ...interpreter.locks,
      ...intake.locks
    ])
  };
}
