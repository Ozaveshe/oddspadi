import type {
  DecisionDataCoverageAudit,
  DecisionDataCoverageSignal,
  DecisionLearningProfile,
  FootballModelDiagnostics,
  Match,
  MatchContextAdjustment,
  MatchContextSignal
} from "@/lib/sports/types";
import { inspectContextSignal, isRequiredProductionDataSignalBlocked } from "./contextSignalPolicy";
import { buildHistoricalResultsCoverageSignal } from "./decisionHistoricalEvidence";
import { formatPercent } from "./format";

type CoverageFact = Pick<DecisionDataCoverageSignal, "status" | "source" | "freshness" | "detail">;

function dataSignalScore(status: DecisionDataCoverageSignal["status"]): number {
  if (status === "provider-backed" || status === "not-applicable") return 1;
  if (status === "computed") return 0.72;
  if (status === "mock") return 0.42;
  if (status === "stale") return 0.22;
  return 0;
}

function productionBlockerPriority(signal: DecisionDataCoverageSignal): number {
  if (["injuries", "suspensions", "lineups", "match-events", "live-scores", "news", "weather"].includes(signal.category)) return 0;
  if (["odds", "fixtures", "standings"].includes(signal.category)) return 1;
  return 2;
}

function contextSignalInspection(match: Match, signalItem: MatchContextSignal | undefined) {
  return inspectContextSignal(signalItem, { requireTimestamp: match.dataSource?.kind === "provider" });
}

function statusFromContextSignal(match: Match, signalItem: MatchContextSignal | undefined): DecisionDataCoverageSignal["status"] {
  return contextSignalInspection(match, signalItem)?.status ?? "missing";
}

function sourceFromContextSignal(signalItem: MatchContextSignal | undefined): string {
  return signalItem?.source ?? "missing-provider";
}

function matchFixtureSignal(match: Match): CoverageFact {
  if (match.dataSource?.kind === "provider" && match.dataSource.fixtureProvider) {
    return {
      status: "provider-backed",
      source: match.dataSource.fixtureProvider,
      freshness: match.status === "live" ? "current" : "pre-match",
      detail: `${match.homeTeam.name} vs ${match.awayTeam.name} is loaded from ${match.dataSource.fixtureProvider}.`
    };
  }
  return {
    status: "mock",
    source: match.dataSource?.fixtureProvider ?? "mockSportsDataProvider",
    freshness: "mock",
    detail: `${match.homeTeam.name} vs ${match.awayTeam.name} is loaded from the MVP mock provider.`
  };
}

function matchFormSignal(match: Match): CoverageFact {
  if (match.dataSource?.kind === "provider" && match.dataSource.formProvider && match.dataSource.formProvider !== "deterministic-provider-proxy") {
    return {
      status: "provider-backed",
      source: match.dataSource.formProvider,
      freshness: "pre-match",
      detail: "Recent form is loaded from the provider feed."
    };
  }
  if (match.dataSource?.kind === "provider") {
    return {
      status: "computed",
      source: match.dataSource.formProvider ?? "deterministic-provider-proxy",
      freshness: "pre-match",
      detail: "Recent form is currently estimated from provider fixtures and deterministic team proxies until a form feed is connected."
    };
  }
  return {
    status: "mock",
    source: match.dataSource?.formProvider ?? "mockSportsDataProvider",
    freshness: "mock",
    detail: `${match.homeTeam.name}: ${match.homeForm.recentResults.join("-")}; ${match.awayTeam.name}: ${match.awayForm.recentResults.join("-")}.`
  };
}

function matchHomeAwaySignal(match: Match, formSignal: CoverageFact, dataQualityScore: number): CoverageFact {
  if (formSignal.status === "provider-backed") {
    return {
      status: "provider-backed",
      source: formSignal.source,
      freshness: formSignal.freshness,
      detail: `Home/away strength uses provider recent-form windows when available, alongside team and league strength; data quality ${formatPercent(dataQualityScore)}.`
    };
  }
  if (formSignal.status === "mock") {
    return {
      status: "mock",
      source: formSignal.source,
      freshness: "mock",
      detail: `Home/away strength is derived from mock form, team rating, and league strength; data quality ${formatPercent(dataQualityScore)}.`
    };
  }
  return {
    status: "computed",
    source: formSignal.source,
    freshness: "pre-match",
    detail: `Home/away strength uses deterministic form proxies, team rating, and league strength; data quality ${formatPercent(dataQualityScore)}.`
  };
}

function matchOddsSignal(match: Match): CoverageFact {
  if (!match.oddsMarkets.length) {
    return {
      status: "missing",
      source: "odds-provider",
      freshness: "missing",
      detail: "No odds market snapshot is available."
    };
  }
  if (match.dataSource?.kind === "provider" && match.dataSource.oddsProvider) {
    return {
      status: "provider-backed",
      source: match.dataSource.oddsProvider,
      freshness: "current",
      detail: `${match.oddsMarkets.length} provider market(s) and ${match.oddsMarkets.reduce((sum, market) => sum + market.selections.length, 0)} selection(s) loaded.`
    };
  }
  return {
    status: "mock",
    source: match.dataSource?.oddsProvider ?? "mockSportsDataProvider",
    freshness: "mock",
    detail: `${match.oddsMarkets.length} market(s) and ${match.oddsMarkets.reduce((sum, market) => sum + market.selections.length, 0)} selection(s) loaded.`
  };
}

