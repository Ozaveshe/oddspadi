import { apiSuccess } from "@/app/api/sports/_utils";
import { readFootballDataMarketBenchmarkMemory } from "@/lib/sports/training/footballDataMarketBenchmarkMemory";

export const dynamic = "force-dynamic";

function parsePositiveInteger(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const memory = await readFootballDataMarketBenchmarkMemory({
    limit: parsePositiveInteger(url.searchParams.get("limit"))
  });

  return apiSuccess(memory);
}
