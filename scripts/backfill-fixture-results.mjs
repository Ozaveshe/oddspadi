#!/usr/bin/env node
/**
 * Ask the provider for the result of fixtures we already hold.
 *
 *   npm run ops:backfill-results              # dry run
 *   npm run ops:backfill-results -- --commit
 *
 * The scheduled results pass re-reads whole days and filters what comes back
 * through the curated league registry. That is right for discovering fixtures,
 * and wrong for closing out ones we already committed to: a match imported
 * while its league was in season stops being re-read once the registry moves
 * on, and sits at `scheduled` forever.
 *
 * This asks a different question — not "what happened that day" but "what
 * happened to these fixtures" — so registry membership stops mattering. It is
 * a recovery tool for the backlog. Going forward `results-refresh-sweep` keeps
 * the board current.
 *
 * Nothing is guessed. A status the provider does not report, or reports as a
 * code this script does not recognise, is left exactly as it is.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const commit = process.argv.includes("--commit");
function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}
const onlySport = arg("sport");

/**
 * Provider status codes to ours.
 *
 * `abandoned` and `cancelled` are kept apart on purpose: cancelled means the
 * match never started, abandoned means it started and produced no usable
 * result. Both settle as void but they are different facts, and an abandoned
 * match often carries a partial scoreline that must never be read as final.
 */
const API_SPORTS_STATUS = {
  FT: "finished", AET: "finished", PEN: "finished", AOT: "finished",
  AWD: "finished", WO: "finished",
  PST: "postponed", CANC: "cancelled", ABD: "abandoned",
  SUSP: "suspended", INT: "suspended",
  NS: null, TBD: null,
  "1H": null, "2H": null, HT: null, ET: null, BT: null, P: null, LIVE: null,
  Q1: null, Q2: null, Q3: null, Q4: null, OT: null
};

const TERMINAL = new Set(["finished", "postponed", "cancelled", "abandoned"]);

async function staleFixtures() {
  // Keyset pagination on kickoff_at: an unordered deep .range() returns an
  // arbitrary slice, and ordering with a deep offset hits the 8s statement
  // timeout. Both have bitten this codebase before.
  const rows = [];
  let cursor = "1970-01-01T00:00:00.000Z";
  for (;;) {
    let query = db
      .from("op_fixtures")
      .select("id,sport,provider,provider_fixture_id,kickoff_at,home_team_name,away_team_name")
      .in("status", ["scheduled", "live"])
      .lt("kickoff_at", new Date(Date.now() - 4 * 60 * 60_000).toISOString())
      .gt("kickoff_at", cursor)
      .order("kickoff_at", { ascending: true })
      .limit(500);
    if (onlySport) query = query.eq("sport", onlySport);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...data);
    cursor = data.at(-1).kickoff_at;
    if (data.length < 500) break;
  }
  return rows;
}

/**
 * API-Sports reports quota and auth failures as HTTP 200 with a populated
 * `errors` object and `results: 0`. Reading only the status code turns a
 * refused request into "this day had no games" — the first run of this script
 * reported 0 of 473 basketball fixtures resolved and looked like a clean
 * answer, when every call had actually been rejected for rate limiting.
 */
