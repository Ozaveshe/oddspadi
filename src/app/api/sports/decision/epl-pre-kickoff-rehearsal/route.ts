import { apiSuccess } from "@/app/api/sports/_utils";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? new Date().toISOString().slice(0, 10);
  const context = await buildDecisionLaunchContext({
    date,
    sport: "football",
    baseUrl: url.origin,
    env: process.env
  });

  return apiSuccess(context.eplPreKickoffRehearsal);
}
