import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import type { DecisionAdversarialPanel, DecisionAdversarialPanelCase } from "@/lib/sports/prediction/decisionAdversarialPanel";
import type { DecisionModelMathProof } from "@/lib/sports/prediction/decisionModelMathProof";
import type { DecisionOddsIntelligenceProof } from "@/lib/sports/prediction/decisionOddsIntelligenceProof";
import type { DecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import type { DecisionAction, Sport } from "@/lib/sports/types";

export type DecisionBriefingStatus = "ready-watchlist" | "needs-review" | "blocked" | "no-candidates";
export type DecisionBriefingPosture = "monitor-only" | "avoid" | "hold";

export type DecisionBriefingPersistenceStatus = "skipped" | "stored" | "failed";

export type DecisionBriefingPersistenceResult = {
  requested: boolean;
  status: DecisionBriefingPersistenceStatus;
  configured: boolean;
  table: "op_decision_briefings";
  id?: string;
  readback?: {
    id: string;
    briefingHash: string;
    status: string;
    action: string;
    targetMatchId: string | null;
    targetMatch: string | null;
    targetSelection: string | null;
    payloadMode: string | null;
  };
  reason?: string;
};

export type DecisionBriefingProof = {
  id: string;
  label: string;
  status: "support" | "watch" | "block";
  detail: string;
  proofUrl: string;
};

export type DecisionBriefing = {
  mode: "decision-briefing";
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionBriefingStatus;
  briefingHash: string;
  headline: string;
  posture: DecisionBriefingPosture;
  action: DecisionAction | "hold";
  target: {
    matchId: string | null;
    match: string | null;
    league: string | null;
    selection: string | null;
  };
  probability: {
    model: number | null;
    market: number | null;
    posterior: number | null;
    edge: number | null;
    expectedValue: number | null;
  };
  thesis: string;
  counterThesis: string;
  decision: string;
  risks: string[];
  saferAlternatives: string[];
  nextEvidence: string[];
  proofChain: DecisionBriefingProof[];
  controls: {
    canInspectReadOnly: true;
    canPersist: false;
    canPublish: false;
    canTrain: false;
    canStake: false;
    canCallOpenAI: false;
    canUpgradePublicAction: false;
  };
  proofUrls: string[];
  locks: string[];
  persistence?: DecisionBriefingPersistenceResult;
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

function compact(value: string, maxLength = 260): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function unique(values: Array<string | null | undefined>, limit = 8): string[] {
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

function proofStatus(value: "ready-proof" | "needs-provider" | "watch" | "blocked" | "cleared" | "contested" | "no-candidates" | "missing-key" | "suspicious-key" | "contract-waiting" | "ready-to-request"): DecisionBriefingProof["status"] {
  if (value === "ready-proof" || value === "cleared" || value === "ready-to-request") return "support";
  if (value === "blocked" || value === "no-candidates" || value === "missing-key" || value === "suspicious-key") return "block";
  return "watch";
}

function statusFor(topCase: DecisionAdversarialPanelCase | null, openAi: DecisionOpenAIKeyDiagnostic): DecisionBriefingStatus {
  if (!topCase) return "no-candidates";
  if (topCase.status === "blocked") return "blocked";
  if (topCase.status === "watch" || openAi.status !== "ready-to-request") return "needs-review";
  return "ready-watchlist";
}

function postureFor(status: DecisionBriefingStatus): DecisionBriefingPosture {
  if (status === "ready-watchlist" || status === "needs-review") return "monitor-only";
  if (status === "blocked") return "avoid";
  return "hold";
}

function actionFor(status: DecisionBriefingStatus, topCase: DecisionAdversarialPanelCase | null): DecisionAction | "hold" {
  if (!topCase) return "hold";
  if (status === "blocked") return "avoid";
  return topCase.panelAction === "consider" ? "monitor" : topCase.panelAction;
}

function target(topCase: DecisionAdversarialPanelCase | null): DecisionBriefing["target"] {
  return {
    matchId: topCase?.matchId ?? null,
    match: topCase?.match ?? null,
    league: topCase?.league ?? null,
    selection: topCase?.selection ?? null
  };
}

function probability(topCase: DecisionAdversarialPanelCase | null): DecisionBriefing["probability"] {
  return {
    model: topCase?.modelProbability ?? null,
    market: topCase?.marketProbability ?? null,
    posterior: topCase?.posteriorProbability ?? null,
    edge: topCase?.edge ?? null,
    expectedValue: topCase?.expectedValue ?? null
  };
}

function decimal(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return Number(value.toFixed(6));
}

function thesis(topCase: DecisionAdversarialPanelCase | null, odds: DecisionOddsIntelligenceProof): string {
  if (!topCase) return "No candidate survived far enough to brief.";
  const edge = topCase.edge === null ? "unknown edge" : `${(topCase.edge * 100).toFixed(1)}% edge`;
  const ev = topCase.expectedValue === null ? "unknown EV" : `${(topCase.expectedValue * 100).toFixed(1)}% EV`;
  return compact(
    `${topCase.match} ${topCase.selection ?? "candidate"} is the active brief because the panel reviewed ${topCase.evidenceNodeCount} evidence node(s), the market proof ranked ${odds.totals.positiveValue} value row(s), and the candidate shows ${edge} with ${ev}.`
  );
}

function counterThesis(topCase: DecisionAdversarialPanelCase | null, openAi: DecisionOpenAIKeyDiagnostic): string {
  if (!topCase) return "The counter-thesis is that the slate has no candidate with enough evidence to brief.";
  if (topCase.avoidReason) return compact(topCase.avoidReason);
  if (openAi.status !== "ready-to-request") return compact(openAi.summary);
  const firstRisk = topCase.risks[0];
  return compact(firstRisk ?? "The counter-thesis is that market price, data freshness, or late team news could erase the edge.");
}

function decision(status: DecisionBriefingStatus, topCase: DecisionAdversarialPanelCase | null): string {
  if (!topCase) return "Hold. The engine has no candidate to present.";
  if (status === "blocked") return `Avoid. ${topCase.nextCheck}`;
  if (status === "needs-review") return `Monitor only. ${topCase.nextCheck}`;
  return "Monitor-only candidate. It still cannot publish, stake, persist, train, or upgrade public action.";
}

function proofChain({
  modelMathProof,
  oddsIntelligenceProof,
  adversarialPanel,
  openAiKeyDiagnostic
}: {
  modelMathProof: DecisionModelMathProof;
  oddsIntelligenceProof: DecisionOddsIntelligenceProof;
  adversarialPanel: DecisionAdversarialPanel;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
}): DecisionBriefingProof[] {
  return [
    {
      id: "model-math",
      label: "Model math",
      status: proofStatus(modelMathProof.status),
      detail: modelMathProof.summary,
      proofUrl: "/api/sports/decision/model-math-proof"
    },
    {
      id: "odds-intelligence",
      label: "Odds intelligence",
      status: proofStatus(oddsIntelligenceProof.status),
      detail: oddsIntelligenceProof.summary,
      proofUrl: "/api/sports/decision/odds-intelligence-proof"
    },
    {
      id: "adversarial-panel",
      label: "Adversarial panel",
      status: proofStatus(adversarialPanel.status),
      detail: adversarialPanel.summary,
      proofUrl: "/api/sports/decision/adversarial-panel"
    },
    {
      id: "openai-live-review",
      label: "OpenAI live review",
      status: proofStatus(openAiKeyDiagnostic.status),
      detail: openAiKeyDiagnostic.summary,
      proofUrl: "/api/sports/decision/openai-key-diagnostic"
    }
  ];
}

export function buildDecisionBriefing({
  date,
  sport,
  modelMathProof,
  oddsIntelligenceProof,
  adversarialPanel,
  openAiKeyDiagnostic,
  now = new Date()
}: {
  date: string;
  sport: Sport;
  modelMathProof: DecisionModelMathProof;
  oddsIntelligenceProof: DecisionOddsIntelligenceProof;
  adversarialPanel: DecisionAdversarialPanel;
  openAiKeyDiagnostic: DecisionOpenAIKeyDiagnostic;
  now?: Date;
}): DecisionBriefing {
  const topCase = adversarialPanel.topCase;
  const status = statusFor(topCase, openAiKeyDiagnostic);
  const posture = postureFor(status);
  const action = actionFor(status, topCase);
  const chain = proofChain({ modelMathProof, oddsIntelligenceProof, adversarialPanel, openAiKeyDiagnostic });
  const nextEvidence = unique(
    [
      topCase?.nextCheck,
      topCase?.risks[0],
      openAiKeyDiagnostic.status === "ready-to-request" ? null : openAiKeyDiagnostic.nextStep.expectedEvidence,
      modelMathProof.sports.find((item) => item.sport === sport)?.proxyOrMissingInputs[0],
      oddsIntelligenceProof.proofChecks.find((item) => item.status !== "pass")?.detail
    ],
    6
  );
  const headline =
    status === "ready-watchlist"
      ? `${topCase?.match ?? "Candidate"} is monitor-ready after adversarial review.`
      : status === "needs-review"
        ? `${topCase?.match ?? "Candidate"} stays monitor-only until review gates clear.`
        : status === "blocked"
          ? `${topCase?.match ?? "Candidate"} is blocked by the decision panel.`
          : "No decision candidate is ready to brief.";
  const briefingHash = stableHash({
    date,
    sport,
    status,
    target: topCase?.matchId ?? null,
    action,
    chain: chain.map((item) => [item.id, item.status])
  });

  return {
    mode: "decision-briefing",
    generatedAt: now.toISOString(),
    date,
    sport,
    status,
    briefingHash,
    headline,
    posture,
    action,
    target: target(topCase),
    probability: probability(topCase),
    thesis: thesis(topCase, oddsIntelligenceProof),
    counterThesis: counterThesis(topCase, openAiKeyDiagnostic),
    decision: decision(status, topCase),
    risks: unique([...(topCase?.risks ?? []), ...chain.filter((item) => item.status !== "support").map((item) => item.detail)], 8),
    saferAlternatives: unique(topCase?.saferAlternatives ?? ["Hold until provider and review gates are configured."], 6),
    nextEvidence,
    proofChain: chain,
    controls: {
      canInspectReadOnly: true,
      canPersist: false,
      canPublish: false,
      canTrain: false,
      canStake: false,
      canCallOpenAI: false,
      canUpgradePublicAction: false
    },
    proofUrls: unique(["/api/sports/decision/briefing", ...chain.map((item) => item.proofUrl)], 12),
    locks: [
      "Briefing is a read-only operator summary, not a betting instruction.",
      "The briefing can lower or hold public posture; it cannot publish, stake, persist, train, call OpenAI, or upgrade public action.",
      "The briefing summarizes public evidence only and does not expose hidden chain-of-thought."
    ]
  };
}

export function buildDecisionBriefingPersistencePayload(briefing: DecisionBriefing): Record<string, unknown> {
  return {
    briefing_date: briefing.date,
    sport: briefing.sport,
    briefing_hash: briefing.briefingHash,
    status: briefing.status,
    posture: briefing.posture,
    action: briefing.action,
    target_match_id: briefing.target.matchId,
    target_match: briefing.target.match,
    target_league: briefing.target.league,
    target_selection: briefing.target.selection,
    model_probability: decimal(briefing.probability.model),
    market_probability: decimal(briefing.probability.market),
    posterior_probability: decimal(briefing.probability.posterior),
    value_edge: decimal(briefing.probability.edge),
    expected_value: decimal(briefing.probability.expectedValue),
    headline: briefing.headline,
    thesis: briefing.thesis,
    counter_thesis: briefing.counterThesis,
    decision: briefing.decision,
    risks: briefing.risks,
    safer_alternatives: briefing.saferAlternatives,
    next_evidence: briefing.nextEvidence,
    proof_chain: briefing.proofChain,
    proof_urls: briefing.proofUrls,
    locks: briefing.locks,
    payload: {
      ...briefing,
      persistence: undefined
    }
  };
}

export async function persistDecisionBriefing(briefing: DecisionBriefing): Promise<DecisionBriefingPersistenceResult> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return {
      requested: true,
      status: "skipped",
      configured: false,
      table: "op_decision_briefings",
      reason: `Supabase server writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    };
  }

  const client = getSupabaseServerClient();
  if (!client) {
    return {
      requested: true,
      status: "failed",
      configured: true,
      table: "op_decision_briefings",
      reason: "Supabase client could not be created."
    };
  }

  const { data, error } = await client
    .from("op_decision_briefings")
    .upsert(buildDecisionBriefingPersistencePayload(briefing), { onConflict: "briefing_hash" })
    .select("id, briefing_hash, status, action, target_match_id, target_match, target_selection, payload")
    .single();

  if (error) {
    return {
      requested: true,
      status: "failed",
      configured: true,
      table: "op_decision_briefings",
      reason: error.message
    };
  }

  return {
    requested: true,
    status: "stored",
    configured: true,
    table: "op_decision_briefings",
    id: typeof data?.id === "string" ? data.id : undefined,
    readback:
      typeof data?.id === "string"
        ? {
            id: data.id,
            briefingHash: typeof data.briefing_hash === "string" ? data.briefing_hash : "",
            status: typeof data.status === "string" ? data.status : "",
            action: typeof data.action === "string" ? data.action : "",
            targetMatchId: typeof data.target_match_id === "string" ? data.target_match_id : null,
            targetMatch: typeof data.target_match === "string" ? data.target_match : null,
            targetSelection: typeof data.target_selection === "string" ? data.target_selection : null,
            payloadMode:
              data.payload && typeof data.payload === "object" && "mode" in data.payload && typeof data.payload.mode === "string"
                ? data.payload.mode
                : null
          }
        : undefined
  };
}
