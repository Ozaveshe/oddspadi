import type { DecisionAnswerPromotionGate } from "@/lib/sports/prediction/decisionAnswerPromotionGate";
import type { DecisionMarketCalibratedFusion } from "@/lib/sports/prediction/decisionMarketCalibratedFusion";
import type { DecisionMarketPriorGovernor } from "@/lib/sports/prediction/decisionMarketPriorGovernor";
import type { DecisionTrustAwareAIPacket } from "@/lib/sports/prediction/decisionTrustAwareAIPacket";
import type { PublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";
import type { Sport } from "@/lib/sports/types";

export type DecisionHistoricalDisciplineStatus =
  | "market-prior-enforced"
  | "provider-retest-ready"
  | "history-diagnostic-only"
  | "waiting-history"
  | "unsafe";

export type DecisionHistoricalDisciplineRule = {
  id:
    | "public-history-present"
    | "market-prior-governed"
    | "fusion-capped"
    | "promotion-blocked"
    | "ai-instruction-locked"
    | "side-effects-locked";
  label: string;
  status: "pass" | "watch" | "block";
  evidence: string;
  requiredAction: string;
  proofUrl: string;
};

export type DecisionHistoricalDisciplineReceipt = {
  mode: "decision-historical-discipline-receipt";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionHistoricalDisciplineStatus;
  disciplineHash: string;
  summary: string;
  chain: {
    publicHistory: {
      status: PublicHistoricalTrainingEvidence["status"] | null;
      diagnosticScore: number | null;
      fixtures: number;
      oddsRows: number;
      bookmakerMarkets: number;
      benchmarkVerdict: PublicHistoricalTrainingEvidence["scorecard"]["benchmarkVerdict"] | null;
    };
    marketPrior: {
      status: DecisionMarketPriorGovernor["status"];
      action: DecisionMarketPriorGovernor["action"];
      cappedCandidates: number;
    };
    fusion: {
      status: DecisionMarketCalibratedFusion["status"];
      action: DecisionMarketCalibratedFusion["action"];
      marketCapped: number;
      shadowValue: number;
    };
    promotion: {
      status: DecisionAnswerPromotionGate["status"];
      marketCalibrationStatus: "pass" | "watch" | "block" | null;
      nextBlockingCheck: string | null;
    };
    aiPacket: {
      status: DecisionTrustAwareAIPacket["status"];
      hasPublicHistoricalEvidence: boolean;
      publicInstruction: string | null;
    };
  };
  rules: DecisionHistoricalDisciplineRule[];
  nextAction: {
    label: string;
    verifyUrl: string;
    expectedEvidence: string;
  };
  controls: {
    canInspectReadOnly: true;
    canUseAsAiEvidence: boolean;
    canMutateProbabilities: false;
    canPersistDecision: false;
    canPersistTrainingRows: false;
    canApplyLearnedWeights: false;
    canTrainModels: false;
    canPublishPicks: false;
    canStake: false;
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

function unique(values: Array<string | null | undefined>, limit = 64): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function rule(input: DecisionHistoricalDisciplineRule): DecisionHistoricalDisciplineRule {
  return input;
}

function statusFor({
  publicHistoricalTrainingEvidence,
  marketPriorGovernor,
  marketCalibratedFusion,
  answerPromotionGate,
  trustAwareAIPacket
}: {
  publicHistoricalTrainingEvidence: PublicHistoricalTrainingEvidence | null;
  marketPriorGovernor: DecisionMarketPriorGovernor;
  marketCalibratedFusion: DecisionMarketCalibratedFusion;
  answerPromotionGate: DecisionAnswerPromotionGate;
  trustAwareAIPacket: DecisionTrustAwareAIPacket;
}): DecisionHistoricalDisciplineStatus {
  if (!publicHistoricalTrainingEvidence) return "waiting-history";
  if (publicHistoricalTrainingEvidence.status === "provider-retest-ready") return "provider-retest-ready";
  if (publicHistoricalTrainingEvidence.status !== "market-prior-dominant") return "history-diagnostic-only";
  const publicInstruction = trustAwareAIPacket.requestPreview.input.publicHistoricalEvidence?.instruction ?? "";
  const marketCalibration = answerPromotionGate.checks.find((check) => check.id === "market-calibration") ?? null;
  const enforced =
    marketPriorGovernor.action === "defer-to-market-prior" &&
    marketCalibratedFusion.action === "defer-to-market-prior" &&
    marketCalibration?.status === "block" &&
    answerPromotionGate.status === "blocked" &&
    publicInstruction.toLowerCase().includes("market prior dominates") &&
    !answerPromotionGate.controls.canPublish &&
    !answerPromotionGate.controls.canStake &&
    !answerPromotionGate.controls.canTrain &&
    !trustAwareAIPacket.controls.canApplyAIOutput;
  return enforced ? "market-prior-enforced" : "unsafe";
}

function summaryFor(status: DecisionHistoricalDisciplineStatus, evidence: PublicHistoricalTrainingEvidence | null): string {
  if (status === "market-prior-enforced") {
    return `Historical discipline is enforced: ${evidence?.scorecard.fixtures.toLocaleString() ?? 0} public EPL fixtures say market prior dominates, so raw model-edge promotion is blocked.`;
  }
  if (status === "provider-retest-ready") return "Historical discipline is ready for provider-enriched retest, but promotion, training, publishing, and staking remain locked.";
  if (status === "history-diagnostic-only") return "Historical evidence is attached as diagnostic context only; provider-enriched proof is still required before promotion.";
  if (status === "waiting-history") return "Historical discipline is waiting for public-history evidence before it can audit model-vs-market behavior.";
  return "Historical discipline is unsafe: market-prior evidence is present but one or more promotion/AI locks did not enforce it.";
}

export function buildDecisionHistoricalDisciplineReceipt({
  date,
  sport,
  publicHistoricalTrainingEvidence = null,
  marketPriorGovernor,
  marketCalibratedFusion,
  answerPromotionGate,
  trustAwareAIPacket,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  publicHistoricalTrainingEvidence?: PublicHistoricalTrainingEvidence | null;
  marketPriorGovernor: DecisionMarketPriorGovernor;
  marketCalibratedFusion: DecisionMarketCalibratedFusion;
  answerPromotionGate: DecisionAnswerPromotionGate;
  trustAwareAIPacket: DecisionTrustAwareAIPacket;
  now?: Date;
}): DecisionHistoricalDisciplineReceipt {
  const marketCalibration = answerPromotionGate.checks.find((check) => check.id === "market-calibration") ?? null;
  const publicInstruction = trustAwareAIPacket.requestPreview.input.publicHistoricalEvidence?.instruction ?? null;
  const status = statusFor({
    publicHistoricalTrainingEvidence,
    marketPriorGovernor,
    marketCalibratedFusion,
    answerPromotionGate,
    trustAwareAIPacket
  });
  const rules = [
    rule({
      id: "public-history-present",
      label: "Public history present",
      status: publicHistoricalTrainingEvidence ? "pass" : "block",
      evidence: publicHistoricalTrainingEvidence
        ? `${publicHistoricalTrainingEvidence.scorecard.fixtures.toLocaleString()} fixtures, ${publicHistoricalTrainingEvidence.scorecard.oddsRows.toLocaleString()} odds rows, ${publicHistoricalTrainingEvidence.scorecard.bookmakerMarkets.toLocaleString()} bookmaker markets; ${publicHistoricalTrainingEvidence.status}.`
        : "No public historical training evidence attached.",
      requiredAction: "Attach public-historical-training-evidence before historical discipline can be audited.",
      proofUrl: "/api/sports/decision/training/public-historical-training-evidence"
    }),
    rule({
      id: "market-prior-governed",
      label: "Market prior governed",
      status: marketPriorGovernor.action === "defer-to-market-prior" ? "pass" : marketPriorGovernor.action === "run-market-benchmark" ? "watch" : "block",
      evidence: `${marketPriorGovernor.status}; action ${marketPriorGovernor.action}; capped ${marketPriorGovernor.fusionImpact.candidatesCappedByHistoricalBenchmark} candidate(s).`,
      requiredAction: "When public history says market beats model, governor action must defer to market prior.",
      proofUrl: "/api/sports/decision/market-prior-governor"
    }),
    rule({
      id: "fusion-capped",
      label: "Fusion capped",
      status: marketCalibratedFusion.action === "defer-to-market-prior" ? "pass" : marketCalibratedFusion.action === "run-market-benchmark" ? "watch" : "block",
      evidence: `${marketCalibratedFusion.status}; action ${marketCalibratedFusion.action}; market-capped ${marketCalibratedFusion.totals.marketCapped}; shadow-value ${marketCalibratedFusion.totals.shadowValue}.`,
      requiredAction: "Market-calibrated fusion must cap raw value candidates while market-prior dominance holds.",
      proofUrl: "/api/sports/decision/market-calibrated-fusion"
    }),
    rule({
      id: "promotion-blocked",
      label: "Promotion blocked",
      status: answerPromotionGate.status === "blocked" && marketCalibration?.status === "block" ? "pass" : "block",
      evidence: `${answerPromotionGate.status}; market calibration ${marketCalibration?.status ?? "missing"}; next blocker ${answerPromotionGate.nextBlockingCheck?.id ?? "none"}.`,
      requiredAction: "Answer promotion must stay blocked until provider-enriched retests beat market consensus.",
      proofUrl: "/api/sports/decision/answer-promotion-gate"
    }),
    rule({
      id: "ai-instruction-locked",
      label: "AI instruction locked",
      status: publicInstruction?.toLowerCase().includes("market prior dominates") ? "pass" : publicInstruction ? "watch" : "block",
      evidence: publicInstruction ?? "Public historical instruction missing from AI packet.",
      requiredAction: "Trust-aware AI packet must explicitly block raw model-edge promotion while market prior dominates.",
      proofUrl: "/api/sports/decision/trust-aware-ai-packet"
    }),
    rule({
      id: "side-effects-locked",
      label: "Side effects locked",
      status:
        !answerPromotionGate.controls.canPublish &&
        !answerPromotionGate.controls.canStake &&
        !answerPromotionGate.controls.canTrain &&
        !trustAwareAIPacket.controls.canApplyAIOutput
          ? "pass"
          : "block",
      evidence: `publish=${answerPromotionGate.controls.canPublish}; stake=${answerPromotionGate.controls.canStake}; train=${answerPromotionGate.controls.canTrain}; applyAI=${trustAwareAIPacket.controls.canApplyAIOutput}.`,
      requiredAction: "Keep publishing, staking, training, persistence, and AI output application locked.",
      proofUrl: "/api/sports/decision/engine-activation-contract"
    })
  ];
  const chain: DecisionHistoricalDisciplineReceipt["chain"] = {
    publicHistory: {
      status: publicHistoricalTrainingEvidence?.status ?? null,
      diagnosticScore: publicHistoricalTrainingEvidence?.diagnosticScore ?? null,
      fixtures: publicHistoricalTrainingEvidence?.scorecard.fixtures ?? 0,
      oddsRows: publicHistoricalTrainingEvidence?.scorecard.oddsRows ?? 0,
      bookmakerMarkets: publicHistoricalTrainingEvidence?.scorecard.bookmakerMarkets ?? 0,
      benchmarkVerdict: publicHistoricalTrainingEvidence?.scorecard.benchmarkVerdict ?? null
    },
    marketPrior: {
      status: marketPriorGovernor.status,
      action: marketPriorGovernor.action,
      cappedCandidates: marketPriorGovernor.fusionImpact.candidatesCappedByHistoricalBenchmark
    },
    fusion: {
      status: marketCalibratedFusion.status,
      action: marketCalibratedFusion.action,
      marketCapped: marketCalibratedFusion.totals.marketCapped,
      shadowValue: marketCalibratedFusion.totals.shadowValue
    },
    promotion: {
      status: answerPromotionGate.status,
      marketCalibrationStatus: marketCalibration?.status ?? null,
      nextBlockingCheck: answerPromotionGate.nextBlockingCheck?.id ?? null
    },
    aiPacket: {
      status: trustAwareAIPacket.status,
      hasPublicHistoricalEvidence: Boolean(trustAwareAIPacket.requestPreview.input.publicHistoricalEvidence),
      publicInstruction
    }
  };

  return {
    mode: "decision-historical-discipline-receipt",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    disciplineHash: stableHash({
      date,
      sport,
      status,
      chain,
      rules: rules.map((item) => [item.id, item.status])
    }),
    summary: summaryFor(status, publicHistoricalTrainingEvidence),
    chain,
    rules,
    nextAction: {
      label:
        status === "market-prior-enforced"
          ? "Run provider-enriched retest before promotion"
          : status === "waiting-history"
            ? "Attach public historical evidence"
            : "Keep historical discipline under review",
      verifyUrl:
        status === "waiting-history"
          ? "/api/sports/decision/training/public-historical-training-evidence"
          : "/api/sports/decision/historical-discipline?historical=1&publicHistory=1",
      expectedEvidence:
        status === "market-prior-enforced"
          ? "Provider-enriched benchmark proves model beats no-vig market consensus before any raw model edge can be promoted."
          : "Historical discipline receipt returns pass/watch/block rules with side effects locked."
    },
    controls: {
      canInspectReadOnly: true,
      canUseAsAiEvidence: status === "market-prior-enforced" || status === "provider-retest-ready" || status === "history-diagnostic-only",
      canMutateProbabilities: false,
      canPersistDecision: false,
      canPersistTrainingRows: false,
      canApplyLearnedWeights: false,
      canTrainModels: false,
      canPublishPicks: false,
      canStake: false
    },
    proofUrls: unique([
      "/api/sports/decision/historical-discipline",
      "/api/sports/decision/training/public-historical-training-evidence",
      "/api/sports/decision/market-prior-governor",
      "/api/sports/decision/market-calibrated-fusion",
      "/api/sports/decision/answer-promotion-gate",
      ...answerPromotionGate.proofUrls,
      "/api/sports/decision/trust-aware-ai-packet",
      ...publicHistoricalTrainingEvidence?.proofUrls ?? [],
      ...marketPriorGovernor.proofUrls,
      ...marketCalibratedFusion.proofUrls,
      ...trustAwareAIPacket.proofUrls
    ]),
    locks: [
      "Historical discipline is read-only and cannot mutate probabilities, persist decisions, write training rows, train models, apply learned weights, publish picks, or stake.",
      "Market-prior dominance blocks raw model-edge promotion until provider-enriched retest proof beats no-vig market consensus.",
      "Trust-aware AI may cite this receipt as evidence, but it cannot upgrade the deterministic action or trust ceiling."
    ]
  };
}
