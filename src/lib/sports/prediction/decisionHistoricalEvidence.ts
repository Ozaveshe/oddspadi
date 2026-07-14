import type {
  BestPickResult,
  DecisionDataCoverageSignal,
  DecisionHistoricalDiscipline,
  Match,
  MatchContextSignal
} from "@/lib/sports/types";
import type { PublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";
import { inspectContextSignal } from "./contextSignalPolicy";

type HistoricalCoverageSignal = Pick<DecisionDataCoverageSignal, "status" | "source" | "freshness" | "detail">;

type TeamHistoryEvidence = {
  status: DecisionDataCoverageSignal["status"];
  source: string;
  sampleSize: number;
};

const MIN_TEAM_HISTORY_MATCHES = 3;

function isMockSource(source: string): boolean {
  return /(^|[-_\s])(mock|synthetic|seed|fake)([-_\s]|$)/.test(source.toLowerCase());
}

function isComputedSource(source: string): boolean {
  return /(^|[-_\s])(baseline|computed|deterministic|derived|proxy)([-_\s]|$)/.test(source.toLowerCase());
}

function teamHistoryEvidence(team: Match["homeTeam"], providerBackedFixture: boolean): TeamHistoryEvidence {
  const evidence = team.ratingEvidence;
  if (!evidence) {
    return {
      status: providerBackedFixture ? "missing" : "mock",
      source: providerBackedFixture ? "missing-team-history" : "mockSportsDataProvider",
      sampleSize: 0
    };
  }
  const source = evidence.source.trim() || "unknown-team-history";
  const sampleSize = typeof evidence.sampleSize === "number" && Number.isFinite(evidence.sampleSize)
    ? Math.max(0, Math.trunc(evidence.sampleSize))
    : 0;
  if (!providerBackedFixture || isMockSource(source)) return { status: "mock", source, sampleSize };
  if (sampleSize < MIN_TEAM_HISTORY_MATCHES || isComputedSource(source)) return { status: "computed", source, sampleSize };
  return { status: "provider-backed", source, sampleSize };
}

function combinedHistoryStatus(
  fixtureIsProviderBacked: boolean,
  home: TeamHistoryEvidence,
  away: TeamHistoryEvidence,
  playerStatus: DecisionDataCoverageSignal["status"]
): DecisionDataCoverageSignal["status"] {
  if (!fixtureIsProviderBacked) return "mock";
  const statuses = [home.status, away.status, playerStatus];
  if (statuses.includes("stale")) return "stale";
  if (statuses.includes("mock")) return "mock";
  if (statuses.every((status) => status === "provider-backed")) return "provider-backed";
  if (statuses.every((status) => status === "missing")) return "missing";
  return "computed";
}

/**
 * Classify the actual chronological team and player inputs used by a match.
 * A provider fixture alone is not enough: both team-history samples and a
 * leakage-safe player-form signal must be real before this signal is credited
 * as provider-backed.
 */
export function buildHistoricalResultsCoverageSignal({
  match,
  playerFormSignal,
  now = new Date()
}: {
  match: Match;
  playerFormSignal?: MatchContextSignal;
  now?: Date;
}): HistoricalCoverageSignal {
  const fixtureIsProviderBacked = match.dataSource?.kind === "provider";
  const home = teamHistoryEvidence(match.homeTeam, fixtureIsProviderBacked);
  const away = teamHistoryEvidence(match.awayTeam, fixtureIsProviderBacked);
  const player = inspectContextSignal(playerFormSignal, { requireTimestamp: fixtureIsProviderBacked, now });
  const playerStatus: DecisionDataCoverageSignal["status"] = !playerFormSignal || playerFormSignal.quality === "missing"
    ? "missing"
    : player?.status === "provider-backed" && playerFormSignal.quality === "thin"
      ? "computed"
      : player?.status ?? "missing";
  const status = combinedHistoryStatus(fixtureIsProviderBacked, home, away, playerStatus);
  const playerSource = playerFormSignal?.source ?? "missing-player-history";
  const sources = [...new Set([home.source, away.source, playerSource])].join(" + ");
  const freshness: HistoricalCoverageSignal["freshness"] =
    status === "provider-backed" || status === "computed"
      ? "historical"
      : status === "stale"
        ? "stale"
        : status === "mock"
          ? "mock"
          : "missing";
  const teamDetail = `${match.homeTeam.name}: ${home.status} via ${home.source} (${home.sampleSize} match${home.sampleSize === 1 ? "" : "es"}); ${match.awayTeam.name}: ${away.status} via ${away.source} (${away.sampleSize} match${away.sampleSize === 1 ? "" : "es"})`;
  const playerDetail = playerFormSignal
    ? `${playerStatus} via ${playerSource} (${playerFormSignal.quality} evidence)${playerFormSignal.publishedAt ? ` as of ${playerFormSignal.publishedAt}` : " without a valid evidence timestamp"}`
    : "missing; no leakage-safe player-performance form was attached";

  return {
    status,
    source: sources,
    freshness,
    detail:
      status === "provider-backed"
        ? `Chronological team and player history is provider-backed. ${teamDetail}. Player history: ${playerDetail}.`
        : `Historical evidence is incomplete. ${teamDetail}. Player history: ${playerDetail}.`
  };
}

function isEnglishPremierLeague(match: Match): boolean {
  const leagueName = match.league.name.toLowerCase();
  const leagueId = match.league.id.toLowerCase();
  const country = match.league.country.toLowerCase();
  return (
    match.sport === "football" &&
    ((country === "england" && leagueName.includes("premier league")) ||
      leagueId === "epl" ||
      leagueId.endsWith(":39") ||
      leagueId.includes("soccer_epl") ||
      leagueId.includes("football-data:epl"))
  );
}

/** Keep public-history benchmark discipline isolated from decision orchestration. */
export function buildDecisionHistoricalDiscipline({
  publicHistoricalTrainingEvidence,
  bestPick,
  match
}: {
  publicHistoricalTrainingEvidence?: PublicHistoricalTrainingEvidence | null;
  bestPick: BestPickResult;
  match: Match;
}): DecisionHistoricalDiscipline {
  const hasOddsEventIdentity =
    match.id.startsWith("the-odds-api:") ||
    match.dataSource?.fixtureProvider === "the-odds-api-events" ||
    match.dataSource?.oddsProvider === "the-odds-api";

  if (!publicHistoricalTrainingEvidence) {
    return {
      status: "not-attached",
      attached: false,
      source: null,
      seasons: null,
      fixtures: 0,
      oddsRows: 0,
      bookmakerMarkets: 0,
      diagnosticScore: 0,
      benchmarkVerdict: null,
      trustEffect: "none",
      cappedByMarketPrior: false,
      summary: "No 10-year public historical evidence is attached to this decision run.",
      instruction: "Run the public historical evidence proof before using history to discipline raw model edges.",
      requiredBeforePromotion: [
        "Attach public historical evidence or a persisted provider-backed learning profile.",
        "Keep learned thresholds and public picks locked until provider-enriched backtests pass."
      ],
      proofUrls: ["/api/sports/decision/training/public-historical-training-evidence"]
    };
  }

  if (!isEnglishPremierLeague(match)) {
    return {
      status: "not-applicable",
      attached: false,
      source: null,
      seasons: null,
      fixtures: 0,
      oddsRows: 0,
      bookmakerMarkets: 0,
      diagnosticScore: 0,
      benchmarkVerdict: null,
      trustEffect: "none",
      cappedByMarketPrior: false,
      summary: "The attached historical corpus covers the English Premier League and is not applicable to this fixture.",
      instruction: "Use league-specific historical evidence before applying any historical trust cap to this match.",
      requiredBeforePromotion: ["Attach a real historical corpus and market benchmark for this fixture's league."],
      proofUrls: []
    };
  }

  const status: DecisionHistoricalDiscipline["status"] =
    publicHistoricalTrainingEvidence.status === "market-prior-dominant"
      ? "market-prior-dominant"
      : publicHistoricalTrainingEvidence.status === "provider-retest-ready"
        ? "provider-retest-ready"
        : publicHistoricalTrainingEvidence.status === "failed" || publicHistoricalTrainingEvidence.status === "insufficient-history"
          ? "blocked"
          : "diagnostic-only";
  const cappedByMarketPrior = status === "market-prior-dominant" && bestPick.hasValue;
  const trustEffect: DecisionHistoricalDiscipline["trustEffect"] =
    status === "market-prior-dominant"
      ? "cap-raw-edge"
      : status === "provider-retest-ready"
        ? "queue-provider-retest"
        : status === "blocked"
          ? "block"
          : "diagnostic-context";
  const requiredBeforePromotion = publicHistoricalTrainingEvidence.failureDiagnosis.providerRetestChecklist.map((item) => {
    if (hasOddsEventIdentity && item.label === "Provider fixture identity") {
      return `${item.label}: Odds API event identity is attached for this market; map the same fixture to API-Football/APISports fixture ID, teams, standings, availability, and context before promotion.`;
    }
    return `${item.label}: ${item.requiredEvidence}`;
  });

  return {
    status,
    attached: true,
    source: publicHistoricalTrainingEvidence.source.label,
    seasons: publicHistoricalTrainingEvidence.source.seasons,
    fixtures: publicHistoricalTrainingEvidence.scorecard.fixtures,
    oddsRows: publicHistoricalTrainingEvidence.scorecard.oddsRows,
    bookmakerMarkets: publicHistoricalTrainingEvidence.scorecard.bookmakerMarkets,
    diagnosticScore: publicHistoricalTrainingEvidence.diagnosticScore,
    benchmarkVerdict: publicHistoricalTrainingEvidence.scorecard.benchmarkVerdict,
    trustEffect,
    cappedByMarketPrior,
    summary:
      status === "market-prior-dominant"
        ? hasOddsEventIdentity
          ? "10-year public EPL benchmark says market consensus beats the current model; Odds API event identity is attached, but raw positive-EV picks stay capped until full provider fixture context is mapped."
          : "10-year public EPL benchmark says market consensus beats the current model; raw positive-EV picks stay capped."
        : status === "provider-retest-ready"
          ? `10-year public EPL history found a provider-enriched retest path with score ${publicHistoricalTrainingEvidence.diagnosticScore}/100.`
          : status === "blocked"
            ? "Public historical evidence is too thin or failed, so historical learning cannot support this decision."
            : `Public historical evidence is diagnostic-only with score ${publicHistoricalTrainingEvidence.diagnosticScore}/100.`,
    instruction:
      status === "market-prior-dominant"
        ? hasOddsEventIdentity
          ? "Use the Odds API event as read-only market identity, but prefer no-vig market discipline over raw model edge until API-Football fixture/context retests beat market consensus."
          : "Prefer no-vig market discipline over raw model edge until provider-enriched retests beat market consensus."
        : status === "provider-retest-ready"
          ? "Queue provider-enriched retest with fixture IDs, stored odds snapshots, context features, and promotion gates before any learned behavior is applied."
          : status === "blocked"
            ? "Do not use this historical evidence for trust upgrades; repair or replace the corpus proof first."
            : "Use public history only as cautionary context; do not mutate probabilities, thresholds, or live recommendations.",
    requiredBeforePromotion,
    proofUrls: [
      ...publicHistoricalTrainingEvidence.proofUrls,
      ...(hasOddsEventIdentity ? ["/api/sports/decision/epl-odds-market-map", "/api/sports/decision/epl-provider-fixture-map"] : [])
    ]
  };
}
