import type {
  DecisionBrainReviewFallback,
  DecisionBrainReviewFinding,
  DecisionBrainReviewFindingStatus,
  DecisionBrainReviewPacket,
  DecisionBrainReviewTrustPatch,
  DecisionBrainReviewVerdict
} from "@/lib/sports/prediction/decisionBrainReviewPacket";
import { extractOutputText } from "@/lib/sports/prediction/openaiDecisionEnhancer";
import { getDecisionOpenAIModel } from "@/lib/sports/prediction/openaiModel";
import type { DecisionAction, Sport } from "@/lib/sports/types";

export type DecisionBrainReviewRunStatus =
  | "not-requested"
  | "ready-to-run"
  | "reviewed"
  | "fallback"
  | "quota-or-billing-blocked"
  | "auth-failed"
  | "provider-error"
  | "invalid-response"
  | "not-configured"
  | "blocked";

export type DecisionBrainReviewProvider = "openai" | "deterministic";

export type DecisionBrainReviewRunnerStatus =
  | "ready-to-run"
  | "reviewed"
  | "fallback"
  | "quota-or-billing-blocked"
  | "auth-failed"
  | "provider-error"
  | "invalid-response"
  | "not-configured"
  | "blocked";

export type DecisionBrainReviewRunner = {
  generatedAt: string;
  date: string;
  sport: Sport;
  mode: "decision-brain-review-runner";
  status: DecisionBrainReviewRunnerStatus;
  runnerHash: string;
  summary: string;
  runRequested: boolean;
  openAiConfigured: boolean;
  model: string;
  packetHash: string;
  deterministicFallback: DecisionBrainReviewFallback;
  review: DecisionBrainReviewFallback | null;
  appliedReview: DecisionBrainReviewFallback;
  latestRun: {
    requested: boolean;
    provider: DecisionBrainReviewProvider;
    status: DecisionBrainReviewRunStatus;
    model: string | null;
    reviewHash: string | null;
    reason: string | null;
    safeNoPersistence: true;
  };
  requestPreview: ReturnType<typeof buildOpenAIBrainReviewPayload>;
  controls: {
    canRequestOpenAI: boolean;
    canApplyAI: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
};

const verdicts: DecisionBrainReviewVerdict[] = ["agree-shadow", "downgrade", "needs-evidence", "block"];
const actions: DecisionAction[] = ["consider", "monitor", "avoid"];
const trustPatches: DecisionBrainReviewTrustPatch[] = ["keep-ceiling", "lower-ceiling", "repair-first", "block"];
const findingStatuses: DecisionBrainReviewFindingStatus[] = ["supports", "challenges", "missing"];

const brainReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: verdicts },
    recommendedAction: { type: "string", enum: actions },
    trustPatch: { type: "string", enum: trustPatches },
    summary: { type: "string" },
    evidenceFindings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          evidenceId: { type: "string" },
          status: { type: "string", enum: findingStatuses },
          finding: { type: "string" }
        },
        required: ["evidenceId", "status", "finding"]
      }
    },
    requiredEvidence: { type: "array", items: { type: "string" } },
    riskFlags: { type: "array", items: { type: "string" } },
    unsupportedClaims: { type: "array", items: { type: "string" } },
    publishPermission: { type: "string", enum: ["never"] },
    persistencePermission: { type: "string", enum: ["never"] },
    trainingPermission: { type: "string", enum: ["never"] },
    publicActionUpgradePermission: { type: "string", enum: ["never"] }
  },
  required: [
    "verdict",
    "recommendedAction",
    "trustPatch",
    "summary",
    "evidenceFindings",
    "requiredEvidence",
    "riskFlags",
    "unsupportedClaims",
    "publishPermission",
    "persistencePermission",
    "trainingPermission",
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

function compact(value: string, maxLength = 320): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function isVerdict(value: unknown): value is DecisionBrainReviewVerdict {
  return typeof value === "string" && verdicts.includes(value as DecisionBrainReviewVerdict);
}

function isAction(value: unknown): value is DecisionAction {
  return typeof value === "string" && actions.includes(value as DecisionAction);
}

function isTrustPatch(value: unknown): value is DecisionBrainReviewTrustPatch {
  return typeof value === "string" && trustPatches.includes(value as DecisionBrainReviewTrustPatch);
}

function isFindingStatus(value: unknown): value is DecisionBrainReviewFindingStatus {
  return typeof value === "string" && findingStatuses.includes(value as DecisionBrainReviewFindingStatus);
}

function actionRank(action: DecisionAction): number {
  if (action === "consider") return 3;
  if (action === "monitor") return 2;
  return 1;
}

function sameOrSaferAction(fallback: DecisionAction, proposed: DecisionAction): DecisionAction {
  return actionRank(proposed) > actionRank(fallback) ? fallback : proposed;
}

function strings(value: unknown, limit = 10): string[] {
  if (!Array.isArray(value)) return [];
  return unique(
    value.map((item) => (typeof item === "string" ? compact(item, 260) : null)),
    limit
  );
}

function findings(value: unknown, allowedEvidenceIds: Set<string>): DecisionBrainReviewFinding[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): DecisionBrainReviewFinding | null => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      if (typeof record.evidenceId !== "string" || !allowedEvidenceIds.has(record.evidenceId)) return null;
      if (!isFindingStatus(record.status)) return null;
      if (typeof record.finding !== "string") return null;
      return {
        evidenceId: record.evidenceId,
        status: record.status,
        finding: compact(record.finding, 320)
      };
    })
    .filter((item): item is DecisionBrainReviewFinding => Boolean(item))
    .slice(0, 12);
}

