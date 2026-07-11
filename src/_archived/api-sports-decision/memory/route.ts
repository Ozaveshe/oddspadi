import { apiSuccess } from "@/app/api/sports/_utils";
import { getDecisionMemorySnapshot } from "@/lib/sports/prediction/decisionMemory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? 12);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(50, Math.round(rawLimit))) : 12;

  return apiSuccess(await getDecisionMemorySnapshot({ limit }));
}
