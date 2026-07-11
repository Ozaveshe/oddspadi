import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { getPredictions, isSupportedSport } from "@/lib/sports/service";
import { buildMultiSportLiveFeatureMaterializer } from "@/lib/sports/training/multiSportLiveFeatureMaterializer";

export const dynamic = "force-dynamic";

function parseSport(value: string | null): "basketball" | "tennis" | null {
  if (!isSupportedSport(value)) return null;
  return value === "basketball" || value === "tennis" ? value : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = parseSport(url.searchParams.get("sport") ?? "basketball");
  if (!sport) return apiError("sport must be basketball or tennis for the multi-sport live feature materializer.");

  const date = url.searchParams.get("date") ?? "2026-06-24";
  const rows = await getPredictions({ date, sport });
  const provider = rows.find((row) => row.match.dataSource?.kind === "provider")?.match.dataSource?.fixtureProvider ?? rows[0]?.match.dataSource?.fixtureProvider ?? "mockSportsDataProvider";

  return apiSuccess(
    buildMultiSportLiveFeatureMaterializer({
      provider,
      sport,
      rows,
      targetDate: date
    })
  );
}
