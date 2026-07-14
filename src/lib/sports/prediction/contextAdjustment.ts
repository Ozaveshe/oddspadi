import type { FootballModelDiagnostics, Match, MatchContextAdjustment, MatchContextSignal, PredictionMarket, RiskLevel } from "@/lib/sports/types";
import { clampProbability } from "./odds";
import { inspectContextSignal, isFreshProviderContextSignal } from "./contextSignalPolicy";

function seedFromText(text: string): number {
  return Array.from(text).reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function uncertaintyFromDataQuality(dataQualityScore: number): RiskLevel {
  if (dataQualityScore >= 0.82) return "low";
  if (dataQualityScore >= 0.7) return "medium";
  return "high";
}

function signal(input: Omit<MatchContextSignal, "publishedAt" | "source"> & { source?: string }): MatchContextSignal {
  return {
    ...input,
    source: input.source ?? "mock-context-feed",
    publishedAt: "2026-06-24T08:00:00.000Z"
  };
}

function footballSignals(match: Match, seed: number): MatchContextSignal[] {
  const signals: MatchContextSignal[] = [];

  signals.push(
    signal({
      id: `${match.id}-lineup-stability`,
      category: "lineup",
      label: "Projected lineup stability",
      detail: "Mock context feed sees no major projected lineup disruption; replace with confirmed lineup provider before production.",
      quality: match.dataQualityScore >= 0.84 ? "acceptable" : "thin",
      impact: "neutral",
      confidence: 0.58,
      weight: 0
    })
  );

  if (seed % 2 === 0) {
    signals.push(
      signal({
        id: `${match.id}-away-availability`,
        category: "injury",
        label: `${match.awayTeam.name} availability drag`,
        detail: "Synthetic injury/news signal slightly discounts the away side until real injury and suspension feeds are connected.",
        quality: "thin",
        impact: "away-negative",
        confidence: 0.54,
        weight: 0.018
      })
    );
  } else {
    signals.push(
      signal({
        id: `${match.id}-home-availability`,
        category: "injury",
        label: `${match.homeTeam.name} availability caution`,
        detail: "Synthetic injury/news signal slightly discounts the home side until real injury and suspension feeds are connected.",
        quality: "thin",
        impact: "home-negative",
        confidence: 0.5,
        weight: 0.014
      })
    );
  }

  if (seed % 3 === 0) {
    signals.push(
      signal({
        id: `${match.id}-weather-tempo`,
        category: "weather",
        label: "Weather tempo check",
        detail: "Mock weather signal leans toward slower tempo; production should replace this with venue-level weather.",
        quality: "thin",
        impact: "tempo-down",
        confidence: 0.48,
        weight: 0.016
      })
    );
  }

  return signals;
}

function basketballSignals(match: Match, seed: number): MatchContextSignal[] {
  const homeRestEdge = seed % 2 === 0;
  return [
    signal({
      id: `${match.id}-rest-rotation`,
      category: "rest",
      label: homeRestEdge ? `${match.homeTeam.name} rest edge` : `${match.awayTeam.name} rest edge`,
      detail: "Mock rest/rotation signal adjusts the side market; replace with schedule, injury, and minutes-limit providers.",
      quality: "thin",
      impact: homeRestEdge ? "home-positive" : "away-positive",
      confidence: 0.56,
      weight: 0.018
    }),
    signal({
      id: `${match.id}-pace-news`,
      category: "news",
      label: "Pace and rotation watch",
      detail: seed % 3 === 0 ? "Rotation signal leans slower than market total." : "Rotation signal leans slightly faster than market total.",
      quality: "thin",
      impact: seed % 3 === 0 ? "tempo-down" : "tempo-up",
      confidence: 0.5,
      weight: 0.014
    })
  ];
}

function tennisSignals(match: Match, seed: number): MatchContextSignal[] {
  return [
    signal({
      id: `${match.id}-surface-fit`,
      category: "surface",
      label: "Surface fit",
      detail:
        seed % 2 === 0
          ? `${match.homeTeam.name} receives a small surface-fit adjustment from the mock context feed.`
          : `${match.awayTeam.name} receives a small surface-fit adjustment from the mock context feed.`,
      quality: "thin",
      impact: seed % 2 === 0 ? "home-positive" : "away-positive",
      confidence: 0.55,
      weight: 0.017
    }),
    signal({
      id: `${match.id}-fitness-watch`,
      category: "news",
      label: "Fitness watch",
      detail: "Mock player-fitness signal is tracked as a risk flag until real injury/news feeds and retirement-risk data are connected.",
      quality: "thin",
      impact: "unknown",
      confidence: 0.42,
      weight: 0
    })
  ];
}

function liveSignal(match: Match): MatchContextSignal | null {
  if (match.status !== "live") return null;
  return signal({
    id: `${match.id}-live-state`,
    category: "live-event",
    label: "Live-state caution",
    detail: "The fixture is live; the current context layer does not yet consume event-by-event in-play data.",
    quality: "thin",
    impact: "unknown",
    confidence: 0.5,
    weight: 0
  });
}

function buildMissingSignals(match: Match, signals: MatchContextSignal[]): string[] {
  const categories = new Set(signals.map((item) => item.category));
  const missing: string[] = [];

  if (match.sport === "football") {
    if (!categories.has("lineup")) missing.push("Confirmed lineups");
    if (!categories.has("injury") && !categories.has("suspension")) missing.push("Injury and suspension news");
    if (!categories.has("weather")) missing.push("Weather check");
  }
  if (match.sport === "basketball") {
    if (!categories.has("lineup")) missing.push("Starting lineups and minutes limits");
    if (!categories.has("injury") && !categories.has("rest")) missing.push("Injuries and rest days");
  }
  if (match.sport === "tennis") {
    if (!categories.has("surface")) missing.push("Court-speed and surface detail");
    if (!categories.has("injury") && !categories.has("news")) missing.push("Player fitness and injury news");
  }
  if (match.status === "live" && !categories.has("live-event")) missing.push("Live event stream");

  return missing;
}

function applySignalShift(acc: MatchContextAdjustment["probabilityShift"] & { total: number }, signalItem: MatchContextSignal) {
  const magnitude = clamp(signalItem.weight * signalItem.confidence, 0, 0.035);
  if (signalItem.impact === "home-positive") acc.home += magnitude;
  if (signalItem.impact === "home-negative") acc.home -= magnitude;
  if (signalItem.impact === "away-positive") acc.away += magnitude;
  if (signalItem.impact === "away-negative") acc.away -= magnitude;
  if (signalItem.impact === "tempo-up") acc.total += magnitude;
  if (signalItem.impact === "tempo-down") acc.total -= magnitude;
}

export function coreModelContextCategories(match: Match): MatchContextSignal["category"][] {
  if (!match.providerContextSignals?.length) return [];
  if (match.sport === "basketball") return ["rest", "injury", "suspension", "lineup", "news"];
  if (match.sport === "tennis") return ["surface", "injury", "news", "rest"];
  return ["injury", "suspension", "lineup", "player-form", "weather", "news"];
}

export function buildMatchContextAdjustment(
  match: Match,
  {
    probabilityHandledCategories = [],
    now = new Date()
  }: { probabilityHandledCategories?: MatchContextSignal["category"][]; now?: Date } = {}
): MatchContextAdjustment {
  const seed = seedFromText(match.id);
  const providerSignals = match.providerContextSignals ?? [];
  const signals =
    providerSignals.length > 0
      ? [...providerSignals]
      : match.dataSource?.kind === "provider"
        ? []
      : match.sport === "basketball"
        ? basketballSignals(match, seed)
        : match.sport === "tennis"
          ? tennisSignals(match, seed)
          : footballSignals(match, seed);
  const live = match.dataSource?.kind === "provider" ? null : liveSignal(match);
  if (live) signals.push(live);

  const providerMatch = match.dataSource?.kind === "provider";
  const usableSignals = providerMatch
    ? signals.filter((item) => isFreshProviderContextSignal(item, { requireTimestamp: true, now }))
    : signals;
  const requirementSignals = providerMatch
    ? usableSignals
    : signals.filter((item) => inspectContextSignal(item)?.status !== "computed");
  const dataQualitySignals = providerMatch ? usableSignals : requirementSignals;

  const shifts = { home: 0, away: 0, draw: 0, total: 0 };
  const handledCategories = new Set(probabilityHandledCategories);
  for (const item of usableSignals) {
    if (!handledCategories.has(item.category)) applySignalShift(shifts, item);
  }

  if (match.sport === "football") {
    shifts.draw = clamp(-Math.abs(shifts.home - shifts.away) * 0.2 + (shifts.total < 0 ? 0.004 : shifts.total > 0 ? -0.004 : 0), -0.018, 0.018);
  }

  const applied =
    Math.abs(shifts.home) > 0.0001 || Math.abs(shifts.away) > 0.0001 || Math.abs(shifts.draw) > 0.0001 || Math.abs(shifts.total) > 0.0001;
  const riskFlags = signals
    .filter((item) => item.quality === "thin" || item.impact === "unknown")
    .map((item) => `${item.label}: ${item.detail}`)
    .concat(
      providerMatch
        ? signals
            .filter((item) => !usableSignals.includes(item))
            .map((item) => `${item.label}: excluded from probability use until fresh provider evidence is available.`)
        : []
    )
    .slice(0, 5);
  const missingSignals = buildMissingSignals(match, requirementSignals);
  const dataQualityDelta = clamp(dataQualitySignals.filter((item) => item.quality !== "missing").length * 0.004 - missingSignals.length * 0.003, -0.025, 0.025);

  return {
    summary: applied
      ? `Context layer applied residual probability effects after reviewing ${signals.length} structured signal${signals.length === 1 ? "" : "s"}.`
      : handledCategories.size
        ? `Context layer reviewed ${signals.length} structured signal${signals.length === 1 ? "" : "s"}; core sport math already consumed the applicable probability effects.`
        : `Context layer reviewed ${signals.length} structured signal${signals.length === 1 ? "" : "s"} without moving probabilities.`,
    signals,
    probabilityShift: {
      home: Number(clamp(shifts.home, -0.05, 0.05).toFixed(4)),
      draw: match.sport === "football" ? Number(clamp(shifts.draw, -0.025, 0.025).toFixed(4)) : undefined,
      away: Number(clamp(shifts.away, -0.05, 0.05).toFixed(4))
    },
    totalShift: Number(clamp(shifts.total, -0.05, 0.05).toFixed(4)),
    dataQualityDelta: Number(dataQualityDelta.toFixed(4)),
    riskFlags,
    missingSignals,
    applied
  };
}

function normalizeSelectionProbabilities(probabilities: Record<string, number>, shifts: Record<string, number>): Record<string, number> {
  const adjusted = Object.fromEntries(
    Object.entries(probabilities).map(([key, value]) => [key, clampProbability(value + (shifts[key] ?? 0))])
  );
  const total = Object.values(adjusted).reduce((sum, value) => sum + value, 0);
  if (total <= 0) return probabilities;
  return Object.fromEntries(Object.entries(adjusted).map(([key, value]) => [key, clampProbability(value / total)]));
}

export function applyContextAdjustmentToMarkets(markets: PredictionMarket[], adjustment: MatchContextAdjustment): PredictionMarket[] {
  if (!adjustment.applied) return markets;
  const sideDelta = adjustment.probabilityShift.home - adjustment.probabilityShift.away;

  return markets.map((market) => {
    if (market.marketId === "match_winner") {
      return {
        ...market,
        probabilities: normalizeSelectionProbabilities(market.probabilities, {
          home: adjustment.probabilityShift.home,
          draw: adjustment.probabilityShift.draw ?? 0,
          away: adjustment.probabilityShift.away
        })
      };
    }

    if (market.marketId === "spread" || market.marketId === "set_handicap") {
      return {
        ...market,
        probabilities: normalizeSelectionProbabilities(market.probabilities, {
          home_cover: sideDelta,
          away_cover: -sideDelta,
          home_sets: sideDelta,
          away_sets: -sideDelta
        })
      };
    }

    if (market.marketId === "over_under_25" || market.marketId === "total_points" || market.marketId === "total_games") {
      return {
        ...market,
        probabilities: normalizeSelectionProbabilities(market.probabilities, {
          over_25: adjustment.totalShift,
          under_25: -adjustment.totalShift,
          over_15: adjustment.totalShift * 0.5,
          over: adjustment.totalShift,
          under: -adjustment.totalShift
        })
      };
    }

    if (market.marketId === "both_teams_to_score") {
      return {
        ...market,
        probabilities: normalizeSelectionProbabilities(market.probabilities, {
          yes: adjustment.totalShift * 0.75,
          no: -adjustment.totalShift * 0.75
        })
      };
    }

    return market;
  });
}

export function applyContextAdjustmentToDiagnostics(
  diagnostics: FootballModelDiagnostics,
  adjustment: MatchContextAdjustment
): FootballModelDiagnostics {
  const dataQualityScore = clampProbability(diagnostics.dataQualityScore + adjustment.dataQualityDelta);
  return {
    ...diagnostics,
    dataQualityScore,
    uncertainty: uncertaintyFromDataQuality(dataQualityScore),
    signalScores: [
      ...diagnostics.signalScores,
      {
        label: "Context side shift",
        value: Number((adjustment.probabilityShift.home - adjustment.probabilityShift.away).toFixed(4)),
        note: adjustment.summary
      },
      {
        label: "Context total shift",
        value: adjustment.totalShift,
        note: "Positive values raise over/tempo markets; negative values lower them."
      }
    ],
    calibrationNotes: [
      ...diagnostics.calibrationNotes,
      "Context signals adjust probabilities before value-edge ranking; production should replace mock signals with provider-backed injuries, lineups, news, weather, rest, surface, and live-event feeds."
    ]
  };
}
