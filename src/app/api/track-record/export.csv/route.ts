import { publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { TRACK_RECORD_QUERY_KEYS, trackRecordSearchParams } from "@/app/api/track-record/_shared";
import { formatTrackRecordCsv, trackRecordExportFilename } from "@/lib/performance/trackRecordExport";
import { buildTrackRecordExportView } from "@/lib/performance/trackRecordView";
import { readTimezonePreference } from "@/lib/time/timezoneCookie";

/**
 * The CSV export.
 *
 * Same view model as the page, so the file cannot disagree with the screen it
 * came from. The active period and filters arrive in the query string and are
 * written into the file's header block along with a definition for every
 * metric, because a number that leaves the page without its definition is a
 * number somebody will misquote.
 */
export const dynamic = "force-dynamic";

export const GET = withApiHandler(async (request: Request) => {
  const view = await buildTrackRecordExportView({
    searchParams: trackRecordSearchParams(request),
    timeZone: await readTimezonePreference()
  });
  const cache = publicCacheInit(300, TRACK_RECORD_QUERY_KEYS);
  return new Response(formatTrackRecordCsv(view), {
    ...cache,
    headers: {
      ...cache.headers,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${trackRecordExportFilename(view, "csv")}"`
    }
  });
});
