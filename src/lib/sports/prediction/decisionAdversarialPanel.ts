import type { DecisionEvidenceGraph } from "@/lib/sports/prediction/decisionEvidenceGraph";
import type { DecisionModelEnsemble, DecisionModelEnsembleCandidate } from "@/lib/sports/prediction/decisionModelEnsemble";
import type { DecisionOddsIntelligenceProof, DecisionOddsIntelligenceProofSelection } from "@/lib/sports/prediction/decisionOddsIntelligenceProof";
import type { DecisionAction, Sport } from "@/lib/sports/types";

export type DecisionAdversarialPanelStatus = "cleared" | "contested" | "blocked" | "no-candidates";
export type DecisionAdversarialPanelCaseStatus = "cleared" | "watch" | "blocked";
export type DecisionAdversarialPanelReviewerId =
  | "model-advocate"
  | "market-skeptic"
  | "data-skeptic"
  | "risk-manager"
  | "evidence-auditor"
  | "final-arbiter";
export type DecisionAdversarialPanelReviewerVerdict = "support" | "watch" | "oppose" | "block";

export type DecisionAdversarialPanelReviewer = {
  id: DecisionAdversarialPanelReviewerId;
  label: string;
  verdict: DecisionAdversarialPanelReviewerVerdict;
  action: DecisionAction;
  score: number;
  detail: string;
  evidence: string[];
};

export type DecisionAdversarialPanelCase = {
  matchId: string;
  match: string;
  league: string;
  selection: string | null;
  baseAction: DecisionAction;
  ensembleAction: DecisionAction;
  panelAction: DecisionAction;
  status: DecisionAdversarialPanelCaseStatus;
  consensus: "support" | "mixed" | "blocked";
  confidenceScore: number;
  support: number;
  watch: number;
  oppose: number;
  block: number;
  modelProbability: number | null;
  marketProbability: number | null;
  posteriorProbability: number | null;
  edge: number | null;
  expectedValue: number | null;
  evidenceNodeCount: number;
  blockingEvidence: string[];
  reviewers: DecisionAdversarialPanelReviewer[];
  risks: string[];
  saferAlternatives: string[];
  avoidReason: string | null;
  nextCheck: string;
};

export type DecisionAdversarialPanel = {
  mode: "decision-adversarial-panel";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionAdversarialPanelStatus;
  panelHash: string;
  summary: string;
  topCase: DecisionAdversarialPanelCase | null;
  cases: DecisionAdversarialPanelCase[];
  totals: {
    cases: number;
    cleared: number;
    watch: number;
    blocked: number;
    supportVotes: number;
    watchVotes: number;
    opposeVotes: number;
    blockVotes: number;
    averageConfidenceScore: number;
  };
  controls: {
    canInspectReadOnly: true;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
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

function round(value: number, digits = 1): number {
  return Number(value.toFixed(digits));
}

function compact(value: string, maxLength = 220): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 6): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
    if (result.length >= limit) break;
  }
  return result;
}

function actionFromVerdict(verdict: DecisionAdversarialPanelReviewerVerdict): DecisionAction {
  if (verdict === "support") return "consider";
  if (verdict === "watch") return "monitor";
  return "avoid";
}

function scoreFromVerdict(verdict: DecisionAdversarialPanelReviewerVerdict): number {
  if (verdict === "support") return 92;
  if (verdict === "watch") return 58;
  if (verdict === "oppose") return 28;
  return 0;
}

function reviewer(input: {
  id: DecisionAdversarialPanelReviewerId;
  label: string;
  verdict: DecisionAdversarialPanelReviewerVerdict;
  detail: string;
  evidence: Array<string | null | undefined>;
}): DecisionAdversarialPanelReviewer {
  return {
    id: input.id,
    label: input.label,
    verdict: input.verdict,
    action: actionFromVerdict(input.verdict),
    score: scoreFromVerdict(input.verdict),
    detail: compact(input.detail, 260),
    evidence: unique(input.evidence, 5)
  };
}

function matchingEdge(
  candidate: DecisionModelEnsembleCandidate,
  oddsIntelligenceProof: DecisionOddsIntelligenceProof
): DecisionOddsIntelligenceProofSelection | null {
  const sameMatch = oddsIntelligenceProof.topEdges.filter((edge) => edge.matchId === candidate.matchId);
  if (!sameMatch.length) return null;
  return (
    sameMatch.find((edge) => candidate.selection && edge.selection.toLowerCase() === candidate.selection.toLowerCase()) ??
    sameMatch.find((edge) => edge.action === "value") ??
    sameMatch[0] ??
    null
  );
}

