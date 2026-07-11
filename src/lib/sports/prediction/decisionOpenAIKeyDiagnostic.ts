import type { DecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";

type EnvMap = Record<string, string | undefined>;

export type DecisionOpenAIKeyDiagnosticStatus = "missing-key" | "suspicious-key" | "contract-waiting" | "ready-to-request" | "blocked";
export type DecisionOpenAIKeyDiagnosticCheckStatus = "pass" | "watch" | "block";
export type DecisionOpenAIKeyDiagnosticKeyShape = "missing" | "looks-openai" | "unexpected-format";

export type DecisionOpenAIKeyDiagnosticCheck = {
  id: string;
  label: string;
  status: DecisionOpenAIKeyDiagnosticCheckStatus;
  detail: string;
  nextAction: string;
};

export type DecisionOpenAIKeyDiagnostic = {
  mode: "openai-key-diagnostic";
  generatedAt: string;
  status: DecisionOpenAIKeyDiagnosticStatus;
  summary: string;
  diagnosticHash: string;
  runtime: {
    keyPresent: boolean;
    keyShape: DecisionOpenAIKeyDiagnosticKeyShape;
    model: string;
    modelConfigured: boolean;
    readinessStatus: DecisionAIReviewReadiness["status"];
    canRunLiveReview: boolean;
    lanes: number;
    lanesReady: number;
    lanesNeedingKey: number;
  };
  checks: DecisionOpenAIKeyDiagnosticCheck[];
  nextStep: {
    label: string;
    command: string;
    safeToRun: boolean;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canPrintSecrets: false;
    canWriteSecrets: false;
    canCreateKeys: false;
    canCallOpenAI: false;
    requiresExplicitRunParam: true;
    canPersist: false;
    canPublish: false;
    canTrain: false;
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

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value?.trim() ?? "").filter(Boolean))).slice(0, limit);
}

function keyShape(value: string | undefined): DecisionOpenAIKeyDiagnosticKeyShape {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return "missing";
  return /^sk-[A-Za-z0-9_-]{20,}$/.test(trimmed) ? "looks-openai" : "unexpected-format";
}

function statusFor({
  key,
  readiness
}: {
  key: DecisionOpenAIKeyDiagnosticKeyShape;
  readiness: DecisionAIReviewReadiness;
}): DecisionOpenAIKeyDiagnosticStatus {
  if (key === "missing") return "missing-key";
  if (key === "unexpected-format") return "suspicious-key";
  if (readiness.status === "blocked") return "blocked";
  if (readiness.status === "ready-to-run") return "ready-to-request";
  return "contract-waiting";
}

function summaryFor(status: DecisionOpenAIKeyDiagnosticStatus): string {
  if (status === "missing-key") return "OpenAI live review is locked because the server runtime does not have OPENAI_API_KEY.";
  if (status === "suspicious-key") return "OpenAI live review is locked because OPENAI_API_KEY is present but does not look like an OpenAI API key.";
  if (status === "blocked") return "OpenAI live review is blocked by the review contract or safety lane checks.";
  if (status === "ready-to-request") return "OpenAI live review is configured and can be requested only through guarded run=1 routes.";
  return "OpenAI key shape looks configured, but at least one review lane still needs contract proof.";
}

function nextStepFor(status: DecisionOpenAIKeyDiagnosticStatus): DecisionOpenAIKeyDiagnostic["nextStep"] {
  if (status === "missing-key") {
    return {
      label: "Create or reuse the server-side OpenAI key",
      command: decisionCurlCommand("/api/sports/decision/openai-key-diagnostic"),
      safeToRun: true,
      expectedEvidence: "Diagnostic reports missing-key without printing secrets, then the operator uses the secure OpenAI Platform flow to create or reuse OPENAI_API_KEY."
    };
  }
  if (status === "suspicious-key") {
    return {
      label: "Replace the suspicious runtime value",
      command: decisionCurlCommand("/api/sports/decision/openai-key-diagnostic"),
      safeToRun: true,
      expectedEvidence: "Diagnostic reports looks-openai after the server runtime is restarted with a valid server-side OPENAI_API_KEY."
    };
  }
  if (status === "ready-to-request") {
    return {
      label: "Inspect readiness before explicit live review",
      command: decisionCurlCommand("/api/sports/decision/ai-review-readiness?sport=football"),
      safeToRun: true,
      expectedEvidence: "Readiness shows ready-to-run lanes; live review still requires an explicit guarded route with run=1."
    };
  }
  return {
    label: "Inspect review contracts",
    command: decisionCurlCommand("/api/sports/decision/ai-review-readiness?sport=football"),
    safeToRun: true,
    expectedEvidence: "Readiness explains which lane, proof, schema, or safety contract still blocks live review."
  };
}

