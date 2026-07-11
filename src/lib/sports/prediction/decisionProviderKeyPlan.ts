import { EPL_2026_OPENING_WINDOW, EPL_2026_SEASON } from "@/lib/sports/prediction/decisionEpl2026Fixtures";
import type { DecisionProviderBatchManifest } from "@/lib/sports/prediction/decisionProviderBatchManifest";
import { hasAnyConfiguredEnv } from "@/lib/env";
import type { TenYearCorpusExecutionManifest } from "@/lib/sports/training/tenYearCorpusExecutionManifest";
import type { Sport } from "@/lib/sports/types";

type EnvMap = Record<string, string | undefined>;

export type DecisionProviderKeyPlanStatus = "ready" | "partial" | "missing-critical";
export type DecisionProviderKeyPlanLaneStatus = "configured" | "missing";

export type DecisionProviderKeyPlanLane = {
  id: "football-core" | "odds-markets" | "basketball-core" | "tennis-core" | "news-context" | "weather-context";
  label: string;
  status: DecisionProviderKeyPlanLaneStatus;
  priority: number;
  keys: string[];
  acceptedAlternatives: string[];
  missing: string[];
  unlocks: string[];
  firstMilestone: string;
  proofUrl: string;
  riskIfMissing: string;
};

export type DecisionProviderKeyPlanFeedStatus = "configured" | "missing-critical" | "optional-missing";

export type DecisionProviderKeyPlanFeed = {
  id:
    | "fixtures"
    | "historical-results"
    | "standings-home-away-form"
    | "injuries-suspensions"
    | "lineups"
    | "odds"
    | "live-scores-events"
    | "news"
    | "weather"
    | "basketball-efficiency"
    | "tennis-player-history";
  label: string;
  status: DecisionProviderKeyPlanFeedStatus;
  priority: number;
  sports: Sport[];
  requiredLaneIds: DecisionProviderKeyPlanLane["id"][];
  requiredKeys: string[];
  missingKeys: string[];
  modelFeatures: string[];
  unlocks: string[];
  proofUrl: string;
  blockedReason: string | null;
};

export type DecisionProviderKeyPlan = {
  mode: "provider-key-plan";
  status: DecisionProviderKeyPlanStatus;
  summary: string;
  firstSeasonTarget: {
    competition: "Premier League";
    season: "2026/27";
    providerSeason: "2026";
    starts: "2026-08-21";
    openingFixture: string;
    daysUntilStart: number;
    sourceUrl: string;
  };
  lanes: DecisionProviderKeyPlanLane[];
  nextLane: DecisionProviderKeyPlanLane | null;
  missingCriticalKeys: string[];
  configuredCriticalLanes: number;
  totalCriticalLanes: number;
  feedMatrix: {
    rows: DecisionProviderKeyPlanFeed[];
    nextFeed: DecisionProviderKeyPlanFeed | null;
    totals: {
      feeds: number;
      configured: number;
      missingCritical: number;
      optionalMissing: number;
      modelFeatures: number;
    };
  };
};

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function envReady(env: EnvMap, keys: string[]): boolean {
  return hasAnyConfiguredEnv(env, keys);
}

function missingFor(env: EnvMap, keys: string[]): string[] {
  return envReady(env, keys) ? [] : keys;
}

function dayDiff(from: string, to: string): number {
  const fromDate = new Date(`${from}T00:00:00.000Z`);
  const toDate = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 0;
  return Math.round((toDate.getTime() - fromDate.getTime()) / 86400000);
}

function lane(input: Omit<DecisionProviderKeyPlanLane, "status" | "missing"> & { env: EnvMap }): DecisionProviderKeyPlanLane {
  const missing = missingFor(input.env, input.keys);
  return {
    id: input.id,
    label: input.label,
    status: missing.length ? "missing" : "configured",
    priority: input.priority,
    keys: input.keys,
    acceptedAlternatives: input.acceptedAlternatives,
    missing,
    unlocks: input.unlocks,
    firstMilestone: input.firstMilestone,
    proofUrl: input.proofUrl,
    riskIfMissing: input.riskIfMissing
  };
}

function feedStatus(
  lanesById: Map<DecisionProviderKeyPlanLane["id"], DecisionProviderKeyPlanLane>,
  requiredLaneIds: DecisionProviderKeyPlanLane["id"][],
  optional: boolean
): DecisionProviderKeyPlanFeedStatus {
  const ready = requiredLaneIds.every((id) => lanesById.get(id)?.status === "configured");
  if (ready) return "configured";
  return optional ? "optional-missing" : "missing-critical";
}

