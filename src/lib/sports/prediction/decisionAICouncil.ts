import type { DecisionAgentLoop } from "@/lib/sports/prediction/decisionAgentLoop";
import type { DecisionBrainSlate } from "@/lib/sports/prediction/decisionBrain";
import type { DecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import type { DecisionSelfAudit } from "@/lib/sports/prediction/decisionSelfAudit";
import type { ConfidenceLevel, DecisionAction, Match, Prediction, RiskLevel, Sport } from "@/lib/sports/types";
import { extractOutputText } from "./openaiDecisionEnhancer";
import { getDecisionOpenAIModel } from "./openaiModel";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionAICouncilStatus = "ready" | "needs-data" | "blocked" | "no-candidates";
export type DecisionAICouncilReviewStatus = "not-requested" | "not-configured" | "reviewed" | "provider-error" | "invalid-response";
export type DecisionAICouncilReviewVerdict = "agree" | "downgrade" | "abstain" | "needs-data";
export type DecisionAICouncilRole =
  | "model-chair"
  | "market-skeptic"
  | "data-steward"
  | "risk-officer"
  | "learning-analyst"
  | "operations-lead";

export type DecisionAICouncilCandidate = {
  matchId: string;
  match: string;
  league: string;
  kickoffTime: string;
  action: DecisionAction;
  verdict: string;
  confidence: ConfidenceLevel;
  risk: RiskLevel;
  decisionScore: number;
  selection: string | null;
  modelProbability: number | null;
  noVigProbability: number | null;
  valueEdge: number | null;
  expectedValue: number | null;
  dataCoverageScore: number;
  dataCoverageStatus: string;
  oddsStatus: string;
  actionableSelections: number;
  uncertaintyScore: number;
  robustnessStatus: string;
  thesis: string;
  dissent: string;
  blockers: string[];
  saferAlternatives: string[];
};

export type DecisionAICouncilVote = {
  role: DecisionAICouncilRole;
  vote: DecisionAction;
  confidence: ConfidenceLevel;
  rationale: string;
  evidence: string[];
};

export type DecisionAICouncilEvidence = {
  id: string;
  label: string;
  status: string;
  detail: string;
};

export type DecisionAICouncilReview = {
  reviewVerdict: DecisionAICouncilReviewVerdict;
  recommendedAction: DecisionAction;
  summary: string;
  rationale: string[];
  riskFlags: string[];
  dataGaps: string[];
  checksBeforeAction: string[];
  unsupportedClaims: string[];
  roleNotes: Array<{
    role: DecisionAICouncilRole;
    note: string;
  }>;
};

export type DecisionAICouncil = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionAICouncilStatus;
  reviewStatus: DecisionAICouncilReviewStatus;
  reviewFailureReason: string | null;
  model: string | null;
  summary: string;
  finalAction: DecisionAction;
  confidence: ConfidenceLevel;
  risk: RiskLevel;
  canPublishSlate: boolean;
  activeCandidate: DecisionAICouncilCandidate | null;
  candidates: DecisionAICouncilCandidate[];
  roleVotes: DecisionAICouncilVote[];
  voteCounts: Record<DecisionAction, number>;
  evidenceDocket: DecisionAICouncilEvidence[];
  criticalQuestions: string[];
  guardrails: string[];
  nextOperation: {
    label: string;
    command: string | null;
    verifyUrl: string;
    missingEnv: string[];
    expectedEvidence: string;
  };
  aiReview: DecisionAICouncilReview | null;
};

const aiCouncilReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reviewVerdict: { type: "string", enum: ["agree", "downgrade", "abstain", "needs-data"] },
    recommendedAction: { type: "string", enum: ["consider", "monitor", "avoid"] },
    summary: { type: "string" },
    rationale: { type: "array", items: { type: "string" } },
    riskFlags: { type: "array", items: { type: "string" } },
    dataGaps: { type: "array", items: { type: "string" } },
    checksBeforeAction: { type: "array", items: { type: "string" } },
    unsupportedClaims: { type: "array", items: { type: "string" } },
    roleNotes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          role: { type: "string", enum: ["model-chair", "market-skeptic", "data-steward", "risk-officer", "learning-analyst", "operations-lead"] },
          note: { type: "string" }
        },
        required: ["role", "note"]
      }
    }
  },
  required: [
    "reviewVerdict",
    "recommendedAction",
    "summary",
    "rationale",
    "riskFlags",
    "dataGaps",
    "checksBeforeAction",
    "unsupportedClaims",
    "roleNotes"
  ]
};

