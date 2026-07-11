import type { FootballProviderLiveActivationReceipt } from "@/lib/sports/training/footballProviderLiveActivationReceipt";
import type { FootballProviderLiveBriefingPacket } from "@/lib/sports/training/footballProviderLiveBriefingPacket";
import { readDecisionOpenAIProviderError, type DecisionOpenAIProviderError } from "@/lib/sports/prediction/decisionOpenAIProviderError";
import { extractOutputText } from "@/lib/sports/prediction/openaiDecisionEnhancer";
import { getDecisionOpenAIModel } from "@/lib/sports/prediction/openaiModel";

type EnvLike = Record<string, string | undefined>;

export type FootballProviderLiveAIReviewStatus =
  | "not-requested"
  | "missing-key"
  | "waiting-activation"
  | "ready-to-run"
  | "reviewed"
  | "quota-or-billing-blocked"
  | "auth-failed"
  | "model-or-request-error"
  | "provider-error"
  | "invalid-response";

export type FootballProviderLiveAIReviewVerdict = "agree" | "downgrade" | "needs-evidence" | "block";
export type FootballProviderLiveAIReviewAction = "avoid" | "monitor";
export type FootballProviderLiveAIReviewProvider = "deterministic" | "openai";

export type FootballProviderLiveAIReviewResult = {
  reviewVerdict: FootballProviderLiveAIReviewVerdict;
  recommendedAction: FootballProviderLiveAIReviewAction;
  summary: string;
  rationale: string[];
  riskFlags: string[];
  dataGaps: string[];
  saferAlternatives: string[];
  evidenceChecks: Array<{
    id: string;
    status: "support" | "watch" | "block";
    note: string;
  }>;
  unsupportedClaims: string[];
  publishPermission: "never";
  persistencePermission: "never";
  trainingPermission: "never";
  stakingPermission: "never";
  publicActionUpgradePermission: "never";
};

export type FootballProviderLiveAIReviewReceipt = {
  mode: "football-provider-live-ai-review-receipt";
  generatedAt: string;
  status: FootballProviderLiveAIReviewStatus;
  reviewHash: string;
  summary: string;
  model: string;
  runRequested: boolean;
  provider: FootballProviderLiveAIReviewProvider;
  latestRun: {
    requested: boolean;
    provider: FootballProviderLiveAIReviewProvider;
    status: FootballProviderLiveAIReviewStatus;
    model: string | null;
    reason: string | null;
    safeNoPersistence: true;
  };
  target: FootballProviderLiveActivationReceipt["target"];
  gates: Array<{
    id: string;
    label: string;
    status: "pass" | "watch" | "block";
    detail: string;
    nextAction: string;
  }>;
  evidencePacket: Array<{
    id: string;
    label: string;
    status: "support" | "watch" | "block";
    detail: string;
    proofUrl: string;
  }>;
  deterministicFallback: FootballProviderLiveAIReviewResult;
  review: FootballProviderLiveAIReviewResult | null;
  appliedReview: FootballProviderLiveAIReviewResult;
  controls: {
    canInspectReadOnly: true;
    canRequestOpenAI: boolean;
    requiresExplicitRunParam: true;
    canApplyAI: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
    canUpgradePublicAction: false;
    canPrintSecrets: false;
  };
  proofUrls: string[];
  locks: string[];
};

const verdicts: FootballProviderLiveAIReviewVerdict[] = ["agree", "downgrade", "needs-evidence", "block"];
const actions: FootballProviderLiveAIReviewAction[] = ["avoid", "monitor"];

const liveAIReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reviewVerdict: { type: "string", enum: verdicts },
    recommendedAction: { type: "string", enum: actions },
    summary: { type: "string" },
    rationale: { type: "array", items: { type: "string" } },
    riskFlags: { type: "array", items: { type: "string" } },
    dataGaps: { type: "array", items: { type: "string" } },
    saferAlternatives: { type: "array", items: { type: "string" } },
    evidenceChecks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["support", "watch", "block"] },
          note: { type: "string" }
        },
        required: ["id", "status", "note"]
      }
    },
    unsupportedClaims: { type: "array", items: { type: "string" } },
    publishPermission: { type: "string", enum: ["never"] },
    persistencePermission: { type: "string", enum: ["never"] },
    trainingPermission: { type: "string", enum: ["never"] },
    stakingPermission: { type: "string", enum: ["never"] },
    publicActionUpgradePermission: { type: "string", enum: ["never"] }
  },
  required: [
    "reviewVerdict",
    "recommendedAction",
    "summary",
    "rationale",
    "riskFlags",
    "dataGaps",
    "saferAlternatives",
    "evidenceChecks",
    "unsupportedClaims",
    "publishPermission",
    "persistencePermission",
    "trainingPermission",
    "stakingPermission",
    "publicActionUpgradePermission"
  ]
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

function compact(value: string | null | undefined, maxLength = 420): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No public detail available.";
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function hasOpenAIKey(env: EnvLike, apiKey?: string): boolean {
  return Boolean((apiKey ?? env.OPENAI_API_KEY)?.trim());
}

function keyShape(env: EnvLike, apiKey?: string): "looks-openai" | "present-suspicious" | "absent" {
  const value = (apiKey ?? env.OPENAI_API_KEY)?.trim() ?? "";
  if (!value) return "absent";
  return /^sk-(proj-)?[A-Za-z0-9_-]{20,}$/.test(value) ? "looks-openai" : "present-suspicious";
}

function isVerdict(value: unknown): value is FootballProviderLiveAIReviewVerdict {
  return typeof value === "string" && verdicts.includes(value as FootballProviderLiveAIReviewVerdict);
}

function isAction(value: unknown): value is FootballProviderLiveAIReviewAction {
  return typeof value === "string" && actions.includes(value as FootballProviderLiveAIReviewAction);
}

function stringList(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  return unique(
    value.map((item) => (typeof item === "string" ? compact(item, 260) : null)),
    limit
  );
}

function sameOrSaferAction(fallback: FootballProviderLiveAIReviewAction, proposed: FootballProviderLiveAIReviewAction): FootballProviderLiveAIReviewAction {
  if (fallback === "avoid") return "avoid";
  return proposed;
}

function evidencePacket({
  activation,
  briefing
}: {
  activation: FootballProviderLiveActivationReceipt;
  briefing: FootballProviderLiveBriefingPacket;
}): FootballProviderLiveAIReviewReceipt["evidencePacket"] {
  return [
    {
      id: "activation-status",
      label: "Provider live activation",
      status: activation.status === "provider-monitor-ready" ? "support" : "block",
      detail: activation.summary,
      proofUrl: "/api/sports/decision/training/football-provider-live-activation"
    },
    {
      id: "runtime-proof",
      label: "Runtime provider proof",
      status: activation.readiness.providerProofReady ? "support" : "block",
      detail: `${activation.runtime.source} via ${activation.runtime.providerLabel}; missing ${activation.readiness.missing.join(", ") || "none"}.`,
      proofUrl: "/api/sports/decision/training/football-provider-live-feature-materializer"
    },
    {
      id: "odds-edge",
      label: "Model versus market edge",
      status: activation.readiness.watchlistReady ? "support" : "watch",
      detail: activation.pipeline.watchlist.topSelection
        ? `${activation.pipeline.watchlist.topSelection} is the top monitor candidate from ${activation.pipeline.watchlist.monitorCandidates} monitor candidate(s).`
        : "No positive-EV monitor candidate is ready.",
      proofUrl: "/api/sports/decision/training/football-provider-live-watchlist"
    },
    {
      id: "storage-lock",
      label: "Storage and settlement lock",
      status: activation.readiness.storageReadbackReady ? "support" : activation.readiness.storagePreviewReady ? "watch" : "block",
      detail: `${activation.pipeline.storage.status}; inserted ${activation.pipeline.storage.inserted}; pending rows ${activation.pipeline.storage.pendingRows}; readback rows ${activation.pipeline.storage.readbackRows}; readback evidence ready ${activation.pipeline.storage.readbackEvidenceReady}.`,
      proofUrl: "/api/sports/decision/training/football-provider-live-feature-storage-receipt"
    },
    {
      id: "briefing-packet",
      label: "Evidence-cited briefing",
      status: activation.readiness.briefingReady ? "support" : "block",
      detail: briefing.summary,
      proofUrl: "/api/sports/decision/training/football-provider-live-briefing-packet"
    },
    {
      id: "controls",
      label: "Control locks",
      status: "block",
      detail: `Publish ${activation.controls.canPublishPicks}; stake ${activation.controls.canStake}; train ${activation.controls.canTrainModels}; public pick ${activation.target.publicPickAllowed}.`,
      proofUrl: "/api/sports/decision/training/football-provider-live-activation"
    }
  ];
}

