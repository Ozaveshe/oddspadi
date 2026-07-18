import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { runDecisionAutonomousCycle } from "@/lib/sports/prediction/decisionAutonomousCycle";
import { isTrainingAdminAuthorized } from "@/lib/sports/training/adminAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number): number {
  const parsed = value === null ? Number.NaN : Number(value);
  return Number.isInteger(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function enabled(value: string | null, fallback: boolean): boolean {
  return value === null ? fallback : ["1", "true", "yes"].includes(value.toLowerCase());
}

function options(request: Request) {
  const params = new URL(request.url).searchParams;
  return {
    fixtureLimit: boundedInteger(params.get("limit"), 12, 1, 20),
    aiReviewLimit: boundedInteger(params.get("aiLimit"), 2, 0, 3),
    runAi: enabled(params.get("runAi"), true),
    persist: enabled(params.get("persist"), true)
  };
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  const requested = options(request);
  try {
    return apiSuccess(await runDecisionAutonomousCycle({
      date: query.date,
      sport: query.sport,
      runRequested: false,
      adminAuthorized: false,
      runAi: false,
      persist: false,
      fixtureLimit: requested.fixtureLimit,
      aiReviewLimit: requested.aiReviewLimit
    }));
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Autonomous decision preview failed.", 502);
  }
}

export async function POST(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  if (!isTrainingAdminAuthorized(request)) return apiError("Autonomous decision execution requires a valid x-oddspadi-admin-token.", 401);
  try {
    const cycle = await runDecisionAutonomousCycle({
      date: query.date,
      sport: query.sport,
      runRequested: true,
      adminAuthorized: true,
      ...options(request)
    });
    return apiSuccess(cycle, { status: cycle.status === "failed" ? 502 : 200 });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Autonomous decision execution failed.", 502);
  }
}