async function getJson(endpoint, headers = {}) {
  const response = await fetch(endpoint, { headers, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const body = await response.json();
  const errors = body?.errors;
  const reported = Array.isArray(errors) ? errors : Object.values(errors ?? {});
  if (reported.length) throw new Error(reported.join("; "));
  return body;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** API-Football takes up to 20 ids per call, dash separated. */
async function footballResults(fixtures, apiKey) {
  const found = new Map();
  const ids = fixtures.map((row) => String(row.provider_fixture_id).replace(/^api-football:/, "")).filter(Boolean);
  for (let index = 0; index < ids.length; index += 20) {
    const batch = ids.slice(index, index + 20);
    const endpoint = `https://v3.football.api-sports.io/fixtures?ids=${batch.join("-")}`;
    try {
      const data = await getJson(endpoint, { "x-apisports-key": apiKey });
      for (const row of data?.response ?? []) {
        const id = String(row?.fixture?.id ?? "");
        const short = row?.fixture?.status?.short;
        if (!id || !(short in API_SPORTS_STATUS)) continue;
        found.set(id, { status: API_SPORTS_STATUS[short], short, home: row?.goals?.home ?? null, away: row?.goals?.away ?? null });
      }
    } catch (error) {
      console.error(`  football batch ${index / 20 + 1}: ${error.message}`);
    }
    // 450/min on this plan; 200ms between calls keeps a wide margin.
    await sleep(200);
  }
  return found;
}

/**
 * api-basketball has no batch-by-id, and its Free tier allows 100 requests a
 * day, so 473 single lookups is not an option. One call per date covers the
 * whole backlog in about twenty.
 */
async function basketballResults(fixtures, apiKey) {
  const found = new Map();
  const dates = [...new Set(fixtures.map((row) => row.kickoff_at.slice(0, 10)))].sort();
  for (const date of dates) {
    try {
      const data = await getJson(`https://v1.basketball.api-sports.io/games?date=${date}`, { "x-apisports-key": apiKey });
      for (const row of data?.response ?? []) {
        const id = String(row?.id ?? "");
        const short = row?.status?.short;
        if (!id || !(short in API_SPORTS_STATUS)) continue;
        found.set(id, { status: API_SPORTS_STATUS[short], short, home: row?.scores?.home?.total ?? null, away: row?.scores?.away?.total ?? null });
      }
    } catch (error) {
      console.error(`  basketball ${date}: ${error.message}`);
    }
    // The Free tier's per-minute ceiling is far tighter than API-Football's.
    // 200ms between calls got every request refused; 7s stays under 10/min.
    await sleep(7_000);
  }
  return found;
}

async function run() {
  const fixtures = await staleFixtures();
  console.log(`stale fixtures past their sport's window: ${fixtures.length}`);
  if (!fixtures.length) return;

  const byProvider = new Map();
  for (const row of fixtures) {
    if (!byProvider.has(row.provider)) byProvider.set(row.provider, []);
    byProvider.get(row.provider).push(row);
  }
  for (const [provider, rows] of [...byProvider].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${provider.padEnd(22)} ${String(rows.length).padStart(5)}`);
  }

  const footballKey = process.env.API_FOOTBALL_KEY ?? process.env.APISPORTS_KEY ?? process.env.SPORTS_API_KEY;
  const basketballKey = process.env.API_BASKETBALL_KEY ?? process.env.APISPORTS_KEY ?? process.env.SPORTS_API_KEY;

  const resolved = new Map();
  const football = byProvider.get("api-football") ?? [];
  if (football.length && footballKey) {
    console.log(`\nasking API-Football about ${football.length} fixtures in ${Math.ceil(football.length / 20)} batches...`);
    const results = await footballResults(football, footballKey);
    for (const row of football) {
      const id = String(row.provider_fixture_id).replace(/^api-football:/, "");
      const hit = results.get(id);
      if (hit) resolved.set(row.id, { ...hit, row });
    }
  } else if (football.length) {
    console.log("\nAPI_FOOTBALL_KEY is not set; skipping football.");
  }

  const basketball = byProvider.get("api-basketball") ?? [];
  if (basketball.length && basketballKey) {
    const dates = new Set(basketball.map((row) => row.kickoff_at.slice(0, 10)));
    console.log(`asking api-basketball about ${basketball.length} fixtures across ${dates.size} dates...`);
    const results = await basketballResults(basketball, basketballKey);
    for (const row of basketball) {
      const id = String(row.provider_fixture_id).replace(/^api-basketball:/, "");
      const hit = results.get(id);
      if (hit) resolved.set(row.id, { ...hit, row });
    }
  } else if (basketball.length) {
    console.log("API_BASKETBALL_KEY is not set; skipping basketball.");
  }

  const terminal = [...resolved.entries()].filter(([, hit]) => hit.status && TERMINAL.has(hit.status));
  const stillOpen = [...resolved.entries()].filter(([, hit]) => !hit.status);

  console.log(`\nprovider answered for   : ${resolved.size} of ${fixtures.length}`);
  console.log(`  terminal result       : ${terminal.length}`);
  console.log(`  provider says not over: ${stillOpen.length}`);
  console.log(`  no provider answer    : ${fixtures.length - resolved.size}`);

  const byStatus = new Map();
  for (const [, hit] of terminal) byStatus.set(hit.status, (byStatus.get(hit.status) ?? 0) + 1);
  for (const [status, count] of byStatus) console.log(`    ${status.padEnd(12)} ${count}`);

  if (!commit) {
    console.log("\nDRY RUN — nothing written. Re-run with --commit.");
    return;
  }

  let written = 0;
  const failures = [];
  for (const [id, hit] of terminal) {
    // Only a finished match keeps a score. An abandoned one has a partial
    // scoreline that would misread as a final result.
    const patch = {
      status: hit.status,
      updated_at: new Date().toISOString(),
      ...(hit.status === "finished" ? { home_score: hit.home, away_score: hit.away } : {})
    };
    const { error } = await db.from("op_fixtures").update(patch).eq("id", id);
    if (error) failures.push(`${id}: ${error.message}`);
    else written += 1;
  }
  console.log(`\nwrote ${written} results.`);
  for (const failure of failures.slice(0, 10)) console.error(`  ${failure}`);
  if (failures.length > 10) console.error(`  ...and ${failures.length - 10} more`);
}

await run();
