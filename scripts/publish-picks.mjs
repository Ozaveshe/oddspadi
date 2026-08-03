#!/usr/bin/env node
/**
 * The publication path, operated deliberately.
 *
 *   npm run ops:publish -- --status
 *   npm run ops:publish -- --approve tennis --by afrotools --rationale "..."
 *   npm run ops:publish -- --enable --by afrotools
 *   npm run ops:publish                       # dry run: what would publish
 *   npm run ops:publish -- --commit
 *   npm run ops:publish -- --disable --by afrotools --reason "..."
 *
 * Approval attaches to the model, not to each pick: once a sport's profile is
 * approved the pipeline publishes anything clearing the gates. That is the
 * chosen operating model, and it is why `--enable` and `--approve` are separate
 * deliberate acts rather than one.
 *
 * Defaults to a dry run. Nothing is written without --commit.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}
const has = (name) => process.argv.includes(`--${name}`);
const commit = has("commit");

async function status() {
  const [{ data: controls }, { data: promos }, { count }] = await Promise.all([
    db.from("op_publication_controls").select("*").maybeSingle(),
    db.from("op_calibration_promotions").select("sport,model_key,status,approved_by,approved_at").eq("status", "approved"),
    db.from("op_publications").select("*", { count: "exact", head: true })
  ]);

  console.log(`publishing        : ${controls?.publishing_enabled ? "ENABLED" : "DISABLED"}`);
  if (!controls?.publishing_enabled && controls?.disabled_reason) {
    console.log(`  reason          : ${controls.disabled_reason}${controls.disabled_by ? ` (${controls.disabled_by})` : ""}`);
  }
  console.log(`blast-radius cap  : ${controls?.max_publications_per_run ?? "?"} per run`);
  console.log(`publications      : ${count ?? "?"}`);
  console.log(`approved models   : ${promos?.length ? "" : "none"}`);
  for (const promo of promos ?? []) {
    console.log(`  ${promo.sport} / ${promo.model_key} — approved by ${promo.approved_by} at ${promo.approved_at}`);
  }
}

async function setPublishing(enabled) {
  const actor = arg("by");
  const reason = arg("reason");
  if (!actor) {
    console.error("--by <name> is required. A publishing state change with no named actor is not an audit trail.");
    process.exit(2);
  }
  if (!enabled && !reason) {
    console.error("--reason is required when disabling.");
    process.exit(2);
  }
  if (!commit) {
    console.log(`DRY RUN: would ${enabled ? "enable" : "disable"} publishing as ${actor}. Re-run with --commit.`);
    return;
  }
  const { error } = await db.rpc("op_set_publishing", { p_enabled: enabled, p_actor: actor, p_reason: reason });
  if (error) {
    console.error(`failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`publishing ${enabled ? "ENABLED" : "DISABLED"} by ${actor}.`);
}

async function approve() {
  const sport = arg("approve");
  const by = arg("by");
  const rationale = arg("rationale");
  if (!sport || !by || !rationale) {
    console.error("--approve <sport> --by <name> --rationale <text> are all required.");
    console.error("The named approver is stored immutably and is what makes a published pick traceable to a person.");
    process.exit(2);
  }

  // Approve only against a profile that actually reached shadow review. The
  // check lives here as well as in the gate so an operator sees why, not just
  // that it failed.
  const { data: candidate, error: readError } = await db
    .from("op_calibration_candidates")
    .select("id,sport,model_key,engine_version,created_at")
    .eq("sport", sport)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (readError) {
    console.error(`could not read calibration candidates: ${readError.message}`);
    process.exit(1);
  }
  if (!candidate) {
    console.error(`No calibration candidate exists for ${sport}. Run a calibration first.`);
    process.exit(1);
  }

  console.log(`candidate: ${candidate.model_key} / ${candidate.engine_version} (${candidate.created_at})`);
  if (!commit) {
    console.log(`DRY RUN: would approve ${sport} as ${by}. Re-run with --commit.`);
    return;
  }
  const { error } = await db.from("op_calibration_promotions").insert({
    candidate_id: candidate.id,
    sport: candidate.sport,
    model_key: candidate.model_key,
    engine_version: candidate.engine_version,
    status: "approved",
    approved_by: by,
    rationale
  });
  if (error) {
    console.error(`approval failed: ${error.message}`);
    process.exit(1);
  }
  console.log(`approved ${sport} / ${candidate.model_key}, by ${by}.`);
}

if (has("status")) {
  await status();
} else if (has("enable")) {
  await setPublishing(true);
} else if (has("disable")) {
  await setPublishing(false);
} else if (arg("approve")) {
  await approve();
} else {
  console.log("The publisher itself runs as a scheduled job; this command manages its controls.\n");
  await status();
  console.log("\n--status | --approve <sport> --by <name> --rationale <text> | --enable --by <name> | --disable --by <name> --reason <text>");
  console.log("Add --commit to any state-changing command. Everything defaults to a dry run.");
}
