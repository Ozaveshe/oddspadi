import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { runDecisionAutonomousCycle } from "@/lib/sports/prediction/decisionAutonomousCycle";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

function parseBoundedInteger(value: string | null, fallback: number, minimum: number, maximum: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function enabled(value: string | null, fallback: boolean): boolean {
  if (value === null) return fallback;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function requestOptions(request: Request) {
  const url = new URL(request.url);
  return {
    fixtureLimit: parseBoundedInteger(url.searchParams.get("limit"), 12, 1, 20),
    aiReviewLimit: parseBoundedInteger(url.searchParams.get("aiLimit"), 2, 0, 3),
    runAi: enabled(url.searchParams.get("runAi"), true),
    persist: enabled(url.searchParams.get("persist"), true)
  };
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  const options = requestOptions(request);

  try {
    return apiSuccess(
      await runDecisionAutonomousCycle({
        date: query.date,
        sport: query.sport,
        runRequested: false,
        adminAuthorized: false,
        runAi: false,
        persist: false,
        fixtureLimit: options.fixtureLimit,
        aiReviewLimit: options.aiReviewLimit
      })
    );
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Autonomous decision preview failed.", 502);
  }
}

export async function POST(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Autonomous decision execution requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const options = requestOptions(request);

  try {
    const cycle = await runDecisionAutonomousCycle({
      date: query.date,
      sport: query.sport,
      runRequested: true,
      adminAuthorized: true,
      ...options
    });
    return apiSuccess(cycle, { status: cycle.status === "failed" ? 502 : 200 });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Autonomous decision execution failed.", 502);
  }
}
