import type { DecisionChangeMindLedger } from "@/lib/sports/prediction/decisionChangeMindLedger";
import type { DecisionFinalAnswerContract, DecisionFinalAnswerPublicAction } from "@/lib/sports/prediction/decisionFinalAnswerContract";
import type { DecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import type { DecisionPortfolioRisk } from "@/lib/sports/prediction/decisionPortfolioRisk";
import type { DecisionTrustFirewall } from "@/lib/sports/prediction/decisionTrustFirewall";
import { extractOutputText } from "@/lib/sports/prediction/openaiDecisionEnhancer";
import { getDecisionOpenAIModel } from "@/lib/sports/prediction/openaiModel";
import type { Sport } from "@/lib/sports/types";

export type DecisionFinalAnswerAIReviewStatus =
  | "not-requested"
  | "ready-to-run"
  | "reviewed"
  | "not-configured"
  | "blocked"
  | "quota-or-billing-blocked"
  | "auth-failed"
  | "provider-error"
  | "invalid-response";

export type DecisionFinalAnswerAIReviewVerdict = "agree" | "downgrade" | "needs-evidence" | "block";
export type DecisionFinalAnswerAIReviewProvider = "openai" | "deterministic";

export type DecisionFinalAnswerAIReviewResult = {
  verdict: DecisionFinalAnswerAIReviewVerdict;
  publicAction: DecisionFinalAnswerPublicAction;
  summary: string;
  citedEvidenceIds: string[];
  challengedClaims: string[];
  requiredEvidence: string[];
  riskFlags: string[];
  saferAlternatives: string[];
  publishPermission: "never";
  persistencePermission: "never";
  trainingPermission: "never";
  stakingPermission: "never";
  publicActionUpgradePermission: "never";
};

export type DecisionFinalAnswerAIReviewEvidence = {
  id: string;
  label: string;
  detail: string;
  proofUrl: string;
};

export type DecisionFinalAnswerAIReview = {
  mode: "decision-final-answer-ai-review";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionFinalAnswerAIReviewStatus;
  reviewHash: string;
  summary: string;
  model: string;
  runRequested: boolean;
  provider: DecisionFinalAnswerAIReviewProvider;
  latestRun: {
    requested: boolean;
    provider: DecisionFinalAnswerAIReviewProvider;
    status: DecisionFinalAnswerAIReviewStatus;
    model: string | null;
    reason: string | null;
    safeNoPersistence: true;
  };
  target: DecisionFinalAnswerContract["target"];
  deterministicFallback: DecisionFinalAnswerAIReviewResult;
  review: DecisionFinalAnswerAIReviewResult | null;
  appliedReview: DecisionFinalAnswerAIReviewResult;
  evidencePacket: DecisionFinalAnswerAIReviewEvidence[];
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
  };
  proofUrls: string[];
  locks: string[];
};

const verdicts: DecisionFinalAnswerAIReviewVerdict[] = ["agree", "downgrade", "needs-evidence", "block"];
const publicActions: DecisionFinalAnswerPublicAction[] = ["avoid", "monitor"];

const finalAnswerReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    verdict: { type: "string", enum: verdicts },
    publicAction: { type: "string", enum: publicActions },
    summary: { type: "string" },
    citedEvidenceIds: { type: "array", items: { type: "string" } },
    challengedClaims: { type: "array", items: { type: "string" } },
    requiredEvidence: { type: "array", items: { type: "string" } },
    riskFlags: { type: "array", items: { type: "string" } },
    saferAlternatives: { type: "array", items: { type: "string" } },
    publishPermission: { type: "string", enum: ["never"] },
    persistencePermission: { type: "string", enum: ["never"] },
    trainingPermission: { type: "string", enum: ["never"] },
    stakingPermission: { type: "string", enum: ["never"] },
    publicActionUpgradePermission: { type: "string", enum: ["never"] }
  },
  required: [
    "verdict",
    "publicAction",
    "summary",
    "citedEvidenceIds",
    "challengedClaims",
    "requiredEvidence",
    "riskFlags",
    "saferAlternatives",
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

function compact(value: string | null | undefined, maxLength = 340): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No public detail available.";
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 12): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function isVerdict(value: unknown): value is DecisionFinalAnswerAIReviewVerdict {
  return typeof value === "string" && verdicts.includes(value as DecisionFinalAnswerAIReviewVerdict);
}

function isPublicAction(value: unknown): value is DecisionFinalAnswerPublicAction {
  return typeof value === "string" && publicActions.includes(value as DecisionFinalAnswerPublicAction);
}

function actionRank(action: DecisionFinalAnswerPublicAction): number {
  return action === "monitor" ? 2 : 1;
}