export function safeParseBrainReview(text: string, fallback: DecisionBrainReviewFallback, allowedEvidenceIds: Set<string>): DecisionBrainReviewFallback | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!isVerdict(parsed.verdict)) return null;
    if (!isAction(parsed.recommendedAction)) return null;
    if (!isTrustPatch(parsed.trustPatch)) return null;
    if (typeof parsed.summary !== "string") return null;
    if (
      parsed.publishPermission !== "never" ||
      parsed.persistencePermission !== "never" ||
      parsed.trainingPermission !== "never" ||
      parsed.publicActionUpgradePermission !== "never"
    ) {
      return null;
    }

    const recommendedAction = sameOrSaferAction(fallback.recommendedAction, parsed.recommendedAction);
    const wasDowngraded = recommendedAction !== parsed.recommendedAction;

    return {
      verdict: parsed.verdict,
      recommendedAction,
      trustPatch: wasDowngraded && parsed.trustPatch === "keep-ceiling" ? "repair-first" : parsed.trustPatch,
      summary: compact(wasDowngraded ? `${parsed.summary} Same-or-safer lock reduced action to ${recommendedAction}.` : parsed.summary, 420),
      evidenceFindings: findings(parsed.evidenceFindings, allowedEvidenceIds),
      requiredEvidence: strings(parsed.requiredEvidence, 10),
      riskFlags: strings(parsed.riskFlags, 8),
      unsupportedClaims: strings(parsed.unsupportedClaims, 8),
      publishPermission: "never",
      persistencePermission: "never",
      trainingPermission: "never",
      publicActionUpgradePermission: "never"
    };
  } catch {
    return null;
  }
}

function buildOpenAIBrainReviewPayload({ packet, model }: { packet: DecisionBrainReviewPacket; model: string }) {
  return {
    model,
    store: false,
    reasoning: { effort: "medium", summary: "auto" },
    input: [
      {
        role: "system" as const,
        content: packet.reviewPrompt.system
      },
      {
        role: "user" as const,
        content: JSON.stringify({
          task: packet.reviewPrompt.task,
          payload: packet.reviewPrompt.payload,
          evidencePacket: packet.evidencePacket,
          expectedOutputContract: packet.expectedOutputContract,
          deterministicFallback: packet.deterministicFallback,
          safety: {
            sameOrSaferThanFallback: true,
            noPersistence: true,
            noPublish: true,
            noTraining: true,
            noStake: true,
            noPublicActionUpgrade: true,
            allowedEvidenceIds: packet.evidencePacket.map((item) => item.id)
          }
        })
      }
    ],
    text: {
      format: {
        type: "json_schema" as const,
        name: "OddsPadiBrainReview",
        strict: true,
        schema: brainReviewSchema
      }
    },
    max_output_tokens: 1900
  };
}

