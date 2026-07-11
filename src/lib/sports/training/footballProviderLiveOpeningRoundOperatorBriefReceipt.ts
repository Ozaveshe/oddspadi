import {
  persistDecisionBriefing,
  type DecisionBriefing,
  type DecisionBriefingPersistenceResult,
  type DecisionBriefingProof
} from "@/lib/sports/prediction/decisionBriefing";
import type { FootballProviderLiveOpeningRoundDecisionCycleReceipt } from "@/lib/sports/training/footballProviderLiveOpeningRoundDecisionCycleReceipt";

export type FootballProviderLiveOpeningRoundOperatorBriefStatus =
  | "preview-ready"
  | "stored-readback-ready"
  | "storage-failed"
  | "unauthorized"
  | "safe-hold";

export type FootballProviderLiveOpeningRoundOperatorBriefReceipt = {
  mode: "football-provider-live-opening-round-operator-brief";
  generatedAt: string;
  status: FootballProviderLiveOpeningRoundOperatorBriefStatus;
  summary: string;
  sourceCycle: {
    mode: FootballProviderLiveOpeningRoundDecisionCycleReceipt["mode"];
    status: FootballProviderLiveOpeningRoundDecisionCycleReceipt["status"];
    cycleHash: string;
    selectedDate: string | null;
    selectedFixtureExternalId: string | null;
    selectedMatch: string | null;
    aiReviewStatus: FootballProviderLiveOpeningRoundDecisionCycleReceipt["aiReview"] extends infer Review
      ? Review extends { status: infer Status }
        ? Status | null
        : null
      : null;
  };
  briefing: DecisionBriefing;
  persistence: DecisionBriefingPersistenceResult & {
    adminAuthorized: boolean;
    readbackReady: boolean;
  };
  controls: {
    canInspectReadOnly: true;
    canPersistOperatorReceipt: boolean;
    requiresAdminHeader: true;
    canPublishPicks: false;
    canTrainModels: false;
    canStake: false;
    canUpgradePublicAction: false;
  };
  locks: string[];
  proofUrls: string[];
};

type OpeningCandidate = FootballProviderLiveOpeningRoundDecisionCycleReceipt["candidates"][number];
type PersistDecisionBriefingFn = (briefing: DecisionBriefing) => Promise<DecisionBriefingPersistenceResult>;

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function compact(value: string | null | undefined, maxLength = 280): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No public detail available.";
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function decimal(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Number(value.toFixed(6));
}

function pct(value: number | null | undefined): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "unknown";
  return `${(value * 100).toFixed(1)}%`;
}

function selectedCandidate(cycle: FootballProviderLiveOpeningRoundDecisionCycleReceipt): OpeningCandidate | null {
  const fixtureId = cycle.target.selectedFixtureExternalId;
  const selection = cycle.target.selectedSelection;
  if (!fixtureId && !selection) return cycle.candidates[0] ?? null;
  return (
    cycle.candidates.find(
      (candidate) =>
        candidate.fixtureExternalId === fixtureId &&
        (!selection || candidate.selectionLabel === selection) &&
        (!cycle.target.selectedDate || candidate.date === cycle.target.selectedDate)
    ) ??
    cycle.candidates.find((candidate) => candidate.fixtureExternalId === fixtureId) ??
    cycle.candidates[0] ??
    null
  );
}

function briefingStatus(cycle: FootballProviderLiveOpeningRoundDecisionCycleReceipt, selected: OpeningCandidate | null): DecisionBriefing["status"] {
  if (!selected) return "no-candidates";
  if (cycle.status === "opening-round-ai-reviewed-monitor") return "ready-watchlist";
  if (cycle.status === "opening-round-monitor-ready" || cycle.status === "partial-monitor-ready") return "needs-review";
  return "blocked";
}

function postureFor(status: DecisionBriefing["status"]): DecisionBriefing["posture"] {
  if (status === "ready-watchlist" || status === "needs-review") return "monitor-only";
  if (status === "blocked") return "avoid";
  return "hold";
}

function actionFor(status: DecisionBriefing["status"], selected: OpeningCandidate | null): DecisionBriefing["action"] {
  if (!selected || status === "no-candidates") return "hold";
  if (status === "blocked") return "avoid";
  return selected.action;
}

function proofStatus(status: "pass" | "watch" | "block"): DecisionBriefingProof["status"] {
  if (status === "pass") return "support";
  if (status === "watch") return "watch";
  return "block";
}

function proofChain(cycle: FootballProviderLiveOpeningRoundDecisionCycleReceipt): DecisionBriefingProof[] {
  return cycle.thinkingTrace.map((item) => ({
    id: item.id,
    label: item.label,
    status: proofStatus(item.status),
    detail: item.note,
    proofUrl: item.proofUrl
  }));
}