function sameOrSaferAction(fallback: DecisionFinalAnswerPublicAction, proposed: DecisionFinalAnswerPublicAction): DecisionFinalAnswerPublicAction {
  return actionRank(proposed) > actionRank(fallback) ? fallback : proposed;
}

function stringList(value: unknown, limit = 8): string[] {
  if (!Array.isArray(value)) return [];
  return unique(
    value.map((item) => (typeof item === "string" ? compact(item, 260) : null)),
    limit
  );
}

function evidencePacket({
  finalAnswer,
  changeMindLedger,
  trustFirewall,
  portfolioRisk
}: {
  finalAnswer: DecisionFinalAnswerContract;
  changeMindLedger: DecisionChangeMindLedger;
  trustFirewall: DecisionTrustFirewall;
  portfolioRisk: DecisionPortfolioRisk;
}): DecisionFinalAnswerAIReviewEvidence[] {
  const stressFailures = portfolioRisk.stressTests.filter((scenario) => scenario.status === "fails").length;
  return [
    {
      id: "final-answer",
      label: "Final answer",
      detail: `${finalAnswer.publicAnswer.action}: ${finalAnswer.publicAnswer.explanation}`,
      proofUrl: "/api/sports/decision/final-answer-contract"
    },
    {
      id: "model-view",
      label: "Model and market view",
      detail: `${finalAnswer.modelView.whyModelFavorsIt} EV ${finalAnswer.modelView.expectedValue ?? "n/a"}; edge ${finalAnswer.modelView.edge ?? "n/a"}.`,
      proofUrl: "/api/sports/decision/market-audit-matrix"
    },
    {
      id: "primary-risk",
      label: "Primary risk",
      detail: finalAnswer.riskReview.primaryRisk,
      proofUrl: "/api/sports/decision/final-answer-contract"
    },
    {
      id: "change-mind-next",
      label: "Next flip condition",
      detail: changeMindLedger.nextFlip ? `${changeMindLedger.nextFlip.label}: ${changeMindLedger.nextFlip.requiredProof}` : changeMindLedger.summary,
      proofUrl: "/api/sports/decision/change-mind-ledger"
    },
    {
      id: "portfolio-stress",
      label: "Portfolio stress",
      detail: `${portfolioRisk.summary} Stress failures: ${stressFailures}.`,
      proofUrl: "/api/sports/decision/portfolio-risk"
    },
    {
      id: "trust-firewall",
      label: "Trust firewall",
      detail: trustFirewall.summary,
      proofUrl: "/api/sports/decision/trust-firewall"
    },
    {
      id: "controls",
      label: "Control locks",
      detail: `Publish ${finalAnswer.controls.canPublish}; stake ${finalAnswer.controls.canStake}; train ${finalAnswer.controls.canTrain}; upgrade ${finalAnswer.controls.canUpgradePublicAction}.`,
      proofUrl: "/api/sports/decision/final-answer-validation"
    }
  ];
}

function deterministicFallback({
  finalAnswer,
  changeMindLedger
}: {
  finalAnswer: DecisionFinalAnswerContract;
  changeMindLedger: DecisionChangeMindLedger;
}): DecisionFinalAnswerAIReviewResult {
  const blockers = changeMindLedger.flipConditions.filter((condition) => condition.status === "blocking");
  return {
    verdict: blockers.length ? "block" : finalAnswer.publicAnswer.action === "avoid" ? "needs-evidence" : "agree",
    publicAction: finalAnswer.publicAnswer.action,
    summary: blockers.length
      ? `Deterministic fallback keeps ${finalAnswer.publicAnswer.action}; ${blockers.length} change-mind condition(s) still block the decision.`
      : `Deterministic fallback keeps ${finalAnswer.publicAnswer.action}; no AI review has been requested.`,
    citedEvidenceIds: ["final-answer", "change-mind-next", "controls"],
    challengedClaims: [],
    requiredEvidence: unique([changeMindLedger.nextFlip?.requiredProof, ...finalAnswer.riskReview.requiredBeforeUpgrade.slice(0, 4)], 6),
    riskFlags: unique([finalAnswer.riskReview.primaryRisk, ...finalAnswer.riskReview.newsOrContextRisks.slice(0, 4)], 6),
    saferAlternatives: finalAnswer.alternatives.slice(0, 4).map((item) => `${item.market}: ${item.selection}`),
    publishPermission: "never",
    persistencePermission: "never",
    trainingPermission: "never",
    stakingPermission: "never",
    publicActionUpgradePermission: "never"
  };
}

