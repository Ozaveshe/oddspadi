import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionEvidenceGraph } from "@/lib/sports/prediction/decisionEvidenceGraph";
import { buildDecisionReflection } from "@/lib/sports/prediction/decisionReflection";
import { buildDecisionRehearsal } from "@/lib/sports/prediction/decisionRehearsal";
import { buildDecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import { buildDecisionThinkingIntrospection } from "@/lib/sports/prediction/decisionThinkingIntrospection";
import { buildDecisionWorkingMemory } from "@/lib/sports/prediction/decisionWorkingMemory";
import { getPredictions } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const rows = await getPredictions({ date: query.date, sport: query.sport });
  const slateThinking = buildDecisionSlateThinking({ rows, date: query.date, sport: query.sport, limit: 12 });
  const workingMemory = buildDecisionWorkingMemory({ rows, date: query.date, sport: query.sport, slateThinking, limit: 32 });
  const reflection = buildDecisionReflection({ rows, date: query.date, sport: query.sport, slateThinking, workingMemory, limit: 8 });
  const rehearsal = buildDecisionRehearsal({ rows, date: query.date, sport: query.sport, slateThinking, workingMemory, reflection, limit: 5 });
  const evidenceGraph = buildDecisionEvidenceGraph({ rows, date: query.date, sport: query.sport, slateThinking, limit: 6 });

  return apiSuccess(
    buildDecisionThinkingIntrospection({
      date: query.date,
      sport: query.sport,
      slateThinking,
      workingMemory,
      reflection,
      rehearsal,
      evidenceGraph
    })
  );
}