function actionRank(action: DecisionAction): number {
  if (action === "consider") return 2;
  if (action === "monitor") return 1;
  return 0;
}

function safestAction(current: DecisionAction, proposed: DecisionAction): DecisionAction {
  return actionRank(proposed) <= actionRank(current) ? proposed : current;
}

function minAction(actions: DecisionAction[]): DecisionAction {
  return actions.reduce((lowest, action) => (actionRank(action) < actionRank(lowest) ? action : lowest), "consider" as DecisionAction);
}

function boundedText(value: unknown, max = 420): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function boundedList(value: unknown, maxItems: number, maxText = 260): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => boundedText(item, maxText)).filter(Boolean).slice(0, maxItems);
}

function isAction(value: unknown): value is DecisionAction {
  return value === "consider" || value === "monitor" || value === "avoid";
}

function isReviewVerdict(value: unknown): value is DecisionAICouncilReviewVerdict {
  return value === "agree" || value === "downgrade" || value === "abstain" || value === "needs-data";
}

function isCouncilRole(value: unknown): value is DecisionAICouncilRole {
  return (
    value === "model-chair" ||
    value === "market-skeptic" ||
    value === "data-steward" ||
    value === "risk-officer" ||
    value === "learning-analyst" ||
    value === "operations-lead"
  );
}

function matchLabel(row: DecisionRow): string {
  return `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`;
}

function candidateBlockers(row: DecisionRow): string[] {
  const decision = row.prediction.decision;
  return [
    ...decision.controlPolicy.gates.filter((gate) => gate.status === "block").map((gate) => `${gate.label}: ${gate.requiredAction ?? gate.detail}`),
    ...decision.actionability.blockers,
    ...decision.dataCoverage.requiredBeforeTrust,
    ...decision.abstentionRules.filter((gate) => gate.triggered).map((gate) => gate.detail)
  ].slice(0, 6);
}

function rowRank(row: DecisionRow): number {
  const decision = row.prediction.decision;
  const bestPick = row.prediction.bestPick;
  const actionWeight = decision.action === "consider" ? 180 : decision.action === "monitor" ? 90 : 0;
  const evWeight = bestPick.hasValue ? Math.max(0, bestPick.expectedValue) * 100 : 0;
  const edgeWeight = bestPick.hasValue ? Math.max(0, bestPick.edge) * 100 : 0;
  return actionWeight + decision.decisionScore + evWeight + edgeWeight + row.match.dataQualityScore * 10;
}

function buildCandidate(row: DecisionRow): DecisionAICouncilCandidate {
  const decision = row.prediction.decision;
  const bestPick = row.prediction.bestPick;
  return {
    matchId: row.match.id,
    match: matchLabel(row),
    league: row.match.league.name,
    kickoffTime: row.match.kickoffTime,
    action: decision.action,
    verdict: decision.verdict,
    confidence: decision.confidence,
    risk: decision.risk,
    decisionScore: decision.decisionScore,
    selection: bestPick.hasValue ? bestPick.label : decision.recommendedSelection,
    modelProbability: bestPick.hasValue ? bestPick.modelProbability : decision.beliefState.believedProbability,
    noVigProbability: bestPick.hasValue ? bestPick.noVigImpliedProbability : null,
    valueEdge: bestPick.hasValue ? bestPick.edge : decision.beliefState.probabilityEdge,
    expectedValue: bestPick.hasValue ? bestPick.expectedValue : decision.beliefState.expectedValue,
    dataCoverageScore: decision.dataCoverage.score,
    dataCoverageStatus: decision.dataCoverage.status,
    oddsStatus: decision.oddsIntelligence.status,
    actionableSelections: decision.oddsIntelligence.actionableSelections,
    uncertaintyScore: decision.beliefState.uncertaintyScore,
    robustnessStatus: decision.robustness.status,
    thesis: decision.deliberation.primaryThesis,
    dissent: decision.deliberation.dissentingThesis,
    blockers: candidateBlockers(row),
    saferAlternatives: decision.saferAlternatives.map((item) => `${item.market} ${item.selection}: ${item.rationale}`).slice(0, 4)
  };
}

