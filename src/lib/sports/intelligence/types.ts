import type { ConfidenceLevel, DecisionSummary, EvidenceQuality, RiskLevel, Sport } from "@/lib/sports/types";

export type CanonicalFixtureStatus = "scheduled" | "live" | "finished" | "postponed" | "cancelled" | "suspended";

export type CanonicalFixture = {
  fixtureId: string;
  providerFixtureId: string;
  sport: Sport;
  league: string;
  leagueId: string;
  country: string;
  season: string | null;
  kickoffAt: string;
  homeTeam: { id: string; name: string; logo?: string | null };
  awayTeam: { id: string; name: string; logo?: string | null };
  status: CanonicalFixtureStatus;
  score: { home: number; away: number; minute?: number } | null;
  provider: string;
  lastSyncedAt: string;
  dataQuality: number;
};

export type CanonicalOddsSnapshot = {
  oddsSnapshotId: string | null;
  fixtureId: string;
  market: string;
  selection: string;
  label: string;
  decimalOdds: number;
  bookmaker: string;
  provider: string;
  capturedAt: string;
  source: string;
  isLive: boolean;
  expiresAt: string;
};

export type FixtureOddsHistory = {
  status: "ready" | "no-data" | "unavailable" | "failed";
  snapshots: CanonicalOddsSnapshot[];
  rowsRead: number;
  truncated: boolean;
  reason: string | null;
};

export type DecisionStatus =
  | "published_value_pick"
  | "published_lean"
  | "watchlist"
  | "avoid"
  | "needs_data"
  | "stale"
  | "suspended"
  | "settled"
  | "void";

export type SlatePublicStatus =
  | "value_pick"
  | "lean"
  | "watchlist"
  | "no_clear_value"
  | "preliminary"
  | "ready"
  | "stale"
  | "needs_data"
  | "suspended"
  | "settled"
  | "needs_review";

export type CanonicalDecision = {
  decisionId: string;
  fixtureId: string;
  market: string;
  selection: string;
  label: string;
  oddsSnapshotId: string | null;
  modelVersion: string;
  engineVersion: string;
  modelProbability: number | null;
  impliedProbability: number | null;
  noVigProbability: number | null;
  valueEdge: number | null;
  expectedValue: number | null;
  decimalOdds: number | null;
  confidence: ConfidenceLevel;
  risk: RiskLevel;
  dataQuality: number;
  evidenceQuality: EvidenceQuality;
  decisionStatus: DecisionStatus;
  publicStatus: SlatePublicStatus;
  reason: string;
  generatedAt: string;
  expiresAt: string | null;
  supersededBy: string | null;
  settlementStatus: "pending" | "won" | "lost" | "push" | "void" | "needs_review";
  isPreliminary: boolean;
  provider: string;
};

export type ProviderRunStatus = "running" | "completed" | "partial" | "empty" | "failed" | "unavailable";

export type ProviderRunLog = {
  runId: string | null;
  providerName: string;
  jobType: string;
  startedAt: string;
  finishedAt: string | null;
  status: ProviderRunStatus;
  fixturesFound: number;
  oddsFound: number;
  predictionsGenerated: number;
  valuePicksPublished: number;
  errors: string[];
};

export type ProviderRunClaim = {
  run: ProviderRunLog;
  acquired: boolean;
};

export type SlateFixture = {
  fixture: CanonicalFixture;
  odds: CanonicalOddsSnapshot[];
  decisions: CanonicalDecision[];
  decisionSummary: DecisionSummary;
  publicStatus: SlatePublicStatus;
  bestDecision: CanonicalDecision | null;
};

export type SportsSlate = {
  scope: "daily" | "weekly";
  generatedAt: string;
  range: { from: string; to: string };
  provider: {
    status: ProviderRunStatus;
    providers: string[];
    lastRun: ProviderRunLog | null;
    errors: string[];
  };
  summary: {
    fixturesFound: number;
    predictionsGenerated: number;
    valuePicksPublished: number;
    leansPublished: number;
    watchlist: number;
    noPickMatches: number;
    preliminaryDecisions: number;
    readyDecisions: number;
    staleDecisions: number;
    settledFixtures: number;
    oddsSnapshotsUsed: number;
  };
  fixtures: SlateFixture[];
  groupedByDate: Array<{ date: string; fixtures: SlateFixture[] }>;
  groups: {
    valuePicks: SlateFixture[];
    leans: SlateFixture[];
    watchlist: SlateFixture[];
    allAnalysed: SlateFixture[];
    noPicks: SlateFixture[];
  };
};

export type PipelineRunResult = {
  run: ProviderRunLog;
  slate: SportsSlate;
  rejectedMockFixtures: number;
  persisted: boolean;
  skippedOverlap: boolean;
};
