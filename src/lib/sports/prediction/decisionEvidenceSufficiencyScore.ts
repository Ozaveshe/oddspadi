import type { DecisionAbstentionAudit } from "@/lib/sports/prediction/decisionAbstentionAudit";
import type { DecisionAnswerPromotionGate } from "@/lib/sports/prediction/decisionAnswerPromotionGate";
import type { DecisionEplPreKickoffRehearsal } from "@/lib/sports/prediction/decisionEplPreKickoffRehearsal";
import type { DecisionFinalAnswerContract } from "@/lib/sports/prediction/decisionFinalAnswerContract";
import type { DecisionLiveDataReadiness } from "@/lib/sports/prediction/decisionLiveDataReadiness";
import type { DecisionMarketCalibratedFusion } from "@/lib/sports/prediction/decisionMarketCalibratedFusion";
import type { DecisionModelMathProof } from "@/lib/sports/prediction/decisionModelMathProof";
import type { Sport } from "@/lib/sports/types";

export type DecisionEvidenceSufficiencyStatus = "sufficient-shadow" | "insufficient-data" | "action-blocked" | "blocked";
export type DecisionEvidenceSufficiencyCheckStatus = "pass" | "watch" | "block";

export type DecisionEvidenceSufficiencyCheck = {
  id:
    | "live-data"
    | "provider-feeds"
    | "model-math"
    | "market-calibration"
    | "abstention"
    | "promotion"
    | "epl-2026";
  label: string;
  status: DecisionEvidenceSufficiencyCheckStatus;
  score: number;
  weight: number;
  evidence: string;
  blocker: string | null;
  nextAction: string;
  proofUrl: string;
};

