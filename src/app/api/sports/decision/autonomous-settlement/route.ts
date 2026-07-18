import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import {
  runDecisionAutonomousSettlement,
  type AutonomousSettlementSport
} from "@/lib/sports/prediction/decisionAutonomousSettlement";
import { isTrainingAdminAuthorized } from "@/lib/sports/training/adminAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

function limitFrom(request: Request): number {
  const parsed = Number(new URL(request.url).searchParams.get("limit"));
  return Number.isInteger(parsed) ? Math.max(1, Math.min(500, parsed)) : 250;
}

function sportFrom(request: Request): AutonomousSettlementSport | null {
  const sport = new URL(request.url).searchParams.get("sport") ?? "football";
  return sport === "football" || sport === "basketball" || sport === "tennis" ? sport : null;
}

export async function GET(request: Request) {
  const sport = sportFrom(request);
  if (!sport) return apiError("sport must be football, basketball, or tennis.", 400);
  try {
    return apiSuccess(await runDecisionAutonomousSettlement({ limit: limitFrom(request), sport }));
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Autonomous settlement preview failed.", 502);
  }
}

export async function POST(request: Request) {
  if (!isTrainingAdminAuthorized(request)) return apiError("Autonomous settlement requires a valid x-oddspadi-admin-token.", 401);
  const sport = sportFrom(request);
  if (!sport) return apiError("sport must be football, basketball, or tennis.", 400);
  try {
    const receipt = await runDecisionAutonomousSettlement({
      runRequested: true,
      adminAuthorized: true,
      limit: limitFrom(request),
      sport
    });
    return apiSuccess(receipt, { status: receipt.status === "failed" ? 502 : 200 });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Autonomous settlement failed.", 502);
  }
}
