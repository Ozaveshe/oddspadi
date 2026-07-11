import type { DecisionAIContextDossier } from "@/lib/sports/prediction/decisionAIContextDossier";
import type { DecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import type { DecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

export type DecisionOpenAILiveReviewReceiptStatus =
  | "missing-key"
  | "contract-waiting"
  | "ready-to-request"
  | "reviewed"
  | "rate-or-quota-limited"
  | "quota-or-billing-blocked"
  | "auth-failed"
  | "model-or-request-error"
  | "invalid-response"
  | "provider-error";

export type DecisionOpenAILiveReviewReceiptGate = {
  id: string;
  label: string;
  status: "pass" | "watch" | "block";
  detail: string;
  nextAction: string;
};

export type DecisionOpenAILiveReviewReceipt = {
  generatedAt: string;
  mode: "openai-live-review-receipt";
  status: DecisionOpenAILiveReviewReceiptStatus;
  receiptHash: string;
  summary: string;
  model: string;
  latestRun: {
    requested: boolean;
    provider: DecisionAIContextDossier["latestRun"]["provider"] | null;
    status: DecisionAIContextDossier["latestRun"]["status"] | null;
    reason: string | null;
    reviewHash: string | null;
    safeNoPersistence: true;
  };
  providerDiagnostic: {
    category: "not-run" | "ready" | "reviewed" | "quota-billing" | "auth" | "model-request" | "invalid-response" | "provider-error";
    operatorMessage: string;
    billingActionRequired: boolean;
    keyRotationRecommended: boolean;
    retryRecommended: boolean;
  };
  gates: DecisionOpenAILiveReviewReceiptGate[];
  controls: {
    canInspectReadOnly: true;
    canRequestLiveReview: boolean;
    requiresExplicitRunParam: true;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canPrintSecrets: false;
    canRaiseTrust: false;
  };
  nextAction: string;
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

function compact(value: string | null | undefined, maxLength = 220): string | null {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function classifyRun({
  diagnostic,
  dossier
}: {
  diagnostic: DecisionOpenAIKeyDiagnostic;
  dossier?: DecisionAIContextDossier | null;
}): DecisionOpenAILiveReviewReceiptStatus {
  if (diagnostic.status === "missing-key" || diagnostic.status === "suspicious-key") return "missing-key";
  if (diagnostic.status !== "ready-to-request") return "contract-waiting";
  if (!dossier?.latestRun.requested) return "ready-to-request";
  if (dossier.latestRun.status === "reviewed") return "reviewed";
  if (dossier.latestRun.status === "invalid-response") return "invalid-response";
  const reason = dossier.latestRun.reason?.toLowerCase() ?? "";
  if (reason.includes("http 401") || reason.includes("http 403") || reason.includes("unauthorized") || reason.includes("auth")) return "auth-failed";
  if (reason.includes("http 400") || reason.includes("http 404") || reason.includes("model")) return "model-or-request-error";
  if (reason.includes("quota") || reason.includes("billing") || reason.includes("insufficient_quota")) return "quota-or-billing-blocked";
  if (reason.includes("http 429") || reason.includes("quota") || reason.includes("rate limit") || reason.includes("billing")) return "rate-or-quota-limited";
  return "provider-error";
}

function summaryFor(status: DecisionOpenAILiveReviewReceiptStatus): string {
  if (status === "reviewed") return "OpenAI live review completed through the guarded route; deterministic side effects stayed locked.";
  if (status === "quota-or-billing-blocked") return "OpenAI live review reached the provider, but the selected project appears blocked by quota or billing.";
  if (status === "rate-or-quota-limited") return "OpenAI live review reached the provider, but the account or project is currently rate, quota, or billing limited.";
  if (status === "auth-failed") return "OpenAI live review reached the provider, but the key or project authorization was rejected.";
  if (status === "model-or-request-error") return "OpenAI live review reached the provider, but the selected model or request contract needs adjustment.";
  if (status === "invalid-response") return "OpenAI returned a response, but it did not match the required safe review schema.";
  if (status === "provider-error") return "OpenAI live review reached the provider but failed; deterministic fallback kept the decision safe.";
  if (status === "missing-key") return "OpenAI live review is locked until the server runtime has a valid server-only key.";
  if (status === "contract-waiting") return "OpenAI live review is waiting for the readiness contract before any run=1 request.";
  return "OpenAI live review is ready for an explicit guarded run=1 proof request.";
}

function gate(input: DecisionOpenAILiveReviewReceiptGate): DecisionOpenAILiveReviewReceiptGate {
  return input;
}

function providerDiagnosticFor(status: DecisionOpenAILiveReviewReceiptStatus): DecisionOpenAILiveReviewReceipt["providerDiagnostic"] {
  if (status === "reviewed") {
    return {
      category: "reviewed",
      operatorMessage: "OpenAI accepted the guarded request and returned a schema-valid review. Keep it advisory until data, storage, and training gates clear.",
      billingActionRequired: false,
      keyRotationRecommended: false,
      retryRecommended: false
    };
  }
  if (status === "quota-or-billing-blocked" || status === "rate-or-quota-limited") {
    return {
      category: "quota-billing",
      operatorMessage: "The key is present and the request reached OpenAI, but the selected project needs billing, quota, or rate-limit capacity before live AI review can complete.",
      billingActionRequired: true,
      keyRotationRecommended: false,
      retryRecommended: false
    };
  }
  if (status === "auth-failed") {
    return {
      category: "auth",
      operatorMessage: "OpenAI rejected authorization. Verify the key belongs to the selected organization/project and rotate it if the project target changed.",
      billingActionRequired: false,
      keyRotationRecommended: true,
      retryRecommended: false
    };
  }
  if (status === "model-or-request-error") {
    return {
      category: "model-request",
      operatorMessage: "OpenAI accepted the credential path but rejected the model or request contract. Check the selected model and structured-output payload before retrying.",
      billingActionRequired: false,
      keyRotationRecommended: false,
      retryRecommended: false
    };
  }
  if (status === "invalid-response") {
    return {
      category: "invalid-response",
      operatorMessage: "OpenAI returned content, but it did not satisfy the OddsPadi safe review schema. Keep deterministic fallbacks active and inspect the schema contract.",
      billingActionRequired: false,
      keyRotationRecommended: false,
      retryRecommended: true
    };
  }
  if (status === "provider-error") {
    return {
      category: "provider-error",
      operatorMessage: "The provider request failed without a more specific classification. Keep the run advisory and inspect the bounded provider reason.",
      billingActionRequired: false,
      keyRotationRecommended: false,
      retryRecommended: true
    };
  }
  if (status === "ready-to-request") {
    return {
      category: "ready",
      operatorMessage: "The key and review contract are ready. A live provider result still requires an explicit guarded run=1 request.",
      billingActionRequired: false,
      keyRotationRecommended: false,
      retryRecommended: false
    };
  }
  return {
    category: "not-run",
    operatorMessage: "No live OpenAI provider result is available yet. Resolve the current gate, then run a guarded proof when appropriate.",
    billingActionRequired: false,
    keyRotationRecommended: false,
    retryRecommended: false
  };
}

export function buildDecisionOpenAILiveReviewReceipt({
  aiReviewReadiness,
  openAiKeyDiagnostic,
  dossier = null,
  now = new Date()
}: {
  aiReviewReadiness: DecisionAIReviewReadiness;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  dossier?: DecisionAIContextDossier | null;
  now?: Date;
}): DecisionOpenAILiveReviewReceipt {
  const status = classifyRun({ diagnostic: openAiKeyDiagnostic, dossier });
  const run = dossier?.latestRun;
  const latestReason = compact(run?.reason);
  const providerDiagnostic = providerDiagnosticFor(status);
  const gates = [
    gate({
      id: "runtime-key",
      label: "Runtime key",
      status: openAiKeyDiagnostic.runtime.keyShape === "looks-openai" ? "pass" : "block",
      detail: openAiKeyDiagnostic.runtime.keyShape === "looks-openai" ? "Server runtime has an OpenAI-like key shape without exposing it." : openAiKeyDiagnostic.summary,
      nextAction: openAiKeyDiagnostic.runtime.keyShape === "looks-openai" ? "Keep the key server-only." : "Create or replace the key through the secure setup flow."
    }),
    gate({
      id: "readiness-contract",
      label: "Readiness contract",
      status: aiReviewReadiness.status === "ready-to-run" ? "pass" : aiReviewReadiness.status === "needs-key" ? "watch" : "block",
      detail: `${aiReviewReadiness.totals.readyLiveReview}/${aiReviewReadiness.totals.lanes} live review lane(s) are ready.`,
      nextAction: aiReviewReadiness.nextSafeCommand.label
    }),
    gate({
      id: "guarded-live-run",
      label: "Guarded live run",
      status: !run?.requested ? "watch" : status === "reviewed" ? "pass" : "block",
      detail: !run?.requested
        ? "No live provider request was made by this receipt. Add run=1 only when you intentionally want a bounded OpenAI proof."
        : `${run.provider} returned ${run.status}${latestReason ? `: ${latestReason}` : "."}`,
      nextAction: !run?.requested
        ? "Run the live receipt with run=1 after readiness is green."
        : status === "reviewed"
          ? "Keep using the safe schema and no-persistence controls."
          : status === "rate-or-quota-limited"
            ? "Check OpenAI project billing, quota, and rate limits for the selected project."
            : status === "quota-or-billing-blocked"
              ? "Add billing or quota to the selected OpenAI project, then rerun the guarded live proof."
            : "Inspect the provider reason, model, and request contract before retrying."
    }),
    gate({
      id: "side-effect-locks",
      label: "Side-effect locks",
      status: "pass",
      detail: "The live proof cannot persist decisions, publish picks, train models, print secrets, or raise public trust.",
      nextAction: "Keep AI review output as advisory until Supabase, training, and publishing gates are separately approved."
    })
  ];
  const nextGate = gates.find((item) => item.status === "block") ?? gates.find((item) => item.status === "watch") ?? null;
  const canRequestLiveReview = openAiKeyDiagnostic.runtime.canRunLiveReview && aiReviewReadiness.controls.canRunLiveReview;

  return {
    generatedAt: now.toISOString(),
    mode: "openai-live-review-receipt",
    status,
    receiptHash: stableHash({
      status,
      model: openAiKeyDiagnostic.runtime.model,
      diagnostic: openAiKeyDiagnostic.diagnosticHash,
      readiness: aiReviewReadiness.readinessHash,
      latestRun: run ? [run.requested, run.provider, run.status, run.reason, run.reviewHash] : null
    }),
    summary: summaryFor(status),
    model: openAiKeyDiagnostic.runtime.model,
    latestRun: {
      requested: Boolean(run?.requested),
      provider: run?.provider ?? null,
      status: run?.status ?? null,
      reason: latestReason,
      reviewHash: run?.reviewHash ?? null,
      safeNoPersistence: true
    },
    providerDiagnostic,
    gates,
    controls: {
      canInspectReadOnly: true,
      canRequestLiveReview,
      requiresExplicitRunParam: true,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canPrintSecrets: false,
      canRaiseTrust: false
    },
    nextAction: nextGate?.nextAction ?? "Continue with read-only AI review proof.",
    proofUrls: [
      "/api/sports/decision/openai-live-review-receipt",
      "/api/sports/decision/openai-key-diagnostic",
      "/api/sports/decision/ai-review-readiness",
      "/api/sports/decision/ai-context-dossier"
    ],
    locks: [
      "Live AI review requires explicit run=1.",
      "OpenAI output cannot persist, publish, train, raise trust, or override deterministic safety gates.",
      `Safe proof command: ${decisionCurlCommand("/api/sports/decision/openai-live-review-receipt?sport=football&limit=1&run=1")}`
    ]
  };
}