function statusFor(packet: DecisionBrainReviewPacket, openAiConfigured: boolean): DecisionBrainReviewRunnerStatus {
  if (packet.status === "blocked") return "blocked";
  if (!openAiConfigured) return "not-configured";
  if (packet.status === "waiting-openai-quota") return "quota-or-billing-blocked";
  return packet.controls.canSubmitToOpenAI ? "ready-to-run" : "fallback";
}

function summaryFor(status: DecisionBrainReviewRunnerStatus): string {
  if (status === "reviewed") return "OpenAI returned a structured brain review; same-or-safer controls kept all side effects locked.";
  if (status === "quota-or-billing-blocked") return "OpenAI quota or billing blocked the live brain review; deterministic fallback is still applied.";
  if (status === "auth-failed") return "OpenAI authentication failed; deterministic fallback is still applied.";
  if (status === "provider-error") return "OpenAI brain review failed; deterministic fallback is still applied.";
  if (status === "invalid-response") return "OpenAI response did not match the brain review schema; deterministic fallback is still applied.";
  if (status === "not-configured") return "Brain review runner is wired but waiting for OPENAI_API_KEY.";
  if (status === "blocked") return "Brain review runner is blocked because the review packet has blocking evidence debt.";
  if (status === "ready-to-run") return "Brain review runner can submit the packet to OpenAI with no persistence, publishing, training, staking, or trust upgrade.";
  return "Brain review runner is using deterministic fallback until the packet becomes safe to submit.";
}

