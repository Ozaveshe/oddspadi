import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import {
  previewChampionChallengerComparison,
  runAndStoreChampionChallengerComparison
} from "@/lib/sports/prediction/championChallengerRepository";
import { isTrainingAdminAuthorized } from "@/lib/sports/training/adminAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type GovernedSport = "football" | "basketball" | "tennis";

function sport(value: unknown): GovernedSport | null {
  return value === "football" || value === "basketball" || value === "tennis" ? value : null;
}

function boundedText(value: unknown, maximum = 80): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text && text.length <= maximum ? text : null;
}

export const GET = withApiHandler(async (request: Request) => {
  const url = new URL(request.url);
  const requestedSport = sport(url.searchParams.get("sport") ?? "football");
  const challengerCandidateId = boundedText(url.searchParams.get("challengerCandidateId"));
  if (!requestedSport || !challengerCandidateId) return apiError("sport and challengerCandidateId are required.");
  const result = await previewChampionChallengerComparison({ sport: requestedSport, challengerCandidateId });
  const status = result.status === "not-configured" ? 503 : result.status === "pending-migration" ? 409 : result.status === "failed" ? 422 : 200;
  return apiSuccess(result, { status });
});

export const POST = withApiHandler(async (request: Request) => {
  if (!isTrainingAdminAuthorized(request)) return apiError("Champion-challenger storage requires a valid x-oddspadi-admin-token.", 401);
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return apiError("Champion-challenger body must be a JSON object.");
  const requestedSport = sport(body.sport ?? "football");
  const challengerCandidateId = boundedText(body.challengerCandidateId);
  if (!requestedSport || !challengerCandidateId) return apiError("sport and challengerCandidateId are required.");
  const result = await runAndStoreChampionChallengerComparison({ sport: requestedSport, challengerCandidateId });
  const status = result.status === "stored" || result.status === "reused" || result.status === "not-applicable"
    ? 200
    : result.status === "not-configured"
      ? 503
      : result.status === "pending-migration"
        ? 409
        : result.status === "not-found"
          ? 404
          : 422;
  return apiSuccess(result, { status });
});
