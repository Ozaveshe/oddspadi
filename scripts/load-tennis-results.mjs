#!/usr/bin/env node
/**
 * Join the tennis-data.co.uk results corpus onto `op_fixtures` so finished
 * tennis matches finally carry a score and `gradeMarketDecision` can grade them.
 *
 *   node scripts/load-tennis-results.mjs --fixtures fixtures.json            # report only
 *   node scripts/load-tennis-results.mjs --fixtures fixtures.json --out x.sql
 *
 * `--fixtures` is a JSON array of finished, unscored tennis fixtures exported
 * from Supabase: [{ id, date, home, away }, ...]. The script never writes to the
 * database itself — it emits SQL so the join can be reviewed before it lands.
 *
 * Three things this guards against, all of them ways to silently corrupt the
 * calibration curve the corpus exists to make measurable:
 *
 * 1. The corpus is CANONICALISED: `winner_side` is `player_1` on all 13,642
 *    rows because the winner is always listed first. Anything that reads sides
 *    positionally learns "player_1 wins". Every row is de-canonicalised here
 *    with a seed derived from `match_id`, so side order is shuffled but
 *    deterministic and reproducible across runs.
 * 2. Names do not join exactly ("Popyrin A." vs "A. Popyrin"), so the join uses
 *    the existing provider matcher from `teamNameAlignment` rather than a third
 *    bespoke one.
 * 3. That matcher drops sub-3-character tokens, so initials vanish and
 *    "Zverev A." would align with "M. Zverev". A wrong join is worse than no
 *    row, so a same-surname pair whose initials disagree is rejected, and any
 *    corpus row or fixture involved in more than one candidate match is dropped
 *    rather than guessed at.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { teamNamesAlign, teamNameTokens } from "../src/lib/sports/providers/teamNameAlignment.ts";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const csvPath = arg(
  "csv",
  "training-data/expanded-v2/standard-v2/datasets/tennis_matches_with_scores_2024_to_2026.csv"
);
const fixturesPath = arg("fixtures");
const outPath = arg("out");
// The plan's gate: below this the aligner needs work, and widening the date
// window to beat it would trade a measurable gap for an unmeasurable one.
const MATCH_RATE_GATE = 0.7;
const DATE_TOLERANCE_DAYS = 1;

if (!fixturesPath) {
  console.error("--fixtures <path.json> is required (export of finished unscored tennis fixtures).");
  process.exit(1);
}

/** Minimal RFC4180 reader; `set_scores_json` embeds quoted commas. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') { field += char; continue; }
      if (text[index + 1] === '"') { field += '"'; index += 1; continue; }
      quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ",") { row.push(field); field = ""; continue; }
    if (char === "\n") { row.push(field); rows.push(row); row = []; field = ""; continue; }
    if (char === "\r") continue;
    field += char;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const csvRows = parseCsv(readFileSync(csvPath, "utf8"));
const header = csvRows[0];
const column = Object.fromEntries(header.map((name, index) => [name, index]));
const corpusRows = csvRows.slice(1).filter((row) => row.length === header.length);

/**
 * Deterministic side order from `match_id`. The corpus always lists the winner
 * first; leaving that in place would make "first side" a perfect predictor of
 * the result for anything downstream that reads position.
 */
function decanonicalisedSides(row) {
  const matchId = row[column.match_id];
  const seed = createHash("sha256").update(matchId).digest()[0];
  const first = {
    name: row[column.player_1_name].trim(),
    sets: Number(row[column.player_1_sets])
  };
  const second = {
    name: row[column.player_2_name].trim(),
    sets: Number(row[column.player_2_sets])
  };
  return seed % 2 === 0 ? [first, second] : [second, first];
}

const gradeable = corpusRows
  .filter((row) => row[column.gradeable_match_winner] === "true")
  .map((row) => {
    const [sideA, sideB] = decanonicalisedSides(row);
    return {
      matchId: row[column.match_id],
      date: row[column.match_date],
      tournament: row[column.tournament],
      sideA,
      sideB
    };
  })
  .filter((entry) => Number.isFinite(entry.sideA.sets) && Number.isFinite(entry.sideB.sets));

