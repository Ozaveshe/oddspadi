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

/**
 * Fixtures we are still owed an answer about.
 *
 * Two populations, and the second is why this query is an `or`:
 *
 *  - the provider still calls it `scheduled` or `live` long after kick-off, and
 *  - anything the stale sweep put into quarantine (`lifecycle_state`
 *    `unresolved` / `due` / `suspended`).
 *
 * The second set is not a subset of the first. A quarantined fixture can carry
 * any status at all — including `finished` — and filtering on status alone
 * would skip exactly the rows an operator is chasing.
 */
async function staleFixtures() {
  // Keyset pagination on kickoff_at: an unordered deep .range() returns an
  // arbitrary slice, and ordering with a deep offset hits the 8s statement
  // timeout. Both have bitten this codebase before.
  const rows = [];
  let cursor = "1970-01-01T00:00:00.000Z";
  for (;;) {
    let query = db
      .from("op_fixtures")
      .select("id,sport,provider,external_id,provider_fixture_id,lifecycle_state,status,kickoff_at,home_team_name,away_team_name")
      .or("status.in.(scheduled,live),lifecycle_state.in.(unresolved,due,suspended)")
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
 * The provider's id for a fixture.
 *
 * `provider_fixture_id` holds the bare id but is null on rows written by an
 * older ingestion (two of them, under the legacy provider name `api_football`).
 * `external_id` is always populated and always `provider:id`, so it is the
 * reliable source and the other is a fallback.
 */
function providerId(row) {
  const fromExternal = String(row.external_id ?? "").split(":").pop();
  return fromExternal || String(row.provider_fixture_id ?? "") || null;
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
  const reported = (Array.isArray(errors) ? errors : Object.values(errors ?? {})).filter(Boolean);
  if (reported.length) throw new Error(reported.join("; "));
  return body;
}

/**
 * Per-provider call ledger.
 *
 * A refused call and a call that legitimately found nothing are the same shape
 * on the wire and must never be the same line in the summary. Reporting "0
 * resolved" without saying whether anyone was actually asked is the failure
 * mode this whole script was written around, so the counts are kept per
 * provider and printed whether or not anything was written.
 */
const calls = new Map();
function ledger(provider) {
  if (!calls.has(provider)) calls.set(provider, { made: 0, refused: 0, reasons: new Map() });
  return calls.get(provider);
}
function noteRefusal(provider, message) {
  const entry = ledger(provider);
  entry.refused += 1;
  // Collapse to the stable part of the message: quota and window refusals name
  // dates that differ per call and would otherwise read as many distinct faults.
  const key = message.replace(/\d{4}-\d{2}-\d{2}/g, "<date>").slice(0, 140);
  entry.reasons.set(key, (entry.reasons.get(key) ?? 0) + 1);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * API-Football takes up to 20 ids per call, dash separated.
 *
 * Asking by id rather than by date is what makes this reach back further than
 * the scheduled sweep can: measured 2026-08-07, a fixture 26.5 days old still
 * returned `AET`. There is no practical result window on this plan.
 */
async function footballResults(fixtures, apiKey) {
  const found = new Map();
  const ids = fixtures.map(providerId).filter(Boolean);
  for (let index = 0; index < ids.length; index += 20) {
    const batch = ids.slice(index, index + 20);
    const endpoint = `https://v3.football.api-sports.io/fixtures?ids=${batch.join("-")}`;
    ledger("api-football").made += 1;
    try {
      const data = await getJson(endpoint, { "x-apisports-key": apiKey });
      for (const row of data?.response ?? []) {
        const id = String(row?.fixture?.id ?? "");
        const short = row?.fixture?.status?.short;
        if (!id || !(short in API_SPORTS_STATUS)) continue;
        found.set(id, { status: API_SPORTS_STATUS[short], short, home: row?.goals?.home ?? null, away: row?.goals?.away ?? null });
      }
    } catch (error) {
      noteRefusal("api-football", error.message);
      console.error(`  football batch ${index / 20 + 1}: ${error.message}`);
    }
    // 450/min on this plan; 200ms between calls keeps a wide margin.
    await sleep(200);
  }
  return found;
}

/**
 * api-tennis answers per match_key, so there is no batching to be had.
 *
 * Untested lane: no `API_TENNIS_KEY` is present in the environment this was
 * written in, so the request shape is copied from the live adapter
 * (`providerBackedProvider.ts`, the `get_fixtures&match_key=` path) rather than
 * exercised. It is rate-limited conservatively and, like every other lane here,
 * writes nothing for a status it does not recognise.
 */
async function tennisResults(fixtures, apiKey) {
  const found = new Map();
  for (const row of fixtures) {
    const id = providerId(row);
    if (!id) continue;
    ledger("api-tennis").made += 1;
    try {
      const data = await getJson(
        `https://api.api-tennis.com/tennis/?method=get_fixtures&match_key=${encodeURIComponent(id)}&APIkey=${apiKey}`
      );
      // This provider signals refusal with `success: 0` as well as `errors`.
      if (data?.success === 0) throw new Error(String(data?.error ?? "provider reported success: 0"));
      for (const event of Array.isArray(data?.result) ? data.result : []) {
        const key = String(event?.event_key ?? "");
        const status = String(event?.event_status ?? "").trim();
        if (!key) continue;
        // "Finished" is the only status this provider states that we act on;
        // anything else is left exactly as it is.
        if (!/^finished$/i.test(status)) continue;
        const [home, away] = String(event?.event_final_result ?? "").split("-").map((part) => Number(part.trim()));
        if (!Number.isFinite(home) || !Number.isFinite(away)) continue;
        found.set(key, { status: "finished", short: status, home, away });
      }
    } catch (error) {
      noteRefusal("api-tennis", error.message);
    }
    await sleep(350);
  }
  return found;
}

/**
 * api-basketball has no batch-by-id, and its Free tier allows 100 requests a
 * day, so 473 single lookups is not an option. One call per date covers the
 * whole backlog in about twenty.
 *
 * The Free tier also serves a **three-day date window centred on today**, and
 * says so in the body of an HTTP 200: asked on 2026-08-07 it answered "Free
 * plans do not have access to this date, try from 2026-08-06 to 2026-08-08."
 * So the reachable past is yesterday, and nothing else. Dates outside it are
 * not slow or flaky, they are refused, permanently — no number of retries will
 * produce those results. Calling for them anyway spent two of a hundred daily
 * requests to be told so, which is why the cutoff is applied before dialling.
 */
const BASKETBALL_REACHABLE_DAYS_BACK = 1;

async function basketballResults(fixtures, apiKey) {
  const found = new Map();
  const cutoff = new Date(Date.now() - BASKETBALL_REACHABLE_DAYS_BACK * 86_400_000).toISOString().slice(0, 10);
  const all = [...new Set(fixtures.map((row) => row.kickoff_at.slice(0, 10)))].sort();
  const dates = all.filter((date) => date >= cutoff);
  const skipped = all.length - dates.length;
  if (skipped) {
    console.log(`  ${skipped} of ${all.length} dates are older than the free plan can serve (${cutoff} at the earliest); not calling for those.`);
  }
  for (const date of dates) {
    ledger("api-basketball").made += 1;
    try {
      const data = await getJson(`https://v1.basketball.api-sports.io/games?date=${date}`, { "x-apisports-key": apiKey });
      for (const row of data?.response ?? []) {
        const id = String(row?.id ?? "");
        const short = row?.status?.short;
        if (!id || !(short in API_SPORTS_STATUS)) continue;
        found.set(id, { status: API_SPORTS_STATUS[short], short, home: row?.scores?.home?.total ?? null, away: row?.scores?.away?.total ?? null });
      }
    } catch (error) {
      noteRefusal("api-basketball", error.message);
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

  const tennisKey = process.env.API_TENNIS_KEY ?? process.env.SPORTS_API_KEY;

  const resolved = new Map();
  const attempted = new Set();

  // `api_football` is a legacy provider name for the same upstream service, and
  // its rows carry the same numeric ids. Excluding it stranded two fixtures.
  const football = [...(byProvider.get("api-football") ?? []), ...(byProvider.get("api_football") ?? [])];
  if (football.length && footballKey) {
    console.log(`\nasking API-Football about ${football.length} fixtures in ${Math.ceil(football.length / 20)} batches...`);
    const results = await footballResults(football, footballKey);
    for (const row of football) {
      attempted.add(row.id);
      const hit = results.get(providerId(row));
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
      attempted.add(row.id);
      const hit = results.get(providerId(row));
      if (hit) resolved.set(row.id, { ...hit, row });
    }
  } else if (basketball.length) {
    console.log("API_BASKETBALL_KEY is not set; skipping basketball.");
  }

  const tennis = byProvider.get("api-tennis") ?? [];
  if (tennis.length && tennisKey) {
    console.log(`asking api-tennis about ${tennis.length} fixtures, one call each...`);
    const results = await tennisResults(tennis, tennisKey);
    for (const row of tennis) {
      attempted.add(row.id);
      const hit = results.get(providerId(row));
      if (hit) resolved.set(row.id, { ...hit, row });
    }
  } else if (tennis.length) {
    console.log(`API_TENNIS_KEY is not set; ${tennis.length} tennis fixtures cannot be asked about at all.`);
  }

  const terminal = [...resolved.entries()].filter(([, hit]) => hit.status && TERMINAL.has(hit.status));
  const stillOpen = [...resolved.entries()].filter(([, hit]) => !hit.status);

  // The call ledger comes before the outcome counts, because the outcome counts
  // are only meaningful once you know whether anybody was actually asked.
  console.log(`\nprovider calls`);
  for (const [provider, entry] of calls) {
    console.log(`  ${provider.padEnd(16)} made ${String(entry.made).padStart(4)}  refused ${String(entry.refused).padStart(4)}`);
    for (const [reason, count] of entry.reasons) console.log(`      x${count} ${reason}`);
  }
  const totals = [...calls.values()].reduce((acc, e) => ({ made: acc.made + e.made, refused: acc.refused + e.refused }), { made: 0, refused: 0 });
  if (totals.made && totals.refused === totals.made) {
    console.log(`\n  !! every one of the ${totals.made} calls was refused. Nothing below is evidence of anything.`);
  }

  console.log(`\nnot asked at all        : ${fixtures.length - attempted.size} (no lane, or no credential, for their provider)`);
  console.log(`asked about             : ${attempted.size}`);
  console.log(`provider answered for   : ${resolved.size} of ${attempted.size} asked`);
  console.log(`  terminal result       : ${terminal.length}`);
  console.log(`  provider says not over: ${stillOpen.length}`);
  console.log(`  no provider answer    : ${attempted.size - resolved.size}`);

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

  // What this script deliberately does not write: `lifecycle_state`.
  //
  // Status is the provider's word and belongs here. Our reading of the evidence
  // is the reconciler's to make, and it is the thing that writes the audit row
  // in `op_fixture_lifecycle_transitions`. Setting both here would produce a
  // state change with no transition record, which is the exact failure that
  // table exists to prevent.
  if (written) {
    console.log(`\nNext: npm run ops:reconcile-lifecycles -- --commit   (releases these from quarantine, with an audit row each)`);
    console.log(`Then: the settlement sweep grades any publications resting on them.`);
  }
}

await run();
