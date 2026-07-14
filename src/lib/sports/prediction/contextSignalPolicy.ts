import type { DecisionDataCoverageSignal, MatchContextSignal } from "@/lib/sports/types";

export type ContextSignalInspection = {
  status: Extract<DecisionDataCoverageSignal["status"], "provider-backed" | "computed" | "mock" | "stale">;
  freshness: Extract<DecisionDataCoverageSignal["freshness"], "current" | "pre-match" | "historical" | "mock" | "stale">;
  ageMinutes: number | null;
};

type ContextSignalInspectionOptions = {
  now?: Date;
  requireTimestamp?: boolean;
};

const PROVIDER_ONLY_CATEGORIES = new Set<DecisionDataCoverageSignal["category"]>([
  "historical-results",
  "standings",
  "injuries",
  "suspensions",
  "lineups",
  "live-scores",
  "match-events",
  "news",
  "weather"
]);

const FRESHNESS_MINUTES: Record<MatchContextSignal["category"], number> = {
  injury: 12 * 60,
  suspension: 12 * 60,
  lineup: 2 * 60,
  "player-form": 45 * 24 * 60,
  standings: 12 * 60,
  weather: 6 * 60,
  news: 6 * 60,
  "live-event": 10,
  rest: 24 * 60,
  surface: 7 * 24 * 60
};

function normalizedSource(signal: MatchContextSignal | undefined): string {
  return signal?.source.trim().toLowerCase() ?? "";
}

function isMockSource(source: string): boolean {
  return /(^|[-_\s])(mock|synthetic|seed|fake|fallback)([-_\s]|$)/.test(source);
}

function isComputedSource(source: string): boolean {
  return /(^|[-_\s])(computed|deterministic|derived|proxy)([-_\s]|$)/.test(source);
}

function ageInMinutes(publishedAt: string | undefined, now: Date): number | null {
  if (!publishedAt) return null;
  const publishedMs = new Date(publishedAt).getTime();
  if (!Number.isFinite(publishedMs)) return null;
  return (now.getTime() - publishedMs) / 60_000;
}

export function inspectContextSignal(
  signal: MatchContextSignal | undefined,
  { now = new Date(), requireTimestamp = false }: ContextSignalInspectionOptions = {}
): ContextSignalInspection | null {
  if (!signal) return null;

  const source = normalizedSource(signal);
  if (isMockSource(source)) return { status: "mock", freshness: "mock", ageMinutes: ageInMinutes(signal.publishedAt, now) };
  if (isComputedSource(source)) return { status: "computed", freshness: "pre-match", ageMinutes: ageInMinutes(signal.publishedAt, now) };

  const ageMinutes = ageInMinutes(signal.publishedAt, now);
  const maxAgeMinutes = FRESHNESS_MINUTES[signal.category];
  const hasInvalidTimestamp = requireTimestamp && ageMinutes === null;
  const outsideClockSkew = ageMinutes !== null && ageMinutes < -5;
  const expired = ageMinutes !== null && ageMinutes > maxAgeMinutes;
  if (hasInvalidTimestamp || outsideClockSkew || expired) {
    return { status: "stale", freshness: "stale", ageMinutes };
  }

  return { status: "provider-backed", freshness: "current", ageMinutes };
}

export function isFreshProviderContextSignal(signal: MatchContextSignal | undefined, options?: ContextSignalInspectionOptions): boolean {
  return inspectContextSignal(signal, options)?.status === "provider-backed";
}

export function isRequiredProductionDataSignalBlocked(signal: Pick<DecisionDataCoverageSignal, "category" | "status" | "requiredForProduction">): boolean {
  if (!signal.requiredForProduction) return false;
  if (signal.status === "missing" || signal.status === "stale" || signal.status === "mock") return true;
  return signal.status === "computed" && PROVIDER_ONLY_CATEGORIES.has(signal.category);
}
