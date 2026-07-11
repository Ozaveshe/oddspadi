import { cleanEnvValue, hasAnyConfiguredEnv, isConfiguredSecretValue, type EnvMap } from "@/lib/env";
import type { DecisionProviderKeyPlan, DecisionProviderKeyPlanLane } from "@/lib/sports/prediction/decisionProviderKeyPlan";
import type { Sport } from "@/lib/sports/types";

export type DecisionProviderEnvDiagnosticStatus = "ready" | "placeholder-values" | "partial" | "missing-critical";
export type DecisionProviderEnvKeyState = "configured" | "placeholder" | "missing";
export type DecisionProviderEnvLaneState = "configured" | "placeholder" | "missing";

export type DecisionProviderEnvDiagnosticKey = {
  laneId: DecisionProviderKeyPlanLane["id"];
  laneLabel: string;
  key: string;
  state: DecisionProviderEnvKeyState;
  critical: boolean;
  recommended: boolean;
  acceptedAlternatives: string[];
  nextAction: string;
  proofUrl: string;
};

export type DecisionProviderEnvDiagnosticLane = {
  id: DecisionProviderKeyPlanLane["id"];
  label: string;
  state: DecisionProviderEnvLaneState;
  critical: boolean;
  configuredKeys: string[];
  placeholderKeys: string[];
  missingKeys: string[];
  acceptedAlternatives: string[];
  proofUrl: string;
  nextAction: string;
};

