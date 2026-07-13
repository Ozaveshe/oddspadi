import { apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { getHistorySummary, getPublicPredictionHistory } from "@/lib/sports/prediction/history";

export const GET = withApiHandler(async () => {
  const ledger = await getPublicPredictionHistory();
  return apiSuccess({
    ...ledger,
    summary: getHistorySummary(ledger.items)
  });
});
