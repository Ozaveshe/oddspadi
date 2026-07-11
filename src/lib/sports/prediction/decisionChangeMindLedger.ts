import type { DecisionEngineActivationContract } from "@/lib/sports/prediction/decisionEngineActivationContract";
import type { DecisionFinalAnswerContract } from "@/lib/sports/prediction/decisionFinalAnswerContract";
import type { DecisionPortfolioRisk } from "@/lib/sports/prediction/decisionPortfolioRisk";
import type { DecisionTrustFirewall, DecisionTrustFirewallGateStatus } from "@/lib/sports/prediction/decisionTrustFirewall";
import type { Sport } from "@/lib/sports/types";

export type DecisionChangeMindStatus = "blocked" | "watching" | "shadow-ready";
export type DecisionChangeMindConditionStatus = "satisfied" | "watch" | "blocking";

export type DecisionChangeMindCondition = {
  id:
    | "portfolio-stress"
    | "storage-proof"
    | "provider-evidence"
    | "market-edge"
    | "model-trust"
    | "ai-review"
    | "settlement-learning";
  label: string;
  status: DecisionChangeMindConditionStatus;
  currentEvidence: string;
  requiredProof: string;
  verifyUrl: string;
  impact: string;
  evidence: string[];
};

export type DecisionChangeMindLedger = {
  mode: "decision-change-mind-ledger";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionChangeMindStatus;
  ledgerHash: string;
  summary: string;
  currentDecision: {
    publicAction: DecisionFinalAnswerContract["publicAnswer"]["action"];
    status: DecisionFinalAnswerContract["status"];
    target: DecisionFinalAnswerContract["target"];
    confidence: DecisionFinalAnswerContract["publicAnswer"]["confidence"];
  };
  nextFlip: {
    id: DecisionChangeMindCondition["id"];
    label: string;
    requiredProof: string;
    verifyUrl: string;
  } | null;
  flipConditions: DecisionChangeMindCondition[];
  guardrails: string[];
  controls: {
    canInspectReadOnly: true;
    canRequestAIReview: boolean;
    canDisplayMonitor: true;
    canDisplayAsPick: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
    canUpgradePublicAction: false;
    canUseHiddenChainOfThought: false;
  };
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

function compact(value: string | null | undefined, maxLength = 280): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No proof detail is available yet.";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 18): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function statusFromGate(status: DecisionTrustFirewallGateStatus | "pass" | "watch" | "block" | undefined): DecisionChangeMindConditionStatus {
  if (status === "pass") return "satisfied";
  if (status === "watch") return "watch";
  return "blocking";
}

function statusFromActivation(status: "pass" | "watch" | "block" | undefined): DecisionChangeMindConditionStatus {
  if (status === "pass") return "satisfied";
  if (status === "watch") return "watch";
  return "blocking";
}

function statusFor(conditions: DecisionChangeMindCondition[], finalAnswer: DecisionFinalAnswerContract): DecisionChangeMindStatus {
  if (conditions.some((item) => item.status === "blocking") || finalAnswer.status === "blocked") return "blocked";
  if (conditions.some((item) => item.status === "watch") || finalAnswer.status === "monitor") return "watching";
  return "shadow-ready";
}

function conditionRank(condition: DecisionChangeMindCondition): number {
  const statusRank = condition.status === "blocking" ? 0 : condition.status === "watch" ? 1 : 2;
  const idRank: Record<DecisionChangeMindCondition["id"], number> = {
    "portfolio-stress": 0,
    "storage-proof": 1,
    "provider-evidence": 2,
    "model-trust": 3,
    "market-edge": 4,
    "settlement-learning": 5,
    "ai-review": 6
  };
  return statusRank * 10 + idRank[condition.id];
}

function condition(input: DecisionChangeMindCondition): DecisionChangeMindCondition {
  return input;
}

