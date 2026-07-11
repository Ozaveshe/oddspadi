import { readDecisionOpenAIProviderError } from "@/lib/sports/prediction/decisionOpenAIProviderError";
import type { DecisionMvpAIReviewPacket } from "@/lib/sports/prediction/decisionMvpAIReviewPacket";
import { extractOutputText } from "@/lib/sports/prediction/openaiDecisionEnhancer";

export type DecisionMvpAIReviewVerdict = "agree" | "downgrade" | "needs-evidence" | "block";
export type DecisionMvpAIReviewAction = "hold" | "monitor" | "avoid";
export type DecisionMvpAIReviewStatus = "not-requested" | "waiting-packet" | "not-configured" | "reviewed" | "invalid-response" | "provider-error";

export type DecisionMvpAIReviewGate = {
  id: string;
  label: string;
  status: "pass" | "watch" | "block";
  reason: string;
};

export type DecisionMvpAIReview = {
  verdict: DecisionMvpAIReviewVerdict;
  action: DecisionMvpAIReviewAction;
  summary: string;
  risks: string[];
  missingEvidence: string[];
  saferAlternative: string;
  citedEvidenceIds: string[];
  safetyGates: DecisionMvpAIReviewGate[];
  unsupportedClaims: string[];
};

export type DecisionMvpAIReviewRunner = {
  mode: "decision-mvp-ai-review-runner";
  generatedAt: string;
  date: string;
  sport: DecisionMvpAIReviewPacket["sport"];
  status: DecisionMvpAIReviewStatus;
  runnerHash: string;
  summary: string;
  packet: {
    status: DecisionMvpAIReviewPacket["status"];
    hash: string;
    target: DecisionMvpAIReviewPacket["target"];
  };
  latestRun: {
    requested: boolean;
    provider: "openai" | "deterministic" | null;
    status: DecisionMvpAIReviewStatus;
    model: string | null;
    reason: string | null;
    reviewHash: string | null;
    safeNoPersistence: true;
  };
  review: DecisionMvpAIReview | null;
  controls: {
    canInspectReadOnly: true;
    canRequestOpenAI: boolean;
    requiresExplicitRunParam: true;
    canApplyAIOutput: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canPersistTrainingRows: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canAdjustProbabilities: false;
    canRaiseConfidence: false;
    canPublishPicks: false;
    canStake: false;
    canUpgradePublicAction: false;
    canUseHiddenChainOfThought: false;
  };
  nextAction: {
    label: string;
    command: string;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  proofUrls: string[];
  locks: string[];
};

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: ["agree", "downgrade", "needs-evidence", "block"] },
    action: { type: "string", enum: ["hold", "monitor", "avoid"] },
    summary: { type: "string" },
    risks: { type: "array", items: { type: "string" } },
    missingEvidence: { type: "array", items: { type: "string" } },
    saferAlternative: { type: "string" },
    citedEvidenceIds: { type: "array", items: { type: "string" } },
    safetyGates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          status: { type: "string", enum: ["pass", "watch", "block"] },
          reason: { type: "string" }
        },
        required: ["id", "label", "status", "reason"]
      }
    },
    unsupportedClaims: { type: "array", items: { type: "string" } }
  },
  required: ["verdict", "action", "summary", "risks", "missingEvidence", "saferAlternative", "citedEvidenceIds", "safetyGates", "unsupportedClaims"]
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

function compact(value: string | null | undefined, maxLength = 360): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "";
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function boundedList(value: unknown, limit = 8, maxLength = 220): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => compact(item, maxLength)).slice(0, limit);
}

function isVerdict(value: unknown): value is DecisionMvpAIReviewVerdict {
  return value === "agree" || value === "downgrade" || value === "needs-evidence" || value === "block";
}

function isAction(value: unknown): value is DecisionMvpAIReviewAction {
  return value === "hold" || value === "monitor" || value === "avoid";
}

