import type { DecisionAutopilot } from "@/lib/sports/prediction/decisionAutopilot";
import type { DecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import type { DecisionInvalidationMonitor } from "@/lib/sports/prediction/decisionInvalidationMonitor";
import type { DecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { decisionCurlCommand } from "@/lib/sports/prediction/decisionUrls";
import type { Match, Prediction, Sport } from "@/lib/sports/types";
import { readDecisionOpenAIProviderError } from "./decisionOpenAIProviderError";
import { extractOutputText } from "./openaiDecisionEnhancer";
import { getDecisionOpenAIModel } from "./openaiModel";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionResearchAgentStatus = "ready" | "needs-data" | "blocked" | "no-candidates";
export type DecisionResearchAgentVerdict = "supports" | "contested" | "reject" | "needs-data";
export type DecisionResearchReviewStatus = "not-requested" | "not-configured" | "reviewed" | "provider-error" | "invalid-response";
export type DecisionResearchEvidenceStatus = "supports" | "opposes" | "missing" | "risk" | "neutral";
export type DecisionResearchQuestionPriority = "critical" | "high" | "medium" | "low";

export type DecisionResearchTarget = {
  matchId: string;
  match: string;
  league: string;
  kickoffTime: string;
  action: Prediction["decision"]["action"];
  verdict: Prediction["decision"]["verdict"];
  selection: string | null;
  decisionScore: number;
  valueEdge: number | null;
  expectedValue: number | null;
  dataCoverageScore: number;
};

export type DecisionResearchEvidence = {
  id: string;
  source: string;
  label: string;
  status: DecisionResearchEvidenceStatus;
  detail: string;
};

export type DecisionResearchQuestion = {
  id: string;
  priority: DecisionResearchQuestionPriority;
  prompt: string;
  evidenceNeeded: string;
  source: string;
  command: string | null;
  verifyUrl: string;
  missingEnv: string[];
  decisionImpact: string;
};

export type DecisionResearchReview = {
  reviewVerdict: "agree" | "challenge" | "needs-data" | "reject";
  summary: string;
  citedEvidenceIds: string[];
  followUpQuestions: string[];
  riskFlags: string[];
  unsupportedClaims: string[];
  toolRequests: Array<{
    label: string;
    source: string;
    reason: string;
  }>;
};

export type DecisionResearchAgent = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionResearchAgentStatus;
  reviewStatus: DecisionResearchReviewStatus;
  reviewFailureReason: string | null;
  model: string | null;
  summary: string;
  target: DecisionResearchTarget | null;
  verdict: DecisionResearchAgentVerdict;
  confidence: Prediction["decision"]["confidence"];
  thesis: {
    primary: string;
    counter: string;
    synthesis: string;
  };
  evidence: DecisionResearchEvidence[];
  openQuestions: DecisionResearchQuestion[];
  contradictionChecks: string[];
  nextResearchAction: DecisionResearchQuestion | null;
  guardrails: string[];
  aiReview: DecisionResearchReview | null;
};

const researchReviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reviewVerdict: { type: "string", enum: ["agree", "challenge", "needs-data", "reject"] },
    summary: { type: "string" },
    citedEvidenceIds: { type: "array", items: { type: "string" } },
    followUpQuestions: { type: "array", items: { type: "string" } },
    riskFlags: { type: "array", items: { type: "string" } },
    unsupportedClaims: { type: "array", items: { type: "string" } },
    toolRequests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
          source: { type: "string" },
          reason: { type: "string" }
        },
        required: ["label", "source", "reason"]
      }
    }
  },
  required: ["reviewVerdict", "summary", "citedEvidenceIds", "followUpQuestions", "riskFlags", "unsupportedClaims", "toolRequests"]
};

function boundedText(value: unknown, max = 360): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function boundedList(value: unknown, maxItems: number, maxText = 260): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => boundedText(item, maxText)).filter(Boolean).slice(0, maxItems);
}

function matchLabel(row: DecisionRow): string {
  return `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`;
}