export function buildDecisionChangeMindLedger({
  date,
  sport,
  finalAnswer,
  activationContract,
  trustFirewall,
  portfolioRisk,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  finalAnswer: DecisionFinalAnswerContract;
  activationContract: DecisionEngineActivationContract;
  trustFirewall: DecisionTrustFirewall;
  portfolioRisk: DecisionPortfolioRisk;
  now?: Date;
}): DecisionChangeMindLedger {
  const activationGate = (id: string) => activationContract.gates.find((gate) => gate.id === id) ?? null;
  const firewallGate = (id: string) => trustFirewall.gates.find((gate) => gate.id === id) ?? null;
  const storageGate = activationGate("storage-data");
  const fixtureGate = activationGate("fixture-context");
  const marketGate = firewallGate("market-edge");
  const modelGate = firewallGate("model-trust");
  const evidenceGate = firewallGate("evidence-freshness");
  const portfolioGate = firewallGate("portfolio-risk");
  const aiGate = firewallGate("ai-review");
  const settlementGate = firewallGate("settlement-learning");
  const largestDrawdown = Math.max(0, ...portfolioRisk.stressTests.map((scenario) => scenario.drawdownUnits));

  const flipConditions = [
    condition({
      id: "portfolio-stress",
      label: "Portfolio stress must stop failing",
      status: statusFromGate(portfolioGate?.status),
      currentEvidence: compact(portfolioGate?.detail ?? portfolioRisk.summary),
      requiredProof:
        portfolioGate?.nextAction ??
        "Reduce or exclude paper exposure until probability haircut, odds shortening, correlated-loss, and data-quality shock scenarios survive.",
      verifyUrl: "/api/sports/decision/portfolio-risk",
      impact: "A failed stress test keeps the final answer at avoid even when the raw model edge is positive.",
      evidence: unique([
        portfolioRisk.portfolioHash,
        `stressFailures:${portfolioRisk.stressTests.filter((scenario) => scenario.status === "fails").length}`,
        `stressReviews:${portfolioRisk.stressTests.filter((scenario) => scenario.status === "review").length}`,
        `paperUnits:${portfolioRisk.budget.suggestedPaperUnits}`,
        `maxDrawdown:${largestDrawdown}`,
        ...(portfolioGate?.evidence ?? [])
      ])
    }),
    condition({
      id: "storage-proof",
      label: "OddsPadi Supabase proof must clear",
      status: statusFromActivation(storageGate?.status),
      currentEvidence: compact(storageGate?.detail ?? activationContract.summary),
      requiredProof: storageGate?.nextAction ?? "Prove the OddsPadi Supabase schema, project scope, RLS posture, and write locks before provider persistence opens.",
      verifyUrl: storageGate?.proofUrl ?? "/api/sports/decision/data-backbone",
      impact: "Storage proof is the first backbone gate for provider writes, training labels, and durable decision memory.",
      evidence: unique([activationContract.contractHash, storageGate?.status, storageGate?.proofUrl, storageGate?.detail])
    }),
    condition({
      id: "provider-evidence",
      label: "Provider evidence must be fresh",
      status: evidenceGate?.status === "pass" && fixtureGate?.status === "pass" ? "satisfied" : evidenceGate?.status === "block" || fixtureGate?.status === "block" ? "blocking" : "watch",
      currentEvidence: compact(evidenceGate?.detail ?? fixtureGate?.detail ?? finalAnswer.riskReview.dataGaps[0]),
      requiredProof:
        evidenceGate?.nextAction ??
        fixtureGate?.nextAction ??
        "Connect and refresh fixtures, lineups, injuries, odds, news, weather, live scores, and match events before public trust rises.",
      verifyUrl: evidenceGate ? "/api/sports/decision/evidence-freshness-gate" : fixtureGate?.proofUrl ?? "/api/sports/decision/epl-pre-kickoff-rehearsal",
      impact: "This is where 2026 EPL fixtures, lineups, injuries, odds snapshots, and news/weather context become live evidence instead of rehearsal data.",
      evidence: unique([...(evidenceGate?.evidence ?? []), fixtureGate?.status, fixtureGate?.proofUrl, fixtureGate?.detail, ...finalAnswer.riskReview.dataGaps.slice(0, 4)])
    }),
    condition({
      id: "model-trust",
      label: "Model and backtest trust must clear",
      status: statusFromGate(modelGate?.status),
      currentEvidence: compact(modelGate?.detail),
      requiredProof:
        modelGate?.nextAction ??
        "Import historical rows, run shadow backtests, prove calibration, and keep learned weights locked until promotion thresholds pass.",
      verifyUrl: "/api/sports/decision/model-trust",
      impact: "The Poisson/Elo/efficiency models can compute today, but they cannot earn learned trust without historical backtest proof.",
      evidence: unique(modelGate?.evidence ?? [])
    }),
    condition({
      id: "market-edge",
      label: "Market edge must survive price movement",
      status: statusFromGate(marketGate?.status),
      currentEvidence: compact(marketGate?.detail ?? finalAnswer.modelView.whyModelFavorsIt),
      requiredProof: marketGate?.nextAction ?? "Refresh bookmaker odds, remove margin, and confirm the model edge remains positive after no-vig comparison.",
      verifyUrl: "/api/sports/decision/market-audit-matrix",
      impact: "A price move or sharper bookmaker line can erase value before kickoff.",
      evidence: unique(marketGate?.evidence ?? [])
    }),
    condition({
      id: "settlement-learning",
      label: "Outcome learning must remain shadow-only",
      status: statusFromGate(settlementGate?.status),
      currentEvidence: compact(settlementGate?.detail),
      requiredProof: settlementGate?.nextAction ?? "Wait for settled outcomes, closing odds, and calibration labels before promotion or training.",
      verifyUrl: "/api/sports/decision/settlement-impact",
      impact: "The engine needs settled outcomes before any learning loop can promote weights or claim calibration.",
      evidence: unique(settlementGate?.evidence ?? [])
    }),
    condition({
      id: "ai-review",
      label: "AI review may critique, not upgrade",
      status: statusFromGate(aiGate?.status),
      currentEvidence: compact(aiGate?.detail ?? finalAnswer.aiReview.status),
      requiredProof: aiGate?.nextAction ?? finalAnswer.aiReview.nextAction,
      verifyUrl: "/api/sports/decision/openai-key-diagnostic",
      impact: "OpenAI can explain, challenge, or downgrade the deterministic decision; it cannot turn avoid into a public pick.",
      evidence: unique(aiGate?.evidence ?? [finalAnswer.aiReview.status])
    })
  ].sort((a, b) => conditionRank(a) - conditionRank(b));

  const status = statusFor(flipConditions, finalAnswer);
  const nextFlipCondition = flipConditions.find((item) => item.status !== "satisfied") ?? null;
  const ledgerHash = stableHash({
    date,
    sport,
    status,
    finalAnswer: finalAnswer.answerHash,
    activation: activationContract.contractHash,
    firewall: trustFirewall.firewallHash,
    portfolio: portfolioRisk.portfolioHash,
    conditions: flipConditions.map((item) => [item.id, item.status, item.evidence])
  });

  return {
    mode: "decision-change-mind-ledger",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    ledgerHash,
    summary:
      status === "shadow-ready"
        ? "Change-mind ledger has no blocking condition, but public publish/stake controls remain locked."
        : status === "watching"
          ? `Change-mind ledger is watching ${flipConditions.filter((item) => item.status === "watch").length} unresolved condition(s) before confidence can rise.`
          : `Change-mind ledger is blocked by ${flipConditions.filter((item) => item.status === "blocking").length} condition(s); first flip is ${nextFlipCondition?.label ?? "proof refresh"}.`,
    currentDecision: {
      publicAction: finalAnswer.publicAnswer.action,
      status: finalAnswer.status,
      target: finalAnswer.target,
      confidence: finalAnswer.publicAnswer.confidence
    },
    nextFlip: nextFlipCondition
      ? {
          id: nextFlipCondition.id,
          label: nextFlipCondition.label,
          requiredProof: nextFlipCondition.requiredProof,
          verifyUrl: nextFlipCondition.verifyUrl
        }
      : null,
    flipConditions,
    guardrails: [
      "Positive EV alone cannot upgrade the public answer.",
      "A cleared OpenAI review cannot override storage, provider, model, market, portfolio, or settlement blockers.",
      "No condition can unlock staking, publishing, persistence, training, or hidden chain-of-thought from this ledger.",
      "The EPL 2026/27 opener can stay in rehearsal until provider-backed fixture, odds, lineup, injury, news, and weather evidence is fresh."
    ],
    controls: {
      canInspectReadOnly: true,
      canRequestAIReview: finalAnswer.controls.canRequestAIReview,
      canDisplayMonitor: true,
      canDisplayAsPick: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUpgradePublicAction: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/change-mind-ledger",
      "/api/sports/decision/final-answer-contract",
      "/api/sports/decision/portfolio-risk",
      "/api/sports/decision/trust-firewall",
      "/api/sports/decision/engine-activation-contract",
      ...flipConditions.map((item) => item.verifyUrl)
    ])
  };
}
