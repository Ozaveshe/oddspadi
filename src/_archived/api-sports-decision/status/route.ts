import { apiSuccess } from "@/app/api/sports/_utils";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";

export const dynamic = "force-dynamic";

export async function GET() {
  return apiSuccess(await verifyDecisionEngineReadiness());
}