export type DecisionEvidenceSufficiencyScore = {
  mode: "decision-evidence-sufficiency-score";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionEvidenceSufficiencyStatus;
  scoreHash: string;
  summary: string;
  score: {
    total: number;
    data: number;
    model: number;
    market: number;
    safety: number;
    eplReadiness: number;
  };
  target: {
    matchId: string | null;
    match: string | null;
    selection: string | null;
    publicAction: DecisionFinalAnswerContract["publicAnswer"]["action"];
    publicPickAllowed: false;
  };
  topBlockers: string[];
  checks: DecisionEvidenceSufficiencyCheck[];
  nextAction: {
    label: string;
    proofUrl: string;
    expectedEvidence: string;
    safeToRun: true;
  };
  controls: {
    canInspectReadOnly: true;
    canUseForAiPrompt: true;
    canApplyToLiveDecision: false;
    canWriteProviderRows: false;
    canPersistDecisions: false;
    canTrainModels: false;
    canApplyLearnedWeights: false;
    canPublishPicks: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
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

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function unique(values: Array<string | null | undefined>, limit = 10): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function weightedScore(checks: DecisionEvidenceSufficiencyCheck[]): number {
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  if (totalWeight <= 0) return 0;
  return clamp(checks.reduce((sum, check) => sum + check.score * check.weight, 0) / totalWeight);
}

function statusFor(score: number, checks: DecisionEvidenceSufficiencyCheck[], finalAnswer: DecisionFinalAnswerContract): DecisionEvidenceSufficiencyStatus {
  if (checks.some((check) => check.id === "promotion" && check.status === "block") || finalAnswer.status === "blocked") return "blocked";
  if (finalAnswer.publicAnswer.action === "avoid" || checks.some((check) => check.id === "abstention" && check.status === "block")) return "action-blocked";
  if (score >= 74 && checks.every((check) => check.status !== "block")) return "sufficient-shadow";
  return "insufficient-data";
}

function checkClass(score: number, forcedBlock = false): DecisionEvidenceSufficiencyCheckStatus {
  if (forcedBlock) return "block";
  if (score >= 72) return "pass";
  if (score >= 38) return "watch";
  return "block";
}

function buildChecks({
  liveDataReadiness,
  modelMathProof,
  marketCalibratedFusion,
  abstentionAudit,
  finalAnswer,
  answerPromotionGate,
  eplPreKickoffRehearsal
}: {
  liveDataReadiness: DecisionLiveDataReadiness;
  modelMathProof: DecisionModelMathProof;
  marketCalibratedFusion: DecisionMarketCalibratedFusion;
  abstentionAudit: DecisionAbstentionAudit;
  finalAnswer: DecisionFinalAnswerContract;
  answerPromotionGate: DecisionAnswerPromotionGate;
  eplPreKickoffRehearsal: DecisionEplPreKickoffRehearsal;
}): DecisionEvidenceSufficiencyCheck[] {
  const liveDataScore = clamp(
    (liveDataReadiness.totals.liveTables / Math.max(1, liveDataReadiness.totals.expectedTables)) * 34 +
      (liveDataReadiness.totals.populatedTables / Math.max(1, liveDataReadiness.totals.expectedTables)) * 36 +
      (liveDataReadiness.totals.providerBackedFeeds / Math.max(1, liveDataReadiness.totals.providerBackedFeeds + liveDataReadiness.totals.missingFeeds)) * 30
  );
  const providerScore = clamp(
    (liveDataReadiness.totals.providerBackedFeeds / Math.max(1, liveDataReadiness.totals.providerBackedFeeds + liveDataReadiness.totals.dryRunReadyFeeds + liveDataReadiness.totals.missingFeeds)) * 100
  );
  const modelScore = modelMathProof.status === "ready-proof" ? 90 : modelMathProof.status === "needs-provider" ? 58 : 15;
  const marketScore =
    marketCalibratedFusion.status === "ready-shadow"
      ? 76
      : marketCalibratedFusion.status === "waiting-benchmark"
        ? 34
        : 18;
  const abstentionScore =
    abstentionAudit.status === "monitor-only"
      ? 62
      : abstentionAudit.status === "ready-shadow"
        ? 50
        : abstentionAudit.status === "action-blocked"
          ? 30
          : 12;
  const promotionScore =
    answerPromotionGate.status === "monitor-eligible"
      ? 74
      : answerPromotionGate.status === "watch-only"
        ? 45
        : 12;
  const eplScore = clamp(
    (eplPreKickoffRehearsal.totals.readyReadOnly / Math.max(1, eplPreKickoffRehearsal.totals.openingFixtures)) * 60 +
      (eplPreKickoffRehearsal.totals.openingFixtures > 0 ? 20 : 0) +
      (eplPreKickoffRehearsal.controls.canRunFixtureDryRun || eplPreKickoffRehearsal.controls.canRunOddsDryRun ? 20 : 0)
  );

  return [
    {
      id: "live-data",
      label: "Live data rows",
      status: checkClass(liveDataScore, liveDataReadiness.totals.rows === 0),
      score: liveDataScore,
      weight: 20,
      evidence: `${liveDataReadiness.totals.liveTables}/${liveDataReadiness.totals.expectedTables} tables live; ${liveDataReadiness.totals.populatedTables} populated; ${liveDataReadiness.totals.rows} stored row(s).`,
      blocker: liveDataReadiness.totals.rows === 0 ? "No stored provider rows are available for live or training trust." : null,
      nextAction: liveDataReadiness.trainingGate.reason,
      proofUrl: "/api/sports/decision/live-data-readiness"
    },
    {
      id: "provider-feeds",
      label: "Provider feed coverage",
      status: checkClass(providerScore, liveDataReadiness.totals.missingFeeds > 0),
      score: providerScore,
      weight: 16,
      evidence: `${liveDataReadiness.totals.providerBackedFeeds} provider-backed feed(s), ${liveDataReadiness.totals.dryRunReadyFeeds} dry-run feed(s), ${liveDataReadiness.totals.missingFeeds} missing feed(s).`,
      blocker: liveDataReadiness.totals.missingFeeds > 0 ? `${liveDataReadiness.totals.missingFeeds} required feed(s) still lack provider evidence.` : null,
      nextAction: liveDataReadiness.nextFamily?.nextAction ?? "Keep provider feed evidence source-stamped.",
      proofUrl: "/api/sports/decision/provider-evidence-ledger"
    },
    {
      id: "model-math",
      label: "Model math",
      status: checkClass(modelScore, modelMathProof.status === "blocked"),
      score: modelScore,
      weight: 15,
      evidence: `${modelMathProof.totals.formulas} formula(s), ${modelMathProof.totals.modelVersions} model version(s), ${modelMathProof.totals.normalizedWinnerMarkets}/${modelMathProof.totals.matches} normalized winner market(s).`,
      blocker: modelMathProof.status === "blocked" ? modelMathProof.summary : modelMathProof.status === "needs-provider" ? "Model math is inspectable but still depends on proxy or missing provider inputs." : null,
      nextAction: modelMathProof.locks[1] ?? "Keep model math proof attached to every promoted answer.",
      proofUrl: "/api/sports/decision/model-math-proof"
    },
    {
      id: "market-calibration",
      label: "Market calibration",
      status: checkClass(marketScore, marketCalibratedFusion.status !== "ready-shadow"),
      score: marketScore,
      weight: 14,
      evidence: `${marketCalibratedFusion.status}; benchmark rows ${marketCalibratedFusion.benchmark.matchedRows}; action ${marketCalibratedFusion.action}.`,
      blocker: marketCalibratedFusion.status !== "ready-shadow" ? marketCalibratedFusion.summary : null,
      nextAction: marketCalibratedFusion.action === "run-market-benchmark" ? "Run the model-vs-market benchmark before answer promotion." : marketCalibratedFusion.locks[1],
      proofUrl: "/api/sports/decision/market-calibrated-fusion"
    },
    {
      id: "abstention",
      label: "Abstention guard",
      status: abstentionAudit.status === "monitor-only" || abstentionAudit.status === "ready-shadow" ? "watch" : "block",
      score: abstentionScore,
      weight: 14,
      evidence: `${abstentionAudit.totals.positiveEvBlocked} positive-EV candidate(s) blocked; ${abstentionAudit.totals.missingEvidenceItems} missing evidence item(s).`,
      blocker: abstentionAudit.topCandidate?.whyAvoidOrWait ?? abstentionAudit.summary,
      nextAction: abstentionAudit.topCandidate?.nextAction ?? "Keep positive-EV candidates capped until missing evidence clears.",
      proofUrl: "/api/sports/decision/abstention-audit"
    },
    {
      id: "promotion",
      label: "Answer promotion",
      status: answerPromotionGate.status === "monitor-eligible" ? "watch" : "block",
      score: promotionScore,
      weight: 13,
      evidence: `${answerPromotionGate.status}; ${answerPromotionGate.totals.pass} pass, ${answerPromotionGate.totals.watch} watch, ${answerPromotionGate.totals.block} block check(s).`,
      blocker: finalAnswer.publicAnswer.action === "avoid" ? finalAnswer.abstentionGuard.whyAvoidOrWait : answerPromotionGate.summary,
      nextAction: answerPromotionGate.nextBlockingCheck?.requiredEvidence ?? answerPromotionGate.summary,
      proofUrl: "/api/sports/decision/answer-promotion-gate"
    },
    {
      id: "epl-2026",
      label: "EPL 2026/27 readiness",
      status: checkClass(eplScore, eplPreKickoffRehearsal.status === "blocked-storage"),
      score: eplScore,
      weight: 8,
      evidence: `${eplPreKickoffRehearsal.totals.openingFixtures} opening fixture(s); ${eplPreKickoffRehearsal.totals.readyReadOnly} read-only ready; ${eplPreKickoffRehearsal.totals.daysUntilStart} day(s) until kickoff.`,
      blocker: eplPreKickoffRehearsal.status === "ready-read-only" ? null : eplPreKickoffRehearsal.fixtures[0]?.nextAction.expectedEvidence ?? eplPreKickoffRehearsal.summary,
      nextAction: eplPreKickoffRehearsal.fixtures[0]?.nextAction.expectedEvidence ?? eplPreKickoffRehearsal.summary,
      proofUrl: "/api/sports/decision/epl-pre-kickoff-rehearsal"
    }
  ];
}

function summaryFor(status: DecisionEvidenceSufficiencyStatus, total: number, topBlockers: string[]): string {
  if (status === "sufficient-shadow") return `Evidence sufficiency is ${total}/100; the engine can keep the top idea in shadow review only.`;
  if (status === "action-blocked") return `Evidence sufficiency is ${total}/100, but abstention and answer locks keep the public action at avoid.`;
  if (status === "insufficient-data") return `Evidence sufficiency is ${total}/100; more live provider data and market proof are required before trust can rise.`;
  return `Evidence sufficiency is ${total}/100 and blocked by ${topBlockers[0] ?? "promotion gates"}; no pick can be published.`;
}

export function buildDecisionEvidenceSufficiencyScore({
  date,
  sport,
  liveDataReadiness,
  modelMathProof,
  marketCalibratedFusion,
  abstentionAudit,
  finalAnswer,
  answerPromotionGate,
  eplPreKickoffRehearsal,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  liveDataReadiness: DecisionLiveDataReadiness;
  modelMathProof: DecisionModelMathProof;
  marketCalibratedFusion: DecisionMarketCalibratedFusion;
  abstentionAudit: DecisionAbstentionAudit;
  finalAnswer: DecisionFinalAnswerContract;
  answerPromotionGate: DecisionAnswerPromotionGate;
  eplPreKickoffRehearsal: DecisionEplPreKickoffRehearsal;
  now?: Date;
}): DecisionEvidenceSufficiencyScore {
  const checks = buildChecks({
    liveDataReadiness,
    modelMathProof,
    marketCalibratedFusion,
    abstentionAudit,
    finalAnswer,
    answerPromotionGate,
    eplPreKickoffRehearsal
  });
  const total = weightedScore(checks);
  const status = statusFor(total, checks, finalAnswer);
  const topBlockers = unique(checks.filter((check) => check.status === "block").map((check) => check.blocker ?? check.nextAction), 6);
  const nextCheck = checks.find((check) => check.status === "block") ?? checks.find((check) => check.status === "watch") ?? checks[0];
  const scoreHash = stableHash({
    date,
    sport,
    status,
    total,
    checks: checks.map((check) => [check.id, check.status, check.score]),
    finalAnswer: finalAnswer.answerHash,
    promotion: answerPromotionGate.promotionHash
  });

  return {
    mode: "decision-evidence-sufficiency-score",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    scoreHash,
    summary: summaryFor(status, total, topBlockers),
    score: {
      total,
      data: clamp((checks.find((check) => check.id === "live-data")?.score ?? 0) * 0.6 + (checks.find((check) => check.id === "provider-feeds")?.score ?? 0) * 0.4),
      model: checks.find((check) => check.id === "model-math")?.score ?? 0,
      market: checks.find((check) => check.id === "market-calibration")?.score ?? 0,
      safety: clamp((checks.find((check) => check.id === "abstention")?.score ?? 0) * 0.52 + (checks.find((check) => check.id === "promotion")?.score ?? 0) * 0.48),
      eplReadiness: checks.find((check) => check.id === "epl-2026")?.score ?? 0
    },
    target: {
      matchId: finalAnswer.target.matchId,
      match: finalAnswer.target.match,
      selection: finalAnswer.target.selection,
      publicAction: finalAnswer.publicAnswer.action,
      publicPickAllowed: false
    },
    topBlockers,
    checks,
    nextAction: {
      label: nextCheck?.label ?? "Inspect evidence sufficiency",
      proofUrl: nextCheck?.proofUrl ?? "/api/sports/decision/evidence-sufficiency-score",
      expectedEvidence: nextCheck?.nextAction ?? "A read-only score with data, model, market, safety, and EPL readiness checks.",
      safeToRun: true
    },
    controls: {
      canInspectReadOnly: true,
      canUseForAiPrompt: true,
      canApplyToLiveDecision: false,
      canWriteProviderRows: false,
      canPersistDecisions: false,
      canTrainModels: false,
      canApplyLearnedWeights: false,
      canPublishPicks: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique([
      "/api/sports/decision/evidence-sufficiency-score",
      "/api/sports/decision/live-data-readiness",
      "/api/sports/decision/model-math-proof",
      "/api/sports/decision/market-calibrated-fusion",
      "/api/sports/decision/abstention-audit",
      "/api/sports/decision/answer-promotion-gate",
      "/api/sports/decision/epl-pre-kickoff-rehearsal"
    ]),
    locks: [
      "Evidence sufficiency is read-only and cannot publish, persist, train, stake, or upgrade public action.",
      "A positive model edge remains blocked when provider rows, feed coverage, market benchmark, abstention, or promotion gates fail.",
      "The score may be used in AI prompts only as supplied evidence, not as hidden chain-of-thought."
    ]
  };
}