function confidenceForVote(vote: DecisionAction, candidate: DecisionAICouncilCandidate | null): ConfidenceLevel {
  if (!candidate) return "low";
  if (vote === "avoid") return candidate.blockers.length ? "high" : "medium";
  if (candidate.confidence === "high" && candidate.dataCoverageScore >= 70) return "high";
  if (candidate.confidence === "low") return "low";
  return "medium";
}

function makeVote(role: DecisionAICouncilRole, vote: DecisionAction, candidate: DecisionAICouncilCandidate | null, rationale: string, evidence: string[]): DecisionAICouncilVote {
  return {
    role,
    vote,
    confidence: confidenceForVote(vote, candidate),
    rationale,
    evidence: evidence.slice(0, 4)
  };
}

function buildRoleVotes({
  candidate,
  selfAudit,
  dataIntake,
  agentLoop
}: {
  candidate: DecisionAICouncilCandidate | null;
  selfAudit: DecisionSelfAudit;
  dataIntake: DecisionDataIntakeQueue;
  agentLoop: DecisionAgentLoop;
}): DecisionAICouncilVote[] {
  if (!candidate) {
    return [
      makeVote("model-chair", "avoid", null, "No candidate is available for the council to review.", ["No fixture row was selected."]),
      makeVote("market-skeptic", "avoid", null, "No market-backed candidate is available.", ["No priced edge was selected."]),
      makeVote("data-steward", "avoid", null, "No data coverage can be audited without a candidate.", ["No decision coverage exists."]),
      makeVote("risk-officer", "avoid", null, "No risk review can pass without a candidate.", ["No decision risk exists."]),
      makeVote("learning-analyst", "avoid", null, "No learning check can run without a candidate.", ["No learning profile exists."]),
      makeVote("operations-lead", "avoid", null, "No operation should run without a candidate.", ["No operation target exists."])
    ];
  }

  const modelVote: DecisionAction = candidate.action === "consider" && candidate.decisionScore >= 64 ? "consider" : candidate.action === "avoid" ? "avoid" : "monitor";
  const marketVote: DecisionAction =
    candidate.actionableSelections > 0 && (candidate.valueEdge ?? 0) > 0 && (candidate.expectedValue ?? 0) > 0
      ? candidate.risk === "high"
        ? "monitor"
        : "consider"
      : "avoid";
  const dataVote: DecisionAction = candidate.dataCoverageScore < 45 || candidate.blockers.length > 4 ? "avoid" : candidate.dataCoverageScore < 70 ? "monitor" : candidate.action;
  const riskVote: DecisionAction = candidate.risk === "high" || candidate.robustnessStatus === "fragile" ? "avoid" : candidate.uncertaintyScore > 48 ? "monitor" : candidate.action;
  const learningVote: DecisionAction = selfAudit.findings.some((finding) => finding.category === "learning" && finding.severity !== "low") ? "monitor" : candidate.action;
  const operationsVote: DecisionAction = dataIntake.status === "blocked" || agentLoop.autonomy.status === "blocked" ? "avoid" : dataIntake.status === "ready" ? "monitor" : candidate.action;

  return [
    makeVote("model-chair", modelVote, candidate, candidate.thesis, [
      `Decision score ${candidate.decisionScore}`,
      `Believed probability ${candidate.modelProbability ?? "unknown"}`
    ]),
    makeVote("market-skeptic", marketVote, candidate, candidate.oddsStatus, [
      `Actionable selections ${candidate.actionableSelections}`,
      `Value edge ${candidate.valueEdge ?? "none"}`,
      `Expected value ${candidate.expectedValue ?? "none"}`
    ]),
    makeVote("data-steward", dataVote, candidate, `Data coverage is ${candidate.dataCoverageScore}/100 with status ${candidate.dataCoverageStatus}.`, [
      ...candidate.blockers.slice(0, 3),
      dataIntake.summary
    ]),
    makeVote("risk-officer", riskVote, candidate, `Risk is ${candidate.risk}; robustness is ${candidate.robustnessStatus}; uncertainty is ${candidate.uncertaintyScore}.`, [
      candidate.dissent,
      ...candidate.saferAlternatives.slice(0, 2)
    ]),
    makeVote("learning-analyst", learningVote, candidate, selfAudit.findings.find((finding) => finding.category === "learning")?.failureMode ?? "No learning finding blocks the candidate.", [
      selfAudit.summary
    ]),
    makeVote("operations-lead", operationsVote, candidate, agentLoop.autonomy.summary, [
      dataIntake.nextItem?.label ?? "No data intake item",
      agentLoop.verification.verifyUrl
    ])
  ];
}