function isGateStatus(value: unknown): value is DecisionMvpAIReviewGate["status"] {
  return value === "pass" || value === "watch" || value === "block";
}

function boundedGates(value: unknown): DecisionMvpAIReviewGate[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      if (!isGateStatus(record.status)) return null;
      const id = compact(typeof record.id === "string" ? record.id : "", 80);
      const label = compact(typeof record.label === "string" ? record.label : "", 120);
      const reason = compact(typeof record.reason === "string" ? record.reason : "", 240);
      if (!id || !label || !reason) return null;
      return { id, label, status: record.status, reason };
    })
    .filter((item): item is DecisionMvpAIReviewGate => Boolean(item))
    .slice(0, 8);
}

export function safeParseDecisionMvpAIReview(text: string, allowedEvidenceIds: Set<string>): DecisionMvpAIReview | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!isVerdict(parsed.verdict) || !isAction(parsed.action)) return null;
    const summary = compact(typeof parsed.summary === "string" ? parsed.summary : "", 700);
    const saferAlternative = compact(typeof parsed.saferAlternative === "string" ? parsed.saferAlternative : "", 360);
    const safetyGates = boundedGates(parsed.safetyGates);
    if (!summary || !saferAlternative || !safetyGates.length) return null;
    return {
      verdict: parsed.verdict,
      action: parsed.action,
      summary,
      risks: boundedList(parsed.risks, 8),
      missingEvidence: boundedList(parsed.missingEvidence, 8),
      saferAlternative,
      citedEvidenceIds: boundedList(parsed.citedEvidenceIds, 12, 120).filter((id) => allowedEvidenceIds.has(id)),
      safetyGates,
      unsupportedClaims: boundedList(parsed.unsupportedClaims, 8)
    };
  } catch {
    return null;
  }
}

function deterministicReview(packet: DecisionMvpAIReviewPacket): DecisionMvpAIReview {
  const blockingEvidence = packet.evidence.items.filter((item) => item.status === "block");
  const watchEvidence = packet.evidence.items.filter((item) => item.status === "watch");
  const verdict: DecisionMvpAIReviewVerdict = blockingEvidence.length ? "needs-evidence" : watchEvidence.length ? "downgrade" : "agree";
  return {
    verdict,
    action: blockingEvidence.length ? "hold" : "monitor",
    summary: blockingEvidence.length
      ? `Deterministic reviewer holds the MVP packet because ${blockingEvidence[0].label} is blocking the live critique path.`
      : watchEvidence.length
        ? `Deterministic reviewer keeps the packet monitor-only because ${watchEvidence[0].label} still needs proof.`
        : "Deterministic reviewer agrees the packet is ready for a guarded critique, while all side-effect locks remain active.",
    risks: [
      ...blockingEvidence.map((item) => `${item.label}: ${item.detail}`),
      ...watchEvidence.map((item) => `${item.label}: ${item.detail}`),
      "AI review is advisory and cannot replace provider-backed fixtures, odds, lineups, injuries, weather, results, or backtests."
    ].slice(0, 8),
    missingEvidence: packet.requestPreview.input.requiredBeforeUpgrade.slice(0, 8),
    saferAlternative: "Keep the decision in hold or monitor-only posture until provider, cycle, storage, and review gates pass.",
    citedEvidenceIds: packet.evidence.ids.slice(0, 8),
    safetyGates: [
      {
        id: "packet-submit",
        label: "Packet submit gate",
        status: packet.controls.canSubmitToOpenAI ? "pass" : "block",
        reason: packet.controls.canSubmitToOpenAI ? "Packet allows explicit OpenAI submission." : packet.summary
      },
      {
        id: "no-side-effects",
        label: "No side effects",
        status: "pass",
        reason: "Runner cannot apply AI output, write providers, persist decisions, train, stake, publish, or raise confidence."
      },
      {
        id: "public-reasoning",
        label: "Public reasoning only",
        status: "pass",
        reason: "Runner forbids hidden chain-of-thought and unsupported provider facts."
      }
    ],
    unsupportedClaims: []
  };
}