function feed(input: Omit<DecisionProviderKeyPlanFeed, "status" | "requiredKeys" | "missingKeys" | "blockedReason"> & {
  lanesById: Map<DecisionProviderKeyPlanLane["id"], DecisionProviderKeyPlanLane>;
  optional?: boolean;
}): DecisionProviderKeyPlanFeed {
  const status = feedStatus(input.lanesById, input.requiredLaneIds, Boolean(input.optional));
  const requiredKeys = unique(input.requiredLaneIds.flatMap((id) => input.lanesById.get(id)?.keys ?? []));
  const missingKeys = unique(input.requiredLaneIds.flatMap((id) => input.lanesById.get(id)?.missing ?? []));
  return {
    id: input.id,
    label: input.label,
    status,
    priority: input.priority,
    sports: input.sports,
    requiredLaneIds: input.requiredLaneIds,
    requiredKeys,
    missingKeys,
    modelFeatures: input.modelFeatures,
    unlocks: input.unlocks,
    proofUrl: input.proofUrl,
    blockedReason: status === "configured" ? null : `Waiting on ${missingKeys.join(" or ")} for ${input.label}.`
  };
}

function summaryFor(status: DecisionProviderKeyPlanStatus, nextLane: DecisionProviderKeyPlanLane | null): string {
  if (status === "ready") return "Critical provider keys are configured for football fixtures, odds markets, basketball, and tennis dry-run planning.";
  if (status === "partial") return `Provider keys are partially configured; next missing lane is ${nextLane?.label ?? "not selected"}.`;
  return `Critical provider keys are missing; next lane is ${nextLane?.label ?? "football and odds providers"}.`;
}