function evidenceFor(candidate: DecisionModelEnsembleCandidate, evidenceGraph: DecisionEvidenceGraph) {
  const nodes = evidenceGraph.nodes.filter((node) => node.matchId === candidate.matchId);
  const blocking = nodes.filter((node) => node.status === "blocking");
  const watch = nodes.filter((node) => node.status === "watch");
  return { nodes, blocking, watch };
}

function buildReviewers({
  candidate,
  edge,
  evidence
}: {
  candidate: DecisionModelEnsembleCandidate;
  edge: DecisionOddsIntelligenceProofSelection | null;
  evidence: ReturnType<typeof evidenceFor>;
}): DecisionAdversarialPanelReviewer[] {
  const hasPositiveEdge = (candidate.valueEdge ?? edge?.edge ?? 0) > 0;
  const hasPositiveEv = (candidate.expectedValue ?? edge?.expectedValue ?? 0) > 0;

  const modelVerdict: DecisionAdversarialPanelReviewerVerdict =
    candidate.ensembleAction === "consider" && candidate.weightedScore >= 74
      ? "support"
      : candidate.ensembleAction === "monitor" || candidate.weightedScore >= 52
        ? "watch"
        : "oppose";
  const marketVerdict: DecisionAdversarialPanelReviewerVerdict =
    edge?.action === "value" && hasPositiveEdge && hasPositiveEv ? "support" : edge?.action === "watch" || hasPositiveEdge || hasPositiveEv ? "watch" : "oppose";
  const dataVerdict: DecisionAdversarialPanelReviewerVerdict =
    candidate.dataCoverageScore >= 74 && !candidate.blockers.length ? "support" : candidate.dataCoverageScore >= 55 ? "watch" : "block";
  const riskVerdict: DecisionAdversarialPanelReviewerVerdict =
    candidate.blockers.length > 0 ? "block" : candidate.conflicts.some((item) => /risk|fragile|uncertain|lineup|injur/i.test(item)) ? "watch" : "support";
  const evidenceVerdict: DecisionAdversarialPanelReviewerVerdict =
    evidence.blocking.length > 0 ? "block" : evidence.watch.length > 0 ? "watch" : evidence.nodes.length ? "support" : "watch";

  const preliminary = [
    reviewer({
      id: "model-advocate",
      label: "Model advocate",
      verdict: modelVerdict,
      detail: `Ensemble action is ${candidate.ensembleAction} with weighted score ${candidate.weightedScore} and agreement ${candidate.agreementScore}%.`,
      evidence: [candidate.nextCheck, `Base action ${candidate.baseAction}.`, `Consensus ${candidate.consensus}.`]
    }),
    reviewer({
      id: "market-skeptic",
      label: "Market skeptic",
      verdict: marketVerdict,
      detail: edge
        ? `${edge.marketName} ${edge.selection} is ${edge.action}; model ${edge.modelProbability}, no-vig ${edge.noVigProbability}, edge ${edge.edge}, EV ${edge.expectedValue}.`
        : "No matching priced edge is present in the odds-intelligence proof for this candidate.",
      evidence: edge ? [edge.verdict, edge.whyModelLikesIt, edge.avoidReason] : ["Missing matching odds-intelligence selection."]
    }),
    reviewer({
      id: "data-skeptic",
      label: "Data skeptic",
      verdict: dataVerdict,
      detail: `Data coverage score is ${candidate.dataCoverageScore}/100.`,
      evidence: candidate.blockers.length ? candidate.blockers : candidate.conflicts
    }),
    reviewer({
      id: "risk-manager",
      label: "Risk manager",
      verdict: riskVerdict,
      detail: candidate.blockers.length
        ? `Hard blockers exist: ${candidate.blockers.length}.`
        : candidate.conflicts.length
          ? `Risk review found ${candidate.conflicts.length} unresolved challenge(s).`
          : "No hard blocker appeared in the model-ensemble conflict set.",
      evidence: candidate.blockers.length ? candidate.blockers : candidate.conflicts
    }),
    reviewer({
      id: "evidence-auditor",
      label: "Evidence auditor",
      verdict: evidenceVerdict,
      detail: `Evidence graph has ${evidence.nodes.length} node(s), ${evidence.watch.length} watch node(s), and ${evidence.blocking.length} blocking node(s) for this match.`,
      evidence: evidence.blocking.length
        ? evidence.blocking.map((node) => `${node.label}: ${node.detail}`)
        : evidence.watch.length
          ? evidence.watch.map((node) => `${node.label}: ${node.detail}`)
          : evidence.nodes.map((node) => `${node.label}: ${node.detail}`)
    })
  ];

  const blockCount = preliminary.filter((item) => item.verdict === "block").length;
  const opposeCount = preliminary.filter((item) => item.verdict === "oppose").length;
  const supportCount = preliminary.filter((item) => item.verdict === "support").length;
  const arbiterVerdict: DecisionAdversarialPanelReviewerVerdict =
    blockCount > 0 ? "block" : supportCount >= 4 && opposeCount === 0 ? "support" : supportCount >= 2 ? "watch" : "oppose";

  return [
    ...preliminary,
    reviewer({
      id: "final-arbiter",
      label: "Final arbiter",
      verdict: arbiterVerdict,
      detail:
        arbiterVerdict === "support"
          ? "Panel clears the candidate for watchlist consideration, subject to locked publication controls."
          : arbiterVerdict === "watch"
            ? "Panel keeps the candidate in monitor mode until the named risks are rechecked."
            : arbiterVerdict === "oppose"
              ? "Panel opposes the pick because support is too thin after market and evidence challenge."
              : "Panel blocks the pick because at least one hard trust gate failed.",
      evidence: [candidate.nextCheck, edge?.verdict, ...candidate.blockers]
    })
  ];
}

