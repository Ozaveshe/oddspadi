import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import type { DecisionMarketPriorBlockerResolver } from "@/lib/sports/prediction/decisionMarketPriorBlockerResolver";
import { buildDecisionMarketPriorResolutionTurn } from "@/lib/sports/prediction/decisionMarketPriorResolutionTurn";
import { fetchDecisionApiData } from "@/lib/sports/prediction/decisionInternalFetch";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return 8;
  return Math.min(parsed, 20);
}

function isEnabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  if (query.sport !== "football") return apiError("Market-prior resolution turn currently supports football promotion evidence.");

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun");
  if (dryRun === "0" || dryRun?.toLowerCase() === "false") return apiError("market-prior-resolution-turn is read-only; use dryRun=1.", 400);

  const limit = parseLimit(url.searchParams.get("limit"));
  const resolver = await fetchDecisionApiData<DecisionMarketPriorBlockerResolver>(
    new URL(`/api/sports/decision/market-prior-blocker-resolver?date=${query.date}&sport=${query.sport}&limit=${limit}&dryRun=1`, url.origin),
    {
      timeoutMs: 520000,
      maxAttempts: 1
    }
  );
  if (!resolver) return apiError("Unable to build market-prior blocker resolver before resolution turn.", 502);

  const turn = await buildDecisionMarketPriorResolutionTurn({
    resolver,
    runRequested: isEnabled(url.searchParams.get("run")),
    origin: url.origin
  });

  return apiSuccess(turn, { status: turn.status === "proof-failed" ? 502 : 200 });
}
