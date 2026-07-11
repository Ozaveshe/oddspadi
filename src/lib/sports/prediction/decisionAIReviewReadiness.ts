import { hasConfiguredEnv } from "@/lib/env";
import type { Sport } from "@/lib/sports/types";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import { getDecisionOpenAIModel } from "@/lib/sports/prediction/openaiModel";

export type DecisionAIReviewReadinessStatus = "ready-to-run" | "needs-key" | "blocked";
export type DecisionAIReviewLaneStatus = "ready-live-review" | "needs-key" | "blocked";
export type DecisionAIReviewLaneId = "operator-reasoning" | "context-dossier" | "decision-session" | "executive-review";

export type DecisionAIReviewReadinessLane = {
  id: DecisionAIReviewLaneId;
  label: string;
  route: string;
  runUrl: string;
  schemaName: string;
  requestStore: false;
  deterministicFallback: boolean;
  status: DecisionAIReviewLaneStatus;
  canRunLiveReview: boolean;
  blockers: string[];
  safety: {
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canUpgradePublicAction: false;
    canRaiseTrust: false;
  };
};

export type DecisionAIReviewReadiness = {
  mode: "ai-review-readiness";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionAIReviewReadinessStatus;
  summary: string;
  model: string;
  openAiConfigured: boolean;
  missingEnv: string[];
  readinessHash: string;
  totals: {
    lanes: number;
    readyLiveReview: number;
    needsKey: number;
    blocked: number;
    deterministicFallbacks: number;
  };
  lanes: DecisionAIReviewReadinessLane[];
  controls: {
    canInspectContracts: true;
    canRunLiveReview: boolean;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canUpgradePublicAction: false;
    requiresRunParam: true;
  };
  nextSafeCommand: {
    label: string;
    method: "GET";
    url: string;
    command: string;
    expectedEvidence: string;
    safeToRun: boolean;
  };
  proofUrls: string[];
  locks: string[];
};

type EnvLike = Record<string, string | undefined>;

const REVIEW_LANES: Array<Omit<DecisionAIReviewReadinessLane, "runUrl" | "status" | "canRunLiveReview" | "blockers">> = [
  {
    id: "operator-reasoning",
    label: "Operator reasoning gateway",
    route: "/api/sports/decision/ai-reasoning-gateway",
    schemaName: "OddsPadiOperatorAIReasoningReview",
    requestStore: false,
    deterministicFallback: true,
    safety: {
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false,
      canRaiseTrust: false
    }
  },
  {
    id: "context-dossier",
    label: "AI context dossier",
    route: "/api/sports/decision/ai-context-dossier",
    schemaName: "OddsPadiAIContextDossierReview",
    requestStore: false,
    deterministicFallback: true,
    safety: {
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false,
      canRaiseTrust: false
    }
  },
  {
    id: "decision-session",
    label: "AI decision session",
    route: "/api/sports/decision/ai-decision-session",
    schemaName: "OddsPadiAISessionReview",
    requestStore: false,
    deterministicFallback: true,
    safety: {
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false,
      canRaiseTrust: false
    }
  },
  {
    id: "executive-review",
    label: "AI executive review",
    route: "/api/sports/decision/ai-executive",
    schemaName: "OddsPadiAIExecutiveReview",
    requestStore: false,
    deterministicFallback: true,
    safety: {
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false,
      canRaiseTrust: false
    }
  }
];

function boolEnv(env: EnvLike, key: string): boolean {
  return hasConfiguredEnv(env, key);
}