function deterministicFallback({
  activation,
  briefing
}: {
  activation: FootballProviderLiveActivationReceipt;
  briefing: FootballProviderLiveBriefingPacket;
}): FootballProviderLiveAIReviewResult {
  const ready = activation.status === "provider-monitor-ready";
  return {
    reviewVerdict: ready ? "needs-evidence" : "block",
    recommendedAction: ready ? "monitor" : "avoid",
    summary: ready
      ? "Deterministic fallback allows monitor-only review, but public picks, staking, persistence, and training remain locked."
      : `Deterministic fallback blocks OpenAI review because activation is ${activation.status}.`,
    rationale: unique([activation.summary, ...briefing.publicBriefing.modelCase.slice(0, 3)], 5),
    riskFlags: unique([...briefing.publicBriefing.riskCase, ...activation.readiness.missing], 8),
    dataGaps: unique([...activation.readiness.missing, ...briefing.publicBriefing.nextEvidence], 8),
    saferAlternatives: briefing.publicBriefing.saferAlternatives.slice(0, 5),
    evidenceChecks: evidencePacket({ activation, briefing }).map((item) => ({
      id: item.id,
      status: item.status,
      note: item.detail
    })),
    unsupportedClaims: [],
    publishPermission: "never",
    persistencePermission: "never",
    trainingPermission: "never",
    stakingPermission: "never",
    publicActionUpgradePermission: "never"
  };
}

function gates({
  activation,
  briefing,
  env,
  apiKey,
  runRequested
}: {
  activation: FootballProviderLiveActivationReceipt;
  briefing: FootballProviderLiveBriefingPacket;
  env: EnvLike;
  apiKey?: string;
  runRequested: boolean;
}): FootballProviderLiveAIReviewReceipt["gates"] {
  const shape = keyShape(env, apiKey);
  return [
    {
      id: "openai-key",
      label: "OpenAI key",
      status: shape === "looks-openai" ? "pass" : "block",
      detail: shape === "looks-openai" ? "Server runtime has an OpenAI-like key shape without exposing it." : "OPENAI_API_KEY is not configured with a usable server-side shape.",
      nextAction: shape === "looks-openai" ? "Keep the key server-only." : "Create or load the OpenAI key into the server runtime."
    },
    {
      id: "provider-activation",
      label: "Provider activation",
      status: activation.status === "provider-monitor-ready" ? "pass" : "block",
      detail: activation.summary,
      nextAction: activation.nextAction.label
    },
    {
      id: "briefing-contract",
      label: "Briefing contract",
      status: briefing.status === "explanation-ready" ? "pass" : "block",
      detail: briefing.summary,
      nextAction: briefing.nextAction.label
    },
    {
      id: "explicit-run",
      label: "Explicit run",
      status: runRequested ? "pass" : "watch",
      detail: runRequested ? "Operator requested run=1 for a bounded OpenAI review." : "No OpenAI request was made; add run=1 only after activation is ready.",
      nextAction: runRequested ? "Inspect the review result." : "Use run=1 when the provider activation is monitor-ready."
    },
    {
      id: "side-effect-locks",
      label: "Side-effect locks",
      status: "pass",
      detail: "AI review cannot persist, publish, train, stake, upgrade public action, print secrets, or reveal hidden reasoning.",
      nextAction: "Keep OpenAI output advisory until separate storage, settlement, and publication gates clear."
    }
  ];
}

