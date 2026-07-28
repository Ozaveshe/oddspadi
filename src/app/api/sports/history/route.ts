import { apiSuccess, publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
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
  // Every request previously re-read the whole public ledger and re-filtered it
  // at the origin, with no cache headers at all — the only public read route
  // without them. The payload is identical for identical filters.
  return apiSuccess(
    {
      ...ledger,
      items,
      summary: getHistorySummary(items)
    },
    publicCacheInit(300, [
      "sport",
      "result",
      "range",
      "market",
      "publicStatus",
      "settlementStatus",
      "confidence",
      "edge"
    ])
  );
});