function rowRank(row: DecisionRow): number {
  const bestPick = row.prediction.bestPick;
  return (
    row.prediction.decision.decisionScore +
    (row.prediction.decision.action === "consider" ? 140 : row.prediction.decision.action === "monitor" ? 70 : 0) +
    (bestPick.hasValue ? Math.max(0, bestPick.expectedValue) * 120 + Math.max(0, bestPick.edge) * 90 : 0) +
    row.match.dataQualityScore * 10
  );
}

function buildTarget(row: DecisionRow): DecisionResearchTarget {
  const bestPick = row.prediction.bestPick;
  return {
    matchId: row.match.id,
    match: matchLabel(row),
    league: row.match.league.name,
    kickoffTime: row.match.kickoffTime,
    action: row.prediction.decision.action,
    verdict: row.prediction.decision.verdict,
    selection: bestPick.hasValue ? bestPick.label : row.prediction.decision.recommendedSelection,
    decisionScore: row.prediction.decision.decisionScore,
    valueEdge: bestPick.hasValue ? bestPick.edge : row.prediction.decision.beliefState.probabilityEdge,
    expectedValue: bestPick.hasValue ? bestPick.expectedValue : row.prediction.decision.beliefState.expectedValue,
    dataCoverageScore: row.prediction.decision.dataCoverage.score
  };
}

function evidenceFromTarget(row: DecisionRow, governance: DecisionModelGovernance, invalidation: DecisionInvalidationMonitor, autopilot: DecisionAutopilot): DecisionResearchEvidence[] {
  const decision = row.prediction.decision;
  const bestPick = row.prediction.bestPick;
  const evidence: DecisionResearchEvidence[] = [
    {
      id: "model-thesis",
      source: "decision.deliberation",
      label: "Primary model thesis",
      status: decision.action === "avoid" ? "risk" : "supports",
      detail: decision.deliberation.primaryThesis
    },
    {
      id: "counter-thesis",
      source: "decision.deliberation",
      label: "Counter thesis",
      status: decision.deliberation.dissentingThesis ? "opposes" : "neutral",
      detail: decision.deliberation.dissentingThesis || "No dissenting thesis is recorded."
    },
    {
      id: "odds-intelligence",
      source: "decision.oddsIntelligence",
      label: "Odds intelligence",
      status: decision.oddsIntelligence.status === "positive-ev" ? "supports" : decision.oddsIntelligence.status === "watchlist" ? "risk" : "opposes",
      detail: bestPick.hasValue
        ? `${decision.oddsIntelligence.summary} Best pick ${bestPick.label}; edge ${bestPick.edge}; EV ${bestPick.expectedValue}.`
        : decision.oddsIntelligence.summary
    },
    {
      id: "probability-trace",
      source: "decision.probabilityTrace",
      label: "Probability trace",
      status: decision.probabilityTrace.status === "ready" ? "supports" : decision.probabilityTrace.status === "watchlist" ? "risk" : "opposes",
      detail: decision.probabilityTrace.summary
    },
    {
      id: "data-coverage",
      source: "decision.dataCoverage",
      label: "Data coverage",
      status: decision.dataCoverage.requiredBeforeTrust.length ? "missing" : decision.dataCoverage.status === "provider-backed" ? "supports" : "risk",
      detail: `${decision.dataCoverage.summary} Required before trust: ${decision.dataCoverage.requiredBeforeTrust.join(" ") || "none"}.`
    },
    {
      id: "market-movement",
      source: "decision.marketMovement",
      label: "Market movement",
      status: decision.marketMovement.status === "resilient" ? "supports" : decision.marketMovement.status === "no-market" ? "missing" : "risk",
      detail: decision.marketMovement.summary
    },
    {
      id: "robustness",
      source: "decision.robustness",
      label: "Robustness",
      status: decision.robustness.status === "robust" ? "supports" : decision.robustness.status === "sensitive" ? "risk" : "opposes",
      detail: decision.robustness.summary
    },
    {
      id: "model-governance",
      source: "model-governance",
      label: "Model governance",
      status: governance.status === "approved" ? "supports" : "missing",
      detail: governance.summary
    },
    {
      id: "invalidation-monitor",
      source: "invalidation-monitor",
      label: "Invalidation state",
      status: invalidation.status === "clear" ? "supports" : invalidation.status === "blocked" ? "missing" : "risk",
      detail: invalidation.summary
    },
    {
      id: "autopilot",
      source: "autopilot",
      label: "Autopilot gate",
      status: autopilot.canPublish ? "supports" : autopilot.status === "blocked" ? "missing" : "risk",
      detail: autopilot.summary
    }
  ];

  return evidence;
}

