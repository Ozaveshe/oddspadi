import { apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { readLatestProviderRun } from "@/lib/sports/intelligence/repository";

export const dynamic = "force-dynamic";

// Public health is deliberately read-only. The scheduled background worker is
// the sole automated writer and records one serialized receipt here.
export const GET = withApiHandler(async () => apiSuccess(await readLatestProviderRun(["model-learning"])));