function statusFor({
  activation,
  env,
  apiKey,
  runRequested
}: {
  activation: FootballProviderLiveActivationReceipt;
  env: EnvLike;
  apiKey?: string;
  runRequested: boolean;
}): FootballProviderLiveAIReviewStatus {
  if (!hasOpenAIKey(env, apiKey)) return "missing-key";
  if (activation.status !== "provider-monitor-ready") return "waiting-activation";
  return runRequested ? "ready-to-run" : "not-requested";
}

function summaryFor(status: FootballProviderLiveAIReviewStatus, applied: FootballProviderLiveAIReviewResult): string {
  if (status === "reviewed") return `OpenAI reviewed the live activation and returned ${applied.reviewVerdict}; recommended action remains ${applied.recommendedAction}.`;
  if (status === "ready-to-run") return "Live activation AI review is ready for explicit run=1.";
  if (status === "missing-key") return "Live activation AI review is waiting for a server-side OpenAI key.";
  if (status === "waiting-activation") return "Live activation AI review is waiting for provider-backed activation evidence.";
  if (status === "quota-or-billing-blocked") return "OpenAI quota or billing blocked live activation review; deterministic fallback remains applied.";
  if (status === "auth-failed") return "OpenAI authentication failed; deterministic fallback remains applied.";
  if (status === "model-or-request-error") return "OpenAI rejected the selected model or request contract; deterministic fallback remains applied.";
  if (status === "invalid-response") return "OpenAI response did not match the live activation review schema; deterministic fallback remains applied.";
  if (status === "provider-error") return "OpenAI live activation review failed; deterministic fallback remains applied.";
  return "Live activation AI review was not requested; deterministic fallback remains applied.";
}

function baseReceipt({
  activation,
  briefing,
  env,
  apiKey,
  runRequested,
  model,
  now
}: {
  activation: FootballProviderLiveActivationReceipt;
  briefing: FootballProviderLiveBriefingPacket;
  env: EnvLike;
  apiKey?: string;
  runRequested: boolean;
  model: string;
  now: Date;
}): FootballProviderLiveAIReviewReceipt {
  const fallback = deterministicFallback({ activation, briefing });
  const status = statusFor({ activation, env, apiKey, runRequested });
  const evidence = evidencePacket({ activation, briefing });

  return {
    mode: "football-provider-live-ai-review-receipt",
    generatedAt: now.toISOString(),
    status,
    reviewHash: stableHash({
      status,
      activation: activation.activationHash,
      briefing: briefing.packetHash,
      fallback
    }),
    summary: summaryFor(status, fallback),
    model,
    runRequested,
    provider: "deterministic",
    latestRun: {
      requested: false,
      provider: "deterministic",
      status,
      model: null,
      reason: null,
      safeNoPersistence: true
    },
    target: activation.target,
    gates: gates({ activation, briefing, env, apiKey, runRequested }),
    evidencePacket: evidence,
    deterministicFallback: fallback,
    review: null,
    appliedReview: fallback,
    controls: {
      canInspectReadOnly: true,
      canRequestOpenAI: status === "ready-to-run" || (status === "not-requested" && activation.status === "provider-monitor-ready" && hasOpenAIKey(env, apiKey)),
      requiresExplicitRunParam: true,
      canApplyAI: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false,
      canPrintSecrets: false
    },
    proofUrls: unique([
      "/api/sports/decision/training/football-provider-live-ai-review",
      "/api/sports/decision/training/football-provider-live-activation",
      "/api/sports/decision/training/football-provider-live-briefing-packet",
      "/api/sports/decision/training/football-provider-live-watchlist",
      "/api/sports/decision/openai-key-diagnostic"
    ]),
    locks: [
      "Live activation AI review requires explicit run=1 before any OpenAI request.",
      "AI review cannot upgrade monitor into a public pick.",
      "AI review cannot persist, publish, train, stake, print secrets, or expose hidden chain-of-thought.",
      "Only supplied evidence IDs may be cited; unsupported claims are rejected by the parser."
    ]
  };
}