function questionPriority(status: string): DecisionResearchQuestionPriority {
  if (status === "blocked" || status === "missing" || status === "critical") return "critical";
  if (status === "needs-provider" || status === "high") return "high";
  if (status === "watch" || status === "medium") return "medium";
  return "low";
}

function buildQuestions({
  row,
  dataIntake,
  governance,
  invalidation,
  autopilot
}: {
  row: DecisionRow;
  dataIntake: DecisionDataIntakeQueue;
  governance: DecisionModelGovernance;
  invalidation: DecisionInvalidationMonitor;
  autopilot: DecisionAutopilot;
}): DecisionResearchQuestion[] {
  const decision = row.prediction.decision;
  const dataQuestions = decision.dataCoverage.requiredBeforeTrust.slice(0, 4).map((gap, index): DecisionResearchQuestion => ({
    id: `data-gap-${index + 1}`,
    priority: "critical",
    prompt: `Can this decision be trusted before resolving: ${gap}?`,
    evidenceNeeded: gap,
    source: "decision.dataCoverage.requiredBeforeTrust",
    command: dataIntake.nextItem?.command ?? null,
    verifyUrl: dataIntake.nextItem?.verifyUrl ?? "/api/sports/decision/data-intake",
    missingEnv: dataIntake.nextItem?.missingEnv ?? [],
    decisionImpact: "Blocks upgrade from research/watchlist into trusted action until evidence is provider-backed or explicitly unavailable."
  }));
  const intakeQuestion = dataIntake.nextItem
    ? [
        {
          id: "data-intake-next",
          priority: questionPriority(dataIntake.nextItem.status),
          prompt: `Can the provider gap "${dataIntake.nextItem.label}" be proven now?`,
          evidenceNeeded: dataIntake.nextItem.expectedEvidence,
          source: `data-intake:${dataIntake.nextItem.category}`,
          command: dataIntake.nextItem.command,
          verifyUrl: dataIntake.nextItem.verifyUrl,
          missingEnv: dataIntake.nextItem.missingEnv,
          decisionImpact: dataIntake.nextItem.decisionImpact
        } satisfies DecisionResearchQuestion
      ]
    : [];
  const governanceQuestion =
    governance.status === "approved"
      ? []
      : [
          {
            id: "governance-next",
            priority: governance.status === "blocked" ? "critical" : "high",
            prompt: "Can learned guardrails be trusted for this slate?",
            evidenceNeeded: governance.nextActions[0] ?? governance.summary,
            source: "model-governance",
            command: decisionCurlCommand("/api/sports/decision/model-governance"),
            verifyUrl: "/api/sports/decision/model-governance",
            missingEnv: governance.trainingCorpus.configured ? [] : ["SUPABASE_SERVICE_ROLE_KEY"],
            decisionImpact: "Keeps learned thresholds in shadow mode until real corpus, target labels, backtests, runtime storage, and drift evidence pass."
          } satisfies DecisionResearchQuestion
        ];
  const invalidationQuestion = invalidation.nextJob
    ? [
        {
          id: "invalidation-next",
          priority: invalidation.nextJob.priority,
          prompt: `Does the stale or risky state still hold after ${invalidation.nextJob.kind.replaceAll("-", " ")}?`,
          evidenceNeeded: invalidation.nextJob.expectedEvidence,
          source: `invalidation:${invalidation.nextJob.kind}`,
          command: invalidation.nextJob.command,
          verifyUrl: invalidation.nextJob.verifyUrl,
          missingEnv: invalidation.nextJob.missingEnv,
          decisionImpact: invalidation.nextJob.riskIfIgnored
        } satisfies DecisionResearchQuestion
      ]
    : [];
  const autopilotQuestion = autopilot.nextAction
    ? [
        {
          id: "autopilot-next",
          priority: autopilot.nextAction.priority,
          prompt: `Should the bounded agent run ${autopilot.nextAction.label}?`,
          evidenceNeeded: autopilot.nextAction.expectedEvidence,
          source: autopilot.nextAction.source,
          command: autopilot.nextAction.command,
          verifyUrl: autopilot.nextAction.verifyUrl,
          missingEnv: autopilot.nextAction.missingEnv,
          decisionImpact: autopilot.nextAction.riskIfSkipped
        } satisfies DecisionResearchQuestion
      ]
    : [];

  return [...dataQuestions, ...intakeQuestion, ...governanceQuestion, ...invalidationQuestion, ...autopilotQuestion].slice(0, 9);
}

