import { apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { getPredictionHistory } from "@/lib/sports/service";
import { getHistorySummary } from "@/lib/sports/prediction/history";

export const GET = withApiHandler(async () => {
  const items = getPredictionHistory();
  return apiSuccess({
    items,
    summary: getHistorySummary(items)
  });
});
