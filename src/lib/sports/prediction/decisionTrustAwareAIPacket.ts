import type { DecisionAbstentionAudit } from "@/lib/sports/prediction/decisionAbstentionAudit";
import type { DecisionBriefing } from "@/lib/sports/prediction/decisionBriefing";
import type { DecisionEvidenceInfluenceLedger } from "@/lib/sports/prediction/decisionEvidenceInfluenceLedger";
import type { DecisionFinalAnswerContract } from "@/lib/sports/prediction/decisionFinalAnswerContract";
import type { DecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import type { DecisionOpenAILiveReviewReceipt } from "@/lib/sports/prediction/decisionOpenAILiveReviewReceipt";
import type { DecisionPreMatchTrustCandidate, DecisionPreMatchTrustGate } from "@/lib/sports/prediction/decisionPreMatchTrustGate";
import type { Sport } from "@/lib/sports/types";
import type { FootballDataHistoricalLearningDossier } from "@/lib/sports/training/footballDataHistoricalLearningDossier";
import type { PublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";

export type DecisionTrustAwareAIStatus = "ready-preview" | "ready-to-submit" | "trust-blocked" | "needs-openai" | "contract-waiting";

export type DecisionTrustAwareAIEvidence = {
  id: string;
  label: string;
  status: "support" | "watch" | "block";
  detail: string;
  proofUrl: string;
};

export type DecisionTrustAwareAIRequestPreview = {
  model: string;
  store: false;
  instructions: string[];
  responseContract: {
    format: "strict-json";
    allowedVerdicts: Array<"agree" | "downgrade" | "needs-evidence" | "block">;
    allowedActions: Array<"avoid" | "monitor">;
    forbidden: string[];
  };
  input: {
    target: DecisionFinalAnswerContract["target"];
    publicAnswer: DecisionFinalAnswerContract["publicAnswer"];
    trustCeiling: DecisionPreMatchTrustCandidate["trustCeiling"] | "blocked";
    publicActionCeiling: DecisionPreMatchTrustCandidate["publicAction"] | "blocked";
    modelView: DecisionFinalAnswerContract["modelView"];
    abstentionGuard: DecisionFinalAnswerContract["abstentionGuard"];
    briefing: {
      headline: string;
      thesis: string;
      counterThesis: string;
      decision: string;
      nextEvidence: string[];
    };
    evidence: DecisionTrustAwareAIEvidence[];
    evidenceInfluence: {
      status: DecisionEvidenceInfluenceLedger["status"];
      ledgerHash: string;
      totals: DecisionEvidenceInfluenceLedger["totals"];
      selectedEntry: {
        id: string;
        label: string;
        state: string;
        blockers: string[];
        watches: string[];
        allowedUses: string[];
        forbiddenUses: string[];
        nextAction: string;
      } | null;
      blockedSignals: Array<{
        id: string;
        label: string;
        category: string;
        blockers: string[];
        nextAction: string;
      }>;
      instructions: string[];
    };
    historicalLearning: {
      status: FootballDataHistoricalLearningDossier["status"];
      dossierHash: string;
      learningScore: number;
      benchmarkVerdict: FootballDataHistoricalLearningDossier["scorecard"]["benchmarkVerdict"];
      roadmapStatus: FootballDataHistoricalLearningDossier["scorecard"]["roadmapStatus"];
      findingIds: string[];
      instruction: string;
    } | null;
    publicHistoricalEvidence: {
      status: PublicHistoricalTrainingEvidence["status"];
      evidenceHash: string;
      diagnosticScore: number;
      fixtures: number;
      oddsRows: number;
      bookmakerMarkets: number;
      benchmarkVerdict: PublicHistoricalTrainingEvidence["scorecard"]["benchmarkVerdict"];
      aiEvidenceValue: PublicHistoricalTrainingEvidence["contribution"]["aiEvidenceValue"];
      instruction: string;
    } | null;
    requiredBeforeUpgrade: string[];
  };
};

export type DecisionTrustAwareAIPacket = {
  mode: "trust-aware-ai-packet";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionTrustAwareAIStatus;
  packetHash: string;
  summary: string;
  activeTarget: {
    matchId: string | null;
    match: string | null;
    selection: string | null;
    trustCeiling: DecisionPreMatchTrustCandidate["trustCeiling"] | "blocked";
    publicAction: DecisionPreMatchTrustCandidate["publicAction"] | "blocked";
  };
  evidence: {
    ids: string[];
    items: DecisionTrustAwareAIEvidence[];
    support: number;
    watch: number;
    block: number;
  };
  requestPreview: DecisionTrustAwareAIRequestPreview;
  controls: {
    canInspectReadOnly: true;
    canSubmitToOpenAI: boolean;
    requiresExplicitRunParam: true;
    canApplyAIOutput: false;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
    canUseHiddenChainOfThought: false;
    canUpgradePublicAction: false;
  };
  nextAction: {
    label: string;
    command: string;
    verifyUrl: string;
    safeToRun: boolean;
    expectedEvidence: string;
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

function compact(value: string | null | undefined, maxLength = 260): string {
  const normalized = value?.replace(/\s+/g, " ").trim() ?? "";
  if (!normalized) return "No detail available.";
  return normalized.length > maxLength ? `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...` : normalized;
}

function unique(values: Array<string | null | undefined>, limit = 24): string[] {
  return Array.from(new Set(values.map((value) => value?.replace(/\s+/g, " ").trim() ?? "").filter(Boolean))).slice(0, limit);
}

function evidenceStatus(status: string): DecisionTrustAwareAIEvidence["status"] {
  if (status === "pass" || status === "support" || status === "ready-watchlist" || status === "monitor" || status === "shadow-candidate") return "support";
  if (status === "block" || status === "blocked" || status === "missing-key" || status === "trust-blocked") return "block";
  return "watch";
}

function evidenceItems({
  preMatchTrustGate,
  evidenceInfluenceLedger,
  finalAnswer,
  abstentionAudit,
  briefing,
  openAiKeyDiagnostic,
  openAiLiveReviewReceipt,
  historicalLearningDossier,
  publicHistoricalTrainingEvidence
}: {
  preMatchTrustGate: DecisionPreMatchTrustGate;
  evidenceInfluenceLedger: DecisionEvidenceInfluenceLedger;
  finalAnswer: DecisionFinalAnswerContract;
  abstentionAudit: DecisionAbstentionAudit;
  briefing: DecisionBriefing;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  historicalLearningDossier?: FootballDataHistoricalLearningDossier | null;
  publicHistoricalTrainingEvidence?: PublicHistoricalTrainingEvidence | null;
}): DecisionTrustAwareAIEvidence[] {
  const topTrust = preMatchTrustGate.topCandidate;
  const trustGates: DecisionTrustAwareAIEvidence[] =
    topTrust?.gates.map((gate) => ({
      id: `trust:${gate.id}`,
      label: gate.label,
      status: evidenceStatus(gate.status),
      detail: `${gate.detail} Next: ${gate.nextAction}`,
      proofUrl: gate.proofUrl
    })) ?? [];

  const items: DecisionTrustAwareAIEvidence[] = [
    {
      id: "final-answer-contract",
      label: "Final answer contract",
      status: evidenceStatus(finalAnswer.status),
      detail: `${finalAnswer.publicAnswer.action}: ${finalAnswer.publicAnswer.headline}`,
      proofUrl: "/api/sports/decision/final-answer-contract"
    },
    {
      id: "abstention-audit",
      label: "Abstention audit",
      status: abstentionAudit.topCandidate?.publicDecision === "monitor-only" ? "watch" : "block",
      detail: abstentionAudit.topCandidate
        ? `${abstentionAudit.topCandidate.match}: ${abstentionAudit.topCandidate.whyAvoidOrWait}`
        : abstentionAudit.summary,
      proofUrl: "/api/sports/decision/abstention-audit"
    },
    {
      id: "pre-match-trust-ceiling",
      label: "Pre-match trust ceiling",
      status: topTrust?.trustCeiling === "blocked" ? "block" : topTrust?.trustCeiling === "monitor-only" ? "support" : "watch",
      detail: topTrust ? `${topTrust.match}: ${topTrust.trustCeiling} at ${topTrust.trustScore}/100. ${topTrust.engineInstruction}` : preMatchTrustGate.summary,
      proofUrl: "/api/sports/decision/pre-match-trust-gate"
    },
    ...trustGates,
    {
      id: "evidence-influence-ledger",
      label: "Evidence influence ledger",
      status: evidenceInfluenceLedger.status === "decision-eligible" ? "support" : evidenceInfluenceLedger.status === "shadow-only" ? "watch" : "block",
      detail: `${evidenceInfluenceLedger.summary} Selected: ${evidenceInfluenceLedger.selectedEntry?.label ?? "none"}.`,
      proofUrl: "/api/sports/decision/evidence-influence-ledger"
    },
    {
      id: "operator-briefing",
      label: "Operator briefing",
      status: evidenceStatus(briefing.status),
      detail: `${briefing.headline} ${briefing.decision}`,
      proofUrl: "/api/sports/decision/briefing"
    },
    {
      id: "openai-key-diagnostic",
      label: "OpenAI key diagnostic",
      status: evidenceStatus(openAiKeyDiagnostic.status),
      detail: openAiKeyDiagnostic.summary,
      proofUrl: "/api/sports/decision/openai-key-diagnostic"
    },
    {
      id: "openai-live-review-receipt",
      label: "OpenAI live review receipt",
      status: openAiLiveReviewReceipt.status === "reviewed" || openAiLiveReviewReceipt.status === "ready-to-request" ? "support" : evidenceStatus(openAiLiveReviewReceipt.status),
      detail: openAiLiveReviewReceipt.summary,
      proofUrl: "/api/sports/decision/openai-live-review-receipt"
    }
  ];

  if (historicalLearningDossier) {
    items.push({
      id: "historical-learning-dossier",
      label: "Historical learning dossier",
      status:
        historicalLearningDossier.status === "ready-provider-retest"
          ? "watch"
          : historicalLearningDossier.status === "market-prior-dominant" || historicalLearningDossier.status === "failed"
            ? "block"
            : "watch",
      detail: `${historicalLearningDossier.summary} Benchmark ${historicalLearningDossier.scorecard.benchmarkVerdict}; ${historicalLearningDossier.scorecard.fixtures} fixture(s), ${historicalLearningDossier.scorecard.benchmarkRows} benchmark row(s), learning score ${historicalLearningDossier.scorecard.learningScore}/100.`,
      proofUrl: "/api/sports/decision/training/football-data-historical-learning-dossier"
    });
  }

  if (publicHistoricalTrainingEvidence) {
    items.push({
      id: "public-historical-training-evidence",
      label: "Public historical training evidence",
      status:
        publicHistoricalTrainingEvidence.status === "provider-retest-ready"
          ? "watch"
          : publicHistoricalTrainingEvidence.status === "market-prior-dominant" || publicHistoricalTrainingEvidence.status === "failed"
            ? "block"
            : "watch",
      detail: `${publicHistoricalTrainingEvidence.summary} Diagnostic score ${publicHistoricalTrainingEvidence.diagnosticScore}/100; ${publicHistoricalTrainingEvidence.scorecard.bookmakerMarkets} bookmaker market(s); AI evidence value ${publicHistoricalTrainingEvidence.contribution.aiEvidenceValue}. ${publicHistoricalTrainingEvidence.contribution.reason}`,
      proofUrl: "/api/sports/decision/training/public-historical-training-evidence"
    });
  }

  return items.map((item) => ({
    ...item,
    detail: compact(item.detail, 320)
  }));
}

function statusFor({
  trust,
  openAiKeyDiagnostic,
  openAiLiveReviewReceipt,
  canSubmit
}: {
  trust: DecisionPreMatchTrustCandidate | null;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  canSubmit: boolean;
}): DecisionTrustAwareAIStatus {
  if (trust?.trustCeiling === "blocked") return "trust-blocked";
  if (canSubmit) return "ready-to-submit";
  if (openAiKeyDiagnostic.status === "missing-key" || openAiKeyDiagnostic.status === "suspicious-key") return "needs-openai";
  if (openAiLiveReviewReceipt.status === "contract-waiting") return "contract-waiting";
  return "ready-preview";
}

function summaryFor(status: DecisionTrustAwareAIStatus): string {
  if (status === "ready-to-submit") return "Trust-aware AI packet is ready for an explicit guarded OpenAI review.";
  if (status === "trust-blocked") return "Trust-aware AI packet is preview-only because the pre-match trust gate blocks the active target.";
  if (status === "needs-openai") return "Trust-aware AI packet is preview-only until a valid server-side OpenAI key is configured.";
  if (status === "contract-waiting") return "Trust-aware AI packet is preview-only until the AI review contract clears.";
  return "Trust-aware AI packet is available as a read-only prompt contract with no side effects.";
}

export function buildDecisionTrustAwareAIPacket({
  date,
  sport,
  preMatchTrustGate,
  evidenceInfluenceLedger,
  finalAnswer,
  abstentionAudit,
  briefing,
  openAiKeyDiagnostic,
  openAiLiveReviewReceipt,
  historicalLearningDossier = null,
  publicHistoricalTrainingEvidence = null,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  preMatchTrustGate: DecisionPreMatchTrustGate;
  evidenceInfluenceLedger: DecisionEvidenceInfluenceLedger;
  finalAnswer: DecisionFinalAnswerContract;
  abstentionAudit: DecisionAbstentionAudit;
  briefing: DecisionBriefing;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  openAiLiveReviewReceipt: DecisionOpenAILiveReviewReceipt;
  historicalLearningDossier?: FootballDataHistoricalLearningDossier | null;
  publicHistoricalTrainingEvidence?: PublicHistoricalTrainingEvidence | null;
  now?: Date;
}): DecisionTrustAwareAIPacket {
  const trust = preMatchTrustGate.topCandidate;
  const items = evidenceItems({
    preMatchTrustGate,
    evidenceInfluenceLedger,
    finalAnswer,
    abstentionAudit,
    briefing,
    openAiKeyDiagnostic,
    openAiLiveReviewReceipt,
    historicalLearningDossier,
    publicHistoricalTrainingEvidence
  });
  const evidenceIds = items.map((item) => item.id);
  const canSubmit =
    Boolean(trust && trust.trustCeiling !== "blocked") &&
    evidenceInfluenceLedger.status !== "blocked" &&
    openAiLiveReviewReceipt.controls.canRequestLiveReview &&
    finalAnswer.controls.canRequestAIReview;
  const status = statusFor({ trust, openAiKeyDiagnostic, openAiLiveReviewReceipt, canSubmit });
  const requestPreview: DecisionTrustAwareAIRequestPreview = {
    model: openAiKeyDiagnostic.runtime.model,
    store: false,
    instructions: [
      "Use only the supplied evidence IDs; cite evidence IDs for every material claim.",
      "Return public reasoning notes only, not hidden chain-of-thought.",
      "You may agree, downgrade, request evidence, or block. You must not upgrade the deterministic action or trust ceiling.",
      "Respect the evidence influence ledger: blocked evidence may explain abstention only, shadow-only evidence may support hypotheses only, and only influence-allowed evidence may support deterministic confidence.",
      "Respect the abstention guard: value edge cannot become a pick unless the abstention audit allows monitor-only and every listed missing evidence item is resolved.",
      historicalLearningDossier
        ? "Respect the historical learning dossier: if it says market prior is dominant or provider enrichment is required, raw model value is blocked evidence until provider-enriched retest proof clears."
        : "Historical learning dossier was not supplied; do not make historical benchmark claims.",
      publicHistoricalTrainingEvidence
        ? "Respect the public historical training evidence: diagnostic public EPL history may explain caution, but it cannot train, publish, stake, apply thresholds, or upgrade model trust."
        : "Public historical training evidence was not supplied; do not claim public CSV corpus coverage.",
      "Do not invent injuries, lineups, weather, odds, scores, news, suspensions, or provider facts.",
      `Hard ceiling: ${trust?.trustCeiling ?? "blocked"}; public action ceiling: ${trust?.publicAction ?? "blocked"}.`
    ],
    responseContract: {
      format: "strict-json",
      allowedVerdicts: ["agree", "downgrade", "needs-evidence", "block"],
      allowedActions: ["avoid", "monitor"],
      forbidden: [
        "publish pick",
        "stake",
        "persist decision",
        "train model",
        "raise trust",
        "upgrade public action",
        "print secrets",
        "use hidden chain-of-thought",
        "claim unsupported team news",
        "claim unsupported historical edge"
      ]
    },
    input: {
      target: finalAnswer.target,
      publicAnswer: finalAnswer.publicAnswer,
      trustCeiling: trust?.trustCeiling ?? "blocked",
      publicActionCeiling: trust?.publicAction ?? "blocked",
      modelView: finalAnswer.modelView,
      abstentionGuard: finalAnswer.abstentionGuard,
      briefing: {
        headline: briefing.headline,
        thesis: briefing.thesis,
        counterThesis: briefing.counterThesis,
        decision: briefing.decision,
        nextEvidence: briefing.nextEvidence
      },
      evidence: items,
      evidenceInfluence: {
        status: evidenceInfluenceLedger.status,
        ledgerHash: evidenceInfluenceLedger.ledgerHash,
        totals: evidenceInfluenceLedger.totals,
        selectedEntry: evidenceInfluenceLedger.selectedEntry
          ? {
              id: evidenceInfluenceLedger.selectedEntry.id,
              label: evidenceInfluenceLedger.selectedEntry.label,
              state: evidenceInfluenceLedger.selectedEntry.state,
              blockers: evidenceInfluenceLedger.selectedEntry.blockers,
              watches: evidenceInfluenceLedger.selectedEntry.watches,
              allowedUses: evidenceInfluenceLedger.selectedEntry.allowedUses,
              forbiddenUses: evidenceInfluenceLedger.selectedEntry.forbiddenUses,
              nextAction: evidenceInfluenceLedger.selectedEntry.nextAction
            }
          : null,
        blockedSignals: evidenceInfluenceLedger.entries
          .filter((entry) => entry.state === "blocked")
          .slice(0, 8)
          .map((entry) => ({
            id: entry.id,
            label: entry.label,
            category: entry.category,
            blockers: entry.blockers,
            nextAction: entry.nextAction
        })),
        instructions: evidenceInfluenceLedger.aiInstructions
      },
      historicalLearning: historicalLearningDossier
        ? {
            status: historicalLearningDossier.status,
            dossierHash: historicalLearningDossier.dossierHash,
            learningScore: historicalLearningDossier.scorecard.learningScore,
            benchmarkVerdict: historicalLearningDossier.scorecard.benchmarkVerdict,
            roadmapStatus: historicalLearningDossier.scorecard.roadmapStatus,
            findingIds: historicalLearningDossier.findings.map((finding) => finding.id),
            instruction:
              historicalLearningDossier.status === "market-prior-dominant"
                ? "Market prior is dominant in the supplied historical dossier; block any attempt to promote raw model edge."
                : historicalLearningDossier.status === "ready-provider-retest"
                  ? "Only provider-enriched retest is eligible; do not publish, persist, stake, or apply thresholds."
                  : "Use the dossier as diagnostic context only; request more provider-backed evidence."
          }
        : null,
      publicHistoricalEvidence: publicHistoricalTrainingEvidence
        ? {
            status: publicHistoricalTrainingEvidence.status,
            evidenceHash: publicHistoricalTrainingEvidence.evidenceHash,
            diagnosticScore: publicHistoricalTrainingEvidence.diagnosticScore,
            fixtures: publicHistoricalTrainingEvidence.scorecard.fixtures,
            oddsRows: publicHistoricalTrainingEvidence.scorecard.oddsRows,
            bookmakerMarkets: publicHistoricalTrainingEvidence.scorecard.bookmakerMarkets,
            benchmarkVerdict: publicHistoricalTrainingEvidence.scorecard.benchmarkVerdict,
            aiEvidenceValue: publicHistoricalTrainingEvidence.contribution.aiEvidenceValue,
            instruction:
              publicHistoricalTrainingEvidence.status === "market-prior-dominant"
                ? "Public history says market prior dominates; treat raw model edge as blocked evidence until provider-enriched retest clears."
                : publicHistoricalTrainingEvidence.status === "provider-retest-ready"
                  ? "Use public history to request provider-enriched retest only; do not upgrade, train, publish, or stake."
                  : "Use public history as diagnostic context only and request provider-backed evidence."
          }
        : null,
      requiredBeforeUpgrade: unique(
        [
          ...(trust?.requiredNextEvidence ?? []),
          ...finalAnswer.riskReview.requiredBeforeUpgrade,
          finalAnswer.abstentionGuard.whyAvoidOrWait,
          ...finalAnswer.abstentionGuard.missingEvidence,
          ...briefing.nextEvidence,
          evidenceInfluenceLedger.selectedEntry?.nextAction
        ],
        12
      )
    }
  };
  const packetHash = stableHash({
    date,
    sport,
    status,
    target: finalAnswer.target,
    trust: [trust?.matchId, trust?.trustCeiling, trust?.trustScore, trust?.publicAction],
    answer: finalAnswer.answerHash,
    briefing: briefing.briefingHash,
    openAi: [openAiKeyDiagnostic.diagnosticHash, openAiLiveReviewReceipt.receiptHash],
    influence: evidenceInfluenceLedger.ledgerHash,
    abstention: abstentionAudit.auditHash,
    historicalLearning: historicalLearningDossier
      ? [historicalLearningDossier.dossierHash, historicalLearningDossier.status, historicalLearningDossier.scorecard.benchmarkVerdict]
      : null,
    publicHistoricalEvidence: publicHistoricalTrainingEvidence
      ? [
          publicHistoricalTrainingEvidence.evidenceHash,
          publicHistoricalTrainingEvidence.status,
          publicHistoricalTrainingEvidence.diagnosticScore,
          publicHistoricalTrainingEvidence.scorecard.benchmarkVerdict
        ]
      : null,
    evidenceIds
  });
  const query = `date=${encodeURIComponent(date)}&sport=${encodeURIComponent(sport)}`;

  return {
    mode: "trust-aware-ai-packet",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    packetHash,
    summary: summaryFor(status),
    activeTarget: {
      matchId: finalAnswer.target.matchId,
      match: finalAnswer.target.match,
      selection: finalAnswer.target.selection,
      trustCeiling: trust?.trustCeiling ?? "blocked",
      publicAction: trust?.publicAction ?? "blocked"
    },
    evidence: {
      ids: evidenceIds,
      items,
      support: items.filter((item) => item.status === "support").length,
      watch: items.filter((item) => item.status === "watch").length,
      block: items.filter((item) => item.status === "block").length
    },
    requestPreview,
    controls: {
      canInspectReadOnly: true,
      canSubmitToOpenAI: canSubmit,
      requiresExplicitRunParam: true,
      canApplyAIOutput: false,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUseHiddenChainOfThought: false,
      canUpgradePublicAction: false
    },
    nextAction: {
      label:
        status === "trust-blocked"
          ? "Clear pre-match trust blockers"
          : status === "needs-openai"
            ? "Configure guarded OpenAI review"
            : status === "ready-to-submit"
              ? "Run guarded AI review"
              : "Inspect AI packet contract",
      command:
        status === "ready-to-submit"
          ? `curl.exe -sS "http://127.0.0.1:3025/api/sports/decision/openai-live-review-receipt?${query}&run=1"`
          : `curl.exe -sS "http://127.0.0.1:3025/api/sports/decision/trust-aware-ai-packet?${query}"`,
      verifyUrl: status === "ready-to-submit" ? "/api/sports/decision/openai-live-review-receipt" : "/api/sports/decision/trust-aware-ai-packet",
      safeToRun: status !== "trust-blocked",
      expectedEvidence:
        status === "trust-blocked"
          ? "Pre-match trust gate reports a non-blocked ceiling before AI review can be considered."
          : "AI packet returns evidence IDs, strict no-upgrade instructions, store=false, and locked side-effect controls."
    },
    proofUrls: unique([
      "/api/sports/decision/trust-aware-ai-packet",
      "/api/sports/decision/evidence-influence-ledger",
      "/api/sports/decision/pre-match-trust-gate",
      "/api/sports/decision/final-answer-contract",
      "/api/sports/decision/abstention-audit",
      "/api/sports/decision/briefing",
      "/api/sports/decision/openai-key-diagnostic",
      "/api/sports/decision/openai-live-review-receipt",
      historicalLearningDossier ? "/api/sports/decision/training/football-data-historical-learning-dossier" : null,
      publicHistoricalTrainingEvidence ? "/api/sports/decision/training/public-historical-training-evidence" : null,
      ...preMatchTrustGate.proofUrls,
      ...finalAnswer.proofUrls,
      ...abstentionAudit.proofUrls,
      ...briefing.proofUrls
    ]),
    locks: [
      "Trust-aware AI packet is read-only and cannot apply AI output, persist, publish, train, stake, or raise trust.",
      "AI output must cite supplied evidence IDs and may only agree, downgrade, request evidence, or block.",
      "AI output must honor the evidence influence ledger and cannot use blocked or shadow-only evidence as deterministic support.",
      "AI output must honor the abstention guard and cannot turn positive expected value into a public pick.",
      "Public historical training evidence is diagnostic only and cannot train, publish, stake, apply thresholds, or raise trust.",
      "The packet forbids hidden chain-of-thought and unsupported claims about injuries, lineups, odds, weather, news, scores, or suspensions.",
      ...preMatchTrustGate.locks,
      ...finalAnswer.locks,
      ...openAiLiveReviewReceipt.locks
    ].slice(0, 16)
  };
}
