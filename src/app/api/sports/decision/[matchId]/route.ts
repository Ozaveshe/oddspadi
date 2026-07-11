import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import type { DecisionAiAgentResult } from "@/lib/sports/types";
import { persistDecisionRun } from "@/lib/sports/prediction/decisionPersistence";
import { runDecisionEnhancementWithOpenAI } from "@/lib/sports/prediction/openaiDecisionEnhancer";
import { runOpenAIDecisionAgentReview } from "@/lib/sports/prediction/openaiDecisionAgent";
import { getMatchPrediction } from "@/lib/sports/service";

type RouteContext = {
  params: Promise<{ matchId: string }>;
};

type DecisionMutationRequest = {
  agent?: unknown;
  enhance?: unknown;
  persist?: unknown;
};

function requested(value: unknown): boolean {
  return value === true || value === "1" || value === "true";
}

function decodeMatchId(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function skippedPersistence() {
  return {
    requested: false,
    status: "skipped" as const,
    configured: false,
    table: "op_decision_runs" as const,
    reason: "Use an authenticated POST request with persist=true to store this decision run."
  };
}

async function runDecisionMutation({
  request,
  context,
  mutation
}: {
  request: Request;
  context: RouteContext;
  mutation: DecisionMutationRequest;
}) {
  const { matchId: rawMatchId } = await context.params;
  const matchId = decodeMatchId(rawMatchId);
  if (!matchId || matchId.length > 80) return apiError("Invalid matchId.");

  const shouldEnhance = requested(mutation.enhance);
  const shouldRunAgent = requested(mutation.agent);
  const shouldPersist = requested(mutation.persist);
  if (!shouldEnhance && !shouldRunAgent && !shouldPersist) {
    return apiError("Specify agent, enhance, or persist for a decision mutation.", 400);
  }
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Decision mutation requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  const row = await getMatchPrediction(matchId);
  if (!row) return apiError("Match not found.", 404);

  const enhancement = shouldEnhance
    ? await runDecisionEnhancementWithOpenAI({ match: row.match, prediction: row.prediction })
    : {
        requested: false,
        provider: "deterministic" as const,
        status: "not-requested" as const,
        decision: row.prediction.decision
      };
  const predictionForAgent = { ...row.prediction, decision: enhancement.decision };
  const aiAgent: DecisionAiAgentResult = shouldRunAgent
    ? await runOpenAIDecisionAgentReview({ match: row.match, prediction: predictionForAgent })
    : {
        requested: false,
        provider: "deterministic",
        status: "not-requested",
        decision: enhancement.decision,
        review: null
      };
  const finalDecision = aiAgent.decision;
  const persistence = shouldPersist
    ? await persistDecisionRun({ match: row.match, prediction: row.prediction, decision: finalDecision, aiAgent })
    : skippedPersistence();

  return apiSuccess({
    matchId,
    decision: finalDecision,
    enhancement,
    aiAgent,
    persistence,
    openAiConfigured: Boolean(process.env.OPENAI_API_KEY)
  });
}

export async function GET(request: Request, context: RouteContext) {
  const url = new URL(request.url);
  if (requested(url.searchParams.get("agent")) || requested(url.searchParams.get("enhance")) || requested(url.searchParams.get("persist"))) {
    return apiError("This endpoint is read-only. Run AI review or persistence through an authenticated POST request.", 405);
  }

  const { matchId: rawMatchId } = await context.params;
  const matchId = decodeMatchId(rawMatchId);
  if (!matchId || matchId.length > 80) return apiError("Invalid matchId.");

  const row = await getMatchPrediction(matchId);
  if (!row) return apiError("Match not found.", 404);

  return apiSuccess({
    matchId,
    decision: row.prediction.decision,
    enhancement: {
      requested: false,
      provider: "deterministic" as const,
      status: "not-requested" as const,
      decision: row.prediction.decision
    },
    aiAgent: {
      requested: false,
      provider: "deterministic" as const,
      status: "not-requested" as const,
      decision: row.prediction.decision,
      review: null
    },
    persistence: skippedPersistence(),
    openAiConfigured: Boolean(process.env.OPENAI_API_KEY)
  });
}

export async function POST(request: Request, context: RouteContext) {
  const url = new URL(request.url);
  const body = (await request.json().catch(() => ({}))) as DecisionMutationRequest;
  return runDecisionMutation({
    request,
    context,
    mutation: {
      agent: body.agent ?? url.searchParams.get("agent"),
      enhance: body.enhance ?? url.searchParams.get("enhance"),
      persist: body.persist ?? url.searchParams.get("persist")
    }
  });
}