function baseRunner({
  packet,
  env,
  model,
  runRequested,
  now
}: {
  packet: DecisionBrainReviewPacket;
  env: Record<string, string | undefined>;
  model: string;
  runRequested: boolean;
  now: Date;
}): DecisionBrainReviewRunner {
  const openAiConfigured = Boolean(env.OPENAI_API_KEY?.trim());
  const status = statusFor(packet, openAiConfigured);
  const requestPreview = buildOpenAIBrainReviewPayload({ packet, model });
  const runnerHash = stableHash({
    date: packet.date,
    sport: packet.sport,
    packet: packet.packetHash,
    status,
    model,
    fallback: [packet.deterministicFallback.verdict, packet.deterministicFallback.recommendedAction, packet.deterministicFallback.trustPatch]
  });

  return {
    generatedAt: now.toISOString(),
    date: packet.date,
    sport: packet.sport,
    mode: "decision-brain-review-runner",
    status,
    runnerHash,
    summary: summaryFor(status),
    runRequested,
    openAiConfigured,
    model,
    packetHash: packet.packetHash,
    deterministicFallback: packet.deterministicFallback,
    review: null,
    appliedReview: packet.deterministicFallback,
    requestPreview,
    latestRun: {
      requested: false,
      provider: "deterministic",
      status: runRequested ? status === "blocked" ? "blocked" : status === "not-configured" ? "not-configured" : "not-requested" : "not-requested",
      model: null,
      reviewHash: null,
      reason: null,
      safeNoPersistence: true
    },
    controls: {
      canRequestOpenAI: status === "ready-to-run",
      canApplyAI: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique(["/api/sports/decision/brain-review-runner", "/api/sports/decision/brain-review-packet", ...packet.proofUrls], 20),
    locks: unique(
      [
        "Brain review runner is advisory only and never applies AI output automatically.",
        "OpenAI output is clamped to same-or-safer than deterministic fallback.",
        "No persistence, publishing, training, staking, hidden chain-of-thought, or public trust upgrade is allowed.",
        ...packet.locks
      ],
      24
    )
  };
}

function withReview({
  runner,
  status,
  provider,
  runStatus,
  review,
  reason = null,
  model
}: {
  runner: DecisionBrainReviewRunner;
  status: DecisionBrainReviewRunnerStatus;
  provider: DecisionBrainReviewProvider;
  runStatus: DecisionBrainReviewRunStatus;
  review: DecisionBrainReviewFallback;
  reason?: string | null;
  model: string | null;
}): DecisionBrainReviewRunner {
  return {
    ...runner,
    status,
    summary: summaryFor(status),
    review: provider === "openai" && status === "reviewed" ? review : null,
    appliedReview: review,
    latestRun: {
      requested: true,
      provider,
      status: runStatus,
      model,
      reviewHash: stableHash(review),
      reason,
      safeNoPersistence: true
    },
    controls: {
      ...runner.controls,
      canApplyAI: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    }
  };
}

function classifyProviderError(status: number, detail: string): Pick<Parameters<typeof withReview>[0], "status" | "runStatus" | "reason"> {
  const lower = detail.toLowerCase();
  if (status === 401 || status === 403) {
    return {
      status: "auth-failed",
      runStatus: "auth-failed",
      reason: `OpenAI authentication failed with HTTP ${status}.`
    };
  }
  if (status === 429 || lower.includes("insufficient_quota") || lower.includes("billing") || lower.includes("quota")) {
    return {
      status: "quota-or-billing-blocked",
      runStatus: "quota-or-billing-blocked",
      reason: `OpenAI quota or billing blocked the brain review with HTTP ${status}.`
    };
  }
  return {
    status: "provider-error",
    runStatus: "provider-error",
    reason: `OpenAI Responses API returned HTTP ${status}.`
  };
}

export async function runDecisionBrainReview({
  packet,
  runRequested = false,
  apiKey = process.env.OPENAI_API_KEY,
  model = getDecisionOpenAIModel(),
  env = process.env,
  fetchImpl = fetch,
  now = new Date()
}: {
  packet: DecisionBrainReviewPacket;
  runRequested?: boolean;
  apiKey?: string;
  model?: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<DecisionBrainReviewRunner> {
  const runner = baseRunner({
    packet,
    env: {
      ...env,
      OPENAI_API_KEY: apiKey
    },
    model,
    runRequested,
    now
  });

  if (!runRequested) return runner;

  if (runner.status === "blocked" || runner.status === "not-configured" || runner.status === "quota-or-billing-blocked" || !packet.controls.canSubmitToOpenAI) {
    return withReview({
      runner,
      status: runner.status === "ready-to-run" ? "fallback" : runner.status,
      provider: "deterministic",
      runStatus: runner.status === "ready-to-run" ? "fallback" : runner.latestRun.status === "not-requested" ? "fallback" : runner.latestRun.status,
      review: packet.deterministicFallback,
      reason:
        runner.status === "not-configured"
          ? "OPENAI_API_KEY is not configured."
          : runner.status === "quota-or-billing-blocked"
            ? "OpenAI quota or billing must be fixed before live brain review can run."
            : runner.status === "blocked"
              ? "Brain review packet is blocked by evidence debt."
              : "Brain review packet is not safe to submit to OpenAI yet.",
      model: null
    });
  }

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(runner.requestPreview)
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const classified = classifyProviderError(response.status, detail);
      return withReview({
        runner,
        provider: "openai",
        review: packet.deterministicFallback,
        model,
        ...classified
      });
    }

    const outputText = extractOutputText((await response.json()) as unknown);
    if (!outputText) {
      return withReview({
        runner,
        status: "invalid-response",
        provider: "openai",
        runStatus: "invalid-response",
        review: packet.deterministicFallback,
        reason: "OpenAI response did not include output text.",
        model
      });
    }

    const parsed = safeParseBrainReview(outputText, packet.deterministicFallback, new Set(packet.evidencePacket.map((item) => item.id)));
    if (!parsed) {
      return withReview({
        runner,
        status: "invalid-response",
        provider: "openai",
        runStatus: "invalid-response",
        review: packet.deterministicFallback,
        reason: "OpenAI response did not match the brain review schema.",
        model
      });
    }

    return withReview({
      runner,
      status: "reviewed",
      provider: "openai",
      runStatus: "reviewed",
      review: parsed,
      model
    });
  } catch {
    return withReview({
      runner,
      status: "provider-error",
      provider: "openai",
      runStatus: "provider-error",
      review: packet.deterministicFallback,
      reason: "OpenAI brain review failed before a valid response was received.",
      model
    });
  }
}