export function safeParseFinalAnswerAIReview({
  text,
  fallback,
  allowedEvidenceIds
}: {
  text: string;
  fallback: DecisionFinalAnswerAIReviewResult;
  allowedEvidenceIds: Set<string>;
}): DecisionFinalAnswerAIReviewResult | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!isVerdict(parsed.verdict)) return null;
    if (!isPublicAction(parsed.publicAction)) return null;
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
    const publicAction = sameOrSaferAction(fallback.publicAction, parsed.publicAction);
    const citedEvidenceIds = stringList(parsed.citedEvidenceIds, 8).filter((id) => allowedEvidenceIds.has(id));
    return {
      verdict: publicAction === fallback.publicAction ? parsed.verdict : "downgrade",
      publicAction,
      summary: compact(publicAction === parsed.publicAction ? parsed.summary : `${parsed.summary} Same-or-safer lock reduced public action to ${publicAction}.`, 420),
      citedEvidenceIds,
      challengedClaims: stringList(parsed.challengedClaims),
      requiredEvidence: stringList(parsed.requiredEvidence),
      riskFlags: stringList(parsed.riskFlags),
      saferAlternatives: stringList(parsed.saferAlternatives),
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

function buildOpenAIFinalAnswerReviewPayload({
  finalAnswer,
  changeMindLedger,
  trustFirewall,
  portfolioRisk,
  evidence,
  fallback,
  model
}: {
  finalAnswer: DecisionFinalAnswerContract;
  changeMindLedger: DecisionChangeMindLedger;
  trustFirewall: DecisionTrustFirewall;
  portfolioRisk: DecisionPortfolioRisk;
  evidence: DecisionFinalAnswerAIReviewEvidence[];
  fallback: DecisionFinalAnswerAIReviewResult;
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
          "You are OddsPadi's final-answer adjudicator. Review the visible sports decision using only supplied evidence IDs. You may agree, downgrade, block, or request evidence. You must not invent data, recommend staking, publish picks, train models, persist decisions, reveal hidden reasoning, or upgrade the public action."
      },
      {
        role: "user" as const,
        content: JSON.stringify({
          task: "Critique the final public answer and return a same-or-safer JSON review.",
          finalAnswer: {
            status: finalAnswer.status,
            publicAnswer: finalAnswer.publicAnswer,
            target: finalAnswer.target,
            modelView: finalAnswer.modelView,
            riskReview: finalAnswer.riskReview,
            alternatives: finalAnswer.alternatives
          },
          changeMindLedger: {
            status: changeMindLedger.status,
            nextFlip: changeMindLedger.nextFlip,
            flipConditions: changeMindLedger.flipConditions
          },
          trustFirewall: {
            status: trustFirewall.status,
            actionContract: trustFirewall.actionContract,
            gates: trustFirewall.gates
          },
          portfolioRisk: {
            status: portfolioRisk.status,
            budget: portfolioRisk.budget,
            stressTests: portfolioRisk.stressTests
          },
          evidencePacket: evidence,
          deterministicFallback: fallback,
          safety: {
            sameOrSaferThanFallbackPublicAction: true,
            allowedEvidenceIds: evidence.map((item) => item.id),
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
        name: "OddsPadiFinalAnswerAIReview",
        strict: true,
        schema: finalAnswerReviewSchema
      }
    },
    max_output_tokens: 1700
  };
}

function classifyProviderError(status: number, detail: string): Pick<DecisionFinalAnswerAIReview, "status"> & { reason: string } {
  const lower = detail.toLowerCase();
  if (status === 401 || status === 403) return { status: "auth-failed", reason: `OpenAI authentication failed with HTTP ${status}.` };
  if (status === 429 || lower.includes("insufficient_quota") || lower.includes("billing") || lower.includes("quota")) {
    return { status: "quota-or-billing-blocked", reason: `OpenAI quota or billing blocked final-answer review with HTTP ${status}.` };
  }
  return { status: "provider-error", reason: `OpenAI Responses API returned HTTP ${status}.` };
}

function summaryFor(status: DecisionFinalAnswerAIReviewStatus, applied: DecisionFinalAnswerAIReviewResult): string {
  if (status === "reviewed") return `OpenAI reviewed the final answer and returned ${applied.verdict}; public action remains ${applied.publicAction}.`;
  if (status === "ready-to-run") return "Final-answer AI adjudicator is ready for explicit run=1 review.";
  if (status === "not-configured") return "Final-answer AI adjudicator is waiting for a server-side OpenAI key.";
  if (status === "blocked") return "Final-answer AI adjudicator is blocked by key or safety readiness.";
  if (status === "quota-or-billing-blocked") return "OpenAI quota or billing blocked final-answer review; deterministic fallback remains applied.";
  if (status === "auth-failed") return "OpenAI authentication failed; deterministic fallback remains applied.";
  if (status === "invalid-response") return "OpenAI response did not match the final-answer review schema; deterministic fallback remains applied.";
  if (status === "provider-error") return "OpenAI final-answer review failed; deterministic fallback remains applied.";
  return "Final-answer AI adjudicator has not been requested; deterministic fallback remains applied.";
}

function baseReview({
  date,
  sport,
  finalAnswer,
  changeMindLedger,
  trustFirewall,
  portfolioRisk,
  openAiKeyDiagnostic,
  runRequested,
  model,
  now
}: {
  date: string;
  sport: Sport;
  finalAnswer: DecisionFinalAnswerContract;
  changeMindLedger: DecisionChangeMindLedger;
  trustFirewall: DecisionTrustFirewall;
  portfolioRisk: DecisionPortfolioRisk;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  runRequested: boolean;
  model: string;
  now: Date;
}): DecisionFinalAnswerAIReview {
  const evidence = evidencePacket({ finalAnswer, changeMindLedger, trustFirewall, portfolioRisk });
  const fallback = deterministicFallback({ finalAnswer, changeMindLedger });
  const ready = openAiKeyDiagnostic.status === "ready-to-request" && finalAnswer.controls.canRequestAIReview;
  const status: DecisionFinalAnswerAIReviewStatus = ready ? (runRequested ? "ready-to-run" : "not-requested") : openAiKeyDiagnostic.runtime.keyPresent ? "blocked" : "not-configured";
  const reviewHash = stableHash({
    date,
    sport,
    status,
    finalAnswer: finalAnswer.answerHash,
    changeMind: changeMindLedger.ledgerHash,
    firewall: trustFirewall.firewallHash,
    portfolio: portfolioRisk.portfolioHash,
    fallback
  });

  return {
    mode: "decision-final-answer-ai-review",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    reviewHash,
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
    target: finalAnswer.target,
    deterministicFallback: fallback,
    review: null,
    appliedReview: fallback,
    evidencePacket: evidence,
    controls: {
      canInspectReadOnly: true,
      canRequestOpenAI: ready,
      requiresExplicitRunParam: true,
      canApplyAI: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/final-answer-ai-review",
      "/api/sports/decision/final-answer-contract",
      "/api/sports/decision/change-mind-ledger",
      "/api/sports/decision/trust-firewall",
      "/api/sports/decision/portfolio-risk",
      "/api/sports/decision/openai-key-diagnostic"
    ]),
    locks: [
      "Final-answer AI review requires explicit run=1 before any OpenAI request.",
      "AI review cannot upgrade avoid to monitor or monitor to a pick.",
      "AI review cannot persist, publish, train, stake, print secrets, or expose hidden chain-of-thought.",
      "Only supplied public evidence IDs may be cited."
    ]
  };
}

function withResult({
  base,
  status,
  provider,
  result,
  reason,
  model
}: {
  base: DecisionFinalAnswerAIReview;
  status: DecisionFinalAnswerAIReviewStatus;
  provider: DecisionFinalAnswerAIReviewProvider;
  result: DecisionFinalAnswerAIReviewResult;
  reason: string | null;
  model: string | null;
}): DecisionFinalAnswerAIReview {
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

export async function runDecisionFinalAnswerAIReview({
  date,
  sport,
  finalAnswer,
  changeMindLedger,
  trustFirewall,
  portfolioRisk,
  openAiKeyDiagnostic,
  runRequested = false,
  apiKey = process.env.OPENAI_API_KEY,
  model = getDecisionOpenAIModel(),
  fetchImpl = fetch,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  finalAnswer: DecisionFinalAnswerContract;
  changeMindLedger: DecisionChangeMindLedger;
  trustFirewall: DecisionTrustFirewall;
  portfolioRisk: DecisionPortfolioRisk;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  runRequested?: boolean;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  now?: Date;
}): Promise<DecisionFinalAnswerAIReview> {
  const base = baseReview({
    date,
    sport,
    finalAnswer,
    changeMindLedger,
    trustFirewall,
    portfolioRisk,
    openAiKeyDiagnostic,
    runRequested,
    model,
    now
  });

  if (!runRequested) return base;
  if (!apiKey?.trim() || !base.controls.canRequestOpenAI) {
    return withResult({
      base,
      status: base.status === "not-configured" ? "not-configured" : "blocked",
      provider: "deterministic",
      result: base.deterministicFallback,
      reason: !apiKey?.trim() ? "OPENAI_API_KEY is not configured." : "Final-answer AI review is not safe to request yet.",
      model: null
    });
  }

  const payload = buildOpenAIFinalAnswerReviewPayload({
    finalAnswer,
    changeMindLedger,
    trustFirewall,
    portfolioRisk,
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
      const detail = await response.text().catch(() => "");
      const classified = classifyProviderError(response.status, detail);
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

    const parsed = safeParseFinalAnswerAIReview({
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
        reason: "OpenAI response did not match the final-answer review schema.",
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
      reason: "OpenAI final-answer review failed before a valid response was received.",
      model
    });
  }
}