function headlineFor(status: DecisionBriefing["status"], selected: OpeningCandidate | null, cycle: FootballProviderLiveOpeningRoundDecisionCycleReceipt): string {
  if (!selected) return "No opening-round monitor candidate is ready for an operator brief.";
  if (status === "ready-watchlist") return `${selected.matchLabel} is AI-reviewed for monitor-only operator review.`;
  if (status === "needs-review") return `${selected.matchLabel} is monitor-ready but still waiting on explicit AI/operator review.`;
  return `${cycle.target.selectedMatch ?? selected.matchLabel} is blocked from operator promotion.`;
}

function thesisFor(cycle: FootballProviderLiveOpeningRoundDecisionCycleReceipt, selected: OpeningCandidate | null): string {
  if (!selected) return "The opening-round cycle did not produce a ranked monitor candidate.";
  return compact(
    `${selected.selectionLabel} is the operator-monitor candidate because the live model probability is ${pct(
      selected.modelProbability
    )} versus no-vig market ${pct(selected.marketProbability)}, creating ${pct(selected.edge)} edge and ${pct(
      selected.expectedValue
    )} expected value from ${cycle.totals.storageReadbackRows} stored readback row(s).`
  );
}

function counterThesisFor(cycle: FootballProviderLiveOpeningRoundDecisionCycleReceipt, selected: OpeningCandidate | null): string {
  const ai = cycle.aiReview?.appliedReview;
  const risk = selected?.risks[0] ?? ai?.riskFlags[0] ?? cycle.thinkingTrace.find((item) => item.status !== "pass")?.note;
  return compact(risk ?? "Late team news, lineups, weather, odds movement, or missing settlement can erase the edge.");
}

function decisionFor(status: DecisionBriefing["status"], cycle: FootballProviderLiveOpeningRoundDecisionCycleReceipt): string {
  if (status === "ready-watchlist") {
    const verdict = cycle.aiReview?.appliedReview.reviewVerdict ?? "reviewed";
    return `Monitor only. AI review returned ${verdict}; public picks, staking, training, and action upgrades remain locked.`;
  }
  if (status === "needs-review") return "Monitor only. Run bounded AI/operator review before using this as a working slate note.";
  if (status === "blocked") return "Avoid. The opening-round cycle did not clear provider, storage, ranking, and review gates.";
  return "Hold. No ranked candidate is ready.";
}