export function buildDecisionOpenAIKeyDiagnostic({
  aiReviewReadiness,
  env = process.env,
  now = new Date()
}: {
  aiReviewReadiness: DecisionAIReviewReadiness;
  env?: EnvMap;
  now?: Date;
}): DecisionOpenAIKeyDiagnostic {
  const shape = keyShape(env.OPENAI_API_KEY);
  const keyPresent = shape !== "missing";
  const model = env.OPENAI_DECISION_MODEL?.trim() || aiReviewReadiness.model;
  const status = statusFor({ key: shape, readiness: aiReviewReadiness });
  const lanesReady = aiReviewReadiness.lanes.filter((lane) => lane.status === "ready-live-review").length;
  const checks: DecisionOpenAIKeyDiagnosticCheck[] = [
    {
      id: "runtime-key-present",
      label: "Runtime key presence",
      status: keyPresent ? "pass" : "block",
      detail: keyPresent ? "OPENAI_API_KEY is present in the server runtime." : "OPENAI_API_KEY is missing from the server runtime.",
      nextAction: keyPresent ? "Keep the key server-only and never expose it through NEXT_PUBLIC env." : "Create or reuse an OpenAI key securely, write it to the server env, and restart the app."
    },
    {
      id: "runtime-key-shape",
      label: "Runtime key shape",
      status: shape === "missing" ? "block" : shape === "looks-openai" ? "pass" : "watch",
      detail:
        shape === "looks-openai"
          ? "The runtime value has an OpenAI-like key shape without revealing the value."
          : shape === "unexpected-format"
            ? "The runtime value is present but does not have the expected OpenAI key shape."
            : "No key shape can be checked because the runtime key is missing.",
      nextAction: shape === "looks-openai" ? "Rerun AI review readiness before requesting run=1." : "Replace the runtime value with a valid OpenAI API key through the secure setup flow."
    },
    {
      id: "review-lanes",
      label: "Review lane readiness",
      status: aiReviewReadiness.status === "blocked" ? "block" : aiReviewReadiness.status === "ready-to-run" ? "pass" : "watch",
      detail: `${lanesReady}/${aiReviewReadiness.totals.lanes} lanes are ready; ${aiReviewReadiness.totals.needsKey} need a key.`,
      nextAction: aiReviewReadiness.nextSafeCommand.label
    },
    {
      id: "model-selection",
      label: "Model selection",
      status: env.OPENAI_DECISION_MODEL?.trim() ? "pass" : "watch",
      detail: env.OPENAI_DECISION_MODEL?.trim() ? `OPENAI_DECISION_MODEL is configured as ${model}.` : `Using default review model ${model}.`,
      nextAction: "Set OPENAI_DECISION_MODEL only if you need to pin or change the reviewer model."
    },
    {
      id: "no-secret-side-effects",
      label: "No-secret side effects",
      status: "pass",
      detail: "This diagnostic never prints secrets, writes env files, creates keys, calls OpenAI, persists decisions, publishes picks, or trains models.",
      nextAction: "Use it as a read-only proof before running any explicit live-review route."
    }
  ];

  return {
    mode: "openai-key-diagnostic",
    generatedAt: now.toISOString(),
    status,
    summary: summaryFor(status),
    diagnosticHash: stableHash({
      status,
      shape,
      model,
      readiness: aiReviewReadiness.status,
      lanes: aiReviewReadiness.lanes.map((lane) => [lane.id, lane.status])
    }),
    runtime: {
      keyPresent,
      keyShape: shape,
      model,
      modelConfigured: Boolean(env.OPENAI_DECISION_MODEL?.trim()),
      readinessStatus: aiReviewReadiness.status,
      canRunLiveReview: shape === "looks-openai" && aiReviewReadiness.controls.canRunLiveReview,
      lanes: aiReviewReadiness.totals.lanes,
      lanesReady,
      lanesNeedingKey: aiReviewReadiness.totals.needsKey
    },
    checks,
    nextStep: nextStepFor(status),
    controls: {
      canInspectReadOnly: true,
      canPrintSecrets: false,
      canWriteSecrets: false,
      canCreateKeys: false,
      canCallOpenAI: false,
      requiresExplicitRunParam: true,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/openai-key-diagnostic",
      "/api/sports/decision/ai-review-readiness",
      ...aiReviewReadiness.proofUrls
    ]),
    locks: [
      "This diagnostic can inspect key presence and shape only; it cannot print, create, or write secrets.",
      "No OpenAI request is made from this diagnostic.",
      "Live review still requires a guarded route with run=1 after readiness passes.",
      "AI output cannot persist, publish, train, raise trust, or upgrade a public action."
    ]
  };
}
