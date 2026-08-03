import { readFileSync } from "node:fs";
import { join } from "node:path";
import { vi } from "vitest";

const nativeFetch = globalThis.fetch.bind(globalThis);

/**
 * football-data.co.uk season CSVs, served from disk.
 *
 * `buildFootballDataHistoricalLearningDossier` caches its result *only* when no
 * `fetchCsv` is injected — and that path uses `defaultFetchCsv`, which
 * downloads real Premier League seasons. One test injects a CSV and is
 * therefore offline and deterministic; the others reach the same dossier
 * indirectly through `buildDecisionLaunchContext`, so they were downloading
 * fifteen files from the internet on every run.
 *
 * That made five tests in `prediction-utils.test.ts` flaky. The dossier's
 * `status` is derived from the downloaded seasons, and the assertions branch on
 * it — `market-prior-dominant` produces "treat raw model edge as blocked
 * evidence", anything else produces "request provider-backed evidence". A slow
 * or partial download flips the verdict, and the module-scope cache then fixes
 * that wrong value for whichever tests run next. Observed failing roughly two
 * runs in five, always the same five tests, and the pattern moved whenever the
 * timing did.
 *
 * The fixtures are the real files with only the columns the parser reads
 * (`Date, HomeTeam, AwayTeam, FTHG, FTAG, FTR, B365H, B365D, B365A`, plus Div
 * and Time for shape) — 1.5MB trimmed to 208KB. Captured 2026-08-03, so the
 * verdicts the assertions encode are now pinned to data that cannot move under
 * them.
 */
const FOOTBALL_DATA_FIXTURES = join(process.cwd(), "src/test/fixtures/football-data");
const seasonCsvCache = new Map<string, string | null>();

function seasonCsv(season: string): string | null {
  if (!seasonCsvCache.has(season)) {
    try {
      seasonCsvCache.set(season, readFileSync(join(FOOTBALL_DATA_FIXTURES, `${season}-E0.csv`), "utf8"));
    } catch {
      seasonCsvCache.set(season, null);
    }
  }
  return seasonCsvCache.get(season) ?? null;
}

async function guardedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const url = input instanceof Request ? input.url : String(input);
  const parsed = /^https?:\/\//i.test(url) ? new URL(url) : null;
  if (parsed?.hostname.endsWith(".supabase.co")) {
    return Response.json(
      { message: `Direct Supabase network access is disabled during tests for ${parsed.origin}.` },
      { status: 401, headers: { "x-oddspadi-test-network-blocked": "1" } }
    );
  }
  if (parsed?.hostname.endsWith("football-data.co.uk")) {
    // /mmz4281/<season>/E0.csv
    const season = /\/mmz4281\/(\d{4})\//.exec(parsed.pathname)?.[1];
    const csv = season ? seasonCsv(season) : null;
    if (csv !== null) {
      return new Response(csv, { status: 200, headers: { "content-type": "text/csv", "x-oddspadi-test-fixture": "football-data" } });
    }
    // A season with no fixture is a 404, never a live download: a test that
    // silently reached the internet is the defect this exists to prevent.
    return new Response("", { status: 404, headers: { "x-oddspadi-test-network-blocked": "1" } });
  }
  return nativeFetch(input, init);
}

vi.stubGlobal("fetch", guardedFetch);