function voteCounts(votes: DecisionAICouncilVote[]): Record<DecisionAction, number> {
  return votes.reduce(
    (acc, vote) => {
      acc[vote.vote] += 1;
      return acc;
    },
    { consider: 0, monitor: 0, avoid: 0 }
  );
}

function riskForFinal(finalAction: DecisionAction, candidate: DecisionAICouncilCandidate | null): RiskLevel {
  if (finalAction === "avoid") return "high";
  return candidate?.risk ?? "high";
}

function confidenceForFinal(finalAction: DecisionAction, candidate: DecisionAICouncilCandidate | null, votes: DecisionAICouncilVote[]): ConfidenceLevel {
  if (finalAction === "avoid") return votes.filter((vote) => vote.vote === "avoid").length >= 3 ? "high" : "medium";
  return candidate?.confidence ?? "low";
}

function statusForCouncil({
  rows,
  finalAction,
  candidate,
  selfAudit,
  dataIntake,
  agentLoop
}: {
  rows: DecisionRow[];
  finalAction: DecisionAction;
  candidate: DecisionAICouncilCandidate | null;
  selfAudit: DecisionSelfAudit;
  dataIntake: DecisionDataIntakeQueue;
  agentLoop: DecisionAgentLoop;
}): DecisionAICouncilStatus {
  if (!rows.length || !candidate) return "no-candidates";
  if (dataIntake.status === "blocked" || agentLoop.autonomy.status === "blocked" || selfAudit.criticalFindings > 0) return "blocked";
  if (finalAction === "avoid" || selfAudit.status === "fail" || candidate.dataCoverageScore < 60) return "needs-data";
  return "ready";
}

function buildEvidenceDocket({
  candidate,
  readiness,
  brainSlate,
  selfAudit,
  dataIntake,
  agentLoop
}: {
  candidate: DecisionAICouncilCandidate | null;
  readiness: DecisionEngineReadiness | null;
  brainSlate: DecisionBrainSlate;
  selfAudit: DecisionSelfAudit;
  dataIntake: DecisionDataIntakeQueue;
  agentLoop: DecisionAgentLoop;
}): DecisionAICouncilEvidence[] {
  return [
    {
      id: "candidate-belief",
      label: "Active candidate belief",
      status: candidate?.action ?? "none",
      detail: candidate ? `${candidate.match}: ${candidate.thesis}` : "No candidate is available."
    },
    {
      id: "market-edge",
      label: "Market edge",
      status: candidate?.oddsStatus ?? "none",
      detail: candidate ? `Edge ${candidate.valueEdge ?? "none"} and EV ${candidate.expectedValue ?? "none"}.` : "No market edge is available."
    },
    {
      id: "data-intake",
      label: "Data intake",
      status: dataIntake.status,
      detail: dataIntake.nextItem ? `${dataIntake.summary} Next: ${dataIntake.nextItem.label}.` : dataIntake.summary
    },
    {
      id: "self-audit",
      label: "Self audit",
      status: selfAudit.status,
      detail: `${selfAudit.summary} Trust score ${selfAudit.trustScore}/100.`
    },
    {
      id: "agent-loop",
      label: "Agent loop",
      status: agentLoop.status,
      detail: agentLoop.summary
    },
    {
      id: "brain-slate",
      label: "Brain slate",
      status: brainSlate.status,
      detail: brainSlate.summary
    },
    {
      id: "runtime-readiness",
      label: "Runtime readiness",
      status: readiness?.dataProviders.status ?? "unknown",
      detail: readiness?.dataProviders.detail ?? "Runtime readiness was not provided."
    }
  ];
}

function criticalQuestions(candidate: DecisionAICouncilCandidate | null, selfAudit: DecisionSelfAudit, dataIntake: DecisionDataIntakeQueue): string[] {
  return [
    candidate ? `Would ${candidate.match} still be ${candidate.action} after confirmed lineups, injuries, and market refresh?` : "Which match should the council review first?",
    ...selfAudit.questions.filter((question) => question.status !== "pass").map((question) => `${question.label}: ${question.answer}`),
    dataIntake.nextItem ? `Can ${dataIntake.nextItem.label} be proven with provider data before trust rises?` : "Is the data intake queue clear?"
  ].slice(0, 6);
}

