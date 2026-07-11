import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { DecisionProviderUnlockItem, DecisionProviderUnlockSnapshot } from "@/lib/sports/prediction/decisionProviderUnlockSnapshot";
import type { DecisionSlateThinking, DecisionSlateThought } from "@/lib/sports/prediction/decisionSlateThinking";
import type { Sport } from "@/lib/sports/types";

export type DecisionMvpEvidenceAcquisitionQueueStatus = "ready-readonly" | "waiting-provider" | "manual-review" | "blocked";
export type DecisionMvpEvidenceAcquisitionItemStatus = "ready-readonly" | "waiting-provider" | "manual-review" | "blocked";
export type DecisionMvpEvidenceAcquisitionProviderId = DecisionProviderUnlockItem["id"] | "decision-proof";

export type DecisionMvpEvidenceAcquisitionItem = {
  id: string;
  matchId: string;
  match: string;
  status: DecisionMvpEvidenceAcquisitionItemStatus;
  priority: DecisionSlateThought["priority"];
  providerId: DecisionMvpEvidenceAcquisitionProviderId;
  provider: string;
  label: string;
  gap: string;
  expectedEvidence: string;
  expectedBeliefChange: string;
  missingEnv: string[];
  proofUrl: string;
  command: string | null;
  safeToRun: boolean;
};