function fnv1aHash(input: unknown): string {
  const text = JSON.stringify(input);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function appendParams(route: string, date: string, sport: Sport): string {
  const extra = route === "/api/sports/decision/ai-executive" ? "&observe=1" : "";
  return `${route}?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}&run=1${extra}`;
}

function statusFor(openAiConfigured: boolean, lanes: DecisionAIReviewReadinessLane[]): DecisionAIReviewReadinessStatus {
  if (lanes.some((lane) => lane.status === "blocked")) return "blocked";
  return openAiConfigured ? "ready-to-run" : "needs-key";
}

function summaryFor(status: DecisionAIReviewReadinessStatus, model: string): string {
  if (status === "ready-to-run") {
    return `OpenAI review contracts are inspectable and ${model} can be requested only through run=1 guarded routes.`;
  }
  if (status === "blocked") {
    return "AI review readiness found a blocked lane; keep deterministic fallbacks active until the contract is repaired.";
  }
  return "AI review contracts are wired, but live review is locked because OPENAI_API_KEY is not configured.";
}

export function buildDecisionAIReviewReadiness({
  date,
  sport,
  env = process.env,
  baseUrl = decisionSiteOrigin(),
  now = new Date()
}: {
  date: string;
  sport: Sport;
  env?: EnvLike;
  baseUrl?: string;
  now?: Date;
}): DecisionAIReviewReadiness {
  const openAiConfigured = boolEnv(env, "OPENAI_API_KEY");
  const model = getDecisionOpenAIModel(env);
  const missingEnv = openAiConfigured ? [] : ["OPENAI_API_KEY"];
  const lanes: DecisionAIReviewReadinessLane[] = REVIEW_LANES.map((lane) => {
    const blockers = [
      ...missingEnv,
      lane.requestStore === false ? null : "request preview must keep store=false",
      lane.deterministicFallback ? null : "deterministic fallback missing"
    ].filter(Boolean) as string[];
    const status: DecisionAIReviewLaneStatus = blockers.length ? "needs-key" : "ready-live-review";
    const runPath = appendParams(lane.route, date, sport);

    return {
      ...lane,
      runUrl: `${baseUrl}${runPath}`,
      status,
      canRunLiveReview: status === "ready-live-review",
      blockers
    };
  });
  const status = statusFor(openAiConfigured, lanes);
  const nextUrl = `/api/sports/decision/ai-review-readiness?date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`;
  const totals = {
    lanes: lanes.length,
    readyLiveReview: lanes.filter((lane) => lane.status === "ready-live-review").length,
    needsKey: lanes.filter((lane) => lane.status === "needs-key").length,
    blocked: lanes.filter((lane) => lane.status === "blocked").length,
    deterministicFallbacks: lanes.filter((lane) => lane.deterministicFallback).length
  };

  return {
    mode: "ai-review-readiness",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    summary: summaryFor(status, model),
    model,
    openAiConfigured,
    missingEnv,
    readinessHash: fnv1aHash({
      date,
      sport,
      model,
      openAiConfigured,
      lanes: lanes.map((lane) => ({
        id: lane.id,
        schemaName: lane.schemaName,
        store: lane.requestStore,
        fallback: lane.deterministicFallback,
        status: lane.status
      }))
    }),
    totals,
    lanes,
    controls: {
      canInspectContracts: true,
      canRunLiveReview: openAiConfigured && lanes.every((lane) => lane.canRunLiveReview),
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false,
      requiresRunParam: true
    },
    nextSafeCommand: {
      label: openAiConfigured ? "Inspect guarded live-review route before running" : "Set OPENAI_API_KEY, then rerun readiness",
      method: "GET",
      url: nextUrl,
      command: `curl.exe "${baseUrl}${nextUrl}"`,
      expectedEvidence: "Readiness response shows all review lanes, schema names, store=false contracts, deterministic fallbacks, and locked publish/persist/train controls.",
      safeToRun: true
    },
    proofUrls: [
      "/api/sports/decision/ai-review-readiness",
      "/api/sports/decision/ai-cognitive-proof",
      "/api/sports/decision/evidence-graph",
      "/api/sports/decision/thinking-introspection",
      "/api/sports/decision/ai-reasoning-gateway",
      "/api/sports/decision/ai-context-dossier",
      "/api/sports/decision/ai-decision-session",
      "/api/sports/decision/ai-executive"
    ],
    locks: [
      "Live AI review requires OPENAI_API_KEY and an explicit run=1 request.",
      "Cognitive proof is public and replayable, but hidden chain-of-thought stays locked.",
      "Evidence graph can guide inspection, but it cannot publish, persist, train, or raise trust.",
      "Thinking introspection names public beliefs and doubts, but it cannot authorize live action.",
      "AI review output cannot publish, persist, train, raise trust, stake, or upgrade public action.",
      "Every lane must keep store=false and provide a deterministic fallback."
    ]
  };
}
