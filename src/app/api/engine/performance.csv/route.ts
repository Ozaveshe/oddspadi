import { publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { formatEnginePerformanceCsv, getEnginePerformanceReport } from "@/lib/sports/performance/report";

export const GET = withApiHandler(async () => {
  const report = await getEnginePerformanceReport();
  const cache = publicCacheInit(300);
  return new Response(formatEnginePerformanceCsv(report), {
    ...cache,
    headers: {
      ...cache.headers,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="oddspadi-engine-performance-${report.generatedAt.slice(0, 10)}.csv"`
    }
  });
});