export function buildDecisionProviderKeyPlan({
  date,
  asOfDate,
  env = process.env,
  providerBatchManifest,
  tenYearCorpusExecutionManifest
}: {
  date: string;
  asOfDate?: string;
  env?: EnvMap;
  providerBatchManifest: DecisionProviderBatchManifest;
  tenYearCorpusExecutionManifest: TenYearCorpusExecutionManifest;
}): DecisionProviderKeyPlan {
  const opening = EPL_2026_OPENING_WINDOW[0];
  const openingFixture = opening ? `${opening.home} vs ${opening.away}` : "Opening EPL 2026/27 fixture";
  const basketballJob = tenYearCorpusExecutionManifest.jobs.find((job) => job.sport === "basketball");
  const tennisJob = tenYearCorpusExecutionManifest.jobs.find((job) => job.sport === "tennis");
  const oddsBatch = providerBatchManifest.batches.find((batch) => batch.category === "odds");
  const lanes = [
    lane({
      id: "football-core",
      label: "Football provider",
      priority: 1,
      env,
      keys: ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
      acceptedAlternatives: ["API-Football", "APISports football", "generic sports API with league 39 coverage"],
      unlocks: [
        "EPL 2026/27 fixture dry-runs",
        "10-year football results backfill",
        "standings, injuries, lineups, live scores, and match events"
      ],
      firstMilestone: `${openingFixture} on ${EPL_2026_SEASON.seasonStartDate}`,
      proofUrl: "/api/sports/decision/epl-fixture-intake",
      riskIfMissing: "The football engine remains fixture-synthetic and cannot verify the EPL 2026/27 slate or historical labels."
    }),
    lane({
      id: "odds-markets",
      label: "Odds provider",
      priority: 2,
      env,
      keys: ["THE_ODDS_API_KEY", "ODDS_API_KEY"],
      acceptedAlternatives: ["The Odds API", "bookmaker odds feed with decimal prices and event IDs"],
      unlocks: [
        "implied probability conversion",
        "no-vig bookmaker margin removal",
        "value edge, EV, and market-movement ranking"
      ],
      firstMilestone: oddsBatch?.label ?? "Map bookmaker event IDs to EPL 2026/27 opening fixtures",
      proofUrl: "/api/sports/decision/epl-odds-market-map",
      riskIfMissing: "The money feature cannot distinguish model opinion from positive expected value."
    }),
    lane({
      id: "basketball-core",
      label: "Basketball live + historical bridge",
      priority: 3,
      env,
      keys: ["THE_ODDS_API_KEY", "ODDS_API_KEY", "API_BASKETBALL_KEY", "SPORTS_API_KEY"],
      acceptedAlternatives: ["The Odds API plus stored OddsPadi basketball history", "API-Basketball for premium box-score and injury enrichment"],
      unlocks: ["live fixtures and odds", "stored team strength", "pace and efficiency priors", "spread, moneyline, and totals decisions"],
      firstMilestone: basketballJob?.label ?? "Store the first provider-backed basketball feature slate",
      proofUrl: `/api/sports/decision/training/multi-sport-live-feature-storage-receipt?sport=basketball&date=${date}`,
      riskIfMissing: "Basketball loses real fixtures, prices, and stored strength linkage; specialist injury and rotation context remains a separate enrichment lane."
    }),
    lane({
      id: "tennis-core",
      label: "Tennis live + historical bridge",
      priority: 4,
      env,
      keys: ["THE_ODDS_API_KEY", "ODDS_API_KEY", "API_TENNIS_KEY", "SPORTS_API_KEY"],
      acceptedAlternatives: ["The Odds API plus stored OddsPadi surface history", "API-Tennis for premium round, fatigue, H2H, and injury enrichment"],
      unlocks: ["live matches and odds", "stored player Elo", "surface ratings", "match-winner and totals decisions"],
      firstMilestone: tennisJob?.label ?? "Store the first provider-backed tennis feature slate",
      proofUrl: `/api/sports/decision/training/multi-sport-live-feature-storage-receipt?sport=tennis&date=${date}`,
      riskIfMissing: "Tennis loses real matches, prices, and stored surface-strength linkage; specialist H2H, fatigue, round, and injury context remains a separate enrichment lane."
    }),
    lane({
      id: "news-context",
      label: "News provider",
      priority: 5,
      env,
      keys: ["NEWS_API_KEY"],
      acceptedAlternatives: ["News API", "licensed sports news/RSS feed with source URLs"],
      unlocks: ["team news signals", "injury/news adjustment", "avoid flags for late uncertainty"],
      firstMilestone: "Attach source-stamped team news before the EPL opener",
      proofUrl: "/api/sports/decision/context-signal-proof",
      riskIfMissing: "The AI reviewer must abstain more often because news and late availability claims are unsupported."
    }),
    lane({
      id: "weather-context",
      label: "Weather provider",
      priority: 6,
      env,
      keys: ["WEATHER_API_KEY", "OPENWEATHER_API_KEY"],
      acceptedAlternatives: ["OpenWeather", "weather API with location and kickoff-time forecasts"],
      unlocks: ["football weather adjustment", "total-goals risk flags", "outdoor match tempo checks"],
      firstMilestone: "Attach kickoff weather to outdoor EPL fixtures when forecast windows open",
      proofUrl: "/api/sports/decision/data-source-coverage?sport=football",
      riskIfMissing: "Football totals and tempo decisions cannot account for weather-sensitive fixtures."
    })
  ];
  const lanesById = new Map(lanes.map((item) => [item.id, item]));
  const feedRows = [
    feed({
      id: "fixtures",
      label: "Fixtures for the day",
      priority: 1,
      lanesById,
      sports: ["football", "basketball", "tennis"],
      requiredLaneIds: ["football-core", "basketball-core", "tennis-core"],
      modelFeatures: ["slate selection", "kickoff/start time", "provider event IDs"],
      unlocks: ["real match slate", "odds-event linkage", "pre-match trust gates"],
      proofUrl: "/api/sports/fixtures"
    }),
    feed({
      id: "historical-results",
      label: "Team/player historical results",
      priority: 2,
      lanesById,
      sports: ["football", "basketball", "tennis"],
      requiredLaneIds: ["football-core", "basketball-core", "tennis-core"],
      modelFeatures: ["football Elo", "basketball rating", "tennis player Elo", "outcome labels"],
      unlocks: ["10-year corpus", "walk-forward backtests", "calibration against settled outcomes"],
      proofUrl: "/api/sports/decision/training/ten-year-corpus-execution"
    }),
    feed({
      id: "odds",
      label: "Bookmaker odds",
      priority: 3,
      lanesById,
      sports: ["football", "basketball", "tennis"],
      requiredLaneIds: ["odds-markets"],
      modelFeatures: ["implied probability", "no-vig probability", "value edge", "market movement"],
      unlocks: ["positive expected value ranking", "closing-line validation", "safer alternatives"],
      proofUrl: "/api/sports/decision/epl-odds-market-map"
    }),
    feed({
      id: "standings-home-away-form",
      label: "Standings, home/away, recent form",
      priority: 4,
      lanesById,
      sports: ["football", "basketball"],
      requiredLaneIds: ["football-core", "basketball-core"],
      modelFeatures: ["home advantage", "recent form weighting", "league standing context"],
      unlocks: ["football expected-goals priors", "basketball rest/form context"],
      proofUrl: "/api/sports/decision/data-backbone"
    }),
    feed({
      id: "injuries-suspensions",
      label: "Injuries and suspensions",
      priority: 5,
      lanesById,
      sports: ["football", "basketball", "tennis"],
      requiredLaneIds: ["football-core", "basketball-core", "tennis-core", "news-context"],
      modelFeatures: ["availability adjustment", "rotation risk", "fitness downgrade"],
      unlocks: ["injury/news adjustment", "avoid flags", "AI risk explanation"],
      proofUrl: "/api/sports/decision/context-signal-proof"
    }),
    feed({
      id: "lineups",
      label: "Lineups when available",
      priority: 6,
      lanesById,
      sports: ["football", "basketball"],
      requiredLaneIds: ["football-core", "basketball-core"],
      modelFeatures: ["starter confirmation", "formation/rotation adjustment", "late downgrade"],
      unlocks: ["pre-match confidence correction", "safer market alternatives"],
      proofUrl: "/api/sports/decision/provider-batch-manifest"
    }),
    feed({
      id: "live-scores-events",
      label: "Live scores and match events",
      priority: 7,
      lanesById,
      sports: ["football", "basketball", "tennis"],
      requiredLaneIds: ["football-core", "basketball-core", "tennis-core"],
      modelFeatures: ["state refresh", "event provenance", "settlement labels"],
      unlocks: ["live monitoring", "outcome settlement", "future in-play abstention gates"],
      proofUrl: "/api/sports/decision/live-provider-probe-ledger"
    }),
    feed({
      id: "basketball-efficiency",
      label: "Basketball pace and efficiency",
      priority: 8,
      lanesById,
      sports: ["basketball"],
      requiredLaneIds: ["basketball-core", "odds-markets"],
      modelFeatures: ["pace", "offensive efficiency", "defensive efficiency", "spread/total logic"],
      unlocks: ["basketball model calibration", "spread and moneyline comparison"],
      proofUrl: "/api/sports/decision/training/ten-year-corpus-execution?sport=basketball"
    }),
    feed({
      id: "tennis-player-history",
      label: "Tennis player and surface history",
      priority: 9,
      lanesById,
      sports: ["tennis"],
      requiredLaneIds: ["tennis-core", "odds-markets"],
      modelFeatures: ["surface Elo", "head-to-head", "fatigue", "tournament round"],
      unlocks: ["tennis player model calibration", "match-winner value comparison"],
      proofUrl: "/api/sports/decision/training/ten-year-corpus-execution?sport=tennis"
    }),
    feed({
      id: "news",
      label: "News signals",
      priority: 10,
      lanesById,
      sports: ["football", "basketball", "tennis"],
      requiredLaneIds: ["news-context"],
      optional: true,
      modelFeatures: ["late-breaking context", "source-stamped AI citations"],
      unlocks: ["richer risk explanations", "avoid rules for uncertain matches"],
      proofUrl: "/api/sports/decision/ai-citations"
    }),
    feed({
      id: "weather",
      label: "Weather for football",
      priority: 11,
      lanesById,
      sports: ["football"],
      requiredLaneIds: ["weather-context"],
      optional: true,
      modelFeatures: ["outdoor weather context", "tempo/total-goals risk"],
      unlocks: ["weather-sensitive football adjustments"],
      proofUrl: "/api/sports/decision/data-source-coverage?sport=football"
    })
  ].sort((a, b) => a.priority - b.priority);
  const criticalLaneIds = new Set<DecisionProviderKeyPlanLane["id"]>(["football-core", "odds-markets", "basketball-core", "tennis-core"]);
  const criticalLanes = lanes.filter((item) => criticalLaneIds.has(item.id));
  const configuredCriticalLanes = criticalLanes.filter((item) => item.status === "configured").length;
  const nextLane = lanes.find((item) => item.status === "missing") ?? null;
  const missingCriticalKeys = unique(criticalLanes.flatMap((item) => item.missing));
  const status: DecisionProviderKeyPlanStatus =
    missingCriticalKeys.length === 0 ? "ready" : configuredCriticalLanes > 0 ? "partial" : "missing-critical";
  const nextFeed = feedRows.find((item) => item.status === "missing-critical") ?? feedRows.find((item) => item.status === "optional-missing") ?? null;

  return {
    mode: "provider-key-plan",
    status,
    summary: summaryFor(status, nextLane),
    firstSeasonTarget: {
      competition: EPL_2026_SEASON.competition,
      season: EPL_2026_SEASON.season,
      providerSeason: EPL_2026_SEASON.providerSeason,
      starts: EPL_2026_SEASON.seasonStartDate,
      openingFixture,
      daysUntilStart: Math.max(0, dayDiff(asOfDate ?? date, EPL_2026_SEASON.seasonStartDate)),
      sourceUrl: EPL_2026_SEASON.sourceUrl
    },
    lanes,
    nextLane,
    missingCriticalKeys,
    configuredCriticalLanes,
    totalCriticalLanes: criticalLanes.length,
    feedMatrix: {
      rows: feedRows,
      nextFeed,
      totals: {
        feeds: feedRows.length,
        configured: feedRows.filter((item) => item.status === "configured").length,
        missingCritical: feedRows.filter((item) => item.status === "missing-critical").length,
        optionalMissing: feedRows.filter((item) => item.status === "optional-missing").length,
        modelFeatures: unique(feedRows.flatMap((item) => item.modelFeatures), 200).length
      }
    }
  };
}
