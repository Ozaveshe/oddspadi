import type { DecisionLiveProviderProbeLedger } from "@/lib/sports/prediction/decisionLiveProviderProbeLedger";
import type { DecisionProviderEnvDiagnostic, DecisionProviderEnvDiagnosticLane } from "@/lib/sports/prediction/decisionProviderEnvDiagnostic";
import type { Sport } from "@/lib/sports/types";

export type DecisionProviderUnlockSnapshotStatus = "ready" | "partial" | "blocked";
export type DecisionProviderUnlockItemStatus = "configured" | "placeholder" | "missing";

export type DecisionProviderUnlockItem = {
  id: DecisionProviderEnvDiagnosticLane["id"];
  label: string;
  status: DecisionProviderUnlockItemStatus;
  critical: boolean;
  provider: string;
  getKeyUrl: string;
  docsUrl: string;
  recommendedEnvName: string;
  acceptedEnvNames: string[];
  localEnvLine: string;
  netlifyEnvNames: string[];
  configuredKeys: string[];
  placeholderKeys: string[];
  missingKeys: string[];
  unlocksFeeds: string[];
  unlocksModelFeatures: string[];
  firstProofUrl: string;
  dryRunStatus: string | null;
  nextAction: string;
  riskIfMissing: string;
};

export type DecisionProviderUnlockSnapshot = {
  mode: "decision-provider-unlock-snapshot";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionProviderUnlockSnapshotStatus;
  snapshotHash: string;
  summary: string;
  nextProvider: DecisionProviderUnlockItem | null;
  footballMvpMinimum: {
    status: "ready" | "partial" | "waiting";
    requiredEnvLines: string[];
    nextMissingEnvName: string | null;
    firstProofUrl: string;
    afterSave: string[];
  };
  totals: {
    providers: number;
    configured: number;
    placeholders: number;
    missing: number;
    critical: number;
    configuredCritical: number;
    feeds: number;
    modelFeatures: number;
  };
  providers: DecisionProviderUnlockItem[];
  controls: {
    canInspectReadOnly: true;
    canShowProviderUrls: true;
    canWriteEnvFiles: false;
    canReadSecretValues: false;
    canPrintSecretValues: false;
    canRunProviderDryRun: boolean;
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

const PROVIDER_UNLOCKS: Record<
  DecisionProviderEnvDiagnosticLane["id"],
  {
    provider: string;
    getKeyUrl: string;
    docsUrl: string;
    envNames: string[];
    unlocksFeeds: string[];
    unlocksModelFeatures: string[];
    riskIfMissing: string;
  }
> = {
  "football-core": {
    provider: "API-Sports / API-Football",
    getKeyUrl: "https://dashboard.api-football.com/",
    docsUrl: "https://www.api-football.com/documentation-v3",
    envNames: ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"],
    unlocksFeeds: ["fixtures", "historical results", "standings", "home/away form", "injuries", "suspensions", "lineups", "live scores", "match events"],
    unlocksModelFeatures: ["Poisson xG inputs", "team strength/Elo", "home advantage", "recent form", "availability adjustment", "EPL 2026 fixture IDs"],
    riskIfMissing: "Football remains fixture-synthetic and cannot prove EPL 2026/27 fixtures or 10-year football labels."
  },
  "odds-markets": {
    provider: "The Odds API",
    getKeyUrl: "https://the-odds-api.com/",
    docsUrl: "https://the-odds-api.com/liveapi/guides/v4/",
    envNames: ["THE_ODDS_API_KEY", "ODDS_API_KEY"],
    unlocksFeeds: ["bookmaker odds", "market snapshots", "opening/closing prices", "event-market linkage"],
    unlocksModelFeatures: ["implied probability", "no-vig probability", "value edge", "expected value", "market movement", "safer alternatives"],
    riskIfMissing: "The money feature cannot distinguish model opinion from positive expected value."
  },
  "basketball-core": {
    provider: "The Odds API + OddsPadi historical strength",
    getKeyUrl: "https://the-odds-api.com/",
    docsUrl: "https://the-odds-api.com/liveapi/guides/v4/",
    envNames: ["THE_ODDS_API_KEY", "ODDS_API_KEY", "API_BASKETBALL_KEY", "SPORTS_API_KEY"],
    unlocksFeeds: ["basketball fixtures", "bookmaker odds", "stored team history", "stored pace and efficiency evidence"],
    unlocksModelFeatures: ["team rating", "pace", "offensive efficiency", "defensive efficiency", "spread/moneyline logic"],
    riskIfMissing: "Core basketball prediction loses real events, prices, and stored strength; API-Basketball remains optional for deeper rotation and injury context."
  },
  "tennis-core": {
    provider: "The Odds API + OddsPadi surface strength",
    getKeyUrl: "https://the-odds-api.com/",
    docsUrl: "https://the-odds-api.com/liveapi/guides/v4/",
    envNames: ["THE_ODDS_API_KEY", "ODDS_API_KEY", "API_TENNIS_KEY", "SPORTS_API_KEY"],
    unlocksFeeds: ["tennis events", "bookmaker odds", "stored player history", "stored surface history"],
    unlocksModelFeatures: ["player Elo", "surface-specific rating", "match-winner calibration", "total-games logic"],
    riskIfMissing: "Core tennis prediction loses real matches, prices, and stored surface strength; API-Tennis remains optional for deeper H2H, fatigue, round, and injury context."
  },
  "news-context": {
    provider: "News API or licensed sports-news feed",
    getKeyUrl: "https://newsapi.org/",
    docsUrl: "https://newsapi.org/docs",
    envNames: ["NEWS_API_KEY"],
    unlocksFeeds: ["team news", "injury news", "availability notes", "source-stamped context"],
    unlocksModelFeatures: ["injury/news adjustment", "late uncertainty flags", "AI risk explanation", "avoid reasons"],
    riskIfMissing: "The AI reviewer must abstain more often because late news claims are unsupported."
  },
  "weather-context": {
    provider: "Open-Meteo keyless forecast + optional OpenWeather",
    getKeyUrl: "https://openweathermap.org/api",
    docsUrl: "https://openweathermap.org/current",
    envNames: ["WEATHER_API_KEY", "OPENWEATHER_API_KEY"],
    unlocksFeeds: ["weather for outdoor football", "kickoff forecast", "wind/rain/temperature context"],
    unlocksModelFeatures: ["weather adjustment", "tempo risk", "total-goals risk", "outdoor match downgrade"],
    riskIfMissing: "Weather needs a provider-backed venue city and a kickoff inside the forecast window; OpenWeather remains optional enrichment."
  }
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

function unique(values: Array<string | null | undefined>, limit = 80): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function itemStatus(lane: DecisionProviderEnvDiagnosticLane): DecisionProviderUnlockItemStatus {
  if (lane.state === "configured") return "configured";
  if (lane.state === "placeholder") return "placeholder";
  return "missing";
}

function summaryFor(status: DecisionProviderUnlockSnapshotStatus, nextProvider: DecisionProviderUnlockItem | null): string {
  if (status === "ready") return "Provider unlock map is ready for guarded dry-runs; writes, training, publishing, and staking remain locked.";
  if (status === "partial") return `Provider unlock map is partially configured; next provider is ${nextProvider?.label ?? "not selected"}.`;
  return `Provider unlock map is blocked by ${nextProvider?.label ?? "critical sports and odds keys"}.`;
}

function snapshotStatus(items: DecisionProviderUnlockItem[], criticalTotal: number): DecisionProviderUnlockSnapshotStatus {
  const configuredCritical = items.filter((item) => item.critical && item.status === "configured").length;
  if (configuredCritical >= criticalTotal) return "ready";
  if (configuredCritical > 0 || items.some((item) => item.status === "placeholder")) return "partial";
  return "blocked";
}

function liveLaneStatus(liveProviderProbeLedger: DecisionLiveProviderProbeLedger, id: DecisionProviderEnvDiagnosticLane["id"]): string | null {
  if (id === "football-core") return liveProviderProbeLedger.lanes.find((lane) => lane.id === "football-core")?.status ?? null;
  if (id === "odds-markets") return liveProviderProbeLedger.lanes.find((lane) => lane.id === "football-odds")?.status ?? null;
  if (id === "basketball-core") return liveProviderProbeLedger.lanes.find((lane) => lane.id === "basketball-core")?.status ?? null;
  if (id === "tennis-core") return liveProviderProbeLedger.lanes.find((lane) => lane.id === "tennis-core")?.status ?? null;
  return null;
}

function usesOddsHistoricalBridge(lane: DecisionProviderEnvDiagnosticLane): boolean {
  return (
    (lane.id === "basketball-core" || lane.id === "tennis-core") &&
    lane.configuredKeys.some((key) => key === "THE_ODDS_API_KEY" || key === "ODDS_API_KEY")
  );
}

export function buildDecisionProviderUnlockSnapshot({
  date,
  sport,
  providerEnvDiagnostic,
  liveProviderProbeLedger,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  providerEnvDiagnostic: DecisionProviderEnvDiagnostic;
  liveProviderProbeLedger: DecisionLiveProviderProbeLedger;
  now?: Date;
}): DecisionProviderUnlockSnapshot {
  const footballCoreConfigured = providerEnvDiagnostic.lanes.find((lane) => lane.id === "football-core")?.state === "configured";
  const providers = providerEnvDiagnostic.lanes.map((lane): DecisionProviderUnlockItem => {
    const metadata = PROVIDER_UNLOCKS[lane.id];
    const keylessWeather = lane.id === "weather-context" && footballCoreConfigured;
    const status = keylessWeather ? "configured" : itemStatus(lane);
    const oddsHistoricalBridge = usesOddsHistoricalBridge(lane);
    return {
      id: lane.id,
      label: lane.label,
      status,
      critical: lane.critical,
      provider: metadata.provider,
      getKeyUrl: metadata.getKeyUrl,
      docsUrl: metadata.docsUrl,
      recommendedEnvName: metadata.envNames[0] ?? "",
      acceptedEnvNames: metadata.envNames,
      localEnvLine: `${metadata.envNames[0] ?? "PROVIDER_KEY"}=paste_${(metadata.envNames[0] ?? "provider_key").toLowerCase()}_here`,
      netlifyEnvNames: metadata.envNames,
      configuredKeys: lane.configuredKeys,
      placeholderKeys: lane.placeholderKeys,
      missingKeys: keylessWeather ? [] : lane.missingKeys,
      unlocksFeeds: metadata.unlocksFeeds,
      unlocksModelFeatures: metadata.unlocksModelFeatures,
      firstProofUrl: lane.proofUrl,
      dryRunStatus: keylessWeather ? "keyless-runtime-ready" : oddsHistoricalBridge ? "core-runtime-via-odds-and-history" : liveLaneStatus(liveProviderProbeLedger, lane.id),
      nextAction:
        status === "configured"
          ? keylessWeather
            ? "Verify venue-city coverage inside the forecast window; add OpenWeather only if a second weather source is needed."
            : oddsHistoricalBridge
            ? `Inspect the provider-backed ${lane.id === "basketball-core" ? "basketball" : "tennis"} feature receipt; specialist context APIs remain optional enrichment.`
            : `Run or inspect ${lane.label} proof before trusting unlocked feeds.`
          : lane.nextAction,
      riskIfMissing: metadata.riskIfMissing
    };
  });
  const criticalTotal = providers.filter((provider) => provider.critical).length;
  const configuredCritical = providers.filter((provider) => provider.critical && provider.status === "configured").length;
  const status = snapshotStatus(providers, criticalTotal);
  const nextProvider =
    providers.find((provider) => provider.critical && provider.status === "missing") ??
    providers.find((provider) => provider.critical && provider.status === "placeholder") ??
    providers.find((provider) => provider.status !== "configured") ??
    providers.find((provider) => provider.critical && provider.dryRunStatus !== "passed") ??
    null;
  const footballMvpProviders = providers.filter((provider) => provider.id === "football-core" || provider.id === "odds-markets");
  const footballConfigured = footballMvpProviders.filter((provider) => provider.status === "configured").length;
  const totals = {
    providers: providers.length,
    configured: providers.filter((provider) => provider.status === "configured").length,
    placeholders: providers.filter((provider) => provider.status === "placeholder").length,
    missing: providers.filter((provider) => provider.status === "missing").length,
    critical: criticalTotal,
    configuredCritical,
    feeds: unique(providers.flatMap((provider) => provider.unlocksFeeds), 200).length,
    modelFeatures: unique(providers.flatMap((provider) => provider.unlocksModelFeatures), 200).length
  };

  return {
    mode: "decision-provider-unlock-snapshot",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    snapshotHash: stableHash({
      date,
      sport,
      status,
      providerEnv: [providerEnvDiagnostic.status, providerEnvDiagnostic.totals],
      liveProvider: liveProviderProbeLedger.ledgerHash,
      providers: providers.map((provider) => [provider.id, provider.status, provider.dryRunStatus, provider.configuredKeys, provider.missingKeys])
    }),
    summary: summaryFor(status, nextProvider),
    nextProvider,
    footballMvpMinimum: {
      status: footballConfigured === footballMvpProviders.length ? "ready" : footballConfigured > 0 ? "partial" : "waiting",
      requiredEnvLines: footballMvpProviders.map((provider) => provider.localEnvLine),
      nextMissingEnvName: footballMvpProviders.find((provider) => provider.status !== "configured")?.recommendedEnvName ?? null,
      firstProofUrl: footballMvpProviders.find((provider) => provider.id === "football-core")?.firstProofUrl ?? "/api/sports/decision/provider-env-diagnostic",
      afterSave: [
        "Restart localhost so Next.js reloads process.env.",
        "Open the provider env diagnostic and confirm the key names are configured.",
        "Run only dry-run/admin-gated provider proof before any storage import."
      ]
    },
    totals,
    providers,
    controls: {
      canInspectReadOnly: true,
      canShowProviderUrls: true,
      canWriteEnvFiles: false,
      canReadSecretValues: false,
      canPrintSecretValues: false,
      canRunProviderDryRun: liveProviderProbeLedger.controls.canRunDryRun,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/provider-unlock-snapshot",
      "/api/sports/decision/provider-env-diagnostic",
      "/api/sports/decision/live-provider-probe-ledger",
      ...providers.map((provider) => provider.firstProofUrl),
      ...providerEnvDiagnostic.proofUrls,
      ...liveProviderProbeLedger.proofUrls
    ]),
    locks: [
      "Provider unlock snapshot never reads, prints, writes, or validates plaintext provider secrets.",
      "Open-Meteo supplies keyless forecast context only when provider venue-city evidence and a near-term kickoff are available.",
      "Configured keys only unlock read-only proof and dry-run checks until storage, training, and admin gates pass.",
      "Provider writes, decision persistence, model training, public picks, staking, and public action upgrades remain locked."
    ]
  };
}
