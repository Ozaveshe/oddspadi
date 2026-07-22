import { apiSuccess, publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { getCachedWeeklyTipsProduct } from "@/lib/sports/tips/publicReads";
import type { WeeklyTipsProduct } from "@/lib/sports/tips/product";

export const dynamic = "force-dynamic";

function weeklySummary(product: WeeklyTipsProduct) {
  return {
    generatedAt: product.generatedAt,
    summary: product.summary,
    slate: {
      scope: product.slate.scope,
      generatedAt: product.slate.generatedAt,
      range: product.slate.range,
      provider: product.slate.provider,
      summary: product.slate.summary,
      fixtures: product.slate.fixtures.map((row) => ({ fixture: row.fixture, publicStatus: row.publicStatus }))
    },
    days: product.days.map(({ date, counts }) => ({ date, counts }))
  };
}

export const GET = withApiHandler(async (request) => {
  const product = await getCachedWeeklyTipsProduct();
  const summaryView = new URL(request.url).searchParams.get("view") === "summary";
  return apiSuccess(summaryView ? weeklySummary(product) : product, publicCacheInit(180, ["view"]));
});
