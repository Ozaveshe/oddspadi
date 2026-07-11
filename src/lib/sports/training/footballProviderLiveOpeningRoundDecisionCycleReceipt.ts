import { EPL_2026_FIXTURE_SOURCE_URL, EPL_2026_OPENING_WINDOW } from "@/lib/sports/prediction/decisionEpl2026Fixtures";
import { buildFootballProviderLiveActivationReceipt, type FootballProviderLiveActivationReceipt } from "@/lib/sports/training/footballProviderLiveActivationReceipt";
import { runFootballProviderLiveAIReviewReceipt, type FootballProviderLiveAIReviewReceipt } from "@/lib/sports/training/footballProviderLiveAIReviewReceipt";
import { buildFootballProviderLiveBriefingPacket, type FootballProviderLiveBriefingPacket } from "@/lib/sports/training/footballProviderLiveBriefingPacket";
import { buildFootballProviderLiveDecisionCycleReceipt, type FootballProviderLiveDecisionCycleReceipt } from "@/lib/sports/training/footballProviderLiveDecisionCycleReceipt";
import { buildFootballProviderLiveFeatureMaterializer } from "@/lib/sports/training/footballProviderLiveFeatureMaterializer";
import { observeFootballProviderLiveFeatureStorageReceipt, type FootballProviderLiveFeatureStorageReceipt } from "@/lib/sports/training/footballProviderLiveFeatureStorageReceipt";
import { epl2026OpeningRoundDates } from "@/lib/sports/training/footballProviderLiveOpeningRoundStorageReceipt";
import { getFootballProviderLiveRuntimeSnapshot, type FootballProviderLiveRuntimeSnapshot } from "@/lib/sports/training/footballProviderLiveRuntime";
import { buildFootballProviderLiveWatchlistReceipt, type FootballProviderLiveWatchlistCandidate, type FootballProviderLiveWatchlistReceipt } from "@/lib/sports/training/footballProviderLiveWatchlistReceipt";

type EnvLike = Record<string, string | undefined>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type FootballProviderLiveOpeningRoundDecisionCycleStatus =
  | "opening-round-monitor-ready"
  | "opening-round-ai-reviewed-monitor"
  | "partial-monitor-ready"
  | "waiting-storage-readback"
  | "waiting-provider-data"
  | "safe-hold";

type OpeningRoundDayCycle = {
  date: string;
  runtime: FootballProviderLiveRuntimeSnapshot;
  storage: FootballProviderLiveFeatureStorageReceipt;
  watchlist: FootballProviderLiveWatchlistReceipt;
  briefing: FootballProviderLiveBriefingPacket;
  activation: FootballProviderLiveActivationReceipt;
};

type OpeningRoundCandidate = FootballProviderLiveWatchlistCandidate & {
  date: string;
  activationStatus: FootballProviderLiveActivationReceipt["status"];
  storageReadbackReady: boolean;
};

