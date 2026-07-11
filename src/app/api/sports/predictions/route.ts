import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { getPredictions } from "@/lib/sports/service";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  const url = new URL(request.url);
  const confidence = url.searchParams.get("confidence") ?? undefined;
  const league = url.searchParams.get("league") ?? undefined;
  const country = url.searchParams.get("country") ?? undefined;
  const search = url.searchParams.get("q") ?? undefined;
  const publicHistory = ["1", "true", "yes", "on"].includes((url.searchParams.get("publicHistory") ?? url.searchParams.get("historical") ?? "").toLowerCase());

  if (confidence && !["low", "medium", "high"].includes(confidence)) return apiError("Invalid confidence.");

  const data = await getPredictions({
    date: query.date,
    sport: query.sport,
    confidence,
    league,
    country,
    query: search,
    publicHistory,
    providerMode: "live"
  });
  return apiSuccess(data);
}
