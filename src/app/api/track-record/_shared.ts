import {
  CURSOR_PARAM,
  FILTER_PARAM,
  FROM_PARAM,
  PAGE_SIZE_PARAM,
  PERIOD_PARAM,
  TRACK_RECORD_FILTER_KEYS,
  TO_PARAM,
  type SearchParamRecord
} from "@/lib/performance/trackRecordFilters";

/**
 * The query keys the track-record exports read.
 *
 * Every one of them has to be declared to `publicCacheInit`, which emits
 * `Netlify-Vary: query=…`. An unlisted key is not merely uncached — it is
 * served from another visitor's cache entry, so a request for the football
 * record can be answered with the tennis one. That is a correctness bug on a
 * page whose entire purpose is that the numbers are the numbers.
 */
export const TRACK_RECORD_QUERY_KEYS: string[] = [
  PERIOD_PARAM,
  FROM_PARAM,
  TO_PARAM,
  PAGE_SIZE_PARAM,
  CURSOR_PARAM,
  ...TRACK_RECORD_FILTER_KEYS.map((key) => FILTER_PARAM[key])
];

/**
 * Read only the keys we know about out of the URL.
 *
 * An allowlist rather than a copy of every parameter: unknown keys would flow
 * into the view's cache key and into the export header, which turns an
 * arbitrary query string into arbitrary text in a downloaded file.
 */
export function trackRecordSearchParams(request: Request): SearchParamRecord {
  const url = new URL(request.url);
  const params: SearchParamRecord = {};
  for (const key of TRACK_RECORD_QUERY_KEYS) {
    const value = url.searchParams.get(key);
    if (value !== null) params[key] = value;
  }
  return params;
}
