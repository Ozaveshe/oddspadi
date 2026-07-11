import { hasConfiguredEnv } from "@/lib/env";
import type { DecisionAIOrchestrator } from "@/lib/sports/prediction/decisionAIOrchestrator";
import type { DecisionAIReviewLedger } from "@/lib/sports/prediction/decisionAIReviewLedger";
import type { DecisionMetacognition } from "@/lib/sports/prediction/decisionMetacognition";
import { buildAiAgentEvidencePacket } from "@/lib/sports/prediction/openaiDecisionAgent";
import type { DecisionAction, Match, Prediction, Sport } from "@/lib/sports/types";

type DecisionRow = {
  match: Match;
  prediction: Prediction;
};

export type DecisionAIHandoffStatus = "ready" | "needs-config" | "blocked";

export type DecisionAIHandoffEvidenceItem = {
  id: string;
  source: string;
  label: string;
  status: string | null;
  detail: string;
};

export type DecisionAIHandoffPacket = {
  generatedAt: string;
  date: string;
  sport: Sport;
  status: DecisionAIHandoffStatus;
  mode: "responses-api-json-schema-handoff";
  packetHash: string;
  inputHash: string;
  summary: string;
  model: string;
  activeTarget: {
    matchId: string | null;
    label: string;
    baselineAction: DecisionAction | null;
    maximumAllowedAction: DecisionAction | null;
    verifyUrl: string;
  } | null;
  evidence: {
    totalAvailable: number;
    included: number;
    ids: string[];
    items: DecisionAIHandoffEvidenceItem[];
  };
  prompt: {
    system: string;
    user: Record<string, unknown>;
  };
  outputContract: {
    schemaName: "OddsPadiAIHandoffReview";
    mustCiteEvidenceIds: true;
    sameOrSaferOnly: true;
    requiredFields: string[];
    actionRankRule: string;
  };
  requestPreview: {
    model: string;
    store: false;
    reasoning: {
      effort: "medium";
      summary: "auto";
    };
    input: Array<{
      role: "system" | "user";
      content: string;
    }>;
    text: {
      format: {
        type: "json_schema";
        name: "OddsPadiAIHandoffReview";
        strict: true;
        schema: Record<string, unknown>;
      };
    };
    max_output_tokens: number;
  };
  runbook: {
    canSubmitToOpenAI: boolean;
    missingEnv: string[];
    blockedBy: string[];
    command: string | null;
    verifyUrl: string | null;
    forbiddenActions: string[];
  };
};

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    reviewVerdict: { type: "string", enum: ["agree", "downgrade", "abstain", "needs-data"] },
    recommendedAction: { type: "string", enum: ["consider", "monitor", "avoid"] },
    confidenceAdjustment: { type: "string", enum: ["keep", "lower"] },
    riskAdjustment: { type: "string", enum: ["keep", "raise"] },
    summary: { type: "string" },
    reasoningTrace: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          stage: { type: "string" },
          finding: { type: "string" },
          citedEvidenceIds: { type: "array", items: { type: "string" } }
        },
        required: ["stage", "finding", "citedEvidenceIds"]
      }
    },
    evidenceChecks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          status: { type: "string", enum: ["supports", "opposes", "uncertain", "missing"] },
          citedEvidenceIds: { type: "array", items: { type: "string" } },
          finding: { type: "string" },
          requiredFollowUp: { type: ["string", "null"] }
        },
        required: ["id", "label", "status", "citedEvidenceIds", "finding", "requiredFollowUp"]
      }
    },
    safetyGates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          label: { type: "string" },
          status: { type: "string", enum: ["pass", "warn", "block"] },
          reason: { type: "string" }
        },
        required: ["id", "label", "status", "reason"]
      }
    },
    unsupportedClaims: { type: "array", items: { type: "string" } },
    dataGaps: { type: "array", items: { type: "string" } },
    saferAlternatives: { type: "array", items: { type: "string" } },
    checksBeforeAction: { type: "array", items: { type: "string" } }
  },
  required: [
    "reviewVerdict",
    "recommendedAction",
    "confidenceAdjustment",
    "riskAdjustment",
    "summary",
    "reasoningTrace",
    "evidenceChecks",
    "safetyGates",
    "unsupportedClaims",
    "dataGaps",
    "saferAlternatives",
    "checksBeforeAction"
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

function compact(value: string, max = 360): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function envConfigured(env: Record<string, string | undefined>, key: string): boolean {
  return hasConfiguredEnv(env, key);
}

function unique(values: string[], limit = 10): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, limit);
}