export type DecisionMvpEvidenceAcquisitionQueue = {
  mode: "decision-mvp-evidence-acquisition-queue";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionMvpEvidenceAcquisitionQueueStatus;
  queueHash: string;
  summary: string;
  nextItem: DecisionMvpEvidenceAcquisitionItem | null;
  items: DecisionMvpEvidenceAcquisitionItem[];
  totals: {
    items: number;
    readyReadonly: number;
    waitingProvider: number;
    manualReview: number;
    blocked: number;
    affectedMatches: number;
  };
  controls: {
    canInspectReadOnly: true;
    canRunNextSafeCommand: boolean;
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

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compact(value: string, maxLength = 240): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 40): string[] {
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

function priorityRank(priority: DecisionSlateThought["priority"]): number {
  if (priority === "critical") return 4;
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function statusRank(status: DecisionMvpEvidenceAcquisitionItemStatus): number {
  if (status === "ready-readonly") return 4;
  if (status === "waiting-provider") return 3;
  if (status === "manual-review") return 2;
  return 1;
}

function providerIdFor(gap: string, sport: Sport): DecisionMvpEvidenceAcquisitionProviderId {
  const text = gap.toLowerCase();
  if (text.includes("odds") || text.includes("market") || text.includes("bookmaker") || text.includes("value") || text.includes("no-vig")) return "odds-markets";
  if (text.includes("news") || text.includes("source") || text.includes("injury/news")) return "news-context";
  if (text.includes("weather") || text.includes("rain") || text.includes("wind")) return "weather-context";
  if (sport === "basketball" || text.includes("pace") || text.includes("efficiency") || text.includes("spread") || text.includes("moneyline")) return "basketball-core";
  if (sport === "tennis" || text.includes("surface") || text.includes("head-to-head") || text.includes("fatigue") || text.includes("player elo")) return "tennis-core";
  if (
    text.includes("fixture") ||
    text.includes("lineup") ||
    text.includes("injur") ||
    text.includes("suspension") ||
    text.includes("standings") ||
    text.includes("form") ||
    text.includes("home") ||
    text.includes("away") ||
    text.includes("event") ||
    text.includes("live") ||
    text.includes("xg")
  ) {
    return "football-core";
  }
  return "decision-proof";
}

function statusFor(provider: DecisionProviderUnlockItem | null, fallbackProofUrl: string): DecisionMvpEvidenceAcquisitionItemStatus {
  if (!provider) return fallbackProofUrl ? "manual-review" : "blocked";
  if (provider.status === "configured") return "ready-readonly";
  return "waiting-provider";
}

function providerLabel(provider: DecisionProviderUnlockItem | null): string {
  return provider?.provider ?? "OddsPadi decision proof";
}

function missingEnv(provider: DecisionProviderUnlockItem | null): string[] {
  if (!provider || provider.status === "configured") return [];
  return provider.placeholderKeys.length ? provider.placeholderKeys : provider.missingKeys.length ? provider.missingKeys : provider.acceptedEnvNames;
}

function expectedBeliefChange(thought: DecisionSlateThought, provider: DecisionProviderUnlockItem | null): string {
  const providerImpact = provider?.unlocksModelFeatures.slice(0, 3).join(", ") || "the cited decision proof";
  return compact(`May move ${thought.match} from ${thought.status} toward support, monitor, or avoid by resolving ${providerImpact}.`, 220);
}

function itemFor({
  thought,
  gap,
  providerUnlockSnapshot,
  sport,
  index
}: {
  thought: DecisionSlateThought;
  gap: string;
  providerUnlockSnapshot: DecisionProviderUnlockSnapshot;
  sport: Sport;
  index: number;
}): DecisionMvpEvidenceAcquisitionItem {
  const providerId = providerIdFor(gap, sport);
  const provider = providerId === "decision-proof" ? null : providerUnlockSnapshot.providers.find((item) => item.id === providerId) ?? null;
  const proofUrl = provider?.firstProofUrl ?? thought.verifyUrl;
  const status = statusFor(provider, proofUrl);
  const missing = missingEnv(provider);
  const safeToRun = status === "ready-readonly" && missing.length === 0 && proofUrl.startsWith("/api/");

  return {
    id: `mvp-evidence-${thought.matchId}-${index}`,
    matchId: thought.matchId,
    match: thought.match,
    status,
    priority: thought.priority,
    providerId,
    provider: providerLabel(provider),
    label: provider ? `Acquire ${provider.label} evidence` : "Inspect decision proof",
    gap: compact(gap, 220),
    expectedEvidence: compact(provider ? provider.unlocksFeeds.join(", ") : thought.nextEvidenceAction, 240),
    expectedBeliefChange: expectedBeliefChange(thought, provider),
    missingEnv: missing,
    proofUrl,
    command: safeToRun ? decisionCurlCommand(proofUrl) : null,
    safeToRun
  };
}

function summaryFor(status: DecisionMvpEvidenceAcquisitionQueueStatus, nextItem: DecisionMvpEvidenceAcquisitionItem | null): string {
  if (status === "ready-readonly") return `Evidence queue can inspect ${nextItem?.label ?? "a safe proof"} next without writes.`;
  if (status === "waiting-provider") return `Evidence queue is waiting on ${nextItem?.missingEnv[0] ?? "provider keys"} before belief can move.`;
  if (status === "manual-review") return `Evidence queue needs manual review for ${nextItem?.match ?? "the next slate belief"}.`;
  return "Evidence queue is blocked until slate thinking or proof routes are available.";
}

export function buildDecisionMvpEvidenceAcquisitionQueue({
  date,
  sport,
  slateThinking,
  providerUnlockSnapshot,
  now = new Date(),
  limit = 8
}: {
  date: string;
  sport: Sport;
  slateThinking: DecisionSlateThinking;
  providerUnlockSnapshot: DecisionProviderUnlockSnapshot;
  now?: Date;
  limit?: number;
}): DecisionMvpEvidenceAcquisitionQueue {
  const sourceThoughts = slateThinking.thoughts.filter((thought) => thought.evidenceGaps.length || thought.blockers.length || thought.watchReasons.length);
  const items = sourceThoughts
    .flatMap((thought) =>
      unique([thought.nextEvidenceAction, ...thought.evidenceGaps, ...thought.blockers, ...thought.watchReasons], 4).map((gap, index) =>
        itemFor({ thought, gap, providerUnlockSnapshot, sport, index })
      )
    )
    .sort((a, b) => {
      const status = statusRank(b.status) - statusRank(a.status);
      if (status !== 0) return status;
      const priority = priorityRank(b.priority) - priorityRank(a.priority);
      if (priority !== 0) return priority;
      return a.match.localeCompare(b.match);
    })
    .slice(0, Math.max(1, Math.min(20, limit)));
  const nextItem = items.find((item) => item.safeToRun) ?? items.find((item) => item.status !== "blocked") ?? items[0] ?? null;
  const totals = {
    items: items.length,
    readyReadonly: items.filter((item) => item.status === "ready-readonly").length,
    waitingProvider: items.filter((item) => item.status === "waiting-provider").length,
    manualReview: items.filter((item) => item.status === "manual-review").length,
    blocked: items.filter((item) => item.status === "blocked").length,
    affectedMatches: unique(items.map((item) => item.matchId), 200).length
  };
  const status: DecisionMvpEvidenceAcquisitionQueueStatus = totals.readyReadonly
    ? "ready-readonly"
    : totals.waitingProvider
      ? "waiting-provider"
      : totals.manualReview
        ? "manual-review"
        : "blocked";

  return {
    mode: "decision-mvp-evidence-acquisition-queue",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    queueHash: stableHash({
      date,
      sport,
      status,
      slate: slateThinking.thinkingHash,
      provider: providerUnlockSnapshot.snapshotHash,
      items: items.map((item) => [item.id, item.status, item.providerId, item.missingEnv])
    }),
    summary: summaryFor(status, nextItem),
    nextItem,
    items,
    totals,
    controls: {
      canInspectReadOnly: true,
      canRunNextSafeCommand: Boolean(nextItem?.safeToRun),
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/mvp-evidence-acquisition-queue",
      "/api/sports/decision/slate-thinking",
      "/api/sports/decision/provider-unlock-snapshot",
      ...items.map((item) => item.proofUrl)
    ]),
    locks: [
      "MVP evidence acquisition is read-only and ranks proof work only; it cannot fetch providers by itself.",
      "Provider dry-runs still require configured keys plus explicit admin/run gates on their own routes.",
      "Evidence acquisition cannot write provider rows, persist decisions, train models, publish picks, stake, or upgrade public action."
    ]
  };
}