export function buildFootballProviderLiveOpeningRoundDecisionBriefing({
  cycle,
  now = new Date()
}: {
  cycle: FootballProviderLiveOpeningRoundDecisionCycleReceipt;
  now?: Date;
}): DecisionBriefing {
  const selected = selectedCandidate(cycle);
  const status = briefingStatus(cycle, selected);
  const action = actionFor(status, selected);
  const chain = proofChain(cycle);
  const ai = cycle.aiReview?.appliedReview;

  return {
    mode: "decision-briefing",
    generatedAt: now.toISOString(),
    date: cycle.target.selectedDate ?? cycle.request.dateWindow[0] ?? now.toISOString().slice(0, 10),
    sport: "football",
    status,
    briefingHash: stableHash({
      kind: "football-provider-live-opening-round",
      cycle: cycle.cycleHash,
      status,
      selected: selected ? [selected.date, selected.fixtureExternalId, selected.selectionLabel, selected.expectedValue] : null,
      aiReview: cycle.aiReview ? [cycle.aiReview.status, cycle.aiReview.reviewHash] : null
    }),
    headline: headlineFor(status, selected, cycle),
    posture: postureFor(status),
    action,
    target: {
      matchId: cycle.target.selectedFixtureExternalId ?? selected?.fixtureExternalId ?? null,
      match: cycle.target.selectedMatch ?? selected?.matchLabel ?? null,
      league: selected?.league ?? cycle.request.filters.league ?? "Premier League",
      selection: cycle.target.selectedSelection ?? selected?.selectionLabel ?? null
    },
    probability: {
      model: decimal(selected?.modelProbability),
      market: decimal(selected?.marketProbability),
      posterior: decimal(selected?.modelProbability),
      edge: decimal(selected?.edge),
      expectedValue: decimal(selected?.expectedValue)
    },
    thesis: thesisFor(cycle, selected),
    counterThesis: counterThesisFor(cycle, selected),
    decision: decisionFor(status, cycle),
    risks: unique([...(selected?.risks ?? []), ...(ai?.riskFlags ?? []), ...(ai?.dataGaps ?? []), ...(cycle.selectedCycle?.risks ?? [])], 10),
    saferAlternatives: unique([...(selected?.saferAlternatives.map((item) => `${item.label}: ${item.rationale}`) ?? []), ...(ai?.saferAlternatives ?? [])], 8),
    nextEvidence: unique([...(ai?.dataGaps ?? []), ...cycle.nextActions.map((item) => item.expectedEvidence), ...(selected?.risks.slice(0, 2) ?? [])], 8),
    proofChain: chain,
    controls: {
      canInspectReadOnly: true,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canCallOpenAI: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique(["/api/sports/decision/training/football-provider-live-opening-round-operator-brief", ...cycle.proofUrls], 14),
    locks: unique(
      [
        "Operator brief storage is audit-only and does not publish a pick.",
        "The brief stores public reasoning, proof links, and control locks only; it does not store hidden chain-of-thought or secrets.",
        "Opening-round live rows cannot train models until fixtures settle and outcome labels exist.",
        ...cycle.locks
      ],
      12
    )
  };
}

function emptyPersistence(requested: boolean, reason: string): DecisionBriefingPersistenceResult & { adminAuthorized: boolean; readbackReady: boolean } {
  return {
    requested,
    status: "skipped",
    configured: false,
    table: "op_decision_briefings",
    adminAuthorized: false,
    readbackReady: false,
    reason
  };
}

function receiptStatus({
  persistRequested,
  adminAuthorized,
  persistence,
  briefing
}: {
  persistRequested: boolean;
  adminAuthorized: boolean;
  persistence: DecisionBriefingPersistenceResult & { readbackReady: boolean };
  briefing: DecisionBriefing;
}): FootballProviderLiveOpeningRoundOperatorBriefStatus {
  if (persistRequested && !adminAuthorized) return "unauthorized";
  if (persistRequested && persistence.status === "stored" && persistence.readbackReady) return "stored-readback-ready";
  if (persistRequested && persistence.status === "failed") return "storage-failed";
  if (briefing.status === "blocked" || briefing.status === "no-candidates") return "safe-hold";
  return "preview-ready";
}

export async function buildFootballProviderLiveOpeningRoundOperatorBriefReceipt({
  cycle,
  persistRequested = false,
  adminAuthorized = false,
  persistBriefing = persistDecisionBriefing,
  now = new Date()
}: {
  cycle: FootballProviderLiveOpeningRoundDecisionCycleReceipt;
  persistRequested?: boolean;
  adminAuthorized?: boolean;
  persistBriefing?: PersistDecisionBriefingFn;
  now?: Date;
}): Promise<FootballProviderLiveOpeningRoundOperatorBriefReceipt> {
  const briefing = buildFootballProviderLiveOpeningRoundDecisionBriefing({ cycle, now });
  const persistenceBase =
    persistRequested && adminAuthorized
      ? await persistBriefing(briefing)
      : emptyPersistence(
          persistRequested,
          persistRequested
            ? "Operator brief storage requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token."
            : "Preview only; no operator brief storage requested."
        );
  const persistence = {
    ...persistenceBase,
    adminAuthorized,
    readbackReady: Boolean(persistenceBase.readback?.id && persistenceBase.readback.briefingHash === briefing.briefingHash)
  };
  const status = receiptStatus({ persistRequested, adminAuthorized, persistence, briefing });

  return {
    mode: "football-provider-live-opening-round-operator-brief",
    generatedAt: now.toISOString(),
    status,
    summary:
      status === "stored-readback-ready"
        ? `Stored and read back operator brief ${briefing.briefingHash} for ${briefing.target.match ?? "opening-round candidate"}.`
        : status === "storage-failed"
          ? `Operator brief storage failed: ${persistence.reason ?? "unknown Supabase error"}.`
          : status === "unauthorized"
            ? "Operator brief storage was blocked by the admin guard."
            : `${briefing.headline} Storage is preview-only until an admin POST requests persistence.`,
    sourceCycle: {
      mode: cycle.mode,
      status: cycle.status,
      cycleHash: cycle.cycleHash,
      selectedDate: cycle.target.selectedDate,
      selectedFixtureExternalId: cycle.target.selectedFixtureExternalId,
      selectedMatch: cycle.target.selectedMatch,
      aiReviewStatus: cycle.aiReview?.status ?? null
    },
    briefing: {
      ...briefing,
      persistence
    },
    persistence,
    controls: {
      canInspectReadOnly: true,
      canPersistOperatorReceipt: adminAuthorized && !persistRequested,
      requiresAdminHeader: true,
      canPublishPicks: false,
      canTrainModels: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    locks: unique(
      [
        "Operator brief persistence requires an admin header and stores audit proof only.",
        "Persistence does not permit public picks, staking, model training, learned-weight application, or public-action upgrades.",
        "Stored payload excludes API keys, provider secrets, payment data, raw provider blobs, and hidden chain-of-thought.",
        ...briefing.locks
      ],
      12
    ),
    proofUrls: unique(["/api/sports/decision/training/football-provider-live-opening-round-operator-brief", ...briefing.proofUrls], 14)
  };
}