function commandIsSafe(command: string | null): boolean {
  if (!command) return false;
  const lower = command.toLowerCase();
  return lower.includes("curl.exe") && !lower.includes("persist=1") && !lower.includes("persist=true") && !lower.includes("-x post");
}

function targetRow(rows: DecisionRow[], orchestrator: DecisionAIOrchestrator, metacognition: DecisionMetacognition): DecisionRow | null {
  const targetId = orchestrator.activeTarget?.matchId ?? metacognition.activeBelief?.matchId ?? null;
  if (targetId) return rows.find((row) => row.match.id === targetId) ?? rows[0] ?? null;
  return rows[0] ?? null;
}

function evidenceItems(row: DecisionRow | null, limit: number): { total: number; items: DecisionAIHandoffEvidenceItem[] } {
  if (!row) return { total: 0, items: [] };
  const packet = buildAiAgentEvidencePacket(row.prediction.decision);
  return {
    total: packet.length,
    items: packet.slice(0, limit).map((item) => ({
      id: item.id,
      source: item.source,
      label: item.label,
      status: item.status ?? null,
      detail: compact(item.detail)
    }))
  };
}

function systemPrompt(): string {
  return [
    "You are OddsPadi's guarded AI decision reviewer.",
    "Use only the supplied JSON evidence and cited evidence IDs.",
    "Do not invent injuries, lineups, suspensions, weather, news, odds, live scores, bookmaker moves, or private data.",
    "You may agree, downgrade, abstain, or request more data.",
    "You must never recommend a stronger action than the deterministic baseline.",
    "Return strict JSON that matches the provided schema."
  ].join(" ");
}

function statusFor({
  metacognition,
  aiReviewLedger,
  missingEnv,
  blockedBy
}: {
  metacognition: DecisionMetacognition;
  aiReviewLedger: DecisionAIReviewLedger;
  missingEnv: string[];
  blockedBy: string[];
}): DecisionAIHandoffStatus {
  if (metacognition.status === "blocked" || aiReviewLedger.status === "blocked" || blockedBy.length) return "blocked";
  if (missingEnv.length || !aiReviewLedger.controlContract.submitToOpenAIAllowed) return "needs-config";
  return "ready";
}