export type FootballProviderLiveOpeningRoundDecisionCycleReceipt = {
  mode: "football-provider-live-opening-round-decision-cycle";
  generatedAt: string;
  status: FootballProviderLiveOpeningRoundDecisionCycleStatus;
  cycleHash: string;
  summary: string;
  request: {
    runAi: boolean;
    dateWindow: string[];
    filters: {
      league: string | null;
      country: string | null;
      query: string | null;
    };
  };
  target: {
    expectedFixtures: number;
    fixtureSourceUrl: typeof EPL_2026_FIXTURE_SOURCE_URL;
    selectedDate: string | null;
    selectedFixtureExternalId: string | null;
    selectedMatch: string | null;
    selectedSelection: string | null;
    selectedAction: "monitor" | "avoid";
    publicPickAllowed: false;
  };
  totals: {
    datesRequested: number;
    fixturesFetched: number;
    rowsPreviewed: number;
    providerBackedRows: number;
    storageReadbackRows: number;
    storageReadbackReadyDates: number;
    monitorReadyDates: number;
    selectionsRanked: number;
    monitorCandidates: number;
    positiveEdges: number;
    reviewedCandidates: number;
  };
  days: Array<{
    date: string;
    activationStatus: FootballProviderLiveActivationReceipt["status"];
    runtimeSource: FootballProviderLiveRuntimeSnapshot["source"];
    provider: string;
    fixturesFetched: number;
    rowsPreviewed: number;
    providerBackedRows: number;
    readbackRows: number;
    readbackEvidenceReady: boolean;
    monitorCandidates: number;
    topSelection: string | null;
    topExpectedValue: number | null;
    missing: string[];
  }>;
  candidates: OpeningRoundCandidate[];
  selectedCycle: FootballProviderLiveDecisionCycleReceipt | null;
  aiReview: FootballProviderLiveAIReviewReceipt | null;
  thinkingTrace: Array<{
    id: string;
    label: string;
    status: "pass" | "watch" | "block";
    note: string;
    proofUrl: string;
  }>;
  nextActions: Array<{
    label: string;
    verifyUrl: string;
    expectedEvidence: string;
  }>;
  controls: {
    canInspectReadOnly: true;
    canUseForMonitor: boolean;
    canRequestAIReview: boolean;
    requiresExplicitRunAi: true;
    canWriteLiveFeatureSnapshots: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
  };
  locks: string[];
  proofUrls: string[];
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

function unique(values: Array<string | null | undefined>, limit = 16): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function expectedFixtureCount(dates: string[]): number {
  return EPL_2026_OPENING_WINDOW.filter((fixture) => dates.includes(fixture.date)).length || dates.length;
}

function candidateSort(a: OpeningRoundCandidate, b: OpeningRoundCandidate): number {
  if (b.action !== a.action) return b.action === "monitor" ? 1 : -1;
  if (b.expectedValue !== a.expectedValue) return b.expectedValue - a.expectedValue;
  if (b.edge !== a.edge) return b.edge - a.edge;
  return b.modelProbability - a.modelProbability;
}

function statusFor({
  runAi,
  selectedCycle,
  aiReview,
  monitorReadyDates,
  storageReadbackRows,
  rowsPreviewed,
  providerBackedRows
}: {
  runAi: boolean;
  selectedCycle: FootballProviderLiveDecisionCycleReceipt | null;
  aiReview: FootballProviderLiveAIReviewReceipt | null;
  monitorReadyDates: number;
  storageReadbackRows: number;
  rowsPreviewed: number;
  providerBackedRows: number;
}): FootballProviderLiveOpeningRoundDecisionCycleStatus {
  if (rowsPreviewed === 0 || providerBackedRows === 0) return "waiting-provider-data";
  if (storageReadbackRows < rowsPreviewed) return "waiting-storage-readback";
  if (!selectedCycle) return monitorReadyDates > 0 ? "partial-monitor-ready" : "safe-hold";
  if (runAi && aiReview?.status === "reviewed") return "opening-round-ai-reviewed-monitor";
  if (selectedCycle.status === "ready-for-ai-review" || selectedCycle.status === "ai-reviewed-monitor") {
    return monitorReadyDates >= 1 ? "opening-round-monitor-ready" : "partial-monitor-ready";
  }
  return monitorReadyDates > 0 ? "partial-monitor-ready" : "safe-hold";
}

function summaryFor(status: FootballProviderLiveOpeningRoundDecisionCycleStatus, totals: FootballProviderLiveOpeningRoundDecisionCycleReceipt["totals"]): string {
  if (status === "opening-round-ai-reviewed-monitor") {
    return `Opening-round cycle ranked ${totals.monitorCandidates} monitor candidate(s), selected one for bounded AI critique, and kept publish/train/stake locked.`;
  }
  if (status === "opening-round-monitor-ready") {
    return `Opening-round cycle ranked ${totals.monitorCandidates} monitor candidate(s) from ${totals.storageReadbackRows} stored row(s); AI review is optional and explicit.`;
  }
  if (status === "partial-monitor-ready") return "Opening-round cycle has some monitor-ready evidence, but at least one slate gate still needs attention.";
  if (status === "waiting-storage-readback") return "Opening-round cycle has provider rows, but not every row is read back from storage as monitor evidence.";
  if (status === "waiting-provider-data") return "Opening-round cycle is waiting for provider-backed EPL fixture and odds rows.";
  return "Opening-round cycle is safely holding because no selected monitor candidate is currently actionable.";
}

function traceFor({
  status,
  totals,
  selected,
  aiReview
}: {
  status: FootballProviderLiveOpeningRoundDecisionCycleStatus;
  totals: FootballProviderLiveOpeningRoundDecisionCycleReceipt["totals"];
  selected: OpeningRoundCandidate | null;
  aiReview: FootballProviderLiveAIReviewReceipt | null;
}): FootballProviderLiveOpeningRoundDecisionCycleReceipt["thinkingTrace"] {
  return [
    {
      id: "collect-opening-round",
      label: "Collect opening-round provider evidence",
      status: totals.providerBackedRows > 0 ? "pass" : "block",
      note: `${totals.providerBackedRows}/${totals.rowsPreviewed} row(s) are provider-backed.`,
      proofUrl: "/api/sports/decision/training/football-provider-live-opening-round-storage"
    },
    {
      id: "read-storage",
      label: "Read stored monitor evidence",
      status: totals.rowsPreviewed > 0 && totals.storageReadbackRows >= totals.rowsPreviewed ? "pass" : totals.storageReadbackRows > 0 ? "watch" : "block",
      note: `${totals.storageReadbackRows}/${totals.rowsPreviewed} row(s) have storage readback.`,
      proofUrl: "/api/sports/decision/training/football-provider-live-opening-round-storage?dryRun=1"
    },
    {
      id: "rank-slate",
      label: "Rank model versus market value",
      status: totals.monitorCandidates > 0 ? "pass" : totals.selectionsRanked > 0 ? "watch" : "block",
      note: `${totals.monitorCandidates} monitor candidate(s), ${totals.positiveEdges} positive edge selection(s).`,
      proofUrl: "/api/sports/decision/training/football-provider-live-opening-round-decision-cycle"
    },
    {
      id: "select-candidate",
      label: "Select strongest monitor candidate",
      status: selected ? "pass" : "block",
      note: selected ? `${selected.matchLabel}: ${selected.selectionLabel}, EV ${selected.expectedValue}.` : "No monitor candidate selected.",
      proofUrl: "/api/sports/decision/training/football-provider-live-decision-cycle"
    },
    {
      id: "bounded-ai-critique",
      label: "Bounded AI critique",
      status: aiReview?.status === "reviewed" ? "pass" : aiReview?.controls.canRequestOpenAI ? "watch" : "block",
      note: aiReview ? aiReview.summary : "AI review not prepared because no selected cycle exists.",
      proofUrl: "/api/sports/decision/training/football-provider-live-ai-review"
    },
    {
      id: "hold-side-effects",
      label: "Hold side effects",
      status: status === "waiting-provider-data" ? "watch" : "pass",
      note: "Publishing, staking, training, learned weights, and public-action upgrades remain locked.",
      proofUrl: "/api/sports/decision/training/football-provider-live-opening-round-decision-cycle"
    }
  ];
}

async function buildDayCycle({
  date,
  filters,
  env,
  origin,
  now,
  fetchImpl,
  storageReceiptDecorator
}: {
  date: string;
  filters: {
    league?: string | null;
    country?: string | null;
    query?: string | null;
  };
  env: EnvLike;
  origin: string;
  now: Date;
  fetchImpl?: FetchLike;
  storageReceiptDecorator?: (receipt: FootballProviderLiveFeatureStorageReceipt) => FootballProviderLiveFeatureStorageReceipt;
}): Promise<OpeningRoundDayCycle> {
  const runtime = await getFootballProviderLiveRuntimeSnapshot({
    targetDate: date,
    league: filters.league,
    country: filters.country,
    query: filters.query,
    env,
    fetchImpl
  });
  const materializer = buildFootballProviderLiveFeatureMaterializer({
    provider: runtime.providerLabel,
    matches: runtime.matches,
    targetDate: runtime.targetDate,
    now
  });
  const rawStorage = await observeFootballProviderLiveFeatureStorageReceipt({
    materializer,
    runRequested: false,
    adminAuthorized: false,
    filters,
    env,
    origin,
    now
  });
  const storage = storageReceiptDecorator ? storageReceiptDecorator(rawStorage) : rawStorage;
  const watchlist = buildFootballProviderLiveWatchlistReceipt({ materializer, now });
  const briefing = buildFootballProviderLiveBriefingPacket({ watchlist, now });
  const activation = buildFootballProviderLiveActivationReceipt({
    runtime,
    materializer,
    storage,
    watchlist,
    briefing,
    now
  });
  return { date, runtime, storage, watchlist, briefing, activation };
}

export async function buildFootballProviderLiveOpeningRoundDecisionCycleReceipt({
  dates = epl2026OpeningRoundDates(),
  runAi = false,
  filters = { league: "Premier League", country: "England", query: null },
  env = process.env,
  origin,
  now = new Date(),
  fetchImpl,
  openAiFetchImpl,
  storageReceiptDecorator
}: {
  dates?: string[];
  runAi?: boolean;
  filters?: {
    league?: string | null;
    country?: string | null;
    query?: string | null;
  };
  env?: EnvLike;
  origin: string;
  now?: Date;
  fetchImpl?: FetchLike;
  openAiFetchImpl?: typeof fetch;
  storageReceiptDecorator?: (receipt: FootballProviderLiveFeatureStorageReceipt) => FootballProviderLiveFeatureStorageReceipt;
}): Promise<FootballProviderLiveOpeningRoundDecisionCycleReceipt> {
  const dateWindow = Array.from(new Set(dates)).sort();
  const dayCycles = await Promise.all(
    dateWindow.map((date) =>
      buildDayCycle({
        date,
        filters,
        env,
        origin,
        now,
        fetchImpl,
        storageReceiptDecorator
      })
    )
  );
  const candidates = dayCycles
    .flatMap((day) =>
      day.watchlist.candidates.map((candidate) => ({
        ...candidate,
        date: day.date,
        activationStatus: day.activation.status,
        storageReadbackReady: day.storage.readback.evidenceReady
      }))
    )
    .filter((candidate) => candidate.action === "monitor")
    .sort(candidateSort)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
  const selected = candidates[0] ?? null;
  const selectedDay = selected
    ? dayCycles.find((day) => day.date === selected.date && day.activation.target.fixtureExternalId === selected.fixtureExternalId) ??
      dayCycles.find((day) => day.date === selected.date) ??
      null
    : null;
  const aiReview = selectedDay
    ? await runFootballProviderLiveAIReviewReceipt({
        activation: selectedDay.activation,
        briefing: selectedDay.briefing,
        runRequested: runAi,
        env,
        fetchImpl: openAiFetchImpl ?? fetch,
        now
      })
    : null;
  const selectedCycle =
    selectedDay && aiReview
      ? buildFootballProviderLiveDecisionCycleReceipt({
          activation: selectedDay.activation,
          briefing: selectedDay.briefing,
          aiReview,
          now
        })
      : null;
  const totals = {
    datesRequested: dateWindow.length,
    fixturesFetched: dayCycles.reduce((sum, day) => sum + day.runtime.matches.length, 0),
    rowsPreviewed: dayCycles.reduce((sum, day) => sum + day.storage.materializer.rowsPreviewed, 0),
    providerBackedRows: dayCycles.reduce((sum, day) => sum + day.storage.materializer.providerBackedRows, 0),
    storageReadbackRows: dayCycles.reduce((sum, day) => sum + day.storage.readback.matchedRows, 0),
    storageReadbackReadyDates: dayCycles.filter((day) => day.storage.readback.evidenceReady).length,
    monitorReadyDates: dayCycles.filter((day) => day.activation.status === "provider-monitor-ready").length,
    selectionsRanked: dayCycles.reduce((sum, day) => sum + day.watchlist.totals.selectionsRanked, 0),
    monitorCandidates: candidates.length,
    positiveEdges: dayCycles.reduce((sum, day) => sum + day.watchlist.totals.positiveEdges, 0),
    reviewedCandidates: aiReview?.status === "reviewed" ? 1 : 0
  };
  const status = statusFor({
    runAi,
    selectedCycle,
    aiReview,
    monitorReadyDates: totals.monitorReadyDates,
    storageReadbackRows: totals.storageReadbackRows,
    rowsPreviewed: totals.rowsPreviewed,
    providerBackedRows: totals.providerBackedRows
  });
  const target = {
    expectedFixtures: expectedFixtureCount(dateWindow),
    fixtureSourceUrl: EPL_2026_FIXTURE_SOURCE_URL,
    selectedDate: selected?.date ?? null,
    selectedFixtureExternalId: selected?.fixtureExternalId ?? null,
    selectedMatch: selected?.matchLabel ?? null,
    selectedSelection: selected?.selectionLabel ?? null,
    selectedAction: selected?.action ?? ("avoid" as const),
    publicPickAllowed: false as const
  } satisfies FootballProviderLiveOpeningRoundDecisionCycleReceipt["target"];
  const thinkingTrace = traceFor({ status, totals, selected, aiReview });

  return {
    mode: "football-provider-live-opening-round-decision-cycle",
    generatedAt: now.toISOString(),
    status,
    cycleHash: stableHash({
      status,
      dateWindow,
      totals,
      selected: selected ? [selected.date, selected.fixtureExternalId, selected.selectionLabel, selected.expectedValue] : null,
      aiReview: aiReview ? [aiReview.status, aiReview.reviewHash] : null
    }),
    summary: summaryFor(status, totals),
    request: {
      runAi,
      dateWindow,
      filters: {
        league: filters.league ?? null,
        country: filters.country ?? null,
        query: filters.query ?? null
      }
    },
    target,
    totals,
    days: dayCycles.map((day) => ({
      date: day.date,
      activationStatus: day.activation.status,
      runtimeSource: day.runtime.source,
      provider: day.runtime.providerLabel,
      fixturesFetched: day.runtime.matches.length,
      rowsPreviewed: day.storage.materializer.rowsPreviewed,
      providerBackedRows: day.storage.materializer.providerBackedRows,
      readbackRows: day.storage.readback.matchedRows,
      readbackEvidenceReady: day.storage.readback.evidenceReady,
      monitorCandidates: day.watchlist.totals.monitorCandidates,
      topSelection: day.watchlist.topCandidate?.selectionLabel ?? null,
      topExpectedValue: day.watchlist.topCandidate?.expectedValue ?? null,
      missing: day.activation.readiness.missing
    })),
    candidates: candidates.slice(0, 12),
    selectedCycle,
    aiReview,
    thinkingTrace,
    nextActions: [
      selectedCycle?.nextActions[0] ?? {
        label: totals.storageReadbackRows < totals.rowsPreviewed ? "Store opening-round monitor evidence" : "Refresh opening-round provider slate",
        verifyUrl: "/api/sports/decision/training/football-provider-live-opening-round-storage?dryRun=1",
        expectedEvidence: "Opening-round rows are provider-backed and read back from Supabase before slate ranking."
      },
      {
        label: runAi ? "Inspect bounded AI critique" : "Run bounded AI critique for selected candidate",
        verifyUrl: "/api/sports/decision/training/football-provider-live-opening-round-decision-cycle?runAi=1",
        expectedEvidence: "Only the selected opening-round monitor candidate is sent to OpenAI, with strict no-publish, no-stake, no-train controls."
      }
    ],
    controls: {
      canInspectReadOnly: true,
      canUseForMonitor: status === "opening-round-monitor-ready" || status === "opening-round-ai-reviewed-monitor" || status === "partial-monitor-ready",
      canRequestAIReview: Boolean(selectedCycle?.controls.canRequestAIReview),
      requiresExplicitRunAi: true,
      canWriteLiveFeatureSnapshots: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    locks: unique([
      "Opening-round cycle is monitor-only; no public picks, staking, training, learned weights, or public-action upgrades.",
      "AI review requires explicit runAi=1 and only reviews the selected candidate.",
      "Stored live rows cannot train until fixtures settle and labels exist.",
      "The cycle must show provider-backed rows, odds, storage readback, watchlist edge math, briefing risks, and AI critique status separately.",
      ...(selectedCycle?.locks ?? []),
      ...(aiReview?.locks ?? [])
    ]),
    proofUrls: unique([
      "/api/sports/decision/training/football-provider-live-opening-round-decision-cycle",
      "/api/sports/decision/training/football-provider-live-opening-round-storage",
      "/api/sports/decision/training/football-provider-live-decision-cycle",
      "/api/sports/decision/training/football-provider-live-ai-review",
      "/api/sports/decision/training/football-provider-live-watchlist",
      "/api/sports/decision/training/football-provider-live-briefing-packet",
      ...(selectedCycle?.proofUrls ?? []),
      ...(aiReview?.proofUrls ?? [])
    ])
  };
}