function contradictionChecks(row: DecisionRow, governance: DecisionModelGovernance, invalidation: DecisionInvalidationMonitor, autopilot: DecisionAutopilot): string[] {
  const decision = row.prediction.decision;
  return [
    decision.oddsIntelligence.status === "positive-ev" && decision.dataCoverage.requiredBeforeTrust.length
      ? "Positive EV is present, but data coverage still has required-before-trust gaps."
      : "",
    decision.action === "consider" && governance.status !== "approved"
      ? "The local action leans toward consideration, but learned guardrails are not governance-approved."
      : "",
    invalidation.expiredBeliefs > 0 ? "At least one belief snapshot has expired; stale edges must be rerun before trust rises." : "",
    autopilot.canPublish ? "" : "Autopilot does not allow publishing under the current evidence state.",
    decision.marketMovement.status === "fragile" || decision.marketMovement.status === "sensitive"
      ? "Market movement can erase the value edge before action."
      : ""
  ].filter(Boolean);
}

function researchVerdict({
  row,
  governance,
  invalidation,
  questions
}: {
  row: DecisionRow;
  governance: DecisionModelGovernance;
  invalidation: DecisionInvalidationMonitor;
  questions: DecisionResearchQuestion[];
}): DecisionResearchAgentVerdict {
  if (governance.status === "blocked" || invalidation.status === "blocked" || questions.some((question) => question.priority === "critical" && question.missingEnv.length)) {
    return "needs-data";
  }
  if (row.prediction.decision.action === "avoid") return "reject";
  if (questions.some((question) => question.priority === "critical" || question.priority === "high")) return "contested";
  return "supports";
}

function agentStatus(verdict: DecisionResearchAgentVerdict, target: DecisionResearchTarget | null): DecisionResearchAgentStatus {
  if (!target) return "no-candidates";
  if (verdict === "needs-data") return "blocked";
  if (verdict === "contested") return "needs-data";
  return "ready";
}

function summary(status: DecisionResearchAgentStatus, target: DecisionResearchTarget | null, verdict: DecisionResearchAgentVerdict): string {
  if (!target) return "Research agent has no candidate to investigate.";
  if (status === "blocked") return `Research agent blocks ${target.match}; verdict is ${verdict} until missing evidence is resolved.`;
  if (status === "needs-data") return `Research agent keeps ${target.match} in research mode; verdict is ${verdict}.`;
  return `Research agent verdict for ${target.match} is ${verdict}.`;
}