function buildNextOperation(dataIntake: DecisionDataIntakeQueue, agentLoop: DecisionAgentLoop): DecisionAICouncil["nextOperation"] {
  if (dataIntake.nextItem) {
    return {
      label: dataIntake.nextItem.label,
      command: dataIntake.nextItem.command,
      verifyUrl: dataIntake.nextItem.verifyUrl,
      missingEnv: dataIntake.nextItem.missingEnv,
      expectedEvidence: dataIntake.nextItem.expectedEvidence
    };
  }

  return {
    label: agentLoop.activeFocus?.match ?? "Verify agent loop",
    command: agentLoop.autonomy.primaryCommand,
    verifyUrl: agentLoop.verification.verifyUrl,
    missingEnv: agentLoop.autonomy.missingEnv,
    expectedEvidence: agentLoop.verification.expectedStateChange
  };
}

function councilSummary(status: DecisionAICouncilStatus, finalAction: DecisionAction, candidate: DecisionAICouncilCandidate | null, counts: Record<DecisionAction, number>): string {
  const target = candidate ? candidate.match : "the slate";
  if (status === "no-candidates") return "AI council has no candidate to review yet.";
  return `AI council final position is ${finalAction} for ${target}; votes are ${counts.consider} consider, ${counts.monitor} monitor, ${counts.avoid} avoid.`;
}

export function buildDecisionAICouncil({
  rows,
  date,
  sport,
  readiness = null,
  brainSlate,
  selfAudit,
  agentLoop,
  dataIntake,
  limit = 5
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  readiness?: DecisionEngineReadiness | null;
  brainSlate: DecisionBrainSlate;
  selfAudit: DecisionSelfAudit;
  agentLoop: DecisionAgentLoop;
  dataIntake: DecisionDataIntakeQueue;
  limit?: number;
}): DecisionAICouncil {
  const candidates = rows
    .slice()
    .sort((a, b) => rowRank(b) - rowRank(a))
    .slice(0, limit)
    .map(buildCandidate);
  const activeCandidate = candidates[0] ?? null;
  const roleVotes = buildRoleVotes({ candidate: activeCandidate, selfAudit, dataIntake, agentLoop });
  const counts = voteCounts(roleVotes);
  const finalAction = minAction(roleVotes.map((vote) => vote.vote));
  const status = statusForCouncil({ rows, finalAction, candidate: activeCandidate, selfAudit, dataIntake, agentLoop });
  const confidence = confidenceForFinal(finalAction, activeCandidate, roleVotes);
  const risk = riskForFinal(finalAction, activeCandidate);

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    reviewStatus: "not-requested",
    reviewFailureReason: null,
    model: null,
    summary: councilSummary(status, finalAction, activeCandidate, counts),
    finalAction,
    confidence,
    risk,
    canPublishSlate: status === "ready" && finalAction === "consider" && selfAudit.canPublishSlate,
    activeCandidate,
    candidates,
    roleVotes,
    voteCounts: counts,
    evidenceDocket: buildEvidenceDocket({ candidate: activeCandidate, readiness, brainSlate, selfAudit, dataIntake, agentLoop }),
    criticalQuestions: criticalQuestions(activeCandidate, selfAudit, dataIntake),
    guardrails: [
      "Do not upgrade monitor or avoid into consider from AI text alone.",
      "Require positive no-vig edge and positive expected value before any consider action.",
      "Require provider-backed data or an explicit monitor posture when lineups, injuries, odds, or training are missing.",
      "Prefer safer alternatives when the council final action is monitor or avoid.",
      "Persist and settle outcomes before learned guardrails can change live thresholds."
    ],
    nextOperation: buildNextOperation(dataIntake, agentLoop),
    aiReview: null
  };
}

