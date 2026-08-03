import { apiError, apiSuccess, publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { parseSportsAssetQuery, readSportsAssets } from "@/lib/sports/assets";

export const GET = withApiHandler(async (request: Request) => {
  const query = parseSportsAssetQuery(request);
  if ("error" in query) return apiError(query.error);

  const client = getSupabaseServerClient();
  if (!client) return apiError("The sports asset catalogue is not configured.", 503);

  const data = await readSportsAssets(client, query);
  return apiSuccess(
    {
      ...data,
      usage: {
        purpose: "identification",
        note: "Logos and flags remain third-party assets supplied by the named provider. Verify competition and club usage rights before promotional or merchandising use."
      }
    },
    query.query || query.provider || query.externalId
      ? { headers: { "Cache-Control": "no-store" } }
      : publicCacheInit(3_600, ["kind", "sport", "page", "limit", "hasLogo"])
  );
});