export function safeParseResearchReview(text: string): DecisionResearchReview | null {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const reviewVerdict = parsed.reviewVerdict;
    if (reviewVerdict !== "agree" && reviewVerdict !== "challenge" && reviewVerdict !== "needs-data" && reviewVerdict !== "reject") return null;
    const toolRequests = Array.isArray(parsed.toolRequests)
      ? parsed.toolRequests
          .map((item): DecisionResearchReview["toolRequests"][number] | null => {
            if (!item || typeof item !== "object") return null;
            const record = item as Record<string, unknown>;
            const label = boundedText(record.label, 120);
            const source = boundedText(record.source, 100);
            const reason = boundedText(record.reason, 260);
            return label && source && reason ? { label, source, reason } : null;
          })
          .filter((item): item is DecisionResearchReview["toolRequests"][number] => Boolean(item))
          .slice(0, 6)
      : [];
    const summaryText = boundedText(parsed.summary, 620);
    if (!summaryText) return null;

    return {
      reviewVerdict,
      summary: summaryText,
      citedEvidenceIds: boundedList(parsed.citedEvidenceIds, 12, 100),
      followUpQuestions: boundedList(parsed.followUpQuestions, 8),
      riskFlags: boundedList(parsed.riskFlags, 8),
      unsupportedClaims: boundedList(parsed.unsupportedClaims, 8),
      toolRequests
    };
  } catch {
    return null;
  }
}

export function buildDecisionResearchAgent({
  rows,
  date,
  sport,
  dataIntake,
  governance,
  invalidationMonitor,
  autopilot
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  dataIntake: DecisionDataIntakeQueue;
  governance: DecisionModelGovernance;
  invalidationMonitor: DecisionInvalidationMonitor;
  autopilot: DecisionAutopilot;
}): DecisionResearchAgent {
  const row = rows.slice().sort((a, b) => rowRank(b) - rowRank(a))[0] ?? null;
  if (!row) {
    return {
      generatedAt: new Date().toISOString(),
      date,
      sport,
      status: "no-candidates",
      reviewStatus: "not-requested",
      reviewFailureReason: null,
      model: null,
      summary: "Research agent has no candidate to investigate.",
      target: null,
      verdict: "needs-data",
      confidence: "low",
      thesis: {
        primary: "No primary thesis is available.",
        counter: "No counter thesis is available.",
        synthesis: "No synthesis is available."
      },
      evidence: [],
      openQuestions: [],
      contradictionChecks: [],
      nextResearchAction: null,
      guardrails: ["Do not invent missing evidence."],
      aiReview: null
    };
  }

  const target = buildTarget(row);
  const evidence = evidenceFromTarget(row, governance, invalidationMonitor, autopilot);
  const openQuestions = buildQuestions({ row, dataIntake, governance, invalidation: invalidationMonitor, autopilot });
  const verdict = researchVerdict({ row, governance, invalidation: invalidationMonitor, questions: openQuestions });
  const status = agentStatus(verdict, target);

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    reviewStatus: "not-requested",
    reviewFailureReason: null,
    model: null,
    summary: summary(status, target, verdict),
    target,
    verdict,
    confidence: row.prediction.decision.confidence,
    thesis: {
      primary: row.prediction.decision.deliberation.primaryThesis,
      counter: row.prediction.decision.deliberation.dissentingThesis,
      synthesis: row.prediction.decision.deliberation.synthesis
    },
    evidence,
    openQuestions,
    contradictionChecks: contradictionChecks(row, governance, invalidationMonitor, autopilot),
    nextResearchAction: openQuestions[0] ?? null,
    guardrails: [
      "Use only supplied evidence IDs, provider responses, or verified runtime state.",
      "Do not invent injuries, suspensions, lineups, weather, news, odds, or live events.",
      "A positive EV number is research-only until data coverage, invalidation, and governance gates pass.",
      "AI review may challenge or request data, but it must not upgrade the deterministic action.",
      "Every research conclusion must point to a verification URL or explicitly remain unresolved."
    ],
    aiReview: null
  };
}