function panelAction(reviewers: DecisionAdversarialPanelReviewer[], candidate: DecisionModelEnsembleCandidate): DecisionAction {
  if (reviewers.some((item) => item.verdict === "block")) return "avoid";
  const support = reviewers.filter((item) => item.verdict === "support").length;
  const oppose = reviewers.filter((item) => item.verdict === "oppose").length;
  if (support >= 5 && oppose === 0 && candidate.baseAction === "consider") return "consider";
  if (support >= 3 && oppose <= 1) return "monitor";
  return "avoid";
}

function caseStatus(action: DecisionAction, reviewers: DecisionAdversarialPanelReviewer[]): DecisionAdversarialPanelCaseStatus {
  if (reviewers.some((item) => item.verdict === "block") || action === "avoid") return "blocked";
  if (action === "monitor" || reviewers.some((item) => item.verdict === "watch" || item.verdict === "oppose")) return "watch";
  return "cleared";
}

function buildCase({
  candidate,
  oddsIntelligenceProof,
  evidenceGraph
}: {
  candidate: DecisionModelEnsembleCandidate;
  oddsIntelligenceProof: DecisionOddsIntelligenceProof;
  evidenceGraph: DecisionEvidenceGraph;
}): DecisionAdversarialPanelCase {
  const edge = matchingEdge(candidate, oddsIntelligenceProof);
  const evidence = evidenceFor(candidate, evidenceGraph);
  const reviewers = buildReviewers({ candidate, edge, evidence });
  const action = panelAction(reviewers, candidate);
  const status = caseStatus(action, reviewers);
  const support = reviewers.filter((item) => item.verdict === "support").length;
  const watch = reviewers.filter((item) => item.verdict === "watch").length;
  const oppose = reviewers.filter((item) => item.verdict === "oppose").length;
  const block = reviewers.filter((item) => item.verdict === "block").length;
  const confidenceScore = reviewers.length ? round(reviewers.reduce((sum, item) => sum + item.score, 0) / reviewers.length, 1) : 0;
  const risks = unique([...(edge?.risks ?? []), ...candidate.conflicts], 6);
  const saferAlternatives = unique([...(edge?.saferAlternatives ?? []), "Wait for provider-backed lineups/news before any public pick.", "Prefer monitor-only display until live review is configured."], 5);
  const avoidReason = block
    ? reviewers.find((item) => item.verdict === "block")?.detail ?? "A hard panel gate blocked the candidate."
    : oppose
      ? reviewers.find((item) => item.verdict === "oppose")?.detail ?? "The panel found too much opposition."
      : edge?.avoidReason;

  return {
    matchId: candidate.matchId,
    match: candidate.match,
    league: candidate.league,
    selection: edge?.selection ?? candidate.selection,
    baseAction: candidate.baseAction,
    ensembleAction: candidate.ensembleAction,
    panelAction: action,
    status,
    consensus: block ? "blocked" : support >= 4 && oppose === 0 ? "support" : "mixed",
    confidenceScore,
    support,
    watch,
    oppose,
    block,
    modelProbability: edge?.modelProbability ?? candidate.modelProbability,
    marketProbability: edge?.noVigProbability ?? candidate.marketProbability,
    posteriorProbability: candidate.posteriorProbability,
    edge: edge?.edge ?? candidate.valueEdge,
    expectedValue: edge?.expectedValue ?? candidate.expectedValue,
    evidenceNodeCount: evidence.nodes.length,
    blockingEvidence: evidence.blocking.map((node) => `${node.label}: ${node.detail}`).slice(0, 4),
    reviewers,
    risks,
    saferAlternatives,
    avoidReason: avoidReason ? compact(avoidReason, 260) : null,
    nextCheck:
      status === "cleared"
        ? "Run supervisor and OpenAI live-review gates before any public promotion."
        : avoidReason
          ? avoidReason
          : candidate.nextCheck
  };
}

