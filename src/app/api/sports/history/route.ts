import { apiSuccess } from "@/app/api/sports/_utils";
import { getPredictionHistory } from "@/lib/sports/service";
import { getHistorySummary } from "@/lib/sports/prediction/history";

export async function GET() {
  const items = getPredictionHistory();
  return apiSuccess({
    items,
    summary: getHistorySummary(items)
  });
}
