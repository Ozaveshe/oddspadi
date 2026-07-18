import type { SlateFixture, SlatePublicStatus } from "@/lib/sports/intelligence/types";
import type { DecisionMarketAnalysis } from "@/lib/sports/types";
import { publicWatchlistReason } from "@/lib/sports/prediction/publicDecisionCopy";

export type PredictionFreshness = "fresh" | "stale" | "waiting";

export type PredictionPresentation = {
  status: SlatePublicStatus;
  statusLabel: string;
  selection: DecisionMarketAnalysis | null;
  marketLabel: string | null;
  verdict: string;
  primaryReason: string;
  primaryRisk: string;
  freshness: PredictionFreshness;
  freshnessLabel: string;
  modelVersion: string | null;
  engineVersion: string | null;
  isPublishedPick: boolean;
  isCommunityOpinion: false;
  analysisHref: string;
  communityHref: string;
};

const STATUS_LABELS: Record<SlatePublicStatus, string> = {
  value_pick: "Value pick",
  lean: "Model lean",
  watchlist: "Watchlist",
  no_clear_value: "No pick",
  preliminary: "Preliminary",
  ready: "Ready",
  stale: "Price stale",
  needs_data: "Needs data",
  suspended: "Suspended",
  settled: "Settled",
  needs_review: "Needs review"
};

function readableMarket(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function displayedSlateDecision(row: SlateFixture): DecisionMarketAnalysis | null {
  return row.decisionSummary.bestPublishedPick
    ?? row.decisionSummary.bestLean
    ?? row.decisionSummary.bestWatchlistCandidate;
}

export function noPickExplanation(row: SlateFixture): string {
  if (row.publicStatus === "settled") {
    return "The match finished without a pre-match market-backed review, so OddsPadi will not create a retrospective pick.";
  }
  if (row.publicStatus === "stale") return "The supporting price expired and must be refreshed.";
  if (row.publicStatus === "preliminary") return "Odds or match context are not ready for a complete engine decision.";
  const analysis = row.decisionSummary.allMarketAnalyses.slice().sort((left, right) => right.edge - left.edge)[0];
  if (analysis?.blockers[0]) return analysis.blockers[0];
  if (analysis && analysis.odds < row.decisionSummary.auditSummary.thresholds.minimumOdds) return "The available odds are below the configured risk floor.";
  if (analysis && analysis.edge > 0 && analysis.edge < row.decisionSummary.auditSummary.thresholds.minimumValueEdge) return "The positive edge is below the publication threshold.";
  if (analysis && analysis.edge <= 0) return "The current price does not offer a positive model edge.";
  return row.decisionSummary.noPickReason ?? "The evidence is incomplete, so the engine did not publish a selection.";
}

function freshness(row: SlateFixture, asOf: string): { status: PredictionFreshness; label: string } {
  const selection = displayedSlateDecision(row);
  const expiresAt = selection?.expiresAt ?? row.decisionSummary.expiresAt;
  if (row.publicStatus === "stale" || (expiresAt && Date.parse(expiresAt) <= Date.parse(asOf))) {
    return { status: "stale", label: "Price expired" };
  }
  if (!expiresAt) return { status: "waiting", label: "Waiting for a fresh price" };
  return { status: "fresh", label: "Price checked" };
}

function verdict(row: SlateFixture, selection: DecisionMarketAnalysis | null): string {
  if (!selection) return noPickExplanation(row);
  if (row.publicStatus === "value_pick") return `${selection.label} clears the current publication gates.`;
  if (row.publicStatus === "lean") return `${selection.label} is the model preference, but not a full value claim.`;
  if (row.publicStatus === "watchlist") return `${selection.label} is interesting, but still blocked from publication.`;
  if (row.publicStatus === "stale") return `${selection.label} needs a fresh market price before it can be reconsidered.`;
  return noPickExplanation(row);
}

function reason(row: SlateFixture, selection: DecisionMarketAnalysis | null): string {
  if (!selection) return noPickExplanation(row);
  if (row.publicStatus === "watchlist" || row.publicStatus === "stale") return publicWatchlistReason(row.decisionSummary);
  if (row.publicStatus === "value_pick") return "The model edge, evidence quality and publication controls agree at this price.";
  if (row.publicStatus === "lean") return "The model prefers this side, while the value or confidence threshold remains incomplete.";
  return selection.blockers[0] ?? noPickExplanation(row);
}

function risk(row: SlateFixture, selection: DecisionMarketAnalysis | null, primaryReason: string): string {
  const blockers = [...(selection?.blockers ?? []), ...row.decisionSummary.auditSummary.blockers];
  const distinct = blockers.find((blocker) => blocker !== primaryReason);
  if (distinct) return distinct;
  if (row.decisionSummary.evidenceQuality === "thin" || row.decisionSummary.evidenceQuality === "missing") {
    return "The evidence base is too thin to treat the probability as stable.";
  }
  if (row.decisionSummary.risk === "high") return "The outcome remains highly sensitive to match and price uncertainty.";
  if (row.decisionSummary.risk === "medium") return "Normal match variance can still erase the estimated edge.";
  return "A model edge is an estimate, not a guarantee of the match outcome.";
}

export function buildPredictionPresentation(row: SlateFixture, asOf = row.decisionSummary.generatedAt): PredictionPresentation {
  const selection = displayedSlateDecision(row);
  const clock = freshness(row, asOf);
  const primaryReason = reason(row, selection);
  const matchId = encodeURIComponent(row.fixture.fixtureId);
  const matchup = `${row.fixture.homeTeam.name} vs ${row.fixture.awayTeam.name}`;
  return {
    status: row.publicStatus,
    statusLabel: STATUS_LABELS[row.publicStatus],
    selection,
    marketLabel: selection ? readableMarket(selection.marketId) : null,
    verdict: verdict(row, selection),
    primaryReason,
    primaryRisk: risk(row, selection, primaryReason),
    freshness: clock.status,
    freshnessLabel: clock.label,
    modelVersion: row.decisionSummary.auditSummary.modelVersion ?? row.bestDecision?.modelVersion ?? null,
    engineVersion: row.decisionSummary.auditSummary.engineVersion ?? row.bestDecision?.engineVersion ?? null,
    isPublishedPick: row.publicStatus === "value_pick" && Boolean(row.decisionSummary.bestPublishedPick),
    isCommunityOpinion: false,
    analysisHref: `/predictions/${matchId}`,
    communityHref: `/community?match=${matchId}&prompt=${encodeURIComponent(`My read on ${matchup}: `)}`
  };
}
