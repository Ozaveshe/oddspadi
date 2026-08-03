#!/usr/bin/env node
/**
 * Cross-surface truth reconciliation. Read-only, always.
 *
 *   node --env-file-if-exists=.env.local scripts/reconcile-truth.mjs [--json]
 *
 * Compares the publication ledger against results, settlements, performance
 * aggregates, editorial references and the projection store, and reports every
 * disagreement it finds.
 *
 * Two rules govern this script:
 *
 *   1. It never writes. Not a correction, not a backfill, not a status flip.
 *      A job that repairs history while reporting on it destroys the evidence
 *      that the repair was needed, and "the reconciler fixed it" is
 *      indistinguishable from "it was never broken". Corrections go through
 *      the append-only revision path, operated deliberately.
 *
 *   2. It never reports zero on failure. This codebase has already shipped an
 *      audit tool that printed a clean report when its credentials were
 *      rejected. Any read error aborts with a non-zero exit and no report,
 *      because a blank finding list must only ever mean "checked, nothing
 *      wrong".
 *
 * Exit codes: 0 clean, 1 findings, 2 could not check.
 */
import { createClient } from "@supabase/supabase-js";

const asJson = process.argv.includes("--json");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;

if (!url || !key) {
  console.error("reconcile-truth: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(2);
}

const db = createClient(url, key, { auth: { persistSession: false } });

/**
 * Sources this run could not read.
 *
 * These are reported, never swallowed. An earlier draft of this script wrapped
 * the optional reads in `.catch(() => [])`, and it duly announced "0
 * projections" against a store holding six — reproducing, inside the
 * reconciler, the exact error-becomes-empty defect it exists to catch.
 */
const unreadable = [];

/** Every finding carries the evidence needed to act without re-querying. */
const findings = [];
function report(kind, severity, subject, detail, evidence = {}) {
  findings.push({ kind, severity, subject, detail, evidence });
}

/** PostgREST caps at 1000 rows regardless of .limit(); page by keyset. */
/**
 * Read a source that may legitimately not exist yet.
 *
 * Returns null — never an empty array — when the read fails, so the caller
 * cannot mistake "could not check" for "nothing there".
 */
async function tryReadAll(table, columns, options) {
  try {
    return await readAll(table, columns, options);
  } catch (error) {
    unreadable.push({ table, reason: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

async function readAll(table, columns, { order = "id", filter } = {}) {
  const rows = [];
  let cursor = null;
  for (let page = 0; page < 200; page += 1) {
    let query = db.from(table).select(columns).order(order, { ascending: true }).limit(1000);
    if (cursor !== null) query = query.gt(order, cursor);
    if (filter) query = filter(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    cursor = data[data.length - 1][order];
    if (data.length < 1000) break;
  }
  return rows;
}

async function main() {
  // ---- The ledger ---------------------------------------------------------
  const publications = await readAll(
    "op_publications",
    "id,fixture_id,fixture_external_id,market,selection,published_at,kickoff_at,odds_snapshot_id,publication_status,settlement_status,record_class",
    { order: "id" }
  );

  const fixtures = new Map();
  for (const row of await readAll(
    "op_fixtures",
    "id,external_id,status,home_score,away_score,kickoff_at,last_synced_at",
    { order: "id" }
  )) {
    fixtures.set(String(row.id), row);
    if (row.external_id) fixtures.set(String(row.external_id), row);
  }

  // ---- 1. Publication after kickoff ---------------------------------------
  // The single claim that makes a track record a forecast rather than a story.
  for (const pub of publications) {
    if (!pub.published_at || !pub.kickoff_at) {
      report("missing-publication-time", "critical", pub.id, "Published with no publication or kickoff time.");
      continue;
    }
    if (Date.parse(pub.published_at) >= Date.parse(pub.kickoff_at)) {
      report("publication-after-kickoff", "critical", pub.id, "Published at or after kickoff.", {
        publishedAt: pub.published_at,
        kickoffAt: pub.kickoff_at
      });
    }
  }

  // ---- 2. Duplicate publication -------------------------------------------
  const byClaim = new Map();
  for (const pub of publications) {
    if (pub.publication_status === "retracted") continue;
    const claim = `${pub.fixture_id}::${pub.market}::${pub.selection}`;
    const seen = byClaim.get(claim);
    if (seen) {
      report("duplicate-publication", "critical", claim, "Two live publications for the same selection.", {
        first: seen,
        second: pub.id
      });
    } else {
      byClaim.set(claim, pub.id);
    }
  }

  // ---- 3. Record class ------------------------------------------------------
  for (const pub of publications) {
    if (pub.record_class !== "official_public_pick") {
      report("non-official-in-ledger", "critical", pub.id, `Record class "${pub.record_class}" is in the official ledger.`);
    }
  }

  // ---- 4. Missing canonical identity ----------------------------------------
  for (const pub of publications) {
    if (!fixtures.has(String(pub.fixture_id)) && !fixtures.has(String(pub.fixture_external_id))) {
      report("missing-canonical-identity", "critical", pub.id, "Publication references a fixture that does not exist.", {
        fixtureId: pub.fixture_id
      });
    }
  }

  // ---- 5. Missing odds snapshot ---------------------------------------------
  for (const pub of publications) {
    if (!pub.odds_snapshot_id) {
      report("missing-odds-snapshot", "warning", pub.id, "No odds snapshot recorded at publication.");
    }
  }

  // ---- 6. Missing settlement / conflicting result ---------------------------
  const SETTLE_DEADLINE_MS = 60 * 60_000;
  const now = Date.now();
  for (const pub of publications) {
    const fixture = fixtures.get(String(pub.fixture_id)) ?? fixtures.get(String(pub.fixture_external_id));
    if (!fixture) continue;
    const terminal = ["finished", "cancelled", "abandoned"].includes(fixture.status);
    const settled = pub.settlement_status && pub.settlement_status !== "unsettled";

    if (terminal && !settled) {
      // The acceptance target is settlement within 60 minutes of a confirmed
      // final result, so the finding fires against that, not "eventually".
      const since = fixture.last_synced_at ? now - Date.parse(fixture.last_synced_at) : 0;
      if (since > SETTLE_DEADLINE_MS) {
        report("missing-settlement", "critical", pub.id, `Fixture ${fixture.status} for ${Math.round(since / 60_000)} minutes, still unsettled.`);
      }
    }
    if (!terminal && settled) {
      report("settlement-before-result", "critical", pub.id, `Settled "${pub.settlement_status}" while the fixture is "${fixture.status}".`);
    }
    // A decided outcome on a match that never produced one.
    if (["won", "lost", "push"].includes(pub.settlement_status) && fixture.status !== "finished") {
      report("conflicting-fixture-result", "critical", pub.id, `Graded "${pub.settlement_status}" on a "${fixture.status}" fixture.`);
    }
  }

  // ---- 7. Mismatched article count ------------------------------------------
  const ledgerIds = new Set(publications.map((p) => p.id));
  const stories = await tryReadAll("op_editorial_stories", "slug,body,sources,published_at", { order: "slug" });
  for (const story of stories ?? []) {
    const cited = String(story.metadata?.publicationIds ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const claimsACount = /\b\d+\s+(winning\s+)?(picks?|selections?|tips?)\b/i.test(String(story.body ?? ""));
    if (claimsACount && cited.length === 0) {
      report("article-count-without-ids", "critical", story.slug, "Story states a pick count but cites no publication IDs.");
    }
    for (const id of cited) {
      if (!ledgerIds.has(id)) {
        report("article-cites-unknown-publication", "critical", story.slug, `Cited publication ${id} is not in the ledger.`);
      }
    }
  }

  // ---- 8. Stale projection ---------------------------------------------------
  const REFRESH_INTERVAL_MS = 5 * 60_000;
  const STALE_MULTIPLE = 3;
  const projections = await tryReadAll("op_public_projections", "name,scope,built_at,status,row_count,builder_version", { order: "name" });
  // The orchestrator rebuilds today and tomorrow only, so a slate scoped to a
  // past date is finished, not stale. Warning about it would fire every day
  // forever, and a monitor that cries wolf daily gets muted — which is how the
  // real staleness below went unnoticed in the first place.
  const todayUtc = new Date(now).toISOString().slice(0, 10);
  for (const projection of projections ?? []) {
    const scope = String(projection.scope);
    if (scope.startsWith("archive")) continue;
    if (/^\d{4}-\d{2}-\d{2}$/.test(scope) && scope < todayUtc) continue;
    const age = projection.built_at ? now - Date.parse(projection.built_at) : Number.POSITIVE_INFINITY;
    if (age > REFRESH_INTERVAL_MS * STALE_MULTIPLE) {
      report("stale-projection", "warning", `${projection.name}/${projection.scope}`, `Projection is ${Math.round(age / 60_000)} minutes old.`);
    }
  }

  // ---- 9. Orphaned community fixture -----------------------------------------
  const tips = await tryReadAll("op_community_tips", "id,fixture_id", { order: "id" });
  for (const tip of tips ?? []) {
    if (tip.fixture_id && !fixtures.has(String(tip.fixture_id))) {
      report("orphaned-community-fixture", "warning", String(tip.id), "Community tip references a fixture that does not exist.", {
        fixtureId: tip.fixture_id
      });
    }
  }

  return {
    checkedAt: new Date().toISOString(),
    scope: {
      publications: publications.length,
      fixtures: new Set([...fixtures.values()].map((f) => f.id)).size,
      stories: stories?.length ?? null,
      projections: projections?.length ?? null,
      communityTips: tips?.length ?? null
    },
    unreadable,
    findings
  };
}

try {
  const result = await main();
  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(`reconcile-truth  ${result.checkedAt}`);
    console.log(
      `scope: ${result.scope.publications} publications, ${result.scope.fixtures} fixtures, ` +
        `${result.scope.stories ?? "?"} stories, ${result.scope.projections ?? "?"} projections, ` +
        `${result.scope.communityTips ?? "?"} community tips`
    );
    if (result.unreadable.length) {
      console.log("\nCOULD NOT CHECK:");
      for (const source of result.unreadable) console.log(`  ${source.table} — ${source.reason}`);
      console.log("  Findings below do not cover these sources.");
    }
    if (!result.scope.publications) {
      // Not a pass. Say so plainly rather than letting an empty finding list
      // read as a verified-clean official record.
      console.log("\nNOTE: the official ledger holds zero publications, so every ledger check above");
      console.log("      passed vacuously. This is a measured state, not a clean bill of health.");
    }
    console.log("");
    if (!result.findings.length) {
      console.log("no findings");
    } else {
      const critical = result.findings.filter((f) => f.severity === "critical");
      console.log(`${result.findings.length} finding(s), ${critical.length} critical\n`);
      for (const f of result.findings) {
        console.log(`  [${f.severity}] ${f.kind}  ${f.subject}`);
        console.log(`      ${f.detail}`);
        if (Object.keys(f.evidence).length) console.log(`      ${JSON.stringify(f.evidence)}`);
      }
      console.log("\nThis job does not repair anything. Corrections go through the append-only");
      console.log("revision path so the original claim stays readable.");
    }
  }
  if (result.unreadable.length) process.exit(2);
  process.exit(result.findings.some((f) => f.severity === "critical") ? 1 : 0);
} catch (error) {
  // No report on failure. A blank finding list must only ever mean "checked".
  console.error(`reconcile-truth: could not complete the check — ${error instanceof Error ? error.message : String(error)}`);
  console.error("No report produced. Do not read this as a clean result.");
  process.exit(2);
}