export function buildDecisionAIHandoffPacket({
  rows,
  date,
  sport,
  orchestrator,
  aiReviewLedger,
  metacognition,
  env = process.env,
  evidenceLimit = 36
}: {
  rows: DecisionRow[];
  date: string;
  sport: Sport;
  orchestrator: DecisionAIOrchestrator;
  aiReviewLedger: DecisionAIReviewLedger;
  metacognition: DecisionMetacognition;
  env?: Record<string, string | undefined>;
  evidenceLimit?: number;
}): DecisionAIHandoffPacket {
  const row = targetRow(rows, orchestrator, metacognition);
  const evidence = evidenceItems(row, evidenceLimit);
  const evidenceIds = evidence.items.map((item) => item.id);
  const missingEnv = envConfigured(env, "OPENAI_API_KEY") ? [] : ["OPENAI_API_KEY"];
  const activeCommand = orchestrator.activeTarget?.command ?? aiReviewLedger.runbook.firstReviewCommand ?? null;
  const blockedBy = unique([
    ...(orchestrator.activeTarget?.missingEnv ?? []),
    ...aiReviewLedger.runbook.requiredBeforeReview,
    ...(metacognition.status === "blocked" ? [metacognition.primaryDoubt] : []),
    commandIsSafe(activeCommand) || !activeCommand ? "" : "review command is not safe for no-persistence handoff"
  ]);
  const status = statusFor({ metacognition, aiReviewLedger, missingEnv, blockedBy });
  const baselineAction = row?.prediction.decision.action ?? null;
  const user = {
    date,
    sport,
    activeTarget: orchestrator.activeTarget,
    metacognition: {
      status: metacognition.status,
      mode: metacognition.mode,
      activeBelief: metacognition.activeBelief,
      primaryDoubt: metacognition.primaryDoubt,
      changeMyMind: metacognition.changeMyMind,
      stages: metacognition.stages.map((stage) => ({
        id: stage.id,
        status: stage.status,
        thought: stage.thought,
        nextQuestion: stage.nextQuestion
      }))
    },
    deterministicDecision: row
      ? {
          matchId: row.match.id,
          match: `${row.match.homeTeam.name} vs ${row.match.awayTeam.name}`,
          league: row.match.league.name,
          kickoffTime: row.match.kickoffTime,
          baselineAction: row.prediction.decision.action,
          verdict: row.prediction.decision.verdict,
          confidence: row.prediction.decision.confidence,
          risk: row.prediction.decision.risk,
          decisionScore: row.prediction.decision.decisionScore,
          summary: row.prediction.decision.summary,
          bestPick: row.prediction.bestPick,
          dataCoverage: row.prediction.decision.dataCoverage.summary,
          controlPolicy: row.prediction.decision.controlPolicy.summary,
          saferAlternatives: row.prediction.decision.saferAlternatives
        }
      : null,
    evidence: evidence.items,
    outputRules: {
      evidenceIds,
      maximumAllowedAction: baselineAction,
      actionRankRule: "avoid < monitor < consider",
      sameOrSaferOnly: true,
      noPersistence: true,
      noPublish: true
    }
  };
  const input = [
    {
      role: "system" as const,
      content: systemPrompt()
    },
    {
      role: "user" as const,
      content: JSON.stringify(user)
    }
  ];
  const requestPreview: DecisionAIHandoffPacket["requestPreview"] = {
    model: orchestrator.model,
    store: false,
    reasoning: {
      effort: "medium",
      summary: "auto"
    },
    input,
    text: {
      format: {
        type: "json_schema",
        name: "OddsPadiAIHandoffReview",
        strict: true,
        schema: reviewSchema
      }
    },
    max_output_tokens: 1600
  };
  const inputHash = stableHash(user);
  const packetHash = stableHash({
    date,
    sport,
    status,
    model: orchestrator.model,
    inputHash,
    schema: reviewSchema.required,
    metacognitionHash: metacognition.metacognitionHash,
    ledgerHash: aiReviewLedger.ledgerHash
  });

  return {
    generatedAt: new Date().toISOString(),
    date,
    sport,
    status,
    mode: "responses-api-json-schema-handoff",
    packetHash,
    inputHash,
    summary:
      status === "ready"
        ? "AI handoff packet is ready for a guarded Responses API review."
        : status === "needs-config"
          ? "AI handoff packet is built but waiting for OpenAI configuration or review permission."
          : "AI handoff packet is blocked by proof, metacognition, or review-ledger requirements.",
    model: orchestrator.model,
    activeTarget: orchestrator.activeTarget
      ? {
          matchId: orchestrator.activeTarget.matchId,
          label: orchestrator.activeTarget.label,
          baselineAction,
          maximumAllowedAction: baselineAction,
          verifyUrl: orchestrator.activeTarget.verifyUrl
        }
      : null,
    evidence: {
      totalAvailable: evidence.total,
      included: evidence.items.length,
      ids: evidenceIds,
      items: evidence.items
    },
    prompt: {
      system: input[0].content,
      user
    },
    outputContract: {
      schemaName: "OddsPadiAIHandoffReview",
      mustCiteEvidenceIds: true,
      sameOrSaferOnly: true,
      requiredFields: reviewSchema.required,
      actionRankRule: "avoid < monitor < consider"
    },
    requestPreview,
    runbook: {
      canSubmitToOpenAI: status === "ready" && aiReviewLedger.controlContract.submitToOpenAIAllowed && commandIsSafe(activeCommand),
      missingEnv,
      blockedBy,
      command: commandIsSafe(activeCommand) ? activeCommand : null,
      verifyUrl: orchestrator.activeTarget?.verifyUrl ?? aiReviewLedger.runbook.firstReviewUrl,
      forbiddenActions: unique([
        "Do not add persist=1 to the handoff command.",
        "Do not submit service role keys, admin tokens, raw provider credentials, or private user data.",
        "Do not publish or persist this packet output without activation proof.",
        "Do not accept uncited injuries, lineups, odds moves, scores, weather, or news.",
        ...orchestrator.runbook.forbiddenActions,
        ...metacognition.runbook.forbiddenActions
      ])
    }
  };
}
