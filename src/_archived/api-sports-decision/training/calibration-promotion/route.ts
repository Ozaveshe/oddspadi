import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import {
  approveCalibrationCandidate,
  readActiveCalibrationPromotion,
  revokeCalibrationPromotion
} from "@/lib/sports/prediction/decisionCalibrationPromotion";
import type { Sport } from "@/lib/sports/types";

export const dynamic = "force-dynamic";

type CalibrationSport = Extract<Sport, "football" | "basketball" | "tennis">;

function parseSport(value: string | null): CalibrationSport | null {
  const sport = value ?? "football";
  return sport === "football" || sport === "basketball" || sport === "tennis" ? sport : null;
}

function boundedText(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maximum ? text : null;
}

export async function GET(request: Request) {
  const sport = parseSport(new URL(request.url).searchParams.get("sport"));
  if (!sport) return apiError("Invalid sport.");
  const active = await readActiveCalibrationPromotion(sport);
  return apiSuccess(active);
}

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Calibration promotion requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return apiError("Calibration promotion body must be a JSON object.");
  const action = boundedText(body.action, 20);
  const approvedBy = boundedText(body.approvedBy, 120) ?? "operator";

  if (action === "approve") {
    const candidateId = boundedText(body.candidateId, 80);
    const rationale = boundedText(body.rationale, 800);
    const expiresAt = body.expiresAt === undefined || body.expiresAt === null ? null : boundedText(body.expiresAt, 64);
    if (!candidateId || !rationale) return apiError("Approve requires candidateId and rationale.");
    if (body.expiresAt !== undefined && body.expiresAt !== null && !expiresAt) return apiError("expiresAt is invalid.");
    const result = await approveCalibrationCandidate({ candidateId, approvedBy, rationale, expiresAt });
    const status = result.status === "approved" ? 200 : result.status === "not-configured" ? 503 : result.status === "pending-migration" ? 409 : 422;
    return apiSuccess(result, { status });
  }

  if (action === "revoke") {
    const promotionId = boundedText(body.promotionId, 80);
    const reason = boundedText(body.reason, 800);
    if (!promotionId || !reason) return apiError("Revoke requires promotionId and reason.");
    const result = await revokeCalibrationPromotion({ promotionId, revokedBy: approvedBy, reason });
    const status = result.status === "revoked" ? 200 : result.status === "not-configured" ? 503 : result.status === "pending-migration" ? 409 : 422;
    return apiSuccess(result, { status });
  }

  return apiError("action must be approve or revoke.");
}
