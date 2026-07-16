import { apiError, apiSuccess, parseSportsQuery, publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { getPredictions } from "@/lib/sports/service";
import { toPredictionListRow } from "@/lib/sports/prediction/listRow";

export const GET = withApiHandler(async (request: Request) => {
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
    providerMode: "live",
    // Public requests must not wait on the operator-only training corpus and
    // decision-memory scans. Those proof lanes remain available on the
    // dedicated decision/training APIs.
    storageMode: "preview"
  });
  // view=summary strips the decision dossier from each row — card/list UIs
  // only need the summary and the full payload is megabytes on busy days.
  const cache = publicCacheInit(60, ["date", "sport", "confidence", "league", "country", "q", "publicHistory", "historical", "view"]);
  if (url.searchParams.get("view") === "summary") return apiSuccess(data.map(toPredictionListRow), cache);
  return apiSuccess(data, cache);
});