export function safeParseAICouncilReview(text: string): DecisionAICouncilReview | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    if (!isReviewVerdict(parsed.reviewVerdict)) return null;
    if (!isAction(parsed.recommendedAction)) return null;
    const summary = boundedText(parsed.summary, 620);
    if (!summary) return null;
    const roleNotes = Array.isArray(parsed.roleNotes)
      ? parsed.roleNotes
          .map((item): DecisionAICouncilReview["roleNotes"][number] | null => {
            if (!item || typeof item !== "object") return null;
            const record = item as Record<string, unknown>;
            const role = isCouncilRole(record.role) ? record.role : null;
            const note = boundedText(record.note, 280);
            return role && note ? { role, note } : null;
          })
          .filter((item): item is DecisionAICouncilReview["roleNotes"][number] => Boolean(item))
          .slice(0, 6)
      : [];

    return {
      reviewVerdict: parsed.reviewVerdict,
      recommendedAction: parsed.recommendedAction,
      summary,
      rationale: boundedList(parsed.rationale, 6),
      riskFlags: boundedList(parsed.riskFlags, 6),
      dataGaps: boundedList(parsed.dataGaps, 6),
      checksBeforeAction: boundedList(parsed.checksBeforeAction, 6),
      unsupportedClaims: boundedList(parsed.unsupportedClaims, 6),
      roleNotes
    };
  } catch {
    return null;
  }
}

export function buildOpenAIDecisionCouncilPayload({ council, model }: { council: DecisionAICouncil; model: string }) {
  return {
    model,
    store: false,
    reasoning: { effort: "medium", summary: "auto" },
    input: [
      {
        role: "system",
        content:
          "You are OddsPadi's slate-level AI decision council reviewer. Review the public evidence only. Do not invent injuries, lineups, weather, odds, or results. You may agree, downgrade, abstain, or request data. You must not upgrade the local council action."
      },
      {
        role: "user",
        content: JSON.stringify({
          slate: {
            date: council.date,
            sport: council.sport,
            status: council.status,
            finalAction: council.finalAction,
            canPublishSlate: council.canPublishSlate,
            summary: council.summary
          },
          activeCandidate: council.activeCandidate,
          candidates: council.candidates,
          roleVotes: council.roleVotes,
          evidenceDocket: council.evidenceDocket,
          criticalQuestions: council.criticalQuestions,
          guardrails: council.guardrails,
          nextOperation: council.nextOperation,
          requiredRule: "Return a recommendedAction that is the same or safer than the local finalAction."
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "OddsPadiSlateAICouncilReview",
        strict: true,
        schema: aiCouncilReviewSchema
      }
    },
    max_output_tokens: 1400
  };
}

function applyAICouncilReview(council: DecisionAICouncil, review: DecisionAICouncilReview, model: string): DecisionAICouncil {
  const finalAction = safestAction(council.finalAction, review.recommendedAction);
  const status: DecisionAICouncilStatus =
    review.reviewVerdict === "abstain" || review.reviewVerdict === "needs-data"
      ? council.status === "no-candidates"
        ? "no-candidates"
        : "needs-data"
      : council.status;

  return {
    ...council,
    status,
    reviewStatus: "reviewed",
    reviewFailureReason: null,
    model,
    summary: `${review.summary} Local baseline: ${council.summary}`,
    finalAction,
    confidence: finalAction === "avoid" ? "medium" : council.confidence,
    risk: finalAction === "avoid" ? "high" : council.risk,
    canPublishSlate: council.canPublishSlate && finalAction === "consider" && review.reviewVerdict === "agree",
    aiReview: review
  };
}

export async function runOpenAIDecisionCouncilReview({
  council,
  apiKey = process.env.OPENAI_API_KEY,
  model = getDecisionOpenAIModel(),
  fetchImpl = fetch
}: {
  council: DecisionAICouncil;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<DecisionAICouncil> {
  if (!apiKey) {
    return {
      ...council,
      reviewStatus: "not-configured",
      reviewFailureReason: "OPENAI_API_KEY is not configured.",
      model: null
    };
  }

  const payload = buildOpenAIDecisionCouncilPayload({ council, model });

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
      return {
        ...council,
        reviewStatus: "provider-error",
        reviewFailureReason: `OpenAI Responses API returned HTTP ${response.status}.`,
        model
      };
    }

    const outputText = extractOutputText(await response.json());
    if (!outputText) {
      return {
        ...council,
        reviewStatus: "invalid-response",
        reviewFailureReason: "OpenAI response did not include output text.",
        model
      };
    }

    const review = safeParseAICouncilReview(outputText);
    if (!review) {
      return {
        ...council,
        reviewStatus: "invalid-response",
        reviewFailureReason: "OpenAI response did not match the AI council schema.",
        model
      };
    }

    return applyAICouncilReview(council, review, model);
  } catch {
    return {
      ...council,
      reviewStatus: "provider-error",
      reviewFailureReason: "OpenAI request failed before a valid response was received.",
      model
    };
  }
}