function parseEvidenceChecks(value: unknown, allowedEvidenceIds: Set<string>): FootballProviderLiveAIReviewResult["evidenceChecks"] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      if (typeof record.id !== "string" || !allowedEvidenceIds.has(record.id)) return [];
      if (record.status !== "support" && record.status !== "watch" && record.status !== "block") return [];
      if (typeof record.note !== "string") return [];
      const status = record.status as "support" | "watch" | "block";
      return [
        {
          id: record.id,
          status,
          note: compact(record.note, 260)
        }
      ];
    })
    .slice(0, 8);
}

export function safeParseFootballProviderLiveAIReview({
  text,
  fallback,
  allowedEvidenceIds
}: {
  text: string;
  fallback: FootballProviderLiveAIReviewResult;
  allowedEvidenceIds: Set<string>;
}): FootballProviderLiveAIReviewResult | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!isVerdict(parsed.reviewVerdict)) return null;
    if (!isAction(parsed.recommendedAction)) return null;
    if (typeof parsed.summary !== "string") return null;
    if (
      parsed.publishPermission !== "never" ||
      parsed.persistencePermission !== "never" ||
      parsed.trainingPermission !== "never" ||
      parsed.stakingPermission !== "never" ||
      parsed.publicActionUpgradePermission !== "never"
    ) {
      return null;
    }
    const recommendedAction = sameOrSaferAction(fallback.recommendedAction, parsed.recommendedAction);
    return {
      reviewVerdict: recommendedAction === parsed.recommendedAction ? parsed.reviewVerdict : "downgrade",
      recommendedAction,
      summary: compact(recommendedAction === parsed.recommendedAction ? parsed.summary : `${parsed.summary} Same-or-safer lock reduced action to ${recommendedAction}.`),
      rationale: stringList(parsed.rationale),
      riskFlags: stringList(parsed.riskFlags),
      dataGaps: stringList(parsed.dataGaps),
      saferAlternatives: stringList(parsed.saferAlternatives),
      evidenceChecks: parseEvidenceChecks(parsed.evidenceChecks, allowedEvidenceIds),
      unsupportedClaims: stringList(parsed.unsupportedClaims),
      publishPermission: "never",
      persistencePermission: "never",
      trainingPermission: "never",
      stakingPermission: "never",
      publicActionUpgradePermission: "never"
    };
  } catch {
    return null;
  }
}

export function buildOpenAIFootballProviderLiveReviewPayload({
  activation,
  briefing,
  evidence,
  fallback,
  model
}: {
  activation: FootballProviderLiveActivationReceipt;
  briefing: FootballProviderLiveBriefingPacket;
  evidence: FootballProviderLiveAIReviewReceipt["evidencePacket"];
  fallback: FootballProviderLiveAIReviewResult;
  model: string;
}) {
  return {
    model,
    store: false,
    reasoning: { effort: "medium", summary: "auto" },
    input: [
      {
        role: "system" as const,
        content:
          "You are OddsPadi's live provider activation reviewer. Critique the supplied evidence only. Return public reasoning notes in strict JSON. Do not invent injuries, lineups, weather, odds, scores, news, provider payloads, or settlement results. Do not publish picks, recommend staking, persist decisions, train models, reveal hidden chain-of-thought, or upgrade monitor into a public pick."
      },
      {
        role: "user" as const,
        content: JSON.stringify({
          task: "Review whether this live provider activation can be monitored safely.",
          activation: {
            status: activation.status,
            target: activation.target,
            runtime: activation.runtime,
            pipeline: activation.pipeline,
            readiness: activation.readiness,
            controls: activation.controls,
            locks: activation.locks
          },
          briefing: {
            status: briefing.status,
            target: briefing.target,
            publicBriefing: briefing.publicBriefing,
            evidence: briefing.evidence
          },
          evidencePacket: evidence,
          deterministicFallback: fallback,
          safety: {
            sameOrSaferThanFallbackAction: true,
            allowedEvidenceIds: evidence.map((item) => item.id),
            allowedActions: actions,
            allowedVerdicts: verdicts,
            publishPermission: "never",
            persistencePermission: "never",
            trainingPermission: "never",
            stakingPermission: "never",
            publicActionUpgradePermission: "never"
          }
        })
      }
    ],
    text: {
      format: {
        type: "json_schema" as const,
        name: "OddsPadiFootballProviderLiveAIReview",
        strict: true,
        schema: liveAIReviewSchema
      }
    },
    max_output_tokens: 1800
  };
}

