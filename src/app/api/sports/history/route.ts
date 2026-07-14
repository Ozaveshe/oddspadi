import { apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { filterPublicPredictionHistory, getHistorySummary, getPublicPredictionHistory } from "@/lib/sports/prediction/history";

export const GET = withApiHandler(async (request: Request) => {
  const url = new URL(request.url);
  const ledger = await getPublicPredictionHistory();
  const items = filterPublicPredictionHistory(ledger.items, {
    sport: url.searchParams.get("sport") ?? "all",
    result: url.searchParams.get("result") ?? "all",
    range: url.searchParams.get("range") ?? "all",
    market: url.searchParams.get("market") ?? "all",
    publicStatus: url.searchParams.get("publicStatus") ?? "all",
    settlementStatus: url.searchParams.get("settlementStatus") ?? "all",
    confidence: url.searchParams.get("confidence") ?? "all",
    edge: (url.searchParams.get("edge") ?? "all") as "all" | "positive" | "negative"
  });
  return apiSuccess({
    ...ledger,
    items,
    summary: getHistorySummary(items)
  });
});