export function buildDecisionDataCoverageAudit({
  match,
  diagnostics,
  contextAdjustment,
  learningProfile
}: {
  match: Match;
  diagnostics: FootballModelDiagnostics;
  contextAdjustment?: MatchContextAdjustment;
  learningProfile?: DecisionLearningProfile;
}): DecisionDataCoverageAudit {
  const contextSignals = contextAdjustment?.signals ?? [];
  const byCategory = (category: MatchContextSignal["category"]) => contextSignals.find((item) => item.category === category);
  const injurySignal = byCategory("injury");
  const suspensionSignal = byCategory("suspension");
  const lineupSignal = byCategory("lineup");
  const standingsSignal = byCategory("standings");
  const weatherSignal = byCategory("weather");
  const newsSignal = byCategory("news") ?? injurySignal;
  const liveEventSignal = byCategory("live-event");
  const playerFormSignal = byCategory("player-form");
  const trainingStatus: DecisionDataCoverageSignal["status"] =
    learningProfile?.active ? "provider-backed" : learningProfile?.status === "demo-only" ? "mock" : "missing";
  const signalFreshness = (signalItem: MatchContextSignal | undefined): DecisionDataCoverageSignal["freshness"] =>
    contextSignalInspection(match, signalItem)?.freshness ?? "missing";
  const fixtureSignal = matchFixtureSignal(match);
  const historicalResultsSignal = buildHistoricalResultsCoverageSignal({ match, playerFormSignal });
  const formSignal = matchFormSignal(match);
  const homeAwaySignal = matchHomeAwaySignal(match, formSignal, diagnostics.dataQualityScore);
  const oddsSignal = matchOddsSignal(match);

  const signals: DecisionDataCoverageSignal[] = [
    {
      id: "fixtures",
      category: "fixtures",
      label: "Fixture for the day",
      status: fixtureSignal.status,
      source: fixtureSignal.source,
      freshness: fixtureSignal.freshness,
      weight: 1,
      detail: fixtureSignal.detail,
      requiredForProduction: true
    },
    {
      id: "historical-results",
      category: "historical-results",
      label: "Team/player historical results",
      status: historicalResultsSignal.status,
      source: historicalResultsSignal.source,
      freshness: historicalResultsSignal.freshness,
      weight: 0.9,
      detail: historicalResultsSignal.detail,
      requiredForProduction: true
    },
    {
      id: "league-standings",
      category: "standings",
      label: "League standings",
      status: statusFromContextSignal(match, standingsSignal),
      source: sourceFromContextSignal(standingsSignal),
      freshness: signalFreshness(standingsSignal),
      weight: 0.65,
      detail: standingsSignal?.detail ?? "Standings snapshots exist in the training schema but are not yet connected to live decisions.",
      requiredForProduction: true
    },
    {
      id: "home-away-performance",
      category: "home-away",
      label: "Home/away performance",
      status: homeAwaySignal.status,
      source: homeAwaySignal.source,
      freshness: homeAwaySignal.freshness,
      weight: 0.72,
      detail: homeAwaySignal.detail,
      requiredForProduction: true
    },
    {
      id: "recent-form",
      category: "recent-form",
      label: "Recent form",
      status: formSignal.status,
      source: formSignal.source,
      freshness: formSignal.freshness,
      weight: 0.8,
      detail: formSignal.detail,
      requiredForProduction: true
    },
    {
      id: "injuries",
      category: "injuries",
      label: "Injuries",
      status: statusFromContextSignal(match, injurySignal),
      source: sourceFromContextSignal(injurySignal),
      freshness: signalFreshness(injurySignal),
      weight: 0.9,
      detail: injurySignal?.detail ?? "No provider-backed injury feed is connected.",
      requiredForProduction: true
    },
    {
      id: "suspensions",
      category: "suspensions",
      label: "Suspensions",
      status: statusFromContextSignal(match, suspensionSignal),
      source: sourceFromContextSignal(suspensionSignal),
      freshness: signalFreshness(suspensionSignal),
      weight: 0.75,
      detail: suspensionSignal?.detail ?? "No suspension provider is connected.",
      requiredForProduction: match.sport === "football"
    },
    {
      id: "lineups",
      category: "lineups",
      label: match.sport === "tennis" ? "Confirmed player context" : "Lineups",
      status: statusFromContextSignal(match, lineupSignal),
      source: sourceFromContextSignal(lineupSignal),
      freshness: signalFreshness(lineupSignal),
      weight: 0.85,
      detail: lineupSignal?.detail ?? "Confirmed lineups/starters are not connected.",
      requiredForProduction: match.sport !== "tennis"
    },
    {
      id: "odds",
      category: "odds",
      label: "Bookmaker odds",
      status: oddsSignal.status,
      source: oddsSignal.source,
      freshness: oddsSignal.freshness,
      weight: 1,
      detail: oddsSignal.detail,
      requiredForProduction: true
    },
    {
      id: "live-scores",
      category: "live-scores",
      label: "Live scores",
      status: match.status === "live" ? (match.score ? fixtureSignal.status : "missing") : "not-applicable",
      source: match.status === "live" ? fixtureSignal.source : "pre-match fixture",
      freshness: match.status === "live" ? fixtureSignal.freshness : "not-applicable",
      weight: match.status === "live" ? 0.85 : 0,
      detail:
        match.status === "live"
          ? match.score
            ? `Live score is available from ${fixtureSignal.source}; event depth is audited separately.`
            : "Fixture is live but no score data is available."
          : "Fixture is not live yet.",
      requiredForProduction: match.status === "live"
    },
    {
      id: "match-events",
      category: "match-events",
      label: "Match events",
      status: match.status === "live" ? statusFromContextSignal(match, liveEventSignal) : "not-applicable",
      source: match.status === "live" ? sourceFromContextSignal(liveEventSignal) : "pre-match fixture",
      freshness: match.status === "live" ? signalFreshness(liveEventSignal) : "not-applicable",
      weight: match.status === "live" ? 0.85 : 0,
      detail: liveEventSignal?.detail ?? (match.status === "live" ? "No event-by-event feed is connected." : "Event stream is not required before kickoff."),
      requiredForProduction: match.status === "live"
    },
    {
      id: "news",
      category: "news",
      label: "News signals",
      status: statusFromContextSignal(match, newsSignal),
      source: sourceFromContextSignal(newsSignal),
      freshness: signalFreshness(newsSignal),
      weight: 0.72,
      detail: newsSignal?.detail ?? "No news provider is connected.",
      requiredForProduction: true
    },
    {
      id: "weather",
      category: "weather",
      label: "Weather",
      status: match.sport === "basketball" ? "not-applicable" : statusFromContextSignal(match, weatherSignal),
      source: match.sport === "basketball" ? "indoor/not-required" : sourceFromContextSignal(weatherSignal),
      freshness: match.sport === "basketball" ? "not-applicable" : signalFreshness(weatherSignal),
      weight: match.sport === "basketball" ? 0 : 0.55,
      detail:
        match.sport === "basketball"
          ? "Weather is not a primary basketball input."
          : weatherSignal?.detail ?? "No weather provider is connected for outdoor totals/tempo markets.",
      requiredForProduction: match.sport === "football" || match.sport === "tennis"
    },
    {
      id: "historical-training",
      category: "training",
      label: "Historical training corpus",
      status: trainingStatus,
      source: learningProfile?.source ?? "supabase-training-tables",
      freshness: learningProfile?.active ? "historical" : learningProfile?.status === "demo-only" ? "mock" : "missing",
      weight: 0.9,
      detail: learningProfile?.reason ?? "No active real-data learning profile is available.",
      requiredForProduction: true
    }
  ];

  const weightedSignals = signals.filter((item) => item.weight > 0);
  const weightedTotal = weightedSignals.reduce((sum, item) => sum + item.weight, 0);
  const score = weightedTotal
    ? Math.round((weightedSignals.reduce((sum, item) => sum + dataSignalScore(item.status) * item.weight, 0) / weightedTotal) * 100)
    : 0;
  const providerBackedSignals = signals.filter((item) => item.status === "provider-backed").length;
  const computedSignals = signals.filter((item) => item.status === "computed").length;
  const mockSignals = signals.filter((item) => item.status === "mock").length;
  const missingSignals = signals.filter((item) => item.status === "missing").length;
  const staleSignals = signals.filter((item) => item.status === "stale").length;
  const productionRequiredMissing = signals.filter(isRequiredProductionDataSignalBlocked);
  const status: DecisionDataCoverageAudit["status"] =
    providerBackedSignals >= 8 && missingSignals === 0 && productionRequiredMissing.length === 0
      ? "provider-backed"
      : mockSignals >= 4
        ? "mock-backed"
        : score >= 55
          ? "partial"
          : "insufficient";
  const requiredBeforeTrust = productionRequiredMissing
    .slice()
    .sort((left, right) => productionBlockerPriority(left) - productionBlockerPriority(right))
    .map((item) => `${item.label}: ${item.detail}`)
    .slice(0, 8);
  const summary =
    status === "provider-backed"
      ? `Data coverage is ${score}/100 with provider-backed inputs across the core decision stack.`
      : status === "mock-backed"
        ? `Data coverage is ${score}/100: MVP mock/computed inputs are available, but ${productionRequiredMissing.length} production signal(s) are still missing.`
        : status === "partial"
          ? `Data coverage is ${score}/100 with partial input support and ${productionRequiredMissing.length} production gap(s).`
          : `Data coverage is ${score}/100; too many required provider signals are missing for production trust.`;

  return {
    status,
    score,
    providerBackedSignals,
    computedSignals,
    mockSignals,
    missingSignals,
    staleSignals,
    totalSignals: signals.length,
    summary,
    signals,
    requiredBeforeTrust
  };
}
