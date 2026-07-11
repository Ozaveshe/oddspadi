import type { DecisionAbstentionAudit } from "@/lib/sports/prediction/decisionAbstentionAudit";
import type { DecisionFinalAnswerContract } from "@/lib/sports/prediction/decisionFinalAnswerContract";
import type { DecisionHistoricalDisciplineReceipt } from "@/lib/sports/prediction/decisionHistoricalDisciplineReceipt";
import type { DecisionMarketAlternativeArbiter } from "@/lib/sports/prediction/decisionMarketAlternativeArbiter";
import type { DecisionTrustAwareAIPacket } from "@/lib/sports/prediction/decisionTrustAwareAIPacket";
import type { Sport } from "@/lib/sports/types";

export type DecisionDisciplineExplanationStatus = "monitor-only" | "avoid-only" | "waiting-evidence" | "blocked";

export type DecisionDisciplineExplanation = {
  mode: "decision-discipline-explanation";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionDisciplineExplanationStatus;
  explanationHash: string;
  summary: string;
  target: {
    matchId: string | null;
    match: string | null;
    league: string | null;
    market: string | null;
    selection: string | null;
    publicAction: DecisionFinalAnswerContract["publicAnswer"]["action"];
  };
  explanation: {
    modelCase: string[];
    whyNotPick: string[];
    risks: string[];
    newsOrProviderSignalsNeeded: string[];
    saferAlternatives: string[];
    historicalDiscipline: string[];
    publicCopy: {
      headline: string;
      body: string;
      footer: string;
    };
  };
  aiInstruction: {
    canAskAI: boolean;
    allowedOutputs: string[];
    instruction: string;
  };
  evidenceIds: string[];
  controls: {
    canInspectReadOnly: true;
    canShowPublicExplanation: true;
    canDisplayAsPick: false;
    canPublishPick: false;
    canStake: false;
    canTrain: false;
    canPersist: false;
    canUseHiddenChainOfThought: false;
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

function compact(value: string | null | undefined, maxLength = 280): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 16): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalized = compact(value);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
    if (output.length >= limit) break;
  }
  return output;
}

function statusFor(finalAnswer: DecisionFinalAnswerContract, historicalDiscipline: DecisionHistoricalDisciplineReceipt | null): DecisionDisciplineExplanationStatus {
  if (finalAnswer.status === "blocked" || historicalDiscipline?.status === "unsafe") return "blocked";
  if (finalAnswer.publicAnswer.action === "avoid") return "avoid-only";
  if (historicalDiscipline?.status === "waiting-history") return "waiting-evidence";
  return "monitor-only";
}

function historicalNotes(historicalDiscipline: DecisionHistoricalDisciplineReceipt | null): string[] {
  if (!historicalDiscipline) {
    return ["Historical discipline is not attached to this explanation; use the public-history route before treating any edge as learned evidence."];
  }
  return unique(
    [
      historicalDiscipline.summary,
      `Market prior action: ${historicalDiscipline.chain.marketPrior.action}.`,
      `Fusion action: ${historicalDiscipline.chain.fusion.action}.`,
      `Promotion status: ${historicalDiscipline.chain.promotion.status}; market calibration ${historicalDiscipline.chain.promotion.marketCalibrationStatus ?? "missing"}.`,
      historicalDiscipline.chain.aiPacket.publicInstruction
    ],
    6
  );
}

function saferAlternatives({
  finalAnswer,
  abstentionAudit,
  marketAlternativeArbiter
}: {
  finalAnswer: DecisionFinalAnswerContract;
  abstentionAudit: DecisionAbstentionAudit;
  marketAlternativeArbiter: DecisionMarketAlternativeArbiter;
}): string[] {
  const pricedOrDerived = marketAlternativeArbiter.topCandidate?.alternatives.map((alternative) =>
    compact(`${alternative.marketName}: ${alternative.selection} (${alternative.status}) - ${alternative.rationale}`, 220)
  );
  return unique(
    [
      ...(pricedOrDerived ?? []),
      ...(abstentionAudit.topCandidate?.saferAlternatives ?? []),
      ...finalAnswer.alternatives.map((alternative) => `${alternative.market}: ${alternative.selection} - ${alternative.rationale}`)
    ],
    8
  );
}