// Proof the de-canonicalisation actually did something: if the winner still
// lands on side A every time, the seed is not being applied.
const winnerOnSideA = gradeable.filter((entry) => entry.sideA.sets > entry.sideB.sets).length;

// Accepts either objects or the `json_build_array(id, date, home, away)` rows
// the Supabase export produces.
const fixtures = JSON.parse(readFileSync(fixturesPath, "utf8")).map((fixture) =>
  Array.isArray(fixture)
    ? { id: fixture[0], date: fixture[1], home: fixture[2] ?? "", away: fixture[3] ?? "", status: fixture[4] ?? "finished" }
    : { id: fixture.id, date: fixture.date, home: fixture.home ?? "", away: fixture.away ?? "", status: fixture.status ?? "finished" }
);
// The export is prefiltered to fixtures sharing a surname with a corpus row, so
// the fixture-coverage denominator has to be supplied rather than inferred.
const fixtureUniverse = Number(arg("fixture-universe", String(fixtures.length)));

const dayMs = 86_400_000;
const fixturesByDay = new Map();
for (const fixture of fixtures) {
  const key = fixture.date;
  if (!fixturesByDay.has(key)) fixturesByDay.set(key, []);
  fixturesByDay.get(key).push(fixture);
}
function fixturesNear(date) {
  const base = Date.parse(`${date}T00:00:00Z`);
  const out = [];
  for (let offset = -DATE_TOLERANCE_DAYS; offset <= DATE_TOLERANCE_DAYS; offset += 1) {
    const key = new Date(base + offset * dayMs).toISOString().slice(0, 10);
    out.push(...(fixturesByDay.get(key) ?? []));
  }
  return out;
}

/**
 * The shared matcher ignores tokens shorter than three characters, so initials
 * are invisible to it and every "Zverev" collapses onto every other. Reject a
 * pair whose stated initials disagree; both name orders appear in the wild
 * ("Popyrin A." in the corpus, "A. Popyrin" from the provider), so compare the
 * sets of single letters rather than their position.
 */
function initialsConflict(left, right) {
  const initials = (value) =>
    new Set(
      value
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .split(/[^a-z]+/)
        .filter((token) => token.length === 1)
    );
  const leftInitials = initials(left);
  const rightInitials = initials(right);
  if (!leftInitials.size || !rightInitials.size) return false;
  return ![...leftInitials].some((letter) => rightInitials.has(letter));
}

function playersAlign(corpusName, fixtureName) {
  return teamNamesAlign(corpusName, fixtureName) && !initialsConflict(corpusName, fixtureName);
}

const candidates = [];
const unmatched = [];
for (const entry of gradeable) {
  const hits = [];
  for (const fixture of fixturesNear(entry.date)) {
    if (playersAlign(entry.sideA.name, fixture.home) && playersAlign(entry.sideB.name, fixture.away)) {
      hits.push({ fixture, orientation: "direct" });
    } else if (playersAlign(entry.sideA.name, fixture.away) && playersAlign(entry.sideB.name, fixture.home)) {
      hits.push({ fixture, orientation: "swapped" });
    }
  }
  if (hits.length === 1) candidates.push({ entry, ...hits[0] });
  else unmatched.push({ entry, reason: hits.length ? "ambiguous" : "no-fixture" });
}

// A fixture claimed by two different corpus rows is a coin flip, not a match.
const fixtureClaims = new Map();
for (const candidate of candidates) {
  fixtureClaims.set(candidate.fixture.id, (fixtureClaims.get(candidate.fixture.id) ?? 0) + 1);
}
const matched = candidates.filter((candidate) => fixtureClaims.get(candidate.fixture.id) === 1);
const contested = candidates.length - matched.length;