function summaryFor(status: DecisionMvpAIReviewStatus): string {
  if (status === "reviewed") return "MVP AI review completed through the guarded route; output remains advisory and side-effect locked.";
  if (status === "waiting-packet") return "MVP AI review runner is waiting for the packet to become submit-ready.";
  if (status === "not-configured") return "MVP AI review runner needs a server-side OPENAI_API_KEY before live review can run.";
  if (status === "invalid-response") return "MVP AI review runner received a response that did not match the strict review schema.";
  if (status === "provider-error") return "MVP AI review runner reached OpenAI but fell back to deterministic review after a provider error.";
  return "MVP AI review runner is inspectable; add run=1 only when the packet gates allow live review.";
}

function withReview({
  packet,
  status,
  review,
  requested,
  provider,
  model,
  reason,
  now
}: {
  packet: DecisionMvpAIReviewPacket;
  status: DecisionMvpAIReviewStatus;
  review: DecisionMvpAIReview | null;
  requested: boolean;
  provider: "openai" | "deterministic" | null;
  model: string | null;
  reason: string | null;
  now: Date;
}): DecisionMvpAIReviewRunner {
  const reviewHash = review ? stableHash(review) : null;
  const canRequestOpenAI = packet.controls.canSubmitToOpenAI;
  return {
    mode: "decision-mvp-ai-review-runner",
    generatedAt: now.toISOString(),
    date: packet.date,
    sport: packet.sport,
    status,
    runnerHash: stableHash({
      status,
      packet: packet.packetHash,
      requested,
      provider,
      model,
      reason,
      reviewHash
    }),
    summary: summaryFor(status),
    packet: {
      status: packet.status,
      hash: packet.packetHash,
      target: packet.target
    },
    latestRun: {
      requested,
      provider,
      status,
      model,
      reason,
      reviewHash,
      safeNoPersistence: true
    },
    review,
    controls: {
      canInspectReadOnly: true,
      canRequestOpenAI,
      requiresExplicitRunParam: true,
      canApplyAIOutput: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canPersistTrainingRows: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canAdjustProbabilities: false,
      canRaiseConfidence: false,
      canPublishPicks: false,
      canStake: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    nextAction: {
      label: canRequestOpenAI ? "Run guarded MVP AI review" : "Resolve packet gates first",
      command: `curl.exe "http://127.0.0.1:3025/api/sports/decision/mvp-ai-review-runner?date=${encodeURIComponent(packet.date)}&sport=${encodeURIComponent(packet.sport)}&limit=8${canRequestOpenAI ? "&run=1" : ""}"`,
      safeToRun: canRequestOpenAI,
      expectedEvidence: canRequestOpenAI
        ? "Runner returns a schema-valid critique and keeps canApplyAIOutput, canPublishPicks, canTrainModels, and canRaiseConfidence false."
        : "Runner returns deterministic critique evidence while live OpenAI submission remains locked."
    },
    proofUrls: [
      "/api/sports/decision/mvp-ai-review-runner",
      "/api/sports/decision/mvp-ai-review-packet",
      ...packet.proofUrls
    ].filter((value, index, values) => values.indexOf(value) === index).slice(0, 24),
    locks: [
      "MVP AI review runner requires explicit run=1 before any live provider call.",
      "MVP AI review output is advisory and cannot apply itself.",
      "Runner cannot publish, stake, persist, train, write provider rows, adjust probabilities, raise confidence, or reveal hidden chain-of-thought.",
      ...packet.locks
    ].filter((value, index, values) => values.indexOf(value) === index).slice(0, 80)
  };
}

export function buildOpenAIDecisionMvpAIReviewPayload({
  packet,
  model
}: {
  packet: DecisionMvpAIReviewPacket;
  model: string;
}) {
  return {
    model,
    store: false,
    reasoning: { effort: "medium", summary: "auto" },
    input: [
      {
        role: "system" as const,
        content: [
          "You are OddsPadi's guarded MVP decision-engine critic.",
          ...packet.requestPreview.instructions,
          "Use only the supplied packet JSON and cite supplied evidence IDs.",
          "Return public audit notes only.",
          "Return strict JSON matching the schema."
        ].join(" ")
      },
      {
        role: "user" as const,
        content: JSON.stringify({
          packet: {
            date: packet.date,
            sport: packet.sport,
            status: packet.status,
            target: packet.target,
            requestPreview: packet.requestPreview,
            evidence: packet.evidence,
            controls: packet.controls,
            locks: packet.locks.slice(0, 20)
          },
          outputRules: {
            allowedEvidenceIds: packet.evidence.ids,
            allowedVerdicts: packet.requestPreview.responseContract.allowedVerdicts,
            allowedActions: packet.requestPreview.responseContract.allowedActions,
            forbidden: packet.requestPreview.responseContract.forbidden,
            noPromotion: true,
            noPersistence: true,
            noPublish: true,
            noTraining: true,
            noProviderWrites: true
          }
        })
      }
    ],
    text: {
      format: {
        type: "json_schema" as const,
        name: packet.requestPreview.schemaName,
        strict: true,
        schema: reviewSchema
      }
    },
    max_output_tokens: 1300
  };
}

export async function runDecisionMvpAIReview({
  packet,
  runRequested = false,
  apiKey = process.env.OPENAI_API_KEY,
  model = packet.requestPreview.model,
  fetchImpl = fetch,
  now = new Date()
}: {
  packet: DecisionMvpAIReviewPacket;
  runRequested?: boolean;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<DecisionMvpAIReviewRunner> {
  if (!runRequested) {
    return withReview({ packet, status: "not-requested", review: null, requested: false, provider: null, model: null, reason: null, now });
  }

  const fallback = deterministicReview(packet);
  if (!packet.controls.canSubmitToOpenAI) {
    return withReview({ packet, status: "waiting-packet", review: fallback, requested: true, provider: "deterministic", model: null, reason: packet.summary, now });
  }
  if (!apiKey?.trim()) {
    return withReview({
      packet,
      status: "not-configured",
      review: fallback,
      requested: true,
      provider: "deterministic",
      model: null,
      reason: "OPENAI_API_KEY is not configured.",
      now
    });
  }

  try {
    const response = await fetchImpl("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(buildOpenAIDecisionMvpAIReviewPayload({ packet, model }))
    });

    if (!response.ok) {
      const providerError = await readDecisionOpenAIProviderError(response);
      return withReview({ packet, status: "provider-error", review: fallback, requested: true, provider: "openai", model, reason: providerError.reason, now });
    }

    const outputText = extractOutputText((await response.json()) as unknown);
    if (!outputText) {
      return withReview({
        packet,
        status: "invalid-response",
        review: fallback,
        requested: true,
        provider: "openai",
        model,
        reason: "OpenAI response did not include output text.",
        now
      });
    }

    const review = safeParseDecisionMvpAIReview(outputText, new Set(packet.evidence.ids));
    if (!review) {
      return withReview({
        packet,
        status: "invalid-response",
        review: fallback,
        requested: true,
        provider: "openai",
        model,
        reason: "OpenAI response did not match the MVP AI review schema.",
        now
      });
    }

    return withReview({ packet, status: "reviewed", review, requested: true, provider: "openai", model, reason: null, now });
  } catch {
    return withReview({
      packet,
      status: "provider-error",
      review: fallback,
      requested: true,
      provider: "openai",
      model,
      reason: "OpenAI MVP AI review failed before a valid response was received.",
      now
    });
  }
}
