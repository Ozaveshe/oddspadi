import { randomUUID } from "node:crypto";
import type { DecisionSummary, Match, Prediction } from "@/lib/sports/types";
import {
  buildCanonicalDecision,
  decisionThresholdsForSport,
  refreshCanonicalDecision,
} from "@/lib/sports/prediction/canonicalDecision";
import type {
  CanonicalDecision,
  CanonicalFixture,
  CanonicalOddsSnapshot,
  ProviderRunLog,
  ProviderRunStatus,
  SlateFixture,
  SlatePublicStatus,
  SportsSlate
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

function finiteDate(value: string | undefined, fallback: Date): Date {
  const parsed = value ? new Date(value) : fallback;
  return Number.isFinite(parsed.getTime()) ? parsed : fallback;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function utcDateWindow(start: Date, count: number, offsetDays = 0): string[] {
  const midnight = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  return Array.from({ length: Math.max(0, count) }, (_, index) => {
    const date = new Date(midnight.getTime() + (index + offsetDays) * DAY_MS);
    return date.toISOString().slice(0, 10);
  });
}

export function isProductionRuntime(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production" || env.CONTEXT === "production";
}

export function canUseMockFixtures(env: Record<string, string | undefined> = process.env): boolean {
  return !isProductionRuntime(env) && (env.NODE_ENV === "development" || env.NODE_ENV === "test" || env.VITEST === "true");
}

export function isProviderBackedMatch(match: Match): boolean {
  return Boolean(
    match.dataSource?.kind === "provider" &&
      match.dataSource.fixtureProvider &&
      match.dataSource.fixtureProviderId &&
      !match.id.toLowerCase().includes("mock")
  );
}

export function normalizeCanonicalFixture(match: Match, now = new Date()): CanonicalFixture {
  if (!isProviderBackedMatch(match)) throw new Error(`Fixture ${match.id} is not provider-backed.`);
  const syncedAt = finiteDate(match.dataSource?.fetchedAt, now).toISOString();
  return {
    fixtureId: match.id,
    providerFixtureId: match.dataSource?.fixtureProviderId ?? match.id,
    sport: match.sport,
    league: match.league.name,
    leagueId: match.league.id,
    country: match.league.country,
    season: match.dataSource?.season ?? null,
    kickoffAt: match.kickoffTime,
    homeTeam: { id: match.homeTeam.id, name: match.homeTeam.name, logo: match.homeTeam.logo },
    awayTeam: { id: match.awayTeam.id, name: match.awayTeam.name, logo: match.awayTeam.logo },
    status: match.status,
    score: match.score ? { ...match.score } : null,
    provider: match.dataSource?.fixtureProvider ?? "unknown",
    lastSyncedAt: syncedAt,
    dataQuality: clamp01(match.dataQualityScore)
  };
}

export function normalizeOddsSnapshots(
  match: Match,
  now = new Date(),
  freshnessMinutes = decisionThresholdsForSport(match.sport).maximumOddsAgeMinutes
): CanonicalOddsSnapshot[] {
  if (!isProviderBackedMatch(match)) return [];
  const captured = finiteDate(match.dataSource?.oddsCapturedAt ?? match.dataSource?.fetchedAt, now);
  const expiresAt = new Date(captured.getTime() + Math.max(1, freshnessMinutes) * 60_000).toISOString();
  const provider = match.dataSource?.oddsProvider ?? match.dataSource?.fixtureProvider ?? "unknown";

  return match.oddsMarkets.flatMap((market) =>
    market.selections
      .filter((selection) => Number.isFinite(selection.decimalOdds) && selection.decimalOdds > 1)
      .map((selection) => ({
        oddsSnapshotId: null,
        fixtureId: match.id,
        market: market.id,
        selection: selection.id,
        label: selection.label,
        decimalOdds: selection.decimalOdds,
        bookmaker: market.bookmaker?.name ?? provider,
        provider,
        capturedAt: captured.toISOString(),
        source: provider,
        isLive: match.status === "live",
        expiresAt
      }))
  );
}

function rowDecisionStatus(status: DecisionSummary["allMarketAnalyses"][number]["analysisStatus"]): CanonicalDecision["decisionStatus"] {
  if (status === "published_value_pick") return "published_value_pick";
  if (status === "lean") return "published_lean";
  if (status === "watchlist") return "watchlist";
  if (status === "needs_data") return "needs_data";
  if (status === "stale") return "stale";
  if (status === "suspended") return "suspended";
  return "avoid";
}

function rowPublicStatus(
  status: DecisionSummary["allMarketAnalyses"][number]["analysisStatus"]
): CanonicalDecision["publicStatus"] {
  if (status === "published_value_pick") return "value_pick";
  if (status === "lean") return "lean";
  if (status === "watchlist") return "watchlist";
  if (status === "stale") return "stale";
  if (status === "no_clear_value") return "no_clear_value";
  // The market-row schema predates canonical summaries. Overall needs-data and
  // suspended states are persisted on the summary record, not inferred here.
  return "needs_review";
}

export function buildCanonicalDecisionForPrediction(
  match: Match,
  prediction: Prediction,
  snapshots: CanonicalOddsSnapshot[],
  now = new Date()
): DecisionSummary {
  return buildCanonicalDecision(
    match,
    snapshots,
    {
      valueEdges: prediction.valueEdges,
      diagnostics: prediction.diagnostics,
      decision: prediction.decision,
      generatedAt: prediction.generatedAt
    },
    match.providerContextSignals ?? [],
    { now, allowMockFixtures: !isProductionRuntime() }
  );
}

export function buildCanonicalDecisions(
  match: Match,
  prediction: Prediction,
  snapshots: CanonicalOddsSnapshot[],
  options: { now?: Date; preliminary?: boolean } = {}
): CanonicalDecision[] {
  const summary = buildCanonicalDecisionForPrediction(match, prediction, snapshots, options.now ?? new Date());
  const snapshotBySelection = new Map(snapshots.map((snapshot) => [`${snapshot.market}:${snapshot.selection}`, snapshot]));
  return summary.allMarketAnalyses.map((analysis) => {
    const snapshot = snapshotBySelection.get(`${analysis.marketId}:${analysis.selectionId}`) ?? null;
    return {
      decisionId: randomUUID(),
      fixtureId: match.id,
      market: analysis.marketId,
      selection: analysis.selectionId,
      label: analysis.label,
      oddsSnapshotId: snapshot?.oddsSnapshotId ?? analysis.oddsSnapshotId,
      modelVersion: prediction.diagnostics.modelVersion,
      engineVersion: prediction.decision.engineVersion,
      modelProbability: analysis.modelProbability,
      impliedProbability: analysis.rawImpliedProbability,
      noVigProbability: analysis.noVigImpliedProbability,
      valueEdge: analysis.edge,
      expectedValue: analysis.expectedValue,
      decimalOdds: analysis.odds,
      confidence: analysis.confidence,
      risk: analysis.risk,
      dataQuality: analysis.dataQuality,
      evidenceQuality: analysis.evidenceQuality,
      decisionStatus: rowDecisionStatus(analysis.analysisStatus),
      publicStatus: rowPublicStatus(analysis.analysisStatus),
      reason: analysis.publicationEligible
        ? "This market is the canonical published value pick."
        : analysis.blockers[0] ?? summary.noPickReason ?? "No clear value found.",
      generatedAt: summary.generatedAt,
      expiresAt: analysis.expiresAt,
      supersededBy: null,
      settlementStatus: match.status === "finished" ? "needs_review" : "pending",
      isPreliminary: options.preliminary ?? false,
      provider: match.dataSource?.fixtureProvider ?? "unknown"
    };
  });
}

const STATUS_PRIORITY: Record<SlatePublicStatus, number> = {
  value_pick: 90,
  lean: 80,
  watchlist: 70,
  ready: 60,
  preliminary: 50,
  stale: 40,
  needs_data: 25,
  suspended: 24,
  settled: 30,
  needs_review: 20,
  no_clear_value: 10
};

function decisionAt(decision: CanonicalDecision, asOf: string): CanonicalDecision {
  if (
    !decision.expiresAt ||
    decision.settlementStatus !== "pending" ||
    decision.decisionStatus === "settled" ||
    decision.decisionStatus === "void" ||
    decision.decisionStatus === "stale" ||
    new Date(decision.expiresAt).getTime() > new Date(asOf).getTime()
  ) {
    return decision;
  }
  return {
    ...decision,
    decisionStatus: "stale",
    publicStatus: "stale",
    reason: "The supporting odds snapshot expired after this decision was generated; a refresh is required before publication."
  };
}

export function buildSportsSlate({
  scope,
  fixtures,
  oddsByFixture,
  decisionsByFixture,
  decisionSummariesByFixture,
  range,
  providerStatus,
  providerErrors = [],
  lastRun = null,
  generatedAt = new Date().toISOString()
}: {
  scope: SportsSlate["scope"];
  fixtures: CanonicalFixture[];
  oddsByFixture: Map<string, CanonicalOddsSnapshot[]>;
  decisionsByFixture: Map<string, CanonicalDecision[]>;
  decisionSummariesByFixture: Map<string, DecisionSummary>;
  range: SportsSlate["range"];
  providerStatus: ProviderRunStatus;
  providerErrors?: string[];
  lastRun?: ProviderRunLog | null;
  generatedAt?: string;
}): SportsSlate {
  const slateFixtures: SlateFixture[] = fixtures
    .filter((fixture) => fixture.provider && !fixture.provider.toLowerCase().includes("mock"))
    .map((fixture) => {
      const decisions = (decisionsByFixture.get(fixture.fixtureId) ?? []).map((decision) => decisionAt(decision, generatedAt));
      const storedSummary = decisionSummariesByFixture.get(fixture.fixtureId);
      const decisionSummary = refreshCanonicalDecision(
        storedSummary ?? {
          fixtureId: fixture.fixtureId,
          bestPublishedPick: null,
          bestLean: null,
          bestWatchlistCandidate: null,
          noPickReason: "The canonical engine has not analysed this provider-backed fixture yet.",
          allMarketAnalyses: [],
          publicStatus: "needs_data",
          engineStatus: "needs-data",
          dataQuality: fixture.dataQuality,
          evidenceQuality: fixture.dataQuality >= 0.62 ? "acceptable" : fixture.dataQuality >= 0.45 ? "thin" : "missing",
          confidence: "low",
          risk: "high",
          generatedAt,
          expiresAt: null,
          auditSummary: {
            thresholdProfile: fixture.sport,
            thresholds: decisionThresholdsForSport(fixture.sport),
            marketsAnalysed: 0,
            publishedCandidates: 0,
            leanCandidates: 0,
            watchlistCandidates: 0,
            staleCandidates: 0,
            enginePublicationAllowed: false,
            providerBacked: true,
            contextSignalsSeen: 0,
            blockers: ["canonical engine run is pending"],
            publicInvariantPassed: true
          }
        },
        new Date(generatedAt)
      );
      const hasPreliminaryDecision = decisions.some((decision) => decision.isPreliminary);
      const hasFinalDecision = decisions.some((decision) => !decision.isPreliminary);
      const hasStaleDecision = decisions.some((decision) => decision.publicStatus === "stale");
      const publicStatus: SlatePublicStatus = fixture.status === "finished"
        ? "settled"
        : hasStaleDecision || decisionSummary.publicStatus === "stale"
          ? "stale"
          : scope === "weekly" && hasPreliminaryDecision && !hasFinalDecision
            ? decisionSummary.publicStatus === "watchlist"
              ? "watchlist"
              : oddsByFixture.get(fixture.fixtureId)?.some((snapshot) => Date.parse(snapshot.expiresAt) > Date.parse(generatedAt))
                ? "ready"
                : "preliminary"
            : scope === "weekly" && !decisions.length
              ? "preliminary"
              : decisionSummary.publicStatus;
      const bestDecision = decisions.slice().sort((left, right) => {
        const status = STATUS_PRIORITY[right.publicStatus] - STATUS_PRIORITY[left.publicStatus];
        if (status !== 0) return status;
        return (right.expectedValue ?? Number.NEGATIVE_INFINITY) - (left.expectedValue ?? Number.NEGATIVE_INFINITY);
      })[0] ?? null;
      return { fixture, odds: oddsByFixture.get(fixture.fixtureId) ?? [], decisions, decisionSummary, publicStatus, bestDecision };
    })
    .sort((left, right) => left.fixture.kickoffAt.localeCompare(right.fixture.kickoffAt));

  const grouped = new Map<string, SlateFixture[]>();
  for (const fixture of slateFixtures) {
    const date = fixture.fixture.kickoffAt.slice(0, 10);
    grouped.set(date, [...(grouped.get(date) ?? []), fixture]);
  }
  const groupedByDate = [...grouped.entries()].map(([date, dateFixtures]) => ({ date, fixtures: dateFixtures }));
  const valuePicks = slateFixtures.filter((fixture) => fixture.publicStatus === "value_pick");
  const leans = slateFixtures.filter((fixture) => fixture.publicStatus === "lean");
  const watchlist = slateFixtures.filter((fixture) => fixture.publicStatus === "watchlist" || fixture.publicStatus === "stale");
  const noPicks = slateFixtures.filter((fixture) =>
    fixture.publicStatus === "no_clear_value" ||
    fixture.publicStatus === "needs_review" ||
    fixture.publicStatus === "needs_data" ||
    fixture.publicStatus === "suspended"
  );
  const providers = Array.from(new Set(fixtures.map((fixture) => fixture.provider).filter(Boolean))).sort();

  return {
    scope,
    generatedAt,
    range,
    provider: { status: providerStatus, providers, lastRun, errors: providerErrors },
    summary: {
      fixturesFound: slateFixtures.length,
      predictionsGenerated: slateFixtures.filter((fixture) => fixture.decisionSummary.allMarketAnalyses.length > 0).length,
      valuePicksPublished: valuePicks.length,
      leansPublished: leans.length,
      watchlist: watchlist.length,
      noPickMatches: noPicks.length,
      preliminaryDecisions: slateFixtures.filter((fixture) => fixture.publicStatus === "preliminary").length,
      readyDecisions: slateFixtures.filter((fixture) => fixture.publicStatus === "ready").length,
      staleDecisions: slateFixtures.filter((fixture) => fixture.publicStatus === "stale").length,
      settledFixtures: slateFixtures.filter((fixture) => fixture.publicStatus === "settled").length,
      oddsSnapshotsUsed: slateFixtures.reduce((sum, fixture) => sum + fixture.odds.length, 0)
    },
    fixtures: slateFixtures,
    groupedByDate,
    groups: { valuePicks, leans, watchlist, allAnalysed: slateFixtures, noPicks }
  };
}