export function buildDecisionDisciplineExplanation({
  date,
  sport,
  finalAnswer,
  abstentionAudit,
  marketAlternativeArbiter,
  trustAwareAIPacket,
  historicalDiscipline = null,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  finalAnswer: DecisionFinalAnswerContract;
  abstentionAudit: DecisionAbstentionAudit;
  marketAlternativeArbiter: DecisionMarketAlternativeArbiter;
  trustAwareAIPacket: DecisionTrustAwareAIPacket;
  historicalDiscipline?: DecisionHistoricalDisciplineReceipt | null;
  now?: Date;
}): DecisionDisciplineExplanation {
  const status = statusFor(finalAnswer, historicalDiscipline);
  const target = {
    ...finalAnswer.target,
    publicAction: finalAnswer.publicAnswer.action
  };
  const modelCase = unique(
    [
      finalAnswer.modelView.whyModelFavorsIt,
      finalAnswer.modelView.edge !== null ? `Model edge ${finalAnswer.modelView.edge}; EV ${finalAnswer.modelView.expectedValue ?? "unknown"}.` : null,
      abstentionAudit.topCandidate?.whyModelLikesIt,
      marketAlternativeArbiter.topCandidate?.rationale
    ],
    6
  );
  const whyNotPick = unique(
    [
      finalAnswer.publicAnswer.explanation,
      finalAnswer.abstentionGuard.whyAvoidOrWait,
      abstentionAudit.topCandidate?.whyAvoidOrWait,
      historicalDiscipline?.summary,
      ...finalAnswer.riskReview.requiredBeforeUpgrade
    ],
    8
  );
  const risks = unique(
    [
      finalAnswer.riskReview.primaryRisk,
      finalAnswer.riskReview.avoidReason,
      ...finalAnswer.riskReview.newsOrContextRisks,
      ...(abstentionAudit.topCandidate?.risks ?? []),
      ...(marketAlternativeArbiter.topCandidate?.risks ?? [])
    ],
    8
  );
  const newsOrProviderSignalsNeeded = unique(
    [
      ...finalAnswer.abstentionGuard.missingEvidence,
      ...(abstentionAudit.topCandidate?.missingEvidence ?? []),
      ...finalAnswer.riskReview.dataGaps,
      trustAwareAIPacket.evidence.items.find((item) => item.status !== "support")?.detail
    ],
    8
  );
  const alternatives = saferAlternatives({ finalAnswer, abstentionAudit, marketAlternativeArbiter });
  const historicalDisciplineNotes = historicalNotes(historicalDiscipline);
  const allowedOutputs = trustAwareAIPacket.requestPreview.responseContract.allowedVerdicts.map((verdict) => String(verdict));
  const instruction =
    trustAwareAIPacket.requestPreview.input.publicHistoricalEvidence?.instruction ??
    "AI can summarize evidence and risks, but cannot upgrade monitor/avoid into a public pick.";
  const explanationHash = stableHash({
    status,
    target,
    modelCase,
    whyNotPick,
    risks,
    newsOrProviderSignalsNeeded,
    alternatives,
    historicalDisciplineNotes
  });

  return {
    mode: "decision-discipline-explanation",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    explanationHash,
    summary:
      status === "monitor-only"
        ? "Decision explanation is ready for monitor-only display: the model case can be shown, but public picks, staking, training, and persistence stay locked."
        : status === "avoid-only"
          ? "Decision explanation says avoid forcing the bet; evidence, pricing, or historical discipline does not support a public pick."
          : status === "waiting-evidence"
            ? "Decision explanation is waiting for historical/provider evidence before even monitor language should be trusted."
            : "Decision explanation is blocked because one or more discipline locks failed.",
    target,
    explanation: {
      modelCase,
      whyNotPick,
      risks,
      newsOrProviderSignalsNeeded,
      saferAlternatives: alternatives.length ? alternatives : ["No safer alternative is priced well enough yet; wait for odds, lineup, injury, and news updates."],
      historicalDiscipline: historicalDisciplineNotes,
      publicCopy: {
        headline: finalAnswer.publicAnswer.headline,
        body: unique([finalAnswer.publicAnswer.explanation, finalAnswer.abstentionGuard.whyAvoidOrWait, historicalDiscipline?.summary], 3).join(" "),
        footer: "This is analysis-only. OddsPadi cannot publish a pick, stake, train, or persist a decision until provider data, market calibration, and promotion gates clear."
      }
    },
    aiInstruction: {
      canAskAI: trustAwareAIPacket.controls.canSubmitToOpenAI,
      allowedOutputs,
      instruction
    },
    evidenceIds: unique(
      [
        finalAnswer.answerHash,
        abstentionAudit.auditHash,
        marketAlternativeArbiter.arbiterHash,
        trustAwareAIPacket.packetHash,
        historicalDiscipline?.disciplineHash
      ],
      10
    ),
    controls: {
      canInspectReadOnly: true,
      canShowPublicExplanation: true,
      canDisplayAsPick: false,
      canPublishPick: false,
      canStake: false,
      canTrain: false,
      canPersist: false,
      canUseHiddenChainOfThought: false
    },
    proofUrls: unique([
      "/api/sports/decision/discipline-explanation",
      "/api/sports/decision/final-answer-contract",
      "/api/sports/decision/abstention-audit",
      "/api/sports/decision/market-alternative-arbiter",
      "/api/sports/decision/trust-aware-ai-packet",
      historicalDiscipline ? "/api/sports/decision/historical-discipline" : null,
      ...finalAnswer.proofUrls,
      ...abstentionAudit.proofUrls,
      ...marketAlternativeArbiter.proofUrls,
      ...trustAwareAIPacket.proofUrls,
      ...(historicalDiscipline?.proofUrls ?? [])
    ], 64),
    locks: unique([
      "Discipline explanation can be displayed as read-only analysis, not as a betting recommendation.",
      "No hidden chain-of-thought is exposed; only evidence, risks, actions, and public-safe rationale are returned.",
      "AI output cannot override abstention, historical discipline, market calibration, or promotion gates.",
      ...finalAnswer.locks,
      ...abstentionAudit.locks,
      ...marketAlternativeArbiter.locks,
      ...trustAwareAIPacket.locks,
      ...(historicalDiscipline?.locks ?? [])
    ])
  };
}
