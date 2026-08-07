import { publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { TRACK_RECORD_QUERY_KEYS, trackRecordSearchParams } from "@/app/api/track-record/_shared";
import { formatTrackRecordJson, trackRecordExportFilename } from "@/lib/performance/trackRecordExport";
import { buildTrackRecordExportView } from "@/lib/performance/trackRecordView";
import { readTimezonePreference } from "@/lib/time/timezoneCookie";

/**
 * The JSON export.
 *
 * The same view, the same rows and the same summary values as the CSV — a
 * contract test compares the two, because two serialisers over one object is a
 * refactor away from becoming two aggregations over two reads.
 *
 * Nulls are preserved as nulls. Serialising an unmeasured metric as `0` to
 * keep a consumer's parser happy would put a claim we never made into a
 * machine-readable file, which is the worst place for one to end up.
 */
export const dynamic = "force-dynamic";

export const GET = withApiHandler(async (request: Request) => {
  const view = await buildTrackRecordExportView({
    searchParams: trackRecordSearchParams(request),
    timeZone: await readTimezonePreference()
  });
  const cache = publicCacheInit(300, TRACK_RECORD_QUERY_KEYS);
  return new Response(JSON.stringify(formatTrackRecordJson(view), null, 2), {
    ...cache,
    headers: {
      ...cache.headers,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${trackRecordExportFilename(view, "json")}"`
    }
  });
});