export function buildOpenAIResearchAgentPayload({ research, model }: { research: DecisionResearchAgent; model: string }) {
  return {
    model,
    store: false,
    reasoning: { effort: "medium", summary: "auto" },
    input: [
      {
        role: "system",
        content:
          "You are OddsPadi's bounded sports research reviewer. Use only the supplied JSON evidence. Do not invent injuries, suspensions, lineups, weather, news, odds, scores, or private facts. Cite supplied evidence IDs. You may agree, challenge, reject, or request data. Do not upgrade the deterministic verdict."
      },
      {
        role: "user",
        content: JSON.stringify({
          research,
          requiredOutput: "Return a concise public research critique with cited evidence IDs, follow-up questions, risk flags, unsupported claims, and tool requests."
        })
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "OddsPadiResearchAgentReview",
        strict: true,
        schema: researchReviewSchema
      }
    },
    max_output_tokens: 1300
  };
}

function applyResearchReview(research: DecisionResearchAgent, review: DecisionResearchReview, model: string): DecisionResearchAgent {
  const knownEvidenceIds = new Set(research.evidence.map((item) => item.id));
  const citedEvidenceIds = review.citedEvidenceIds.filter((id) => knownEvidenceIds.has(id));
  const status: DecisionResearchAgentStatus =
    review.reviewVerdict === "needs-data" || review.unsupportedClaims.length
      ? "needs-data"
      : review.reviewVerdict === "reject"
        ? "blocked"
        : review.reviewVerdict === "challenge"
          ? research.status === "ready"
            ? "needs-data"
            : research.status
          : research.status;

  return {
    ...research,
    status,
    reviewStatus: "reviewed",
    reviewFailureReason: null,
    model,
    summary: `${review.summary} Baseline: ${research.summary}`,
    verdict:
      review.reviewVerdict === "reject"
        ? "reject"
        : review.reviewVerdict === "needs-data"
          ? "needs-data"
          : review.reviewVerdict === "challenge"
            ? "contested"
            : research.verdict,
    openQuestions: [
      ...review.followUpQuestions.slice(0, 4).map((question, index): DecisionResearchQuestion => ({
        id: `ai-follow-up-${index + 1}`,
        priority: "high",
        prompt: question,
        evidenceNeeded: question,
        source: "openai-research-review",
        command: research.nextResearchAction?.command ?? null,
        verifyUrl: research.nextResearchAction?.verifyUrl ?? "/api/sports/decision/research-agent",
        missingEnv: research.nextResearchAction?.missingEnv ?? [],
        decisionImpact: "AI research critique says this question must be answered before trust rises."
      })),
      ...research.openQuestions
    ].slice(0, 10),
    contradictionChecks: Array.from(new Set([...research.contradictionChecks, ...review.riskFlags, ...review.unsupportedClaims])).slice(0, 10),
    aiReview: {
      ...review,
      citedEvidenceIds
    }
  };
}

export async function runOpenAIResearchAgentReview({
  research,
  apiKey = process.env.OPENAI_API_KEY,
  model = getDecisionOpenAIModel(),
  fetchImpl = fetch
}: {
  research: DecisionResearchAgent;
  apiKey?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}): Promise<DecisionResearchAgent> {
  if (!apiKey) {
    return {
      ...research,
      reviewStatus: "not-configured",
      reviewFailureReason: "OPENAI_API_KEY is not configured.",
      model: null
    };
  }

  const payload = buildOpenAIResearchAgentPayload({ research, model });

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
      const providerError = await readDecisionOpenAIProviderError(response);
      return {
        ...research,
        reviewStatus: "provider-error",
        reviewFailureReason: providerError.reason,
        model
      };
    }

    const outputText = extractOutputText(await response.json());
    if (!outputText) {
      return {
        ...research,
        reviewStatus: "invalid-response",
        reviewFailureReason: "OpenAI response did not include output text.",
        model
      };
    }

    const review = safeParseResearchReview(outputText);
    if (!review) {
      return {
        ...research,
        reviewStatus: "invalid-response",
        reviewFailureReason: "OpenAI response did not match the research-agent review schema.",
        model
      };
    }

    return applyResearchReview(research, review, model);
  } catch {
    return {
      ...research,
      reviewStatus: "provider-error",
      reviewFailureReason: "OpenAI research-agent review failed before a valid response was received.",
      model
    };
  }
}