function classifyProviderError(error: DecisionOpenAIProviderError): { status: FootballProviderLiveAIReviewStatus; reason: string } {
  if (error.kind === "auth") return { status: "auth-failed", reason: error.reason };
  if (error.kind === "quota" || error.kind === "rate-limit") return { status: "quota-or-billing-blocked", reason: error.reason };
  if (error.kind === "model-or-request") return { status: "model-or-request-error", reason: error.reason };
  return { status: "provider-error", reason: error.reason };
}

function withResult({
  base,
  status,
  provider,
  result,
  reason,
  model
}: {
  base: FootballProviderLiveAIReviewReceipt;
  status: FootballProviderLiveAIReviewStatus;
  provider: FootballProviderLiveAIReviewProvider;
  result: FootballProviderLiveAIReviewResult;
  reason: string | null;
  model: string | null;
}): FootballProviderLiveAIReviewReceipt {
  return {
    ...base,
    status,
    summary: summaryFor(status, result),
    provider,
    review: provider === "openai" && status === "reviewed" ? result : null,
    appliedReview: result,
    latestRun: {
      requested: true,
      provider,
      status,
      model,
      reason,
      safeNoPersistence: true
    },
    reviewHash: stableHash({
      previous: base.reviewHash,
      status,
      provider,
      result
    })
  };
}

export async function runFootballProviderLiveAIReviewReceipt({
  activation,
  briefing,
  runRequested = false,
  env = process.env,
  apiKey = env.OPENAI_API_KEY,
  model = getDecisionOpenAIModel(env),
  fetchImpl = fetch,
  now = new Date()
}: {
  activation: FootballProviderLiveActivationReceipt;
  briefing: FootballProviderLiveBriefingPacket;
  runRequested?: boolean;
  env?: EnvLike;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<FootballProviderLiveAIReviewReceipt> {
  const base = baseReceipt({ activation, briefing, env, apiKey, runRequested, model, now });
  if (!runRequested) return base;
  if (!apiKey?.trim() || base.status !== "ready-to-run") {
    return withResult({
      base,
      status: base.status,
      provider: "deterministic",
      result: base.deterministicFallback,
      reason: !apiKey?.trim() ? "OPENAI_API_KEY is not configured." : "Live provider activation is not ready for OpenAI review.",
      model: null
    });
  }

  const payload = buildOpenAIFootballProviderLiveReviewPayload({
    activation,
    briefing,
    evidence: base.evidencePacket,
    fallback: base.deterministicFallback,
    model
  });

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const providerError = await readDecisionOpenAIProviderError(response);
      const classified = classifyProviderError(providerError);
      return withResult({
        base,
        status: classified.status,
        provider: "openai",
        result: base.deterministicFallback,
        reason: classified.reason,
        model
      });
    }

    const outputText = extractOutputText((await response.json()) as unknown);
    if (!outputText) {
      return withResult({
        base,
        status: "invalid-response",
        provider: "openai",
        result: base.deterministicFallback,
        reason: "OpenAI response did not include output text.",
        model
      });
    }

    const parsed = safeParseFootballProviderLiveAIReview({
      text: outputText,
      fallback: base.deterministicFallback,
      allowedEvidenceIds: new Set(base.evidencePacket.map((item) => item.id))
    });
    if (!parsed) {
      return withResult({
        base,
        status: "invalid-response",
        provider: "openai",
        result: base.deterministicFallback,
        reason: "OpenAI response did not match the live activation review schema.",
        model
      });
    }

    return withResult({
      base,
      status: "reviewed",
      provider: "openai",
      result: parsed,
      reason: null,
      model
    });
  } catch {
    return withResult({
      base,
      status: "provider-error",
      provider: "openai",
      result: base.deterministicFallback,
      reason: "OpenAI live activation review failed before a valid response was received.",
      model
    });
  }
}