// `gradeMarketDecision` only reads a finished fixture, and a score on a row the
// provider still calls scheduled would contradict itself. Those pairs are
// counted — they are alignment successes, and they say the sync left a whole
// match day stale — but they are not written.
const writable = matched.filter((candidate) => candidate.fixture.status === "finished");
const staleStatus = matched.length - writable.length;

const writes = writable.map((candidate) => {
  const { entry, fixture, orientation } = candidate;
  const homeSets = orientation === "direct" ? entry.sideA.sets : entry.sideB.sets;
  const awaySets = orientation === "direct" ? entry.sideB.sets : entry.sideA.sets;
  return { fixtureId: fixture.id, homeSets, awaySets, matchId: entry.matchId, fixture, entry };
});

const corpusInFixtureWindow = gradeable.filter((entry) => fixturesNear(entry.date).length > 0).length;
const rate = (value, total) => (total ? `${((value / total) * 100).toFixed(1)}%` : "n/a");

console.log(`corpus rows                       ${corpusRows.length}`);
console.log(`  gradeable_match_winner=true     ${gradeable.length}`);
console.log(`  winner on side A after reseed   ${winnerOnSideA} (${rate(winnerOnSideA, gradeable.length)}; 100% would mean the de-canonicalisation did not run)`);
console.log(`  with any fixture within +/-1d   ${corpusInFixtureWindow}`);
console.log(`candidate fixtures supplied        ${fixtures.length}`);
console.log(`unscored finished tennis fixtures  ${fixtureUniverse}`);
console.log("");
console.log(`matched pairs                     ${matched.length}`);
console.log(`  of those, writable (finished)   ${writable.length}`);
console.log(`  of those, fixture still 'scheduled' etc  ${staleStatus}`);
console.log(`  dropped, ambiguous corpus row   ${unmatched.filter((row) => row.reason === "ambiguous").length}`);
console.log(`  dropped, contested fixture      ${contested}`);
console.log(`  no fixture at all               ${unmatched.filter((row) => row.reason === "no-fixture").length}`);
console.log("");
console.log("MATCH RATES");
console.log(`  vs whole gradeable corpus       ${rate(matched.length, gradeable.length)}  (${matched.length}/${gradeable.length})`);
console.log(`  vs corpus rows a fixture exists for  ${rate(matched.length, corpusInFixtureWindow)}  (${matched.length}/${corpusInFixtureWindow})  <- aligner quality, gate ${MATCH_RATE_GATE * 100}%`);
console.log(`  fixture coverage (writable)     ${rate(writable.length, fixtureUniverse)}  (${writable.length}/${fixtureUniverse})`);

console.log("\nunmatched corpus rows that had a fixture in range:");
for (const row of unmatched.filter((row) => row.reason === "no-fixture" && fixturesNear(row.entry.date).length)) {
  console.log(`  ${row.entry.date} ${row.entry.sideA.name} vs ${row.entry.sideB.name}  (${row.entry.tournament})`);
}

const alignerRate = corpusInFixtureWindow ? matched.length / corpusInFixtureWindow : 0;
if (alignerRate < MATCH_RATE_GATE) {
  console.log(`\nAligner rate ${(alignerRate * 100).toFixed(1)}% is below the ${MATCH_RATE_GATE * 100}% gate.`);
}

console.log("\nsample matches:");
for (const write of writes.slice(0, 12)) {
  console.log(
    `  ${write.entry.date} ${write.entry.sideA.name} vs ${write.entry.sideB.name}  ->  ${write.fixture.date} ${write.fixture.home} vs ${write.fixture.away}  =  ${write.homeSets}-${write.awaySets}`
  );
}

if (outPath) {
  const statements = writes.map(
    (write) =>
      `update op_fixtures set home_score = ${write.homeSets}, away_score = ${write.awaySets}, updated_at = now() ` +
      `where id = '${write.fixtureId}' and sport = 'tennis' and status = 'finished' and home_score is null;`
  );
  writeFileSync(outPath, `${statements.join("\n")}\n`, "utf8");
  console.log(`\n${statements.length} update statements written to ${outPath}`);
}