function statusFor(cases: DecisionAdversarialPanelCase[]): DecisionAdversarialPanelStatus {
  if (!cases.length) return "no-candidates";
  if (cases.some((item) => item.status === "blocked")) return "blocked";
  if (cases.some((item) => item.status === "watch")) return "contested";
  return "cleared";
}

export function buildDecisionAdversarialPanel({
  date,
  sport,
  modelEnsemble,
  oddsIntelligenceProof,
  evidenceGraph,
  limit = 6,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  modelEnsemble: DecisionModelEnsemble;
  oddsIntelligenceProof: DecisionOddsIntelligenceProof;
  evidenceGraph: DecisionEvidenceGraph;
  limit?: number;
  now?: Date;
}): DecisionAdversarialPanel {
  const cases = modelEnsemble.candidates
    .slice(0, Math.max(1, Math.min(12, limit)))
    .map((candidate) => buildCase({ candidate, oddsIntelligenceProof, evidenceGraph }))
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "cleared" ? -1 : b.status === "cleared" ? 1 : a.status === "watch" ? -1 : 1;
      return b.confidenceScore - a.confidenceScore;
    });
  const status = statusFor(cases);
  const totals = {
    cases: cases.length,
    cleared: cases.filter((item) => item.status === "cleared").length,
    watch: cases.filter((item) => item.status === "watch").length,
    blocked: cases.filter((item) => item.status === "blocked").length,
    supportVotes: cases.reduce((sum, item) => sum + item.support, 0),
    watchVotes: cases.reduce((sum, item) => sum + item.watch, 0),
    opposeVotes: cases.reduce((sum, item) => sum + item.oppose, 0),
    blockVotes: cases.reduce((sum, item) => sum + item.block, 0),
    averageConfidenceScore: cases.length ? round(cases.reduce((sum, item) => sum + item.confidenceScore, 0) / cases.length, 1) : 0
  };
  const panelHash = stableHash({
    date,
    sport,
    status,
    cases: cases.map((item) => [item.matchId, item.panelAction, item.status, item.support, item.watch, item.oppose, item.block])
  });

  return {
    mode: "decision-adversarial-panel",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    panelHash,
    summary:
      status === "cleared"
        ? `Adversarial panel cleared ${totals.cleared} candidate(s) for monitor-safe consideration; all publishing and staking controls remain locked.`
        : status === "contested"
          ? `Adversarial panel is contested: ${totals.watch} candidate(s) need more evidence before any upgrade.`
          : status === "blocked"
            ? `Adversarial panel blocks ${totals.blocked} candidate(s); final arbiter keeps unsafe or under-evidenced picks out of recommendations.`
            : "Adversarial panel has no candidates to challenge.",
    topCase: cases[0] ?? null,
    cases,
    totals,
    controls: {
      canInspectReadOnly: true,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canUpgradePublicAction: false
    },
    proofUrls: [
      "/api/sports/decision/adversarial-panel",
      "/api/sports/decision/model-ensemble",
      "/api/sports/decision/odds-intelligence-proof",
      "/api/sports/decision/evidence-graph"
    ],
    locks: [
      "Panel output is an internal review receipt, not a betting instruction.",
      "A cleared panel case still cannot publish, stake, persist, train, or upgrade public action.",
      "The panel uses public evidence summaries and does not expose hidden chain-of-thought."
    ]
  };
}