export type DecisionProviderEnvDiagnostic = {
  mode: "decision-provider-env-diagnostic";
  status: DecisionProviderEnvDiagnosticStatus;
  summary: string;
  date: string;
  sport: Sport;
  providerPlanStatus: DecisionProviderKeyPlan["status"];
  totals: {
    keys: number;
    configured: number;
    placeholders: number;
    missing: number;
    lanes: number;
    criticalLanes: number;
    configuredCriticalLanes: number;
    placeholderLanes: number;
    missingCriticalKeys: number;
  };
  footballMvpMinimum: {
    status: DecisionProviderEnvDiagnosticStatus;
    requiredLaneIds: Array<"football-core" | "odds-markets">;
    recommendedEnvNames: ["API_FOOTBALL_KEY", "THE_ODDS_API_KEY"];
    acceptedAlternativeEnvNames: string[];
    configuredKeys: string[];
    placeholderKeys: string[];
    missingKeys: string[];
    nextMissingEnvName: string | null;
    nextAction: string;
    proofUrl: string;
  };
  lanes: DecisionProviderEnvDiagnosticLane[];
  keys: DecisionProviderEnvDiagnosticKey[];
  selected: DecisionProviderEnvDiagnosticLane | null;
  controls: {
    readOnly: true;
    secretValuesReturned: false;
    canReadSecretValues: false;
    canPrintSecretValues: false;
    canWriteEnvFiles: false;
    canWriteNetlifyEnv: false;
    canRunProviderDryRun: boolean;
    canWriteProviderRows: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  proofUrls: string[];
};

const CRITICAL_LANE_IDS = new Set<DecisionProviderKeyPlanLane["id"]>(["football-core", "odds-markets", "basketball-core", "tennis-core"]);
const MVP_LANE_IDS: Array<"football-core" | "odds-markets"> = ["football-core", "odds-markets"];
const MVP_RECOMMENDED_ENV_NAMES: ["API_FOOTBALL_KEY", "THE_ODDS_API_KEY"] = ["API_FOOTBALL_KEY", "THE_ODDS_API_KEY"];

const DEFAULT_LANES: Array<Omit<DecisionProviderKeyPlanLane, "status" | "missing">> = [
  {
    id: "football-core",
    label: "Football provider",
    priority: 1,
    keys: ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
    acceptedAlternatives: ["API-Football", "APISports football", "generic sports API with league 39 coverage"],
    unlocks: ["fixtures", "historical results", "standings", "injuries", "lineups", "live scores", "match events"],
    firstMilestone: "EPL 2026/27 fixture dry-run",
    proofUrl: "/api/sports/decision/epl-fixture-intake",
    riskIfMissing: "The football engine remains fixture-synthetic and cannot verify the EPL 2026/27 slate or historical labels."
  },
  {
    id: "odds-markets",
    label: "Odds provider",
    priority: 2,
    keys: ["THE_ODDS_API_KEY", "ODDS_API_KEY"],
    acceptedAlternatives: ["The Odds API", "bookmaker odds feed with decimal prices and event IDs"],
    unlocks: ["implied probability", "no-vig margin removal", "value edge", "expected value ranking"],
    firstMilestone: "Map bookmaker event IDs to EPL 2026/27 opening fixtures",
    proofUrl: "/api/sports/decision/epl-odds-market-map",
    riskIfMissing: "The money feature cannot distinguish model opinion from positive expected value."
  },
  {
    id: "basketball-core",
    label: "Basketball live + historical bridge",
    priority: 3,
    keys: ["THE_ODDS_API_KEY", "ODDS_API_KEY", "API_BASKETBALL_KEY", "SPORTS_API_KEY"],
    acceptedAlternatives: ["The Odds API plus stored OddsPadi basketball history", "API-Basketball for premium context"],
    unlocks: ["live fixtures and odds", "stored team strength", "pace and efficiency priors", "spread", "moneyline"],
    firstMilestone: "Store the first provider-backed basketball feature slate",
    proofUrl: "/api/sports/decision/training/multi-sport-live-feature-storage-receipt?sport=basketball",
    riskIfMissing: "Basketball loses real fixtures, prices, and stored historical-strength linkage."
  },
  {
    id: "tennis-core",
    label: "Tennis live + historical bridge",
    priority: 4,
    keys: ["THE_ODDS_API_KEY", "ODDS_API_KEY", "API_TENNIS_KEY", "SPORTS_API_KEY"],
    acceptedAlternatives: ["The Odds API plus stored OddsPadi surface history", "API-Tennis for premium context"],
    unlocks: ["live matches and odds", "stored player Elo", "surface ratings", "match-winner backtests"],
    firstMilestone: "Store the first provider-backed tennis feature slate",
    proofUrl: "/api/sports/decision/training/multi-sport-live-feature-storage-receipt?sport=tennis",
    riskIfMissing: "Tennis loses real matches, prices, and stored surface-strength linkage."
  },
  {
    id: "news-context",
    label: "News provider",
    priority: 5,
    keys: ["NEWS_API_KEY"],
    acceptedAlternatives: ["News API", "licensed sports news/RSS feed with source URLs"],
    unlocks: ["team news signals", "injury/news adjustment", "avoid flags for late uncertainty"],
    firstMilestone: "Attach source-stamped team news before the EPL opener",
    proofUrl: "/api/sports/decision/context-signal-proof",
    riskIfMissing: "The AI reviewer must abstain more often because news and late availability claims are unsupported."
  },
  {
    id: "weather-context",
    label: "Weather provider",
    priority: 6,
    keys: ["WEATHER_API_KEY", "OPENWEATHER_API_KEY"],
    acceptedAlternatives: ["OpenWeather", "weather API with location and kickoff-time forecasts"],
    unlocks: ["football weather adjustment", "total-goals risk flags", "outdoor match tempo checks"],
    firstMilestone: "Attach kickoff weather to outdoor EPL fixtures when forecast windows open",
    proofUrl: "/api/sports/decision/data-source-coverage?sport=football",
    riskIfMissing: "Football totals and tempo decisions cannot account for weather-sensitive fixtures."
  }
];

function classifyEnvValue(value: string | undefined): DecisionProviderEnvKeyState {
  const clean = cleanEnvValue(value);
  if (!clean) return "missing";
  return isConfiguredSecretValue(clean) ? "configured" : "placeholder";
}

function laneState(keys: DecisionProviderEnvDiagnosticKey[]): DecisionProviderEnvLaneState {
  if (keys.some((key) => key.state === "configured")) return "configured";
  if (keys.some((key) => key.state === "placeholder")) return "placeholder";
  return "missing";
}

function statusFor({
  placeholderKeys,
  configuredCriticalLanes,
  totalCriticalLanes
}: {
  placeholderKeys: number;
  configuredCriticalLanes: number;
  totalCriticalLanes: number;
}): DecisionProviderEnvDiagnosticStatus {
  if (placeholderKeys > 0) return "placeholder-values";
  if (configuredCriticalLanes >= totalCriticalLanes) return "ready";
  if (configuredCriticalLanes > 0) return "partial";
  return "missing-critical";
}

function nextActionForKey(state: DecisionProviderEnvKeyState, lane: DecisionProviderKeyPlanLane): string {
  if (state === "configured") return `${lane.label} has a configured env name; keep the value hidden and verify the provider dry-run.`;
  if (state === "placeholder") return `Replace the placeholder assigned to this env name with the real provider-issued secret, then restart localhost and Netlify.`;
  return `Add this env name, or one accepted alternative for ${lane.label}, in .env.local and Netlify environment variables.`;
}

function summaryFor(status: DecisionProviderEnvDiagnosticStatus, selected: DecisionProviderEnvDiagnosticLane | null): string {
  if (status === "ready") return "Provider env names are configured for the critical sports and odds lanes; the next step is guarded provider dry-run proof.";
  if (status === "placeholder-values") {
    return `At least one provider env name contains a setup placeholder; replace it with a real provider-issued key before dry-runs.`;
  }
  if (status === "partial") return `Provider env names are partially configured; next lane is ${selected?.label ?? "not selected"}.`;
  return `Critical provider env names are missing; next lane is ${selected?.label ?? "football and odds providers"}.`;
}

export function buildDecisionProviderEnvDiagnostic({
  date,
  sport,
  providerKeyPlan,
  env = process.env
}: {
  date: string;
  sport: Sport;
  providerKeyPlan: DecisionProviderKeyPlan;
  env?: EnvMap;
}): DecisionProviderEnvDiagnostic {
  const keys = providerKeyPlan.lanes.flatMap((lane) =>
    lane.keys.map((key, index): DecisionProviderEnvDiagnosticKey => {
      const state = classifyEnvValue(env[key]);
      return {
        laneId: lane.id,
        laneLabel: lane.label,
        key,
        state,
        critical: CRITICAL_LANE_IDS.has(lane.id),
        recommended: MVP_RECOMMENDED_ENV_NAMES.includes(key as (typeof MVP_RECOMMENDED_ENV_NAMES)[number]) || index === 0,
        acceptedAlternatives: lane.keys,
        nextAction: nextActionForKey(state, lane),
        proofUrl: lane.proofUrl
      };
    })
  );

  const lanes = providerKeyPlan.lanes.map((lane): DecisionProviderEnvDiagnosticLane => {
    const laneKeys = keys.filter((key) => key.laneId === lane.id);
    const state = laneState(laneKeys);
    return {
      id: lane.id,
      label: lane.label,
      state,
      critical: CRITICAL_LANE_IDS.has(lane.id),
      configuredKeys: laneKeys.filter((key) => key.state === "configured").map((key) => key.key),
      placeholderKeys: laneKeys.filter((key) => key.state === "placeholder").map((key) => key.key),
      missingKeys: laneKeys.filter((key) => key.state === "missing").map((key) => key.key),
      acceptedAlternatives: lane.acceptedAlternatives,
      proofUrl: lane.proofUrl,
      nextAction:
        state === "configured"
          ? `Run the read-only proof at ${lane.proofUrl} before any storage writes.`
          : state === "placeholder"
            ? `Replace placeholder env values for ${lane.label}; do not run provider dry-runs until the diagnostic is clean.`
            : `Add one accepted env name for ${lane.label}, then restart localhost and Netlify.`
    };
  });

  const configuredCriticalLanes = lanes.filter((lane) => lane.critical && lane.state === "configured").length;
  const totalCriticalLanes = lanes.filter((lane) => lane.critical).length;
  const placeholderKeyCount = keys.filter((key) => key.state === "placeholder").length;
  const status = statusFor({
    placeholderKeys: placeholderKeyCount,
    configuredCriticalLanes,
    totalCriticalLanes
  });
  const selected =
    lanes.find((lane) => lane.critical && lane.state === "placeholder") ??
    lanes.find((lane) => lane.critical && lane.state === "missing") ??
    lanes.find((lane) => lane.state === "placeholder") ??
    lanes.find((lane) => lane.state === "missing") ??
    null;

  const mvpLanes = lanes.filter((lane): lane is DecisionProviderEnvDiagnosticLane & { id: "football-core" | "odds-markets" } =>
    MVP_LANE_IDS.includes(lane.id as (typeof MVP_LANE_IDS)[number])
  );
  const mvpKeys = keys.filter((key) => MVP_LANE_IDS.includes(key.laneId as (typeof MVP_LANE_IDS)[number]));
  const mvpConfiguredLanes = mvpLanes.filter((lane) => lane.state === "configured").length;
  const mvpPlaceholderKeys = mvpKeys.filter((key) => key.state === "placeholder").map((key) => key.key);
  const mvpMissingKeys = mvpLanes.flatMap((lane) => (lane.state === "configured" ? [] : lane.missingKeys));
  const mvpStatus = statusFor({
    placeholderKeys: mvpPlaceholderKeys.length,
    configuredCriticalLanes: mvpConfiguredLanes,
    totalCriticalLanes: MVP_LANE_IDS.length
  });
  const mvpNextLane = mvpLanes.find((lane) => lane.state === "placeholder") ?? mvpLanes.find((lane) => lane.state === "missing") ?? null;

  return {
    mode: "decision-provider-env-diagnostic",
    status,
    summary: summaryFor(status, selected),
    date,
    sport,
    providerPlanStatus: providerKeyPlan.status,
    totals: {
      keys: keys.length,
      configured: keys.filter((key) => key.state === "configured").length,
      placeholders: placeholderKeyCount,
      missing: keys.filter((key) => key.state === "missing").length,
      lanes: lanes.length,
      criticalLanes: totalCriticalLanes,
      configuredCriticalLanes,
      placeholderLanes: lanes.filter((lane) => lane.state === "placeholder").length,
      missingCriticalKeys: providerKeyPlan.missingCriticalKeys.length
    },
    footballMvpMinimum: {
      status: mvpStatus,
      requiredLaneIds: MVP_LANE_IDS,
      recommendedEnvNames: MVP_RECOMMENDED_ENV_NAMES,
      acceptedAlternativeEnvNames: Array.from(new Set(mvpLanes.flatMap((lane) => lane.missingKeys.concat(lane.configuredKeys, lane.placeholderKeys)))),
      configuredKeys: mvpKeys.filter((key) => key.state === "configured").map((key) => key.key),
      placeholderKeys: mvpPlaceholderKeys,
      missingKeys: mvpMissingKeys,
      nextMissingEnvName: mvpNextLane?.missingKeys[0] ?? mvpNextLane?.placeholderKeys[0] ?? null,
      nextAction:
        mvpStatus === "ready"
          ? "Football fixtures and odds env names are configured; run the guarded EPL provider and odds dry-runs next."
          : mvpStatus === "placeholder-values"
            ? "Replace placeholder football or odds env values with real provider-issued keys before dry-runs."
            : "Configure one football provider env name and one odds provider env name to unlock the MVP money feature.",
      proofUrl: "/api/sports/decision/provider-env-diagnostic"
    },
    lanes,
    keys,
    selected,
    controls: {
      readOnly: true,
      secretValuesReturned: false,
      canReadSecretValues: false,
      canPrintSecretValues: false,
      canWriteEnvFiles: false,
      canWriteNetlifyEnv: false,
      canRunProviderDryRun: status === "ready",
      canWriteProviderRows: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: [
      "/api/sports/decision/provider-env-diagnostic",
      "/api/sports/decision/provider-key-plan",
      "/api/sports/decision/provider-onboarding-contract",
      "/api/sports/decision/provider-key-activation-receipt"
    ]
  };
}

export function buildDecisionProviderEnvDiagnosticFromEnv({
  date,
  sport,
  env = process.env
}: {
  date: string;
  sport: Sport;
  env?: EnvMap;
}): DecisionProviderEnvDiagnostic {
  const lanes = DEFAULT_LANES.map((lane): DecisionProviderKeyPlanLane => {
    const configured = hasAnyConfiguredEnv(env, lane.keys);
    return {
      ...lane,
      status: configured ? "configured" : "missing",
      missing: configured ? [] : lane.keys
    };
  });
  const criticalLanes = lanes.filter((lane) => CRITICAL_LANE_IDS.has(lane.id));
  const providerKeyPlan: DecisionProviderKeyPlan = {
    mode: "provider-key-plan",
    status: criticalLanes.every((lane) => lane.status === "configured")
      ? "ready"
      : criticalLanes.some((lane) => lane.status === "configured")
        ? "partial"
        : "missing-critical",
    summary: "Provider env diagnostic generated from runtime env names without building the full decision launch context.",
    firstSeasonTarget: {
      competition: "Premier League",
      season: "2026/27",
      providerSeason: "2026",
      starts: "2026-08-21",
      openingFixture: "EPL 2026/27 opening fixture",
      daysUntilStart: 47,
      sourceUrl: "/api/sports/decision/epl-fixture-intake"
    },
    lanes,
    nextLane: lanes.find((lane) => CRITICAL_LANE_IDS.has(lane.id) && lane.status === "missing") ?? null,
    missingCriticalKeys: criticalLanes.flatMap((lane) => lane.missing),
    configuredCriticalLanes: criticalLanes.filter((lane) => lane.status === "configured").length,
    totalCriticalLanes: criticalLanes.length,
    feedMatrix: {
      rows: [],
      nextFeed: null,
      totals: {
        feeds: 0,
        configured: 0,
        missingCritical: 0,
        optionalMissing: 0,
        modelFeatures: 0
      }
    }
  };
  return buildDecisionProviderEnvDiagnostic({ date, sport, providerKeyPlan, env });
}
