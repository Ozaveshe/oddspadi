import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { getPredictions, isSupportedSport } from "@/lib/sports/service";
import { buildMultiSportLiveFeatureMaterializer } from "@/lib/sports/training/multiSportLiveFeatureMaterializer";
import { observeMultiSportLiveFeatureStorageReceipt } from "@/lib/sports/training/multiSportLiveFeatureStorageReceipt";
import { buildMultiSportLiveOperationQueue } from "@/lib/sports/training/multiSportLiveOperationQueue";
import { buildMultiSportLiveOperationTurn } from "@/lib/sports/training/multiSportLiveOperationTurn";

export const dynamic = "force-dynamic";

function isEnabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function parseSport(value: string | null): "basketball" | "tennis" | null {
  if (!isSupportedSport(value)) return null;
  return value === "basketball" || value === "tennis" ? value : null;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sport = parseSport(url.searchParams.get("sport") ?? "basketball");
  if (!sport) return apiError("sport must be basketball or tennis for multi-sport live operation turn.");

  const date = url.searchParams.get("date") ?? "2026-06-24";
  const rows = await getPredictions({ date, sport });
  const provider = rows.find((row) => row.match.dataSource?.kind === "provider")?.match.dataSource?.fixtureProvider ?? rows[0]?.match.dataSource?.fixtureProvider ?? "mockSportsDataProvider";
  const materializer = buildMultiSportLiveFeatureMaterializer({
    provider,
    sport,
    rows,
    targetDate: date
  });
  const storage = await observeMultiSportLiveFeatureStorageReceipt({
    materializer,
    runRequested: false,
    adminAuthorized: false,
    env: process.env,
    origin: url.origin
  });
  const queue = buildMultiSportLiveOperationQueue({ materializer, storage, origin: url.origin });
  const turn = await buildMultiSportLiveOperationTurn({
    queue,
    runRequested: isEnabled(url.searchParams.get("run")),
    origin: url.origin
  });

  return apiSuccess(turn, { status: turn.status === "proof-failed" ? 502 : 200 });
}
