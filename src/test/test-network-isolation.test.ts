import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Tests must not depend on the internet.
 *
 * `prediction-utils.test.ts` downloaded fifteen Premier League season CSVs from
 * football-data.co.uk on every run, because
 * `buildFootballDataHistoricalLearningDossier` only skips its network path when
 * a `fetchCsv` is injected — and only one test injects one. The rest reach the
 * dossier indirectly through `buildDecisionLaunchContext`.
 *
 * The dossier's `status` is computed from those downloads, and assertions
 * branch on it: `market-prior-dominant` yields "treat raw model edge as blocked
 * evidence", anything else yields "request provider-backed evidence". A slow or
 * partial download flips the verdict, and the module-scope cache then pins the
 * wrong value for whichever tests run next. Five tests failed roughly two runs
 * in five, and the set moved whenever timing did — which is what made it look
 * like a data problem rather than a network one.
 *
 * `src/test/setup.ts` now serves those CSVs from disk and 404s any season it
 * has no fixture for, so a new download shows up as a failing test rather than
 * as an intermittent one.
 */
describe("test network isolation", () => {
  it("serves football-data season CSVs from disk, never the network", async () => {
    const response = await fetch("https://www.football-data.co.uk/mmz4281/1617/E0.csv");

    expect(response.status).toBe(200);
    expect(response.headers.get("x-oddspadi-test-fixture")).toBe("football-data");
    const body = await response.text();
    expect(body.split("\n")[0]).toBe("Div,Date,Time,HomeTeam,AwayTeam,FTHG,FTAG,FTR,B365H,B365D,B365A");
  });

  it("404s a season with no fixture rather than falling through to the internet", async () => {
    const response = await fetch("https://www.football-data.co.uk/mmz4281/9999/E0.csv");

    expect(response.status).toBe(404);
    expect(response.headers.get("x-oddspadi-test-network-blocked")).toBe("1");
  });

  it("keeps blocking direct Supabase access", async () => {
    const response = await fetch("https://example.supabase.co/rest/v1/op_fixtures");

    expect(response.status).toBe(401);
    expect(response.headers.get("x-oddspadi-test-network-blocked")).toBe("1");
  });

  it("covers every season the dossier walks", () => {
    // DEFAULT_SEASON_FROM 2016 through the current season. A missing fixture
    // would 404, quietly shrinking the corpus and moving the verdict — the
    // exact failure mode being prevented.
    const seasons = readdirSync(join(process.cwd(), "src/test/fixtures/football-data"))
      .filter((name) => name.endsWith("-E0.csv"))
      .map((name) => name.replace("-E0.csv", ""))
      .sort();

    expect(seasons).toEqual(["1617", "1718", "1819", "1920", "2021", "2122", "2223", "2324", "2425", "2526"]);
  });
});
